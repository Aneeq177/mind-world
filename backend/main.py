# Import statements
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import json
import os
import pandas as pd
from dotenv import load_dotenv

from typing import Optional

from pydantic import BaseModel
from models import BlendRequest # Import models from models.py
from services.parser import parse_claude, parse_chatgpt # Import functions from parser.py
from services.database import (
    get_or_create_user,
    store_conversations,
    get_user_conversations
) # Import functions from database.py
from services.personalization import (
    extract_relevant_profile_facts,
    extract_confirmed_anchor_facts,
    hybrid_score_conversations,
    apply_edit_feedback_adaptation,
    compute_summary_confidence,
    has_enough_history,
    should_prompt_confirmation,
    apply_summary_confirmation,
)

load_dotenv() # Load environment variables from .env file

def _user_id(email: str, access_token: Optional[str] = None, api_key: Optional[str] = None) -> str:
    from services.auth import authenticate_user
    return authenticate_user(email, access_token, api_key)

app = FastAPI(title="Mind World API", version="1.0.0") # Create FastAPI app

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        response: StarletteResponse = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cache-Control"] = "no-store"
        return response

app.add_middleware(SecurityHeadersMiddleware)

@app.get("/health") # Simple health check (Basically just checks if the server is running)
def health():
    return {"status": "ok", "version": "1.0.0"}

@app.post("/process") # So /process here is the endpoint that handels the file uploads, processes them and them and then creates the 2D mind world
async def process_files(
    claude_file: UploadFile | None = File(None), 
    chatgpt_file: UploadFile | None = File(None), 
    api_key: str = Form(""), # API key for the user (user is asked to enter their key)
    email: str = Form(...),
    access_token: str = Form(""),
):
    effective_api_key = api_key or os.getenv("ANTHROPIC_API_KEY") # effective_api_key is the name of the key that we will actually use
    if not effective_api_key: # If the user does not have an API key, it will then use our key from .env and show no error. However if our key is not available then it will raise an error.
        raise HTTPException( # We raise an error with a status code of 400 (Bad Request) if there is no key found. 
            status_code=400, 
            detail="Anthropic API key required for import (add in extension settings or server config)" # This is the error message that is sent if the user does not have api key
        )

    email = email.lower().strip()
    user_id = _user_id(email, access_token or None, api_key or None)

    if not claude_file and not chatgpt_file: # This code basically checks if you have uploaded atleast one of the claude or chatgpt files,, if not then it raises an error
        raise HTTPException( #specifically raises a Bad Request error (400)
            status_code=400,
            detail="At least one file required" # This is the error message
        )

    all_dfs = [] # This is an empty list that is being defined that will later store the parsed conversation tables for all the files that the user uploads
# The files are stored as DataFrames which is a table like structure from pandas ( rows = conversations and columns = titles, messages, dates etc.)
   
   # Below is the try except block where everything under try is executed and if there is an error then the code under except is executed.
    try: #
        if claude_file:
            content = await claude_file.read() # Wait for the file to upload and then read the contents of the file (claude in this case)
            data = json.loads( # This loads the JSON file that the user uploads for claude and then converts it into a dictionary (conversts text into a dictionary)
                content.decode('utf-8-sig', errors='replace') # This decodes the file into a string and then replaces any errors with a placeholder
            )
            df = parse_claude(data) # Sends the parsed data from the claude JSON file to the parse_claude function in services/parser.py
            all_dfs.append(df) # Adds the parsed claude dataframe to thet all_dfs list that we defined earlier that contains all the parsed conversation tables for all the files that the user uploads

        if chatgpt_file: 
            content = await chatgpt_file.read() # Wait for the file to upload then read the chatgpt file
            df = parse_chatgpt(content) # Here it only reads the raw text and sends it to the parse_chatgpt function in services/parser.py because it is a zip file
            all_dfs.append(df) # Adds the parsed chatgpt dataframe to thet all_dfs list that we defined earlier that contains all the parsed conversation tables for all the files that the user uploads

        if not all_dfs: # If the all_dfs list is empty, then it raises an error
            raise HTTPException( #specifically raises a Bad Request error (400)
                status_code=400,
                detail="No conversations found" # This is the error message
            )

        df = pd.concat(all_dfs, ignore_index=True) # This concatenates all the dataframes in the all_dfs list into a single dataframe and ignores the index

        if len(df) == 0: # If the dataframe is empty, then it raises an error
            raise HTTPException( #specifically raises a Bad Request error (400)
                status_code=400,
                detail="No conversations found" # This is the error message
            )
# Now we are importing the embedder and blender functions from services/embedder.py and services/blender.py
# The embedder function is used to embed the conversations into a 384-dimensional vector space and the blender function is used to label the clusters
# The imports are purposely made inside the function because we only want to load the models when the function is called and not when the file is imported.
        from services.embedder import embed_and_position # Loads AI models from sentence_transformers and umap (Imports from services/embedder.py)
        from services.blender import label_clusters # Loads AI models from sentence_transformers and hdbscan (Imports from services/blender.py)


        chats, embeddings = embed_and_position(df) # This embeds the conversations into a 384-dimensional vector space and then labels the clusters
        chats = label_clusters(chats, effective_api_key) # This groups the chats by cluster_id, sends sample titles from each cluster to claude, claude returns a short label (e.g. "Job Search", "Python Help"), each chat then gets a 'region' (topic name) and a 'color' (hex code). Uses the same api key as the user's api key.

        try:
            store_conversations(user_id, chats, embeddings) # Stores the conversations in the database using the user_id and the conversations and embeddings.
        except Exception as db_error:
            print(f"DB storage error: {db_error}") # This prints the error if the conversations are not stored in the database
            user_id = None
# The following just counts the number of claude and chatgpt conversations and stores it in the sources dictionary
        sources = {
            "claude": sum(
                1 for c in chats if c['source'] == 'claude'
            ),
            "chatgpt": sum(
                1 for c in chats if c['source'] == 'chatgpt'
            )
        }

        for chat in chats: # Goes through each chat
            chat.pop('full_text', None) # This removes the full_text column from each chat
            # We end up using the full text in the database for semantic search and context blending, but not on the map.
            # So removing the full text here helps reduce the size of the data that is sent to the frontend, making the process faster to load the map.

        from services.auth import issue_session_token
        session_token = issue_session_token(user_id)

        return { # This JSON response is sent to the frontend to display the conversations, total number of conversations, sources and user_id
            "conversations": chats, # list of chats ready to draw as orbs on the map
            "total": len(chats), # total number of conversations
            "sources": sources, # number of claude and chatgpt conversations
            "user_id": user_id, # user_id of the user who uploaded the files
            "access_token": session_token,
        }

    except HTTPException: # If there is an error, it raises an error with a status code of 500 (Internal Server Error)
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
# Marks the end of the process_files function


