# Mind World — Handoff Document
Last updated: 2026-04-30 (click-to-detail panel added)

This document captures nuanced decisions, constraints, and architecture details
that would be lost on context compaction. Update it whenever meaningful changes are made.

---

## Current state of public_app.py

### Data flow (end-to-end)
1. User uploads Claude `.json` and/or ChatGPT `.zip` via two side-by-side file uploaders
2. User clicks **"🌍 Generate My Map"** button — processing does NOT start on upload
3. `parse_conversations(data)` → DataFrame for Claude
4. `parse_chatgpt_zip(zip_bytes)` → DataFrame for ChatGPT
5. Both DataFrames get a `source` column (`'claude'` or `'chatgpt'`), then merged with `pd.concat`
6. `embed_and_position(df)` → encodes with `all-MiniLM-L6-v2`, runs UMAP, runs HDBSCAN, returns list of chat dicts with `cluster_id`
7. `label_clusters(chats, api_key)` → calls `claude-haiku-4-5-20251001` once per cluster to generate a 2-4 word label; assigns colors from a 20-color palette; falls back to "Topic N" if API fails or no key
8. Each chat gets `region`, `color`, `size` set in place
9. `st.session_state.chats` is set → `st.rerun()` → `show_map()` renders

### Chat dict schema (every item in st.session_state.chats)
```python
{
    'id': str,           # uuid from Claude, conversation id from ChatGPT
    'title': str,
    'created_at': str,   # ISO format
    'updated_at': str,
    'num_messages': int,
    'char_count': int,
    'x': float,          # 50–950, UMAP normalized
    'y': float,          # 50–950, UMAP normalized
    'preview': str,      # first 300 chars of full_text
    'full_text': str,    # up to 8000 chars
    'source': str,       # 'claude' or 'chatgpt'
    'cluster_id': int,   # -1 = HDBSCAN noise
    'region': str,       # cluster label from Claude API e.g. "Career Planning"
    'color': str,        # hex from 20-color PALETTE, '#666666' for noise
    'size': int          # 8–25, based on num_messages
}
```

### Key functions
| Function | Location | Purpose |
|---|---|---|
| `parse_conversations(json_data)` | ~line 77 | Claude export → DataFrame |
| `parse_chatgpt_zip(zip_bytes)` | ~line 110 | ChatGPT ZIP → (DataFrame, 'chatgpt') |
| `embed_and_position(df)` | ~line 165 | Embed + UMAP + HDBSCAN → list of dicts |
| `label_clusters(chats, api_key)` | ~line 220 | Claude API → region/color on each chat |
| `_build_map_figure(chats, region_filter, source_filter, selected_ids, focused_id)` | ~line 285 | Cached Plotly figure builder; `focused_id` enlarges the clicked dot by +4px |
| `_blend_panel(chats)` | ~line 550 | @_fragment — Context Blender UI |
| `show_landing()` | ~line 358 | Upload page |
| `show_map()` | ~line 730 | Main map page |

### Caching strategy
- `_build_map_figure` has `@st.cache_data` — takes `tuple(chats)` to make it hashable
- `_fragment = getattr(st, 'fragment', lambda f: f)` — no-op on HF's Streamlit 1.31.0, real fragment on 1.33+
- `embed_and_position` and `label_clusters` are NOT cached — they only run once per upload session

### Visual encoding
- **Color** = topic region (cluster label). All conversations use the same palette regardless of platform.
- **Shape** = platform: Claude → circle, ChatGPT → diamond, selected → star (overrides shape)
- **Size** = conversation length (`max(8, min(25, num_messages // 4 + 6))`)
- **Cluster labels** = `fig.add_annotation()` floats uppercase label at centroid of each region (skipped if < 2 dots)

### Filters in show_map()
- **Region filter**: dynamic `["All Topics"] + sorted(set(c['region'] for c in chats))` — no hardcoded names
- **Platform filter**: `["All Platforms", "Claude only", "ChatGPT only"]` — static
- Both filters passed to `_build_map_figure` as cache key params

