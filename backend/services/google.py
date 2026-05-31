import uuid
from datetime import datetime
from services.database import get_supabase, get_user_integration
from services.embedder import embed_single

def fetch_mock_google_docs(access_token: str):
    """
    Mock implementation of fetching Google Docs.
    In a real implementation, this would use the Google Drive API to list .gdoc files 
    and export them as plain text.
    """
    # Return fake design and marketing documents
    return [
        {
            "id": f"gdoc-{str(uuid.uuid4())[:8]}",
            "title": "Marketing Strategy Q3",
            "content": "Google Docs\nMarketing Strategy Q3\n\nOur main focus for Q3 is to drive awareness of the new Mind World mapping features. We will launch a social media campaign targeting productivity enthusiasts and knowledge workers. We need to finalize the ad creatives by August 15th.",
            "created_at": datetime.now().isoformat()
        },
        {
            "id": f"gdoc-{str(uuid.uuid4())[:8]}",
            "title": "Brand Guidelines v2",
            "content": "Google Docs\nBrand Guidelines v2\n\nThe Mind World brand revolves around clarity, structure, and connection. Primary colors are deep purple (#c084fc) and dark slate (#1e293b). Typography should exclusively use Inter for body text and Space Grotesk for headings.",
            "created_at": datetime.now().isoformat()
        },
        {
            "id": f"gdoc-{str(uuid.uuid4())[:8]}",
            "title": "User Interview: Sarah J.",
            "content": "Google Docs\nUser Interview Notes\n\nSubject: Sarah J.\nRole: Product Manager\n\nFeedback: Sarah mentioned that she struggles to find old decisions made in Slack and ChatGPT. She likes the visual map approach but requested an integration with Google Docs where her team writes most of their PRDs.",
            "created_at": datetime.now().isoformat()
        }
    ]

async def sync_google_workspace(user_id: str, email: str):
    """
    Background worker to fetch Google Docs, embed them, and save to database.
    """
    try:
        supabase = get_supabase()
        
        # 1. Get integration token
        integration = get_user_integration(user_id, "google")
        if not integration:
            print(f"[Google Sync] No Google integration found for user {user_id}")
            return
            
        token = integration["access_token"]
        print(f"[Google Sync] Starting sync for user {user_id}")
        
        # 2. Fetch pages
        pages = fetch_mock_google_docs(token)
        print(f"[Google Sync] Fetched {len(pages)} mock docs")
        
        # 3. Process, embed, and save
        for page in pages:
            doc_id = page["id"]
            title = page["title"]
            content = page["content"]
            
            # Embed the text
            embed_text = f"{title}. {content[:500]}"
            embedding = embed_single(embed_text)
            
            # Prepare knowledge node row
            row = {
                "id": doc_id,
                "user_id": user_id,
                "title": title,
                "type": "document",
                "source_app": "google",
                "created_at": page["created_at"],
                "updated_at": page["created_at"],
                "num_messages": 1,
                "char_count": len(content),
                "preview": content[:300],
                "full_text": content,
                "cluster_id": -1,
                "region": "Recent",
                "color": "#3b82f6", # Google blue
                "x": 0.0,
                "y": 0.0,
                "z": 0.0,
                "visibility": "private"
            }
            
            # Insert into knowledge_nodes
            supabase.table("knowledge_nodes").upsert(row, on_conflict="id").execute()
            
            # Insert embedding
            supabase.table("embeddings").upsert({
                "conversation_id": doc_id,
                "user_id": user_id,
                "embedding": embedding.tolist()
            }, on_conflict="conversation_id,user_id").execute()
            
        print(f"[Google Sync] Successfully synced {len(pages)} Google Docs.")
        
        # 4. Trigger recluster to position the new nodes
        from main import run_recluster
        await run_recluster(email)
        
    except Exception as e:
        print(f"[Google Sync] Error during sync: {e}")
