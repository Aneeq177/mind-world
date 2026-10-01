"""LLM-powered personalization: profile extraction, synthesis, reranking, fact picking."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from services.personalization import (
    QUICK_CORRECTION_OPTIONS,
    _utcnow_iso,
    infer_profile_delta as infer_profile_delta_heuristic,
    normalize_profile_data,
)

HAIKU = "claude-haiku-4-5-20251001"
SYNTHESIS_STALE_HOURS = 24
EXTRACTION_BATCH_SIZE = 3


def _resolve_api_key(api_key: str | None) -> str | None:
    return (api_key or os.getenv("ANTHROPIC_API_KEY") or "").strip() or None


def _parse_json_text(text: str) -> Any:
    cleaned = (text or "").strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    if cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Haiku sometimes adds an explanation after the JSON; keep the first value.
        starts = [i for i in (cleaned.find("{"), cleaned.find("[")) if i != -1]
        if not starts:
            raise
        value, _ = json.JSONDecoder().raw_decode(cleaned[min(starts):])
        return value


def _haiku(api_key: str, system: str, user: str, max_tokens: int = 600) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=HAIKU,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return response.content[0].text.strip()


def _merge_domain_entry(existing: dict[str, Any], domain_id: str, incoming: dict[str, Any]) -> dict[str, Any]:
    prior = existing.get(domain_id, {}) if isinstance(existing.get(domain_id), dict) else {}
    new_conf = float(incoming.get("confidence", 0.0) or 0.0)
    old_conf = float(prior.get("confidence", 0.0) or 0.0)
    merged_conf = max(old_conf, min(1.0, (old_conf * 0.7) + (new_conf * 0.3)))
    return {
        "expertise_level": incoming.get("expertise_level") or prior.get("expertise_level", "unknown"),
        "label": incoming.get("label") or prior.get("label") or domain_id.replace("_", " "),
        "confidence": round(merged_conf, 3),
        "last_observed_at": _utcnow_iso(),
        "evidence_count": int(prior.get("evidence_count", 0) or 0) + 1,
        "source": "llm",
    }


def merge_llm_profile_delta(
    existing_profile_data: dict[str, Any] | None,
    llm_delta: dict[str, Any],
) -> dict[str, Any]:
    profile = normalize_profile_data(existing_profile_data)
    now = _utcnow_iso()

    domains = dict(profile.get("domains") or {})
    for domain_id, info in (llm_delta.get("domains") or {}).items():
        if isinstance(info, dict):
            domains[str(domain_id)] = _merge_domain_entry(domains, str(domain_id), info)
    profile["domains"] = domains

    preferences = dict(profile.get("preferences") or {})
    for pref_id, info in (llm_delta.get("preferences") or {}).items():
        if not isinstance(info, dict):
            continue
        prior = preferences.get(pref_id, {}) if isinstance(preferences.get(pref_id), dict) else {}
        new_conf = float(info.get("confidence", 0.0) or 0.0)
        old_conf = float(prior.get("confidence", 0.0) or 0.0)
        preferences[pref_id] = {
            "value": bool(info.get("value", True)),
            "confidence": round(max(old_conf, min(1.0, (old_conf * 0.7) + (new_conf * 0.3))), 3),
            "last_observed_at": now,
            "source": "llm",
        }
    profile["preferences"] = preferences

    projects = list(profile.get("active_projects") or [])
    project_map = {
        str(p.get("name", "")).lower(): p
        for p in projects
        if isinstance(p, dict) and p.get("name")
    }
    for item in llm_delta.get("active_projects") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        prior = project_map.get(name.lower(), {})
        old_conf = float(prior.get("confidence", 0.0) or 0.0)
        new_conf = float(item.get("confidence", 0.0) or 0.0)
        project_map[name.lower()] = {
            "name": name,
            "confidence": round(max(old_conf, min(1.0, (old_conf * 0.6) + (new_conf * 0.4))), 3),
            "last_observed_at": now,
            "source": "llm",
        }
    profile["active_projects"] = sorted(
        project_map.values(),
        key=lambda x: float(x.get("confidence", 0.0)),
        reverse=True,
    )[:8]

    constraints = list(profile.get("constraints") or [])
    for c in llm_delta.get("constraints") or []:
        text = str(c).strip()
        if text and text not in constraints:
            constraints.append(text)
    profile["constraints"] = constraints[:12]

    entities = dict(profile.get("entities") or {})
    for key, val in (llm_delta.get("entities") or {}).items():
        if isinstance(val, list):
            prior = entities.get(key, []) if isinstance(entities.get(key), list) else []
            merged = list(dict.fromkeys([*prior, *[str(v).strip() for v in val if str(v).strip()]]))
            entities[key] = merged[:20]
    profile["entities"] = entities

    profile["last_observed_at"] = now
    profile["last_llm_extract_at"] = now
    return profile


def should_run_llm_extraction(profile_data: dict[str, Any] | None) -> bool:
    data = normalize_profile_data(profile_data)
    pending = data.get("llm_pending_snippets") or []
    return len(pending) >= EXTRACTION_BATCH_SIZE


def queue_snippet_for_llm_extraction(
    profile_data: dict[str, Any] | None,
    snippet: str,
) -> dict[str, Any]:
    profile = normalize_profile_data(profile_data)
    pending = list(profile.get("llm_pending_snippets") or [])
    text = (snippet or "").strip()
    if text:
        pending.append(text[:2500])
    profile["llm_pending_snippets"] = pending[-EXTRACTION_BATCH_SIZE * 2:]
    return profile


def infer_profile_delta_llm(
    existing_profile_data: dict[str, Any] | None,
    conversation_text: str,
    api_key: str | None = None,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """LLM profile extraction with batched snippets; falls back to heuristic."""
    key = _resolve_api_key(api_key)
    profile = queue_snippet_for_llm_extraction(existing_profile_data, conversation_text)

    if not key:
        merged = infer_profile_delta_heuristic(profile, conversation_text)
        merged["llm_pending_snippets"] = []
        return merged

    if not force and not should_run_llm_extraction(profile):
        return profile

    pending = profile.get("llm_pending_snippets") or []
    combined = "\n\n---\n\n".join(pending[-EXTRACTION_BATCH_SIZE:])[:6000]

    system = """You extract personalization signals from a user's AI chat history.