### localStorage blend count persistence
Blend count (free tier limit = 2) persists across sessions via localStorage + URL params:
1. On page load: JS reads `localStorage.mindworld_blend_count`, sets `?_bc=N` in URL
2. Python reads `st.query_params.get('_bc', '0')` → seeds `session_state.blend_count`
3. On successful blend: JS writes new count to localStorage AND updates URL param
This pattern is necessary because Streamlit has no native cross-session persistence.

### Context Blender output
After blending, shows side-by-side buttons:
- 🟣 Claude → `https://claude.ai/new?q={encoded}`
- 🟢 ChatGPT → `https://chatgpt.com/?q={encoded}`
Both links pre-populate the same blended context via URL-encoded query param.

---

## Known constraints and gotchas

### HF Streamlit 1.31.0 constraints
- `st.html()` — does NOT exist
- `st.markdown(unsafe_allow_html=True)` — silently strips HTML, renders as plain text
- `st.fragment` — does NOT exist (use `getattr` fallback)
- `components.html()` — works since Streamlit 0.63, is the ONLY reliable HTML renderer
- HF appends `streamlit==1.31.0` to pip install; do NOT pin streamlit in requirements.txt
- `st.plotly_chart(on_select=..., selection_mode=...)` — requires Streamlit ≥ 1.33; the click-to-detail feature will NOT work on HF (dots are still hoverable). Works locally with venv_public.

### torch version
torch 2.5.1+cpu is the max safe version on this machine. DLL error on anything newer.

### HDBSCAN behavior
- `cluster_id == -1` means HDBSCAN classified the point as noise (no cluster). These get `region='Other'` and `color='#666666'`.
- `min_cluster_size = max(3, len(df) // 30)` — scales with dataset size
- With very small datasets (< 10 conversations), most points may be noise

### label_clusters fallback chain
1. Try Claude API with provided key
2. If API fails (any exception) → fall back to "Topic N" labels with same palette colors
3. If zero clusters found (all noise) → assign everything to 'General' with first palette color

### ChatGPT ZIP format
- ZIP contains files named `conversations-000.json`, `conversations-001.json`, etc.
- Each file is a list of conversation objects
- Messages are in a `mapping` dict (node graph), NOT a flat list
- Only extract `role == 'user'` or `'assistant'` (skip `'tool'`)
- `parts` is a list — join only string parts, skip non-strings
- Timestamps are Unix floats, not ISO strings

### Two-file uploader design decision
The app shows two separate uploaders (Claude `.json`, ChatGPT `.zip`) rather than one combined uploader. This is intentional: it makes each platform's expected format explicit and prevents confusion. Processing only starts when the user clicks "Generate My Map" — NOT on file upload — because Streamlit re-runs on every file upload and would process prematurely before the user adds the second file.

---

## Deployment

### Push to production
```
git add <files>
git commit -m "message"   # no Co-Authored-By line
git push
```
GitHub Actions (`.github/workflows/sync_to_hf.yml`) force-pushes to `huggingface.co/spaces/shah66/mind-world`.

### requirements.txt
Must NOT include `streamlit` (HF pins its own). Current key deps:
```
sentence-transformers
umap-learn
hdbscan
pandas / numpy / scikit-learn
python-dotenv
plotly
anthropic
torch==2.5.1+cpu  (via --extra-index-url https://download.pytorch.org/whl/cpu)
```

### Secrets
`ANTHROPIC_API_KEY` must be set in HF Space secrets for cluster labeling to work on HF. Users can also provide their own key via the blend panel UI.

---

## Session state keys
| Key | Type | Purpose |
|---|---|---|
| `chats` | list or None | All processed chats; None = show landing page |
| `blend_count` | int | Number of free blends used this session |
| `user_api_key` | str or None | User-provided Anthropic key |
| `selected_ids` | list[str] | Chat IDs selected for blending |
| `chat_source` | str | `'claude'`, `'chatgpt'`, or `'both'` |
| `selected_chat_id` | str or None | ID of dot clicked on map; drives detail panel below map |

---

## What has NOT been changed
- `app.py` — personal version, untouched throughout all public_app.py work
- `parse_chats.py`, `embed_and_position.py` — personal pipeline scripts, untouched
- `demo_chats.json` — demo data for app.py, untouched
- The HDBSCAN-based clustering does NOT apply to `app.py` — it still uses its own pipeline
