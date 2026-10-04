"""Chunk-level retrieval: find matching chunks, rank their conversations, and
build the context excerpt Improve sends to the model."""
import os
import time

import numpy as np

# How many chunks to pull before grouping them into conversations. Several
# chunks usually come from the same conversation, so this must comfortably
# exceed the number of conversations wanted.
CHUNK_CANDIDATES = 60
# Ranking nudge per additional matching chunk in the same conversation.
MULTI_HIT_BONUS = 0.01
MAX_BONUS_HITS = 3
# Text the reranker sees per candidate (its best-matching chunk).
SNIPPET_CHARS = 600
EXCERPT_CHARS = 3000
OPENING_CHARS = 500
EXCERPT_GAP = "\n[...]\n"
# Relevance cutoff on best-chunk similarity, tuned with evals/retrieval. Drafts
# with nothing relevant in memory top out around 0.34; real matches start
# near 0.39. The gap rule trims the weak tail behind a strong match.
MIN_SIMILARITY = 0.36
MAX_GAP_FROM_TOP = 0.25
# "About me" drafts share few words with the conversations holding the facts,
# so their rewritten queries use a looser floor and rely on the reranker.
ABOUT_ME_MIN_SIMILARITY = 0.30
# Best conversations each about-me query may contribute, so a rewrite that
# pinpoints one fact isn't crowded out by matches on generic phrasing.
ABOUT_ME_PER_QUERY = 4
# Keyword search (match_keyword_chunks). keyword_score is the share of the
# draft's rarity-weighted terms a chunk contains, 0..1.
KEYWORD_CANDIDATES = 30
KEYWORD_MIN_SCORE = 0.45
# Short drafts have few distinctive words, so an unrelated chat can contain
# all of them ("2 days in new york" vs a chat about New York internships). A
# keyword match must also be loosely related in meaning to count.
KEYWORD_MIN_SIMILARITY = 0.30
# Keyword rank counts half as much as vector rank when ordering candidates.
KEYWORD_RRF_WEIGHT = 0.5
# Reciprocal rank fusion constant: higher flattens the gap between ranks.
RRF_K = 60


def chunked_retrieval_enabled() -> bool:
    return os.getenv("RETRIEVAL_MODE", "baseline").strip().lower() == "chunked"


def group_chunk_hits(hits: list[dict]) -> list[dict]:
    """Collapse chunk hits into one candidate per conversation.

    Each hit needs conversation_id, similarity, start_char, end_char, and may
    carry chunk_text plus conversation metadata (title, preview, created_at,
    user_id). A conversation is scored by its best chunk, with a small bonus
    when several of its chunks match.
    """
    by_conv: dict[str, dict] = {}
    for hit in sorted(hits, key=lambda h: float(h.get("similarity") or 0.0), reverse=True):
        conv_id = hit.get("conversation_id")
        if not conv_id:
            continue
        sim = float(hit.get("similarity") or 0.0)
        conv = by_conv.get(conv_id)
        if conv is None:
            conv = {
                "id": conv_id,
                "title": hit.get("title") or "Untitled",
                "preview": hit.get("preview") or "",
                "created_at": hit.get("created_at"),
                "user_id": hit.get("user_id"),
                "similarity": sim,
                "snippet": (hit.get("chunk_text") or "")[:SNIPPET_CHARS],
                "matched": [],
            }
            by_conv[conv_id] = conv
        conv["matched"].append({
            "start_char": int(hit.get("start_char") or 0),
            "end_char": int(hit.get("end_char") or 0),
            "similarity": sim,
        })

    for conv in by_conv.values():
        extra = min(len(conv["matched"]) - 1, MAX_BONUS_HITS)
        conv["retrieval_score"] = round(conv["similarity"] + MULTI_HIT_BONUS * extra, 6)

    return sorted(by_conv.values(), key=lambda c: c["retrieval_score"], reverse=True)


def apply_relevance_cutoff(
    candidates: list[dict],
    min_similarity: float = MIN_SIMILARITY,
    max_gap: float = MAX_GAP_FROM_TOP,
) -> list[dict]:
    """Drop candidates that are weak on their own or far behind the best one.
    An empty result means nothing in memory is relevant to the draft."""
    if not candidates:
        return []
    top = max(float(c.get("similarity") or 0.0) for c in candidates)
    floor = max(min_similarity, top - max_gap)
    return [c for c in candidates if float(c.get("similarity") or 0.0) >= floor]


