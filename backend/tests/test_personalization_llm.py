from services.personalization_llm import (
    merge_llm_profile_delta,
    queue_snippet_for_llm_extraction,
    should_run_llm_extraction,
    synthesis_is_stale,
    get_display_summary,
    get_quick_corrections,
    infer_profile_delta_llm,
    _parse_json_text,
)


def test_merge_llm_profile_delta_merges_domains():
    existing = {"domains": {"coding": {"confidence": 0.5, "last_observed_at": "2026-01-01T00:00:00+00:00"}}}
    delta = {"domains": {"coding": {"confidence": 0.9, "label": "Software engineering"}}}
    merged = merge_llm_profile_delta(existing, delta)
    assert merged["domains"]["coding"]["confidence"] >= 0.5
    assert merged["domains"]["coding"]["label"] == "Software engineering"


def test_queue_snippet_triggers_batch_threshold():
    profile = queue_snippet_for_llm_extraction({}, "one")
    profile = queue_snippet_for_llm_extraction(profile, "two")
    assert should_run_llm_extraction(profile) is False
    profile = queue_snippet_for_llm_extraction(profile, "three")
    assert should_run_llm_extraction(profile) is True


def test_infer_profile_delta_llm_without_api_key_falls_back():
    merged = infer_profile_delta_llm({}, "help me debug python fastapi api", api_key=None, force=True)
    assert merged.get("domains")


def test_get_display_summary_prefers_llm_synthesis():
    profile = {"llm_synthesized_summary": "building AI tools and applying to grad school"}
    assert "grad school" in get_display_summary(profile)


def test_get_quick_corrections_uses_llm_options():
    profile = {
        "llm_quick_corrections": [
            {"id": "startup", "label": "Mostly startup product work"},
            {"id": "phd", "label": "Mostly PhD applications"},
        ]
    }
    options = get_quick_corrections(profile)
    assert any(o["id"] == "startup" for o in options)
    assert any(o["id"] == "other" for o in options)


def test_synthesis_is_stale_without_timestamp():
    assert synthesis_is_stale({}) is True


def test_parse_json_text_ignores_trailing_explanation():
    raw = '{"ranked_ids": ["a", "b"]}\n\nI ranked "a" first because it matches the draft.'
    assert _parse_json_text(raw) == {"ranked_ids": ["a", "b"]}


def test_parse_json_text_handles_fenced_json():
    assert _parse_json_text('```json\n{"facts": ["x"]}\n```') == {"facts": ["x"]}


_CANDIDATES = [{"id": i, "title": i} for i in ("a", "b", "c", "d", "e", "f")]


def _rerank_with_reply(monkeypatch, reply):
    from services import personalization_llm
    monkeypatch.setattr(personalization_llm, "_haiku", lambda *a, **k: reply)
    return [c["id"] for c in personalization_llm.rerank_conversations_llm("draft", _CANDIDATES, "key", 5)]


def test_rerank_does_not_pad_with_unchosen_candidates(monkeypatch):
    assert _rerank_with_reply(monkeypatch, '{"ranked_ids": ["c"]}') == ["c"]


def test_rerank_can_return_nothing(monkeypatch):
    assert _rerank_with_reply(monkeypatch, '{"ranked_ids": []}') == []


def test_rewrite_about_me_queries(monkeypatch):
    from services import personalization_llm
    monkeypatch.setattr(personalization_llm, "_haiku",
                        lambda *a, **k: '{"queries": ["my gpa and grades", "my career goals", "", "x"]}')
    out = personalization_llm.rewrite_about_me_queries_llm("Should I pursue a masters?", "key", max_queries=3)
    assert out == ["my gpa and grades", "my career goals", "x"]


def test_rewrite_about_me_queries_without_key_or_on_failure(monkeypatch):
    from services import personalization_llm
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert personalization_llm.rewrite_about_me_queries_llm("Should I pursue a masters?", None) == []
    monkeypatch.setattr(personalization_llm, "_haiku", lambda *a, **k: "not json")
    assert personalization_llm.rewrite_about_me_queries_llm("Should I pursue a masters?", "key") == []


def test_rerank_falls_back_when_reply_is_unusable(monkeypatch):
    assert _rerank_with_reply(monkeypatch, "sorry, I can't") == ["a", "b", "c", "d", "e"]
    assert _rerank_with_reply(monkeypatch, '{"ranked_ids": ["zzz"]}') == ["a", "b", "c", "d", "e"]
