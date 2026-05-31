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