def build_excerpt(
    full_text: str,
    matched: list[dict] | None,
    budget: int = EXCERPT_CHARS,
    opening_chars: int = OPENING_CHARS,
) -> str:
    """The conversation's opening plus its best-matching chunks, in reading order,
    capped at `budget` characters. Without matches, falls back to the opening."""
    text = full_text or ""
    if not matched:
        return text[:budget]

    n = len(text)
    spans: list[tuple[int, int]] = [(0, min(opening_chars, n))]
    remaining = budget - spans[0][1]
    for m in sorted(matched, key=lambda m: m.get("similarity", 0.0), reverse=True):
        if remaining <= 0:
            break
        start = max(0, min(int(m.get("start_char") or 0), n))
        end = max(start, min(int(m.get("end_char") or 0), n))
        new_chars = _uncovered(spans, start, end)
        if new_chars == 0:
            continue
        if new_chars > remaining:
            end = start + remaining
        spans.append((start, end))
        remaining = budget - _covered_length(spans)

    merged = _merge(spans)
    return EXCERPT_GAP.join(text[s:e].strip() for s, e in merged if e > s)


def _merge(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    out: list[list[int]] = []
    for s, e in sorted(spans):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(s, e) for s, e in out]


def _covered_length(spans: list[tuple[int, int]]) -> int:
    return sum(e - s for s, e in _merge(spans))


def _uncovered(spans: list[tuple[int, int]], start: int, end: int) -> int:
    return _covered_length(spans + [(start, end)]) - _covered_length(spans)


def group_keyword_hits(hits: list[dict]) -> list[dict]:
    """Collapse keyword chunk hits into one candidate per conversation, scored
    by its best chunk's keyword_score. keyword_similarity is that chunk's
    vector similarity to the query."""
    by_conv: dict[str, dict] = {}
    for hit in sorted(hits, key=lambda h: float(h.get("keyword_score") or 0.0), reverse=True):
        conv_id = hit.get("conversation_id")
        if not conv_id:
            continue
        sim = float(hit.get("similarity") or 0.0)
        conv = by_conv.get(conv_id)
        if conv is None:
            conv = {
                "id": conv_id,
                "title": hit.get("title") or "Untitled",
                "preview": hit.get("preview") or "",
                "created_at": hit.get("created_at"),
                "user_id": hit.get("user_id"),
                "keyword_score": float(hit.get("keyword_score") or 0.0),
                "keyword_similarity": sim,
                "snippet": (hit.get("chunk_text") or "")[:SNIPPET_CHARS],
                "matched": [],
            }
            by_conv[conv_id] = conv
        conv["matched"].append({
            "start_char": int(hit.get("start_char") or 0),
            "end_char": int(hit.get("end_char") or 0),
            "similarity": sim,
        })
    return list(by_conv.values())


def merge_hybrid(
    vector_lists: list[list[dict]],
    keyword_lists: list[list[dict]],
    *,
    min_similarity: float = MIN_SIMILARITY,
    max_gap: float = MAX_GAP_FROM_TOP,
    keyword_min: float = KEYWORD_MIN_SCORE,
    keyword_min_similarity: float = KEYWORD_MIN_SIMILARITY,
    per_list_cap: int | None = None,
) -> list[dict]:
    """Combine grouped candidate lists: one vector and one keyword list per query.

    A conversation qualifies if, in any list, it passes that list's cutoff
    within the list's top `per_list_cap`: the relevance cutoff for vector
    lists; for keyword lists, keyword_min plus a loose meaning check on the
    matched chunk. The cap lets every rewritten query contribute its own best
    matches instead of being drowned out by generic ones. Qualifiers are
    ordered by reciprocal rank fusion over all lists (keyword ranks weighted
    by KEYWORD_RRF_WEIGHT), so a conversation found several ways ranks above
    one found once. `similarity` is the best vector similarity of any of the
    conversation's matched chunks."""
    vector_qualified: set[str] = set()
    for lst in vector_lists:
        vector_qualified |= {c["id"] for c in apply_relevance_cutoff(lst, min_similarity, max_gap)[:per_list_cap]}
    qualified = set(vector_qualified)
    for lst in keyword_lists:
        strong = [
            c for c in lst
            if float(c.get("keyword_score") or 0.0) >= keyword_min
            and float(c.get("keyword_similarity") or 0.0) >= keyword_min_similarity
        ]
        qualified |= {c["id"] for c in strong[:per_list_cap]}

    merged: dict[str, dict] = {}
    for lists, is_vec in ((vector_lists, True), (keyword_lists, False)):
        for lst in lists:
            for rank, c in enumerate(lst):
                if c["id"] not in qualified:
                    continue
                conv = merged.get(c["id"])
                if conv is None:
                    conv = merged[c["id"]] = {
                        **c, "similarity": None, "keyword_score": None,
                        "matched": [], "retrieval_score": 0.0, "_snippet_score": -1.0,
                    }
                sim = float((c.get("similarity") if is_vec else c.get("keyword_similarity")) or 0.0)
                if conv["similarity"] is None or sim > conv["similarity"]:
                    conv["similarity"] = sim
                if not is_vec:
                    kw = float(c.get("keyword_score") or 0.0)
                    conv["keyword_score"] = max(conv["keyword_score"] or 0.0, kw)
                # Snippet: from whichever kind of match qualified the conversation
                # (vector preferred), then the most similar such chunk.
                snippet_score = sim + (1.0 if is_vec == (c["id"] in vector_qualified) else 0.0)
                if snippet_score > conv["_snippet_score"]:
                    conv["snippet"], conv["_snippet_score"] = c.get("snippet", ""), snippet_score
                conv["matched"] += c.get("matched") or []
                weight = 1.0 if is_vec else KEYWORD_RRF_WEIGHT
                conv["retrieval_score"] += weight / (RRF_K + rank + 1)

    out = []
    for conv in merged.values():
        conv.pop("_snippet_score")
        conv.pop("keyword_similarity", None)
        conv["matched"] = _dedupe_spans(conv["matched"])
        conv["retrieval_score"] = round(conv["retrieval_score"], 6)
        out.append(conv)
    return sorted(out, key=lambda c: c["retrieval_score"], reverse=True)