Return ONLY valid JSON (no markdown):
{
  "domains": {
    "domain_id": {"label": "human readable", "confidence": 0.0-1.0, "expertise_level": "beginner|intermediate|advanced|unknown"}
  },
  "preferences": {
    "concise|step_by_step|examples|formal_tone": {"value": true, "confidence": 0.0-1.0}
  },
  "active_projects": [{"name": "...", "confidence": 0.0-1.0}],
  "constraints": ["short stable facts about deadlines, goals, stack choices"],
  "entities": {"stack": [], "schools": [], "roles": [], "companies": []}
}
Use snake_case domain ids. Only include fields supported by evidence. Be conservative with confidence."""

    user = (
        f"EXISTING PROFILE:\n{json.dumps(normalize_profile_data(profile), ensure_ascii=False)[:3000]}\n\n"
        f"NEW CONVERSATION SNIPPET(S):\n{combined}"
    )

    try:
        raw = _haiku(key, system, user, max_tokens=700)
        delta = _parse_json_text(raw)
        if isinstance(delta, dict):
            merged = merge_llm_profile_delta(profile, delta)
            merged["llm_pending_snippets"] = []
            merged["profile_version"] = int(profile.get("profile_version", 0) or 0) + 1
            return merged
    except Exception as exc:
        print(f"[personalization_llm] infer_profile_delta_llm failed: {exc}")

    merged = infer_profile_delta_heuristic(profile, combined or conversation_text)
    merged["llm_pending_snippets"] = []
    return merged


def synthesize_profile_llm(
    profile_data: dict[str, Any] | None,
    conversation_samples: list[dict[str, Any]],
    api_key: str | None = None,
) -> dict[str, Any]:
    """Periodic holistic profile synthesis from recent conversation samples."""
    key = _resolve_api_key(api_key)
    profile = normalize_profile_data(profile_data)
    if not key or not conversation_samples:
        return profile

    compact_samples = [
        {
            "title": s.get("title", ""),
            "preview": (s.get("preview") or "")[:200],
            "source": s.get("source_app") or s.get("source") or "",
        }
        for s in conversation_samples[:25]
    ]

    system = """Synthesize a user personalization profile from their recent AI conversations.