class SearchRequest(BaseModel):
    query: str
    email: str
    access_token: str
    limit: int = 5

@app.post("/search")
async def search(request: SearchRequest):
    try:
        from services.database import (
            search_conversations,
            search_conversations_candidates,
            get_personal_profile,
        )
        from sentence_transformers import SentenceTransformer

        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)
        _search_model = SentenceTransformer("all-MiniLM-L6-v2")
        query_embedding = _search_model.encode([request.query])[0]

        profile = get_personal_profile(user_id)
        if profile.get("is_profile_enabled"):
            candidates = search_conversations_candidates(
                user_id,
                query_embedding,
                max(15, request.limit * 4),
            )
            results = hybrid_score_conversations(
                candidates,
                request.query,
                profile.get("profile_data", {}),
            )[:request.limit]
        else:
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
    access_token: str
    api_key: Optional[str] = None

class EngineerPromptRequest(BaseModel):
    email: str
    message: str
    access_token: str
    conversation_ids: Optional[list[str]] = None
    api_key: Optional[str] = None
    template: Optional[str] = None
    skip_memory: Optional[bool] = False


class ContextPreviewRequest(BaseModel):
    email: str
    access_token: str
    draft: str
    limit: int = 5


class UpdateProfileSettingsRequest(BaseModel):
    email: str
    access_token: str
    is_profile_enabled: bool
    profile_data: Optional[dict] = None

class GetProfileSettingsRequest(BaseModel):
    email: str
    access_token: str

class PromptFeedbackRequest(BaseModel):
    email: str
    access_token: str
    rating: int = 1  # 1 or -1
    event_type: Optional[str] = "rating"
    goal: Optional[str] = None
    prompt_preview: Optional[str] = None
    template_used: Optional[str] = None
    conversations_used: Optional[int] = 0
    goal_hash: Optional[str] = None
    engineered_prompt_hash: Optional[str] = None
    final_prompt_hash: Optional[str] = None
    engineered_prompt_preview: Optional[str] = None
    final_prompt_preview: Optional[str] = None
    diff_metrics: Optional[dict] = None
    accepted_unedited: Optional[bool] = False
    edited: Optional[bool] = False
    latency_ms: Optional[int] = None

class PersonalizationSummaryRequest(BaseModel):
    email: str
    access_token: str


