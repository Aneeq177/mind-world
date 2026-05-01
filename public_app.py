import streamlit as st
import streamlit.components.v1 as components
import json
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import urllib.parse
import os
import tempfile
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

st.set_page_config(
    page_title="Mind World",
    page_icon="🌍",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# ── Hide Streamlit chrome ─────────────────────────────────────────────────
st.markdown("""
<style>
    #MainMenu {visibility: hidden;}
    header {visibility: hidden;}
    footer {visibility: hidden;}
    .block-container {
        padding-top: 1rem !important;
        padding-bottom: 0rem !important;
        padding-left: 1.5rem !important;
        padding-right: 1.5rem !important;
        max-width: 100% !important;
    }
    [data-testid="stAppViewContainer"] {
        background-color: #0a0a0f;
    }
</style>
""", unsafe_allow_html=True)

# ── Session state ─────────────────────────────────────────────────────────
if 'chats' not in st.session_state:
    st.session_state.chats = None
# Read persisted blend count from URL param (populated by localStorage JS)
_bc_param = st.query_params.get('_bc', '0')
try:
    _persisted_blend_count = int(_bc_param)
except:
    _persisted_blend_count = 0

if 'blend_count' not in st.session_state:
    st.session_state.blend_count = _persisted_blend_count
if 'user_api_key' not in st.session_state:
    st.session_state.user_api_key = None
if 'selected_ids' not in st.session_state:
    st.session_state.selected_ids = []
if 'chat_source' not in st.session_state:
    st.session_state.chat_source = 'both'
if 'selected_chat_id' not in st.session_state:
    st.session_state.selected_chat_id = None

components.html("""
<script>
(function() {
    var count = parseInt(localStorage.getItem('mindworld_blend_count') || '0');
    var url = new URL(window.parent.location.href);
    if (url.searchParams.get('_bc') !== String(count)) {
        url.searchParams.set('_bc', String(count));
        window.parent.history.replaceState({}, '', url);
        window.parent.location.reload();
    }
})();
</script>
""", height=0)

FREE_BLEND_LIMIT = 2

# ── Processing pipeline ───────────────────────────────────────────────────
def parse_conversations(json_data):
    convos = json_data if isinstance(json_data, list) else json_data.get('conversations', [])
    rows = []
    for c in convos:
        messages = c.get('chat_messages', [])
        text_parts = []
        for msg in messages:
            sender = msg.get('sender', 'unknown')
            content = msg.get('text', '')
            if not content and 'content' in msg:
                if isinstance(msg['content'], list):
                    for block in msg['content']:
                        if isinstance(block, dict) and block.get('type') == 'text':
                            content += block.get('text', '')
                elif isinstance(msg['content'], str):
                    content = msg['content']
            if content:
                text_parts.append(f"[{sender}] {content}")
        full_text = "\n\n".join(text_parts)
        if len(full_text.strip()) < 50:
            continue
        rows.append({
            'uuid': c.get('uuid', ''),
            'name': c.get('name', 'Untitled') or 'Untitled',
            'created_at': c.get('created_at', ''),
            'updated_at': c.get('updated_at', ''),
            'num_messages': len(messages),
            'char_count': len(full_text),
            'full_text': full_text[:8000]
        })
    return pd.DataFrame(rows)

def parse_chatgpt_zip(zip_bytes):
    import zipfile
    import io

    rows = []
    with zipfile.ZipFile(zip_bytes) as z:
        json_files = sorted([
            f for f in z.namelist()
            if f.startswith('conversations') and f.endswith('.json')
        ])
        for json_file in json_files:
            with z.open(json_file) as f:
                convos = json.load(f)
            for c in convos:
                mapping = c.get('mapping', {})
                text_parts = []
                for node_id, node in mapping.items():
                    msg = node.get('message')
                    if not msg:
                        continue
                    role = msg.get('author', {}).get('role', '')
                    if role not in ['user', 'assistant']:
                        continue
                    content = msg.get('content', {})
                    parts = content.get('parts', [])
                    text = ' '.join(
                        p for p in parts
                        if isinstance(p, str) and p.strip()
                    )
                    if text.strip():
                        text_parts.append(f'[{role}] {text}')
                full_text = '\n\n'.join(text_parts)
                if len(full_text.strip()) < 50:
                    continue
                create_time = c.get('create_time', 0)
                update_time = c.get('update_time', 0)
                try:
                    created_at = datetime.fromtimestamp(float(create_time)).isoformat()
                    updated_at = datetime.fromtimestamp(float(update_time)).isoformat()
                except Exception:
                    created_at = ''
                    updated_at = ''
                rows.append({
                    'uuid': c.get('id', ''),
                    'name': c.get('title', 'Untitled') or 'Untitled',
                    'created_at': created_at,
                    'updated_at': updated_at,
                    'num_messages': len(text_parts),
                    'char_count': len(full_text),
                    'full_text': full_text[:8000]
                })
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values('created_at').reset_index(drop=True)
    return df, 'chatgpt'

def embed_and_position(df):
    from sentence_transformers import SentenceTransformer
    import umap
    import hdbscan as hdbscan_lib

    def build_text(row):
        title = str(row['name']) if pd.notna(row['name']) else 'Untitled'
        text = str(row['full_text'])[:500] if pd.notna(row['full_text']) else ''
        return f"{title}. {text}"

    texts = [build_text(row) for _, row in df.iterrows()]
    model = SentenceTransformer('all-MiniLM-L6-v2')
    embeddings = model.encode(texts, show_progress_bar=False)

    n_neighbors = min(10, len(df) - 1)
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=n_neighbors,
        min_dist=0.3,
        metric='cosine',
        random_state=42
    )
    coords = reducer.fit_transform(embeddings)

    min_cluster = max(3, len(df) // 30)
    clusterer = hdbscan_lib.HDBSCAN(
        min_cluster_size=min_cluster,
        min_samples=2,
        metric='euclidean'
    )
    cluster_labels = clusterer.fit_predict(coords)

    x_min, x_max = coords[:, 0].min(), coords[:, 0].max()
    y_min, y_max = coords[:, 1].min(), coords[:, 1].max()
    coords_norm = np.zeros_like(coords)
    coords_norm[:, 0] = (coords[:, 0] - x_min) / (x_max - x_min + 1e-8) * 900 + 50
    coords_norm[:, 1] = (coords[:, 1] - y_min) / (y_max - y_min + 1e-8) * 900 + 50

    result = []
    for i, (_, row) in enumerate(df.iterrows()):
        result.append({
            'id': str(row['uuid']),
            'title': str(row['name']),
            'created_at': str(row['created_at']),
            'updated_at': str(row['updated_at']),
            'num_messages': int(row['num_messages']),
            'char_count': int(row['char_count']),
            'x': float(coords_norm[i, 0]),
            'y': float(coords_norm[i, 1]),
            'preview': str(row['full_text'])[:300],
            'full_text': str(row['full_text']),
            'source': str(row.get('source', 'claude')),
            'cluster_id': int(cluster_labels[i])
        })
    return result

def label_clusters(chats, api_key):
    import anthropic

    PALETTE = [
        "#FF4444", "#FFD700", "#00BFFF", "#00FF88", "#FF8C00",
        "#DA70D6", "#FF69B4", "#7CFC00", "#FF6347", "#40E0D0",
        "#9370DB", "#F0E68C", "#87CEEB", "#DDA0DD", "#98FB98",
        "#F4A460", "#B0C4DE", "#FFB6C1", "#FFDAB9", "#E0FFFF"
    ]

    clusters = {}
    for chat in chats:
        cid = chat['cluster_id']
        if cid == -1:
            continue
        if cid not in clusters:
            clusters[cid] = []
        clusters[cid].append(chat['title'])

    if not clusters:
        for chat in chats:
            chat['region'] = 'General'
            chat['color'] = PALETTE[0]
        return chats

    cluster_labels = {}
    cluster_colors = {}

    try:
        client = anthropic.Anthropic(api_key=api_key)

        for cid, titles in clusters.items():
            sample = titles[:8]
            prompt = f"""Here are titles of conversations someone had with an AI assistant:

{chr(10).join(f'- {t}' for t in sample)}

Give a single short label (2-4 words max) that best describes what topic or theme connects these conversations.
Respond with ONLY the label, nothing else. No punctuation."""

            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=20,
                messages=[{"role": "user", "content": prompt}]
            )
            label = response.content[0].text.strip()
            cluster_labels[cid] = label
            cluster_colors[cid] = PALETTE[cid % len(PALETTE)]

    except Exception:
        for cid in clusters:
            cluster_labels[cid] = f"Topic {cid + 1}"
            cluster_colors[cid] = PALETTE[cid % len(PALETTE)]

    for chat in chats:
        cid = chat['cluster_id']
        if cid == -1:
            chat['region'] = 'Other'
            chat['color'] = '#666666'
        else:
            chat['region'] = cluster_labels.get(cid, f'Topic {cid}')
            chat['color'] = cluster_colors.get(cid, '#666666')

    return chats

