from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import json
import os
import pandas as pd
from dotenv import load_dotenv

from models import ProcessResponse, BlendRequest, BlendResponse
from services.parser import parse_claude, parse_chatgpt
from services.embedder import embed_and_position
from services.blender import label_clusters, blend_conversations

load_dotenv()

app = FastAPI(title="Mind World API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}

@app.post("/process")
async def process_files(
    claude_file: UploadFile | None = File(None),
    chatgpt_file: UploadFile | None = File(None),
    api_key: str = Form(...)
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
            data = json.loads(content.decode('utf-8-sig', errors='replace'))
            df = parse_claude(data)
            all_dfs.append(df)

        if chatgpt_file:
            content = await chatgpt_file.read()
            df = parse_chatgpt(content)
            all_dfs.append(df)

        if not all_dfs:
            raise HTTPException(status_code=400, detail="No conversations found")

        df = pd.concat(all_dfs, ignore_index=True)

        if len(df) == 0:
            raise HTTPException(status_code=400, detail="No conversations found")

        chats = embed_and_position(df)
        chats = label_clusters(chats, api_key)

        sources = {
            "claude": sum(1 for c in chats if c['source'] == 'claude'),
            "chatgpt": sum(1 for c in chats if c['source'] == 'chatgpt')
        }

        for chat in chats:
            chat.pop('full_text', None)

        return {
            "conversations": chats,
            "total": len(chats),
            "sources": sources
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
