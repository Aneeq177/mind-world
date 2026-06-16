# Mind World — Project Context for Antigravity

## What This Project Is
Mind World is a **memory-aware prompt engineering** Chrome extension.
It helps you write better AI prompts while you type — using template
chips and one-click **Improve**, backed by silently captured
cross-platform conversation memory.

**Product vision (canonical):** [VISION.md](VISION.md)

**Focus now:**
1. **Improve + templates** on the chat input (primary product)
2. **Reliable memory capture + semantic search** (engine for Improve)
3. **mind-world.app** — bulk import and 2D map (secondary onboarding)

**Not in scope until after v1 / PMF:** company brain, 3D orchestration,
Notion/Slack ingestion, MCP.

**Stack:**
1. Chrome extension — claude.ai, chatgpt.com, gemini.google.com, perplexity.ai
2. React web app at mind-world.app (import + map)
3. FastAPI backend on DigitalOcean
4. Supabase + pgvector semantic search

## Live URLs
- Frontend: https://mind-world.app (Vercel, React + Vite)
- Backend: https://mind-world-app-mv4yv.ondigitalocean.app
- API Docs: https://mind-world-app-mv4yv.ondigitalocean.app/docs
- Database: Supabase (qlwdoejtszndqifpbadd.supabase.co)

## Repository Structure
- /frontend — React + Vite app (Vercel)
- /backend — FastAPI app (DigitalOcean)
- /extension — Chrome extension (loaded unpacked + submitted to Web Store)

## Tech Stack
- Frontend: React, Vite, Plotly.js, Zustand, Tailwind
- Backend: FastAPI, Python, sentence-transformers, UMAP, HDBSCAN
- Database: Supabase (PostgreSQL + pgvector)
- Embeddings: all-MiniLM-L6-v2 (384 dimensions)
- AI: Claude Haiku for prompt engineering and cluster labeling
- Chrome Extension: Vanilla JS, Manifest V3

## Backend API Endpoints
- POST /process — parse and embed conversation exports
- POST /search — semantic search via pgvector
- POST /engineer_prompt — smart prompt engineering via Claude Haiku
- POST /save_conversation — auto-save from extension
- POST /load_map — load existing user data
- POST /user_stats — conversation count and company info
- POST /recluster — reposition auto-saved conversations
- POST /create_workspace — create invite-based team workspace
- POST /join_workspace — join workspace via invite code
- POST /workspace_info — get workspace details
- POST /leave_workspace — leave current workspace
- POST /share_conversations — mark conversations as team visible
- POST /company_search — search team conversations via pgvector
- POST /set_visibility — change conversation visibility

## Database Schema
users (id UUID, email TEXT, company_id UUID, role TEXT)
companies (id UUID, name TEXT, domain TEXT, invite_code TEXT, created_by UUID)
conversations (id TEXT, user_id UUID, title, source, created_at, 
  updated_at, num_messages, char_count, preview, full_text, 
  cluster_id, region, color, x FLOAT, y FLOAT, z FLOAT, 
  visibility TEXT DEFAULT 'private')
embeddings (conversation_id TEXT, user_id UUID, embedding VECTOR(384))

## Chrome Extension — Current State
- Works on claude.ai, chatgpt.com, gemini.google.com
- Login: email only (API key separate in Advanced Settings)
- Auto-search as user types (1.5s debounce)
- Manual search box in sidebar
- Engineer Prompt: reads draft, finds relevant past conversations,
  builds smart contextual prompt via Claude Haiku
- Auto-save: captures messages as they appear using MutationObserver
  on H2 elements ("You said:" / "Claude responded:")
  Stores accumulated messages in chrome.storage queue
  background.js processes queue via chrome.storage.onChanged
- Company brain: workspace creation/joining, visibility toggle,
  My Memory / Company tabs in sidebar
- Submitted to Chrome Web Store (pending review)

## Strict Extension Development Rules
- **UTF-8 ENCODING REQUIRED:** Chrome strictly requires all extension scripts (especially `content.js` and `background.js`) to be explicitly saved with `UTF-8` encoding. If you use PowerShell to echo or pipe content (`>`), it often defaults to UTF-16LE, which will completely break the extension and throw a `Could not load file for content script. It isn't UTF-8 encoded.` error. ALWAYS verify your file encoding before pushing!

## Current Issues To Fix
1. Company search (/company_search) returning no results even 
   though conversations are marked visibility='team' and both 
   users are in the same workspace (company_id matches)
   - Need to debug the match_company_conversations Supabase function
   - Suspect issue: conversations stored without user_id or with 
     mismatched user_id

2. Auto-saved conversations: when new conversations are auto-saved 
   via the extension, they need /recluster called to get proper 
   x,y coordinates. Should happen automatically.

3. Chrome Web Store: pending review, may need resubmission

## Company Brain Architecture
- Invite-based workspaces (NOT domain-based)
- User creates workspace → gets invite code (e.g. MW-F9T4-AQJ5)
- Teammates enter invite code to join
- Default visibility: private
- Team visibility: searchable by workspace members
- match_company_conversations() Supabase function does pgvector 
  search across team conversations

## Key Technical Decisions
- DigitalOcean over Render: Render 512MB RAM insufficient for 
  sentence-transformers (~1.5GB needed)
- Storage queue for auto-save: avoids MV3 service worker sleep
- Message accumulation: Claude uses virtual DOM, capture each 
  H2 as it appears
- Query expansion: short words don't embed well, expand before search
- Invite-based workspaces: safer than domain detection for 
  universities and large orgs

## Environment Variables
DigitalOcean: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
Chrome storage (user-set): mw_email, mw_api_key, 
  mw_default_visibility, mw_has_workspace

## Immediate Priority (v1)
Ship and polish the **Improve loop** end-to-end. See [VISION.md](VISION.md).

1. **Chrome Web Store** — listing live or clear beta install path
2. **Auto-save reliability** — new conversations must persist and feed Improve
3. **Input dock + Improve** — only default UI; legacy sidebar demoted
4. **Production smoke test** — one fresh account completes install → Improve → better prompt

Company brain, `/company_search`, and workspace UI are **frozen** until after v1.0.0 and real user validation.

## Agent Workflow — Auto-push to GitHub
After implementing requested code changes, always commit and push to GitHub.
- Rule: `.cursor/rules/auto-push-to-github.mdc` (always applies)
- Hook: `.cursor/hooks.json` runs on agent `stop` and reminds the agent if changes are still local
- Skip only when the user explicitly says not to commit/push, or when there are no changes