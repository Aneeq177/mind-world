import json
import zipfile
import pandas as pd
from datetime import datetime

INPUT_FILE = 'conversations.json'
OUTPUT_FILE = 'chats_parsed.csv'

if zipfile.is_zipfile(INPUT_FILE):
    with zipfile.ZipFile(INPUT_FILE) as z:
        with z.open('conversations.json') as f:
            data = json.load(f)
else:
    with open(INPUT_FILE, 'r', encoding='utf-8-sig', errors='replace') as f:
        data = json.load(f)

convos = data if isinstance(data, list) else data.get('conversations', [])
print(f"Loaded {len(convos)} conversations")

rows = []
for c in convos:
    uuid = c.get('uuid', '')
    name = c.get('name', 'Untitled') or 'Untitled'
    created = c.get('created_at', '')
    updated = c.get('updated_at', '')
    messages = c.get('chat_messages', [])
    
    # Extract full text content of the conversation
    text_parts = []
    for msg in messages:
        sender = msg.get('sender', 'unknown')
        # Claude exports have 'text' field at top level of message
        content = msg.get('text', '')
        # Some exports have content in a nested structure
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
    
    # Keep only chats with actual content
    if len(full_text.strip()) < 50:
        continue
    
    rows.append({
        'uuid': uuid,
        'name': name,
        'created_at': created,
        'updated_at': updated,
        'num_messages': len(messages),
        'char_count': len(full_text),
        'full_text': full_text
    })

df = pd.DataFrame(rows)
df = df.sort_values('created_at').reset_index(drop=True)

# Truncate full_text to 8000 chars for each row — enough context, keeps file manageable
df['full_text'] = df['full_text'].str[:8000]

df.to_csv(OUTPUT_FILE, index=False)
print(f"\nSaved {len(df)} chats to {OUTPUT_FILE}")
print(f"\nColumn preview:")
print(df[['name', 'num_messages', 'char_count']].head(10).to_string())
print(f"\nTotal chars across all chats: {df['char_count'].sum():,}")