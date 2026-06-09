from supabase import create_client, Client
import os
import numpy as np

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
    supabase = get_supabase()
    result = supabase.table("personal_profiles")\
        .select("*")\
        .eq("user_id", user_id)\
        .execute()
    return result.data[0] if result.data else {"user_id": user_id, "profile_data": {}, "is_profile_enabled": False}

def update_personal_profile(user_id: str, profile_data: dict, is_profile_enabled: bool) -> dict:
    supabase = get_supabase()
    row = {
        "user_id": user_id,
        "profile_data": profile_data,
        "is_profile_enabled": is_profile_enabled,
        "updated_at": "now()"
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
) -> None:
    supabase = get_supabase()
    supabase.table("prompt_feedback").insert({
        "user_id": user_id,
        "rating": rating,
        "goal": goal[:500] if goal else "",
        "prompt_preview": prompt_preview[:2000] if prompt_preview else "",
        "template_used": template_used or "",
        "conversations_used": conversations_used,
    }).execute()
