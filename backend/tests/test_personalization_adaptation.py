from services.personalization import apply_edit_feedback_adaptation, hybrid_score_conversations


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
