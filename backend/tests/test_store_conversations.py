import numpy as np

from services import database


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, client, table):
        self.client, self.table, self.filters, self.payload = client, table, {}, None

    def select(self, _cols):
        return self

    def eq(self, col, val):
        self.filters[col] = [val]
        return self

    def in_(self, col, vals):
        self.filters[col] = list(vals)
        return self

    def upsert(self, rows, on_conflict=None):
        self.payload = rows
        return self

    def execute(self):
        if self.payload is not None:
            self.client.upserts.setdefault(self.table, []).extend(self.payload)
            return _Result(self.payload)
        rows = [r for r in self.client.existing if all(r.get(c) in v for c, v in self.filters.items())]
        return _Result(rows)


class _FakeSupabase:
    def __init__(self, existing):
        self.existing, self.upserts = existing, {}

    def table(self, name):
        return _Query(self, name)


def _chat(conv_id, num_messages):
    return {
        "id": conv_id, "title": conv_id, "source": "claude", "created_at": "", "updated_at": "",
        "num_messages": num_messages, "char_count": 10, "preview": "", "full_text": "text",
        "cluster_id": 0, "region": "", "color": "", "x": 0.0, "y": 0.0,
    }


def _store(monkeypatch, existing, chats):
    fake = _FakeSupabase(existing)
    monkeypatch.setattr(database, "get_supabase", lambda: fake)
    report = database.store_conversations("u1", chats, np.zeros((len(chats), 384)))
    stored = {r["id"] for r in fake.upserts.get("knowledge_nodes", [])}
    embedded = {r["conversation_id"] for r in fake.upserts.get("embeddings", [])}
    return report, stored, embedded


def test_keeps_stored_copy_with_more_messages(monkeypatch):
    existing = [{"id": "a", "user_id": "u1", "num_messages": 12}]
    report, stored, embedded = _store(monkeypatch, existing, [_chat("a", 8), _chat("b", 3)])
    assert report["kept_newer_ids"] == ["a"]
    assert stored == embedded == {"b"}


def test_upload_wins_when_it_has_as_many_or_more_messages(monkeypatch):
    existing = [
        {"id": "same", "user_id": "u1", "num_messages": 8},
        {"id": "older", "user_id": "u1", "num_messages": 4},
    ]
    report, stored, _ = _store(monkeypatch, existing, [_chat("same", 8), _chat("older", 9)])
    assert report["kept_newer_ids"] == []
    assert stored == {"same", "older"}


def test_other_users_conversations_are_not_compared(monkeypatch):
    existing = [{"id": "a", "user_id": "someone_else", "num_messages": 50}]
    report, stored, _ = _store(monkeypatch, existing, [_chat("a", 2)])
    assert report["kept_newer_ids"] == []
    assert stored == {"a"}


def test_failed_check_falls_back_to_overwriting(monkeypatch):
    fake = _FakeSupabase([])

    def broken_select(*_a, **_k):
        raise RuntimeError("network down")

    real_table = fake.table

    def table(name):
        q = real_table(name)
        q.select = broken_select
        return q

    fake.table = table
    monkeypatch.setattr(database, "get_supabase", lambda: fake)
    report = database.store_conversations("u1", [_chat("a", 2)], np.zeros((1, 384)))
    assert report["kept_newer_ids"] == []
    assert {r["id"] for r in fake.upserts["knowledge_nodes"]} == {"a"}
