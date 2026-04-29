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

def embed_and_position(df):
    from sentence_transformers import SentenceTransformer
    import umap

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
            'full_text': str(row['full_text'])
        })
    return result

def get_region_and_color(chat):
    title = chat['title'].lower()
    preview = chat.get('preview', '').lower()
    content = title + ' ' + preview

    if any(w in content for w in ['essay', 'transfer', 'stanford', 'harvard', 'uc ', 'rice',
                                   'scholarship', 'admission', 'personal statement', 'application']):
        return "Applications & Writing", "#FF4444"
    elif any(w in content for w in ['economic', 'gdp', 'fiscal', 'aggregate', 'federalism',
                                    'constitution', 'congress', 'slavery', 'civil rights',
                                    'history', 'political', 'government']):
        return "Academics & History", "#FFD700"
    elif any(w in content for w in ['c++', 'java', 'python', 'code', 'debug', 'function',
                                    'algorithm', 'programming', 'compile', 'syntax']):
        return "Coding & Technical", "#00BFFF"
    elif any(w in content for w in ['ai', 'agent', 'crew', 'career', 'internship', 'job',
                                    'resume', 'tech', 'mvp', 'startup', 'machine learning',
                                    'neural', 'model', 'llm']):
        return "AI & Career", "#00FF88"
    elif any(w in content for w in ['research', 'physics', 'data', 'analysis', 'science',
                                    'experiment', 'study', 'paper', 'methodology']):
        return "Research & Science", "#FF8C00"
    else:
        return "Creative & Other", "#DA70D6"

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
        Turn your entire Claude conversation history into a navigable map.<br>
        Similar topics cluster together. Watch your thinking take shape.
    </p>
