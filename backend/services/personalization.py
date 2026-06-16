"""Lightweight personalization inference and scoring helpers."""

from __future__ import annotations

from datetime import datetime, timezone
import json
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

DOMAIN_LABELS: dict[str, str] = {
    "career": "job applications and career growth",
    "education": "school and academic work",
    "coding": "software engineering",
    "writing": "writing and communication",
}

QUICK_CORRECTION_OPTIONS: list[dict[str, str]] = [
    {"id": "coding", "label": "Mostly software engineering"},
    {"id": "education", "label": "Mostly school / academics"},
    {"id": "career", "label": "Mostly job search & career"},
    {"id": "writing", "label": "Mostly writing & communication"},
    {"id": "other", "label": "Something else"},
]

MIN_HISTORY_CONVERSATIONS = 8
MIN_SUMMARY_CONFIDENCE = 0.45
CONFIRMATION_STALE_DAYS = 30


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return {}
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return {}


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return []
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass
    return []


def normalize_profile_data(raw: Any) -> dict[str, Any]:
    """Coerce profile_data from DB/API into a safe dict shape."""
    if isinstance(raw, str):
        raw = _as_mapping(raw) or {}
    if not isinstance(raw, dict):
        return {}
    profile = dict(raw)
    profile["domains"] = _as_mapping(profile.get("domains"))
    profile["preferences"] = _as_mapping(profile.get("preferences"))
    profile["active_projects"] = _as_list(profile.get("active_projects"))
    profile["confirmed_anchors"] = _as_mapping(profile.get("confirmed_anchors"))
    profile["adaptive_weights"] = _as_mapping(profile.get("adaptive_weights"))
    profile["quality_metrics"] = _as_mapping(profile.get("quality_metrics"))
    profile["constraints"] = _as_list(profile.get("constraints"))
    profile["llm_pending_snippets"] = _as_list(profile.get("llm_pending_snippets"))
    return profile


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
        # Normalize legacy naive timestamps to UTC so subtraction
        # with timezone-aware "now" never raises type errors.
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts
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
    profile = normalize_profile_data(existing_profile_data)
    domains = dict(_as_mapping(profile.get("domains")))
    preferences = dict(_as_mapping(profile.get("preferences")))
    active_projects = list(_as_list(profile.get("active_projects")))

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


def get_top_domains(
    profile_data: dict[str, Any] | None,
    min_confidence: float = MIN_DOMAIN_CONFIDENCE,
    max_domains: int = 3,
) -> list[tuple[str, float]]:
    ranked: list[tuple[str, float]] = []
    data = normalize_profile_data(profile_data)
    for domain, info in _as_mapping(data.get("domains")).items():
        if not isinstance(info, dict):
            continue
        conf = decay_confidence(
            float(info.get("confidence", 0.0) or 0.0),
            info.get("last_observed_at"),
        )
        if conf >= min_confidence:
            ranked.append((domain, conf))
    ranked.sort(key=lambda item: item[1], reverse=True)
    return ranked[:max_domains]


def compute_summary_confidence(profile_data: dict[str, Any] | None) -> float:
    data = normalize_profile_data(profile_data)
    llm_conf = float(data.get("llm_summary_confidence", 0.0) or 0.0)
    if llm_conf > 0:
        return round(llm_conf, 3)
    domains = get_top_domains(profile_data, min_confidence=0.25, max_domains=4)
    if not domains:
        return 0.0
    return round(sum(conf for _, conf in domains) / len(domains), 3)


def build_inferred_summary(profile_data: dict[str, Any] | None) -> str:
    data = normalize_profile_data(profile_data)
    confirmed = _as_mapping(data.get("confirmed_anchors"))
    if confirmed.get("summary"):
        return str(confirmed["summary"])

    llm_summary = str(data.get("llm_synthesized_summary") or "").strip()
    if llm_summary:
        return llm_summary

    domains = get_top_domains(profile_data, min_confidence=MIN_DOMAIN_CONFIDENCE, max_domains=3)
    labels = [DOMAIN_LABELS.get(name, name.replace("_", " ")) for name, _ in domains]
    if not labels:
        return "your AI conversations across different topics"

    if len(labels) == 1:
        return labels[0]
    if len(labels) == 2:
        return f"{labels[0]} and {labels[1]}"
    return f"{labels[0]}, {labels[1]}, and {labels[2]}"


def has_enough_history(conversation_count: int, profile_data: dict[str, Any] | None) -> bool:
    return (
        int(conversation_count or 0) >= MIN_HISTORY_CONVERSATIONS
        and compute_summary_confidence(profile_data) >= MIN_SUMMARY_CONFIDENCE
    )


