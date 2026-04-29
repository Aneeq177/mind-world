# Mind World — Project Notes for Claude

## What this project is
A Streamlit app that embeds a user's Claude conversation history using sentence transformers + UMAP, then displays them as an interactive spatial map grouped by topic.

## Two apps, two virtual environments
- `app.py` — personal version, loads pre-processed data from disk. Run with `venv`.
- `public_app.py` — public version, accepts a `conversations.json` upload and processes it live. Run with `venv_public`.

## Critical: torch version
**Do not install the latest torch.** `torch 2.11.0+cpu` (and likely any version above 2.5.x) fails on this machine with a DLL initialization error (`c10.dll`). Always install:
```
pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
```
This applies to **both** `venv` and `venv_public`.

## Pipeline (personal app)
Run once in order, then only `app.py` is needed unless the export changes:
1. `python parse_chats.py` — parses `conversations.json` into `chats_parsed.csv`
2. `python embed_and_position.py` — generates embeddings + UMAP coords into `chats_positioned.json`
3. `streamlit run app.py`

## Streamlit version
Both envs run Streamlit 1.56+. **Do not use `st.markdown(..., unsafe_allow_html=True)` for HTML content** — it no longer renders HTML. Use `st.html()` instead.

## Demo mode
`app.py` has a "Demo Mode" toggle that loads `demo_chats.json` (54 generic professional conversations across 6 domains) instead of real personal data. In demo mode, region classification is skipped and pre-set regions from the JSON are used directly.
