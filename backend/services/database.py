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

    result = supabase.table("users")\
        .select("id")\
        .eq("email", email)\
        .execute()

    if result.data:
        return result.data[0]["id"]

    result = supabase.table("users")\
        .insert({"email": email})\
        .execute()

    return result.data[0]["id"]

def store_conversations(
    user_id: str,
    chats: list[dict],
    embeddings: np.ndarray
):
    supabase = get_supabase()

    rows = []
    for chat in chats:
        rows.append({
            "id": chat["id"],
            "user_id": user_id,
            "title": chat["title"],
            "source": chat["source"],
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

    supabase.table("conversations")\
        .upsert(rows)\
        .execute()

    embedding_rows = []
    for i, chat in enumerate(chats):
        embedding_rows.append({
            "conversation_id": chat["id"],
            "user_id": user_id,
            "embedding": embeddings[i].tolist()
        })

    supabase.table("embeddings")\
        .upsert(embedding_rows)\
        .execute()

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

    result = supabase.table("conversations")\
        .select("*")\
        .eq("user_id", user_id)\
        .execute()

    return result.data
