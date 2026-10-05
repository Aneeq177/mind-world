"""Local-mode endpoints must not touch stored content and must not log request bodies."""
import logging

import pytest
from fastapi.testclient import TestClient

import main
from services import database, engineer_core

SECRET_DRAFT = "SENTINEL-DRAFT-7f3a my divorce lawyer said"
SECRET_EXCERPT = "SENTINEL-EXCERPT-91bc private medical history"
HEADERS = {"X-MW-Client": main.MW_CLIENT_SECRET}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setattr(main, "_user_id", lambda email, token=None, key=None: "user-1")
    monkeypatch.setattr(main, "_check_improve_quota", lambda user_id, device_id: {"improve_calls_used": 0})
    charged = []
    monkeypatch.setattr(main, "_charge_improve_quota", lambda user_id, row: charged.append(user_id))
    monkeypatch.setattr(database, "log_growth_event", lambda *a, **k: None)
    monkeypatch.setattr(database, "get_prompt_template_by_name", lambda name: None)

    def no_db(*_a, **_k):
        raise AssertionError("stateless endpoint touched the database")

    monkeypatch.setattr(database, "get_supabase", no_db)
    monkeypatch.setattr(database, "get_personal_profile", no_db)
    c = TestClient(main.app, base_url="https://testserver")
    c.charged = charged
    return c


def _assert_not_logged(capsys, caplog):
    out = capsys.readouterr()
    logged = out.out + out.err + caplog.text
    assert "SENTINEL" not in logged


def test_engineer_stateless_uses_shared_core_and_stores_nothing(client, monkeypatch, capsys, caplog):
    caplog.set_level(logging.DEBUG)
    seen = {}

    def fake_select(draft, candidates, profile, api_key, route):
        seen["candidates"] = candidates
        return candidates[:1], ["User prefers concise answers."]

    def fake_run(system, user, max_tokens, api_key):
        seen["user"] = user
        return "ENGINEERED"

    monkeypatch.setattr(engineer_core, "select_memory", fake_select)
    monkeypatch.setattr(engineer_core, "run_engineer", fake_run)

    res = client.post("/engineer_prompt_stateless", headers=HEADERS, json={
        "email": "a@b.co", "access_token": "t", "message": SECRET_DRAFT,
        "candidates": [{"id": "c1", "title": "Chat", "snippet": "s", "excerpt": SECRET_EXCERPT,
                        "created_at": "2026-01-01", "num_messages": 2, "similarity": 0.6}],
        "profile": {"is_profile_enabled": True, "profile_data": {}},
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["engineered_prompt"] == "ENGINEERED"
    assert body["conversations_used"] == 1
    assert body["memory"] == {"status": "used", "storage": "local"}
    assert SECRET_EXCERPT in seen["user"] and "User prefers concise answers." in seen["user"]
    assert client.charged == ["user-1"]
    _assert_not_logged(capsys, caplog)


def test_engineer_stateless_reports_device_memory_status(client, monkeypatch):
    monkeypatch.setattr(engineer_core, "run_engineer", lambda *a: "P")
    monkeypatch.setattr(engineer_core, "build_profile_context", lambda *a: ("", {}))
    res = client.post("/engineer_prompt_stateless", headers=HEADERS, json={
        "email": "a@b.co", "access_token": "t", "message": "hi", "memory_status": "no_data",
    })
    assert res.json()["memory"]["status"] == "no_data"


def test_engineer_stateless_requires_client_header(client):
    res = client.post("/engineer_prompt_stateless", json={"email": "a@b.co", "access_token": "t", "message": "x"})
    assert res.status_code == 401


def test_engineer_stateless_errors_do_not_echo_content(client, monkeypatch, capsys, caplog):
    caplog.set_level(logging.DEBUG)

    def boom(*_a, **_k):
        raise RuntimeError(SECRET_DRAFT)

    monkeypatch.setattr(engineer_core, "run_engineer", boom)
    monkeypatch.setattr(engineer_core, "build_profile_context", lambda *a: ("", {}))
    res = client.post("/engineer_prompt_stateless", headers=HEADERS, json={
        "email": "a@b.co", "access_token": "t", "message": SECRET_DRAFT,
    })
    assert res.status_code == 500
    assert "SENTINEL" not in res.text
    _assert_not_logged(capsys, caplog)


def test_profile_infer_stateless_returns_updated_profile(client, monkeypatch, capsys, caplog):
    import services.personalization_llm as pl

    monkeypatch.setattr(pl, "infer_profile_delta_llm", lambda data, snippet, key: {**data, "seen": len(snippet)})
    res = client.post("/profile/infer_stateless", headers=HEADERS, json={
        "email": "a@b.co", "access_token": "t", "op": "extract",
        "profile_data": {"domains": {}}, "snippet": SECRET_EXCERPT,
    })
    assert res.status_code == 200, res.text
    assert res.json()["profile_data"]["seen"] == len(SECRET_EXCERPT)
    _assert_not_logged(capsys, caplog)


def test_profile_infer_rejects_unknown_op(client):
    res = client.post("/profile/infer_stateless", headers=HEADERS, json={
        "email": "a@b.co", "access_token": "t", "op": "store_everything",
    })
    assert res.status_code == 422


def test_candidate_text_is_clamped():
    from services.retrieval import EXCERPT_CHARS, SNIPPET_CHARS

    cand = main.StatelessCandidate(id="x", snippet="s" * 5000, excerpt="e" * 50000)
    assert len(cand.snippet) == SNIPPET_CHARS
    assert len(cand.excerpt) <= EXCERPT_CHARS + 200


def test_engineer_prompts_serves_prompt_file(client):
    res = client.get("/engineer_prompts")
    assert res.status_code == 200
    assert res.json()["version"] == engineer_core.load_prompts()["version"]