</div>
""", height=220)

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
    <div style='color:#58a6ff; font-weight:600; margin-bottom:10px; font-size:0.88rem'>
        📥 HOW TO GET YOUR EXPORT
    </div>
    <div style='color:#888; font-size:0.84rem; line-height:2'>
        1. Go to <span style='color:white'>claude.ai</span><br>
        2. Click your profile → <span style='color:white'>Settings</span><br>
        3. Go to <span style='color:white'>Account → Export Data</span><br>
        4. Download and unzip the file<br>
        5. Upload <span style='color:white'>conversations.json</span> below
    </div>
</div>
""", height=210)

        # File uploader
        uploaded = st.file_uploader(
            "Drop your conversations.json here",
            type=['json'],
            help="Your data never leaves your session. We don't store anything."
        )

        if uploaded:
            with st.spinner("Reading your conversations..."):
                try:
                    data = json.loads(uploaded.read().decode('utf-8-sig', errors='replace'))
                    df = parse_conversations(data)

                    if len(df) == 0:
                        st.error("No conversations found. Make sure you're uploading conversations.json from your Claude export.")
                        return

                    st.success(f"Found {len(df)} conversations. Generating your world...")

                    with st.spinner(f"Embedding {len(df)} conversations... (~30 seconds)"):
                        chats = embed_and_position(df)

                    for chat in chats:
                        region, color = get_region_and_color(chat)
                        chat['region'] = region
                        chat['color'] = color
                        chat['size'] = max(8, min(25, chat['num_messages'] // 4 + 6))

                    st.session_state.chats = chats
                    st.rerun()

                except Exception as e:
                    import traceback
                    st.error(f"Something went wrong: {str(e)}")
                    st.code(traceback.format_exc())
                    st.info("Make sure you're uploading conversations.json from your Claude export ZIP.")

        st.caption("🔒 Your data stays in your session only. Nothing is stored or shared.")

# ── Main map ──────────────────────────────────────────────────────────────
def show_map():
    chats = st.session_state.chats

    # Header
    _total_msgs = sum(c['num_messages'] for c in chats)
    _total_chars_k = sum(c['char_count'] for c in chats) // 1000
    components.html(f"""
<style>body{{margin:0;background:#0a0a0f;font-family:sans-serif}}</style>
<div style='display:flex; align-items:center; justify-content:space-between;
     padding:8px 4px; border-bottom:1px solid #222; margin-bottom:8px'>
    <div>
        <span style='font-size:1.4rem; font-weight:bold; color:white'>🌍 Mind World</span>
        <span style='color:#555; font-size:0.85rem; margin-left:12px'>
            Your Claude conversations mapped by meaning
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
    </div>
</div>
""", height=65)

    # Reset button
    if st.button("← Upload different file", key="reset"):
        st.session_state.chats = None
        st.session_state.blend_count = 0
        st.session_state.selected_ids = []
        st.rerun()

    # Layout
    blend_col, map_col, list_col = st.columns([1, 3, 1])

    # ── Blend panel ───────────────────────────────────────────────────────
    with blend_col:
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
                    emoji = {"Applications & Writing": "🔴",
                             "Academics & History": "🟡",
                             "Coding & Technical": "🔵",
                             "AI & Career": "🟢",
                             "Research & Science": "🟠",
                             "Creative & Other": "🟣"}.get(c['region'], "⚪")
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

                    components.html(f"""
<style>body{{margin:0;padding:4px 0;background:#0a0a0f}}</style>
<a href="{claude_url}" target="_blank" style="
    display:block; background:#7c3aed; color:white;
    text-align:center; padding:12px; border-radius:8px;
    text-decoration:none; font-weight:bold;">
    ✨ Open Blended Chat →
</a>
""", height=52)

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

    # ── Map ───────────────────────────────────────────────────────────────
    with map_col:
        region_filter = st.selectbox(
            "🔍 Filter by region",
            ["All Regions", "Applications & Writing", "Academics & History",
             "Coding & Technical", "AI & Career",
             "Research & Science", "Creative & Other"]
        )

        filtered = chats if region_filter == "All Regions" else \
            [c for c in chats if c['region'] == region_filter]

        fig = go.Figure()

        regions_seen = {}
        for chat in filtered:
            r = chat['region']
            is_selected = chat['id'] in st.session_state.selected_ids
            if r not in regions_seen:
                regions_seen[r] = {
                    "x": [], "y": [], "text": [],
                    "size": [], "color": [], "symbol": []
                }
            regions_seen[r]["x"].append(chat['x'])
            regions_seen[r]["y"].append(1000 - chat['y'])
            regions_seen[r]["size"].append(chat['size'] + (6 if is_selected else 0))
            regions_seen[r]["color"].append("white" if is_selected else chat['color'])
            regions_seen[r]["symbol"].append("star" if is_selected else "circle")
            hover = (
                f"<b>{chat['title']}</b><br>"
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

        st.plotly_chart(fig, use_container_width=True)
        st.caption(f"Showing {len(filtered)} of {len(chats)} conversations · "
                   f"Hover for details · Stars = selected for blending")

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
                        "size": [], "color": [], "opacity": []
                    }
                regions_time[r]["x"].append(chat['x'])
                regions_time[r]["y"].append(1000 - chat['y'])
                regions_time[r]["size"].append(
                    chat['size'] + (6 if is_new else 0))
                regions_time[r]["color"].append(chat['color'])
                regions_time[r]["opacity"].append(1.0 if is_new else 0.3)
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
                    emoji = {"Applications & Writing": "🔴",
                             "Academics & History": "🟡",
                             "Coding & Technical": "🔵",
                             "AI & Career": "🟢",
                             "Research & Science": "🟠",
                             "Creative & Other": "🟣"}.get(c['region'], "⚪")
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
            emoji = {"Applications & Writing": "🔴",
                     "Academics & History": "🟡",
                     "Coding & Technical": "🔵",
                     "AI & Career": "🟢",
                     "Research & Science": "🟠",
                     "Creative & Other": "🟣"}.get(d['region'], "⚪")
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