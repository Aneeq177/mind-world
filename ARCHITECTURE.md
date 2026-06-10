# Mind World — Architecture (v1)

High-level map of how the product works. For product scope and finish line, see [VISION.md](VISION.md).

## System diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Chrome Extension (MV3)                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ input-dock.js│  │  content.js  │  │ popup.js / background  │ │
│  │ chips+Improve│  │  auto-save   │  │ login, import, queue   │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬────────────┘ │
└─────────┼─────────────────┼──────────────────────┼──────────────┘
          │                 │                      │
          └─────────────────┼──────────────────────┘
                            │ HTTPS (REST)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  FastAPI Backend (DigitalOcean)                                 │
│  /templates  /search  /engineer_prompt  /save_conversation      │
│  /process  /load_map  /recluster                                │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                 │
│  │  parser.py │  │ embedder.py│  │ blender.py │                 │
│  │ Claude/GPT │  │ UMAP/HDBSCAN│ │ Haiku prompts│               │
│  └────────────┘  └────────────┘  └────────────┘                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase (PostgreSQL + pgvector)                               │
│  users · conversations · embeddings · prompt_templates          │
│  personal_profiles · match_conversations()                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Web App — mind-world.app (React + Vite, Vercel)                │
│  Bulk upload / load map · 2D Plotly map · power-user blend      │
└─────────────────────────────────────────────────────────────────┘
```

## Primary user flow (extension)

1. User types in Claude, ChatGPT, Gemini, or Perplexity chat input.
2. **Template chip** inserts a scaffold, or **Improve** (Alt+Shift+M) sends the draft to the backend.
3. Backend runs semantic search over stored conversations (`/search` + pgvector).
4. Claude Haiku structures the prompt and weaves relevant memory (`/engineer_prompt`).
5. User reviews the popover and **Replace**s text in the host input.
6. **Auto-save** watches the DOM, queues conversations in `chrome.storage`, background worker POSTs to `/save_conversation`; backend reclusters positions in the background.

## Repository layout

| Path | Role |
|------|------|
| `extension/` | Chrome extension — product surface |
| `backend/` | FastAPI API + ML pipeline |
| `frontend/` | React web app — import and visualization |
| `public_app.py` | Legacy Streamlit demo (frozen, not v1) |

## Key technologies

| Layer | Stack | Why |
|-------|-------|-----|
| Extension | Vanilla JS, MV3 | No build step; runs on host pages |
| Embeddings | sentence-transformers (`all-MiniLM-L6-v2`, 384-dim) | Fast CPU inference |
| Vector search | Supabase pgvector, cosine similarity | One DB for metadata + vectors |
| Clustering / map | UMAP + HDBSCAN | Auto topic regions for 2D map |
| Prompt engineering | Claude Haiku | Cheap, fast Improve responses |
| Web map | React, Plotly, Zustand | Interactive 2D semantic map |

## API endpoints (v1)

| Endpoint | Used by |
|----------|---------|
| `GET /templates` | Extension chips + library |
| `POST /search` | Improve (silent memory) |
| `POST /engineer_prompt` | Improve + web Context Blender |
| `POST /save_conversation` | Extension auto-save |
| `POST /process` | Popup import, web upload |
| `POST /load_map` | Web “load existing” |
| `POST /recluster` | After saves (also triggered server-side) |
| `POST /user_stats` | Popup stats and onboarding |

## Deployment

| Component | URL |
|-----------|-----|
| Extension | Chrome Web Store (or load unpacked from `extension/`) |
| Web app | https://mind-world.app |
| Backend | https://mind-world-app-mv4yv.ondigitalocean.app |
| Database | Supabase project `qlwdoejtszndqifpbadd` |

## Out of v1 (code may exist, UI hidden)

Company brain, team workspaces, Notion/Google integrations, unified multi-source map, 3D universe, legacy sidebar search/stage/inject.