Return ONLY valid JSON:
{
  "inferred_summary": "One natural sentence, e.g. software engineering and grad school applications",
  "summary_confidence": 0.0-1.0,
  "domains": { "domain_id": {"label": "...", "confidence": 0.0-1.0} },
  "preferences": { "concise|step_by_step|examples|formal_tone": {"value": true, "confidence": 0.0-1.0} },
  "active_projects": [{"name": "...", "confidence": 0.0-1.0}],
  "constraints": ["..."],
  "quick_corrections": [{"id": "snake_case", "label": "Mostly ..."}]
}
quick_corrections: 3-5 tap options tailored to THIS user (not generic). Respect existing confirmed_anchors if present."""

    user = (
        f"CURRENT PROFILE:\n{json.dumps(profile, ensure_ascii=False)[:3500]}\n\n"
        f"RECENT CONVERSATIONS:\n{json.dumps(compact_samples, ensure_ascii=False)}"
    )

    try:
        raw = _haiku(key, system, user, max_tokens=900)
        payload = _parse_json_text(raw)
        if not isinstance(payload, dict):
            return profile

        merged = merge_llm_profile_delta(profile, payload)
        summary = str(payload.get("inferred_summary") or "").strip()
        if summary:
            merged["llm_synthesized_summary"] = summary
            merged["llm_summary_confidence"] = float(payload.get("summary_confidence", 0.0) or 0.0)
        corrections = payload.get("quick_corrections") or []
        if isinstance(corrections, list) and corrections:
            merged["llm_quick_corrections"] = [
                {"id": str(c.get("id", f"corr_{i}")), "label": str(c.get("label", "")).strip()}
                for i, c in enumerate(corrections)
                if isinstance(c, dict) and c.get("label")
            ][:6]
        merged["last_llm_synthesis_at"] = _utcnow_iso()
        merged["profile_version"] = int(profile.get("profile_version", 0) or 0) + 1
        return merged
    except Exception as exc:
        print(f"[personalization_llm] synthesize_profile_llm failed: {exc}")
        return profile


def synthesis_is_stale(profile_data: dict[str, Any] | None) -> bool:
    data = normalize_profile_data(profile_data)
    last = data.get("last_llm_synthesis_at")
    if not last:
        return True
    try:
        ts = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age_hours = (datetime.now(timezone.utc) - ts).total_seconds() / 3600.0
        return age_hours >= SYNTHESIS_STALE_HOURS
    except ValueError:
        return True


def pick_relevant_profile_facts_llm(
    profile_data: dict[str, Any] | None,
    query: str,
    api_key: str | None = None,
    max_facts: int = 6,
) -> list[str]:
    key = _resolve_api_key(api_key)
    profile = normalize_profile_data(profile_data)
    if not key or not query.strip():
        return []

    system = """Pick personalization facts relevant to the user's current draft.
Return ONLY JSON: {"facts": ["fact 1", "fact 2"]}
Max 6 facts. Use only information from the profile. Never invent details.
Prefer user-verified anchors, active projects, constraints, entities, and preferences."""

    user = f"USER DRAFT:\n{query[:1500]}\n\nPROFILE:\n{json.dumps(profile, ensure_ascii=False)[:4000]}"

    try:
        raw = _haiku(key, system, user, max_tokens=350)
        payload = _parse_json_text(raw)
        facts = payload.get("facts") if isinstance(payload, dict) else payload
        if isinstance(facts, list):
            return [str(f).strip() for f in facts if str(f).strip()][:max_facts]
    except Exception as exc:
        print(f"[personalization_llm] pick_relevant_profile_facts_llm failed: {exc}")
    return []


def rerank_conversations_llm(
    query: str,
    candidates: list[dict[str, Any]],
    api_key: str | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    key = _resolve_api_key(api_key)
    if not key or not candidates:
        return candidates[:limit]

    # Chunk retrieval supplies `snippet`: the part of the conversation that
    # actually matched, which may be far from its opening `preview`.
    compact = [
        {
            "id": c.get("id"),
            "title": c.get("title", ""),
            "preview": (c.get("snippet") or "")[:600] or (c.get("preview") or "")[:180],
            "similarity": c.get("similarity"),
        }
        for c in candidates[:15]
        if c.get("id")
    ]
    if not compact:
        return candidates[:limit]

    system = f"""Rank past conversations by relevance to the user's current draft.
