"""Retrieval evaluation: does Improve pull the RIGHT past conversations?

improve_eval.py judges prompt quality. This judges retrieval: for hand-labeled
drafts, did the conversations that should come back actually come back, and
how much unrelated material got pulled in alongside them.

Inputs:
  corpus.json  - the file from the extension's "Export my data" button
                 (uses its `conversations` list: id, title, preview, full_text).
                 Private; gitignored.
  cases.json   - labeled drafts. Each case:
                   id, draft, category (shallow|deep|deep_titled|vague|no_match;
                   deep_titled = evidence is deep but the title names the topic),
                   relevant [conv ids that should come back],
                   acceptable [related ids that don't count as noise],
                   evidence {conv_id: quote} - offset is checked for deep cases

Stages measured per draft:
  vector_top5   what /search returns (pgvector cosine top 5)
  vector_top15  the candidate pool Improve hands to the reranker
  rerank_top5   what /engineer_prompt actually uses (Haiku rerank of top 15)

Metrics:
  hit_rate@5      answerable drafts with >=1 relevant conversation in the top 5
  unrelated_rate  returned results that are neither relevant nor acceptable
  no_match_fp     no-match drafts that returned anything at all
  recall@15       answerable drafts with a relevant conversation in the top 15
  mrr             mean reciprocal rank of the first relevant hit

Run:
  python backend/evals/retrieval/retrieval_eval.py --out results/before.json
  python backend/evals/retrieval/retrieval_eval.py --no-rerank      # free, embeddings only
  python backend/evals/retrieval/retrieval_eval.py --check          # validate cases only
  python backend/evals/retrieval/retrieval_eval.py --compare results/before.json results/after.json
  python backend/evals/retrieval/retrieval_eval.py --public results/before.json summaries/before.json
  python backend/evals/retrieval/retrieval_eval.py --strategy live --email you@x.com --allow-problems
      # the production pipeline against your Supabase data (keyword search runs
      # in Postgres, so this is the only way to measure it); add --no-keywords
      # for a vector-only comparison on the same data
Rerank needs ANTHROPIC_API_KEY (repo-root .env); ~25 Haiku calls per run.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))
load_dotenv(REPO_ROOT / ".env")

TOP_K = 5
CANDIDATE_K = 15


# ---------------------------------------------------------------------------
# Retrieval strategies. Each is (index_fn, retrieve_fn). Add new ones here and
# select with --strategy so before/after run through identical scoring.
# ---------------------------------------------------------------------------

def _model():
    from services.embedder import get_embedding_model
    return get_embedding_model()


def baseline_embed_text(conv: dict) -> str:
    # Mirrors save_conversation / build_text: title + first 500 chars.
    return f"{conv.get('title') or 'Untitled'}. {(conv.get('full_text') or '')[:500]}"


def index_baseline(corpus: list[dict]) -> np.ndarray:
    texts = [baseline_embed_text(c) for c in corpus]
    return _model().encode(texts, normalize_embeddings=True, show_progress_bar=False)


def retrieve_baseline(draft: str, index: np.ndarray, corpus: list[dict], k: int) -> list[dict]:
    q = _model().encode([draft], normalize_embeddings=True)[0]
    sims = index @ q
    order = np.argsort(-sims)[:k]
    return [
        {
            "id": corpus[i]["id"],
            "title": corpus[i].get("title") or "Untitled",
            "preview": corpus[i].get("preview") or (corpus[i].get("full_text") or "")[:300],
            "created_at": corpus[i].get("created_at"),
            "similarity": float(sims[i]),
        }
        for i in order
    ]


def index_chunked(corpus: list[dict]) -> dict:
    # Mirrors index_conversation_chunks: overlapping spans of full_text, each
    # embedded with the conversation title in front.
    from services.chunker import chunk_embed_inputs, chunk_spans
    owners, spans, inputs = [], [], []
    for i, conv in enumerate(corpus):
        text = conv.get("full_text") or conv.get("preview") or ""
        conv_spans = chunk_spans(text)
        owners += [i] * len(conv_spans)
        spans += conv_spans
        inputs += chunk_embed_inputs(conv.get("title") or "Untitled", text, conv_spans)
    emb = _model().encode(inputs, normalize_embeddings=True, batch_size=64, show_progress_bar=False)
    print(f"  {len(inputs)} chunks", flush=True)
    return {"emb": emb, "owners": owners, "spans": spans}


def retrieve_chunked(draft: str, index: dict, corpus: list[dict], k: int) -> list[dict]:
    # Mirrors retrieve_candidates: top chunks -> group by conversation.
    from services.retrieval import CHUNK_CANDIDATES, group_chunk_hits
    q = _model().encode([draft], normalize_embeddings=True)[0]
    sims = index["emb"] @ q
    hits = []
    for j in np.argsort(-sims)[:CHUNK_CANDIDATES]:
        conv = corpus[index["owners"][j]]
        s, e = index["spans"][j]
        text = conv.get("full_text") or conv.get("preview") or ""
        hits.append({
            "conversation_id": conv["id"],
            "title": conv.get("title") or "Untitled",
            "preview": conv.get("preview") or text[:300],
            "created_at": conv.get("created_at"),
            "similarity": float(sims[j]),
            "start_char": s,
            "end_char": e,
            "chunk_text": text[s:e],
        })
    return group_chunk_hits(hits)[:k]


def retrieve_chunked_cutoff(draft: str, index: dict, corpus: list[dict], k: int) -> list[dict]:
    # Mirrors production retrieve_candidates: chunked + relevance cutoff.
    from services.retrieval import CHUNK_CANDIDATES, apply_relevance_cutoff
    # Every grouped conversation goes through the cutoff before slicing, as in production.
    return apply_relevance_cutoff(retrieve_chunked(draft, index, corpus, CHUNK_CANDIDATES))[:k]


def _chunk_hits_for(query_vec: np.ndarray, index: dict, corpus: list[dict]) -> list[dict]:
    from services.retrieval import CHUNK_CANDIDATES
    sims = index["emb"] @ query_vec
    hits = []
    for j in np.argsort(-sims)[:CHUNK_CANDIDATES]:
        conv = corpus[index["owners"][j]]
        s, e = index["spans"][j]
        text = conv.get("full_text") or conv.get("preview") or ""
        hits.append({
            "conversation_id": conv["id"], "chunk_index": int(j), "start_char": s, "end_char": e,
            "title": conv.get("title") or "Untitled", "created_at": conv.get("created_at"),
            "preview": conv.get("preview") or text[:300], "similarity": float(sims[j]),
            "chunk_text": text[s:e],
        })
    return hits


def retrieve_chunked_routed(draft: str, index: dict, corpus: list[dict], k: int) -> list[dict]:
    # Mirrors production with no profile: about-me drafts search with rewritten
    # queries and the looser floor; others are chunked_cutoff. Vector only —
    # keyword search runs in Postgres, see the "live" strategy.
    from services.personalization_llm import rewrite_about_me_queries_llm
    from services.query_intent import is_about_me
    from services.retrieval import (
        ABOUT_ME_MIN_SIMILARITY, ABOUT_ME_PER_QUERY, group_chunk_hits, merge_hybrid,
    )
    if not is_about_me(draft):
        return retrieve_chunked_cutoff(draft, index, corpus, k)
    queries = [draft, *rewrite_about_me_queries_llm(draft)]
    vecs = _model().encode(queries, normalize_embeddings=True)
    lists = [group_chunk_hits(_chunk_hits_for(v, index, corpus)) for v in vecs]
    return merge_hybrid(lists, [], min_similarity=ABOUT_ME_MIN_SIMILARITY,
                        per_list_cap=ABOUT_ME_PER_QUERY)[:k]


def index_live(corpus: list[dict]) -> dict:
    # Production data for --email; nothing is indexed locally.
    import os
    from services.database import get_supabase
    email = os.environ.get("MW_EVAL_EMAIL", "").strip().lower()
    if not email:
        sys.exit("--strategy live needs --email (the account whose data matches the corpus).")
    os.environ["RETRIEVAL_MODE"] = "chunked"
    sb = get_supabase()
    rows = sb.table("users").select("id").eq("email", email).limit(1).execute().data
    if not rows:
        sys.exit(f"No user with email {email}.")
    user_id = rows[0]["id"]
    ids = [c["id"] for c in corpus]
    found = set()
    for i in range(0, len(ids), 200):
        res = sb.table("knowledge_nodes").select("id").eq("user_id", user_id).in_("id", ids[i:i + 200]).execute()
        found |= {r["id"] for r in res.data or []}
    print(f"  live: {len(found)}/{len(ids)} corpus conversations exist in production", flush=True)
    if os.environ.get("MW_EVAL_NO_KEYWORDS"):
        import services.database as db
        db.search_keyword_chunks = lambda *a, **k: []
        print("  live: keyword search disabled (ablation)", flush=True)
    return {"user_id": user_id}


def retrieve_live(draft: str, index: dict, corpus: list[dict], k: int) -> list[dict]:
    # The production pipeline (keyword + vector, about-me routing with no profile).
    from services.retrieval import memory_route, retrieve_about_me, retrieve_candidates
    emb = _model().encode([draft])[0]
    stats: dict = {}
    if memory_route(draft, None) == "rewrite":
        out = retrieve_about_me(index["user_id"], draft, emb, k, stats=stats)
    else:
        out = retrieve_candidates(index["user_id"], emb, k, query_text=draft, stats=stats)
    index.setdefault("retrieval_stats", []).append(stats)
    if stats.get("fallback"):
        print(f"  WARNING fell back to conversation search ({stats['fallback']}): {stats.get('error')}",
              flush=True)
    for c in out:
        c["title"] = c.get("title") or "Untitled"
        c["similarity"] = c["similarity"] if c.get("similarity") is not None else c.get("keyword_score") or 0.0
    return out


STRATEGIES = {
    "baseline": (index_baseline, retrieve_baseline),
    "chunked": (index_chunked, retrieve_chunked),
    "chunked_cutoff": (index_chunked, retrieve_chunked_cutoff),
    "chunked_routed": (index_chunked, retrieve_chunked_routed),
    "live": (index_live, retrieve_live),
}


def rerank(draft: str, candidates: list[dict]) -> list[dict]:
    from services.personalization_llm import rerank_conversations_llm
    return rerank_conversations_llm(draft, candidates, None, TOP_K)


# ---------------------------------------------------------------------------
# Data loading + case validation
# ---------------------------------------------------------------------------

def load_corpus(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    convs = data["conversations"] if isinstance(data, dict) else data
    return [c for c in convs if c.get("id") and (c.get("full_text") or c.get("preview"))]


def load_cases(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["cases"] if isinstance(data, dict) else data


def check_cases(cases: list[dict], corpus: list[dict]) -> list[str]:
    by_id = {c["id"]: c for c in corpus}
    problems = []
    seen = set()
    for case in cases:
        cid = case.get("id")
        if cid in seen:
            problems.append(f"{cid}: duplicate case id")
        seen.add(cid)
        rel, acc = case.get("relevant") or [], case.get("acceptable") or []
        if case.get("category") == "no_match" and rel:
            problems.append(f"{cid}: no_match case lists relevant ids")
        if case.get("category") != "no_match" and not rel:
            problems.append(f"{cid}: answerable case has no relevant ids")
        for conv_id in rel + acc:
            if conv_id not in by_id:
                problems.append(f"{cid}: conversation {conv_id} not in corpus")
        for conv_id, quote in (case.get("evidence") or {}).items():
            text = (by_id.get(conv_id) or {}).get("full_text") or ""
            offset = text.lower().find(quote.lower())
            if offset < 0:
                problems.append(f"{cid}: evidence quote not found in {conv_id}")
            elif str(case.get("category", "")).startswith("deep") and offset < 500:
                problems.append(f"{cid}: labeled deep but evidence is at char {offset}")
    return problems


def evidence_offsets(case: dict, by_id: dict) -> dict:
    out = {}
    for conv_id, quote in (case.get("evidence") or {}).items():
        text = (by_id.get(conv_id) or {}).get("full_text") or ""
        out[conv_id] = text.lower().find(quote.lower())
    return out


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_list(ids: list[str], case: dict) -> dict:
    rel = set(case.get("relevant") or [])
    ok = rel | set(case.get("acceptable") or [])
    first = next((i + 1 for i, x in enumerate(ids) if x in rel), None)
    return {
        "hit": first is not None,
        "rank": first,
        "relevant_found": len(rel & set(ids)),
        "returned": len(ids),
        "unrelated": sum(1 for x in ids if x not in ok),
    }


def aggregate(case_scores: list[tuple[dict, dict]]) -> dict:
    """case_scores: [(case, score_list result)] for one stage."""
    answerable = [(c, s) for c, s in case_scores if c.get("relevant")]
    negatives = [(c, s) for c, s in case_scores if not c.get("relevant")]
    returned = sum(s["returned"] for _, s in case_scores)
    unrelated = sum(s["unrelated"] for _, s in case_scores)
    out = {
        "n_answerable": len(answerable),
        "n_no_match": len(negatives),
        "hit_rate": _ratio(sum(s["hit"] for _, s in answerable), len(answerable)),
        "mrr": _ratio(sum(1 / s["rank"] for _, s in answerable if s["rank"]), len(answerable)),
        "unrelated_rate": _ratio(unrelated, returned),
        "avg_unrelated_per_draft": _ratio(unrelated, len(case_scores)),
    }
    if negatives:
        out["no_match_fp"] = _ratio(sum(s["returned"] > 0 for _, s in negatives), len(negatives))
    return out


def _ratio(a, b):
    return round(a / b, 4) if b else None


def by_category(case_scores: list[tuple[dict, dict]]) -> dict:
    cats = {}
    for c, s in case_scores:
        cats.setdefault(c.get("category", "uncategorized"), []).append((c, s))
    return {cat: aggregate(items) for cat, items in sorted(cats.items())}


def summarize_runs(runs: list[dict]) -> dict:
    keys = runs[0].keys()
    out = {}
    for k in keys:
        vals = [r[k] for r in runs if isinstance(r.get(k), (int, float))]
        if vals and k not in ("n_answerable", "n_no_match"):
            out[k] = {"mean": round(float(np.mean(vals)), 4), "min": min(vals), "max": max(vals)}
        else:
            out[k] = runs[0][k]
    return out


# ---------------------------------------------------------------------------
# Main eval
# ---------------------------------------------------------------------------

def run_eval(args) -> dict:
    corpus = load_corpus(args.corpus)
    cases = load_cases(args.cases)
    by_id = {c["id"]: c for c in corpus}

    problems = check_cases(cases, corpus)
    if problems:
        print("Case problems:\n  " + "\n  ".join(problems))
        if not args.allow_problems:
            sys.exit("Fix cases.json (or pass --allow-problems).")

    index_fn, retrieve_fn = STRATEGIES[args.strategy]
    print(f"indexing {len(corpus)} conversations with strategy={args.strategy}...", flush=True)
    index = index_fn(corpus)

    per_case = []
    v5_scores, v15_scores = [], []
    rerank_runs: list[list[tuple[dict, dict]]] = [[] for _ in range(args.rerank_runs)]

    for case in cases:
        cands = retrieve_fn(case["draft"], index, corpus, CANDIDATE_K)
        v5_ids = [c["id"] for c in cands[:TOP_K]]
        v15_ids = [c["id"] for c in cands]
        s5, s15 = score_list(v5_ids, case), score_list(v15_ids, case)
        v5_scores.append((case, s5))
        v15_scores.append((case, s15))

        row = {
            "id": case["id"],
            "category": case.get("category"),
            "draft": case["draft"],
            "relevant": case.get("relevant") or [],
            "acceptable": case.get("acceptable") or [],
            "evidence_offsets": evidence_offsets(case, by_id),
            "vector_top15": [
                {"id": c["id"], "title": c["title"], "similarity": round(c["similarity"], 4)}
                for c in cands
            ],
            "vector_top5_score": s5,
            "vector_top15_score": s15,
        }

        if args.rerank_runs:
            row["rerank"] = []
            for r in range(args.rerank_runs):
                ids = [c["id"] for c in rerank(case["draft"], cands)]
                s = score_list(ids, case)
                rerank_runs[r].append((case, s))
                row["rerank"].append({"ids": ids, "score": s})
        per_case.append(row)
        print(f"  {case['id']:<24} vec@5={'HIT ' if s5['hit'] else 'miss'}"
              f" vec@15={'HIT ' if s15['hit'] else 'miss'}"
              + (f" rerank={sum(x['score']['hit'] for x in row['rerank'])}/{args.rerank_runs}"
                 if args.rerank_runs else ""), flush=True)

    stages = {
        "vector_top5": {"overall": aggregate(v5_scores), "by_category": by_category(v5_scores)},
        "vector_top15": {"overall": aggregate(v15_scores), "by_category": by_category(v15_scores)},
    }
    if args.rerank_runs:
        stages["rerank_top5"] = {
            "overall": summarize_runs([aggregate(r) for r in rerank_runs]),
            "by_category": {
                cat: summarize_runs([by_category(r)[cat] for r in rerank_runs])
                for cat in by_category(rerank_runs[0])
            },
            "runs": args.rerank_runs,
        }

    meta_extra = {}
    if isinstance(index, dict) and index.get("retrieval_stats"):
        rs = index["retrieval_stats"]
        ms = [s["ms"] for s in rs]
        meta_extra["retrieval"] = {
            "fallbacks": sum(1 for s in rs if s.get("fallback")),
            "keyword_failures": sum(1 for s in rs if s.get("keywords") == "failed"),
            "p50_ms": round(float(np.percentile(ms, 50))),
            "p95_ms": round(float(np.percentile(ms, 95))),
        }
        print(f"\nretrieval: {meta_extra['retrieval']}", flush=True)

    return {
        "meta": {
            **meta_extra,
            "strategy": args.strategy,
            "git_commit": _git_commit(),
            "run_at": datetime.now(timezone.utc).isoformat(),
            "embedding_model": "all-MiniLM-L6-v2",
            "embed_text": _embed_text_label(args.strategy),
            "top_k": TOP_K,
            "candidate_k": CANDIDATE_K,
            "corpus_size": len(corpus),
            "n_cases": len(cases),
        },
        "stages": stages,
        "cases": per_case,
    }


def _embed_text_label(strategy: str) -> str:
    if strategy.startswith("chunked"):
        from services.chunker import CHUNK_OVERLAP, CHUNK_SIZE
        from services.retrieval import CHUNK_CANDIDATES, MAX_GAP_FROM_TOP, MIN_SIMILARITY
        label = (f"title + full_text chunks ({CHUNK_SIZE} chars, {CHUNK_OVERLAP} overlap), "
                 f"top {CHUNK_CANDIDATES} chunks grouped by conversation")
        if strategy in ("chunked_cutoff", "chunked_routed"):
            label += f", cutoff sim>={MIN_SIMILARITY} and within {MAX_GAP_FROM_TOP} of top"
        if strategy == "chunked_routed":
            label += ", about-me drafts use rewritten queries (no profile)"
        return label
    if strategy == "live":
        return "production pipeline: chunk vectors + keyword search, about-me rewrites (no profile)"
    return "title + full_text[:500]"


def _git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"],
                                       cwd=REPO_ROOT, text=True).strip()
    except Exception:
        return "unknown"


def _headline(results: dict) -> dict:
    out = {}
    for stage, data in results["stages"].items():
        o = data["overall"]
        out[stage] = {k: (v["mean"] if isinstance(v, dict) else v) for k, v in o.items()}
    return out


def compare(before_path: Path, after_path: Path):
    before = json.loads(before_path.read_text(encoding="utf-8"))
    after = json.loads(after_path.read_text(encoding="utf-8"))
    hb, ha = _headline(before), _headline(after)
    for stage in hb:
        if stage not in ha:
            continue
        print(f"\n{stage}")
        for k, vb in hb[stage].items():
            va = ha[stage].get(k)
            if isinstance(vb, (int, float)) and isinstance(va, (int, float)) and not k.startswith("n_"):
                print(f"  {k:<26} {vb:>7.3f} -> {va:>7.3f}  ({va - vb:+.3f})")

    a_cases = {c["id"]: c for c in after["cases"]}
    print("\nvector_top5 flips:")
    for c in before["cases"]:
        a = a_cases.get(c["id"])
        if not a:
            continue
        hb_, ha_ = c["vector_top5_score"]["hit"], a["vector_top5_score"]["hit"]
        if hb_ != ha_:
            print(f"  {c['id']:<24} {'hit' if hb_ else 'miss'} -> {'hit' if ha_ else 'miss'}")


def _public_case_id(case: dict) -> str:
    # Case ids name the topic of private chats; publish a stable opaque handle instead.
    digest = hashlib.sha1(case["id"].encode("utf-8")).hexdigest()[:8]
    return f"{case.get('category', 'case')}_{digest}"


def public_summary(results: dict) -> dict:
    """Metrics only: no drafts, titles, conversation ids, evidence, or case names."""
    meta = {k: v for k, v in results["meta"].items()}
    cases = []
    for c in results["cases"]:
        row = {
            "case": _public_case_id(c),
            "category": c.get("category"),
            "n_relevant": len(c.get("relevant") or []),
            "n_acceptable": len(c.get("acceptable") or []),
            "evidence_offsets": sorted(c.get("evidence_offsets", {}).values()),
            "vector_top5": c["vector_top5_score"],
            "vector_top15": c["vector_top15_score"],
            "vector_top5_similarities": [x["similarity"] for x in c["vector_top15"][:TOP_K]],
        }
        if c.get("rerank"):
            row["rerank_top5_runs"] = [r["score"] for r in c["rerank"]]
        cases.append(row)
    return {
        "_readme": "Public summary of a retrieval_eval.py run. Private inputs (corpus, "
                   "drafts, labels) are not included; case handles are hashes of private "
                   "case ids and stay stable across runs.",
        "meta": meta,
        "stages": results["stages"],
        "cases": sorted(cases, key=lambda r: (r["category"] or "", r["case"])),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--corpus", type=Path, default=HERE / "corpus.json")
    p.add_argument("--cases", type=Path, default=HERE / "cases.json")
    p.add_argument("--strategy", choices=sorted(STRATEGIES), default="baseline")
    p.add_argument("--out", type=Path, default=None)
    p.add_argument("--rerank-runs", type=int, default=3)
    p.add_argument("--no-rerank", action="store_true")
    p.add_argument("--check", action="store_true")
    p.add_argument("--allow-problems", action="store_true")
    p.add_argument("--email", default=None, help="account to query for --strategy live")
    p.add_argument("--no-keywords", action="store_true", help="live: vector search only (ablation)")
    p.add_argument("--compare", nargs=2, type=Path, metavar=("BEFORE", "AFTER"))
    p.add_argument("--public", nargs=2, type=Path, metavar=("RESULTS", "OUT"),
                   help="write a shareable copy of RESULTS with private data stripped")
    args = p.parse_args()

    if args.public:
        src, dst = [x if x.is_absolute() else HERE / x for x in args.public]
        summary = public_summary(json.loads(src.read_text(encoding="utf-8")))
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        print(f"saved -> {dst}")
        return
    if args.compare:
        compare(*[x if x.is_absolute() else HERE / x for x in args.compare])
        return
    if args.check:
        problems = check_cases(load_cases(args.cases), load_corpus(args.corpus))
        print("\n".join(problems) if problems else "cases.json OK")
        return
    if args.no_rerank:
        args.rerank_runs = 0
    if args.email:
        import os
        os.environ["MW_EVAL_EMAIL"] = args.email
    if args.no_keywords:
        import os
        os.environ["MW_EVAL_NO_KEYWORDS"] = "1"

    results = run_eval(args)
    print("\n" + json.dumps(_headline(results), indent=2))
    if args.out:
        out = args.out if args.out.is_absolute() else HERE / args.out
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"saved -> {out}")


if __name__ == "__main__":
    main()