class ConfirmPersonalizationSummaryRequest(BaseModel):
    email: str
    access_token: str
    action: str  # confirm | correct | skip
    correction_ids: Optional[list[str]] = None

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
        user_id = _user_id(email, request.access_token, request.api_key)

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
                "source": convo.get('source_app', 'claude'),
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
        from services.database import (
            search_conversations,
            search_conversations_candidates,
            get_personal_profile,
            get_prompt_template_by_name,
        )

        api_key = request.api_key or os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=400,
                detail="Anthropic API key required — add one in the extension or configure the server."
            )

        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token, request.api_key)
        skip_memory = bool(request.skip_memory)

        if skip_memory:
            selected = []
        elif request.conversation_ids:
            all_convos = get_user_conversations(user_id)
            selected = [c for c in all_convos if c["id"] in request.conversation_ids]

            if not selected:
                from services.database import get_supabase
                supabase = get_supabase()
                result = supabase.table("knowledge_nodes")\
                    .select("id, title, full_text, preview, created_at, num_messages, source_app")\
                    .in_("id", request.conversation_ids)\
                    .execute()
                selected = result.data or []
        else:
            model = SentenceTransformer("all-MiniLM-L6-v2")
            embedding = model.encode([request.message])[0]
            profile = get_personal_profile(user_id)
            profile_data = profile.get("profile_data") or {}
            if profile.get("is_profile_enabled"):
                candidates = search_conversations_candidates(
                    user_id,
                    embedding,
                    limit=20,
                )
                candidates = hybrid_score_conversations(
                    candidates,
                    request.message,
                    profile_data,
                )[:15]
            else:
                candidates = search_conversations_candidates(
                    user_id,
                    embedding,
                    limit=15,
                )
            from services.personalization_llm import rerank_conversations_llm
            selected = rerank_conversations_llm(
                request.message,
                candidates,
                api_key,
                limit=5,
            )

        if selected:
            from services.database import get_supabase
            supabase = get_supabase()
            ids = [c["id"] for c in selected if c.get("id")]
            if ids:
                detail_result = supabase.table("knowledge_nodes")\
                    .select("id, full_text, preview, num_messages, source_app")\
                    .in_("id", ids)\
                    .execute()
                detail_map = {d["id"]: d for d in (detail_result.data or [])}
                for conv in selected:
                    extra = detail_map.get(conv.get("id"), {})
                    if not conv.get("full_text"):
                        conv["full_text"] = extra.get("full_text")
                    if not conv.get("preview"):
                        conv["preview"] = extra.get("preview")
                    conv["source_app"] = conv.get("source_app") or extra.get("source_app")
                    conv["num_messages"] = conv.get("num_messages") or extra.get("num_messages")

        sources_used = []
        context_parts = []
        for conv in selected:
            full_text = conv.get('full_text') or conv.get('preview') or ''
            sim = conv.get('similarity')
            sources_used.append({
                "id": conv.get("id"),
                "title": conv.get("title") or "Untitled",
                "preview": (conv.get("preview") or full_text[:120] or "")[:120],
                "source": conv.get("source_app") or conv.get("source") or "unknown",
                "similarity": round(float(sim) * 100, 1) if sim is not None else None,
            })
            if full_text:
                context_parts.append(
                    f"Conversation: {conv.get('title', 'Untitled')}\n"
                    f"Date: {str(conv.get('created_at', ''))[:10]}\n"
                    f"Messages: {conv.get('num_messages', 0)}\n"
                    f"Content:\n{full_text[:3000]}"
                )
        conv_context = "\n\n---\n\n".join(context_parts) if context_parts else ""
        has_history = bool(conv_context.strip())

        profile_context = ""
        adaptive = {}
        if not skip_memory:
            profile = get_personal_profile(user_id)
            profile_data = (profile.get("profile_data") or {}) if profile else {}
            confirmed_facts = extract_confirmed_anchor_facts(profile_data)
            if confirmed_facts:
                profile_context = "\n[USER-VERIFIED PERSONALIZATION ANCHORS]\n"
                for fact in confirmed_facts:
                    profile_context += f"- {fact}\n"
                profile_context += "\n"
            if profile and profile.get("is_profile_enabled"):
                adaptive = profile_data.get("adaptive_weights") or {}
                from services.personalization_llm import pick_relevant_profile_facts_llm
                relevant_profile_facts = pick_relevant_profile_facts_llm(
                    profile_data,
                    request.message,
                    api_key,
                    max_facts=6,
                )
                if not relevant_profile_facts:
                    relevant_profile_facts = extract_relevant_profile_facts(
                        profile_data,
                        request.message,
                        min_confidence=0.62,
                        max_facts=6,
                    )
                if relevant_profile_facts:
                    profile_context += "[INFERRED PERSONAL PROFILE (background context)]\n"
                    for fact in relevant_profile_facts:
                        profile_context += f"- {fact}\n"
                    profile_context += "\n"

        template_body = ""
        template_name = ""
        if request.template and request.template != "none":
            template_name = request.template
            tmpl = get_prompt_template_by_name(request.template)
            if tmpl:
                template_body = tmpl.get("template", "")

        concise_bias = float(adaptive.get("concise_bias", 0.5) or 0.5)
        detail_level = float(adaptive.get("detail_level", 0.5) or 0.5)
        if concise_bias >= 0.62:
            adaptation_hint = "Prefer concise wording."
        elif detail_level >= 0.65:
            adaptation_hint = "Allow a little extra detail when ambiguity exists."
        else:
            adaptation_hint = "Balance clarity with enough detail for the task."

        _ENGINEER_CORE_ROLE = """You are a prompt engineer. Your ONLY job is to output a single prompt the user will paste into an AI chat so THAT assistant does the work — not you.

You are NOT the assistant. Never fulfill the user's request yourself.
- Do NOT answer questions, solve problems, debug code, brainstorm ideas, write essays, or produce any other deliverable.
- Do NOT copy assistant replies from past conversations into your output.
- Your output must be instructions directed at a future AI ("You are...", "Help me...", "Analyze..."), not the AI's response."""

        if skip_memory and template_name:
            system_prompt = f"""{_ENGINEER_CORE_ROLE}

The user message below has two parts: (1) a rough draft and (2) a template scaffold. Merge them into ONE unified prompt — never two stacked blocks, never draft-then-template.

How to merge:
- Draft = source of truth for concrete content (names, numbers, topics, constraints, tone).
- Template = source of truth for persona and structure. Templates often describe OUTPUT another AI should produce (summaries, lists, letters, reviews). Reinterpret those as instructions to that AI — do not produce that output yourself.
- Remove every placeholder label and bracket (e.g. "[FILL IN]", "[Describe your situation:]", "[PASTE CODE HERE]"). Fold draft content into natural prose.
- Omit template sections the draft cannot fill. Never invent facts to fill gaps.
- If draft and template overlap, state it once. Follow the draft's intent if they conflict.

Examples:
Draft: "I'm a freelance designer pitching a website redesign to a client who wants more whitespace."
Template section: "[Describe your situation:]"
Correct (one merged prompt): "You are an expert communication coach. I'm a freelance designer pitching a website redesign to a client who keeps asking for more whitespace. Help me draft a concise message that addresses their whitespace concerns while defending my design choices."
Wrong: pasting the draft, then the full template below it.
Wrong: writing the client email itself instead of a prompt asking an AI to help write it.

Output rules:
- Plain text only: no markdown bold, headers, or code fences. Lists are fine when they structure instructions.
- Output ONLY the final merged prompt — no preamble, labels, or commentary.
- Never ask clarifying questions. Make reasonable assumptions and proceed."""

        else:
            system_prompt = f"""You are an expert prompt engineer. Transform the user's rough message into a clear, effective prompt for an AI assistant.
Use past conversations and profile context only when directly relevant to the current draft. Never invent details. Skip unrelated background.
Choose whatever structure and formatting you think works best for this specific task — prose, bullets, numbered steps, or labeled sections are all fine.
Output plain text ready to paste into a chat box (no markdown bold or code fences). Output ONLY the final prompt — no preamble, labels like "Here is your prompt", or commentary. Never ask clarifying questions or include question lists in the output; if something is ambiguous, make a reasonable assumption and proceed.
Adaptive preference hint: {adaptation_hint}"""

        user_content = (
            f"ROUGH DRAFT (rewrite as a prompt for another AI — do NOT answer this):\n"
            f"{request.message}\n{profile_context}"
        )
        if has_history:
            user_content += (
                f"\n\nPAST CONVERSATIONS (user background only — do not copy assistant replies):\n"
                f"{conv_context}"
            )

        if template_body:
            user_content += (
                f"\n\nTEMPLATE SCAFFOLD (structure/persona only — merge into one prompt, do not paste verbatim):\n"
                f"Template name: {template_name}\n"
                f"{template_body}"
            )
        elif template_name:
            user_content += (
                f"\n\nUse the '{template_name}' template persona as structural inspiration "
                f"when rewriting the draft into a prompt for another AI."
            )

        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1000,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}]
        )

        from services.prompt_format import format_engineered_prompt
        raw_prompt = response.content[0].text
        formatted = format_engineered_prompt(raw_prompt)

        return {
            "engineered_prompt": formatted,
            "conversations_used": len(context_parts),
            "sources_used": sources_used,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/context_preview")
async def context_preview(request: ContextPreviewRequest):
    """Return relevant past conversations for a draft without engineering a prompt."""
    try:
        from sentence_transformers import SentenceTransformer
        from services.database import search_conversations

        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)
        draft = (request.draft or "").strip()
        if len(draft) < 3:
            return {"sources": [], "total_conversations": 0}

        model = SentenceTransformer("all-MiniLM-L6-v2")
        embedding = model.encode([draft])[0]
        results = search_conversations(user_id, embedding, limit=min(request.limit, 8))

        from services.database import get_supabase
        supabase = get_supabase()
        detail_map = {}
        if results:
            ids = [r["id"] for r in results if r.get("id")]
            if ids:
                detail_result = supabase.table("knowledge_nodes")\
                    .select("id, source_app, preview")\
                    .in_("id", ids)\
                    .execute()
                detail_map = {d["id"]: d for d in (detail_result.data or [])}

        sources = []
        for conv in (results or []):
            sim = conv.get("similarity")
            extra = detail_map.get(conv.get("id"), {})
            preview = conv.get("preview") or extra.get("preview") or ""
            sources.append({
                "id": conv.get("id"),
                "title": conv.get("title") or "Untitled",
                "preview": preview[:150],
                "source": extra.get("source_app") or "unknown",
                "similarity": round(float(sim) * 100, 1) if sim is not None else None,
            })
        count_result = supabase.table("knowledge_nodes")\
            .select("id", count="exact")\
            .eq("user_id", user_id)\
            .execute()
        total = count_result.count if count_result.count is not None else len(sources)

        return {"sources": sources, "total_conversations": total}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/personalization_summary")
