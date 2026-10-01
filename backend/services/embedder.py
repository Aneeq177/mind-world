from functools import lru_cache

import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer
import umap
import hdbscan as hdbscan_lib


@lru_cache(maxsize=1)
def get_embedding_model() -> SentenceTransformer:
    """Process-wide shared embedding model. Loading takes seconds — construct
    once and reuse across requests instead of per-call."""
    return SentenceTransformer('all-MiniLM-L6-v2')


def build_text(row):
    title = str(row['name']) if pd.notna(row['name']) else 'Untitled'
    text = str(row['full_text'])[:500] if pd.notna(row['full_text']) else ''
    return f"{title}. {text}"

def embed_and_position(df: pd.DataFrame) -> tuple[list[dict], np.ndarray]:
    texts = [build_text(row) for _, row in df.iterrows()]

    model = get_embedding_model()
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

    def normalize(arr, lo=50, hi=950):
        mn, mx = arr.min(), arr.max()
        return (arr - mn) / (mx - mn + 1e-8) * (hi - lo) + lo

    x = normalize(coords[:, 0])
    y = normalize(coords[:, 1])

    result = []
    for i, (_, row) in enumerate(df.iterrows()):
        result.append({
            'id': str(row['uuid']),
            'title': str(row['name']),
            'created_at': str(row['created_at']),
            'updated_at': str(row['updated_at']),
            'num_messages': int(row['num_messages']),
            'char_count': int(row['char_count']),
            'x': float(x[i]),
            'y': float(y[i]),
            'preview': str(row['full_text'])[:300],
            'full_text': str(row['full_text']),
            'source': str(row.get('source', 'claude')),
            'cluster_id': int(cluster_labels[i]),
            'region': '',
            'color': ''
        })
    return result, embeddings

def embed_single(text: str):
    model = get_embedding_model()
    embedding = model.encode([text])[0]
    return embedding
