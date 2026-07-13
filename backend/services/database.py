from supabase import create_client, Client
import os
import numpy as np
from datetime import datetime, timezone
from typing import Any

CONSENT_VERSION = "2026-06-2"

def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise ValueError("Supabase credentials not configured")
    return create_client(url, key)

def get_or_create_user(email: str) -> str:
    supabase = get_supabase()
    email = email.lower().strip()

    result = supabase.table("users")\
        .select("id")\
        .eq("email", email)\
        .execute()

    if result.data:
        return result.data[0]["id"]

    import uuid
    new_id = str(uuid.uuid4())
    supabase.table("users").insert({
        "id": new_id,
        "email": email,
        "role": "member"
    }).execute()
    return new_id

def store_conversations(
    user_id: str,
    chats: list[dict],
    embeddings
):
    supabase = get_supabase()

    # Store conversations in batches of 50
    batch_size = 50
    for i in range(0, len(chats), batch_size):
        batch = chats[i:i + batch_size]
        rows = []
        for chat in batch:
            rows.append({
                "id": chat["id"],
                "user_id": user_id,
                "title": chat["title"],
                "type": "ai_chat",
                "source_app": chat["source"],
                "created_at": chat["created_at"],
                "updated_at": chat["updated_at"],
                "num_messages": chat["num_messages"],
                "char_count": chat["char_count"],
                "preview": chat["preview"],
                "full_text": chat.get("full_text", ""),
                "cluster_id": chat["cluster_id"],
                "region": chat["region"],
                "color": chat["color"],
                "x": chat["x"],
                "y": chat["y"],
                "z": chat["z"]
            })
        try:
            supabase.table("knowledge_nodes")\
                .upsert(rows, on_conflict="id")\
                .execute()
        except Exception as e:
            print(f"Batch conversation upsert error: {e}")
            continue

    # Store embeddings in batches of 50
    for i in range(0, len(chats), batch_size):
        batch_chats = chats[i:i + batch_size]
        batch_embeddings = embeddings[i:i + batch_size]

        embedding_rows = []
        for j, chat in enumerate(batch_chats):
            embedding_rows.append({
                "conversation_id": chat["id"],
                "user_id": user_id,
                "embedding": batch_embeddings[j].tolist()
            })
        try:
            supabase.table("embeddings")\
                .upsert(
                    embedding_rows,
                    on_conflict="conversation_id,user_id"
                )\
                .execute()
        except Exception as e:
            print(f"Batch embedding upsert error: {e}")
            continue

def search_conversations(
    user_id: str,
    query_embedding: np.ndarray,
    limit: int = 5
) -> list[dict]:
    supabase = get_supabase()

    result = supabase.rpc(
        "match_conversations",
        {
            "query_embedding": query_embedding.tolist(),
            "match_user_id": user_id,
            "match_count": limit
        }
    ).execute()

    return result.data


def search_conversations_candidates(
    user_id: str,
    query_embedding: np.ndarray,
    limit: int = 20,
) -> list[dict]:
    """Fetch a larger candidate set for hybrid reranking."""
    supabase = get_supabase()
    result = supabase.rpc(
        "match_conversations",
        {
            "query_embedding": query_embedding.tolist(),
            "match_user_id": user_id,
            "match_count": max(5, limit),
        },
    ).execute()
    return result.data or []

def get_user_conversations(user_id: str) -> list[dict]:
    supabase = get_supabase()

    result = supabase.table("knowledge_nodes")\
        .select("*")\
        .eq("user_id", user_id)\
        .execute()

    return result.data

def save_user_integration(user_id: str, provider: str, token: str, metadata: dict = None) -> dict:
    supabase = get_supabase()
    row = {
        "user_id": user_id,
        "provider": provider,
        "access_token": token,
        "workspace_id": metadata.get("workspace_id") if metadata else None,
        "workspace_name": metadata.get("workspace_name") if metadata else None,
        "updated_at": "now()"
    }
    result = supabase.table("user_integrations").upsert(row, on_conflict="user_id,provider").execute()
    return result.data[0] if result.data else {}

