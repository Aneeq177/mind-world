# Mind World

A Chrome extension that improves your AI prompts as you type — using a searchable template library, one-click **Improve**, and memory from your past conversations across Claude, ChatGPT, Gemini, and Perplexity.

**Primary product:** Chrome extension (daily use)  
**Secondary:** [mind-world.app](https://mind-world.app) — bulk import and 2D semantic memory map

Product scope and the v1 finish line live in [VISION.md](VISION.md). Security policy: [SECURITY.md](SECURITY.md).

## How it works

1. **Install** the extension, sign in, and choose where memory lives: **on this device** (default) or **in the cloud**.
2. **Optionally** import past Claude/ChatGPT exports — on-device via the extension's import page, or in cloud mode via the popup or [mind-world.app](https://mind-world.app).
3. **Chat** on Claude, ChatGPT, Gemini, or Perplexity — use a **template chip** or click **Improve** (Alt+Shift+M).
4. Mind World finds relevant past conversations, infers your preferences, and returns a clearer, structured prompt.
5. **New conversations auto-save** in the background and feed future Improve calls.

### Memory modes

| Mode | Where conversations and vectors live | Who calls Claude for Improve |
|------|--------------------------------------|------------------------------|
| **On-device** (default) | IndexedDB in the browser; embeddings computed locally (Transformers.js MiniLM, WebGPU with WASM fallback) | Mind World's stateless relay — receives only the draft and short excerpts, stores nothing |
| **On-device + your key** | Same as above | Your own Anthropic key, called directly from the browser (`sk-ant-…` in settings) |
| **Cloud** | Supabase (Postgres + pgvector) | Mind World's backend |

On-device memory is kept per account: each signed-in account gets its own IndexedDB database (`mind-world-memory-<hash of email>`), so several people can share a Chrome profile without seeing each other's chats. Users can switch modes in the popup at any time; the copy runs in the background and the mode only flips after it succeeds. Moving to on-device can optionally delete the cloud copy. The 2D map is available in cloud mode only. Existing cloud users are offered a one-click move to on-device.

```
Chrome extension (MV3)
  input-dock.js   template chips + Improve popover, memory mode badge
  content.js      DOM observation, auto-save, input injection
  background.js   provider router (local / cloud), save queue, migrations, shortcut
  memory/         local-db (IndexedDB) · chunker · retrieval · scoring · engineer ·
                  parser · local-provider · cloud-provider · engine-client
  offscreen.js    embedding model + in-memory vector index (on-device mode)
  import.html     on-device bulk import and backup restore
  popup.js        login, mode choice, stats, import, export/delete, profile, BYOK
        │  HTTPS
        ▼
FastAPI backend (DigitalOcean)
  stateless relay: /engineer_prompt_stateless  /rewrite_queries_stateless  /profile/infer_stateless
  cloud mode:      /templates  /search  /engineer_prompt  /save_conversation  /process  /load_map
  services/: engineer_core · parser · embedder (UMAP/HDBSCAN) · personalization · auth
        │
        ▼
Supabase (PostgreSQL + pgvector) — cloud mode only, plus accounts and templates
  users · conversations · embeddings · prompt_templates · personal_profiles

Web app — mind-world.app (React + Vite, Vercel)
  bulk upload / load map · 2D Plotly map (cloud mode)
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
- On-device mode: chunks and vectors are stored in IndexedDB and searched in the offscreen document (vector + keyword hybrid).
- Cloud mode: embeddings stored in Supabase (pgvector); UMAP + HDBSCAN clustering powers the 2D memory map on the web app.

### On-device performance

Measured with the extension's Transformers.js bundle on a 12-core laptop (`tests/js/perf.html`):

| | WebGPU | WASM, 4 threads | WASM, 1 thread |
|---|---|---|---|
| Indexing | ~35 chunks/s (~3 min per 1,000 conversations) | ~21 chunks/s (~5 min) | ~3 chunks/s (~33 min) |
| Query embedding (p50) | 23 ms | 5 ms | 9 ms |
| Search over 50k chunks | — | ~40 ms | ~39 ms |

Imports index newest-first and are resumable, so recent memory is usable within seconds. Threaded WASM relies on the manifest's COOP/COEP keys (cross-origin isolation).

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
| Embeddings | `all-MiniLM-L6-v2` (384-dim) — sentence-transformers on the server, Transformers.js on-device |
| Vector search | IndexedDB + in-memory index (on-device); Supabase PostgreSQL + pgvector (cloud) |
| Prompt engineering | Claude Haiku (Anthropic API) — via relay, user's own key, or backend |
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
| `POST /engineer_prompt` | Improve (cloud mode) — structures prompt with memory + personalization |
| `POST /engineer_prompt_stateless` | Improve relay for on-device mode — client sends draft + excerpts; nothing stored or logged |
| `POST /rewrite_queries_stateless` | Query expansion relay for on-device retrieval |
| `POST /profile/infer_stateless` | Profile inference relay for on-device mode |
| `GET /engineer_prompts` | Prompt definitions used by BYOK mode, so on-device prompts match the server |
| `POST /clear_cloud_memory` | Delete cloud conversations/embeddings after moving to on-device |
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

### Extension tests

```bash
cd tests/js
npm install
npm test                  # unit tests + service-worker local-flow tests (fake IndexedDB)
npm run check:utf8        # every extension text file is clean UTF-8
npm run parity:embed      # Transformers.js vs sentence-transformers embeddings
npm run parity:retrieval  # local retrieval vs cloud on backend/evals/retrieval
npm run parity:improve    # relay / BYOK / cloud Improve requests are identical
```

For browser perf, serve the repo root and open `/tests/js/perf.html` (add `?device=webgpu`; serve with COOP/COEP headers to measure threaded WASM). The manual release checklist is in [docs/smoke-test-local-first.md](docs/smoke-test-local-first.md).

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
