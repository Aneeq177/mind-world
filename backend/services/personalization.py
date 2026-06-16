"""Lightweight personalization inference and scoring helpers."""

from __future__ import annotations

from datetime import datetime, timezone
import math
import re
from typing import Any


MAX_SNIPPET_CHARS = 2000
MIN_DOMAIN_CONFIDENCE = 0.35
MIN_FACT_CONFIDENCE = 0.6
PROFILE_FACT_CAP = 6
STALE_HALF_LIFE_DAYS = 45.0

DOMAIN_PATTERNS: dict[str, list[str]] = {
    "career": [
        "resume",
        "cv",
        "job",
        "interview",
        "application",
        "linkedin",
        "internship",
    ],
    "education": [
        "essay",
        "assignment",
        "homework",
        "research paper",
        "university",
        "college",
        "scholarship",
    ],
    "coding": [
        "python",
        "javascript",
        "typescript",
        "react",
        "fastapi",
        "debug",
        "api",
        "sql",
    ],
    "writing": [
        "rewrite",
        "tone",
        "email",
        "blog",
        "article",
        "copy",
        "draft",
    ],
}

STYLE_PATTERNS: dict[str, list[str]] = {
    "concise": ["concise", "brief", "short", "keep it short"],
    "step_by_step": ["step-by-step", "step by step", "walk me through"],
    "examples": ["example", "sample output", "show me an example"],
    "formal_tone": ["formal", "professional tone"],
}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _extract_projects(text: str) -> list[str]:
    # Lightweight extraction: "project x", "building x", "working on x"
    hits = set()
    patterns = [
        r"(?:project|building|working on)\s+([a-z0-9][a-z0-9 _\-]{2,40})",
        r"(?:for|on)\s+(?:my|the)\s+([a-z0-9][a-z0-9 _\-]{2,40})\s+(?:project|app|tool)",
    ]
    lowered = text.lower()
    for pat in patterns:
        for match in re.findall(pat, lowered):
            cleaned = re.sub(r"\s+", " ", match).strip(" -_")
            if 3 <= len(cleaned) <= 40:
                hits.add(cleaned)
    return sorted(hits)[:4]


def infer_profile_delta(
    existing_profile_data: dict[str, Any] | None,
    conversation_delta_text: str,
) -> dict[str, Any]:
    profile = dict(existing_profile_data or {})
    domains = dict(profile.get("domains") or {})
    preferences = dict(profile.get("preferences") or {})
    active_projects = list(profile.get("active_projects") or [])

    snippet = (conversation_delta_text or "")[:MAX_SNIPPET_CHARS]
    lowered = snippet.lower()
    now = _utcnow_iso()

    # Domain confidence updates
    for domain, keywords in DOMAIN_PATTERNS.items():
        hits = sum(1 for kw in keywords if kw in lowered)
        if hits <= 0:
            continue
        prior = domains.get(domain, {})
        prev_conf = float(prior.get("confidence", 0.0) or 0.0)
        # Increase quickly for repeated signals, bounded [0,1]
        bump = min(0.30, 0.08 * hits)
        conf = max(prev_conf, min(1.0, prev_conf * 0.85 + bump))
        domains[domain] = {
            "expertise_level": prior.get("expertise_level", "unknown"),
            "confidence": round(conf, 3),
            "last_observed_at": now,
            "evidence_count": int(prior.get("evidence_count", 0) or 0) + hits,
        }

    # Preference signals
    for pref_key, markers in STYLE_PATTERNS.items():
        hits = sum(1 for marker in markers if marker in lowered)
        if hits <= 0:
            continue
        prior = preferences.get(pref_key, {})
        prev_conf = float(prior.get("confidence", 0.0) or 0.0)
        conf = max(prev_conf, min(1.0, prev_conf * 0.8 + (0.12 * hits)))
        preferences[pref_key] = {
            "value": True,
            "confidence": round(conf, 3),
            "last_observed_at": now,
        }

    # Active projects
    inferred_projects = _extract_projects(snippet)
    existing_map = {str(p.get("name", "")).lower(): p for p in active_projects if isinstance(p, dict)}
    for proj in inferred_projects:
        prior = existing_map.get(proj, {})
        prev_conf = float(prior.get("confidence", 0.0) or 0.0)
        existing_map[proj] = {
            "name": proj,
            "confidence": round(max(prev_conf, min(1.0, prev_conf * 0.75 + 0.2)), 3),
            "last_observed_at": now,
        }
    active_projects = sorted(existing_map.values(), key=lambda x: float(x.get("confidence", 0.0)), reverse=True)[:8]

    profile["domains"] = domains
    profile["preferences"] = preferences
    profile["active_projects"] = active_projects
    profile["last_observed_at"] = now
    return profile