def get_user_integration(user_id: str, provider: str) -> dict:
    supabase = get_supabase()
    result = supabase.table("user_integrations")\
        .select("*")\
        .eq("user_id", user_id)\
        .eq("provider", provider)\
        .execute()
    return result.data[0] if result.data else None

def get_personal_profile(user_id: str) -> dict:
    from services.personalization import normalize_profile_data

    supabase = get_supabase()
    result = supabase.table("personal_profiles")\
        .select("*")\
        .eq("user_id", user_id)\
        .execute()
    if not result.data:
        return {"user_id": user_id, "profile_data": {}, "is_profile_enabled": False}
    row = dict(result.data[0])
    row["profile_data"] = normalize_profile_data(row.get("profile_data"))
    return row

def update_personal_profile(user_id: str, profile_data: dict, is_profile_enabled: bool) -> dict:
    from services.personalization import normalize_profile_data

    supabase = get_supabase()
    row = {
        "user_id": user_id,
        "profile_data": normalize_profile_data(profile_data),
        "is_profile_enabled": is_profile_enabled,
        "updated_at": "now()"
    }
    result = supabase.table("personal_profiles").upsert(row, on_conflict="user_id").execute()
    return result.data[0] if result.data else {}


def update_personal_profile_inferred(
    user_id: str,
    profile_data: dict[str, Any],
    last_signal_at: str,
) -> dict:
    """Persist inferred profile updates without changing user opt-in state."""
    from services.personalization import normalize_profile_data

    supabase = get_supabase()
    existing = get_personal_profile(user_id)
    row = {
        "user_id": user_id,
        "profile_data": normalize_profile_data(profile_data),
        "is_profile_enabled": bool(existing.get("is_profile_enabled", False)),
        "last_inferred_at": last_signal_at,
        "last_signal_at": last_signal_at,
    }
    result = supabase.table("personal_profiles").upsert(row, on_conflict="user_id").execute()
    return result.data[0] if result.data else {}

def _sort_templates(templates: list[dict], sort: str = "popular") -> list[dict]:
    if sort == "popular":
        templates.sort(key=lambda t: (-(t.get("use_count") or 0), t.get("name") or ""))
    elif sort == "az":
        templates.sort(key=lambda t: (t.get("name") or "").lower())
    else:
        templates.sort(key=lambda t: (
            1 if (t.get("tier") or "standard") == "pro" else 0,
            t.get("category") or "",
            t.get("name") or "",
        ))
    return templates


def get_prompt_templates() -> list[dict]:
    supabase = get_supabase()
    result = supabase.table("prompt_templates")\
        .select("*")\
        .order("category")\
        .order("name")\
        .execute()
    templates = result.data if result.data else []
    return _sort_templates(templates, "category")


def search_prompt_templates(
    query: str = "",
    category: str = "",
    tag: str = "",
    tier: str = "",
    limit: int = 50,
    offset: int = 0,
    sort: str = "popular",
) -> tuple[list[dict], int]:
    supabase = get_supabase()
    q = supabase.table("prompt_templates").select("*", count="exact")

    if category:
        q = q.eq("category", category)
    if tier:
        q = q.eq("tier", tier)
    if tag:
        q = q.contains("tags", [tag.lower()])

    result = q.execute()
    templates = result.data if result.data else []

    if query:
        needle = query.lower().strip()
        templates = [
            t for t in templates
            if needle in (t.get("search_text") or "").lower()
            or needle in (t.get("name") or "").lower()
            or needle in (t.get("description") or "").lower()
            or any(needle in (tg or "").lower() for tg in (t.get("tags") or []))
        ]

    templates = _sort_templates(templates, sort)
    total = len(templates)
    page = templates[offset:offset + limit]
    return page, total


