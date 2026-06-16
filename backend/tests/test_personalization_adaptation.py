from services.personalization import (
    apply_edit_feedback_adaptation,
    hybrid_score_conversations,
    build_inferred_summary,
    compute_summary_confidence,
    has_enough_history,
    should_prompt_confirmation,
    apply_summary_confirmation,
    build_fallback_structured_questions,
    normalize_structured_questions,
    extract_confirmed_anchor_facts,
)


def test_apply_edit_feedback_adaptation_tracks_unedited_accepts():
    profile = {"adaptive_weights": {"detail_level": 0.5, "concise_bias": 0.5}}
    out = apply_edit_feedback_adaptation(
        profile,
        {"normalized_edit_distance": 0.0, "engineered_length": 650},
        accepted_unedited=True,
    )
    quality = out.get("quality_metrics", {})
    assert quality.get("feedback_count") == 1
    assert quality.get("unedited_accept_count") == 1
    assert out["adaptive_weights"]["detail_level"] >= 0.5


def test_hybrid_score_uses_adaptive_retrieval_boosts():
    conversations = [
        {"id": "1", "title": "Recent note", "preview": "python api", "similarity": 0.55, "created_at": "2026-06-15T00:00:00+00:00"},
        {"id": "2", "title": "Old note", "preview": "python api", "similarity": 0.55, "created_at": "2020-01-01T00:00:00+00:00"},
    ]
    profile = {
        "domains": {"coding": {"confidence": 0.9, "last_observed_at": "2026-06-15T00:00:00+00:00"}},
        "adaptive_weights": {"retrieval_recency_boost": 1.2, "retrieval_domain_boost": 1.2},
    }
    ranked = hybrid_score_conversations(conversations, "python api help", profile)
    assert ranked[0]["id"] == "1"


def test_build_inferred_summary_from_domains():
    profile = {
        "domains": {
            "coding": {"confidence": 0.9, "last_observed_at": "2026-06-15T00:00:00+00:00"},
            "education": {"confidence": 0.8, "last_observed_at": "2026-06-15T00:00:00+00:00"},
        }
    }
    summary = build_inferred_summary(profile)
    assert "software engineering" in summary
    assert "school" in summary


def test_has_enough_history_requires_count_and_confidence():
    profile = {
        "domains": {
            "coding": {"confidence": 0.9, "last_observed_at": "2026-06-15T00:00:00+00:00"},
        }
    }
    assert has_enough_history(10, profile) is True
    assert has_enough_history(3, profile) is False


def test_apply_summary_confirmation_persists_user_correction():
    profile = {"domains": {}}
    updated = apply_summary_confirmation(profile, "correct", ["coding", "education"])
    anchors = updated.get("confirmed_anchors") or {}
    assert "coding" in anchors.get("domains", [])
    assert anchors.get("summary")
    assert updated["domains"]["coding"]["user_verified"] is True


def test_normalize_structured_questions_supports_legacy_strings():
    out = normalize_structured_questions(["What language?", "What outcome?"])
    assert len(out) == 2
    assert out[0]["options"]
    assert out[0]["allow_other"] is True


def test_build_fallback_structured_questions_for_coding_goal():
    questions = build_fallback_structured_questions("help debug my python api", {})
    assert questions
    assert any(q["id"] == "stack" for q in questions)


def test_extract_confirmed_anchor_facts():
    profile = {"confirmed_anchors": {"summary": "software engineering and grad school applications"}}
    facts = extract_confirmed_anchor_facts(profile)
    assert facts
    assert "User-verified" in facts[0]


def test_should_prompt_confirmation_when_unconfirmed():
    profile = {"domains": {"coding": {"confidence": 0.9, "last_observed_at": "2026-06-15T00:00:00+00:00"}}}
    assert should_prompt_confirmation(profile) is True
    profile["confirmed_anchors"] = {
        "confirmed_at": "2026-06-15T00:00:00+00:00",
        "domains": ["coding"],
    }
    assert should_prompt_confirmation(profile) is False