def _dedupe_spans(matched: list[dict]) -> list[dict]:
    best: dict[tuple, dict] = {}
    for m in matched:
        key = (m.get("start_char"), m.get("end_char"))
        if key not in best or m.get("similarity", 0) > best[key].get("similarity", 0):
            best[key] = m
    return list(best.values())


def retrieve_candidates(
    user_id: str,
    query_embedding: np.ndarray,
    limit: int,
    query_text: str | None = None,
    stats: dict | None = None,
) -> list[dict]:
    """Conversation candidates for a query: chunk search when enabled, falling
    back to whole-conversation search when it's off, fails, or the user has no
    chunks yet (e.g. before the backfill has reached them). With query_text,
    keyword search runs alongside vector search.

    Chunk results pass the relevance cutoff, so they can be empty: that means
    nothing relevant, and deliberately does not fall back.

    Pass a dict as `stats` to learn which search ran (see retrieve_candidates_multi)."""
    return retrieve_candidates_multi(
        user_id,
        [query_text or ""],
        [query_embedding],
        limit,
        use_keywords=bool(query_text),
        stats=stats,
    )


def retrieve_candidates_multi(
    user_id: str,
    queries: list[str],
    embeddings: list[np.ndarray],
    limit: int,
    *,
    min_similarity: float = MIN_SIMILARITY,
    use_keywords: bool = True,
    per_query_cap: int | None = None,
    stats: dict | None = None,
) -> list[dict]:
    """retrieve_candidates over several phrasings of one need (e.g. rewritten
    "about me" queries). Each query is ranked separately, then fused.

    `stats`, when given, is filled with:
      search    "chunks" or "conversations" (the opening-only fallback)
      fallback  why conversations were searched: "disabled" (RETRIEVAL_MODE),
                "no_chunks" (user not indexed yet) or "error"; None otherwise
      keywords  "used", "off" or "failed"
      ms        total time
      error     the failure message, when something failed
    Fallbacks and keyword failures are also logged as one `[retrieval]` line."""
    from concurrent.futures import ThreadPoolExecutor

    from services.database import search_chunks, search_conversations_candidates, search_keyword_chunks

    started = time.perf_counter()
    info: dict = {"search": "chunks", "fallback": None, "keywords": "off"}

    def finish(result: list[dict]) -> list[dict]:
        info["ms"] = round((time.perf_counter() - started) * 1000)
        if info["fallback"] and info["fallback"] != "disabled":
            _log_retrieval_event(f"fallback={info['fallback']}", user_id, info)
        if stats is not None:
            stats.update(info)
        return result

    if chunked_retrieval_enabled():
        try:
            with ThreadPoolExecutor(max_workers=min(8, 2 * len(queries))) as pool:
                vec_futures = [pool.submit(search_chunks, user_id, e, CHUNK_CANDIDATES) for e in embeddings]
                kw_futures = [
                    pool.submit(search_keyword_chunks, user_id, q, e, KEYWORD_CANDIDATES)
                    for q, e in zip(queries, embeddings) if use_keywords and q.strip()
                ]
                vec_lists = [group_chunk_hits(f.result() or []) for f in vec_futures]
                kw_lists = []
                kw_error = None
                for f in kw_futures:
                    try:
                        kw_lists.append(group_keyword_hits(f.result() or []))
                    except Exception as exc:
                        kw_error = exc
            if kw_futures:
                info["keywords"] = "failed" if kw_error else "used"
            if kw_error:
                info["error"] = _short_error(kw_error)
                _log_retrieval_event("keyword_failed", user_id, info)
            if any(vec_lists):
                return finish(merge_hybrid(
                    vec_lists,
                    kw_lists,
                    min_similarity=min_similarity,
                    per_list_cap=per_query_cap,
                )[:limit])
            info["fallback"] = "no_chunks"
        except Exception as exc:
            info["fallback"] = "error"
            info["error"] = _short_error(exc)
    else:
        info["fallback"] = "disabled"

    info["search"] = "conversations"
    info["keywords"] = "off"
    best: dict[str, dict] = {}
    for e in embeddings:
        for c in search_conversations_candidates(user_id, e, limit) or []:
            cid = c.get("id")
            if cid not in best or float(c.get("similarity") or 0) > float(best[cid].get("similarity") or 0):
                best[cid] = c
    return finish(sorted(best.values(), key=lambda c: float(c.get("similarity") or 0), reverse=True)[:limit])


