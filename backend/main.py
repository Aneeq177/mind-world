# Import statements
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, BackgroundTasks, Request
from fastapi.responses import JSONResponse, Response
import json
import os
import time
from collections import defaultdict
from datetime import datetime, timedelta
import pandas as pd
from dotenv import load_dotenv

from typing import Optional

from pydantic import BaseModel, field_validator
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

import re

# Checks if the email is valid like example@example.com
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
# Checks if the field is longer than 5000 characters (This is to prevent SQL injection and other security issues)
_MAX_FIELD_LEN = 5000

# Takes the email, validates it if its empty or not,
# strips it to lower case and 
# checks if length of email is lesser than 254 characters.
def _validate_email(email: str) -> str:
    email = (email or "").lower().strip()
    if not email or not _EMAIL_RE.match(email) or len(email) > 254:
        raise HTTPException(status_code=400, detail="Valid email required.")
    return email

# Authenticates user email through access tokens to make sure that you are logged in as your email and it really is you.
def _user_id(email: str, access_token: Optional[str] = None, api_key: Optional[str] = None) -> str:
    from services.auth import authenticate_user
    email = _validate_email(email)
    return authenticate_user(email, access_token, api_key)

app = FastAPI(title="Mind World API", version="1.0.0") # Create FastAPI app

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse, RedirectResponse

_ALLOWED_WEB_ORIGINS = {
    os.getenv("FRONTEND_URL", "https://mind-world.app").rstrip("/"),
    "https://mind-world.app",
    "https://www.mind-world.app",
}

_ALLOWED_LOCAL_ORIGINS = {
    "http://localhost:5173",
    "http://localhost:3000",
    "https://localhost:5173",
    "https://localhost:3000",
}


def _is_allowed_origin(origin: str | None) -> bool:
    if not origin:
        return True
    if origin.startswith("chrome-extension://"):
        return True
    if origin in _ALLOWED_WEB_ORIGINS or origin in _ALLOWED_LOCAL_ORIGINS:
        return True
    return False


class MindWorldCORSMiddleware(BaseHTTPMiddleware):
    """CORS middleware that allows the public web app, local dev, and any
    chrome-extension:// origin (the extension ID differs between unpacked and
    Web Store builds). Credentials are never accepted via cookies; auth is sent
    in request bodies/headers by the extension."""
    async def dispatch(self, request: StarletteRequest, call_next):
        origin = request.headers.get("origin")
        allowed = _is_allowed_origin(origin)

        if request.method == "OPTIONS":
            response = StarletteResponse(status_code=204)
        else:
            response = await call_next(request)

        if allowed and origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-MW-Client"
        response.headers["Access-Control-Max-Age"] = "86400"
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        response: StarletteResponse = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


class HTTPSRedirectMiddleware(BaseHTTPMiddleware):
    """Redirect plain HTTP requests to HTTPS. Skipped for local development and
    when the app is behind a trusted reverse proxy that sets X-Forwarded-Proto."""
    async def dispatch(self, request: StarletteRequest, call_next):
        scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
        host = request.headers.get("x-forwarded-host", request.url.hostname) or ""
        if scheme.lower() == "http" and not host.startswith("localhost") and not host.startswith("127."):
            url = request.url.replace(scheme="https")
            return RedirectResponse(str(url), status_code=308)
        return await call_next(request)


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(MindWorldCORSMiddleware)
app.add_middleware(HTTPSRedirectMiddleware)


@app.on_event("startup")
def _warm_embedding_model():
    """Load the sentence-transformer once at boot (in a thread so health
    checks aren't blocked) instead of paying the load on a user's first
    search/Improve call."""
    import threading

    def _warm():
        try:
            from services.embedder import get_embedding_model
            get_embedding_model().encode(["warmup"])
            print("[startup] embedding model warmed")
        except Exception as e:
            print(f"[startup] embedding warmup failed (will load lazily): {e}")

    threading.Thread(target=_warm, daemon=True).start()

# ---------------------------------------------------------------------------
# Per-user free-tier quota
# ---------------------------------------------------------------------------
FREE_TIER_LIMIT = 25  # Improve calls included for free (server-key users)
COMPARE_FREE_LIMIT = 5  # "See the difference" demo calls included for free

