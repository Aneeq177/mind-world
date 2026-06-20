# Mind World

A Chrome extension that improves your AI prompts as you type — using a searchable template library, one-click **Improve**, and memory from your past conversations across Claude, ChatGPT, Gemini, and Perplexity.

**Primary product:** Chrome extension (daily use)  
**Secondary:** [mind-world.app](https://mind-world.app) — bulk import and 2D semantic memory map

## What it does

Mind World sits directly on the chat input of major AI platforms. It helps you write clearer, more structured prompts so the AI gives better answers — without learning prompt engineering or manually searching old chats.

1. **Install** the extension and sign in with your email.
2. **Optionally** upload past Claude/ChatGPT exports via the popup or [mind-world.app](https://mind-world.app).
3. **Chat** on Claude, ChatGPT, Gemini, or Perplexity — use **template chips** or click **Improve** (Alt+Shift+M).
4. Mind World silently finds relevant past conversations, infers your preferences, and returns a clearer, structured prompt.
5. **New conversations auto-save** in the background and feed future Improve calls.

See [VISION.md](VISION.md) for product scope and [ARCHITECTURE.md](ARCHITECTURE.md) for system design.

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

- **Domain expertise** — per-domain signals (coding, education, career, writing) with confidence scores.
- **Communication preferences** — inferred style (concise vs. detailed, step-by-step, examples).
- **Active projects** — recurring topics surfaced automatically from recent chats.
- **Hybrid retrieval** — vector similarity reranked by recency decay and profile/project match.
- **Clarification chips** — low-friction yes/no questions when intent or profile confidence is low.
- **Edit-feedback loop** — captures how you edit engineered prompts and adapts future output.
- **Profile confirmation** — optional one-tap summary ("Looks like you're mostly doing software engineering — sound right?").

Personalization is guarded against over-injection: only high-confidence, query-relevant facts are woven into prompts.

### Silent context capture

- Conversations are auto-saved from the DOM via content scripts and a background queue.
- Embeddings stored in Supabase (pgvector) for semantic search.
- UMAP + HDBSCAN clustering powers the 2D memory map on the web app.

### Web app (mind-world.app)

- Bulk upload of Claude/ChatGPT export files.
- Interactive 2D semantic map (Plotly) — browse, search, time slider, click for detail.
- Manual **Context Blender** in the sidebar for power users.

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
│   ├── input-dock.js   # Template chips, Improve popover, clarification UI
│   ├── content.js      # DOM observation, auto-save, input injection
│   ├── background.js   # API relay, storage queue, keyboard shortcut
│   └── popup.js        # Login, stats, import, profile settings
├── backend/            # FastAPI API + ML pipeline
│   ├── main.py         # REST endpoints
│   ├── services/       # database, personalization, embeddings, prompt formatting
│   ├── migrations/     # Supabase schema migrations
│   └── tests/          # Personalization and adaptation tests
├── frontend/           # React web app — import and 2D map visualization
├── VISION.md           # Product scope and v1 finish line
├── ARCHITECTURE.md     # System diagram and API reference
└── public_app.py       # Legacy Streamlit demo (frozen)
```

## Key API endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /engineer_prompt` | Improve — structures prompt with memory + personalization |
| `POST /search` | Semantic search over saved conversations |
| `POST /save_conversation` | Auto-save from extension |
| `GET /templates` | Template chip library |
| `POST /personalization_summary` | Inferred profile summary for confirmation |
| `POST /prompt_feedback` | Edit-diff feedback and adaptation signals |
| `POST /process` | Bulk import (popup + web upload) |
| `POST /load_map` | Load 2D map data for web app |

## Extension development

Load unpacked in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder
4. Reload after code changes

**Important:** Extension scripts must be UTF-8 encoded (not UTF-16 from PowerShell redirects).

Supported platforms: Claude, ChatGPT, Gemini, Perplexity.

## Backend (local)

```bash
cd backend
python -m venv venv
venv\Scripts\activate   # Windows
# source venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

Set in `.env`:

```
ANTHROPIC_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
DATABASE_URL=...        # for running migrations
```

Run the API:

```bash
uvicorn main:app --reload
```

Run migrations (against Supabase):

```bash
python migrations/003_personal_profiles.py
python migrations/006_personalization_phase1.py
python migrations/007_prompt_edit_feedback_adaptation.py
```

## Frontend (local)

```bash
cd frontend
npm install
npm run dev
```

## Supported platforms

| Platform | Extension support |
|----------|-------------------|
| Claude | Yes |
| ChatGPT | Yes |
| Gemini | Yes |
| Perplexity | Yes |

## Legacy Hugging Face demo

The original Streamlit 2D map lives in `public_app.py` and deploys to Hugging Face Spaces. The React app at [mind-world.app](https://mind-world.app) is the canonical web experience.
