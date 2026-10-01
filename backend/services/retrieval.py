"""Chunk-level retrieval: find matching chunks, rank their conversations, and
build the context excerpt Improve sends to the model."""
import os

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


def retrieve_candidates(user_id: str, query_embedding: np.ndarray, limit: int) -> list[dict]:
    """Conversation candidates for a query: chunk search when enabled, falling
    back to whole-conversation search when it's off, fails, or the user has no
    chunks yet (e.g. before the backfill has reached them)."""
    from services.database import search_chunks, search_conversations_candidates

    if chunked_retrieval_enabled():
        try:
            hits = search_chunks(user_id, query_embedding, CHUNK_CANDIDATES)
            if hits:
                return group_chunk_hits(hits)[:limit]
        except Exception as exc:
            print(f"[retrieval] chunk search failed, using conversation search: {exc}")
    return search_conversations_candidates(user_id, query_embedding, limit)


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
        replace_conversation_chunks(conversation_id, user_id, [], [], digest)
        return 0
    inputs = chunk_embed_inputs(title, full_text, spans)
    embeddings = get_embedding_model().encode(inputs, batch_size=32, show_progress_bar=False)
    replace_conversation_chunks(conversation_id, user_id, spans, embeddings, digest)
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
