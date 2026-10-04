"""Latency regression check: memory search on long conversations.

Chunk search once took 22.7 s on an account with long imported conversations,
hit the database statement timeout, and Improve silently fell back to the
opening-only search. retrieval_eval.py measures quality and didn't notice.
This times the production search path on long-conversation data and fails if
it's slow or falls back.

Modes:
  --email you@x.com   time searches on an existing account (read-only);
                      --user-id <uuid> does the same by id
  --synthetic         seed a throwaway account with long conversations, time
                      it, then delete it. Writes to the database in
                      SUPABASE_URL; leftovers (if killed mid-run) belong to
                      users whose email starts with "latency-check+".

Run:
  python backend/evals/retrieval/latency_check.py --synthetic
  python backend/evals/retrieval/latency_check.py --email you@x.com
Exits 1 when any search's p95 exceeds --budget-ms or any search fell back.
"""
import argparse
import os
import sys
import time
import uuid
from pathlib import Path

import numpy as np
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))
load_dotenv(REPO_ROOT / ".env")
os.environ["RETRIEVAL_MODE"] = "chunked"

DRAFTS = [
    "help me debug this python error in my fastapi app",
    "plan 2 days in new york",
    "write a cover letter for a software engineering internship",
    "explain how pgvector indexes work",
    "what should I cook for dinner this week",
    "review my resume bullet points",
    "how do I fix CrashLoopBackOff in kubernetes",
    "summarize the pros and cons of a masters degree",
    "draft an email asking my professor for a recommendation letter",
    "set up a chrome extension with manifest v3",
]

COMMON_WORDS = (
    "the a and to of in is it you that for on with as this be are was can I my "
    "your we they have not what how do so but if or will just like about use "
    "code data user error function file app model question answer example"
).split()


def _model():
    from services.embedder import get_embedding_model
    return get_embedding_model()


def _percentile(values: list[float], q: float) -> float:
    return float(np.percentile(values, q)) if values else 0.0


# ---------------------------------------------------------------------------
# Synthetic account
# ---------------------------------------------------------------------------

def _synthetic_text(rng: np.random.Generator, vocab: list[str], n_chars: int) -> str:
    # Zipf-distributed words so keyword search sees realistic term frequencies.
    words = []
    length = 0
    while length < n_chars:
        batch = [vocab[min(i, len(vocab)) - 1] for i in rng.zipf(1.3, 4000)]
        words += batch
        length += sum(len(w) + 1 for w in batch)
    return " ".join(words)[:n_chars]


def seed_synthetic(n_long: int, long_chars: int, n_short: int, short_chars: int) -> str:
    from services.database import get_supabase

    sb = get_supabase()
    user_id = str(uuid.uuid4())
    sb.table("users").insert({
        "id": user_id, "email": f"latency-check+{user_id}@mind-world.invalid", "role": "member",
    }).execute()

    rng = np.random.default_rng(0)
    draft_words = sorted({w for d in DRAFTS for w in d.lower().split()})
    vocab = COMMON_WORDS + draft_words + [f"term{i}" for i in range(20000)]
    sizes = [long_chars] * n_long + [short_chars] * n_short
    try:
        _seed_conversations(sb, user_id, sizes, rng, vocab)
    except BaseException:
        delete_synthetic(user_id)
        raise
    return user_id