def should_prompt_confirmation(profile_data: dict[str, Any] | None) -> bool:
    data = normalize_profile_data(profile_data)
    confirmed = _as_mapping(data.get("confirmed_anchors"))
    if not confirmed.get("confirmed_at"):
        return True
    ts = _parse_ts(confirmed.get("confirmed_at"))
    if not ts:
        return True
    age_days = (datetime.now(timezone.utc) - ts).total_seconds() / 86400.0
    if age_days >= CONFIRMATION_STALE_DAYS:
        return True
    # Re-prompt if inferred domains drift from confirmed domains.
    confirmed_domains = set(_as_list(confirmed.get("domains")))
    inferred_domains = {name for name, _ in get_top_domains(data, min_confidence=0.5, max_domains=3)}
    if inferred_domains and confirmed_domains and not inferred_domains.intersection(confirmed_domains):
        return True
    return False


def apply_summary_confirmation(
    profile_data: dict[str, Any] | None,
    action: str,
    correction_ids: list[str] | None = None,
) -> dict[str, Any]:
    profile = normalize_profile_data(profile_data)
    confirmed = dict(_as_mapping(profile.get("confirmed_anchors")))
    now = _utcnow_iso()
    action_l = (action or "").strip().lower()

    if action_l == "confirm":
        summary = build_inferred_summary(profile)
        domains = [name for name, _ in get_top_domains(profile, min_confidence=MIN_DOMAIN_CONFIDENCE, max_domains=3)]
        confirmed.update({
            "summary": summary,
            "domains": domains,
            "confirmed_at": now,
            "source": "inferred_confirm",
        })
    elif action_l == "correct":
        ids = [str(item).strip().lower() for item in (correction_ids or []) if str(item).strip()]
        labels = [opt["label"] for opt in QUICK_CORRECTION_OPTIONS if opt["id"] in ids and opt["id"] != "other"]
        if labels:
            if len(labels) == 1:
                summary = labels[0].replace("Mostly ", "").lower()
            else:
                summary = " and ".join(label.replace("Mostly ", "").lower() for label in labels[:2])
            confirmed.update({
                "summary": summary,
                "domains": [item for item in ids if item != "other"],
                "confirmed_at": now,
                "source": "user_correction",
            })
        domains_map = dict(_as_mapping(profile.get("domains")))
        for domain_id in ids:
            if domain_id == "other":
                continue
            prior = domains_map.get(domain_id, {})
            domains_map[domain_id] = {
                "expertise_level": prior.get("expertise_level", "unknown"),
                "confidence": 1.0,
                "last_observed_at": now,
                "evidence_count": int(prior.get("evidence_count", 0) or 0) + 1,
                "user_verified": True,
            }
        profile["domains"] = domains_map
    elif action_l == "skip":
        confirmed["skipped_at"] = now
    else:
        return profile

    profile["confirmed_anchors"] = confirmed
    profile["last_observed_at"] = now
    return profile


def extract_confirmed_anchor_facts(profile_data: dict[str, Any] | None) -> list[str]:
    data = normalize_profile_data(profile_data)
    confirmed = _as_mapping(data.get("confirmed_anchors"))
    summary = str(confirmed.get("summary") or "").strip()
    if not summary:
        return []
    facts = [f"User-verified focus areas: {summary}."]
    for pref_key in ("concise", "step_by_step", "examples", "formal_tone"):
        pref = _as_mapping(data.get("preferences")).get(pref_key) or {}
        if not isinstance(pref, dict):
            continue
        conf = decay_confidence(float(pref.get("confidence", 0.0) or 0.0), pref.get("last_observed_at"))
        if pref.get("value") and conf >= MIN_FACT_CONFIDENCE:
            if pref_key == "concise":
                facts.append("User prefers concise responses (verified pattern).")
            elif pref_key == "step_by_step":
                facts.append("User values step-by-step guidance (verified pattern).")
    return facts[:4]


