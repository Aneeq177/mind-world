import json
import zipfile
import io
import pandas as pd
from datetime import datetime

def parse_claude(data: dict | list) -> pd.DataFrame:
    convos = data if isinstance(data, list) else data.get('conversations', [])
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
                text_parts.append(f'[{sender}] {content}')
        full_text = '\n\n'.join(text_parts)
        if len(full_text.strip()) < 50:
            continue
        rows.append({
            'uuid': c.get('uuid', ''),
            'name': c.get('name', 'Untitled') or 'Untitled',
            'created_at': c.get('created_at', ''),
            'updated_at': c.get('updated_at', ''),
            'num_messages': len(messages),
            'char_count': len(full_text),
            'full_text': full_text[:8000],
            'source': 'claude'
        })
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values('created_at').reset_index(drop=True)
    return df

MAX_ZIP_EXTRACTED_BYTES = 500 * 1024 * 1024  # 500 MB decompressed safety limit

_CHATGPT_TEXT_CONTENT_TYPES = {"text", "multimodal_text"}


def _chatgpt_thread_nodes(convo: dict) -> list[dict]:
    """Nodes on the branch the user actually sees, oldest first.

    ChatGPT exports store each conversation as a tree in `mapping` (edits and
    regenerations create sibling branches). Dict order is not message order,
    so walk parent links back from `current_node` instead.
    """
    mapping = convo.get("mapping") or {}
    path: list[dict] = []
    seen: set[str] = set()
    node_id = convo.get("current_node")
    while node_id and node_id in mapping and node_id not in seen:
        seen.add(node_id)
        path.append(mapping[node_id])
        node_id = mapping[node_id].get("parent")
    if path:
        path.reverse()
        return path

    # Older exports without current_node: follow the newest child from the root.
    roots = [n for n in mapping.values() if not n.get("parent") or n.get("parent") not in mapping]
    node = roots[0] if roots else None
    while node is not None and node.get("id") not in seen:
        seen.add(node.get("id"))
        path.append(node)
        children = [c for c in (node.get("children") or []) if c in mapping]
        node = mapping[children[-1]] if children else None
    return path


def _chatgpt_messages(convo: dict) -> list[tuple[str, str]]:
    """(role, text) for visible user/assistant turns, in conversation order."""
    out = []
    for node in _chatgpt_thread_nodes(convo):
        msg = node.get("message") or {}
        role = (msg.get("author") or {}).get("role", "")
        if role not in ("user", "assistant"):
            continue
        if (msg.get("metadata") or {}).get("is_visually_hidden_from_conversation"):
            continue
        # Assistant turns addressed to a tool (web search, python, ...) aren't chat.
        if msg.get("recipient") not in (None, "all"):
            continue
        content = msg.get("content") or {}
        if content.get("content_type", "text") not in _CHATGPT_TEXT_CONTENT_TYPES:
            continue
        text = " ".join(
            p for p in (content.get("parts") or [])
            if isinstance(p, str) and p.strip()
        )
        if text.strip():
            out.append((role, text))
    return out


def parse_chatgpt(zip_bytes: bytes) -> pd.DataFrame:
    rows = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        total_uncompressed = sum(info.file_size for info in z.infolist())
        if total_uncompressed > MAX_ZIP_EXTRACTED_BYTES:
            raise ValueError(
                f"Zip archive expands to {total_uncompressed // (1024 * 1024)} MB, "
                "which exceeds the 500 MB safety limit."
            )
        json_files = sorted([
            f for f in z.namelist()
            if f.startswith('conversations') and f.endswith('.json')
        ])
        for json_file in json_files:
            with z.open(json_file) as f:
                convos = json.load(f)
            for c in convos:
                text_parts = [f'[{role}] {text}' for role, text in _chatgpt_messages(c)]
                full_text = '\n\n'.join(text_parts)
                if len(full_text.strip()) < 50:
                    continue
                create_time = c.get('create_time', 0)
                update_time = c.get('update_time', 0)
                try:
                    created_at = datetime.fromtimestamp(
                        float(create_time)).isoformat()
                    updated_at = datetime.fromtimestamp(
                        float(update_time)).isoformat()
                except Exception:
                    created_at = ''
                    updated_at = ''
                rows.append({
                    'uuid': c.get('id') or c.get('conversation_id') or '',
                    'name': c.get('title', 'Untitled') or 'Untitled',
                    'created_at': created_at,
                    'updated_at': updated_at,
                    'num_messages': len(text_parts),
                    'char_count': len(full_text),
                    'full_text': full_text[:8000],
                    'source': 'chatgpt'
                })
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values('created_at').reset_index(drop=True)
    return df
