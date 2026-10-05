"""The Improve pipeline after retrieval: pick memory, assemble context, rewrite.

Shared by /engineer_prompt (cloud memory read from Supabase) and
/engineer_prompt_stateless (candidates sent by the extension from on-device
memory), so both modes produce the same prompt for the same inputs. Prompt
text lives in prompts.json, which the extension also renders when the user
calls Anthropic directly with their own key.
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path
from typing import Any

PROMPTS_PATH = Path(__file__).with_name("prompts.json")

# Facts picked for an "about me" draft on the profile route, versus normal drafts.
PROFILE_ROUTE_FACTS = 10
DEFAULT_FACTS = 6
RERANK_LIMIT = 5
# Candidates the reranker sees; retrieval returns at most this many.
MAX_CANDIDATES = 15


@lru_cache(maxsize=1)
def load_prompts() -> dict[str, Any]:
    with PROMPTS_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _text(value: Any) -> str:
    return "\n".join(value) if isinstance(value, list) else str(value or "")


def render(template: Any, **values: Any) -> str:
    out = _text(template)
    for name, value in values.items():
        out = out.replace("{{" + name + "}}", str(value))
    return out


def prompt_system(name: str, **values: Any) -> tuple[str, int]:
    """(system prompt, max_tokens) for a named prompt in prompts.json."""
    entry = load_prompts()[name]
    return render(entry["system"], **values), int(entry.get("max_tokens", 600))


def model_name() -> str:
    return load_prompts()["model"]


def adaptation_hint(adaptive: dict[str, Any] | None) -> str:
    hints = load_prompts()["adaptation_hints"]
    adaptive = adaptive or {}
    concise_bias = float(adaptive.get("concise_bias", 0.5) or 0.5)
    detail_level = float(adaptive.get("detail_level", 0.5) or 0.5)
    if concise_bias >= 0.62:
        return hints["concise"]
    if detail_level >= 0.65:
        return hints["detail"]
    return hints["balanced"]


def engineer_system_prompt(hint: str) -> str:
    """The v3 prompt-engineering system prompt. Validated in backend/evals/
    (beat the prior prompt 6-0-2 in blind pairwise judging)."""
    return prompt_system("engineer_v3", adaptation_hint=hint)[0]


def select_memory(
    draft: str,
    candidates: list[dict[str, Any]],
    profile: dict[str, Any] | None,
    api_key: str | None,
    route: str = "standard",
) -> tuple[list[dict[str, Any]], list[str] | None]:
    """Rerank candidates and pick profile facts, concurrently (both are LLM
    calls). Returns (selected conversations, picked facts or None when the
    profile is off)."""
    from services.personalization_llm import pick_relevant_profile_facts_llm, rerank_conversations_llm

    profile = profile or {}
    profile_on = bool(profile.get("is_profile_enabled"))
    with ThreadPoolExecutor(max_workers=2) as pool:
        rerank_future = pool.submit(rerank_conversations_llm, draft, candidates, api_key, RERANK_LIMIT)
        facts_future = None
        if profile_on:
            facts_future = pool.submit(
                pick_relevant_profile_facts_llm,
                profile.get("profile_data") or {},
                draft,
                api_key,
                PROFILE_ROUTE_FACTS if route == "profile" else DEFAULT_FACTS,
            )
        selected = rerank_future.result()
        facts = facts_future.result() if facts_future is not None else None
    return selected, facts


def build_conversation_context(selected: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """(sources_used for the UI, one context block per conversation with text).
    A conversation's excerpt is its precomputed `excerpt` when the client sent
    one, else built from full_text and its matched chunk spans."""
    from services.retrieval import build_excerpt

    tmpl = load_prompts()["engineer_user"]["conversation_block"]
    sources_used: list[dict[str, Any]] = []
    context_parts: list[str] = []
    for conv in selected:
        full_text = conv.get("full_text") or conv.get("preview") or ""
        excerpt = conv.get("excerpt") or (build_excerpt(full_text, conv.get("matched")) if full_text else "")
        sim = conv.get("similarity")
        sources_used.append({
            "id": conv.get("id"),
            "title": conv.get("title") or "Untitled",
            "preview": (conv.get("preview") or full_text[:120] or excerpt[:120] or "")[:120],
            "source": conv.get("source_app") or conv.get("source") or "unknown",
            "created_at": str(conv.get("created_at") or "")[:10],
            "similarity": round(float(sim) * 100, 1) if sim is not None else None,
        })
        if excerpt:
            context_parts.append(render(
                tmpl,
                title=conv.get("title", "Untitled"),
                date=str(conv.get("created_at", ""))[:10],
                num_messages=conv.get("num_messages", 0),
                excerpt=excerpt,
            ))
    return sources_used, context_parts


def build_profile_context(
    profile: dict[str, Any] | None,
    draft: str,
    api_key: str | None,
    picked_facts: list[str] | None = None,
) -> tuple[str, dict[str, Any]]:
    """(profile context block, adaptive weights). Verified anchors always
    count; inferred facts only when the profile is enabled."""
    from services.personalization import extract_confirmed_anchor_facts, extract_relevant_profile_facts
    from services.personalization_llm import pick_relevant_profile_facts_llm

    headers = load_prompts()["engineer_user"]
    profile = profile or {}
    profile_data = profile.get("profile_data") or {}
    context = ""
    adaptive: dict[str, Any] = {}

    confirmed_facts = extract_confirmed_anchor_facts(profile_data)
    if confirmed_facts:
        context = headers["anchors_header"] + "".join(f"- {fact}\n" for fact in confirmed_facts) + "\n"

    if profile.get("is_profile_enabled"):
        adaptive = profile_data.get("adaptive_weights") or {}
        facts = picked_facts
        if facts is None:
            facts = pick_relevant_profile_facts_llm(profile_data, draft, api_key, max_facts=DEFAULT_FACTS)
        if not facts:
            facts = extract_relevant_profile_facts(profile_data, draft, min_confidence=0.62, max_facts=DEFAULT_FACTS)
        if facts:
            context += headers["profile_header"] + "".join(f"- {fact}\n" for fact in facts) + "\n"
    return context, adaptive


def build_engineer_messages(
    draft: str,
    context_parts: list[str],
    profile_context: str,
    adaptive: dict[str, Any] | None,
    template_name: str = "",
    template_body: str = "",
    skip_memory: bool = False,
) -> tuple[str, str, int]:
    """(system prompt, user content, max_tokens) for the rewrite call."""
    prompts = load_prompts()
    user_tmpl = prompts["engineer_user"]

    if skip_memory and template_name:
        system, max_tokens = prompt_system(
            "engineer_template_merge",
            core_role=_text(prompts["engineer_core_role"]),
        )
    else:
        system, max_tokens = prompt_system("engineer_v3", adaptation_hint=adaptation_hint(adaptive))

    conv_context = user_tmpl["conversation_separator"].join(context_parts) if context_parts else ""
    user = f"{user_tmpl['draft_header']}{draft}\n{profile_context}"
    if conv_context.strip():
        user += user_tmpl["history_header"] + conv_context
    if template_body:
        user += render(user_tmpl["template_header"], template_name=template_name) + template_body
    elif template_name:
        user += render(user_tmpl["template_hint"], template_name=template_name)
    return system, user, max_tokens


def run_engineer(system: str, user: str, max_tokens: int, api_key: str) -> str:
    import anthropic

    from services.prompt_format import format_engineered_prompt

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model_name(),
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return format_engineered_prompt(response.content[0].text)
