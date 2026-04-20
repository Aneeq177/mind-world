import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer
import umap
import json
import os

INPUT_FILE = 'chats_parsed.csv'
OUTPUT_FILE = 'chats_positioned.json'

print("Loading parsed chats...")
df = pd.read_csv(INPUT_FILE)
print(f"Loaded {len(df)} conversations")

# Build embedding text — title + first 500 chars of content
def build_embed_text(row):
    title = str(row['name']) if pd.notna(row['name']) else 'Untitled'
    text = str(row['full_text'])[:500] if pd.notna(row['full_text']) else ''
    return f"{title}. {text}"

print("\nBuilding embedding texts...")
texts = [build_embed_text(row) for _, row in df.iterrows()]

print("Loading embedding model (this takes ~30s first time)...")
model = SentenceTransformer('all-MiniLM-L6-v2')

print("Generating embeddings...")
embeddings = model.encode(texts, show_progress_bar=True)
print(f"Embeddings shape: {embeddings.shape}")

print("\nRunning UMAP to get 2D coordinates...")
reducer = umap.UMAP(
    n_components=2,
    n_neighbors=min(10, len(df) - 1),
    min_dist=0.3,
    metric='cosine',
    random_state=42
)
coords_2d = reducer.fit_transform(embeddings)
print(f"Coordinates shape: {coords_2d.shape}")

# Normalize to 0-1000 range for the canvas
x_min, x_max = coords_2d[:, 0].min(), coords_2d[:, 0].max()
y_min, y_max = coords_2d[:, 1].min(), coords_2d[:, 1].max()

coords_norm = np.zeros_like(coords_2d)
coords_norm[:, 0] = (coords_2d[:, 0] - x_min) / (x_max - x_min) * 900 + 50
coords_norm[:, 1] = (coords_2d[:, 1] - y_min) / (y_max - y_min) * 900 + 50

# Build output
print("\nBuilding output dataset...")
output = []
for i, (_, row) in enumerate(df.iterrows()):
    output.append({
        'id': str(row['uuid']),
        'title': str(row['name']) if pd.notna(row['name']) else 'Untitled',
        'created_at': str(row['created_at']),
        'updated_at': str(row['updated_at']),
        'num_messages': int(row['num_messages']),
        'char_count': int(row['char_count']),
        'x': float(coords_norm[i, 0]),
        'y': float(coords_norm[i, 1]),
        'preview': str(row['full_text'])[:300] if pd.notna(row['full_text']) else ''
    })

with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=2, ensure_ascii=False)

print(f"\nSaved {len(output)} positioned conversations to {OUTPUT_FILE}")
print("\nSample coordinates:")
for item in output[:5]:
    print(f"  {item['title'][:50]:<50} x={item['x']:.1f} y={item['y']:.1f}")