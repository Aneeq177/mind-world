"""/save_conversation keeps a longer stored copy and preserves map placement."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

import main
from services import database, embedder

HEADERS = {"X-MW-Client": main.MW_CLIENT_SECRET}


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, client, table):
        self.client, self.table, self.filters, self.payload = client, table, {}, None

    def select(self, _cols):
        return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def limit(self, _n):
        return self

    def upsert(self, row, on_conflict=None):
        self.payload = row
        return self

    def execute(self):
        if self.payload is not None:
            self.client.upserts.setdefault(self.table, []).append(self.payload)
            return _Result([self.payload])
        rows = [r for r in self.client.existing if all(r.get(c) == v for c, v in self.filters.items())]
        return _Result(rows)


class _FakeSupabase:
    def __init__(self, existing):
        self.existing, self.upserts = existing, {}

    def table(self, name):
        return _Query(self, name)


@pytest.fixture
def save(monkeypatch):
    def run(existing, messages):
        fake = _FakeSupabase(existing)
        monkeypatch.setattr(main, "_user_id", lambda email, token=None, key=None: "u1")
        monkeypatch.setattr(database, "get_supabase", lambda: fake)
        monkeypatch.setattr(database, "log_growth_event", lambda *a, **k: None)
        monkeypatch.setattr(database, "get_personal_profile", lambda user_id: {})
        monkeypatch.setattr(embedder, "embed_single", lambda text: np.zeros(384))
        monkeypatch.setattr(main, "_index_chunks_in_background", lambda *a, **k: None)

        async def no_recluster(email):
            return None

        monkeypatch.setattr(main, "run_recluster", no_recluster)
        client = TestClient(main.app, base_url="https://testserver")
        res = client.post("/save_conversation", headers=HEADERS, json={
            "email": "a@b.co", "access_token": "t",
            "conversation": {"id": "c1", "title": "Chat", "platform": "claude",
                             "saved_at": "2026-10-06T00:00:00Z", "messages": messages},
        })
        return res.json(), fake.upserts.get("knowledge_nodes", [])
    return run


def _msgs(n, text="hello there friend"):
    return [{"role": "user" if i % 2 == 0 else "assistant", "content": text} for i in range(n)]


def _stored(num_messages, char_count, **extra):
    return {"id": "c1", "user_id": "u1", "num_messages": num_messages, "char_count": char_count, **extra}


def test_keeps_stored_copy_with_more_messages(save):
    body, upserts = save([_stored(10, 100)], _msgs(4))
    assert body == {"success": True, "id": "c1", "kept_newer": True}
    assert upserts == []


def test_keeps_stored_copy_with_more_text_when_message_counts_match(save):
    body, upserts = save([_stored(2, 50_000)], _msgs(2))
    assert body.get("kept_newer") is True
    assert upserts == []


def test_longer_upload_replaces_stored_copy_but_keeps_map_placement(save):
    existing = _stored(2, 10, created_at="2025-01-01T00:00:00Z", cluster_id=3,
                       region="Cooking", color="#ff0000", x=1.5, y=-2.0)
    body, upserts = save([existing], _msgs(6))
    assert body.get("success") is True and "kept_newer" not in body
    row = upserts[0]
    assert row["num_messages"] == 6
    assert (row["region"], row["cluster_id"], row["color"], row["x"], row["y"]) == ("Cooking", 3, "#ff0000", 1.5, -2.0)
    assert row["created_at"] == "2025-01-01T00:00:00Z"


def test_new_conversation_is_stored_as_recent(save):
    body, upserts = save([], _msgs(2))
    assert body.get("success") is True
    assert upserts[0]["region"] == "Recent"


def test_other_users_copy_is_ignored(save):
    body, upserts = save([{"id": "c1", "user_id": "someone_else", "num_messages": 99, "char_count": 9999}], _msgs(2))
    assert "kept_newer" not in body
    assert len(upserts) == 1