def decay_confidence(confidence: float, last_observed_at: str | None) -> float:
    ts = _parse_ts(last_observed_at)
    if not ts:
        return float(confidence)
    age_days = max(0.0, (datetime.now(timezone.utc) - ts).total_seconds() / 86400.0)
    # Exponential half-life decay.
    decay = math.pow(0.5, age_days / STALE_HALF_LIFE_DAYS)
    return max(0.0, min(1.0, float(confidence) * decay))


def extract_relevant_profile_facts(
    profile_data: dict[str, Any] | None,
    query: str,
    min_confidence: float = MIN_FACT_CONFIDENCE,
    max_facts: int = PROFILE_FACT_CAP,
) -> list[str]:
    query_l = (query or "").lower()
    facts: list[tuple[float, str]] = []
    data = profile_data or {}

    for domain, info in (data.get("domains") or {}).items():
        conf = decay_confidence(float(info.get("confidence", 0.0) or 0.0), info.get("last_observed_at"))
        if conf < max(min_confidence, MIN_DOMAIN_CONFIDENCE):
            continue
        if domain in query_l or any(k in query_l for k in DOMAIN_PATTERNS.get(domain, [])):
            facts.append((conf, f"User often asks about {domain} topics ({int(conf * 100)}% confidence)."))

    for pref, info in (data.get("preferences") or {}).items():
        conf = decay_confidence(float(info.get("confidence", 0.0) or 0.0), info.get("last_observed_at"))
        if not info.get("value") or conf < min_confidence:
            continue
        if pref == "concise":
            facts.append((conf, "User usually prefers concise responses."))
        elif pref == "step_by_step":
            facts.append((conf, "User values step-by-step guidance."))
        elif pref == "examples":
            facts.append((conf, "User often asks for concrete examples."))
        elif pref == "formal_tone":
            facts.append((conf, "User tends to prefer a professional tone."))

    for proj in (data.get("active_projects") or []):
        name = str(proj.get("name", "")).strip()
        conf = decay_confidence(float(proj.get("confidence", 0.0) or 0.0), proj.get("last_observed_at"))
        if not name or conf < min_confidence:
            continue
        if name.lower() in query_l or any(token in query_l for token in name.lower().split()):
            facts.append((conf, f"Active project context: {name}."))

    facts.sort(key=lambda x: x[0], reverse=True)
    return [fact for _, fact in facts[:max_facts]]


