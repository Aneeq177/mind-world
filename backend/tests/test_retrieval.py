import sys
import types

import numpy as np

from services import retrieval
from services.retrieval import EXCERPT_GAP, build_excerpt, group_chunk_hits


def _hit(conv_id, sim, start=0, end=100, **extra):
    return {
        "conversation_id": conv_id,
        "similarity": sim,
        "start_char": start,
        "end_char": end,
        "chunk_text": f"chunk of {conv_id} at {start}",
        "title": f"Title {conv_id}",
        **extra,
    }


def test_group_scores_conversation_by_best_chunk():
    hits = [_hit("a", 0.40), _hit("b", 0.55), _hit("a", 0.60, 900, 1700)]
    grouped = group_chunk_hits(hits)
    assert [c["id"] for c in grouped] == ["a", "b"]
    assert grouped[0]["similarity"] == 0.60
    assert grouped[0]["snippet"] == "chunk of a at 900"
    assert len(grouped[0]["matched"]) == 2


def test_group_gives_small_bonus_for_multiple_matching_chunks():
    hits = [_hit("single", 0.500)] + [_hit("multi", 0.495, i * 800, i * 800 + 800) for i in range(3)]
    grouped = group_chunk_hits(hits)
    assert grouped[0]["id"] == "multi"
    assert grouped[0]["similarity"] == 0.495


def test_group_keeps_conversation_metadata():
    hits = [_hit("a", 0.5, preview="opening", created_at="2026-01-01", user_id="u1")]
    conv = group_chunk_hits(hits)[0]
    assert (conv["title"], conv["preview"], conv["created_at"], conv["user_id"]) == (
        "Title a", "opening", "2026-01-01", "u1"
    )


def test_excerpt_without_matches_is_the_opening():
    text = "x" * 5000
    assert build_excerpt(text, None) == text[:3000]


def test_excerpt_includes_opening_and_deep_match_in_order():
    text = "OPENING " + "a" * 2000 + " DEEPMATCH " + "b" * 3000
    deep = text.index("DEEPMATCH")
    excerpt = build_excerpt(text, [{"start_char": deep, "end_char": deep + 200, "similarity": 0.7}])
    assert excerpt.startswith("OPENING")
    assert "DEEPMATCH" in excerpt
    assert EXCERPT_GAP in excerpt
    assert excerpt.index("OPENING") < excerpt.index("DEEPMATCH")


def test_excerpt_respects_budget():
    text = "w " * 20000
    matched = [{"start_char": i * 800, "end_char": i * 800 + 800, "similarity": 0.5 - i * 0.01}
               for i in range(1, 20)]
    excerpt = build_excerpt(text, matched, budget=3000)
    assert len(excerpt.replace(EXCERPT_GAP, "")) <= 3000


def test_excerpt_merges_overlapping_spans():
    text = "".join(chr(97 + i % 26) for i in range(4000))
    matched = [
        {"start_char": 1000, "end_char": 1800, "similarity": 0.6},
        {"start_char": 1650, "end_char": 2450, "similarity": 0.5},
    ]
    excerpt = build_excerpt(text, matched)
    assert excerpt.count(EXCERPT_GAP) == 1
    assert text[1000:2450] in excerpt


def test_excerpt_clips_stale_spans_past_end_of_text():
    text = "short text"
    assert build_excerpt(text, [{"start_char": 500, "end_char": 900, "similarity": 0.5}]) == text


def _fake_db(monkeypatch, search_chunks):
    db = types.ModuleType("services.database")
    db.search_chunks = search_chunks
    db.search_conversations_candidates = lambda user_id, emb, limit: [{"id": "whole"}]
    monkeypatch.setitem(sys.modules, "services.database", db)


def test_retrieve_falls_back_when_flag_off(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "baseline")
    calls = {}
    _fake_db(monkeypatch, lambda *a: calls.setdefault("chunks", True))
    assert retrieval.retrieve_candidates("u", np.zeros(384), 15) == [{"id": "whole"}]
    assert "chunks" not in calls


def test_retrieve_uses_chunks_when_enabled(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")
    _fake_db(monkeypatch, lambda *a: [_hit("a", 0.6), _hit("b", 0.5)])
    out = retrieval.retrieve_candidates("u", np.zeros(384), 1)
    assert [c["id"] for c in out] == ["a"]


def test_retrieve_falls_back_when_user_has_no_chunks(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")
    _fake_db(monkeypatch, lambda *a: [])
    assert retrieval.retrieve_candidates("u", np.zeros(384), 15) == [{"id": "whole"}]


def test_retrieve_falls_back_when_chunk_search_errors(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")

    def boom(*a):
        raise RuntimeError("function match_chunks does not exist")

    _fake_db(monkeypatch, boom)
    assert retrieval.retrieve_candidates("u", np.zeros(384), 15) == [{"id": "whole"}]
