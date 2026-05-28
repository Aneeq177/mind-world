

# Mind World — Project Handoff Document

## 1. Ultimate Goal and Vision

Mind World is a **cognitive operating system** that sits on top of all your AI interactions and turns thousands of isolated conversations into a single growing body of thought.

### The One-Sentence Version
Mind World starts as a memory layer that gives Claude and ChatGPT memory across sessions, becomes a company brain that captures institutional knowledge, and ends as a visual agent orchestration platform where you drag and drop AI workflows on a 3D map of your thinking.

### The Three Layers

**Personal Layer**
Every AI conversation you have is captured, stored, and made searchable. When you start a new conversation, Mind World surfaces what you already know. You never re-explain your situation from scratch. Your history becomes your memory.

**Company Layer**
Every employee's AI conversations — with permission — flow into a shared company brain. When someone new joins, they don't read 200 Notion pages. They ask the company brain. Institutional knowledge stops evaporating when people leave.

**Orchestration Layer**
The 3D map becomes a drag-and-drop workflow builder. Instead of chatting with one AI at a time, you set up assembly lines of specialized agents that pass work between each other automatically. The map is the visual control room where you see, manage, and debug these workflows in real time.

### Why This Is a Real Business
- No single AI company (Anthropic, OpenAI, Google) can build cross-platform memory because it requires ingesting competitors' data. A neutral third party can. That is Mind World's structural moat.
- Individual users pay $9/month. Companies pay $49/user/month and never churn because switching means losing institutional memory.
- Target acquirers: Anthropic, OpenAI, Notion, Microsoft, Salesforce.
- Acquisition conversations: after 1,000 daily active users and $10K MRR.

---

## 2. Tech Stack and Architecture

### Why Each Choice Was Made

| Layer | Technology | Why |
|-------|-----------|-----|
| 2D App | Python + Streamlit | Fastest way to ship a working demo. Used as proof of concept and for Hugging Face public deployment. |
| 3D Frontend | React + Three.js + Vite | React for UI components, Three.js for 3D rendering, React Three Fiber as the bridge. Vite for fast builds. Deployed on Vercel. |
| Backend API | FastAPI + Python | Keeps existing Python ML pipeline (embeddings, UMAP, clustering). Exposes it as REST endpoints. Deployed on DigitalOcean 2GB RAM droplet. |
| Database | Supabase (PostgreSQL + pgvector) | Free tier, built-in vector similarity search via pgvector, simple REST API, scales to company brain use case. |
| Chrome Extension | Vanilla JS + Manifest V3 | No build step needed, runs directly in Chrome, Manifest V3 is the current Chrome standard. |
| Embeddings | sentence-transformers (all-MiniLM-L6-v2) | 384-dimensional embeddings, fast, accurate, runs on CPU without GPU. |
| Clustering | HDBSCAN + UMAP | UMAP for dimensionality reduction to 3D coordinates, HDBSCAN for automatic cluster detection without specifying number of clusters. |
| AI Labeling | Claude Haiku | Fast and cheap. Used to label clusters and generate smart summaries for context injection. |

### Deployment URLs
- **2D App:** https://huggingface.co/spaces/shah66/mind-world
- **3D Frontend:** https://mind-world-indol.vercel.app
- **Backend API:** https://mind-world-app-mv4yv.ondigitalocean.app
- **API Docs:** https://mind-world-app-mv4yv.ondigitalocean.app/docs
- **Database:** Supabase project at `qlwdoejtszndqifpbadd.supabase.co`

### Repository Structure
```
mind-world/
├── public_app.py          # 2D Streamlit app (Hugging Face)
├── backend/               # FastAPI backend (DigitalOcean)
│   ├── main.py            # API endpoints
│   ├── models.py          # Pydantic models
│   ├── Dockerfile         # Docker config for deployment
│   ├── requirements.txt
│   └── services/
│       ├── parser.py      # Claude + ChatGPT export parsers
│       ├── embedder.py    # UMAP + HDBSCAN pipeline
│       ├── blender.py     # Context blending + summarization
│       └── database.py    # Supabase read/write (batched upserts)
├── frontend/              # React + Three.js (Vercel)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api.js         # API calls to backend
│   │   ├── store.js       # Zustand state management
│   │   └── components/
│   │       ├── Landing.jsx
│   │       ├── Universe.jsx
│   │       ├── ConversationOrb.jsx
│   │       ├── DetailPanel.jsx
│   │       └── Controls.jsx
│   └── package.json
├── extension/             # Chrome Extension (loaded unpacked locally)
│   ├── manifest.json      # MV3, covers claude.ai/chatgpt.com/gemini/perplexity
│   ├── background.js      # Service worker, Chrome storage credentials, API calls
│   ├── content.js         # Sidebar injection, input watching, search, injection
│   ├── sidebar.css        # Sidebar + staging + preview panel styles
│   ├── popup.html         # Login view + connected view
│   ├── popup.js           # Login flow, Chrome storage, stats
│   ├── popup.css          # Popup styles
│   └── icons/
└── CLAUDE.md              # This document
```