def get_template_categories() -> list[dict]:
    templates = get_prompt_templates()
    counts: dict[str, int] = {}
    for t in templates:
        cat = t.get("category") or "Other"
        counts[cat] = counts.get(cat, 0) + 1
    return [
        {"category": cat, "count": count}
        for cat, count in sorted(counts.items(), key=lambda x: (-x[1], x[0]))
    ]


def suggest_prompt_templates(draft: str, limit: int = 5) -> list[dict]:
    if not draft or not draft.strip():
        return []

    draft_lower = draft.lower()
    words = [w for w in draft_lower.split() if len(w) > 2]
    templates = get_prompt_templates()

    scored = []
    for t in templates:
        score = 0
        name = (t.get("name") or "").lower()
        desc = (t.get("description") or "").lower()
        search = (t.get("search_text") or "").lower()
        tags = [tg.lower() for tg in (t.get("tags") or [])]
        category = (t.get("category") or "").lower()

        for w in words:
            if w in name:
                score += 4
            if w in desc:
                score += 2
            if w in search:
                score += 1
            if any(w in tg for tg in tags):
                score += 3
            if w in category:
                score += 1

        if score > 0:
            score += min((t.get("use_count") or 0) // 10, 5)
            scored.append((score, t))

    scored.sort(key=lambda x: -x[0])
    return [t for _, t in scored[:limit]]


def increment_template_use(name: str) -> bool:
    supabase = get_supabase()
    result = supabase.table("prompt_templates")\
        .select("id, use_count")\
        .eq("name", name)\
        .limit(1)\
        .execute()
    if not result.data:
        return False
    row = result.data[0]
    new_count = (row.get("use_count") or 0) + 1
    supabase.table("prompt_templates")\
        .update({"use_count": new_count})\
        .eq("id", row["id"])\
        .execute()
    return True

def get_prompt_template_by_name(name: str) -> dict | None:
    supabase = get_supabase()
    result = supabase.table("prompt_templates")\
        .select("*")\
        .eq("name", name)\
        .limit(1)\
        .execute()
    return result.data[0] if result.data else None

def log_prompt_feedback(
    user_id: str,
    rating: int,
    goal: str = "",
    prompt_preview: str = "",
    template_used: str = "",
    conversations_used: int = 0,
    event_type: str = "rating",
    goal_hash: str = "",
    engineered_prompt_hash: str = "",
    final_prompt_hash: str = "",
    diff_metrics: dict | None = None,
    accepted_unedited: bool = False,
    edited: bool = False,
    latency_ms: int | None = None,
) -> None:
    supabase = get_supabase()
    supabase.table("prompt_feedback").insert({
        "user_id": user_id,
        "rating": rating,
        "event_type": event_type or "rating",
        "goal": goal[:500] if goal else "",
        "prompt_preview": prompt_preview[:2000] if prompt_preview else "",
        "template_used": template_used or "",
        "conversations_used": conversations_used,
        "goal_hash": goal_hash[:128] if goal_hash else "",
        "engineered_prompt_hash": engineered_prompt_hash[:128] if engineered_prompt_hash else "",
        "final_prompt_hash": final_prompt_hash[:128] if final_prompt_hash else "",
        "diff_metrics": diff_metrics or {},
        "accepted_unedited": bool(accepted_unedited),
        "edited": bool(edited),
        "latency_ms": latency_ms if latency_ms is not None else None,
    }).execute()


def increment_personalization_counter(user_id: str, key: str, amount: int = 1) -> None:
    supabase = get_supabase()
    from datetime import date
    day = date.today().isoformat()
    key = (key or "").strip().lower()
    if not key:
        return
    try:
        existing = supabase.table("personalization_metric_counters")\
            .select("id,value")\
            .eq("user_id", user_id)\
            .eq("metric_day", day)\
            .eq("key", key)\
            .limit(1)\
            .execute()
        if existing.data:
            row = existing.data[0]
            supabase.table("personalization_metric_counters")\
                .update({"value": int(row.get("value", 0)) + int(amount)})\
                .eq("id", row["id"])\
                .execute()
            return
    except Exception:
        # Fall through to blind upsert for compatibility
        pass

    supabase.table("personalization_metric_counters").upsert({
        "user_id": user_id,
        "metric_day": day,
        "key": key,
        "value": int(amount),
    }, on_conflict="user_id,metric_day,key").execute()


def log_growth_event(user_id: str, event: str, platform: str | None = None) -> None:
    """Metadata-only activation/funnel event (no prompt or conversation content).
    Never raises — a missed growth metric must not break the caller's request."""
    if not user_id or not event:
        return
    try:
        supabase = get_supabase()
        supabase.table("growth_events").insert({
            "user_id": user_id,
            "event": event,
            "platform": (platform or "")[:50] or None,
        }).execute()
    except Exception as exc:
        print(f"growth_events insert warning: {exc}")


def record_user_consent(user_id: str, consent_version: str, source: str = "extension") -> dict:
    """Persist consent timestamp and version for audit."""
    supabase = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("users").update({
        "consent_at": now,
        "consent_version": consent_version,
        "consent_source": source,
    }).eq("id", user_id).execute()
    try:
        supabase.table("consent_events").insert({
            "user_id": user_id,
            "consent_version": consent_version,
            "source": source,
            "created_at": now,
        }).execute()
    except Exception as exc:
        print(f"consent_events insert warning: {exc}")
    return {"consent_at": now, "consent_version": consent_version, "consent_source": source}


def get_user_consent_info(user_id: str) -> dict:
    """Latest consent on users row plus append-only event count."""
    supabase = get_supabase()
    user = supabase.table("users")\
        .select("consent_at, consent_version, consent_source")\
        .eq("id", user_id)\
        .execute()
    row = user.data[0] if user.data else {}
    try:
        events = supabase.table("consent_events")\
            .select("id", count="exact")\
            .eq("user_id", user_id)\
            .execute()
        event_count = events.count or 0
    except Exception:
        event_count = 1 if row.get("consent_at") else 0
    return {
        "consent_at": row.get("consent_at"),
        "consent_version": row.get("consent_version"),
        "consent_source": row.get("consent_source"),
        "consent_event_count": event_count,
    }


def revoke_team_sharing(user_id: str) -> dict:
    """Set all team-visible conversations back to private for this user."""
    supabase = get_supabase()
    team = supabase.table("knowledge_nodes")\
        .select("id")\
        .eq("user_id", user_id)\
        .eq("visibility", "team")\
        .execute()
    ids = [row["id"] for row in (team.data or [])]
    if not ids:
        return {"revoked": 0}

    supabase.table("knowledge_nodes")\
        .update({"visibility": "private"})\
        .eq("user_id", user_id)\
        .eq("visibility", "team")\
        .execute()
    return {"revoked": len(ids)}


def delete_conversation(user_id: str, conversation_id: str) -> dict:
    """Delete a single conversation and its embedding for this user."""
    supabase = get_supabase()
    conv = supabase.table("knowledge_nodes")\
        .select("id")\
        .eq("id", conversation_id)\
        .eq("user_id", user_id)\
        .execute()
    if not conv.data:
        return {"deleted": False, "reason": "not_found"}

    supabase.table("embeddings")\
        .delete()\
        .eq("conversation_id", conversation_id)\
        .eq("user_id", user_id)\
        .execute()
    supabase.table("knowledge_nodes")\
        .delete()\
        .eq("id", conversation_id)\
        .eq("user_id", user_id)\
        .execute()
    return {"deleted": True, "id": conversation_id}


def clear_inferred_profile(user_id: str) -> dict:
    """Remove inferred profile fields; keep user-entered popup profile text."""
    profile = get_personal_profile(user_id)
    data = profile.get("profile_data") or {}
    kept = {
        k: data[k]
        for k in ("background", "situation", "goals", "constraints")
        if isinstance(data.get(k), str) and data[k].strip()
    }
    prefs = data.get("preferences")
    if isinstance(prefs, str) and prefs.strip():
        kept["preferences"] = prefs

    supabase = get_supabase()
    supabase.table("personal_profiles").upsert({
        "user_id": user_id,
        "profile_data": kept,
        "is_profile_enabled": bool(profile.get("is_profile_enabled", False)),
        "last_inferred_at": None,
        "last_signal_at": None,
    }, on_conflict="user_id").execute()
    return {"cleared": True, "profile_data": kept}


def export_user_data(user_id: str, email: str) -> dict:
    """Return a portable JSON export of stored user data (no embeddings)."""
    conversations = get_user_conversations(user_id)
    profile = get_personal_profile(user_id)
    consent = get_user_consent_info(user_id)

    conv_export = []
    for conv in conversations:
        conv_export.append({
            "id": conv.get("id"),
            "title": conv.get("title"),
            "source_app": conv.get("source_app"),
            "created_at": conv.get("created_at"),
            "updated_at": conv.get("updated_at"),
            "num_messages": conv.get("num_messages"),
            "char_count": conv.get("char_count"),
            "preview": conv.get("preview"),
            "full_text": conv.get("full_text"),
            "visibility": conv.get("visibility", "private"),
        })

    profile_data = profile.get("profile_data") or {}
    manual_keys = ("background", "situation", "goals", "constraints", "preferences")
    manual_profile = {
        k: profile_data[k]
        for k in manual_keys
        if isinstance(profile_data.get(k), str) and profile_data[k].strip()
    }
    inferred_fields = {
        "domains": profile_data.get("domains") or {},
        "active_projects": profile_data.get("active_projects") or [],
        "confirmed_anchors": profile_data.get("confirmed_anchors") or {},
        "adaptive_weights": profile_data.get("adaptive_weights") or {},
        "quality_metrics": profile_data.get("quality_metrics") or {},
        "inferred_preferences": profile_data.get("preferences") or {},
    }
    return {
        "export_version": "1.2",
        "email": email,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "conversation_count": len(conv_export),
        "conversations": conv_export,
        "consent": consent,
        "profile": {
            "is_profile_enabled": bool(profile.get("is_profile_enabled", False)),
            "profile_data": profile_data,
            "manual_profile": manual_profile,
            "inferred_fields": inferred_fields,
            "last_inferred_at": profile.get("last_inferred_at"),
            "last_signal_at": profile.get("last_signal_at"),
        },
        "excluded_from_export": [
            "semantic_embedding_vectors",
            "session_tokens_and_api_key_hashes",
            "prompt_feedback_metric_rows",
            "internal_cluster_coordinates_metadata",
        ],
        "export_notes": (
            "Includes full conversation text, manually entered profile fields, and inferred "
            "profile (domains with expertise/confidence, active projects, confirmed anchors, "
            "adaptive weights, quality metrics). Does not include 384-dim embedding vectors, "
            "auth tokens, or raw prompt_feedback database rows."
        ),
    }


def delete_user_data(user_id: str) -> dict:
    """Delete all stored data for a user account."""
    supabase = get_supabase()

    conv_result = supabase.table("knowledge_nodes")\
        .select("id")\
        .eq("user_id", user_id)\
        .execute()
    conversation_count = len(conv_result.data or [])

    supabase.table("embeddings").delete().eq("user_id", user_id).execute()
    supabase.table("knowledge_nodes").delete().eq("user_id", user_id).execute()
    supabase.table("prompt_feedback").delete().eq("user_id", user_id).execute()
    supabase.table("personalization_metric_counters").delete().eq("user_id", user_id).execute()
    supabase.table("personal_profiles").delete().eq("user_id", user_id).execute()
    supabase.table("user_integrations").delete().eq("user_id", user_id).execute()

    supabase.table("users").update({"company_id": None}).eq("id", user_id).execute()
    supabase.table("users").delete().eq("id", user_id).execute()

    return {"deleted": True, "conversation_count": conversation_count}