Return ONLY JSON: {{"ranked_ids": ["id1", "id2", ...]}}
Include at most {limit} ids, best first. Use only ids from the list."""

    user = f"DRAFT:\n{query[:1500]}\n\nCANDIDATES:\n{json.dumps(compact, ensure_ascii=False)}"

    try:
        raw = _haiku(key, system, user, max_tokens=200)
        payload = _parse_json_text(raw)
        ranked_ids = payload.get("ranked_ids") if isinstance(payload, dict) else []
        if not isinstance(ranked_ids, list):
            return candidates[:limit]
        by_id = {c.get("id"): c for c in candidates}
        reranked = [by_id[i] for i in ranked_ids if i in by_id]
        seen = {c.get("id") for c in reranked}
        for c in candidates:
            if c.get("id") not in seen:
                reranked.append(c)
            if len(reranked) >= limit:
                break
        return reranked[:limit]
    except Exception as exc:
        print(f"[personalization_llm] rerank_conversations_llm failed: {exc}")
        return candidates[:limit]


def get_display_summary(profile_data: dict[str, Any] | None) -> str:
    data = normalize_profile_data(profile_data)
    confirmed = data.get("confirmed_anchors") or {}
    if isinstance(confirmed, dict) and confirmed.get("summary"):
        return str(confirmed["summary"])
    llm_summary = str(data.get("llm_synthesized_summary") or "").strip()
    if llm_summary:
        return llm_summary
    from services.personalization import build_inferred_summary
    return build_inferred_summary(data)


def get_quick_corrections(profile_data: dict[str, Any] | None) -> list[dict[str, str]]:
    data = normalize_profile_data(profile_data)
    custom = data.get("llm_quick_corrections") or []
    if isinstance(custom, list) and custom:
        out = []
        for item in custom:
            if isinstance(item, dict) and item.get("label"):
                out.append({
                    "id": str(item.get("id") or item["label"].lower().replace(" ", "_")),
                    "label": str(item["label"]),
                })
        if out:
            out.append({"id": "other", "label": "Something else"})
            return out[:6]
    return QUICK_CORRECTION_OPTIONS


def apply_edit_feedback_llm(
    profile_data: dict[str, Any] | None,
    engineered_prompt: str,
    final_prompt: str,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Extract semantic preference signals from prompt edits."""
    key = _resolve_api_key(api_key)
    profile = normalize_profile_data(profile_data)
    if not key or not engineered_prompt or not final_prompt:
        return profile
    if engineered_prompt.strip() == final_prompt.strip():
        return profile

    system = """Analyze how the user edited an AI-engineered prompt.
Return ONLY JSON preference deltas (only if clear evidence):
{
  "preferences": {
    "concise|step_by_step|examples|formal_tone": {"value": true/false, "confidence": 0.0-1.0}
  },
  "style_notes": ["short note about tone/structure preference"]
}
Be conservative."""

    user = (
        f"ENGINEERED:\n{engineered_prompt[:2000]}\n\n"
        f"USER FINAL:\n{final_prompt[:2000]}"
    )

    try:
        raw = _haiku(key, system, user, max_tokens=300)
        payload = _parse_json_text(raw)
        if isinstance(payload, dict) and payload.get("preferences"):
            return merge_llm_profile_delta(profile, {"preferences": payload["preferences"]})
    except Exception as exc:
        print(f"[personalization_llm] apply_edit_feedback_llm failed: {exc}")
    return profile


def merge_popup_profile_llm(
    profile_data: dict[str, Any] | None,
    popup_fields: dict[str, Any],
    api_key: str | None = None,
) -> dict[str, Any]:
    """Convert free-text popup profile fields into structured profile_data."""
    key = _resolve_api_key(api_key)
    profile = normalize_profile_data(profile_data)
    cleaned_popup = {k: str(v).strip() for k, v in (popup_fields or {}).items() if str(v).strip()}
    if not key or not cleaned_popup:
        profile.update(cleaned_popup)
        return profile

    system = """Convert explicit user-provided profile fields into structured personalization JSON.
Return ONLY JSON with optional keys: domains, preferences, active_projects, constraints, entities.
Use the same schema as profile extraction. Only include fields clearly stated by the user."""

    user = (
        f"EXISTING PROFILE:\n{json.dumps(profile, ensure_ascii=False)[:2500]}\n\n"
        f"USER-PROVIDED FIELDS:\n{json.dumps(cleaned_popup, ensure_ascii=False)}"
    )

    try:
        raw = _haiku(key, system, user, max_tokens=500)
        payload = _parse_json_text(raw)
        if isinstance(payload, dict):
            merged = merge_llm_profile_delta(profile, payload)
            merged.update(cleaned_popup)
            merged["last_popup_merge_at"] = _utcnow_iso()
            return merged
    except Exception as exc:
        print(f"[personalization_llm] merge_popup_profile_llm failed: {exc}")

    profile.update(cleaned_popup)
    return profile