### Database Schema (Supabase)
```sql
-- Users
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Conversations
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  title TEXT,
  source TEXT,           -- 'claude' | 'chatgpt'
  created_at TEXT,
  updated_at TEXT,
  num_messages INTEGER,
  char_count INTEGER,
  preview TEXT,
  full_text TEXT,
  cluster_id INTEGER,
  region TEXT,           -- AI-generated cluster label
  color TEXT,
  x FLOAT, y FLOAT, z FLOAT,  -- 3D coordinates from UMAP
  created_in_db TIMESTAMP DEFAULT NOW()
);

-- Embeddings (384-dimensional vectors for semantic search)
CREATE TABLE embeddings (
  conversation_id TEXT REFERENCES conversations(id),
  user_id UUID REFERENCES users(id),
  embedding VECTOR(384),
  PRIMARY KEY (conversation_id, user_id)
);

-- Semantic search function (pgvector)
-- match_conversations() function exists in Supabase
-- Uses cosine similarity: 1 - (embedding <=> query_embedding)
```

### API Endpoints
```
GET  /health              → Health check
POST /process             → Upload Claude/ChatGPT exports, returns 3D positioned conversations
POST /search              → Semantic search across stored conversations (returns 5 results)
POST /summarize           → Claude Haiku summarizes selected conversations for current query
POST /user_stats          → Returns conversation count and platform count for a user email
POST /save_conversation   → Save a single conversation from extension auto-capture
POST /blend               → Context blending (stub, returns 501)
```

### How the Data Pipeline Works
```
User uploads conversations.json (Claude) or .zip (ChatGPT)
       ↓
parser.py — extracts messages, cleans text, normalizes timestamps
       ↓
embedder.py — sentence-transformers encodes each conversation to 384-dim vector
       ↓
UMAP — reduces 384-dim to 3-dim (x, y, z coordinates for 3D world)
       ↓
HDBSCAN — finds natural topic clusters in the 3D space
       ↓
Claude Haiku — labels each cluster with a 2-4 word human-readable name
       ↓
database.py — upserts conversations + embeddings in batches of 50 into Supabase
       ↓
Returns JSON with x, y, z, color, region, source per conversation
       ↓
Three.js renders as glowing orbs in 3D space
```

### How the Extension Search + Injection Works
```
User types in Claude/ChatGPT/Gemini/Perplexity input field
       ↓
content.js debounces 1.5s, sends SEARCH message to background.js
       ↓
background.js reads email from chrome.storage.local
background.js expands short queries (e.g. "resume" → "resume job application career professional")
background.js POSTs to /search with email + expanded query
       ↓
/search embeds query with sentence-transformers, calls match_conversations() in Supabase
Returns top 5 results ranked by cosine similarity
       ↓
Sidebar slides in showing results with similarity scores and source badges
User clicks "+ Add to inject" on 1-4 conversations (staged)
       ↓
User clicks "✨ Preview & Inject" → background.js POSTs to /summarize
Claude Haiku generates per-conversation summaries relevant to current query
Returns formatted context_block string
       ↓
Preview panel shows context_block — user reviews it
User clicks "⚡ Inject into Chat" → context block prepended to input field
Platform-aware injection: textarea setter for ChatGPT, innerText for Claude/Gemini
```

---

## 3. What Has Been Completed

### Infrastructure ✅
- FastAPI backend deployed and running on DigitalOcean (2GB RAM)
- Supabase database set up with pgvector extension enabled
- Semantic search working and tested — cosine similarity search returns accurately ranked results
- Vercel frontend deployment with auto-deploy on GitHub push
- DigitalOcean backend auto-deploys on GitHub push
- GitHub repository connected to both Vercel and DigitalOcean

