# Mind World

A visual map of your Claude conversation history. Conversations are embedded using sentence transformers, reduced to 2D with UMAP, and displayed as an interactive star map grouped by topic region.

## Features

- **Conversation map** — all chats plotted spatially by semantic similarity, colored by topic region
- **Time Machine** — slider to replay how your conversation world grew over time
- **Context Blender** — select 2–4 conversations, extract their key intelligence via Claude, and open a blended context in a new Claude chat

## Setup

**Prerequisites:** Python 3.12+, a Claude conversation export (`conversations.json`)

```bash
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux

pip install -r requirements.txt
pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
```

Create a `.env` file with your Anthropic API key (needed for the Context Blender):

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

Run the pipeline once to process your export, then launch the app:

```bash
python parse_chats.py        # Parse conversations.json → chats_parsed.csv
python embed_and_position.py # Embed + UMAP → chats_positioned.json
streamlit run app.py         # Launch the app
```

After the first run, you only need `streamlit run app.py` unless your export changes.

## How to export your Claude conversations

1. Go to [claude.ai](https://claude.ai) → Settings → Account
2. Click **Export Data** and download the zip
3. Extract `conversations.json` into this directory

## File overview

| File | Purpose |
|------|---------|
| `parse_chats.py` | Parses raw Claude export into a clean CSV |
| `embed_and_position.py` | Generates embeddings and 2D UMAP coordinates |
| `app.py` | Streamlit app — the map, time machine, and blender |
| `inspect_data.py` | Debug helper to inspect the raw export structure |
| `chats_parsed.csv` | Generated — parsed conversations |
| `chats_positioned.json` | Generated — conversations with x/y coordinates |