# ── Caching helpers ───────────────────────────────────────────────────────
_fragment = getattr(st, 'fragment', lambda f: f)

@st.cache_data
def _build_map_figure(chats, region_filter, source_filter, selected_ids, focused_id=None):
    filtered = chats if region_filter == "All Topics" else \
        [c for c in chats if c['region'] == region_filter]

    if source_filter == "Claude only":
        filtered = [c for c in filtered if c.get('source') == 'claude']
    elif source_filter == "ChatGPT only":
        filtered = [c for c in filtered if c.get('source') == 'chatgpt']

    fig = go.Figure()
    regions_seen = {}
    for chat in filtered:
        r = chat['region']
        is_selected = chat['id'] in selected_ids
        is_focused = chat['id'] == focused_id
        if r not in regions_seen:
            regions_seen[r] = {
                "x": [], "y": [], "text": [],
                "size": [], "color": [], "symbol": []
            }
        regions_seen[r]["x"].append(chat['x'])
        regions_seen[r]["y"].append(1000 - chat['y'])
        size = chat['size']
        if is_selected:
            size += 6
        if is_focused:
            size += 4
        regions_seen[r]["size"].append(size)
        color = "white" if is_selected else chat['color']
        regions_seen[r]["color"].append(color)
        base_symbol = "circle" if chat.get('source', 'claude') == 'claude' else "diamond"
        symbol = "star" if is_selected else base_symbol
        regions_seen[r]["symbol"].append(symbol)
        source_emoji = "🟣" if chat.get('source') == 'claude' else "🟢"
        hover = (
            f"<b>{chat['title']}</b><br>"
            f"{source_emoji} {chat.get('source', 'claude').upper()}<br>"
            f"Region: {chat['region']}<br>"
            f"Messages: {chat['num_messages']}<br>"
            f"Date: {chat['created_at'][:10]}<br>"
            f"{'⭐ Selected for blend' if is_selected else ''}"
            f"<br><i>{chat['preview'][:120]}...</i>"
        )
        regions_seen[r]["text"].append(hover)

    for region_name, data in regions_seen.items():
        fig.add_trace(go.Scatter(
            x=data["x"], y=data["y"],
            mode="markers",
            name=region_name,
            marker=dict(
                size=data["size"],
                color=data["color"],
                symbol=data["symbol"],
                opacity=0.9,
                line=dict(width=1.5, color="rgba(255,255,255,0.3)")
            ),
            hovertemplate="%{text}<extra></extra>",
            text=data["text"]
        ))

    region_centers = {}
    for chat in filtered:
        r = chat['region']
        if r not in region_centers:
            region_centers[r] = {'x': [], 'y': [], 'color': chat['color']}
        region_centers[r]['x'].append(chat['x'])
        region_centers[r]['y'].append(1000 - chat['y'])

    for region_name, coords in region_centers.items():
        if len(coords['x']) < 2:
            continue
        center_x = sum(coords['x']) / len(coords['x'])
        center_y = sum(coords['y']) / len(coords['y'])
        fig.add_annotation(
            x=center_x,
            y=center_y,
            text=region_name.upper(),
            showarrow=False,
            font=dict(size=10, color=coords['color'], family="monospace"),
            bgcolor="rgba(0,0,0,0.5)",
            borderpad=3,
            opacity=0.85
        )

    fig.update_layout(
        paper_bgcolor="#0a0a0f",
        plot_bgcolor="#0a0a0f",
        xaxis=dict(range=[0, 1000], showgrid=True, gridcolor="#1a1a2e",
                   zeroline=False, showticklabels=False),
        yaxis=dict(range=[0, 1000], showgrid=True, gridcolor="#1a1a2e",
                   zeroline=False, showticklabels=False),
        height=580,
        margin=dict(l=0, r=0, t=10, b=0),
        legend=dict(bgcolor="#111", bordercolor="#333",
                    font=dict(color="#aaa", size=10), x=0.01, y=0.99),
        hoverlabel=dict(bgcolor="#1a1a2e", font_size=12,
                        font_family="monospace")
    )
    return fig, filtered