async def personalization_summary(request: PersonalizationSummaryRequest):
    try:
        from services.database import (
            get_or_create_user,
            get_personal_profile,
            update_personal_profile_inferred,
            get_supabase,
        )
        from services.personalization_llm import (
            synthesize_profile_llm,
            synthesis_is_stale,
            get_display_summary,
            get_quick_corrections,
        )
        from datetime import datetime, timezone

        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)
        profile = get_personal_profile(user_id)
        profile_data = profile.get("profile_data") or {}

        supabase = get_supabase()
        conv_result = supabase.table("knowledge_nodes")\
            .select("id", count="exact")\
            .eq("user_id", user_id)\
            .execute()
        conversation_count = conv_result.count if conv_result.count is not None else len(conv_result.data or [])

        if conversation_count >= 8 and synthesis_is_stale(profile_data):
            samples = supabase.table("knowledge_nodes")\
                .select("id, title, preview, source_app, created_at")\
                .eq("user_id", user_id)\
                .order("updated_at", desc=True)\
                .limit(25)\
                .execute()
            synthesized = synthesize_profile_llm(
                profile_data,
                samples.data or [],
                os.getenv("ANTHROPIC_API_KEY"),
            )
            update_personal_profile_inferred(
                user_id=user_id,
                profile_data=synthesized,
                last_signal_at=datetime.now(timezone.utc).isoformat(),
            )
            profile_data = synthesized

        enough_history = has_enough_history(conversation_count, profile_data)
        summary_confidence = compute_summary_confidence(profile_data)
        inferred_summary = get_display_summary(profile_data)
        should_show = enough_history and should_prompt_confirmation(profile_data)

        return {
            "has_enough_history": enough_history,
            "should_show_confirmation": should_show,
            "inferred_summary": inferred_summary,
            "summary_confidence": summary_confidence,
            "conversation_count": conversation_count,
            "quick_corrections": get_quick_corrections(profile_data),
            "confirmed_summary": (profile_data.get("confirmed_anchors") or {}).get("summary"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/confirm_personalization_summary")
async def confirm_personalization_summary(request: ConfirmPersonalizationSummaryRequest):
    try:
        from services.database import (
            get_or_create_user,
            get_personal_profile,
            update_personal_profile_inferred,
            increment_personalization_counter,
        )
        from datetime import datetime, timezone

        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)
        profile = get_personal_profile(user_id)
        profile_data = profile.get("profile_data") or {}
        action_l = (request.action or "").strip().lower()
        if action_l == "shown":
            increment_personalization_counter(user_id, "summary_shown_total", 1)
            return {
                "success": True,
                "confirmed_summary": (profile_data.get("confirmed_anchors") or {}).get("summary"),
            }
        updated = apply_summary_confirmation(
            profile_data,
            request.action,
            request.correction_ids or [],
        )
        update_personal_profile_inferred(
            user_id=user_id,
            profile_data=updated,
            last_signal_at=datetime.now(timezone.utc).isoformat(),
        )

        if action_l == "confirm":
            increment_personalization_counter(user_id, "summary_confirmed_total", 1)
        elif action_l == "correct":
            increment_personalization_counter(user_id, "summary_corrected_total", 1)
        elif action_l == "skip":
            increment_personalization_counter(user_id, "summary_skipped_total", 1)

        return {
            "success": True,
            "confirmed_summary": (updated.get("confirmed_anchors") or {}).get("summary"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/templates")
async def get_templates():
    try:
        from services.database import get_prompt_templates
        templates = get_prompt_templates()
        return {"templates": templates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/templates/search")
async def search_templates(
    q: str = "",
    category: str = "",
    tag: str = "",
    tier: str = "",
    limit: int = 50,
    offset: int = 0,
    sort: str = "popular",
):
    try:
        from services.database import search_prompt_templates
        templates, total = search_prompt_templates(
            query=q,
            category=category,
            tag=tag,
            tier=tier,
            limit=min(limit, 100),
            offset=max(offset, 0),
            sort=sort,
        )
        return {"templates": templates, "total": total, "limit": limit, "offset": offset}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/templates/categories")
async def template_categories():
    try:
        from services.database import get_template_categories
        return {"categories": get_template_categories()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class TemplateSuggestRequest(BaseModel):
    draft: str
    limit: int = 5
    category: str = ""
    tier: str = ""


@app.post("/templates/suggest")
async def suggest_templates(request: TemplateSuggestRequest):
    try:
        from services.template_suggester import suggest_templates_with_ai
        templates = suggest_templates_with_ai(
            request.draft,
            min(request.limit, 12),
            category=request.category or "",
            tier=request.tier or "",
        )
        return {"templates": templates, "ai": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class TemplateTrackRequest(BaseModel):
    name: str


@app.post("/templates/track_use")
async def track_template_use(request: TemplateTrackRequest):
    try:
        from services.database import increment_template_use
        ok = increment_template_use(request.name)
        if not ok:
            raise HTTPException(status_code=404, detail="Template not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/update_profile_settings")
async def update_profile_settings(request: UpdateProfileSettingsRequest):
    try:
        from services.database import get_or_create_user, get_personal_profile, update_personal_profile
        from services.personalization_llm import merge_popup_profile_llm

        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)
        
        profile_data = request.profile_data
        popup_keys = {"background", "situation", "goals", "constraints", "preferences"}
        if profile_data is None:
            existing = get_personal_profile(user_id)
            profile_data = existing.get("profile_data", {})
        else:
            existing = get_personal_profile(user_id)
            popup_fields = {k: profile_data[k] for k in popup_keys if profile_data.get(k)}
            if popup_fields:
                profile_data = merge_popup_profile_llm(
                    existing.get("profile_data", {}),
                    popup_fields,
                    os.getenv("ANTHROPIC_API_KEY"),
                )
            else:
                profile_data = {**(existing.get("profile_data") or {}), **profile_data}

        update_personal_profile(user_id, profile_data, request.is_profile_enabled)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/get_profile_settings")
async def get_profile_settings(request: GetProfileSettingsRequest):
    try:
        from services.database import get_or_create_user, get_personal_profile
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)
        profile = get_personal_profile(user_id)
        return {
            "is_profile_enabled": profile.get("is_profile_enabled", False),
            "profile_data": profile.get("profile_data", {}),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/prompt_feedback")
async def prompt_feedback(request: PromptFeedbackRequest, background_tasks: BackgroundTasks):
    try:
        from services.database import (
            get_or_create_user,
            log_prompt_feedback,
            get_personal_profile,
            increment_personalization_counter,
        )
        event_type = (request.event_type or "rating").strip().lower()
        if request.rating not in (-1, 1):
            raise HTTPException(status_code=400, detail="Rating must be 1 or -1")
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)

        adaptation_applied = False
        if event_type == "edit_feedback":
            profile = get_personal_profile(user_id)
            if profile.get("is_profile_enabled"):
                engineered = (request.engineered_prompt_preview or request.prompt_preview or "")[:2500]
                final = (request.final_prompt_preview or "")[:2500]
                background_tasks.add_task(
                    run_llm_edit_feedback,
                    user_id,
                    profile.get("profile_data") or {},
                    engineered,
                    final,
                    request.diff_metrics or {},
                    bool(request.accepted_unedited),
                )
                adaptation_applied = True

        log_prompt_feedback(
            user_id=user_id,
            rating=request.rating,
            event_type=event_type,
            goal=request.goal or "",
            prompt_preview=request.prompt_preview or "",
            template_used=request.template_used or "",
            conversations_used=request.conversations_used or 0,
            goal_hash=request.goal_hash or "",
            engineered_prompt_hash=request.engineered_prompt_hash or "",
            final_prompt_hash=request.final_prompt_hash or "",
            diff_metrics=request.diff_metrics or {},
            accepted_unedited=bool(request.accepted_unedited),
            edited=bool(request.edited),
            latency_ms=request.latency_ms,
        )
        increment_personalization_counter(user_id, "feedback_events_total", 1)
        if bool(request.accepted_unedited):
            increment_personalization_counter(user_id, "feedback_unedited_accept_total", 1)
        if event_type == "edit_feedback":
            increment_personalization_counter(user_id, "feedback_edit_events_total", 1)
        if request.latency_ms and request.latency_ms > 0:
            increment_personalization_counter(user_id, "feedback_latency_samples_total", 1)
        return {"success": True, "adaptation_applied": adaptation_applied}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class UserStatsRequest(BaseModel):
    email: str
    access_token: str

class SessionRequest(BaseModel):
    email: str
    access_token: Optional[str] = None
    api_key: Optional[str] = None

class ExportDataRequest(BaseModel):
    email: str
    access_token: str

class DeleteAccountRequest(BaseModel):
    email: str
    access_token: str
    confirm: bool = False

class RecordConsentRequest(BaseModel):
    email: str
    access_token: str
    consent_version: str
    source: str = "extension"

class DeleteConversationRequest(BaseModel):
    email: str
    access_token: str
    conversation_id: str

class ClearInferredProfileRequest(BaseModel):
    email: str
    access_token: str

class RevokeTeamSharingRequest(BaseModel):
    email: str
    access_token: str


class RegisterRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class GoogleTokenRequest(BaseModel):
    id_token: str


class AuthAccountRequest(BaseModel):
    email: str
    access_token: str


class SetPasswordRequest(BaseModel):
    email: str
    access_token: str
    password: str
    current_password: Optional[str] = None


@app.post("/auth/register")
async def auth_register(request: RegisterRequest):
    try:
        from services.auth import register_with_password

        return register_with_password(request.email, request.password)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/auth/login")
async def auth_login(request: LoginRequest):
    try:
        from services.auth import login_with_password

        return login_with_password(request.email, request.password)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/auth/google/token")
async def auth_google_token(request: GoogleTokenRequest):
    try:
        from services.auth import login_with_google_id_token

        return login_with_google_id_token(request.id_token)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/auth/google/signin")
async def auth_google_signin(source: str = "web"):
    from fastapi.responses import RedirectResponse
    from services.auth import google_signin_redirect_url

    return RedirectResponse(url=google_signin_redirect_url(source))


@app.get("/auth/google/signin/callback")
async def auth_google_signin_callback(code: str = "", state: str = "", error: str = ""):
    from fastapi.responses import RedirectResponse
    from services.auth import exchange_google_auth_code, link_or_create_google_user, issue_session_token
    import urllib.parse

    frontend_url = os.getenv("FRONTEND_URL", "https://mind-world.app").rstrip("/")
    if error:
        return RedirectResponse(url=f"{frontend_url}/auth/callback?error={urllib.parse.quote(error)}")

    if not code:
        return RedirectResponse(url=f"{frontend_url}/auth/callback?error=missing_code")

    source = "web"
    if state and ":" in state:
        _, source = state.rsplit(":", 1)

    api_base = (os.getenv("API_PUBLIC_URL") or "https://mind-world-app-mv4yv.ondigitalocean.app").rstrip("/")
    redirect_uri = f"{api_base}/auth/google/signin/callback"

    try:
        profile = exchange_google_auth_code(code, redirect_uri)
        user_id, has_password = link_or_create_google_user(profile["google_id"], profile["email"])
        access_token = issue_session_token(user_id)
        params = urllib.parse.urlencode(
            {
                "access_token": access_token,
                "email": profile["email"],
                "source": source if source in ("web", "extension") else "web",
                "needs_password": "0" if has_password else "1",
            }
        )
        return RedirectResponse(url=f"{frontend_url}/auth/callback?{params}")
    except HTTPException as exc:
        return RedirectResponse(url=f"{frontend_url}/auth/callback?error={urllib.parse.quote(str(exc.detail))}")
    except Exception as exc:
        return RedirectResponse(url=f"{frontend_url}/auth/callback?error={urllib.parse.quote(str(exc))}")


@app.post("/auth/account")
async def auth_account(request: AuthAccountRequest):
    try:
        from services.auth import get_account_auth_info

        return get_account_auth_info(request.email, request.access_token)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/auth/set_password")
async def auth_set_password(request: SetPasswordRequest):
    try:
        from services.auth import set_account_password

        return set_account_password(
            request.email,
            request.access_token,
            request.password,
            current_password=request.current_password,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/auth/session")
async def auth_session(request: SessionRequest):
    try:
        from services.auth import establish_session

        return establish_session(
            request.email,
            access_token=request.access_token,
            api_key=request.api_key,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/record_consent")
async def record_consent(request: RecordConsentRequest):
    try:
        from services.database import get_or_create_user, record_user_consent, CONSENT_VERSION

        email = request.email.lower().strip()
        if not request.consent_version:
            raise HTTPException(status_code=400, detail="consent_version is required")

        user_id = _user_id(email, request.access_token)
        result = record_user_consent(user_id, request.consent_version, request.source or "extension")
        return {"success": True, "current_consent_version": CONSENT_VERSION, **result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/export_data")
async def export_data(request: ExportDataRequest):
    try:
        from services.auth import require_authenticated_user
        from services.database import export_user_data

        email = request.email.lower().strip()
        user_id = require_authenticated_user(email, request.access_token)
        return export_user_data(user_id, email)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/delete_conversation")
async def delete_conversation_endpoint(request: DeleteConversationRequest):
    try:
        from services.auth import require_authenticated_user
        from services.database import delete_conversation

        email = request.email.lower().strip()
        user_id = require_authenticated_user(email, request.access_token)
        result = delete_conversation(user_id, request.conversation_id)
        if not result.get("deleted"):
            raise HTTPException(status_code=404, detail=result.get("reason", "not_found"))
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/clear_inferred_profile")
async def clear_inferred_profile_endpoint(request: ClearInferredProfileRequest):
    try:
        from services.auth import require_authenticated_user
        from services.database import clear_inferred_profile

        email = request.email.lower().strip()
        user_id = require_authenticated_user(email, request.access_token)
        result = clear_inferred_profile(user_id)
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/revoke_team_sharing")
async def revoke_team_sharing_endpoint(request: RevokeTeamSharingRequest):
    try:
        from services.auth import require_authenticated_user
        from services.database import revoke_team_sharing

        email = request.email.lower().strip()
        user_id = require_authenticated_user(email, request.access_token)
        result = revoke_team_sharing(user_id)
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/delete_account")
async def delete_account(request: DeleteAccountRequest):
    try:
        from services.auth import require_authenticated_user
        from services.database import delete_user_data

        if not request.confirm:
            raise HTTPException(
                status_code=400,
                detail="Set confirm=true to permanently delete your account and all data.",
            )

        email = request.email.lower().strip()
        user_id = require_authenticated_user(email, request.access_token)
        result = delete_user_data(user_id)
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/user_stats")
async def user_stats(request: UserStatsRequest):
    try:
        from services.database import get_or_create_user
        from services.database import get_supabase

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)

        # Count conversations
        conv_result = supabase.table("knowledge_nodes")\
            .select("id, source_app")\
            .eq("user_id", user_id)\
            .execute()

        conversations = conv_result.data or []
        sources = set(c.get('source_app', '') for c in conversations)

        # Fetch company info
        company_info = None
        user_result = supabase.table("users")\
            .select("company_id, consent_at, consent_version, consent_source")\
            .eq("id", user_id)\
            .execute()
        consent_info = {
            "consent_at": None,
            "consent_version": None,
            "consent_source": None,
            "consent_event_count": 0,
        }
        if user_result.data:
            row = user_result.data[0]
            consent_info = {
                "consent_at": row.get("consent_at"),
                "consent_version": row.get("consent_version"),
                "consent_source": row.get("consent_source"),
                "consent_event_count": 0,
            }
            try:
                from services.database import get_user_consent_info
                consent_info = get_user_consent_info(user_id)
            except Exception:
                pass
        if user_result.data and user_result.data[0].get("company_id"):
            company_id = user_result.data[0]["company_id"]
            company_result = supabase.table("companies")\
                .select("name, domain")\
                .eq("id", company_id)\
                .execute()
            if company_result.data:
                company_info = company_result.data[0]
            members_result = supabase.table("users")\
                .select("id")\
                .eq("company_id", company_id)\
                .execute()
            if company_info:
                company_info["member_count"] = len(members_result.data or [])

        return {
            "conversation_count": len(conversations),
            "platform_count": len(sources),
            "sources": list(sources),
            "user_id": user_id,
            "company": company_info,
            **consent_info,
        }
    except Exception as e:
        return {
            "conversation_count": 0,
            "platform_count": 0,
            "sources": [],
            "company": None
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
        user_id = _user_id(email, request.access_token, request.api_key)
        all_convos = get_user_conversations(user_id)
        selected = [c for c in all_convos if c['id'] in request.conversation_ids]
        
        if not selected:
            raise HTTPException(status_code=404, detail="Conversations not found")
            
        from services.blender import blend_conversations
        return blend_conversations(selected, request.question, api_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SaveConversationRequest(BaseModel):
    email: str
    access_token: str
    conversation: dict
    visibility: str = 'private'


async def run_profile_inference_from_delta(user_id: str, conversation_delta_text: str):
    from services.database import get_personal_profile, update_personal_profile_inferred
    from services.personalization_llm import infer_profile_delta_llm
    from datetime import datetime, timezone

    existing = get_personal_profile(user_id)
    merged_profile = infer_profile_delta_llm(
        existing.get("profile_data", {}),
        conversation_delta_text,
        os.getenv("ANTHROPIC_API_KEY"),
    )
    update_personal_profile_inferred(
        user_id=user_id,
        profile_data=merged_profile,
        last_signal_at=datetime.now(timezone.utc).isoformat(),
    )


async def run_llm_edit_feedback(
    user_id: str,
    profile_data: dict,
    engineered_prompt: str,
    final_prompt: str,
    diff_metrics: dict,
    accepted_unedited: bool,
):
    from services.database import update_personal_profile_inferred
    from services.personalization_llm import apply_edit_feedback_llm
    from datetime import datetime, timezone

    updated = apply_edit_feedback_adaptation(
        profile_data,
        diff_metrics,
        accepted_unedited,
    )
    if engineered_prompt and final_prompt and engineered_prompt.strip() != final_prompt.strip():
        updated = apply_edit_feedback_llm(
            updated,
            engineered_prompt,
            final_prompt,
            os.getenv("ANTHROPIC_API_KEY"),
        )
    update_personal_profile_inferred(
        user_id=user_id,
        profile_data=updated,
        last_signal_at=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/save_conversation")
async def save_conversation(request: SaveConversationRequest, background_tasks: BackgroundTasks):
    try:
        from services.database import get_or_create_user
        from services.database import get_supabase
        from services.embedder import embed_single

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)
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

        platform = (convo.get('platform') or convo.get('source') or '').lower()
        if 'chatgpt' in platform:
            source = 'chatgpt'
        elif 'gemini' in platform:
            source = 'gemini'
        elif 'perplexity' in platform:
            source = 'perplexity'
        elif 'claude' in platform:
            source = 'claude'
        else:
            source = convo.get('source') or 'claude'

        row = {
            "id": conv_id,
            "user_id": user_id,
            "title": convo.get('title', 'Untitled'),
            "type": "ai_chat",
            "source_app": source,
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
            "visibility": request.visibility if request.visibility in ('private', 'team') else 'private'
        }

        supabase.table("knowledge_nodes").upsert(
            row, on_conflict="id"
        ).execute()

        supabase.table("embeddings").upsert({
            "conversation_id": conv_id,
            "user_id": user_id,
            "embedding": embedding.tolist()
        }, on_conflict="conversation_id,user_id").execute()

        background_tasks.add_task(run_recluster, email)

        from services.database import get_personal_profile
        profile = get_personal_profile(user_id)
        if profile.get("is_profile_enabled"):
            background_tasks.add_task(run_profile_inference_from_delta, user_id, full_text[:2500])

        return {"success": True, "id": conv_id}

    except Exception as e:
        return {"success": False, "reason": str(e)}

class LoadMapRequest(BaseModel):
    email: str
    access_token: str

@app.post("/load_map")
async def load_map(request: LoadMapRequest):
    try:
        from services.database import get_supabase

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)

        result = supabase.table("knowledge_nodes")\
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
                "source": c.get("source_app", "claude"),
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


@app.post("/load_team_map")
async def load_team_map(request: LoadMapRequest):
    try:
        from services.database import get_supabase

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)

        user_result = supabase.table("users").select("company_id").eq("id", user_id).execute()
        company_id = user_result.data[0].get("company_id") if user_result.data else None

        company_user_emails = {}
        all_convos = []

        if company_id:
            company_users = supabase.table("users").select("id, email").eq("company_id", company_id).execute()
            company_user_ids = [u["id"] for u in (company_users.data or [])]
            company_user_emails = {u["id"]: u["email"] for u in (company_users.data or [])}

            my_convos = supabase.table("knowledge_nodes").select("*").eq("user_id", user_id).execute().data or []
            
            other_team_convos = []
            other_team_user_ids = [uid for uid in company_user_ids if uid != user_id]
            if other_team_user_ids:
                team_res = supabase.table("knowledge_nodes").select("*").in_("user_id", other_team_user_ids).eq("visibility", "team").execute()
                other_team_convos = team_res.data or []
                
            all_convos = my_convos + other_team_convos
        else:
            all_convos = supabase.table("knowledge_nodes").select("*").eq("user_id", user_id).execute().data or []

        formatted = []
        for c in all_convos:
            owner_email = company_user_emails.get(c.get("user_id"), "")
            owner_initials = ""
            if owner_email:
                owner_initials = ''.join(p[0].upper() for p in owner_email.split('@')[0].split('.')[:2])
            
            formatted.append({
                "id": c.get("id", ""),
                "title": c.get("title", "Untitled"),
                "source": c.get("source_app", "claude"),
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
                "visibility": c.get("visibility", "private"),
                "is_team": c.get("user_id") != user_id,
                "owner_initials": owner_initials
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
            "has_data": len(formatted) > 0
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class CompanySearchRequest(BaseModel):
    email: str
    access_token: str
    query: str
    limit: int = 5

@app.post("/company_search")
async def company_search(request: CompanySearchRequest):
    try:
        from services.database import get_or_create_user, get_supabase
        from sentence_transformers import SentenceTransformer

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)
        print(f"[/company_search] email: {email}, user_id: {user_id}")

        # SELF-HEALING: Verify and correct user_id mapping
        try:
            print("[/company_search] Running self-healing on user_ids and emails...")
            # 1. Fix mixed-case emails that create duplicate user records
            users_res = supabase.table("users").select("id, email").execute()
            for u in (users_res.data or []):
                if u["email"] and u["email"] != u["email"].lower():
                    supabase.table("users").update({"email": u["email"].lower()}).eq("id", u["id"]).execute()
            
            # 2. Fix missing user_ids in team conversations
            convs_res = supabase.table("knowledge_nodes").select("id, user_id").eq("visibility", "team").execute()
            for c in (convs_res.data or []):
                if not c.get("user_id"):
                    emb_res = supabase.table("embeddings").select("user_id").eq("conversation_id", c["id"]).execute()
                    if emb_res.data and emb_res.data[0].get("user_id"):
                        supabase.table("knowledge_nodes").update({"user_id": emb_res.data[0]["user_id"]}).eq("id", c["id"]).execute()
                        print(f"[/company_search] Healed conversation {c['id']} with user_id {emb_res.data[0]['user_id']}")
        except Exception as heal_err:
            print(f"[/company_search] Heal error: {heal_err}")

        user_result = supabase.table("users")\
            .select("company_id")\
            .eq("id", user_id)\
            .execute()

        if not user_result.data or not user_result.data[0].get("company_id"):
            return {"results": [], "message": "No company workspace found for this email"}

        company_id = user_result.data[0]["company_id"]

        company_users = supabase.table("users")\
            .select("id, email")\
            .eq("company_id", company_id)\
            .execute()

        company_user_ids = [u["id"] for u in (company_users.data or [])]
        company_user_emails = {u["id"]: u["email"] for u in (company_users.data or [])}
        print(f"[/company_search] Found {len(company_user_ids)} members in company {company_id}: {company_user_emails}")

        if not company_user_ids:
            return {"results": [], "message": "No company members found"}

        model = SentenceTransformer('all-MiniLM-L6-v2')
        query_embedding = model.encode([request.query])[0]

        print(f"[/company_search] Calling match_company_conversations with exclude_user_id={user_id}, company_user_ids={company_user_ids}")

        search_result = supabase.rpc(
            'match_company_conversations',
            {
                'query_embedding': query_embedding.tolist(),
                'company_user_ids': company_user_ids,
                'exclude_user_id': user_id,
                'match_count': request.limit
            }
        ).execute()
        
        print(f"[/company_search] match_company_conversations RPC returned {len(search_result.data or [])} results")

        results = []
        for item in (search_result.data or []):
            owner_email = company_user_emails.get(item.get('user_id'), 'unknown')
            owner_initials = ''.join(
                p[0].upper() for p in owner_email.split('@')[0].split('.')[:2]
            )
            results.append({
                'id': item.get('id'),
                'title': item.get('title'),
                'preview': item.get('preview'),
                'similarity': item.get('similarity'),
                'owner_email': owner_email,
                'owner_initials': owner_initials,
                'created_at': item.get('created_at')
            })

        return {
            "results": results,
            "company_members": len(company_user_ids),
            "searched_conversations": "company-visible only"
        }

    except Exception as e:
        return {
            "results": [],
            "error": "Search failed"
        }


class SetVisibilityRequest(BaseModel):
    email: str
    access_token: str
    conversation_id: str
    visibility: str

@app.post("/set_visibility")
async def set_visibility(request: SetVisibilityRequest):
    try:
        from services.database import get_supabase

        if request.visibility not in ['private', 'team']:
            return {"success": False, "reason": "Invalid visibility value"}

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)

        supabase.table("knowledge_nodes")\
            .update({"visibility": request.visibility})\
            .eq("id", request.conversation_id)\
            .eq("user_id", user_id)\
            .execute()

        return {"success": True, "visibility": request.visibility}

    except Exception as e:
        return {"success": False, "reason": str(e)}


class ReclusterRequest(BaseModel):
    email: str
    access_token: str

async def run_recluster(email: str):
    from services.database import get_or_create_user
    from services.database import get_supabase
    import numpy as np

    supabase = get_supabase()
    email = email.lower().strip()
    user_id = get_or_create_user(email)

    # Get all conversations for this user
    result = supabase.table("knowledge_nodes")\
        .select("id, title, full_text, x, y")\
        .eq("user_id", user_id)\
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
            supabase.table("knowledge_nodes")\
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

@app.post("/recluster")
async def recluster(request: ReclusterRequest):
    try:
        _user_id(request.email.lower().strip(), request.access_token)
        return await run_recluster(request.email)

    except Exception as e:
        return {"success": False, "reason": "Recluster failed"}


class ShareConversationsRequest(BaseModel):
    email: str
    access_token: str
    visibility: str = 'team'
    conversation_ids: list = []

@app.post("/share_conversations")
async def share_conversations(request: ShareConversationsRequest):
    try:
        from services.database import get_supabase

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)

        if request.visibility not in ['private', 'team', 'company']:
            return {"success": False, "reason": "Invalid visibility"}

        if request.conversation_ids:
            for conv_id in request.conversation_ids:
                supabase.table("knowledge_nodes")\
                    .update({"visibility": request.visibility})\
                    .eq("id", conv_id)\
                    .eq("user_id", user_id)\
                    .execute()
            updated = len(request.conversation_ids)
        else:
            supabase.table("knowledge_nodes")\
                .update({"visibility": request.visibility})\
                .eq("user_id", user_id)\
                .execute()
            count_result = supabase.table("knowledge_nodes")\
                .select("id", count="exact")\
                .eq("user_id", user_id)\
                .execute()
            updated = count_result.count or 0

        return {"success": True, "updated": updated, "visibility": request.visibility}

    except Exception as e:
        return {"success": False, "reason": str(e)}


class CreateWorkspaceRequest(BaseModel):
    email: str
    access_token: str
    workspace_name: str

@app.post("/create_workspace")
async def create_workspace(request: CreateWorkspaceRequest):
    try:
        from services.database import get_supabase
        import uuid
        import random
        import string

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)

        user_result = supabase.table("users")\
            .select("company_id")\
            .eq("id", user_id)\
            .execute()

        if user_result.data and user_result.data[0].get("company_id"):
            return {"success": False, "reason": "You are already in a workspace. Leave it first."}

        def generate_invite_code():
            chars = string.ascii_uppercase + string.digits
            part1 = ''.join(random.choices(chars, k=4))
            part2 = ''.join(random.choices(chars, k=4))
            return f"MW-{part1}-{part2}"

        invite_code = generate_invite_code()
        while True:
            existing = supabase.table("companies").select("id").eq("invite_code", invite_code).execute()
            if not existing.data:
                break
            invite_code = generate_invite_code()

        company_id = str(uuid.uuid4())
        supabase.table("companies").insert({
            "id": company_id,
            "name": request.workspace_name,
            "domain": company_id,
            "invite_code": invite_code,
            "created_by": user_id
        }).execute()

        supabase.table("users").update({
            "company_id": company_id,
            "role": "admin"
        }).eq("id", user_id).execute()

        return {
            "success": True,
            "workspace_name": request.workspace_name,
            "invite_code": invite_code,
            "company_id": company_id
        }

    except Exception as e:
        return {"success": False, "reason": str(e)}


class JoinWorkspaceRequest(BaseModel):
    email: str
    access_token: str
    invite_code: str

@app.post("/join_workspace")
async def join_workspace(request: JoinWorkspaceRequest):
    try:
        from services.database import get_supabase

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)

        user_result = supabase.table("users")\
            .select("company_id")\
            .eq("id", user_id)\
            .execute()

        if user_result.data and user_result.data[0].get("company_id"):
            return {"success": False, "reason": "You are already in a workspace. Leave it first."}

        invite_code = request.invite_code.upper().strip()
        company_result = supabase.table("companies")\
            .select("id, name")\
            .eq("invite_code", invite_code)\
            .execute()

        if not company_result.data:
            return {"success": False, "reason": "Invalid invite code. Please check and try again."}

        company = company_result.data[0]

        supabase.table("users").update({
            "company_id": company["id"],
            "role": "member"
        }).eq("id", user_id).execute()

        members = supabase.table("users").select("id").eq("company_id", company["id"]).execute()

        return {
            "success": True,
            "workspace_name": company["name"],
            "company_id": company["id"],
            "member_count": len(members.data or [])
        }

    except Exception as e:
        return {"success": False, "reason": str(e)}


class WorkspaceInfoRequest(BaseModel):
    email: str
    access_token: str

@app.post("/workspace_info")
async def workspace_info(request: WorkspaceInfoRequest):
    try:
        from services.database import get_supabase

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)

        user_result = supabase.table("users")\
            .select("company_id, role")\
            .eq("id", user_id)\
            .execute()

        if not user_result.data or not user_result.data[0].get("company_id"):
            return {"workspace": None}

        company_id = user_result.data[0]["company_id"]
        user_role = user_result.data[0]["role"]

        company_result = supabase.table("companies")\
            .select("name, invite_code, created_by")\
            .eq("id", company_id)\
            .execute()

        if not company_result.data:
            return {"workspace": None}

        company = company_result.data[0]

        members_result = supabase.table("users")\
            .select("id, email, role")\
            .eq("company_id", company_id)\
            .execute()

        members = members_result.data or []

        return {
            "workspace": {
                "name": company["name"],
                "invite_code": company["invite_code"],
                "member_count": len(members),
                "members": [{"email": m["email"], "role": m["role"]} for m in members],
                "user_role": user_role,
                "is_admin": user_role == "admin"
            }
        }

    except Exception as e:
        return {"workspace": None, "error": str(e)}


class LeaveWorkspaceRequest(BaseModel):
    email: str
    access_token: str

@app.post("/leave_workspace")
async def leave_workspace(request: LeaveWorkspaceRequest):
    try:
        from services.database import get_supabase

        supabase = get_supabase()
        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)

        supabase.table("users").update({
            "company_id": None,
            "role": "member"
        }).eq("id", user_id).execute()

        return {"success": True}

    except Exception as e:
        return {"success": False, "reason": str(e)}


@app.get("/")
def root():
    return {
        "name": "Mind World API",
        "version": "1.0.0",
        "endpoints": ["/health", "/process", "/blend", "/recluster"]
    }

from fastapi.responses import RedirectResponse
import uuid

class AuthNotionRequest(BaseModel):
    code: str

@app.post("/auth/notion")
async def auth_notion(request: AuthNotionRequest):
    raise HTTPException(status_code=501, detail="Notion integration not yet available.")