# Secret header sent by the extension — rejects old/unauthorised clients
MW_CLIENT_SECRET = "mwext-f8c3a91d-v3"

# ---------------------------------------------------------------------------
# IP-based rate limiter — 30 Improve calls per minute per IP
# ---------------------------------------------------------------------------
_ip_call_log: dict[tuple[str, str], list[float]] = defaultdict(list)
_IP_WINDOW_SECS = 60
_RATE_LIMITED_PATHS = {
    "/engineer_prompt": 30,
    "/compare_answers": 10,
    "/templates/suggest": 30,
    "/templates/track_use": 60,
    "/save_conversation": 60,
    "/process": 10,
    "/auth/login": 10,
    "/auth/register": 5,
    "/auth/session": 30,
    "/auth/google/token": 10,
    "/auth/google/exchange": 20,
}

# GET endpoints rate-limited separately (OAuth start is a GET redirect).
_RATE_LIMITED_GET_PATHS = {
    "/auth/google/signin": 10,
}


def _client_ip(request: StarletteRequest) -> str:
    """Return the client IP.

    DigitalOcean App Platform exposes the real client in `do-connecting-ip`.
    If that header is missing we fall back to the leftmost X-Forwarded-For hop
    (the original client when behind a trusted proxy) and finally the transport
    client host. Spoofing is possible only if the app is reached directly; in
    production it is always behind the platform ingress.
    """
    do_ip = request.headers.get("do-connecting-ip")
    if do_ip:
        return do_ip.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

# Model used for the one-time "see the difference" demo answers. Both the raw
# draft and the improved prompt are answered by the SAME model so the only
# variable in the comparison is the prompt itself — this keeps the demo honest.
_DEMO_ANSWER_MODEL = "claude-sonnet-4-6"
_DEMO_ENGINEER_MODEL = "claude-haiku-4-5-20251001"

# Human-readable labels for the model-transparency note in the compare UI.
_MODEL_DISPLAY_NAMES = {
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
}


def _engineer_system_prompt(adaptation_hint: str) -> str:
    """The v3 prompt-engineering system prompt. Validated in backend/evals/
    (beat the prior prompt 6-0-2 in blind pairwise judging). Shared by
    /engineer_prompt (no-memory path) and the /compare_answers demo."""
    return f"""You are a prompt engineer. Rewrite the user's rough draft into the message they should have sent — nothing else.

Rules, in priority order:
1. Your entire output is the rewritten prompt itself. It must read as a message from the user to an AI assistant. No commentary, no preamble, no "Here's the prompt", no notes about what you changed or don't know.
2. Never invent facts the user didn't give — no made-up names, dates, numbers, projects, reasons, or personal details. Where a needed detail is missing, have the prompt tell the assistant to use a clearly marked placeholder or offer options.
3. Match depth to the ask. A simple question stays a short prompt with at most a line about audience, depth, or format. Only requests for documents or complex work earn structure. Never demand exhaustive coverage the user didn't ask for — the goal is the right answer at the right length, not the longest one.
4. Add only what sharpens the answer: the user's goal or situation, the deliverable's form, the audience. If the draft is already clear, change little.
5. Use past conversations and profile context only when directly relevant; weave details in naturally.
6. Plain text only (no markdown bold or code fences; simple lists are fine). Never ask the user clarifying questions.
Adaptive preference hint: {adaptation_hint}"""


class IPRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        path = request.url.path
        limit = None
        if request.method == "POST" and path in _RATE_LIMITED_PATHS:
            limit = _RATE_LIMITED_PATHS[path]
        elif request.method == "GET" and path in _RATE_LIMITED_GET_PATHS:
            limit = _RATE_LIMITED_GET_PATHS[path]

        if limit is not None:
            ip = _client_ip(request)
            now = time.time()
            window_start = now - _IP_WINDOW_SECS
            key = (ip, path)
            log = _ip_call_log[key]
            log[:] = [t for t in log if t > window_start]
            if len(log) >= limit:
                return StarletteResponse(
                    content='{"detail":"Too many requests — slow down and try again in a minute."}',
                    status_code=429,
                    media_type="application/json",
                )
            log.append(now)
        return await call_next(request)


