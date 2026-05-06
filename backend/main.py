from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import json
import os
import pandas as pd
from dotenv import load_dotenv

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

        user_id = get_or_create_user(request.email)

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

@app.post("/summarize")
async def summarize(request: SummarizeRequest):
    try:
        from services.database import get_or_create_user, get_user_conversations
        import anthropic

        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(status_code=400, detail="API key not configured")

        user_id = get_or_create_user(request.email)

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

@app.post("/blend")
async def blend(request: BlendRequest):
    api_key = request.api_key or os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="API key required")

    if not request.conversation_ids:
        raise HTTPException(status_code=400, detail="No conversations selected")

    raise HTTPException(
        status_code=501,
        detail="Blend endpoint requires database integration - coming soon"
    )

@app.get("/")
def root():
    return {
        "name": "Mind World API",
        "version": "1.0.0",
        "endpoints": ["/health", "/process", "/blend"]
    }
