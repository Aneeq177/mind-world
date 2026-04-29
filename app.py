import streamlit as st
import json
import plotly.graph_objects as go
import urllib.parse
from dotenv import load_dotenv
load_dotenv()

st.set_page_config(
    page_title="Mind World",
    page_icon="🌍",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# Hide default Streamlit header/footer/menu
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
    [data-testid="stVerticalBlock"] {
        gap: 0.5rem;
    }
</style>
""", unsafe_allow_html=True)

@st.cache_data
def load_data(demo_mode=False):
    if demo_mode:
        with open('demo_chats.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    with open('chats_positioned.json', 'r', encoding='utf-8') as f:
        return json.load(f)

@st.cache_data
def load_full_texts():
    import pandas as pd
    df = pd.read_csv('chats_parsed.csv')
    return {row['uuid']: str(row['full_text']) for _, row in df.iterrows()}

@st.cache_data
def load_demo_texts():
    demo_texts = {}
    try:
        with open('demo_chats.json', 'r', encoding='utf-8') as f:
            demo_chats = json.load(f)
        for c in demo_chats:
            demo_texts[c['id']] = c['preview'] * 5
    except:
        pass
    return demo_texts

# ── Demo mode toggle ─────────────────────────────────────────────────────
demo_col1, demo_col2 = st.columns([6, 1])
with demo_col2:
    DEMO_MODE = st.toggle(
        "🎬 Demo Mode",
        value=False,
        help="Switch to demo data for recording/sharing"
    )

if DEMO_MODE:
    chats = load_data(demo_mode=True)
    full_texts = load_demo_texts()
    st.success("🎬 Demo mode ON — safe to record and share", icon="✅")
else:
    chats = load_data(demo_mode=False)
    full_texts = load_full_texts()

def get_region_and_color(chat):
    title = chat['title'].lower()
    preview = chat['preview'].lower()
    content = title + ' ' + preview

    if any(w in content for w in ['essay', 'transfer', 'stanford', 'harvard', 'uc ', 'rice', 'scholarship', 'admission', 'personal statement']):
        return "Transfer Applications", "#FF4444"
    elif any(w in content for w in ['economic', 'gdp', 'fiscal', 'aggregate', 'federalism', 'constitution', 'congress', 'slavery', 'civil rights', 'iran', 'reagan', 'kennedy', 'venezuela', 'bolivar']):
        return "Economics & History", "#FFD700"
    elif any(w in content for w in ['c++', 'string', 'erase', 'operator', 'compile', 'unary', 'reading and averaging', 'file']):
        return "Coding & C++", "#00BFFF"
    elif any(w in content for w in ['ai', 'agent', 'crew', 'career', 'internship', 'f-1', 'visa', 'agentic', 'resume', 'job', 'tech', 'mvp', 'multi-agent']):
        return "AI & Career", "#00FF88"
    elif any(w in content for w in ['research', 'physics', 'heat island', 'houston', 'reu', 'torque', 'beam', 'volcanic', 'statics', 'science']):
        return "Research & Science", "#FF8C00"
    else:
        return "Creative & Writing", "#DA70D6"

for chat in chats:
    if not DEMO_MODE:
        region, color = get_region_and_color(chat)
        chat['region'] = region
        chat['color'] = color
    chat['size'] = max(8, min(25, chat['num_messages'] // 4 + 6))

REGION_EMOJI = (
    {"Academic Writing": "🔴", "Business & Economics": "🟡",
     "Software Engineering": "🔵", "Machine Learning & AI": "🟢",
     "Data Science": "🟠", "Research & Communication": "🟣"}
    if DEMO_MODE else
    {"Transfer Applications": "🔴", "Economics & History": "🟡",
     "Coding & C++": "🔵", "AI & Career": "🟢",
     "Research & Science": "🟠", "Creative & Writing": "🟣"}
)

# ── Session state for selections ─────────────────────────────────────────
if 'selected_ids' not in st.session_state:
    st.session_state.selected_ids = []

# ── Header ───────────────────────────────────────────────────────────────
st.markdown("""
<div style='display:flex; align-items:center; justify-content:space-between;
     padding:8px 4px; border-bottom:1px solid #222; margin-bottom:8px'>
    <div>
        <span style='font-size:1.4rem; font-weight:bold; color:white'>🌍 Mind World</span>
        <span style='color:#555; font-size:0.85rem; margin-left:12px'>Your Claude conversations mapped by meaning</span>
    </div>
    <div style='display:flex; gap:24px; align-items:center'>
        <div style='text-align:center'>
            <div style='font-size:1.2rem; font-weight:bold; color:white'>{}</div>
            <div style='font-size:0.7rem; color:#555'>conversations</div>
        </div>
        <div style='text-align:center'>
            <div style='font-size:1.2rem; font-weight:bold; color:white'>{:,}</div>
            <div style='font-size:0.7rem; color:#555'>messages</div>
        </div>
        <div style='text-align:center'>
            <div style='font-size:1.2rem; font-weight:bold; color:white'>{}K</div>
            <div style='font-size:0.7rem; color:#555'>characters</div>
        </div>
        <div style='text-align:center'>
            <div style='font-size:1.2rem; font-weight:bold; color:white'>6</div>
            <div style='font-size:0.7rem; color:#555'>regions</div>
        </div>
    </div>
</div>
""".format(
    len(chats),
    sum(c['num_messages'] for c in chats),
    sum(c['char_count'] for c in chats)//1000
), unsafe_allow_html=True)

# ── Context Blend Panel ──────────────────────────────────────────────────
blend_col, map_col, list_col = st.columns([1, 3, 1])

with blend_col:
    st.markdown("### 🔀 Context Blender")
    st.markdown("<p style='color:#888;font-size:0.85rem'>Select conversations from the list, then blend them into a single Claude context.</p>", unsafe_allow_html=True)

    # Build lookup
    chat_lookup = {c['id']: c for c in chats}

    # Multi-select picker
    all_titles = {c['id']: c['title'] for c in chats}
    selected = st.multiselect(
        "Add conversations to blend:",
        options=list(all_titles.keys()),
        format_func=lambda x: all_titles[x][:50],
        default=st.session_state.selected_ids,
        max_selections=4,
        key="blend_selector"
    )
    st.session_state.selected_ids = selected

    if selected:
        st.markdown(f"**{len(selected)} conversation(s) selected:**")
        total_msgs = sum(chat_lookup[sid]['num_messages'] for sid in selected if sid in chat_lookup)
        st.markdown(f"<p style='color:#888;font-size:0.8rem'>~{total_msgs} messages of combined context</p>", unsafe_allow_html=True)

        for sid in selected:
            if sid in chat_lookup:
                c = chat_lookup[sid]
                emoji = REGION_EMOJI.get(c['region'], "⚪")
                st.markdown(f"{emoji} **{c['title'][:45]}**")
                st.markdown(f"<p style='color:#666;font-size:0.75rem'>{c['region']} · {c['num_messages']} msgs</p>", unsafe_allow_html=True)

        st.markdown("---")

        # Custom prompt
        custom_prompt = st.text_area(
            "Your opening message:",
            placeholder="What would you like to explore across these conversations?",
            height=100,
            key="blend_prompt"
        )

        # Blend button
        if st.button("🔀 Blend & Open in Claude", type="primary", use_container_width=True):
            
            with st.spinner("Extracting intelligence from conversations..."):
                import anthropic
                import os
                
                client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
                
                smart_summaries = []
                
                for sid in selected:
                    if sid not in chat_lookup or sid not in full_texts:
                        continue
                    
                    c = chat_lookup[sid]
                    raw_text = full_texts[sid]
                    
                    # Extract only human messages for cleaner context
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
                    
                    extraction_prompt = f"""You are extracting the key intelligence from a past conversation to use as context in a new chat.

Conversation title: "{c['title']}"
Date: {c['created_at'][:10]}
Total messages: {c['num_messages']}

Here are the human's messages from this conversation:
{human_text}

Extract and summarize in this exact format:

CORE TOPIC: (one sentence — what was this conversation fundamentally about?)

KEY GOALS: (what was the person trying to achieve? bullet points)

IMPORTANT DECISIONS/OUTPUTS: (what was decided, written, built, or concluded? bullet points)

OPEN THREADS: (what questions or ideas came up but weren't fully resolved? bullet points)

RELEVANT CONTEXT: (any background facts about the person that emerged — skills, situation, constraints, preferences)

Be specific and concrete. Use the person's actual words and details where possible. Do not be vague."""

                    response = client.messages.create(
                        model="claude-opus-4-5",
                        max_tokens=600,
                        messages=[{"role": "user", "content": extraction_prompt}]
                    )
                    
                    summary = response.content[0].text
                    smart_summaries.append({
                        "title": c['title'],
                        "date": c['created_at'][:10],
                        "messages": c['num_messages'],
                        "summary": summary
                    })

            # Build blended context from smart summaries
            context_block = ""
            for s in smart_summaries:
                context_block += f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PAST CONVERSATION: {s['title']}
Date: {s['date']} | {s['messages']} messages
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{s['summary']}

"""

            user_message = custom_prompt.strip() if custom_prompt.strip() else \
                "Based on the context from these past conversations, what connections, patterns, or next steps do you see?"

            full_message = f"""I'm sharing intelligently extracted context from {len(selected)} past conversations I've had with Claude. Each has been summarized to capture the key substance — my goals, decisions made, and open threads.

{context_block}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MY QUESTION: {user_message}"""

            encoded = urllib.parse.quote(full_message)
            claude_url = f"https://claude.ai/new?q={encoded}"

            st.markdown(f"""
            <a href="{claude_url}" target="_blank" style="
                display:block;
                background:#7c3aed;
                color:white;
                text-align:center;
                padding:12px;
                border-radius:8px;
                text-decoration:none;
                font-weight:bold;
                margin-top:8px;
            ">✨ Open Blended Chat in Claude →</a>
            """, unsafe_allow_html=True)

            st.success(f"✓ Extracted intelligence from {len(smart_summaries)} conversations")

            for s in smart_summaries:
                with st.expander(f"📋 Extracted: {s['title'][:40]}"):
                    st.text(s['summary'])

    else:
        st.markdown("""
        <div style='background:#1a1a2e;border-radius:8px;padding:16px;border:1px dashed #333;text-align:center;color:#555'>
            <div style='font-size:2rem'>🔀</div>
            <p>Select 2–4 conversations above to blend their context into a single Claude chat</p>
        </div>
        """, unsafe_allow_html=True)

        st.markdown("**Ideas for blending:**")
        st.markdown("""
        <ul style='color:#888;font-size:0.85rem'>
        <li>Your transfer essays + career chats → "How does my academic story connect to my career goals?"</li>
        <li>Houston research + F1 strategy → "What analytical patterns appear across both?"</li>
        <li>Multiple essay drafts → "What themes run through all my writing?"</li>
        </ul>
        """, unsafe_allow_html=True)

with map_col:
    if DEMO_MODE:
        region_options = ["All Regions", "Academic Writing", "Business & Economics",
                          "Software Engineering", "Machine Learning & AI",
                          "Data Science", "Research & Communication"]
        region_centers = {
            "Academic Writing":         (180, 850, "#FF4444"),
            "Business & Economics":     (450, 240, "#FFD700"),
            "Software Engineering":     (870, 200, "#00BFFF"),
            "Machine Learning & AI":    (720, 600, "#00FF88"),
            "Data Science":             (250, 570, "#FF8C00"),
            "Research & Communication": (560, 650, "#DA70D6"),
        }
    else:
        region_options = ["All Regions", "Transfer Applications", "Economics & History",
                          "Coding & C++", "AI & Career", "Research & Science", "Creative & Writing"]
        region_centers = {
            "Transfer Applications": (180, 850, "#FF4444"),
            "Economics & History":   (450, 240, "#FFD700"),
            "Coding & C++":          (870, 200, "#00BFFF"),
            "AI & Career":           (720, 600, "#00FF88"),
            "Research & Science":    (250, 570, "#FF8C00"),
            "Creative & Writing":    (560, 650, "#DA70D6"),
        }

    region_filter = st.selectbox("🔍 Filter by region", region_options)

    filtered = chats if region_filter == "All Regions" else [c for c in chats if c['region'] == region_filter]

    fig = go.Figure()

    if region_filter == "All Regions":
        for name, (cx, cy, col) in region_centers.items():
            fig.add_shape(type="circle",
                xref="x", yref="y",
                x0=cx-140, y0=cy-140, x1=cx+140, y1=cy+140,
                fillcolor=col, opacity=0.05,
                line=dict(color=col, width=1, dash="dot")
            )
            fig.add_annotation(x=cx, y=cy+150,
                text=name.upper(),
                showarrow=False,
                font=dict(size=9, color=col, family="monospace"),
                opacity=0.5
            )

    regions_seen = {}
    for chat in filtered:
        r = chat['region']
        is_selected = chat['id'] in st.session_state.selected_ids
        if r not in regions_seen:
            regions_seen[r] = {
                "x": [], "y": [], "text": [], "size": [],
                "color": [], "symbol": []
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
            f"{'⭐ SELECTED FOR BLEND' if is_selected else ''}"
            f"<br><i>{chat['preview'][:120]}...</i>"
        )
        regions_seen[r]["text"].append(hover)

    for region_name, data in regions_seen.items():
        fig.add_trace(go.Scatter(
            x=data["x"],
            y=data["y"],
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
        height=500,
        margin=dict(l=0, r=0, t=10, b=0),
        legend=dict(bgcolor="#111", bordercolor="#333",
                    font=dict(color="#aaa", size=10), x=0.01, y=0.99),
        hoverlabel=dict(bgcolor="#1a1a2e", font_size=12, font_family="monospace"),
        autosize=True,
    )

    st.plotly_chart(fig, use_container_width=True)
    st.caption(f"Showing {len(filtered)} conversations · Hover for details · Stars = selected for blending")
# ── Time Slider ─────────────────────────────────────────────────────
    st.markdown("---")
    st.markdown("### ⏳ Time Machine — Watch Your World Grow")
    st.markdown("<p style='color:#888;font-size:0.85rem'>Slide to see which conversations existed at any point in time</p>", unsafe_allow_html=True)

    # Get all dates
    from datetime import datetime, date
    import re

    all_dates = []
    for chat in chats:
        try:
            d = datetime.fromisoformat(chat['created_at'].replace('Z', '+00:00')).date()
            all_dates.append(d)
        except:
            pass

    if all_dates:
        min_date = min(all_dates)
        max_date = max(all_dates)

        # Build list of months between min and max
        months = []
        current = date(min_date.year, min_date.month, 1)
        end = date(max_date.year, max_date.month, 1)
        while current <= end:
            months.append(current)
            # Advance one month
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
        # Include all chats up to end of selected month
        if selected_cutoff.month == 12:
            cutoff_end = date(selected_cutoff.year + 1, 1, 1)
        else:
            cutoff_end = date(selected_cutoff.year, selected_cutoff.month + 1, 1)

        # Filter chats that existed by this date
        time_filtered = []
        for chat in filtered:
            try:
                chat_date = datetime.fromisoformat(chat['created_at'].replace('Z', '+00:00')).date()
                if chat_date < cutoff_end:
                    time_filtered.append(chat)
            except:
                pass

        # New chats this month
        new_this_month = [c for c in time_filtered
            if datetime.fromisoformat(c['created_at'].replace('Z', '+00:00')).date() >= selected_cutoff
            and datetime.fromisoformat(c['created_at'].replace('Z', '+00:00')).date() < cutoff_end]

        # Stats row
        t1, t2, t3 = st.columns(3)
        t1.metric("Conversations by this date", len(time_filtered))
        t2.metric("New this month", len(new_this_month))
        t3.metric("Total messages", sum(c['num_messages'] for c in time_filtered))

        # Build time-filtered map
        time_fig = go.Figure()

        # Region halos
        if region_filter == "All Regions":
            for name, (cx, cy, col) in region_centers.items():
                time_fig.add_shape(type="circle",
                    xref="x", yref="y",
                    x0=cx-140, y0=cy-140, x1=cx+140, y1=cy+140,
                    fillcolor=col, opacity=0.04,
                    line=dict(color=col, width=1, dash="dot")
                )

        # Dots — dim old ones, highlight new ones
        regions_time = {}
        for chat in time_filtered:
            r = chat['region']
            chat_date = datetime.fromisoformat(chat['created_at'].replace('Z', '+00:00')).date()
            is_new = chat_date >= selected_cutoff and chat_date < cutoff_end

            if r not in regions_time:
                regions_time[r] = {
                    "x": [], "y": [], "text": [], "size": [],
                    "color": [], "opacity": []
                }

            regions_time[r]["x"].append(chat['x'])
            regions_time[r]["y"].append(1000 - chat['y'])
            regions_time[r]["size"].append(chat['size'] + (6 if is_new else 0))
            regions_time[r]["color"].append(chat['color'])
            regions_time[r]["opacity"].append(1.0 if is_new else 0.35)

            label = "🆕 NEW" if is_new else ""
            hover = (
                f"<b>{chat['title']}</b> {label}<br>"
                f"Added: {chat['created_at'][:10]}<br>"
                f"Messages: {chat['num_messages']}"
            )
            regions_time[r]["text"].append(hover)

        for region_name, data in regions_time.items():
            region_color = next(
                (col for n, (cx, cy, col) in region_centers.items() if n == region_name),
                "#ffffff"
            )
            time_fig.add_trace(go.Scatter(
                x=data["x"],
                y=data["y"],
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

        # New this month — add a ring highlight
        for chat in new_this_month:
            time_fig.add_trace(go.Scatter(
                x=[chat['x']],
                y=[1000 - chat['y']],
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
            xaxis=dict(range=[0, 1000], showgrid=True, gridcolor="#1a1a2e",
                       zeroline=False, showticklabels=False),
            yaxis=dict(range=[0, 1000], showgrid=True, gridcolor="#1a1a2e",
                       zeroline=False, showticklabels=False),
            height=480,
            margin=dict(l=0, r=0, t=10, b=0),
            legend=dict(bgcolor="#111", bordercolor="#333",
                        font=dict(color="#aaa", size=10), x=0.01, y=0.99),
            hoverlabel=dict(bgcolor="#1a1a2e", font_size=12, font_family="monospace"),
            autosize=True,
        )

        st.plotly_chart(time_fig, use_container_width=True)

        # New conversations this month list
        if new_this_month:
            st.markdown(f"**🆕 New in {month_labels[selected_month_idx]}:**")
            for c in new_this_month:
                emoji = REGION_EMOJI.get(c['region'], "⚪")
                st.markdown(f"{emoji} **{c['title']}** — {c['num_messages']} messages")
        else:
            st.markdown(f"*No new conversations in {month_labels[selected_month_idx]}*")

with list_col:
    st.markdown("### Conversations")
    sort_by = st.selectbox("Sort", ["Most Recent", "Most Messages", "Alphabetical"])

    display = sorted(filtered,
        key=lambda x: x['created_at'] if sort_by == "Most Recent"
                 else -x['num_messages'] if sort_by == "Most Messages"
                 else x['title'],
        reverse=(sort_by == "Most Recent")
    )

    for d in display[:20]:
        is_sel = d['id'] in st.session_state.selected_ids
        emoji = REGION_EMOJI.get(d['region'], "⚪")
        prefix = "⭐ " if is_sel else ""
        with st.expander(f"{prefix}{emoji} {d['title'][:35]}"):
            st.markdown(f"**{d['num_messages']} msgs** · {d['created_at'][:10]}")
            st.markdown(f"[Open in Claude ↗](https://claude.ai/chat/{d['id']})")