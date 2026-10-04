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


def _fake_db(monkeypatch, search_chunks, search_keyword_chunks=lambda *a: []):
    db = types.ModuleType("services.database")
    db.search_chunks = search_chunks
    db.search_keyword_chunks = search_keyword_chunks
    db.search_conversations_candidates = lambda user_id, emb, limit: [{"id": "whole"}]
    monkeypatch.setitem(sys.modules, "services.database", db)


def _kw(conv_id, score, start=0, end=100, sim=0.40):
    return {"conversation_id": conv_id, "keyword_score": score, "similarity": sim, "start_char": start,
            "end_char": end, "chunk_text": f"kw chunk of {conv_id}", "title": f"Title {conv_id}"}


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


def test_cutoff_drops_weak_and_far_behind_candidates():
    cands = [{"id": "top", "similarity": 0.70}, {"id": "near", "similarity": 0.50},
             {"id": "far", "similarity": 0.40}, {"id": "weak", "similarity": 0.30}]
    assert [c["id"] for c in retrieval.apply_relevance_cutoff(cands)] == ["top", "near"]


def test_cutoff_floor_applies_when_everything_is_weak():
    cands = [{"id": "a", "similarity": 0.33}, {"id": "b", "similarity": 0.30}]
    assert retrieval.apply_relevance_cutoff(cands) == []


