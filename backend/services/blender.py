import anthropic
import urllib.parse
import os

PALETTE = [
    "#FF4444", "#FFD700", "#00BFFF", "#00FF88", "#FF8C00",
    "#DA70D6", "#FF69B4", "#7CFC00", "#FF6347", "#40E0D0",
    "#9370DB", "#F0E68C", "#87CEEB", "#DDA0DD", "#98FB98",
    "#F4A460", "#B0C4DE", "#FFB6C1", "#FFDAB9", "#E0FFFF"
]

def label_clusters(chats: list[dict], api_key: str) -> list[dict]:
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

Give a single short label (2-4 words max) describing what connects these.
Respond with ONLY the label, nothing else."""

            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=20,
                messages=[{"role": "user", "content": prompt}]
            )
            cluster_labels[cid] = response.content[0].text.strip()
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

def blend_conversations(
    selected_chats: list[dict],
    question: str,
    api_key: str
) -> dict:
    client = anthropic.Anthropic(api_key=api_key)
    summaries = []

    for chat in selected_chats:
        raw_text = chat.get('full_text', '')
        lines = raw_text.split('\n')
        human_lines = []
        capture = False
        for line in lines:
            if line.strip().startswith('[human]') or \
               line.strip().startswith('[user]'):
                capture = True
                human_lines.append(
                    line.replace('[human]', '').replace('[user]', '').strip()
                )
            elif line.strip().startswith('[assistant]'):
                capture = False
            elif capture and line.strip():
                human_lines.append(line.strip())

        human_text = '\n'.join(human_lines)[:4000]

        prompt = f"""Extract key intelligence from this conversation for use as context.

Conversation: "{chat['title']}"
Date: {chat['created_at'][:10]} | Messages: {chat['num_messages']}

Human messages:
{human_text}

Summarize in this format:

CORE TOPIC: (one sentence)
KEY GOALS: (bullet points)
IMPORTANT OUTPUTS: (what was decided or built)
OPEN THREADS: (unresolved questions)
RELEVANT CONTEXT: (background facts that emerged)

Be specific. Use the person's actual words where possible."""

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )
        summaries.append({
            "title": chat['title'],
            "date": chat['created_at'][:10],
            "summary": response.content[0].text
        })

    context_block = ""
    for s in summaries:
        context_block += f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PAST CONVERSATION: {s['title']}
Date: {s['date']}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{s['summary']}

"""

    user_message = question.strip() if question.strip() else \
        "Based on these past conversations, what connections or next steps do you see?"

    full_message = f"""I'm sharing context from {len(selected_chats)} past conversations.

{context_block}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MY QUESTION: {user_message}"""

    encoded = urllib.parse.quote(full_message)
    return {
        "claude_url": f"https://claude.ai/new?q={encoded}",
        "chatgpt_url": f"https://chatgpt.com/?q={encoded}",
        "summaries": summaries
    }