### 2D Streamlit App ✅
- Upload Claude or ChatGPT exports separately or together
- Unified 2D map with semantic clustering
- HDBSCAN auto-clustering (no hardcoded categories — works for any user's topics)
- Claude Haiku labels each cluster with a real topic name
- Time Machine slider — watch your conversation history grow month by month
- Context Blender — select 2-4 conversations, extract intelligence via Claude Haiku, open blended chat in Claude or ChatGPT
- Circle = Claude, Diamond = ChatGPT on the map
- Generate Map button (does not auto-process on single file upload)
- Email capture before map generation (stored in Google Sheets)
- localStorage-based blend limit (2 free blends, then API key required)
- Deployed publicly on Hugging Face

### 3D React + Three.js App ✅
- Landing page with Claude + ChatGPT file uploaders
- Email + API key collection before processing
- Loading screen with animated progress bar and cycling messages
- 3D universe rendering conversations as glowing orbs
- Star field background via React Three Fiber
- Sphere = Claude, Octahedron = ChatGPT
- Color coded by auto-detected topic cluster
- OrbitControls — rotate, zoom, pan
- Click orb → detail panel slides in (title, messages, topic, date, preview)
- Add to Blend button from detail panel
- Blend bar at bottom when conversations selected
- Filter by platform (All / Claude / ChatGPT)
- Filter by topic (dynamic, based on actual clusters in data)
- "New Upload" button to reset
- Error messages properly extracted from API responses (no more `[object Object]`)

### Chrome Extension ✅
- Manifest V3, works on claude.ai, chatgpt.com, gemini.google.com, perplexity.ai
- **Multi-user login flow** — popup shows login form on first install; email + API key saved to `chrome.storage.local`; background.js reads from storage (no hardcoded email)
- Popup connected view shows conversation count and platform count via `/user_stats`
- Logout button clears stored credentials
- Content script detects user typing with platform-aware input selectors:
  - Claude: `.ProseMirror`
  - ChatGPT: `#prompt-textarea`, `div.ProseMirror[contenteditable]`, `div[role="textbox"]`
  - Gemini: `.ql-editor`, `[contenteditable]`
  - Perplexity: `textarea`, `[contenteditable]`
- Listens for `input`, `keyup`, and `paste` events to handle all platform input methods
- Debounced auto-search — triggers 1.5s after user stops typing (minimum 15 chars)
- **Manual search box** at top of sidebar — type any topic and press Enter or → (minimum 2 chars)
- **Query expansion** for short queries — single words expanded to richer phrases before embedding (e.g. "transfer" → "college transfer application university admission")
- Sidebar shows top 5 results with similarity score and source badge (🟣 Claude / 🟢 ChatGPT)
- `[human]` and `[assistant]` role tags stripped from preview text
- "+ Add to inject" button stages conversations (up to 4 at once)
- Staging area shows count and Clear button
- "✨ Preview & Inject" calls `/summarize` — Claude Haiku generates smart summaries
- Preview panel shows full formatted context block before injection
- "⚡ Inject into Chat" prepends context block to chat input
  - Textarea platforms (ChatGPT): uses native input value setter for React compatibility
  - Contenteditable platforms (Claude, Gemini): sets `innerText`, moves cursor to end
- Shows "not logged in" warning in sidebar if no credentials found
- `autoSaveConversation()` captures conversation on DOM changes and POSTs to `/save_conversation`

### Backend ✅
- `/process` accepts email, stores all conversations and embeddings to Supabase
- `/search` embeds query and runs pgvector cosine similarity search, returns 5 results
- `/summarize` — Claude Haiku generates per-conversation summaries tailored to current query, returns formatted `context_block`
- `/user_stats` — returns `conversation_count` and `platform_count` for a user email
- `store_conversations()` processes in batches of 50 with `on_conflict` handling — no more upsert failures on re-upload

### Database ✅
- Users stored by email
- All conversations stored per user with full text and metadata
- 384-dim embeddings stored per conversation per user
- Semantic search function `match_conversations()` working
- Batched upsert logic — re-uploading doesn't create duplicates or fail on conflicts

### LinkedIn / Marketing ✅
- Two LinkedIn posts published
- Post 1: Video showing the 2D map concept
- Post 2: Live link with ChatGPT support announcement

---

## 4. Remaining Issues

### Issue 1 — Auto-Save Reliability
The `autoSaveConversation()` function exists but is fragile — Claude and ChatGPT change their DOM structure frequently. Selectors for detecting message elements break when the platform updates.

**What needs to happen:**
- More robust selectors or a MutationObserver approach that watches for streaming completion signals
- Backend `/save_conversation` endpoint needs to embed the single conversation and upsert into Supabase
- Extension shows a subtle "✓ Saved" confirmation toast

---

### Issue 2 — 3D World Topic Labels Show as "Topic 1, Topic 2"
AI-generated cluster labels from Claude Haiku are not showing in the 3D frontend — generic fallback labels appear instead.

**Root cause:** `label_clusters()` in `backend/services/blender.py` requires the API key passed from the frontend. If the call fails silently, fallback labels are used. Debug by checking the `/process` response in the browser Network tab — are `region` fields populated?

---

### Issue 3 — Blend Button in 3D World Does Nothing
The blend bar appears at the bottom when conversations are selected, but clicking "Blend Conversations" does nothing. The `/blend` endpoint returns 501 Not Implemented.

**What needs to happen:**
- Pass selected conversation IDs to `/summarize` or a new `/blend` endpoint
- Returns formatted context block
- Frontend opens Claude or ChatGPT with context pre-loaded in the URL or clipboard

---

### Issue 4 — Company Brain Schema Not Yet Built

**What needs to be added to Supabase:**
```sql
CREATE TABLE companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN company_id UUID REFERENCES companies(id);
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'member';

ALTER TABLE conversations ADD COLUMN visibility TEXT DEFAULT 'private';
ALTER TABLE conversations ADD COLUMN team_id UUID;
```

---

### Issue 5 — No Onboarding Flow
New users who install the extension have no guidance beyond the popup.

**What needs to happen:**
- Popup detects if user has 0 conversations in Supabase (already have `/user_stats`)
- Shows step-by-step "Get started" instructions in connected view when count is 0
- Direct link to the 3D app for upload

---

## Priority Order for Next Development Session

1. **Fix auto-save reliability** — important for the "upload once, never again" promise
2. **Fix blend button in 3D world** — good demo feature, `/summarize` already works
3. **Fix 3D topic labels** — visual polish
4. **Onboarding flow in extension popup** — needed before Chrome Web Store submission
5. **Company brain schema** — database foundation for next growth phase

---

## Environment Variables Required

### DigitalOcean Backend
```
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://qlwdoejtszndqifpbadd.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key>
```

### Vercel Frontend
No environment variables currently needed (API URL hardcoded in `frontend/src/api.js`).

### Extension (Chrome Storage, set by user via popup)
```
mw_email: user@example.com
mw_api_key: sk-ant-...
```

### Hugging Face (Secrets)
```
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_SHEETS_ID=<sheet_id>
GOOGLE_CREDENTIALS=<service_account_json>
```

---

## Key Decisions Made and Why

**Why not use a vector database like Pinecone?**
Supabase with pgvector handles everything in one place — user data, conversation metadata, and embeddings. Avoids managing a second service. pgvector is production-ready for the scale we need.

**Why DigitalOcean instead of Render or Railway?**
Render's free tier has 512MB RAM which causes out-of-memory errors during embedding (sentence-transformers needs ~1.5GB). Railway's trial has $5 credits that expire. DigitalOcean gives 2GB RAM covered by $200 GitHub Student Pack credits.

**Why Vanilla JS for the extension instead of React?**
Extensions don't need a build step for simple UI. React adds complexity without meaningful benefit for a sidebar. Vanilla JS loads faster and is easier to debug in chrome://extensions.

**Why not use the official Claude/ChatGPT API to auto-import conversations?**
Claude's API doesn't expose conversation history. ChatGPT's doesn't either. The export approach (users download their own data) is the only way to get historical data. The auto-save via DOM scraping handles new conversations going forward.

**Why HDBSCAN over K-Means for clustering?**
K-Means requires specifying the number of clusters upfront. HDBSCAN finds natural clusters automatically and handles noise points (conversations that don't fit any cluster) gracefully. This is essential since every user has a different distribution of topics.

**Why expand short search queries?**
Single-word queries produce poor embeddings because they lack context. "resume" as a 384-dim vector is ambiguous. Expanding to "resume job application career professional" gives the embedding model enough signal to return relevant matches. The expansion dictionary is maintained in `background.js` → `expandQuery()`.

**Why batch upserts in groups of 50?**
Supabase has request size limits and single large upserts were failing with conflict errors on re-upload. Batching to 50 with explicit `on_conflict` columns makes re-uploads idempotent and avoids timeouts.

---

## What "Done" Looks Like for Phase 2

The extension works for any user who installs it:
1. Install extension from Chrome Web Store (or load unpacked)
2. Click extension icon → enter email + Anthropic API key → click Activate
3. Go to mind-world-indol.vercel.app → upload conversation exports
4. Open claude.ai → start typing → sidebar appears with relevant past conversations
5. Select conversations → preview smart summary → inject context
6. New conversations auto-save in the background

When all 6 steps work reliably for someone who has never met the builder, Phase 2 is done.