def build_fallback_structured_questions(
    goal: str,
    profile_data: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    goal_l = (goal or "").lower()
    data = normalize_profile_data(profile_data)
    confirmed_domains = set(_as_list(_as_mapping(data.get("confirmed_anchors")).get("domains")))
    questions: list[dict[str, Any]] = []

    if "coding" not in confirmed_domains and any(k in goal_l for k in ("code", "bug", "api", "debug")):
        questions.append({
            "id": "stack",
            "prompt": "Which stack should this focus on?",
            "options": [
                {"id": "python", "label": "Python"},
                {"id": "javascript", "label": "JavaScript / TypeScript"},
                {"id": "other_lang", "label": "Another language"},
                {"id": "unsure", "label": "Not sure yet"},
            ],
            "allow_other": True,
        })
    if "career" not in confirmed_domains and any(k in goal_l for k in ("resume", "job", "interview", "application")):
        questions.append({
            "id": "career_stage",
            "prompt": "What career stage is this for?",
            "options": [
                {"id": "internship", "label": "Internship"},
                {"id": "new_grad", "label": "New grad / entry level"},
                {"id": "mid_level", "label": "Mid-level"},
                {"id": "career_switch", "label": "Career switch"},
            ],
            "allow_other": False,
        })
    if "education" not in confirmed_domains and any(k in goal_l for k in ("essay", "homework", "thesis", "school")):
        questions.append({
            "id": "edu_level",
            "prompt": "What level of school is this for?",
            "options": [
                {"id": "high_school", "label": "High school"},
                {"id": "undergrad", "label": "Undergraduate"},
                {"id": "grad", "label": "Graduate school"},
                {"id": "other_edu", "label": "Other"},
            ],
            "allow_other": False,
        })

    if not questions:
        questions.append({
            "id": "outcome",
            "prompt": "What outcome do you want most?",
            "options": [
                {"id": "draft", "label": "A first draft"},
                {"id": "plan", "label": "A step-by-step plan"},
                {"id": "review", "label": "Feedback on existing work"},
                {"id": "decision", "label": "Help deciding between options"},
            ],
            "allow_other": True,
        })
    return questions[:2]


def normalize_structured_questions(raw_questions: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    if not isinstance(raw_questions, list):
        return normalized
    for idx, item in enumerate(raw_questions):
        if isinstance(item, str):
            normalized.append({
                "id": f"q{idx + 1}",
                "prompt": item.strip(),
                "options": [
                    {"id": "yes", "label": "Yes"},
                    {"id": "no", "label": "No"},
                    {"id": "unsure", "label": "Not sure"},
                ],
                "allow_other": True,
            })
            continue
        if not isinstance(item, dict):
            continue
        prompt = str(item.get("prompt") or item.get("question") or "").strip()
        if not prompt:
            continue
        options = []
        for opt_idx, opt in enumerate(item.get("options") or []):
            if isinstance(opt, str):
                options.append({"id": f"opt_{opt_idx + 1}", "label": opt.strip()})
            elif isinstance(opt, dict) and opt.get("label"):
                options.append({
                    "id": str(opt.get("id") or f"opt_{opt_idx + 1}"),
                    "label": str(opt.get("label")).strip(),
                })
        if len(options) < 2:
            continue
        normalized.append({
            "id": str(item.get("id") or f"q{idx + 1}"),
            "prompt": prompt,
            "options": options[:5],
            "allow_other": bool(item.get("allow_other", True)),
        })
    return normalized[:3]


def extract_relevant_profile_facts(
    profile_data: dict[str, Any] | None,
    query: str,
    min_confidence: float = MIN_FACT_CONFIDENCE,
    max_facts: int = PROFILE_FACT_CAP,
) -> list[str]:
    query_l = (query or "").lower()
    facts: list[tuple[float, str]] = []
    data = normalize_profile_data(profile_data)

    for domain, info in _as_mapping(data.get("domains")).items():
        if not isinstance(info, dict):
            continue
        conf = decay_confidence(float(info.get("confidence", 0.0) or 0.0), info.get("last_observed_at"))
        if conf < max(min_confidence, MIN_DOMAIN_CONFIDENCE):
            continue
        if domain in query_l or any(k in query_l for k in DOMAIN_PATTERNS.get(domain, [])):
            facts.append((conf, f"User often asks about {domain} topics ({int(conf * 100)}% confidence)."))

    for pref, info in _as_mapping(data.get("preferences")).items():
        if not isinstance(info, dict):
            continue
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

    for proj in _as_list(data.get("active_projects")):
        if not isinstance(proj, dict):
            continue
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
    data = normalize_profile_data(profile_data)
    projects = [str(p.get("name", "")).lower() for p in _as_list(data.get("active_projects")) if isinstance(p, dict)]
    domain_weights = {}
    for name, item in _as_mapping(data.get("domains")).items():
        if not isinstance(item, dict):
            continue
        domain_weights[name] = decay_confidence(
            float(item.get("confidence", 0.0) or 0.0),
            item.get("last_observed_at"),
        )

    now = datetime.now(timezone.utc)
    reranked: list[dict[str, Any]] = []
    adaptive_weights = _as_mapping(data.get("adaptive_weights"))
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
    profile = normalize_profile_data(profile_data)
    adaptive = dict(_as_mapping(profile.get("adaptive_weights")))
    quality = dict(_as_mapping(profile.get("quality_metrics")))
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
