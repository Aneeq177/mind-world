import uuid
from datetime import datetime
from services.database import get_supabase, get_user_integration
from services.embedder import embed_single

def fetch_mock_notion_pages(access_token: str):
    """
    Mock implementation of fetching Notion pages.
    In a real implementation, this would use the Notion API to list pages and retrieve blocks.
    """
    # Return some fake technical documents that might be in a user's Notion
    return [
        {
            "id": f"notion-{str(uuid.uuid4())[:8]}",
            "title": "Q3 Engineering Roadmap",
            "content": "# Q3 Engineering Roadmap\n\nOur primary goal for Q3 is to stabilize the backend architecture and introduce the new Multi-Source Knowledge Graph. We will start by integrating Notion and Google Drive. The team will also focus on reducing technical debt in the React frontend by migrating to Zustand for state management.",
            "created_at": datetime.now().isoformat()
        },
        {
            "id": f"notion-{str(uuid.uuid4())[:8]}",
            "title": "Onboarding Guide: Setting up your dev environment",
            "content": "# Dev Environment Setup\n\nWelcome to the team! To get started, you'll need to install Python 3.10 and Node.js. Clone the repository and run `npm install` in the frontend directory. For the backend, create a virtual environment and run `pip install -r requirements.txt`. Make sure to copy the `.env.example` file to `.env` and fill in the database credentials.",
            "created_at": datetime.now().isoformat()
        },
        {
            "id": f"notion-{str(uuid.uuid4())[:8]}",
            "title": "Meeting Notes: AI Feature Brainstorm",
            "content": "# AI Feature Brainstorm\n\nAttendees: Alex, Sarah, Mike\n\nIdeas discussed:\n- Auto-summarizing long conversation threads using Claude Haiku.\n- Suggesting related documents when a user is typing a question.\n- Building a 3D visualization map of all company knowledge to help new hires find information quickly.",
            "created_at": datetime.now().isoformat()
        }
    ]

async def sync_notion_workspace(user_id: str, email: str):
    """
    Background worker to fetch Notion pages, embed them, and save to database.
    """
    try:
        supabase = get_supabase()
        
        # 1. Get integration token
        integration = get_user_integration(user_id, "notion")
        if not integration:
            print(f"[Notion Sync] No Notion integration found for user {user_id}")
            return
            
        token = integration["access_token"]
        print(f"[Notion Sync] Starting sync for user {user_id}")
        
        # 2. Fetch pages
        pages = fetch_mock_notion_pages(token)
        print(f"[Notion Sync] Fetched {len(pages)} mock pages")
        
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
                "source_app": "notion",
                "created_at": page["created_at"],
                "updated_at": page["created_at"],
                "num_messages": 1,
                "char_count": len(content),
                "preview": content[:300],
                "full_text": content,
                "cluster_id": -1,
                "region": "Recent",
                "color": "#888888",
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
            
        print(f"[Notion Sync] Successfully synced {len(pages)} Notion pages.")
        
        # 4. Trigger recluster to position the new nodes
        from main import run_recluster
        await run_recluster(email)
        
    except Exception as e:
        print(f"[Notion Sync] Error during sync: {e}")
