# Cursor automation for Mind World

## Auto-push to GitHub

This project is configured so Cursor agents commit and push after making requested code changes.

### Files

| File | Purpose |
|------|---------|
| `rules/auto-push-to-github.mdc` | Always-on agent instruction to commit and push when implementing changes |
| `hooks.json` | Runs a check when an agent finishes |
| `hooks/check-unpushed-changes.ps1` | Detects uncommitted or unpushed work and sends a follow-up reminder |

### How it works

1. **Rule** — Every agent session loads the auto-push rule and follows it at the end of implementation tasks.
2. **Hook** — When an agent stops, the hook checks `git status` and unpushed commits. If anything is still local, Cursor sends the agent a follow-up message to commit and push.

### Exceptions

Agents should **not** push when:

- You only asked a question (no code changes)
- You said "don't commit" or "don't push"
- Changes contain secrets (`.env`, credentials)

### Enabling hooks

Hooks must be enabled in Cursor: **Settings → Hooks**. If the hook does not run, restart Cursor after pulling this folder.