app.add_middleware(IPRateLimitMiddleware)


@app.get("/health") # Simple health check (Basically just checks if the server is running)
def health():
    return {"status": "ok", "version": "1.0.0"}

def _index_chunks_in_background(user_id: str, conversations: list[dict]) -> None:
    from services.retrieval import index_conversations_chunks
    report = index_conversations_chunks(user_id, conversations)
    print(f"[chunks] user={user_id}: {report}")


@app.post("/process") # So /process here is the endpoint that handels the file uploads, processes them and them and then creates the 2D mind world
async def process_files(
    background_tasks: BackgroundTasks,
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

    MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB hard limit per file
    if claude_file and claude_file.size and claude_file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Claude export file too large (max 200 MB)")
    if chatgpt_file and chatgpt_file.size and chatgpt_file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="ChatGPT export file too large (max 200 MB)")

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
# The imports are purposely made inside the function because we only want to load the models when the function is called and not when the file is imported.
        from services.embedder import embed_and_position # Loads AI models from sentence_transformers and umap (Imports from services/embedder.py)
        from services.cluster_labels import label_clusters


        chats, embeddings = embed_and_position(df) # This embeds the conversations into a 384-dimensional vector space and then labels the clusters
        chats = label_clusters(chats, effective_api_key) # This groups the chats by cluster_id, sends sample titles from each cluster to claude, claude returns a short label (e.g. "Job Search", "Python Help"), each chat then gets a 'region' (topic name) and a 'color' (hex code). Uses the same api key as the user's api key.

        storage_report = {}
        try:
            storage_report = store_conversations(user_id, chats, embeddings) or {} # Stores the conversations in the database using the user_id and the conversations and embeddings.
        except Exception as db_error:
            print(f"DB storage error: {db_error}") # This prints the error if the conversations are not stored in the database
            user_id = None

        if user_id and storage_report.get("conversations_stored"):
            # Chunking every conversation is the slow part of indexing, so it runs
            # after the map is returned. Copied because full_text is popped below.
            # Conversations whose newer stored copy was kept must not be re-chunked
            # from the older uploaded text.
            kept_newer = set(storage_report.get("kept_newer_ids") or [])
            to_index = [
                {"id": c["id"], "title": c.get("title"), "full_text": c.get("full_text", "")}
                for c in chats
                if c["id"] not in kept_newer
            ]
            background_tasks.add_task(_index_chunks_in_background, user_id, to_index)
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
            # Import is only useful if the embeddings landed — without them the
            # conversations show on the map but nothing is ever retrievable.
            "indexed": storage_report.get("embeddings_stored", 0),
            # Already stored with more messages (auto-saved after the export), so kept.
            "kept_newer": len(storage_report.get("kept_newer_ids") or []),
            "storage_errors": storage_report.get("errors", []),
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

    @field_validator("limit")
    @classmethod
    def clamp_limit(cls, v: int) -> int:
        return max(1, min(v, 20))

