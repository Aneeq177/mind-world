# Mind World

A Chrome extension that improves your AI prompts as you type — using a searchable template library, one-click **Improve**, and memory from your past conversations across Claude, ChatGPT, Gemini, and Perplexity.

**Primary product:** Chrome extension (daily use)  
**Secondary:** [mind-world.app](https://mind-world.app) — bulk import and 2D semantic memory map

Product scope and the v1 finish line live in [VISION.md](VISION.md). Security policy: [SECURITY.md](SECURITY.md).

## How it works

1. **Install** the extension and sign in.
2. **Optionally** upload past Claude/ChatGPT exports via the popup or [mind-world.app](https://mind-world.app).
3. **Chat** on Claude, ChatGPT, Gemini, or Perplexity — use a **template chip** or click **Improve** (Alt+Shift+M).
4. Mind World silently finds relevant past conversations, infers your preferences, and returns a clearer, structured prompt.
5. **New conversations auto-save** in the background and feed future Improve calls.

```
Chrome extension (MV3)
  input-dock.js  template chips + Improve popover
  content.js     DOM observation, auto-save, input injection
  background.js  API relay, storage queue, keyboard shortcut
  popup.js       login, stats, import, profile settings
        │  HTTPS
        ▼
FastAPI backend (DigitalOcean)
  /templates  /search  /engineer_prompt  /save_conversation  /process  /load_map
  services/: parser · embedder (UMAP/HDBSCAN) · cluster_labels · personalization · auth
        │
        ▼
Supabase (PostgreSQL + pgvector)
  users · conversations · embeddings · prompt_templates · personal_profiles

Web app — mind-world.app (React + Vite, Vercel)
  bulk upload / load map · 2D Plotly map · power-user Context Blender
```

## Core features

### Template chips & library

- Quick-insert prompt scaffolds above the chat input (e.g. debug code, review essay, write email).
- Searchable template library with categories, favorites, and intent-based suggestions.
- Works on day one — no conversation history required.

### Improve (primary action)

- Reads your draft, retrieves relevant memory, and engineers a structured prompt via Claude Haiku.
- Preview popover lets you **Replace** or edit before sending.
- Keyboard shortcut: **Alt+Shift+M**.

### Memory-aware personalization

Mind World builds a lightweight profile from your conversation history — no forms required:

- **Domain expertise** and **communication preferences** inferred with confidence scores.
- **Active projects** surfaced automatically from recent chats.
- **Hybrid retrieval** — vector similarity reranked by recency decay and profile/project match.
- **Clarification chips** when intent or profile confidence is low.
- **Edit-feedback loop** — learns from how you edit engineered prompts.

Only high-confidence, query-relevant facts are woven into prompts.

### Silent context capture

- Conversations are auto-saved from the DOM via content scripts and a background queue.
- Embeddings stored in Supabase (pgvector) for semantic search.
- UMAP + HDBSCAN clustering powers the 2D memory map on the web app.

## Live URLs

| Component | URL |
|-----------|-----|
| Web app | https://mind-world.app |
| Backend API | https://mind-world-app-mv4yv.ondigitalocean.app |
| API docs | https://mind-world-app-mv4yv.ondigitalocean.app/docs |

## Tech stack

| Layer | Stack |
|-------|-------|
| Extension | Chrome MV3, vanilla JavaScript (no build step) |
| Backend | FastAPI, Python |
| Embeddings | sentence-transformers (`all-MiniLM-L6-v2`, 384-dim) |
| Vector search | Supabase PostgreSQL + pgvector |
| Prompt engineering | Claude Haiku (Anthropic API) |
| Clustering / map | UMAP, HDBSCAN |
| Web app | React, Vite, Plotly, Zustand |
| Deployment | DigitalOcean (API), Vercel (web), Supabase (DB) |

## Repository structure

```
mind-world/
├── extension/          # Chrome extension — primary product surface
├── backend/            # FastAPI API + ML pipeline
│   ├── main.py         # REST endpoints
│   ├── services/       # database, auth, personalization, embeddings, prompt formatting
│   ├── migrations/     # Supabase schema migrations (run in order)
│   ├── tests/          # pytest suite
│   ├── evals/          # Improve quality eval script
│   └── analytics_queries.sql  # growth/activation dashboard queries
├── frontend/           # React web app — import and 2D map
├── VISION.md           # Product scope and v1 finish line
└── SECURITY.md         # Vulnerability reporting and security practices
```

## Key API endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /engineer_prompt` | Improve — structures prompt with memory + personalization |
| `POST /search` | Semantic search over saved conversations |
| `POST /save_conversation` | Auto-save from extension (triggers background recluster) |
| `GET /templates` | Template chip library |
| `POST /personalization_summary` | Inferred profile summary for confirmation |
| `POST /prompt_feedback` | Edit-diff feedback and adaptation signals |
| `POST /process` | Bulk import (popup + web upload) |
| `POST /load_map` | Load 2D map data for web app |
| `POST /user_stats` | Popup stats and onboarding |

Full reference: [API docs](https://mind-world-app-mv4yv.ondigitalocean.app/docs).

## Extension development

1. Open `chrome://extensions` and enable **Developer mode**
2. **Load unpacked** → select the `extension/` folder
3. Reload after code changes

Extension scripts must be UTF-8 encoded (PowerShell `>` redirects write UTF-16 and break Chrome).

## Backend (local)

```bash
cd backend
python -m venv venv
venv\Scripts\activate   # Windows
# source venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
cp .env.example .env    # then fill in values
uvicorn main:app --reload
```

Run tests with `pip install pytest && pytest` from `backend/`. Migrations in `backend/migrations/` are applied against Supabase (`.py` files use `DATABASE_URL`; `.sql` files run in the Supabase SQL editor).

## Frontend (local)

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_API_URL` in `frontend/.env.local` to point at a local backend.
