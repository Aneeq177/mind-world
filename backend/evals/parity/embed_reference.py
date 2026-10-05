"""Server-side reference vectors for the embedding parity gate.

Run from backend/:  python evals/parity/embed_reference.py
Writes evals/parity/embed_reference.json, which tests/js/embed_parity.mjs
compares against the on-device model.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parents[1]))

from services.embedder import get_embedding_model  # noqa: E402


def main() -> None:
    sentences = json.loads((HERE / "sentences.json").read_text(encoding="utf-8"))["sentences"]
    model = get_embedding_model()
    vectors = model.encode(sentences, normalize_embeddings=True, show_progress_bar=False)
    out = {
        "model": "sentence-transformers/all-MiniLM-L6-v2",
        "max_seq_length": model.max_seq_length,
        "vectors": [[round(float(x), 7) for x in v] for v in vectors],
    }
    (HERE / "embed_reference.json").write_text(json.dumps(out), encoding="utf-8")
    print(f"wrote {len(sentences)} vectors (max_seq_length={model.max_seq_length})")


if __name__ == "__main__":
    main()
