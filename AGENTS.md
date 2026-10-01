# Mind World — Agent Context

Mind World is a **memory-aware prompt engineering** Chrome extension: template chips and one-click **Improve** on the chat input of Claude, ChatGPT, Gemini, and Perplexity, backed by silently captured cross-platform conversation memory.

- **Product scope (canonical):** [VISION.md](VISION.md) — when scope is unclear, defer to it.
- **Architecture, stack, setup, endpoints:** [README.md](README.md)

## Focus (v1)

1. **Improve + templates** on the chat input — the product
2. **Reliable auto-save + semantic search** — the engine for Improve
3. **mind-world.app** — bulk import and 2D map (secondary)

**Not until after v1 / PMF:** company brain / team workspaces, 3D map, Notion/Slack/Google ingestion, MCP. That code has been removed; don't reintroduce it without a product decision. Legacy DB objects (`companies` table, `users.company_id`, `knowledge_nodes.visibility`/`z`, `match_company_conversations()`) still exist in Supabase but nothing reads them.

## Immediate priorities

1. **Chrome Web Store** — listing live or clear beta install path
2. **Auto-save reliability** — new conversations must persist and feed Improve
3. **Production smoke test** — one fresh account completes install → Improve → better prompt

## Extension rules

- **UTF-8 encoding required.** Chrome rejects content scripts that aren't UTF-8 (`Could not load file for content script. It isn't UTF-8 encoded.`). PowerShell `>` / `Out-File` default to UTF-16LE — never write extension files that way, and verify encoding before shipping.
- Host DOMs change often; auto-save uses a MutationObserver + `chrome.storage` queue so the MV3 service worker can sleep safely.

## Key technical decisions

- **DigitalOcean over Render:** sentence-transformers needs ~1.5 GB RAM; Render's free tier has 512 MB.
- **Supabase + pgvector:** metadata and vectors in one database; no separate vector store.
- **Vanilla JS extension:** no build step on MV3.
- **Query expansion:** short queries embed poorly, so they're expanded before search.
- **HDBSCAN over K-Means:** no fixed cluster count; handles noise points.

## Git workflow

Auto-push is **off**. Do not commit or push unless the user explicitly asks in that message.

To re-enable: set `alwaysApply: true` in `.cursor/rules/auto-push-to-github.mdc` (removing its DISABLED note) and restore the stop hook in `.cursor/hooks.json`:

```json
"stop": [{ "command": "powershell -NoProfile -ExecutionPolicy Bypass -File .cursor/hooks/check-unpushed-changes.ps1", "timeout": 30, "loop_limit": 1 }]
```
