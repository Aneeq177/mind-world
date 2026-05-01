# Mind World — Project Notes for Claude

## What this project is
A Streamlit app that embeds a user's AI conversation history (Claude and/or ChatGPT) using sentence transformers + UMAP, clusters them with HDBSCAN, labels clusters via the Claude API, and displays them as an interactive spatial star map.

## Two apps, two virtual environments
- `app.py` — personal version, loads pre-processed data from disk. Run with `venv`.
- `public_app.py` — public version, live-processes uploaded files. Run with `venv_public`.

The active development target is **`public_app.py`**. This is what gets deployed to Hugging Face.

## Critical: torch version
**Do not install the latest torch.** `torch 2.11.0+cpu` (and likely any version above 2.5.x) fails on this machine with a DLL initialization error (`c10.dll`). Always install:
```
pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
```
This applies to **both** `venv` and `venv_public`.

## Deployment: GitHub → Hugging Face auto-sync
The outer repo (`c:\Users\aneeq\mind-world\`) syncs to HF Space `shah66/mind-world` via GitHub Actions on every push to `main`. Workflow: `.github/workflows/sync_to_hf.yml`. **Never push from the inner `mind-world/mind-world/` directory** — that old direct-push path is retired.

Push workflow:
```
git add <files>
git commit -m "message"
git push
```
GitHub Actions then force-pushes to HF automatically.

## Streamlit version on Hugging Face
HF hardcodes `streamlit==1.31.0`. This has two critical consequences:
1. **`st.html()` does not exist** in 1.31.0 — never use it.
2. **`st.markdown(unsafe_allow_html=True)` silently fails to render HTML** in HF's environment.
3. **Solution**: Use `streamlit.components.v1.html(content, height=N)` for ALL HTML blocks. Always wrap with `<style>body{margin:0;background:#0a0a0f;font-family:sans-serif}</style>` for dark theme. Use `st.success()`, `st.error()`, `st.caption()` for simple text instead of HTML.
4. `@st.fragment` does not exist in 1.31.0 — use `_fragment = getattr(st, 'fragment', lambda f: f)` as a no-op fallback.

## IDE linter false positives
The linter checks `.venv` but the app runs in `venv_public`. Warnings about missing `hdbscan`, `anthropic`, `streamlit`, `plotly`, `sentence_transformers`, `umap` are all false positives. Do not act on them.

## HTML rendering rule
- ALL multi-line HTML → `components.html(..., height=N)` with explicit pixel height
- Small status messages → `st.success()` / `st.error()` / `st.caption()`
- f-strings with CSS: escape curly braces as `{{}}` inside f-string HTML
- No `st.html()`, no `st.markdown(unsafe_allow_html=True)` for content

## Pipeline (personal app)
Run once in order, then only `app.py` is needed unless the export changes:
1. `python parse_chats.py` — parses `conversations.json` into `chats_parsed.csv`
2. `python embed_and_position.py` — generates embeddings + UMAP coords into `chats_positioned.json`
3. `streamlit run app.py`

## Demo mode (app.py only)
`app.py` has a "Demo Mode" toggle that loads `demo_chats.json` (54 generic professional conversations across 6 domains) instead of real personal data. In demo mode, region classification is skipped and pre-set regions from the JSON are used directly.