# ── Landing page ──────────────────────────────────────────────────────────
def show_landing():
    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        components.html("""
<style>body{margin:0;background:#0a0a0f;font-family:sans-serif}</style>
<div style='text-align:center; padding:40px 0 20px 0'>
    <div style='font-size:4rem; margin-bottom:16px'>🌍</div>
    <h1 style='color:white; font-size:2.2rem; margin-bottom:8px; font-weight:700'>
        Mind World
    </h1>
    <p style='color:#888; font-size:1.1rem; margin-bottom:32px; line-height:1.6'>
        Map your entire AI conversation history across Claude and ChatGPT.<br>
        Similar topics cluster together. Watch your thinking take shape.
    </p>
</div>
""", height=280)

        # Feature cards
        components.html("""
<style>body{margin:0;background:#0a0a0f;font-family:sans-serif}</style>
<div style='background:#111827; border:1px solid #222; border-radius:16px;
            padding:24px; margin-bottom:24px'>

    <div style='display:flex; gap:16px; margin-bottom:18px; align-items:flex-start'>
        <div style='font-size:1.4rem'>🗺️</div>
        <div>
            <div style='color:white; font-weight:600; margin-bottom:3px'>Spatial Map</div>
            <div style='color:#888; font-size:0.88rem'>Every conversation placed by meaning.
            Similar topics cluster together automatically.</div>
        </div>
    </div>

    <div style='display:flex; gap:16px; margin-bottom:18px; align-items:flex-start'>
        <div style='font-size:1.4rem'>⏳</div>
        <div>
            <div style='color:white; font-weight:600; margin-bottom:3px'>Time Machine</div>
            <div style='color:#888; font-size:0.88rem'>Watch your world grow month by month.
            See your intellectual journey unfold.</div>
        </div>
    </div>

    <div style='display:flex; gap:16px; align-items:flex-start'>
        <div style='font-size:1.4rem'>🔀</div>
        <div>
            <div style='color:white; font-weight:600; margin-bottom:3px'>Context Blending</div>
            <div style='color:#888; font-size:0.88rem'>Select any past conversations and blend
            their context into one focused Claude chat. 2 free blends included.</div>
        </div>
    </div>

</div>
""", height=290)

        # Export instructions
        components.html("""
<style>body{margin:0;background:#0a0a0f;font-family:sans-serif}</style>
<div style='background:#0d1117; border:1px solid #30363d; border-radius:12px;
            padding:18px; margin-bottom:20px'>
    <div style='color:#58a6ff; font-weight:600; margin-bottom:12px; font-size:0.88rem'>
        📥 HOW TO GET YOUR EXPORT
    </div>
    <div style='display:flex; gap:20px; margin-bottom:12px'>
        <div style='flex:1'>
            <div style='color:#7C3AED; font-weight:600; font-size:0.82rem; margin-bottom:6px'>
                🟣 Claude
            </div>
            <div style='color:#888; font-size:0.82rem; line-height:1.9'>
                1. Go to <span style='color:white'>claude.ai</span><br>
                2. Settings → Account → <span style='color:white'>Export Data</span><br>
                3. Download and unzip<br>
                4. Upload <span style='color:white'>conversations.json</span>
            </div>
        </div>
        <div style='width:1px; background:#222'></div>
        <div style='flex:1'>
            <div style='color:#10B981; font-weight:600; font-size:0.82rem; margin-bottom:6px'>
                🟢 ChatGPT
            </div>
            <div style='color:#888; font-size:0.82rem; line-height:1.9'>
                1. Go to <span style='color:white'>chatgpt.com</span><br>
                2. Settings → Data Controls → <span style='color:white'>Export Data</span><br>
                3. Wait for the email<br>
                4. Upload the <span style='color:white'>ZIP file directly</span>
            </div>
        </div>
    </div>
    <div style='color:#555; font-size:0.78rem; border-top:1px solid #1e2433;
                padding-top:10px; text-align:center'>
        You can upload one or both — they will appear on the same map.
    </div>
</div>
""", height=260)

        # File uploaders
        st.markdown("**Upload your conversation exports:**")

        col_a, col_b = st.columns(2)
        with col_a:
            claude_file = st.file_uploader(
                "🟣 Claude export",
                type=['json'],
                help="Upload conversations.json from your Claude export"
            )
        with col_b:
            chatgpt_file = st.file_uploader(
                "🟢 ChatGPT export",
                type=['zip'],
                help="Upload the ZIP file directly from your ChatGPT export"
            )

        any_uploaded = claude_file is not None or chatgpt_file is not None

        if any_uploaded:
            if claude_file:
                st.markdown("✓ Claude file ready")
            if chatgpt_file:
                st.markdown("✓ ChatGPT file ready")

            st.markdown("")

            generate_clicked = st.button(
                "🌍 Generate My Map",
                type="primary",
                use_container_width=True,
                help="Upload one or both files, then click to generate your map"
            )
        else:
            generate_clicked = False

        if generate_clicked:
            with st.spinner("Reading your conversations..."):
                try:
                    import io
                    all_dfs = []

                    if claude_file is not None:
                        data = json.loads(
                            claude_file.read().decode('utf-8-sig', errors='replace')
                        )
                        df_claude = parse_conversations(data)
                        df_claude['source'] = 'claude'
                        all_dfs.append(df_claude)
                        st.success(f"✓ Claude: {len(df_claude)} conversations found")

                    if chatgpt_file is not None:
                        df_chatgpt, _ = parse_chatgpt_zip(io.BytesIO(chatgpt_file.read()))
                        df_chatgpt['source'] = 'chatgpt'
                        all_dfs.append(df_chatgpt)
                        st.success(f"✓ ChatGPT: {len(df_chatgpt)} conversations found")

                    if not all_dfs:
                        st.error("No conversations found in the uploaded files.")
                        return

                    df = pd.concat(all_dfs, ignore_index=True)

                    if len(df) == 0:
                        st.error("No conversations found.")
                        return

                    if claude_file and chatgpt_file:
                        st.session_state.chat_source = 'both'
                    elif claude_file:
                        st.session_state.chat_source = 'claude'
                    else:
                        st.session_state.chat_source = 'chatgpt'

                    st.info(f"Embedding {len(df)} total conversations... (~30-60 seconds)")

                    with st.spinner("Generating your unified map..."):
                        chats = embed_and_position(df)

                    api_key = st.session_state.get('user_api_key') or os.getenv("ANTHROPIC_API_KEY")

                    with st.spinner("Identifying your unique topics..."):
                        chats = label_clusters(chats, api_key)

                    for chat in chats:
                        chat['size'] = max(8, min(25, chat['num_messages'] // 4 + 6))

                    st.session_state.chats = chats
                    st.rerun()

                except Exception as e:
                    import traceback
                    st.error(f"Something went wrong: {str(e)}")
                    st.code(traceback.format_exc())

        st.caption("🔒 Your data stays in your session only. Nothing is stored or shared.")

@_fragment
def _blend_panel(chats):
    st.markdown("### 🔀 Context Blender")

    blends_remaining = FREE_BLEND_LIMIT - st.session_state.blend_count
    has_user_key = bool(st.session_state.user_api_key)

    if blends_remaining > 0:
        st.success(f"✓ {blends_remaining} free blend{'s' if blends_remaining > 1 else ''} remaining")
    elif has_user_key:
        st.success("✓ Using your API key")
    else:
        st.error("Free blends used — add your API key below")

    chat_lookup = {c['id']: c for c in chats}
    all_titles = {c['id']: c['title'] for c in chats}

    selected = st.multiselect(
        "Add conversations to blend:",
        options=list(all_titles.keys()),
        format_func=lambda x: all_titles[x][:45],
        default=st.session_state.selected_ids,
        max_selections=4,
        key="blend_selector"
    )
    st.session_state.selected_ids = selected

    if selected:
        st.markdown(f"**{len(selected)} selected**")
        for sid in selected:
            if sid in chat_lookup:
                c = chat_lookup[sid]
                emoji = "🟣" if c.get('source', 'claude') == 'claude' else "🟢"
                st.markdown(f"{emoji} **{c['title'][:40]}**")

        st.markdown("---")

        custom_prompt = st.text_area(
            "Your question:",
            placeholder="What would you like to explore across these conversations?",
            height=80,
            key="blend_prompt"
        )

        # API key input if free blends used
        if blends_remaining <= 0 and not has_user_key:
            st.markdown("---")
            st.markdown("**You've used your 2 free blends.**")
            st.caption("Add your Anthropic API key to continue. Get one free at console.anthropic.com")
            user_key = st.text_input(
                "Your Anthropic API key:",
                type="password",
                placeholder="sk-ant-..."
            )
            if st.button("Save API Key", use_container_width=True):
                if user_key.startswith("sk-ant-"):
                    st.session_state.user_api_key = user_key
                    st.success("API key saved!")
                    st.rerun()
                else:
                    st.error("That doesn't look like a valid Anthropic API key")

        # Show blend button if allowed
        can_blend = blends_remaining > 0 or has_user_key

        if can_blend:
            if st.button("🔀 Blend & Open in Claude",
                         type="primary",
                         use_container_width=True):

                api_key = st.session_state.user_api_key or os.getenv("ANTHROPIC_API_KEY")

                with st.spinner("Extracting intelligence from conversations..."):
                    import anthropic
                    client = anthropic.Anthropic(api_key=api_key)
                    smart_summaries = []

                    for sid in selected:
                        if sid not in chat_lookup:
                            continue
                        c = chat_lookup[sid]
                        raw_text = c.get('full_text', '')

                        lines = raw_text.split('\n')
                        human_lines = []
                        capture = False
                        for line in lines:
                            if line.strip().startswith('[human]'):
                                capture = True
                                human_lines.append(line.replace('[human]', '').strip())
                            elif line.strip().startswith('[assistant]'):
                                capture = False
                            elif capture and line.strip():
                                human_lines.append(line.strip())

                        human_text = '\n'.join(human_lines)[:4000]

                        extraction_prompt = f"""Extract key intelligence from this conversation for use as context.

Conversation: "{c['title']}"
Date: {c['created_at'][:10]} | Messages: {c['num_messages']}

Human messages:
{human_text}

Summarize in this format:

CORE TOPIC: (one sentence)

KEY GOALS: (bullet points — what was the person trying to achieve?)

IMPORTANT OUTPUTS: (what was decided, written, or built?)

OPEN THREADS: (unresolved questions or ideas)

RELEVANT CONTEXT: (background facts about the person that emerged)

Be specific. Use the person's actual words where possible."""

                        response = client.messages.create(
                            model="claude-haiku-4-5-20251001",
                            max_tokens=500,
                            messages=[{"role": "user", "content": extraction_prompt}]
                        )
                        smart_summaries.append({
                            "title": c['title'],
                            "date": c['created_at'][:10],
                            "summary": response.content[0].text
                        })

                # Increment blend count only if using free quota
                if not st.session_state.user_api_key:
                    st.session_state.blend_count += 1
                    new_count = st.session_state.blend_count
                    components.html(f"""
                    <script>
                    localStorage.setItem('mindworld_blend_count', '{new_count}');
                    var url = new URL(window.parent.location.href);
                    url.searchParams.set('_bc', '{new_count}');
                    window.parent.history.replaceState({{}}, '', url);
                    </script>
                    """, height=0)

                context_block = ""
                for s in smart_summaries:
                    context_block += f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PAST CONVERSATION: {s['title']}
Date: {s['date']}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{s['summary']}

"""
                user_message = custom_prompt.strip() if custom_prompt.strip() else \
                    "Based on these past conversations, what connections, patterns, or next steps do you see?"

                full_message = f"""I'm sharing context from {len(selected)} past conversations.

{context_block}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MY QUESTION: {user_message}"""

                encoded = urllib.parse.quote(full_message)
                claude_url = f"https://claude.ai/new?q={encoded}"
                chatgpt_url = f"https://chatgpt.com/?q={encoded}"

                st.markdown("**Open blended context in:**")
                col_claude, col_gpt = st.columns(2)
                with col_claude:
                    st.markdown(f"""
<a href="{claude_url}" target="_blank" style="
    display:block; background:#7c3aed; color:white;
    text-align:center; padding:10px; border-radius:8px;
    text-decoration:none; font-weight:bold;">
    🟣 Claude →
</a>
""", unsafe_allow_html=True)
                with col_gpt:
                    st.markdown(f"""
<a href="{chatgpt_url}" target="_blank" style="
    display:block; background:#10A37F; color:white;
    text-align:center; padding:10px; border-radius:8px;
    text-decoration:none; font-weight:bold;">
    🟢 ChatGPT →
</a>
""", unsafe_allow_html=True)

                new_remaining = FREE_BLEND_LIMIT - st.session_state.blend_count
                if not has_user_key and new_remaining > 0:
                    st.info(f"{new_remaining} free blend{'s' if new_remaining > 1 else ''} remaining")
                elif not has_user_key and new_remaining <= 0:
                    st.warning("That was your last free blend. Add your API key above to continue.")

                for s in smart_summaries:
                    with st.expander(f"📋 {s['title'][:35]}"):
                        st.text(s['summary'])
        else:
            st.button("🔀 Blend & Open in Claude",
                      disabled=True,
                      use_container_width=True,
                      help="Add your API key above to continue blending")

# ── Main map ──────────────────────────────────────────────────────────────
def show_map():
    chats = st.session_state.chats

    # Header
    _total_msgs = sum(c['num_messages'] for c in chats)
    _total_chars_k = sum(c['char_count'] for c in chats) // 1000
    claude_count = sum(1 for c in chats if c.get('source') == 'claude')
    chatgpt_count = sum(1 for c in chats if c.get('source') == 'chatgpt')
    _chat_source = st.session_state.get('chat_source', 'both')
    if _chat_source == 'both':
        source_badge = (
            "<span style='background:#7C3AED; color:white; font-size:0.7rem;"
            " padding:2px 8px; border-radius:10px; margin-left:8px'>🟣 Claude</span>"
            "<span style='background:#059669; color:white; font-size:0.7rem;"
            " padding:2px 8px; border-radius:10px; margin-left:4px'>🟢 ChatGPT</span>"
        )
    elif _chat_source == 'claude':
        source_badge = ("<span style='background:#7C3AED; color:white; font-size:0.7rem;"
                        " padding:2px 8px; border-radius:10px; margin-left:8px'>Claude</span>")
    else:
        source_badge = ("<span style='background:#059669; color:white; font-size:0.7rem;"
                        " padding:2px 8px; border-radius:10px; margin-left:8px'>ChatGPT</span>")
    components.html(f"""
<style>body{{margin:0;background:#0a0a0f;font-family:sans-serif}}</style>
<div style='display:flex; align-items:center; justify-content:space-between;
     padding:8px 4px; border-bottom:1px solid #222; margin-bottom:8px'>
    <div>
        <span style='font-size:1.4rem; font-weight:bold; color:white'>🌍 Mind World</span>
        {source_badge}
        <span style='color:#555; font-size:0.85rem; margin-left:12px'>
            Your conversations mapped by meaning
        </span>
    </div>
    <div style='display:flex; gap:24px; align-items:center'>
        <div style='text-align:center'>
            <div style='font-size:1.2rem; font-weight:bold; color:white'>{len(chats)}</div>
            <div style='font-size:0.7rem; color:#555'>conversations</div>
        </div>
        <div style='text-align:center'>
            <div style='font-size:1.2rem; font-weight:bold; color:white'>{_total_msgs:,}</div>
            <div style='font-size:0.7rem; color:#555'>messages</div>
        </div>
        <div style='text-align:center'>
            <div style='font-size:1.2rem; font-weight:bold; color:white'>{_total_chars_k}K</div>
            <div style='font-size:0.7rem; color:#555'>characters</div>
        </div>
        <div style='text-align:center'>
            <div style='font-size:1.2rem; font-weight:bold; color:#DA70D6'>{claude_count}</div>
            <div style='font-size:0.7rem; color:#555'>claude chats</div>
        </div>
        <div style='text-align:center'>
            <div style='font-size:1.2rem; font-weight:bold; color:#10B981'>{chatgpt_count}</div>
            <div style='font-size:0.7rem; color:#555'>chatgpt chats</div>
        </div>
    </div>
</div>
""", height=65)

    # Reset button
    if st.button("← Upload different file", key="reset"):
        st.session_state.chats = None
        st.session_state.blend_count = 0
        st.session_state.selected_ids = []
        st.session_state.chat_source = 'both'
        st.rerun()

    # Layout
    blend_col, map_col, list_col = st.columns([1, 3, 1])

    # ── Blend panel ───────────────────────────────────────────────────────
    with blend_col:
        _blend_panel(chats)

    # ── Map ───────────────────────────────────────────────────────────────
    with map_col:
        all_regions = sorted(set(c['region'] for c in chats))
        region_filter = st.selectbox(
            "🔍 Filter by topic",
            ["All Topics"] + all_regions
        )

        source_filter = st.selectbox(
            "🤖 Filter by platform",
            ["All Platforms", "Claude only", "ChatGPT only"]
        )

        fig, filtered = _build_map_figure(
            tuple(chats), region_filter, source_filter,
            tuple(st.session_state.selected_ids),
            st.session_state.get('selected_chat_id')
        )

        event = st.plotly_chart(
            fig,
            use_container_width=True,
            on_select="rerun",
            selection_mode="points",
            key="main_map"
        )

        # Handle click selection
        if event and event.selection and event.selection.points:
            point = event.selection.points[0]
            clicked_x = point.x
            clicked_y = point.y

            for chat in filtered:
                if (abs(chat['x'] - clicked_x) < 0.1 and
                        abs((1000 - chat['y']) - clicked_y) < 0.1):
                    st.session_state.selected_chat_id = chat['id']
                    break

        # Detail panel for selected conversation
        selected_id = st.session_state.get('selected_chat_id')
        if selected_id:
            selected_chat = next(
                (c for c in chats if c['id'] == selected_id), None
            )
            if selected_chat:
                source_emoji = "🟣" if selected_chat.get('source') == 'claude' else "🟢"

                st.markdown("---")
                st.markdown(f"### {source_emoji} {selected_chat['title']}")

                detail_col1, detail_col2, detail_col3 = st.columns(3)
                detail_col1.metric("Messages", selected_chat['num_messages'])
                detail_col2.metric("Topic", selected_chat['region'])
                detail_col3.metric(
                    "Date", selected_chat['created_at'][:10]
                )

                st.markdown(
                    f"*{selected_chat['preview'][:400]}...*"
                )

                btn_col1, btn_col2, btn_col3 = st.columns(3)

                with btn_col1:
                    if selected_chat.get('source') == 'claude':
                        st.markdown(
                            f"[🟣 Open in Claude ↗]"
                            f"(https://claude.ai/chat/{selected_chat['id']})"
                        )
                    else:
                        st.markdown("🟢 ChatGPT conversation")

                with btn_col2:
                    if st.button(
                        "➕ Add to Blend",
                        key=f"add_blend_{selected_id}"
                    ):
                        if selected_id not in st.session_state.selected_ids:
                            if len(st.session_state.selected_ids) < 4:
                                st.session_state.selected_ids.append(selected_id)
                                st.rerun()
                            else:
                                st.warning("Max 4 conversations in a blend")

                with btn_col3:
                    if st.button("✕ Close", key="close_detail"):
                        st.session_state.selected_chat_id = None
                        st.rerun()

        st.caption(
            f"Showing {len(filtered)} of {len(chats)} conversations · "
            f"● Circle = Claude · ◆ Diamond = ChatGPT · "
            f"Color = topic · ★ Star = selected for blending · "
            f"Click any dot to see details · Scroll to zoom · Drag to pan"
        )

        # ── Time slider ───────────────────────────────────────────────────
        st.markdown("---")
        st.markdown("### ⏳ Time Machine")

        all_dates = []
        for chat in chats:
            try:
                d = datetime.fromisoformat(
                    chat['created_at'].replace('Z', '+00:00')).date()
                all_dates.append(d)
            except:
                pass

        if all_dates:
            from datetime import date
            min_date = min(all_dates)
            max_date = max(all_dates)

            months = []
            current = date(min_date.year, min_date.month, 1)
            end = date(max_date.year, max_date.month, 1)
            while current <= end:
                months.append(current)
                if current.month == 12:
                    current = date(current.year + 1, 1, 1)
                else:
                    current = date(current.year, current.month + 1, 1)

            month_labels = [m.strftime("%b %Y") for m in months]

            selected_month_idx = st.select_slider(
                "Drag to travel through time:",
                options=list(range(len(months))),
                value=len(months) - 1,
                format_func=lambda i: month_labels[i]
            )

            selected_cutoff = months[selected_month_idx]
            if selected_cutoff.month == 12:
                cutoff_end = date(selected_cutoff.year + 1, 1, 1)
            else:
                cutoff_end = date(selected_cutoff.year,
                                  selected_cutoff.month + 1, 1)

            time_filtered = []
            for chat in filtered:
                try:
                    chat_date = datetime.fromisoformat(
                        chat['created_at'].replace('Z', '+00:00')).date()
                    if chat_date < cutoff_end:
                        time_filtered.append(chat)
                except:
                    pass

            new_this_month = [c for c in time_filtered if
                datetime.fromisoformat(c['created_at'].replace('Z', '+00:00')).date()
                >= selected_cutoff and
                datetime.fromisoformat(c['created_at'].replace('Z', '+00:00')).date()
                < cutoff_end]

            t1, t2, t3 = st.columns(3)
            t1.metric("Conversations", len(time_filtered))
            t2.metric("New this month", len(new_this_month))
            t3.metric("Total messages",
                      sum(c['num_messages'] for c in time_filtered))

            time_fig = go.Figure()
            regions_time = {}
            for chat in time_filtered:
                r = chat['region']
                chat_date = datetime.fromisoformat(
                    chat['created_at'].replace('Z', '+00:00')).date()
                is_new = (chat_date >= selected_cutoff and
                          chat_date < cutoff_end)
                if r not in regions_time:
                    regions_time[r] = {
                        "x": [], "y": [], "text": [],
                        "size": [], "color": [], "opacity": [], "symbol": []
                    }
                regions_time[r]["x"].append(chat['x'])
                regions_time[r]["y"].append(1000 - chat['y'])
                regions_time[r]["size"].append(
                    chat['size'] + (6 if is_new else 0))
                regions_time[r]["color"].append(chat['color'])
                regions_time[r]["opacity"].append(1.0 if is_new else 0.3)
                regions_time[r]["symbol"].append(
                    "circle" if chat.get('source', 'claude') == 'claude' else "diamond"
                )
                label = "🆕 NEW" if is_new else ""
                regions_time[r]["text"].append(
                    f"<b>{chat['title']}</b> {label}<br>"
                    f"Added: {chat['created_at'][:10]}<br>"
                    f"Messages: {chat['num_messages']}"
                )

            for region_name, data in regions_time.items():
                time_fig.add_trace(go.Scatter(
                    x=data["x"], y=data["y"],
                    mode="markers",
                    name=region_name,
                    marker=dict(
                        size=data["size"],
                        color=data["color"],
                        symbol=data["symbol"],
                        opacity=data["opacity"],
                        line=dict(width=1, color="rgba(255,255,255,0.2)")
                    ),
                    hovertemplate="%{text}<extra></extra>",
                    text=data["text"]
                ))

            for chat in new_this_month:
                time_fig.add_trace(go.Scatter(
                    x=[chat['x']], y=[1000 - chat['y']],
                    mode="markers",
                    showlegend=False,
                    marker=dict(
                        size=chat['size'] + 14,
                        color="rgba(0,0,0,0)",
                        line=dict(width=2, color="white")
                    ),
                    hoverinfo="skip"
                ))

            time_fig.update_layout(
                paper_bgcolor="#0a0a0f",
                plot_bgcolor="#0a0a0f",
                xaxis=dict(range=[0, 1000], showgrid=True,
                           gridcolor="#1a1a2e", zeroline=False,
                           showticklabels=False),
                yaxis=dict(range=[0, 1000], showgrid=True,
                           gridcolor="#1a1a2e", zeroline=False,
                           showticklabels=False),
                height=480,
                margin=dict(l=0, r=0, t=10, b=0),
                legend=dict(bgcolor="#111", bordercolor="#333",
                            font=dict(color="#aaa", size=10),
                            x=0.01, y=0.99),
                hoverlabel=dict(bgcolor="#1a1a2e", font_size=12,
                                font_family="monospace")
            )
            st.plotly_chart(time_fig, use_container_width=True)

            if new_this_month:
                st.markdown(f"**🆕 New in {month_labels[selected_month_idx]}:**")
                for c in new_this_month:
                    emoji = "🟣" if c.get('source', 'claude') == 'claude' else "🟢"
                    st.markdown(
                        f"{emoji} **{c['title']}** — {c['num_messages']} messages")

    # ── Conversation list ─────────────────────────────────────────────────
    with list_col:
        st.markdown("### Conversations")
        sort_by = st.selectbox(
            "Sort",
            ["Most Recent", "Most Messages", "Alphabetical"]
        )

        display = sorted(
            filtered,
            key=lambda x: x['created_at'] if sort_by == "Most Recent"
                     else -x['num_messages'] if sort_by == "Most Messages"
                     else x['title'],
            reverse=(sort_by == "Most Recent")
        )

        for d in display[:25]:
            is_sel = d['id'] in st.session_state.selected_ids
            emoji = "🟣" if d.get('source', 'claude') == 'claude' else "🟢"
            prefix = "⭐ " if is_sel else ""
            with st.expander(f"{prefix}{emoji} {d['title'][:35]}"):
                st.markdown(f"**{d['num_messages']} msgs** · {d['created_at'][:10]}")
                st.markdown(f"*{d['region']}*")
                st.markdown(
                    f"[Open in Claude ↗](https://claude.ai/chat/{d['id']})")

# ── Router ────────────────────────────────────────────────────────────────
if st.session_state.chats is None:
    show_landing()
else:
    show_map()