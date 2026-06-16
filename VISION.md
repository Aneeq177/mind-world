# Mind World — Product Vision & v1 Finish Line

This document is the **single source of truth** for what Mind World is, what v1 includes, where we stop building, and what comes later. When scope is unclear, defer to this file.

---

## North Star

**One sentence:** Mind World is the prompt engineer that remembers everything you've ever asked AI — and writes your next prompt for you.

**What we focus on (two things only):**

1. **Memory-aware prompt engineering** — templates + one-click Improve that rewrites your draft using relevant past conversations. This is the product and the competitive wedge. No competitor ships this.
2. **Cross-platform conversation memory** — capture and semantic search across Claude, ChatGPT, Gemini, and Perplexity. This is the fuel for Improve, not the headline. It must be reliable; it does not need to be flashy.

**The one metric:** Do people get noticeably better LLM responses after using Mind World than before?

If yes, the product works. Everything else follows.

**What we are not building now:** company brain, 3D orchestration, multi-source ingestion (Notion/Slack), MCP/IDE integration. See [v2 and Later](#v2-and-later-explicitly-after-v100) and `CLAUDE.md` long-term notes.

---

## What It Is

Mind World is a Chrome extension that lives **on the AI chat input** (Claude, ChatGPT, Gemini, Perplexity). It helps you write better prompts **while you compose**, so the AI gives you better answers — without learning prompt engineering.

### The core problem

Most people get mediocre results from LLMs because their **prompts** are vague, unstructured, or missing context. Mind World fixes that at the moment you type — not in a separate app or wizard.

---

## v1 User Loop (definition of the product)

A stranger must be able to complete this loop without explanation:

```
Install extension
    → Enter email in popup
    → (Optional) Upload history on mind-world.app
    → Chat on Claude / ChatGPT / Gemini
    → Use a template chip OR click Improve
    → Replace prompt in input and send
    → New chats auto-save in background
    → Improve silently finds relevant memory next time
```

**v1 is done when this loop works end-to-end on production.**

---

## How It Works (user experience)

### 1. Template chips (fast path)

A row of small buttons sits **above the chat box**: Debug code, Review essay, Write email, and more.

- Tap a chip → a professional prompt scaffold drops into your input.
- You fill in the blanks and send.
- Works on day one — no conversation history required.

### 2. Improve (primary product action)

An **Improve** button sits next to the chat input.

- Reads what you already typed.
- Silently pulls relevant past conversations and your optional personal profile.
- Returns a clearer, structured prompt in a small preview popover.
- You **Replace** (or edit) in the input, then send.

Clarifying questions appear **only** when your draft is very short or vague — inline in the popover, not a multi-step interview.

**Keyboard shortcut:** **Alt+Shift+M** — Improve current draft. Not Ctrl+Shift+P (conflicts with browser Print).

### 3. Silent context (engine, not a feature)

**Context blending** is not a separate workflow users manage.

- Past conversations are captured automatically in the background.
- When you Improve, Mind World semantically finds what matters and weaves it into the engineered prompt.
- Optional: a one-time **personal profile** in the extension popup (background, goals, constraints).

Users do not search, stage, or manually pick conversations for normal use.

---

## Three Layers (v1 scope)

| Layer | Role | Ship when… |
|-------|------|------------|
| **Extension** (primary product) | Template chips + Improve on the chat input | Works on Claude, ChatGPT, Gemini; Alt+Shift+M works; popup onboarding is clear |
| **Backend** (engine) | Embeddings, search, prompt engineering, auto-save, templates | Improve + auto-save + bulk import work for a test user end-to-end |
| **Web app** (secondary) | Bulk import + “see your memory” 2D map at mind-world.app | Upload/load map works; no fake UI; linked from popup |

---

## v1 — In Scope

### Extension

- Input dock: template chips, template library, **Improve** button
- Improve flow: draft → silent semantic search → `/engineer_prompt` → preview → Replace in input
- Optional personal profile in popup
- Auto-save of new conversations (MutationObserver + storage queue → `/save_conversation`)
- Popup: login, stats, upload/open map, onboarding when conversation count is 0
- Alt+Shift+M keyboard shortcut

### Backend

- `/save_conversation`, `/search`, `/engineer_prompt`, `/process`, `/load_map`, `/recluster`
- `/templates` (+ search/categories) for the chip library
- Supabase: users, conversations, embeddings, prompt_templates, personal_profiles

### Web app (mind-world.app)

- Landing: upload Claude/ChatGPT exports OR load existing map by email
- 2D semantic map (Plotly): browse, search, time slider, click for detail
- Manual Context Blender in sidebar — **power-user only**; not marketed as primary flow

---

## v1 — Out of Scope (do not build before v1 ships)

| Item | Status |
|------|--------|
| Sidebar search / stage / inject as hero flow | Remove or hide behind Advanced |
| Unified map tabs (AI + Notion + Slack) | Park until real ingestion exists |
| Mock document nodes on the map | Remove |
| 3D universe (`Universe.jsx`, `Controls.jsx`) | Delete dead code |
| Company brain / team workspaces in extension | Freeze — hide or mark “Coming soon” |
| Notion/Google integrations modal | Hide until one connector works end-to-end |
| Streamlit app (`public_app.py`) | Freeze — no new work; React app is canonical |
| Grammarly-style ghost text | v2 |
| 3D agent orchestration map | Post-PMF vision |
| Multi-source knowledge architecture (Slack, email, Linear) | v2+ per IMPLEMENTATION_PLAN.md |

**Rule:** If it is not in the v1 user loop above, it does not ship in v1 UI.

---

## Cleanup Before v1 (required)

These are not new features — they make the repo honest and learnable:

1. **Extension:** Input dock + Improve is the only default UI. Demote or remove legacy sidebar hero flow.
2. **Web:** Remove mock documents from `store.js`. Hide Static Knowledge / Unified View tabs.
3. **Repo:** Delete unused 3D components. Stop maintaining Streamlit as a second product surface.
4. **Company brain:** Hide workspace UI in extension until company search is fixed and tested.

---

## v1 Definition of Done (acceptance checklist)

Tag **`v1.0.0`** and **freeze features** when all of these pass:

### Extension

- [x] Fresh install → email saved → clear next step (import or start chatting)
- [x] Template chip inserts scaffold into Claude, ChatGPT, and Gemini inputs
- [x] Improve works with 0 prior conversations (structures vague draft only)
- [x] Improve works with 10+ saved conversations (pulls relevant memory silently)
- [x] Alt+Shift+M triggers Improve
- [x] Auto-save confirms subtly; conversation appears in Supabase
- [x] Sidebar does not auto-open on every keystroke (legacy sidebar disabled in v1)

### Web app

- [x] Upload export → map renders with real cluster labels (not all “Topic N”)
- [x] Load existing map works for the same email as the extension
- [x] Semantic search on map highlights matching dots
- [x] Manual blend in web sidebar works (optional power feature)

### Backend & ops

- [ ] Chrome Web Store listing live (or unlisted beta with install instructions) — verify manually
- [ ] One test account completes the full loop on production URLs — verify manually
- [x] No mock data injected in production frontend

### Documentation

- [x] `ARCHITECTURE.md` exists: extension → backend → Supabase diagram
- [x] README points to extension as product, web as import/visualization

**After v1.0.0:** Bug fixes and platform DOM updates only. No new features until real users have been watched using the product.

---

## Path to v1 (stop sequence)

Execute in order. Do not start v2 work until the checklist above is green.

### Phase 1 — Extension is the product

1. Make input dock + Improve the only default UI.
2. Demote or remove sidebar search/stage/inject hero flow.
3. Popup onboarding when `conversation_count === 0`.
4. Verify auto-save + recluster on production.

### Phase 2 — Web app honest and minimal

1. Remove mock documents from `store.js`.
2. Hide Unified / Static Knowledge tabs.
3. Popup → “Open map” and inline import work.
4. Delete dead 3D files (`Universe.jsx`, `Controls.jsx`).

### Phase 3 — Ship gate

1. Run the acceptance checklist with a fresh email.
2. Fix blockers only.
3. Write `ARCHITECTURE.md`.
4. Tag **`v1.0.0`** — feature freeze.

### Phase 4 — Learn mode (after freeze)

Study the codebase by concept (extension → ML → backend → web), not by file tree. Practice explaining:

- **30s:** “Chrome extension that improves your prompts using your past AI chats, automatically.”
- **2min:** “MV3 extension captures chats; sentence-transformers + pgvector for semantic search; Haiku engineers structured prompts on Improve; web app is bulk import and visualization.”

---

## Architecture (v1)

```
User types in host chat input
        ↓
[Template chips]  or  [Improve button]  (Alt+Shift+M)
        ↓
Extension background → FastAPI
        ├── /templates          (chip library)
        ├── /search             (silent semantic retrieval)
        ├── /engineer_prompt    (Haiku structures prompt + weaves context)
        ├── /save_conversation  (auto-save from DOM)
        └── /process, /load_map (bulk import + map load)
        ↓
Supabase (users, conversations, embeddings, prompt_templates, profiles)
        ↓
Preview popover → Replace in input → User sends
```

**Web app (secondary):** Upload or load map → UMAP/HDBSCAN visualization → optional manual blend for power users.

---

## v2 and Later (explicitly after v1.0.0)

Only revisit after v1 ships and users validate the one metric.

| Phase | What |
|-------|------|
| **v1.1** | “Add more from history” in Improve popover (advanced, opt-in) |
| **v1.2** | Grammarly-style inline suggestions as you type |
| **v2** | One real knowledge source (Notion OR Google Docs) on the map |
| **v2+** | Company brain, team search, unified multi-source map |
| **Long-term** | 3D orchestration / agent workflows on the map |

---

## What We Are NOT Building (ever as v1)

- Floating corner widget as the primary UI
- Ctrl+Shift+P (conflicts with browser Print)
- Sidebar memory search as the hero flow
- Manual “select 2–4 conversations and inject context block” in the extension
- 3D conversation map as the product
- Company brain / team workspaces in the extension (v1)
- Pitch-deck features (acquisition-scale company brain, agent orchestration) before PMF

---

## Elevator Pitches

**Anyone (30 seconds):**  
“Mind World is a Chrome extension that makes your AI chats smarter. It gives you prompt templates and a one-click Improve button that rewrites what you typed using your past conversations — automatically, without searching old chats.”

**Technical (2 minutes):**  
“Extension on MV3 captures conversations from Claude/ChatGPT/Gemini via content scripts. Text is embedded with sentence-transformers, stored in Supabase with pgvector. When you hit Improve, we run semantic search, then Claude Haiku engineers a structured prompt. Bulk history goes through FastAPI with UMAP/HDBSCAN for the 2D map on mind-world.app.”

**Why these choices:**  
FastAPI reuses the Python ML stack. Supabase holds metadata and vectors in one place. Vanilla JS extension avoids a build step on MV3. Haiku keeps Improve fast and cheap. The web map is onboarding and visualization — not the daily driver.
