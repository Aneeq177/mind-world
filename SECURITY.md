# Security Policy

## Supported versions

We actively support the latest version of the Mind World Chrome extension and the production backend deployed at `https://mind-world-app-mv4yv.ondigitalocean.app`. Older extension builds are not guaranteed to receive security fixes once a newer version is published on the Chrome Web Store.

## Reporting a vulnerability

If you discover a security issue in the Mind World extension, backend, website, or infrastructure, please report it privately.

- **Email:** [security@mind-world.app](mailto:security@mind-world.app)
- **Subject:** `Security issue: <short description>`
- **Include:** Steps to reproduce, impact, and any suggested mitigation.

We aim to acknowledge reports within 72 hours and will keep you informed as we investigate and fix the issue. Please do not disclose vulnerabilities publicly until we have had a chance to resolve them.

## Security practices

- All API traffic is served over HTTPS with HSTS enabled.
- Session tokens are hashed with SHA-256 and verified with constant-time comparison (`hmac.compare_digest`).
- Passwords are hashed with bcrypt.
- Anthropic API keys provided by users are stored only in the browser's extension local storage and are never persisted in our database (we store only a hash for verification when used as a login credential).
- The backend uses origin-restricted CORS: the web app (`https://mind-world.app`), local development origins, and any `chrome-extension://` origin (because the extension ID differs between unpacked and Web Store builds).
- Database access is controlled by per-user row ownership; the backend validates auth on every endpoint that reads or writes user data. Public endpoints such as `/templates`, `/templates/search`, and the `/auth/*` registration/login routes do not require a session.
- Security headers are set on all API responses: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control`, and `Strict-Transport-Security`.
- AI-intensive and state-changing endpoints are rate-limited per client IP and per path (e.g., `/engineer_prompt`, `/templates/suggest`, `/save_conversation`). Client IP is taken from the `do-connecting-ip` header on DigitalOcean App Platform, or `X-Forwarded-For` / transport client otherwise.
- The Chrome extension requests broad website access only at runtime and only when the user explicitly enables Universal Mode. Auto-save memory remains limited to the four supported platforms even in Universal Mode.
- The extension sends an `X-MW-Client` header on `/engineer_prompt` and `/compare_answers` as a lightweight client attestation; it is not a substitute for user authentication and is checked alongside the user's session token or API key. Other endpoints rely on session/API key authentication.
- Server-key AI usage (Improve, template suggestions, comparisons) is counted against the free-tier quota for non-pro users. Users who add their own Anthropic API key bypass the server quota and are billed by Anthropic directly.

## Disclosure policy

If a security incident is likely to affect user rights or data, we will notify affected users and applicable regulators as required by law, typically within 72 hours of becoming aware where GDPR applies.