def hybrid_score_conversations(
    conversations: list[dict[str, Any]],
    query: str,
    profile_data: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    query_l = (query or "").lower()
    projects = [str(p.get("name", "")).lower() for p in (profile_data or {}).get("active_projects", []) if isinstance(p, dict)]
    domain_weights = {
        name: decay_confidence(float(item.get("confidence", 0.0) or 0.0), item.get("last_observed_at"))
        for name, item in ((profile_data or {}).get("domains") or {}).items()
    }

    now = datetime.now(timezone.utc)
    reranked: list[dict[str, Any]] = []
    adaptive_weights = ((profile_data or {}).get("adaptive_weights") or {})
    recency_boost = max(0.8, min(1.2, float(adaptive_weights.get("retrieval_recency_boost", 1.0) or 1.0)))
    domain_boost = max(0.8, min(1.2, float(adaptive_weights.get("retrieval_domain_boost", 1.0) or 1.0)))

    for conv in conversations:
        sim = float(conv.get("similarity", 0.0) or 0.0)
        created_at = _parse_ts(conv.get("created_at"))
        age_days = (now - created_at).total_seconds() / 86400.0 if created_at else 365.0
        recency = math.exp(-age_days / 45.0)

        text = f"{conv.get('title', '')} {conv.get('preview', '')}".lower()
        project_match = 1.0 if any(p and p in text for p in projects if len(p) >= 3) else 0.0
        domain_match = 0.0
        for domain, weight in domain_weights.items():
            if domain in query_l and domain in text:
                domain_match = max(domain_match, weight)
            elif any(k in query_l and k in text for k in DOMAIN_PATTERNS.get(domain, [])):
                domain_match = max(domain_match, weight)

        hybrid = (sim * 0.75) + (recency * (0.15 * recency_boost)) + (domain_match * (0.07 * domain_boost)) + (project_match * 0.03)
        enriched = dict(conv)
        enriched["hybrid_score"] = round(hybrid, 6)
        enriched["recency_score"] = round(recency, 6)
        reranked.append(enriched)

    reranked.sort(key=lambda c: c.get("hybrid_score", 0.0), reverse=True)
    return reranked


def apply_edit_feedback_adaptation(
    profile_data: dict[str, Any] | None,
    diff_metrics: dict[str, Any] | None,
    accepted_unedited: bool,
) -> dict[str, Any]:
    """
    Lightweight online adaptation from prompt edit signals.
    Only coarse weights are updated to stay privacy-safe.
    """
    profile = dict(profile_data or {})
    adaptive = dict(profile.get("adaptive_weights") or {})
    quality = dict(profile.get("quality_metrics") or {})
    now = _utcnow_iso()

    norm_distance = float((diff_metrics or {}).get("normalized_edit_distance", 0.0) or 0.0)
    prompt_len = int((diff_metrics or {}).get("engineered_length", 0) or 0)

    # EMA update for edit trend.
    prev_trend = float(quality.get("ema_normalized_edit_distance", 0.0) or 0.0)
    quality["ema_normalized_edit_distance"] = round((prev_trend * 0.8) + (norm_distance * 0.2), 6)
    quality["last_feedback_at"] = now

    total = int(quality.get("feedback_count", 0) or 0) + 1
    unedited = int(quality.get("unedited_accept_count", 0) or 0) + (1 if accepted_unedited else 0)
    quality["feedback_count"] = total
    quality["unedited_accept_count"] = unedited
    quality["unedited_accept_rate"] = round(unedited / max(1, total), 6)

    # Adapt formatting/detail preference weight.
    detail_weight = float(adaptive.get("detail_level", 0.5) or 0.5)
    if accepted_unedited:
        detail_weight = min(1.0, detail_weight + 0.03)
    elif norm_distance > 0.35:
        detail_weight = max(0.0, detail_weight - 0.05)
    elif norm_distance < 0.12:
        detail_weight = min(1.0, detail_weight + 0.02)

    concise_bias = float(adaptive.get("concise_bias", 0.5) or 0.5)
    if prompt_len > 900 and norm_distance > 0.25:
        concise_bias = min(1.0, concise_bias + 0.05)
    elif prompt_len < 400 and norm_distance > 0.25:
        concise_bias = max(0.0, concise_bias - 0.04)

    recency_boost = float(adaptive.get("retrieval_recency_boost", 1.0) or 1.0)
    domain_boost = float(adaptive.get("retrieval_domain_boost", 1.0) or 1.0)
    if accepted_unedited:
        recency_boost = min(1.2, recency_boost + 0.01)
        domain_boost = min(1.2, domain_boost + 0.01)
    else:
        recency_boost = max(0.8, recency_boost - 0.01)
        domain_boost = max(0.8, domain_boost - 0.005)

    adaptive["detail_level"] = round(detail_weight, 4)
    adaptive["concise_bias"] = round(concise_bias, 4)
    adaptive["retrieval_recency_boost"] = round(recency_boost, 4)
    adaptive["retrieval_domain_boost"] = round(domain_boost, 4)
    adaptive["last_updated_at"] = now

    profile["adaptive_weights"] = adaptive
    profile["quality_metrics"] = quality
    profile["last_observed_at"] = now
    return profile