def _short_error(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"[:300]


def _log_retrieval_event(event: str, user_id: str, info: dict) -> None:
    print(
        f"[retrieval] {event} user={user_id} search={info.get('search')} "
        f"ms={info.get('ms', '-')} error={info.get('error', '-')!r}",
        flush=True,
    )


def memory_route(draft: str, profile: dict | None) -> str:
    """How Improve gathers memory for a draft:
    "standard" - search conversations with the draft
    "profile"  - an about-me draft and the user has an enabled profile with
                 personal facts: lean on those facts (conversations still searched)
    "rewrite"  - an about-me draft without a usable profile: search with
                 queries rewritten to find the personal facts in conversations"""
    from services.personalization import profile_has_personal_facts
    from services.query_intent import is_about_me

    if not is_about_me(draft):
        return "standard"
    profile = profile or {}
    if profile.get("is_profile_enabled") and profile_has_personal_facts(profile.get("profile_data")):
        return "profile"
    return "rewrite"


def retrieve_about_me(
    user_id: str,
    draft: str,
    draft_embedding: np.ndarray,
    limit: int,
    api_key: str | None = None,
    stats: dict | None = None,
) -> list[dict]:
    """Candidates for an about-me draft: the draft plus rewritten queries aimed
    at the personal facts it depends on, with a looser relevance floor."""
    from services.embedder import get_embedding_model
    from services.personalization_llm import rewrite_about_me_queries_llm

    rewrites = rewrite_about_me_queries_llm(draft, api_key)
    embeddings = [draft_embedding]
    if rewrites:
        embeddings += list(get_embedding_model().encode(rewrites))
    # No keyword search: rewrites are generic phrasings ("career goals"), and
    # in evals their keyword matches were nearly all unrelated.
    return retrieve_candidates_multi(
        user_id,
        [draft, *rewrites],
        embeddings,
        limit,
        min_similarity=ABOUT_ME_MIN_SIMILARITY,
        use_keywords=False,
        per_query_cap=ABOUT_ME_PER_QUERY,
        stats=stats,
    )


def index_conversation_chunks(
    conversation_id: str,
    user_id: str,
    title: str,
    full_text: str,
    *,
    force: bool = False,
) -> int:
    """Chunk and embed one conversation, replacing its stored chunks.

    Skips the work when full_text is unchanged since the last indexing (auto-save
    re-sends whole conversations constantly). Returns the number of chunks
    written, 0 when skipped.
    """
    from services.chunker import chunk_embed_inputs, chunk_spans, text_hash
    from services.database import get_conversation_text_hash, replace_conversation_chunks
    from services.embedder import get_embedding_model

    digest = text_hash(full_text)
    if not force and get_conversation_text_hash(conversation_id) == digest:
        return 0

    spans = chunk_spans(full_text)
    if not spans:
        replace_conversation_chunks(conversation_id, user_id, full_text, [], [], digest)
        return 0
    inputs = chunk_embed_inputs(title, full_text, spans)
    embeddings = get_embedding_model().encode(inputs, batch_size=32, show_progress_bar=False)
    replace_conversation_chunks(conversation_id, user_id, full_text, spans, embeddings, digest)
    return len(spans)


def index_conversations_chunks(
    user_id: str | None,
    conversations: list[dict],
    *,
    force: bool = False,
) -> dict:
    """Index many conversations (bulk import / backfill). Never raises.
    A conversation's own user_id, when present, wins over the `user_id` argument."""
    indexed = skipped = failed = 0
    for conv in conversations:
        try:
            written = index_conversation_chunks(
                conv["id"],
                conv.get("user_id") or user_id,
                conv.get("title") or "Untitled",
                conv.get("full_text") or "",
                force=force,
            )
            if written:
                indexed += 1
            else:
                skipped += 1
        except Exception as exc:
            failed += 1
            print(f"[retrieval] chunk indexing failed for {conv.get('id')}: {exc}")
    return {"indexed": indexed, "skipped": skipped, "failed": failed}
