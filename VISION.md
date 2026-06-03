# Mind World — Product Vision

## What It Is

Mind World is a Chrome extension that lives **on the AI chat input** (Claude, ChatGPT, Gemini). It helps you write better prompts **while you compose**, so the AI gives you better answers — without learning prompt engineering.

## The Core Problem

Most people get mediocre results from LLMs because their **prompts** are vague, unstructured, or missing context. Mind World fixes that at the moment you type — not in a separate app or wizard.

## How It Works (User Experience)

### 1. Template chips (fast path)

A row of small buttons sits **above the chat box**: Debug code, Review essay, Write email, and more.

- Tap a chip → a professional prompt scaffold drops into your input.
- You fill in the blanks and send.
- Works on day one — no conversation history required.

### 2. Improve (one click)

An **Improve** button sits next to the chat input.

- Reads what you already typed.
- Silently pulls relevant past conversations and your optional personal profile.
- Returns a clearer, structured prompt in a small preview popover.
- You **Replace** (or edit) in the input, then send.

Clarifying questions appear **only** when your draft is very short or vague — inline in the popover, not a multi-step interview.

### 3. Silent context (engine, not a feature)

**Context blending** is not a separate workflow users manage.

- Past conversations are captured automatically in the background.
- When you Improve, Mind World semantically finds what matters and weaves it into the engineered prompt.
- Optional: a one-time **personal profile** in the extension popup (background, goals, constraints).

Users do not search, stage, or manually pick conversations for normal use.

## What We Are NOT Building (Now)

- Floating corner widget as the primary UI
- Ctrl+Shift+P (conflicts with browser Print)
- Sidebar memory search as the hero flow
- Manual “select 2–4 conversations and inject context block”
- 3D conversation map as the product
- Company brain / team workspaces in the extension
- Grammarly-style tab-to-accept ghost text (future phase)

## Secondary / Later

- **mind-world.app** — bulk import of conversation history (upload once, fuels silent memory)
- **Advanced context** — optional “add more from history” in the Improve popover
- **Grammarly-style suggestions** — inline ghost text as you type (v2)
- **3D map / manual blend** — power-user tools on the web app, not the extension focus

## Architecture (Simple)

```
User types in host chat input
        ↓
[Template chips]  or  [Improve button]
        ↓
Backend: templates DB + /engineer_prompt
        ├── semantic search (silent memory)
        ├── personal profile (if enabled)
        └── Claude Haiku (structure + clarity)
        ↓
Preview popover → Replace in input → User sends
```

## The One Metric

Do people get noticeably better LLM responses after using Mind World than before?

If yes, the product works. Everything else follows.

## Keyboard Shortcut

**Alt+Shift+M** — Improve current draft (Mind World). Not Ctrl+Shift+P.
