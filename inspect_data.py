import json
import os
import zipfile
from datetime import datetime

ZIP_PATH = 'conversations.json'

if zipfile.is_zipfile(ZIP_PATH):
    with zipfile.ZipFile(ZIP_PATH) as z:
        with z.open('conversations.json') as f:
            data = json.load(f)
else:
    with open(ZIP_PATH, 'r', encoding='utf-8-sig', errors='replace') as f:
        data = json.load(f)

# Handle both list and dict formats
convos = data if isinstance(data, list) else data.get('conversations', [])

print(f"Total conversations: {len(convos)}")
print(f"File size: {os.path.getsize('conversations.json') / 1024 / 1024:.1f} MB")

# Show structure of first conversation
print("\n--- FIRST CONVERSATION STRUCTURE ---")
first = convos[0]
print(f"Keys available: {list(first.keys())}")
print(f"\nSample values:")
for key, val in first.items():
    if isinstance(val, str):
        print(f"  {key}: {val[:100]}")
    elif isinstance(val, list):
        print(f"  {key}: [list of {len(val)} items]")
    elif isinstance(val, dict):
        print(f"  {key}: {{dict with keys: {list(val.keys())}}}")
    else:
        print(f"  {key}: {val}")

# Date range
print("\n--- DATE RANGE ---")
dates = []
for c in convos:
    for date_field in ['created_at', 'updated_at', 'timestamp', 'date']:
        if date_field in c:
            try:
                dates.append(c[date_field])
            except:
                pass
if dates:
    print(f"  Earliest: {min(dates)}")
    print(f"  Latest:   {max(dates)}")

# Message count distribution
print("\n--- MESSAGE DEPTH ---")
msg_counts = []
for c in convos:
    for msg_field in ['messages', 'chat_messages', 'turns']:
        if msg_field in c:
            msg_counts.append(len(c[msg_field]))
            break

if msg_counts:
    print(f"  Avg messages per chat: {sum(msg_counts)/len(msg_counts):.1f}")
    print(f"  Longest chat: {max(msg_counts)} messages")
    print(f"  Shortest chat: {min(msg_counts)} messages")
    short = sum(1 for m in msg_counts if m <= 2)
    print(f"  One-off chats (<=2 msgs): {short} ({100*short//len(msg_counts)}%)")

# Preview first 5 titles
print("\n--- FIRST 5 CONVERSATION TITLES ---")
for c in convos[:5]:
    title = c.get('title') or c.get('name') or c.get('subject') or 'Untitled'
    print(f"  • {title}")