def _seed_conversations(sb, user_id: str, sizes: list[int], rng: np.random.Generator, vocab: list[str]) -> None:
    from services.chunker import chunk_spans, text_hash
    from services.database import replace_conversation_chunks

    total_chunks = 0
    started = time.perf_counter()
    for i, size in enumerate(sizes):
        conv_id = f"latency-check-{user_id}-{i}"
        text = _synthetic_text(rng, vocab, size)
        sb.table("knowledge_nodes").insert({
            "id": conv_id, "user_id": user_id, "title": f"Synthetic conversation {i}",
            "full_text": text, "preview": text[:300], "char_count": len(text),
            "num_messages": max(2, size // 2000), "source_app": "latency-check",
            "created_at": "2026-01-01T00:00:00Z",
        }).execute()
        spans = chunk_spans(text)
        # Random unit vectors: timing doesn't depend on what the embeddings mean,
        # and embedding thousands of chunks locally would take minutes.
        emb = rng.standard_normal((len(spans), 384)).astype(np.float32)
        emb /= np.linalg.norm(emb, axis=1, keepdims=True)
        replace_conversation_chunks(conv_id, user_id, text, spans, emb, text_hash(text))
        total_chunks += len(spans)
        print(f"  seeded {i + 1}/{len(sizes)} conversations, {total_chunks} chunks", end="\r", flush=True)
    print(f"\n  seeded {total_chunks} chunks in {time.perf_counter() - started:.0f}s", flush=True)


def delete_synthetic(user_id: str) -> None:
    from services.database import get_supabase
    sb = get_supabase()
    sb.table("knowledge_nodes").delete().eq("user_id", user_id).execute()
    sb.table("users").delete().eq("id", user_id).execute()
    print(f"  deleted synthetic account {user_id}", flush=True)


# ---------------------------------------------------------------------------
# Timing
# ---------------------------------------------------------------------------

def _user_id_for(email: str) -> str:
    from services.database import get_supabase
    rows = get_supabase().table("users").select("id").eq("email", email.strip().lower()).limit(1).execute().data
    if not rows:
        sys.exit(f"No user with email {email}.")
    return rows[0]["id"]


def _account_shape(user_id: str) -> str:
    from services.database import get_supabase
    res = get_supabase().table("conversation_chunks").select("conversation_id", count="exact")\
        .eq("user_id", user_id).limit(1).execute()
    return f"{res.count or 0} chunks"


def time_searches(user_id: str, repeat: int) -> dict:
    from services.database import search_chunks, search_keyword_chunks
    from services.retrieval import CHUNK_CANDIDATES, KEYWORD_CANDIDATES, retrieve_candidates

    embeddings = _model().encode(DRAFTS)
    search_chunks(user_id, embeddings[0], CHUNK_CANDIDATES)  # warm up the connection

    timings: dict[str, list[float]] = {"match_chunks": [], "match_keyword_chunks": [], "retrieve_candidates": []}
    problems: list[str] = []
    for _ in range(repeat):
        for draft, emb in zip(DRAFTS, embeddings):
            t = time.perf_counter()
            try:
                search_chunks(user_id, emb, CHUNK_CANDIDATES)
            except Exception as exc:
                problems.append(f"match_chunks failed on {draft!r}: {exc}")
            timings["match_chunks"].append((time.perf_counter() - t) * 1000)

            t = time.perf_counter()
            try:
                search_keyword_chunks(user_id, draft, emb, KEYWORD_CANDIDATES)
            except Exception as exc:
                problems.append(f"match_keyword_chunks failed on {draft!r}: {exc}")
            timings["match_keyword_chunks"].append((time.perf_counter() - t) * 1000)

            stats: dict = {}
            retrieve_candidates(user_id, emb, 15, query_text=draft, stats=stats)
            timings["retrieve_candidates"].append(stats["ms"])
            if stats["search"] != "chunks" or stats["keywords"] != "used":
                problems.append(
                    f"retrieve_candidates degraded on {draft!r}: search={stats['search']} "
                    f"fallback={stats['fallback']} keywords={stats['keywords']} error={stats.get('error')}"
                )
    return {"timings": timings, "problems": problems}


def report(result: dict, budget_ms: float) -> bool:
    ok = True
    print(f"\n{'search':<22}{'p50 ms':>9}{'p95 ms':>9}{'max ms':>9}   budget p95 <= {budget_ms:.0f} ms")
    for name, values in result["timings"].items():
        p50, p95, mx = _percentile(values, 50), _percentile(values, 95), max(values)
        over = p95 > budget_ms
        ok &= not over
        print(f"{name:<22}{p50:>9.0f}{p95:>9.0f}{mx:>9.0f}   {'FAIL' if over else 'ok'}")
    for p in result["problems"]:
        print(f"FAIL {p}")
    ok &= not result["problems"]
    print("\nPASS" if ok else "\nFAIL")
    return ok


def main():
    p = argparse.ArgumentParser()
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--email", help="time searches on this existing account (read-only)")
    mode.add_argument("--user-id", help="like --email, by user id")
    mode.add_argument("--synthetic", action="store_true", help="seed, time, and delete a throwaway account")
    p.add_argument("--budget-ms", type=float, default=1500, help="max allowed p95 per search")
    p.add_argument("--repeat", type=int, default=2, help="passes over the drafts")
    p.add_argument("--long", type=int, default=3, help="synthetic: number of long conversations")
    p.add_argument("--long-chars", type=int, default=800_000)
    p.add_argument("--short", type=int, default=150, help="synthetic: number of ordinary conversations")
    p.add_argument("--short-chars", type=int, default=20_000)
    args = p.parse_args()

    if args.email or args.user_id:
        user_id = args.user_id or _user_id_for(args.email)
        print(f"timing account {args.email or user_id} ({_account_shape(user_id)})", flush=True)
        ok = report(time_searches(user_id, args.repeat), args.budget_ms)
    else:
        print(f"seeding synthetic account: {args.long} x {args.long_chars:,} chars "
              f"+ {args.short} x {args.short_chars:,} chars", flush=True)
        user_id = seed_synthetic(args.long, args.long_chars, args.short, args.short_chars)
        try:
            ok = report(time_searches(user_id, args.repeat), args.budget_ms)
        finally:
            delete_synthetic(user_id)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