@app.post("/search")
async def search(request: SearchRequest):
    try:
        from services.database import get_personal_profile
        from services.embedder import get_embedding_model
        from services.retrieval import retrieve_candidates

        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token)
        query_embedding = get_embedding_model().encode([request.query])[0]

        profile = get_personal_profile(user_id)
        if profile.get("is_profile_enabled"):
            candidates = retrieve_candidates(
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
            results = retrieve_candidates(user_id, query_embedding, request.limit)

        for r in results:
            r.pop("matched", None)
        return {"results": results, "query": request.query}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class EngineerPromptRequest(BaseModel):
    email: str
    message: str
    access_token: str
    conversation_ids: Optional[list[str]] = None
    api_key: Optional[str] = None
    template: Optional[str] = None
    skip_memory: Optional[bool] = False
    device_id: Optional[str] = None
    platform: Optional[str] = None


class CompareAnswersRequest(BaseModel):
    email: str
    access_token: str
    message: str
    api_key: Optional[str] = None
    device_id: Optional[str] = None


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
    action: str  # confirm | correct | skip | shown
    correction_ids: Optional[list[str]] = None

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        allowed = {"confirm", "correct", "skip", "shown"}
        if (v or "").strip().lower() not in allowed:
            raise ValueError("action must be one of confirm, correct, skip, shown")
        return v.strip().lower()

@app.post("/engineer_prompt")
async def engineer_prompt(http_req: Request, request: EngineerPromptRequest):
    try:
        # Verify the request comes from an authorised extension build
        if http_req.headers.get("X-MW-Client") != MW_CLIENT_SECRET:
            raise HTTPException(
                status_code=401,
                detail="Unauthorised client. Please update the Mind World extension."
            )

        import anthropic
        from services.embedder import get_embedding_model
        from services.database import (
            get_personal_profile,
            get_prompt_template_by_name,
        )
        from services.retrieval import build_excerpt, retrieve_candidates

        api_key = request.api_key or os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=400,
                detail="Anthropic API key required — add one in the extension or configure the server."
            )

        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token, request.api_key)
        skip_memory = bool(request.skip_memory)

        # ── Quota & abuse checks (only for users on the shared server key) ──
        _using_server_key = not bool(request.api_key)
        _quota_row: dict = {}
        if _using_server_key:
            from services.database import get_supabase as _get_sb
            _sb = _get_sb()

            # Fetch quota counters first — pro users are exempt from every
            # check below (device fingerprint included). Checking is_pro
            # only *after* the device check let a shared dev/test machine
            # with old throwaway accounts permanently block paid accounts.
            _urow = _sb.table("users")\
                .select("improve_calls_used, is_pro")\
                .eq("id", user_id).execute()
            _quota_row = _urow.data[0] if _urow.data else {}

            if not _quota_row.get("is_pro"):
                # Bind device_id to account on first seen (fraud signal)
                if request.device_id:
                    _sb.table("users").update({"device_id": request.device_id})\
                        .eq("id", user_id).is_("device_id", "null").execute()

                    # If this device_id is linked to 3+ OTHER accounts that have
                    # actually used the free tier *recently* → likely multi-account
                    # abuse. Scoped to recent + active accounts only, so a dev/QA
                    # machine that has accumulated old throwaway test accounts over
                    # weeks doesn't permanently brick every account that touches it.
                    _abuse_cutoff = (datetime.utcnow() - timedelta(days=3)).isoformat()
                    _others = _sb.table("users").select("id")\
                        .eq("device_id", request.device_id)\
                        .neq("id", user_id)\
                        .gt("improve_calls_used", 0)\
                        .gte("created_at", _abuse_cutoff)\
                        .execute()
                    if len(_others.data or []) >= 3:
                        raise HTTPException(status_code=429, detail="quota_exceeded")

                if (_quota_row.get("improve_calls_used") or 0) >= FREE_TIER_LIMIT:
                    raise HTTPException(status_code=402, detail="quota_exceeded")

        _prefetched_profile = None
        _prefetched_facts = None
        _candidate_count = 0

        if skip_memory:
            selected = []
        elif request.conversation_ids:
            from services.database import get_supabase
            selected = get_supabase().table("knowledge_nodes")\
                .select("id, title, full_text, preview, created_at, num_messages, source_app")\
                .eq("user_id", user_id)\
                .in_("id", request.conversation_ids)\
                .execute().data or []

            if not selected:
                from services.database import get_supabase
                supabase = get_supabase()
                result = supabase.table("knowledge_nodes")\
                    .select("id, title, full_text, preview, created_at, num_messages, source_app")\
                    .in_("id", request.conversation_ids)\
                    .execute()
                selected = result.data or []
        else:
            embedding = get_embedding_model().encode([request.message])[0]
            profile = get_personal_profile(user_id)
            profile_data = profile.get("profile_data") or {}
            if profile.get("is_profile_enabled"):
                candidates = retrieve_candidates(user_id, embedding, 20)
                candidates = hybrid_score_conversations(
                    candidates,
                    request.message,
                    profile_data,
                )[:15]
            else:
                candidates = retrieve_candidates(user_id, embedding, 15)
            _candidate_count = len(candidates or [])
            # Rerank and profile-fact picking are independent LLM calls —
            # run them concurrently instead of back-to-back.
            from concurrent.futures import ThreadPoolExecutor
            from services.personalization_llm import (
                rerank_conversations_llm,
                pick_relevant_profile_facts_llm,
            )
            with ThreadPoolExecutor(max_workers=2) as _pool:
                _rerank_future = _pool.submit(
                    rerank_conversations_llm,
                    request.message,
                    candidates,
                    api_key,
                    5,
                )
                _facts_future = None
                if profile.get("is_profile_enabled"):
                    _facts_future = _pool.submit(
                        pick_relevant_profile_facts_llm,
                        profile_data,
                        request.message,
                        api_key,
                        6,
                    )
                selected = _rerank_future.result()
                if _facts_future is not None:
                    _prefetched_facts = _facts_future.result()
            _prefetched_profile = profile

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
                "created_at": str(conv.get("created_at") or "")[:10],
                "similarity": round(float(sim) * 100, 1) if sim is not None else None,
            })
            if full_text:
                context_parts.append(
                    f"Conversation: {conv.get('title', 'Untitled')}\n"
                    f"Date: {str(conv.get('created_at', ''))[:10]}\n"
                    f"Messages: {conv.get('num_messages', 0)}\n"
                    f"Content:\n{build_excerpt(full_text, conv.get('matched'))}"
                )
        conv_context = "\n\n---\n\n".join(context_parts) if context_parts else ""
        has_history = bool(conv_context.strip())

        profile_context = ""
        adaptive = {}
        if not skip_memory:
            profile = _prefetched_profile or get_personal_profile(user_id)
            profile_data = (profile.get("profile_data") or {}) if profile else {}
            confirmed_facts = extract_confirmed_anchor_facts(profile_data)
            if confirmed_facts:
                profile_context = "\n[USER-VERIFIED PERSONALIZATION ANCHORS]\n"
                for fact in confirmed_facts:
                    profile_context += f"- {fact}\n"
                profile_context += "\n"
            if profile and profile.get("is_profile_enabled"):
                adaptive = profile_data.get("adaptive_weights") or {}
                if _prefetched_facts is not None:
                    relevant_profile_facts = _prefetched_facts
                else:
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
            # v3 prompt — validated against the old prompt in backend/evals/
            # (won 6-0-2 in blind pairwise judging; old prompt fabricated user
            # facts and inflated simple questions into demand-everything lists).
            system_prompt = _engineer_system_prompt(adaptation_hint)

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

        # ── Increment free-tier usage counter on successful call ──
        if _using_server_key:
            try:
                _get_sb().table("users").update({
                    "improve_calls_used": (_quota_row.get("improve_calls_used") or 0) + 1
                }).eq("id", user_id).execute()
            except Exception:
                pass  # non-fatal — don't fail the response over a counter write

        from services.database import log_growth_event
        log_growth_event(user_id, "improve_used", platform=request.platform)

        # Why memory did or didn't contribute. Without this the extension can
        # only say "no past chats", which is wrong and confusing for a user who
        # has hundreds stored but whose embeddings/user_id are out of sync.
        memory = {"status": "used"}
        if skip_memory:
            memory["status"] = "skipped"
        elif not sources_used:
            from services.database import get_supabase as _sb_diag
            _sbd = _sb_diag()
            _nodes = _sbd.table("knowledge_nodes").select("id", count="exact")\
                .eq("user_id", user_id).limit(1).execute()
            _embs = _sbd.table("embeddings").select("conversation_id", count="exact")\
                .eq("user_id", user_id).limit(1).execute()
            memory["stored_conversations"] = _nodes.count or 0
            memory["embedded_conversations"] = _embs.count or 0
            memory["candidates"] = _candidate_count
            if memory["stored_conversations"] == 0:
                memory["status"] = "no_data"
            elif memory["embedded_conversations"] == 0:
                # Conversations exist but nothing is searchable — the import
                # wrote knowledge_nodes without embeddings, or under another id.
                memory["status"] = "not_indexed"
            else:
                memory["status"] = "no_match"

        return {
            "engineered_prompt": formatted,
            "conversations_used": len(context_parts),
            "sources_used": sources_used,
            "memory": memory,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/compare_answers")
async def compare_answers(http_req: Request, request: CompareAnswersRequest):
    """'See the difference' demo — limited to COMPARE_FREE_LIMIT uses for
    free-tier users. Engineers the rough draft into an improved prompt, then
    answers BOTH the raw draft and the improved prompt with the SAME model so
    the only variable is the prompt. Returns both answers plus the improved
    prompt for a side-by-side view."""
    try:
        if http_req.headers.get("X-MW-Client") != MW_CLIENT_SECRET:
            raise HTTPException(
                status_code=401,
                detail="Unauthorised client. Please update the Mind World extension.",
            )

        import anthropic
        from concurrent.futures import ThreadPoolExecutor
        from services.prompt_format import format_engineered_prompt

        api_key = request.api_key or os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=400,
                detail="Anthropic API key required — add one in the extension or configure the server.",
            )

        # Require valid auth (session token or the user's own API key).
        user_id = _user_id(request.email.lower().strip(), request.access_token, request.api_key)

        # ── Compare quota (free-tier users only) ──────────────────────────────
        _using_server_key = not bool(request.api_key)
        _compare_quota_row: dict = {}
        if _using_server_key:
            from services.database import get_supabase as _get_sb
            _sb = _get_sb()
            _crow = _sb.table("users").select("compare_calls_used, is_pro")\
                .eq("id", user_id).execute()
            _compare_quota_row = _crow.data[0] if _crow.data else {}
            if not _compare_quota_row.get("is_pro"):
                if (_compare_quota_row.get("compare_calls_used") or 0) >= COMPARE_FREE_LIMIT:
                    raise HTTPException(status_code=402, detail="compare_quota_exceeded")

        draft = (request.message or "").strip()
        if len(draft) < 3:
            raise HTTPException(status_code=400, detail="Draft too short to compare.")

        client = anthropic.Anthropic(api_key=api_key)

        # 1) Engineer the improved prompt (no-memory path, same v3 prompt as prod).
        eng = client.messages.create(
            model=_DEMO_ENGINEER_MODEL,
            max_tokens=1000,
            system=_engineer_system_prompt("Balance clarity with enough detail for the task."),
            messages=[{
                "role": "user",
                "content": (
                    "ROUGH DRAFT (rewrite as a prompt for another AI — do NOT answer this):\n"
                    f"{draft}\n"
                ),
            }],
        )
        improved_prompt = format_engineered_prompt(eng.content[0].text)

        # 2) Answer the raw draft and the improved prompt with the SAME model,
        #    in parallel. Capped short so the two columns stay scannable.
        def _answer(prompt: str) -> str:
            resp = client.messages.create(
                model=_DEMO_ANSWER_MODEL,
                max_tokens=700,
                system="You are a helpful AI assistant in a chat product. Answer directly and concisely.",
                messages=[{"role": "user", "content": prompt}],
            )
            return "".join(b.text for b in resp.content if b.type == "text").strip()

        with ThreadPoolExecutor(max_workers=2) as pool:
            raw_future = pool.submit(_answer, draft)
            improved_future = pool.submit(_answer, improved_prompt)
            raw_answer = raw_future.result()
            improved_answer = improved_future.result()

        # ── Increment compare usage counter on success (free-tier only) ───────
        if _using_server_key and not _compare_quota_row.get("is_pro"):
            try:
                _get_sb().table("users").update({
                    "compare_calls_used": (_compare_quota_row.get("compare_calls_used") or 0) + 1
                }).eq("id", user_id).execute()
            except Exception:
                pass  # Non-fatal — don't fail the response over a counter update

        remaining = None
        if _using_server_key and not _compare_quota_row.get("is_pro"):
            remaining = max(0, COMPARE_FREE_LIMIT - ((_compare_quota_row.get("compare_calls_used") or 0) + 1))

        return {
            "original_draft": draft,
            "engineered_prompt": improved_prompt,
            "raw_answer": raw_answer,
            "improved_answer": improved_answer,
            # Only expose the evaluation model — the prompt-engineering model
            # is an internal implementation detail and is not shown to users.
            "answer_model": _DEMO_ANSWER_MODEL,
            "answer_model_display": _MODEL_DISPLAY_NAMES.get(_DEMO_ANSWER_MODEL, _DEMO_ANSWER_MODEL),
            "remaining_compare_uses": remaining,
        }

    except HTTPException:
        raise
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