def test_retrieve_returns_empty_without_fallback_when_nothing_relevant(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")
    _fake_db(monkeypatch, lambda *a: [_hit("a", 0.25), _hit("b", 0.20)])
    assert retrieval.retrieve_candidates("u", np.zeros(384), 15) == []


def test_retrieve_falls_back_when_user_has_no_chunks(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")
    _fake_db(monkeypatch, lambda *a: [])
    assert retrieval.retrieve_candidates("u", np.zeros(384), 15) == [{"id": "whole"}]


def test_keyword_match_rescues_conversation_below_vector_cutoff(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")
    _fake_db(monkeypatch,
             lambda *a: [_hit("vec", 0.6), _hit("exact_term", 0.30)],
             lambda *a: [_kw("exact_term", 0.8, 900, 1700)])
    out = retrieval.retrieve_candidates("u", np.zeros(384), 15, query_text="CrashLoopBackOff")
    assert {c["id"] for c in out} == {"vec", "exact_term"}
    rescued = next(c for c in out if c["id"] == "exact_term")
    assert rescued["snippet"] == "kw chunk of exact_term"
    assert rescued["similarity"] == 0.40
    assert rescued["keyword_score"] == 0.8
    assert {"start_char": 900, "end_char": 1700, "similarity": 0.40} in rescued["matched"]


def test_weak_keyword_match_does_not_qualify(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")
    _fake_db(monkeypatch, lambda *a: [_hit("vec", 0.6)], lambda *a: [_kw("weak", 0.2)])
    out = retrieval.retrieve_candidates("u", np.zeros(384), 15, query_text="anything")
    assert [c["id"] for c in out] == ["vec"]


def test_keyword_match_without_related_meaning_does_not_qualify(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")
    _fake_db(monkeypatch, lambda *a: [_hit("vec", 0.6)], lambda *a: [_kw("same_words", 1.0, sim=0.15)])
    out = retrieval.retrieve_candidates("u", np.zeros(384), 15, query_text="2 days in new york")
    assert [c["id"] for c in out] == ["vec"]


def test_found_both_ways_ranks_first():
    vector = group_chunk_hits([_hit("v_only", 0.70), _hit("both", 0.65)])
    keyword = retrieval.group_keyword_hits([_kw("both", 0.9), _kw("k_only", 0.8)])
    merged = retrieval.merge_hybrid([vector], [keyword])
    assert merged[0]["id"] == "both"
    assert next(c for c in merged if c["id"] == "k_only")["similarity"] == 0.40


def test_per_list_cap_lets_each_query_contribute():
    generic = group_chunk_hits([_hit(f"g{i}", 0.60 - i * 0.01) for i in range(10)])
    pinpoint = group_chunk_hits([_hit("g0", 0.5), _hit("g1", 0.49), _hit("fact", 0.45)])
    ids = [c["id"] for c in retrieval.merge_hybrid([generic, pinpoint], [], per_list_cap=3)]
    assert "fact" in ids
    assert "g9" not in ids


def test_keyword_failure_falls_back_to_vector_only(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")

    def kw_boom(*a):
        raise RuntimeError("function match_keyword_chunks does not exist")

    _fake_db(monkeypatch, lambda *a: [_hit("a", 0.6)], kw_boom)
    assert [c["id"] for c in retrieval.retrieve_candidates("u", np.zeros(384), 15, query_text="q")] == ["a"]


def test_multi_query_fuses_queries_and_uses_looser_floor(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")
    results = iter([[_hit("a", 0.50)], [_hit("b", 0.33), _hit("a", 0.55)]])
    _fake_db(monkeypatch, lambda *a: next(results))
    out = retrieval.retrieve_candidates_multi(
        "u", ["q1", "q2"], [np.zeros(384), np.ones(384)], 15,
        min_similarity=retrieval.ABOUT_ME_MIN_SIMILARITY, use_keywords=False,
    )
    assert [c["id"] for c in out] == ["a", "b"]
    assert out[0]["similarity"] == 0.55


def test_memory_route():
    profile_with_facts = {"is_profile_enabled": True, "profile_data": {"background": "CS student at UT"}}
    assert retrieval.memory_route("fix my docker install", profile_with_facts) == "standard"
    assert retrieval.memory_route("Should I pursue a masters?", profile_with_facts) == "profile"
    assert retrieval.memory_route("Should I pursue a masters?", {**profile_with_facts, "is_profile_enabled": False}) == "rewrite"
    assert retrieval.memory_route("Should I pursue a masters?", {"is_profile_enabled": True, "profile_data": {}}) == "rewrite"
    assert retrieval.memory_route("Should I pursue a masters?", None) == "rewrite"


def test_retrieve_falls_back_when_chunk_search_errors(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")

    def boom(*a):
        raise RuntimeError("function match_chunks does not exist")

    _fake_db(monkeypatch, boom)
    assert retrieval.retrieve_candidates("u", np.zeros(384), 15) == [{"id": "whole"}]


def test_stats_report_chunk_search(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")
    _fake_db(monkeypatch, lambda *a: [_hit("a", 0.6)], lambda *a: [_kw("a", 0.8)])
    stats = {}
    retrieval.retrieve_candidates("u", np.zeros(384), 15, query_text="q", stats=stats)
    assert (stats["search"], stats["fallback"], stats["keywords"]) == ("chunks", None, "used")
    assert isinstance(stats["ms"], int)


def test_stats_and_log_report_chunk_search_failure(monkeypatch, capsys):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")

    def timeout(*a):
        raise TimeoutError("statement timeout")

    _fake_db(monkeypatch, timeout)
    stats = {}
    retrieval.retrieve_candidates("u", np.zeros(384), 15, query_text="q", stats=stats)
    assert (stats["search"], stats["fallback"], stats["keywords"]) == ("conversations", "error", "off")
    assert "statement timeout" in stats["error"]
    assert "[retrieval] fallback=error user=u" in capsys.readouterr().out


def test_stats_report_user_without_chunks(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")
    _fake_db(monkeypatch, lambda *a: [])
    stats = {}
    retrieval.retrieve_candidates("u", np.zeros(384), 15, stats=stats)
    assert (stats["search"], stats["fallback"]) == ("conversations", "no_chunks")


def test_stats_report_keyword_failure(monkeypatch, capsys):
    monkeypatch.setenv("RETRIEVAL_MODE", "chunked")

    def kw_boom(*a):
        raise TimeoutError("read timed out")

    _fake_db(monkeypatch, lambda *a: [_hit("a", 0.6)], kw_boom)
    stats = {}
    retrieval.retrieve_candidates("u", np.zeros(384), 15, query_text="q", stats=stats)
    assert (stats["search"], stats["fallback"], stats["keywords"]) == ("chunks", None, "failed")
    assert "[retrieval] keyword_failed user=u" in capsys.readouterr().out


def test_stats_report_disabled_mode_without_logging(monkeypatch, capsys):
    monkeypatch.setenv("RETRIEVAL_MODE", "baseline")
    _fake_db(monkeypatch, lambda *a: [])
    stats = {}
    retrieval.retrieve_candidates("u", np.zeros(384), 15, stats=stats)
    assert (stats["search"], stats["fallback"]) == ("conversations", "disabled")
    assert "[retrieval]" not in capsys.readouterr().out


def test_chunks_store_their_own_text_for_long_conversations(monkeypatch):
    from services import database
    from services.chunker import chunk_spans

    inserted = []

    class FakeQuery:
        def __init__(self, table):
            self.table = table

        def insert(self, rows):
            if self.table == "conversation_chunks":
                inserted.extend(rows)
            return self

        def __getattr__(self, name):
            return lambda *a, **k: self

    class FakeClient:
        def table(self, name):
            return FakeQuery(name)

    monkeypatch.setattr(database, "get_supabase", lambda *a, **k: FakeClient())
    full_text = "".join(f"message {i} — naïve café 🚀 " for i in range(30000))
    spans = chunk_spans(full_text)
    database.replace_conversation_chunks("c", "u", full_text, spans, np.zeros((len(spans), 384)), "h")
    assert len(inserted) == len(spans) > 1000
    for row, (s, e) in zip(inserted, spans):
        assert row["chunk_text"] == full_text[s:e]
