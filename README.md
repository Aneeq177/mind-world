# Mind World

A Chrome extension that helps you write better AI prompts while you type — using template chips and one-click **Improve**, backed by your conversation memory.

**Product:** Chrome extension (daily use)  
**Secondary:** [mind-world.app](https://mind-world.app) — bulk import and 2D memory map

## What it does

1. Install the extension and enter your email.
2. Optionally upload past Claude/ChatGPT exports (popup or web app).
3. On Claude, ChatGPT, or Gemini: use **template chips** or click **Improve** (Alt+Shift+M).
4. Mind World silently finds relevant past chats and returns a clearer, structured prompt.
5. New conversations auto-save in the background.

See [VISION.md](VISION.md) for v1 scope and [ARCHITECTURE.md](ARCHITECTURE.md) for how it is built.

## Live URLs

| Component | URL |
|-----------|-----|
| Web app | https://mind-world.app |
| Backend API | https://mind-world-app-mv4yv.ondigitalocean.app |
| API docs | https://mind-world-app-mv4yv.ondigitalocean.app/docs |

## Repository structure

```
mind-world/
├── extension/     # Chrome extension (primary product)
├── backend/       # FastAPI + embeddings pipeline
├── frontend/      # React map app (Vercel)
├── VISION.md      # Product scope and v1 finish line
├── ARCHITECTURE.md
└── public_app.py  # Legacy Streamlit demo (frozen)
```

## Extension development

Load unpacked in Chrome:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select the `extension/` folder
4. Reload after code changes

**Important:** Extension scripts must be UTF-8 encoded (not UTF-16 from PowerShell redirects).

## Backend (local)

```bash
cd backend
python -m venv venv
venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

Set `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` in `.env`, then:

```bash
uvicorn main:app --reload
```

## Frontend (local)

```bash
cd frontend
npm install
npm run dev
```

## Legacy Hugging Face demo

The original Streamlit 2D map lives in `public_app.py` and deploys to Hugging Face Spaces. The React app at mind-world.app is the canonical web experience for v1.