@app.get("/templates/categories")
async def template_categories():
    try:
        from services.database import get_template_categories
        return {"categories": get_template_categories()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class TemplateSuggestRequest(BaseModel):
    email: str
    access_token: str
    draft: str
    limit: int = 5
    category: str = ""
    tier: str = ""
    api_key: Optional[str] = None

    @field_validator("limit")
    @classmethod
    def clamp_limit(cls, v: int) -> int:
        return max(1, min(v, 12))

    @field_validator("draft")
    @classmethod
    def clamp_draft(cls, v: str) -> str:
        return (v or "")[:5000]


@app.post("/templates/suggest")
async def suggest_templates(request: TemplateSuggestRequest):
    try:
        from services.template_suggester import suggest_templates_with_ai
        from services.database import get_supabase as _get_sb

        email = request.email.lower().strip()
        user_id = _user_id(email, request.access_token, request.api_key)

        # Apply the same server-key quota check used by /engineer_prompt so free-tier
        # users cannot burn unlimited server Anthropic credits.
        _using_server_key = not bool(request.api_key)
        _quota_row: dict = {}
        if _using_server_key:
            _sb = _get_sb()
            _urow = _sb.table("users")\
                .select("improve_calls_used, is_pro")\
                .eq("id", user_id).execute()
            _quota_row = _urow.data[0] if _urow.data else {}
            if not _quota_row.get("is_pro"):
                if (_quota_row.get("improve_calls_used") or 0) >= FREE_TIER_LIMIT:
                    raise HTTPException(status_code=402, detail="quota_exceeded")

        templates = suggest_templates_with_ai(
            request.draft,
            request.limit,
            category=request.category or "",
            tier=request.tier or "",
            api_key=request.api_key or None,
        )

        # Charge the server-key quota on successful AI suggestion.
        if _using_server_key:
            try:
                _get_sb().table("users").update({
                    "improve_calls_used": (_quota_row.get("improve_calls_used") or 0) + 1
                }).eq("id", user_id).execute()
            except Exception:
                pass

        return {"templates": templates, "ai": True}
    except HTTPException:
        raise
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

class RegisterRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class GoogleTokenRequest(BaseModel):
    id_token: str


class GoogleHandoffExchangeRequest(BaseModel):
    code: str


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

    url, state_token = google_signin_redirect_url(source)
    response = RedirectResponse(url=url)
    response.set_cookie(
        key="mw_oauth_state",
        value=state_token,
        max_age=600,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/auth/google",
    )
    return response


@app.get("/auth/google/signin/callback")
async def auth_google_signin_callback(
    request: StarletteRequest,
    code: str = "",
    state: str = "",
    error: str = "",
):
    from fastapi.responses import RedirectResponse
    from services.auth import (
        create_auth_handoff_code,
        exchange_google_auth_code,
        link_or_create_google_user,
        verify_oauth_state,
    )
    import urllib.parse

    frontend_url = os.getenv("FRONTEND_URL", "https://mind-world.app").rstrip("/")

    def _error_redirect(message: str) -> RedirectResponse:
        resp = RedirectResponse(url=f"{frontend_url}/auth/callback?error={urllib.parse.quote(message)}")
        resp.delete_cookie("mw_oauth_state", path="/auth/google")
        return resp

    if error:
        return _error_redirect(error)

    if not code:
        return _error_redirect("missing_code")

    cookie_state = request.cookies.get("mw_oauth_state")
    try:
        source = verify_oauth_state(state, cookie_state)
    except HTTPException as exc:
        return _error_redirect(str(exc.detail))

    api_base = (os.getenv("API_PUBLIC_URL") or "https://mind-world-app-mv4yv.ondigitalocean.app").rstrip("/")
    redirect_uri = f"{api_base}/auth/google/signin/callback"

    try:
        profile = exchange_google_auth_code(code, redirect_uri)
        user_id, has_password = link_or_create_google_user(profile["google_id"], profile["email"])
        handoff_code = create_auth_handoff_code(
            user_id=user_id,
            email=profile["email"],
            source=source,
            has_password=has_password,
        )
        params = urllib.parse.urlencode(
            {
                "code": handoff_code,
                "source": source,
            }
        )
        response = RedirectResponse(url=f"{frontend_url}/auth/callback?{params}")
        response.delete_cookie("mw_oauth_state", path="/auth/google")
        return response
    except HTTPException as exc:
        return _error_redirect(str(exc.detail))
    except Exception as exc:
        return _error_redirect(str(exc))


@app.post("/auth/google/exchange")
async def auth_google_exchange(request: GoogleHandoffExchangeRequest):
    try:
        from services.auth import exchange_auth_handoff_code

        return exchange_auth_handoff_code(request.code)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        from services.database import get_or_create_user, record_user_consent, log_growth_event, CONSENT_VERSION

        email = request.email.lower().strip()
        if not request.consent_version:
            raise HTTPException(status_code=400, detail="consent_version is required")

        user_id = _user_id(email, request.access_token)
        result = record_user_consent(user_id, request.consent_version, request.source or "extension")
        # Consent is recorded once right after sign-in completes in the popup —
        # the cleanest available signal for "activated" in the funnel.
        log_growth_event(user_id, "connected", platform=request.source or "extension")
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

        user_result = supabase.table("users")\
            .select("consent_at, consent_version, consent_source")\
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

        return {
            "conversation_count": len(conversations),
            "platform_count": len(sources),
            "sources": list(sources),
            "user_id": user_id,
            **consent_info,
        }
    except Exception as e:
        return {
            "conversation_count": 0,
            "platform_count": 0,
            "sources": [],
        }

class SaveConversationRequest(BaseModel):
    email: str
    access_token: str
    conversation: dict

    @field_validator("conversation")
    @classmethod
    def validate_conversation(cls, v: dict) -> dict:
        if not isinstance(v, dict):
            raise ValueError("conversation must be an object")
        if len(str(v)) > 100_000:
            raise ValueError("conversation payload too large")
        return v


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
            "full_text": full_text,
            "cluster_id": -1,
            "region": "Recent",
            "color": "#888888",
            "x": 0.0,
            "y": 0.0,
        }

        supabase.table("knowledge_nodes").upsert(
            row, on_conflict="id"
        ).execute()

        supabase.table("embeddings").upsert({
            "conversation_id": conv_id,
            "user_id": user_id,
            "embedding": embedding.tolist()
        }, on_conflict="conversation_id,user_id").execute()

        from services.database import log_growth_event
        log_growth_event(user_id, "autosave_used", platform=source)

        background_tasks.add_task(
            _index_chunks_in_background,
            user_id,
            [{"id": conv_id, "title": row["title"], "full_text": full_text}],
        )
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
            .select(
                "id, title, source_app, x, y, color, region, num_messages, "
                "char_count, preview, created_at, updated_at, cluster_id"
            )\
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
                "color": c.get("color", "#888888"),
                "region": c.get("region", "Other"),
                "num_messages": c.get("num_messages", 0),
                "char_count": c.get("char_count", 0),
                "preview": c.get("preview", ""),
                "created_at": c.get("created_at", ""),
                "updated_at": c.get("updated_at", ""),
                "cluster_id": c.get("cluster_id", -1),
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
    access_token: str

async def run_recluster(email: str):
    from services.database import get_or_create_user
    from services.database import get_supabase
    import numpy as np

    supabase = get_supabase()
    email = email.lower().strip()
    user_id = get_or_create_user(email)

    # Get all conversations for this user. preview (first 300 chars) is enough
    # for map placement; full_text is large and runs on every auto-save.
    result = supabase.table("knowledge_nodes")\
        .select("id, title, preview, x, y")\
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
        text = c.get('preview') or ''
        all_texts.append(f"{title}. {text}")

    # Embed all texts
    from services.embedder import get_embedding_model
    embeddings = get_embedding_model().encode(all_texts, show_progress_bar=False)

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


@app.get("/")
def root():
    return {
        "name": "Mind World API",
        "version": "1.0.0",
        "docs": "/docs",
    }

