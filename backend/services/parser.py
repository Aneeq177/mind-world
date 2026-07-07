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
                    created_at = datetime.fromtimestamp(
                        float(create_time)).isoformat()
                    updated_at = datetime.fromtimestamp(
                        float(update_time)).isoformat()
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
                    'full_text': full_text[:8000],
                    'source': 'chatgpt'
                })
    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values('created_at').reset_index(drop=True)
    return df
