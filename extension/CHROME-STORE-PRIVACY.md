# Chrome Web Store — Privacy Practices Questionnaire

Brief reference for Mind World extension listing alignment (June 2026).

## Single purpose
Memory-aware prompt engineering: Improve drafts using the user's own past AI conversations.

## Data collected (user-provided and automatically)
- Email (account identifier)
- AI conversation text (upload or auto-save when enabled)
- Chat input draft text (processed for Improve/search; not permanently stored per keystroke)
- Optional Anthropic API key (browser local storage only)
- Optional personal profile fields (opt-in)
- Improve feedback metrics (edit distance, hashes; goal text up to 500 chars in feedback)

## Data NOT collected
- Passwords or credentials from other sites
- Browsing history outside supported AI chat domains
- Advertising identifiers or cross-site tracking

## Permissions justification
- `storage` — credentials, privacy toggles, message capture queue
- `tabs` — open Google sign-in tab; notify AI chat tabs after login/logout; keyboard shortcut Improve on active tab
- `activeTab` — Improve keyboard shortcut on the current AI chat tab without broad tab access
- Host permissions (claude.ai, chatgpt.com, gemini.google.com, perplexity.ai) — inject Improve UI, auto-save, read chat input only on those sites
- Host permissions (mind-world.app, DigitalOcean API) — auth callback, API calls, map link

## User controls
- Auto-save toggle (extension popup)
- Use chat history toggle (extension popup)
- Personal profile opt-in
- Export JSON / delete all data
- Clear inferred profile

## Third parties
- Supabase (database + embeddings)
- Anthropic (LLM for Improve when user triggers it)
- DigitalOcean (API backend)

## Privacy policy URL
https://mind-world.app/privacy

## Data deletion
In-app "Delete all data" + email support@mind-world.app

## Consent
Checkbox at extension signup and web upload with disclosure mirroring the Privacy Policy (embeddings, Improve feedback / `prompt_feedback`, optional profile inference, team sharing). Consent timestamp stored server-side (`consent_at`, `consent_version` — current: `2026-06-2`).
