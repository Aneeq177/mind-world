from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import json
import os
import pandas as pd
from dotenv import load_dotenv

from typing import Optional

from pydantic import BaseModel
from models import ProcessResponse, BlendRequest, BlendResponse
from services.parser import parse_claude, parse_chatgpt
from services.embedder import embed_and_position
from services.blender import label_clusters, blend_conversations
from services.database import (
    get_or_create_user,
    store_conversations,
    get_user_conversations
)

load_dotenv()

app = FastAPI(title="Mind World API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}

@app.post("/process")
async def process_files(
    claude_file: UploadFile | None = File(None),
    chatgpt_file: UploadFile | None = File(None),
    api_key: str = Form(...),
    email: str = Form(...)
):
    if not claude_file and not chatgpt_file:
        raise HTTPException(
            status_code=400,
            detail="At least one file required"
        )

    all_dfs = []

    try:
        if claude_file:
            content = await claude_file.read()
            data = json.loads(
                content.decode('utf-8-sig', errors='replace')
            )
            df = parse_claude(data)
            all_dfs.append(df)

        if chatgpt_file:
            content = await chatgpt_file.read()
            df = parse_chatgpt(content)
            all_dfs.append(df)

        if not all_dfs:
            raise HTTPException(
                status_code=400,
                detail="No conversations found"
            )

        df = pd.concat(all_dfs, ignore_index=True)

        if len(df) == 0:
            raise HTTPException(
                status_code=400,
                detail="No conversations found"
            )

        chats, embeddings = embed_and_position(df)
        chats = label_clusters(chats, api_key)

        try:
            email = email.lower().strip()
            user_id = get_or_create_user(email)
            store_conversations(user_id, chats, embeddings)
        except Exception as db_error:
            print(f"DB storage error: {db_error}")
            user_id = None

        sources = {
            "claude": sum(
                1 for c in chats if c['source'] == 'claude'
            ),
            "chatgpt": sum(
                1 for c in chats if c['source'] == 'chatgpt'
            )
        }

        for chat in chats:
            chat.pop('full_text', None)

        return {
            "conversations": chats,
            "total": len(chats),
            "sources": sources,
            "user_id": user_id
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SearchRequest(BaseModel):
    query: str
    email: str
    limit: int = 5

@app.post("/search")
async def search(request: SearchRequest):
    try:
        from services.database import search_conversations
        from sentence_transformers import SentenceTransformer

        email = request.email.lower().strip()
        user_id = get_or_create_user(email)

        model = SentenceTransformer('all-MiniLM-L6-v2')
        query_embedding = model.encode([request.query])[0]

        results = search_conversations(
            user_id,
            query_embedding,
            request.limit
        )

        return {"results": results, "query": request.query}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SummarizeRequest(BaseModel):
    conversation_ids: list[str]
    current_query: str
    email: str
    api_key: Optional[str] = None

class EngineerPromptRequest(BaseModel):
    email: str
    message: str
    conversation_ids: Optional[list[str]] = None
    api_key: Optional[str] = None

@app.post("/summarize")
async def summarize(request: SummarizeRequest):
    try:
        from services.database import get_or_create_user, get_user_conversations
        import anthropic

        api_key = request.api_key or os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=400,
                detail="Anthropic API key required — add one in the extension or configure the server.",
            )

        email = request.email.lower().strip()
        user_id = get_or_create_user(email)

        # Get all user conversations from DB
        all_convos = get_user_conversations(user_id)

        # Filter to requested IDs
        selected = [
            c for c in all_convos
            if c['id'] in request.conversation_ids
        ]

        if not selected:
            raise HTTPException(
                status_code=404,
                detail="Conversations not found"
            )

        client = anthropic.Anthropic(api_key=api_key)
        summaries = []

        for convo in selected:
            prompt = f"""You are summarizing a past AI conversation to use as context in a new chat.

Current question the user is asking: "{request.current_query}"

Past conversation title: "{convo['title']}"
Past conversation content:
{convo.get('full_text', convo.get('preview', ''))[:3000]}

Extract ONLY what is relevant to the current question. Summarize in this format:

CONVERSATION: {convo['title']}
RELEVANT CONTEXT: (2-3 sentences about what was discussed that relates to the current question)
KEY POINTS:
- (bullet point 1)
- (bullet point 2)
- (bullet point 3 if needed)

Be concise and specific. Focus on information that will help answer the current question."""

            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=400,
                messages=[{"role": "user", "content": prompt}]
            )

            summaries.append({
                "id": convo['id'],
                "title": convo['title'],
                "summary": response.content[0].text.strip(),
                "source": convo.get('source', 'claude'),
                "created_at": convo.get('created_at', '')
            })

        # Build the full formatted context block
        context_block = "=== MIND WORLD MEMORY CONTEXT ===\n"
        context_block += f"Relevant past conversations for: \"{request.current_query}\"\n\n"

        for i, s in enumerate(summaries, 1):
            source_label = "Claude" if s['source'] == 'claude' else "ChatGPT"
            context_block += f"[{i}] {s['summary']}\n"
            context_block += f"Source: {source_label} · {s['created_at'][:10]}\n"
            if i < len(summaries):
                context_block += "\n---\n\n"

        context_block += "\n=== END CONTEXT ===\n\n"
        context_block += "Using the above context from my past conversations, please help me with:\n"

        return {
            "summaries": summaries,
            "context_block": context_block,
            "conversation_count": len(summaries)
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/engineer_prompt")
async def engineer_prompt(request: EngineerPromptRequest):
    try:
        import anthropic
        from sentence_transformers import SentenceTransformer
        from services.database import search_conversations

        api_key = request.api_key or os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=400,
                detail="Anthropic API key required — add one in the extension or configure the server."
            )

        email = request.email.lower().strip()
        user_id = get_or_create_user(email)

        if request.conversation_ids:
            print(f"[engineer_prompt] Looking for conversation IDs: {request.conversation_ids}")
            all_convos = get_user_conversations(user_id)
            selected = [c for c in all_convos if c["id"] in request.conversation_ids]
            print(f"[engineer_prompt] Found {len(selected)} conversations with user_id filter")
            for c in selected:
                print(f"  - {c.get('id')} | title: {c.get('title')} | text_length: {len(c.get('full_text') or '')}")

            # Fallback: try fetching by ID without user_id filter
            if not selected:
                print("[engineer_prompt] Retrying without user_id filter")
                from services.database import get_supabase
                supabase = get_supabase()
                result = supabase.table("conversations")\
                    .select("id, title, full_text, preview, created_at, num_messages, source")\
                    .in_("id", request.conversation_ids)\
                    .execute()
                selected = result.data or []
                print(f"[engineer_prompt] Found {len(selected)} conversations without user_id filter")
                for c in selected:
                    print(f"  - {c.get('id')} | title: {c.get('title')} | text_length: {len(c.get('full_text') or '')}")
        else:
            model = SentenceTransformer("all-MiniLM-L6-v2")
            embedding = model.encode([request.message])[0]
            selected = search_conversations(user_id, embedding, limit=5)

        context_parts = []
        for conv in selected:
            full_text = conv.get('full_text') or conv.get('preview') or ''
            if full_text:
                context_parts.append(
                    f"Conversation: {conv.get('title', 'Untitled')}\n"
                    f"Date: {str(conv.get('created_at', ''))[:10]}\n"
                    f"Messages: {conv.get('num_messages', 0)}\n"
                    f"Content:\n{full_text[:3000]}"
                )
        conv_context = "\n\n---\n\n".join(context_parts) if context_parts else ""

        if not conv_context.strip():
            print(f"[engineer_prompt] No context content — selected={len(selected)}, context_parts={len(context_parts)}")
            return {
                "engineered_prompt": (
                    f"I need help with: {request.message}\n\n"
                    "(Note: Could not load context from selected conversations. "
                    "Please try re-uploading your conversation history at mind-world.app)"
                ),
                "conversations_used": 0
            }

        system_prompt = """You are an expert prompt engineer. Transform the user's rough message into a complete, well-structured prompt that will get the best possible response from an AI assistant.

You will receive the user's original message and relevant excerpts from their past AI conversations.

Your task:
1. Classify the intent: advice / continuation / learning / building / decision
2. Extract ONLY facts, decisions, preferences, and constraints from past conversations that are genuinely relevant to this specific question
3. Engineer a complete prompt using EXACTLY this format:

---
[CONTEXT FROM YOUR HISTORY]

WHO YOU ARE (relevant to this question):
• [relevant background facts about the user from past conversations]

WHAT YOU HAVE ALREADY EXPLORED:
• [relevant past thinking, research, or attempts]

WHAT HAS BEEN DECIDED OR RULED OUT:
• [decisions already made, things already tried]

[YOUR QUESTION]
[the user's question reframed for clarity and specificity, with relevant constraints embedded]
---

Rules:
- Omit any section that has nothing relevant to contribute — do not include empty sections
- Reframe the question to be specific, actionable, and grounded in the user's actual situation
- Never invent or assume information not present in the past conversations
- Keep the entire output under 500 words
- Output ONLY the engineered prompt. No preamble, no explanation, no commentary."""

        user_content = f"User's message:\n{request.message}\n\nRelevant past conversations:\n{conv_context}"

        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1000,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}]
        )

        return {
            "engineered_prompt": response.content[0].text,
            "conversations_used": len(selected)
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class UserStatsRequest(BaseModel):
    email: str

@app.post("/user_stats")
async def user_stats(request: UserStatsRequest):
    try:
        from services.database import get_or_create_user
        from services.database import get_supabase

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = get_or_create_user(email)

        # Count conversations
        conv_result = supabase.table("conversations")\
            .select("id, source")\
            .eq("user_id", user_id)\
            .execute()

        conversations = conv_result.data or []
        sources = set(c.get('source', '') for c in conversations)

        return {
            "conversation_count": len(conversations),
            "platform_count": len(sources),
            "sources": list(sources)
        }
    except Exception as e:
        return {
            "conversation_count": 0,
            "platform_count": 0,
            "sources": []
        }

@app.post("/blend")
async def blend(request: BlendRequest):
    api_key = request.api_key or os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="API key required")

    if not request.conversation_ids:
        raise HTTPException(status_code=400, detail="No conversations selected")

    from services.database import get_user_conversations, get_or_create_user
    try:
        email = request.email.lower().strip()
        user_id = get_or_create_user(email)
        all_convos = get_user_conversations(user_id)
        selected = [c for c in all_convos if c['id'] in request.conversation_ids]
        
        if not selected:
            raise HTTPException(status_code=404, detail="Conversations not found")
            
        return blend_conversations(selected, request.question, api_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SaveConversationRequest(BaseModel):
    email: str
    conversation: dict

@app.post("/save_conversation")
async def save_conversation(request: SaveConversationRequest):
    try:
        from services.database import get_or_create_user
        from services.database import get_supabase
        from services.embedder import embed_single

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = get_or_create_user(email)
        convo = request.conversation

        messages = convo.get('messages', [])
        text_parts = []
        for msg in messages:
            role = msg.get('role', 'unknown')
            content = msg.get('content', '')
            if content:
                text_parts.append(f"[{role}] {content}")

        full_text = '\n\n'.join(text_parts)

        if len(full_text.strip()) < 10:
            return {"success": False, "reason": "too_short"}

        conv_id = convo.get('id', '')
        if not conv_id:
            return {"success": False, "reason": "no_id"}

        embed_text = f"{convo.get('title', 'Untitled')}. {full_text[:500]}"
        embedding = embed_single(embed_text)

        platform = convo.get('platform', 'claude.ai')
        if 'chatgpt' in platform:
            source = 'chatgpt'
        else:
            source = 'claude'

        row = {
            "id": conv_id,
            "user_id": user_id,
            "title": convo.get('title', 'Untitled'),
            "source": source,
            "created_at": convo.get('saved_at', ''),
            "updated_at": convo.get('saved_at', ''),
            "num_messages": len(messages),
            "char_count": len(full_text),
            "preview": full_text[:300],
            "full_text": full_text[:8000],
            "cluster_id": -1,
            "region": "Recent",
            "color": "#888888",
            "x": 0.0,
            "y": 0.0,
            "z": 0.0,
            "visibility": "private"
        }

        supabase.table("conversations").upsert(
            row, on_conflict="id"
        ).execute()

        supabase.table("embeddings").upsert({
            "conversation_id": conv_id,
            "user_id": user_id,
            "embedding": embedding.tolist()
        }, on_conflict="conversation_id,user_id").execute()

        return {"success": True, "id": conv_id}

    except Exception as e:
        return {"success": False, "reason": str(e)}

class LoadMapRequest(BaseModel):
    email: str

@app.post("/load_map")
async def load_map(request: LoadMapRequest):
    try:
        from services.database import get_supabase

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = get_or_create_user(email)

        result = supabase.table("conversations")\
            .select("*")\
            .eq("user_id", user_id)\
            .execute()

        conversations = result.data or []

        if not conversations:
            return {
                "conversations": [],
                "total": 0,
                "sources": {"claude": 0, "chatgpt": 0},
                "user_id": user_id,
                "has_data": False
            }

        formatted = []
        for c in conversations:
            formatted.append({
                "id": c.get("id", ""),
                "title": c.get("title", "Untitled"),
                "source": c.get("source", "claude"),
                "x": c.get("x", 0.0),
                "y": c.get("y", 0.0),
                "z": c.get("z", 0.0),
                "color": c.get("color", "#888888"),
                "region": c.get("region", "Other"),
                "num_messages": c.get("num_messages", 0),
                "char_count": c.get("char_count", 0),
                "preview": c.get("preview", ""),
                "created_at": c.get("created_at", ""),
                "updated_at": c.get("updated_at", ""),
                "cluster_id": c.get("cluster_id", -1),
                "visibility": c.get("visibility", "private")
            })

        sources = {
            "claude": sum(1 for c in formatted if c["source"] == "claude"),
            "chatgpt": sum(1 for c in formatted if c["source"] == "chatgpt")
        }

        return {
            "conversations": formatted,
            "total": len(formatted),
            "sources": sources,
            "user_id": user_id,
            "has_data": True
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ReclusterRequest(BaseModel):
    email: str

@app.post("/recluster")
async def recluster(request: ReclusterRequest):
    try:
        from services.database import get_or_create_user
        from services.database import get_supabase
        import numpy as np

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = get_or_create_user(email)

        # Get all conversations for this user
        result = supabase.table("conversations")\
            .select("id, title, full_text, x, y")\
            .eq("user_id", user_id)\
            .execute()

        all_convos = result.data or []

        if not all_convos:
            # Try without user_id filter
            result = supabase.table("conversations")\
                .select("id, title, full_text, x, y")\
                .execute()
            all_convos = result.data or []

        if not all_convos:
            return {"success": False, "reason": "no conversations found"}

        # Separate positioned and unpositioned
        unpositioned = [c for c in all_convos
                        if c.get('x', 0) == 0 and c.get('y', 0) == 0]

        if not unpositioned:
            return {
                "success": True,
                "message": "All conversations already positioned",
                "repositioned": 0
            }

        # Build texts for all conversations
        all_texts = []
        for c in all_convos:
            title = c.get('title', 'Untitled')
            text = (c.get('full_text') or '')[:500]
            all_texts.append(f"{title}. {text}")

        # Embed all texts
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer('all-MiniLM-L6-v2')
        embeddings = model.encode(all_texts, show_progress_bar=False)

        # Run UMAP on all embeddings together
        import umap
        n_neighbors = min(10, len(all_convos) - 1)
        reducer = umap.UMAP(
            n_components=2,
            n_neighbors=n_neighbors,
            min_dist=0.3,
            metric='cosine',
            random_state=42
        )
        coords = reducer.fit_transform(embeddings)

        # Normalize to 0-1000 range
        x_min, x_max = coords[:, 0].min(), coords[:, 0].max()
        y_min, y_max = coords[:, 1].min(), coords[:, 1].max()

        coords_norm = np.zeros_like(coords)
        coords_norm[:, 0] = (coords[:, 0] - x_min) / (x_max - x_min + 1e-8) * 900 + 50
        coords_norm[:, 1] = (coords[:, 1] - y_min) / (y_max - y_min + 1e-8) * 900 + 50

        # Update only the unpositioned conversations
        updated = 0
        for i, conv in enumerate(all_convos):
            if conv.get('x', 0) == 0 and conv.get('y', 0) == 0:
                supabase.table("conversations")\
                    .update({
                        "x": float(coords_norm[i, 0]),
                        "y": float(coords_norm[i, 1])
                    })\
                    .eq("id", conv["id"])\
                    .execute()
                updated += 1

        return {
            "success": True,
            "repositioned": updated,
            "total": len(all_convos)
        }

    except Exception as e:
        import traceback
        return {"success": False, "reason": str(e),
                "trace": traceback.format_exc()}


@app.get("/")
def root():
    return {
        "name": "Mind World API",
        "version": "1.0.0",
        "endpoints": ["/health", "/process", "/blend", "/recluster"]
    }
