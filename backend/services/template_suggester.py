"""AI-powered template suggestions from user draft text."""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

from services.database import get_prompt_templates, suggest_prompt_templates

_CACHE: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL_SEC = 90


def _cache_key(draft: str, limit: int, category: str, tier: str) -> str:
    return f"{draft.strip().lower()[:2000]}|{limit}|{category}|{tier}"


def _parse_ai_picks(text: str) -> list[dict[str, str]]:
    text = (text or "").strip()
    if not text:
        return []

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", text)
        if not match:
            return []
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []

    if not isinstance(data, list):
        return []

    picks: list[dict[str, str]] = []
    for item in data:
        if isinstance(item, str):
            picks.append({"name": item.strip(), "reason": ""})
        elif isinstance(item, dict) and item.get("name"):
            picks.append({
                "name": str(item["name"]).strip(),
                "reason": str(item.get("reason") or "").strip(),
            })
    return picks


def _filter_catalog(
    templates: list[dict],
    category: str = "",
    tier: str = "",
) -> list[dict]:
    out = templates
    if category:
        out = [t for t in out if (t.get("category") or "") == category]
    if tier:
        out = [t for t in out if (t.get("tier") or "standard").lower() == tier.lower()]
    return out


def _attach_reasons(templates: list[dict], picks: list[dict[str, str]]) -> list[dict]:
    by_name = {t.get("name"): t for t in templates if t.get("name")}
    reason_by_name = {p["name"]: p.get("reason", "") for p in picks if p.get("name")}
    ordered: list[dict] = []
    for pick in picks:
        name = pick.get("name")
        if not name or name not in by_name:
            continue
        row = dict(by_name[name])
        reason = reason_by_name.get(name) or ""
        if reason:
            row["suggest_reason"] = reason
        ordered.append(row)
    return ordered


def suggest_templates_with_ai(
    draft: str,
    limit: int = 5,
    category: str = "",
    tier: str = "",
) -> list[dict]:
    """Pick the best templates for a user's draft using Claude Haiku."""
    draft = (draft or "").strip()
    limit = max(1, min(limit, 12))
    all_templates = get_prompt_templates()
    catalog = _filter_catalog(all_templates, category=category, tier=tier)

    if not draft:
        from services.database import _sort_templates
        return _sort_templates(catalog, "popular")[:limit]

    if not catalog:
        return []

    key = _cache_key(draft, limit, category, tier)
    cached = _CACHE.get(key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL_SEC:
        return cached[1][:limit]

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        results = suggest_prompt_templates(draft, limit)
        _CACHE[key] = (time.time(), results)
        return results[:limit]

    compact: list[dict[str, str]] = [
        {
            "name": t.get("name") or "",
            "description": (t.get("description") or "")[:160],
            "category": t.get("category") or "",
        }
        for t in catalog
        if t.get("name")
    ]

    system_prompt = """You help non-technical users pick prompt templates.
Given what they typed in a chat box, choose templates that would help them get a great result — even if they never used matching keywords.
Return ONLY valid JSON: an array of objects with "name" (exact catalog name) and "reason" (short plain-English phrase, max 8 words).
No markdown, no commentary."""

    user_content = (
        f"Pick the {limit} best templates for this user text.\n\n"
        f"USER TEXT:\n{draft[:2000]}\n\n"
        f"CATALOG:\n{json.dumps(compact, ensure_ascii=False)}"
    )

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=400,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
        )
        picks = _parse_ai_picks(response.content[0].text)
        results = _attach_reasons(catalog, picks)

        if len(results) < limit:
            fallback = suggest_prompt_templates(draft, limit)
            seen = {t.get("name") for t in results}
            for t in fallback:
                if t.get("name") not in seen:
                    results.append(t)
                    seen.add(t.get("name"))
                if len(results) >= limit:
                    break

        _CACHE[key] = (time.time(), results)
        return results[:limit]
    except Exception as exc:
        print(f"[template_suggester] AI suggest failed: {exc}")
        results = suggest_prompt_templates(draft, limit)
        _CACHE[key] = (time.time(), results)
        return results[:limit]
