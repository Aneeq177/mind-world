"""Split conversation text into overlapping chunks for retrieval.

Chunks are stored as (start_char, end_char) spans into knowledge_nodes.full_text
rather than as copied text, so full_text stays the single source of truth and
chunks can be rebuilt from it at any time.
"""
import hashlib

# all-MiniLM-L6-v2 reads at most 256 word pieces (~1,000 chars of English);
# anything past that is silently ignored, so chunks must stay under it.
CHUNK_SIZE = 800
CHUNK_OVERLAP = 150
# A tail shorter than this is folded into the previous chunk instead of
# becoming a chunk that is almost entirely overlap.
MIN_TAIL = 200

# Preferred break points, best first, as (separator, cut offset into separator).
# "\n\n[" starts a new "[role] ..." message, so cut before it.
_BREAKS = (
    ("\n\n[", 0),
    ("\n\n", 2),
    ("\n", 1),
    (". ", 2),
    ("? ", 2),
    ("! ", 2),
    (" ", 1),
)


def text_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def _best_break(text: str, lo: int, hi: int) -> int:
    for sep, offset in _BREAKS:
        idx = text.rfind(sep, lo, hi)
        if idx != -1:
            return idx + offset
    return hi


def _align_start(text: str, start: int, limit: int) -> int:
    """Move a chunk start forward to the next word so chunks don't open mid-word."""
    if start == 0 or text[start - 1].isspace():
        return start
    idx = start
    while idx < limit and not text[idx].isspace():
        idx += 1
    while idx < limit and text[idx].isspace():
        idx += 1
    return idx if idx < limit else start


def chunk_spans(
    text: str,
    size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[tuple[int, int]]:
    n = len(text or "")
    if n == 0:
        return []
    if n <= size + MIN_TAIL:
        return [(0, n)]

    spans: list[tuple[int, int]] = []
    start = 0
    while start < n:
        if n - start <= size + MIN_TAIL:
            spans.append((start, n))
            break
        end = _best_break(text, start + size // 2, start + size)
        spans.append((start, end))
        next_start = _align_start(text, max(end - overlap, start + 1), end)
        start = next_start if next_start > start else end
    return spans


def chunk_embed_inputs(title: str, text: str, spans: list[tuple[int, int]]) -> list[str]:
    # Every chunk carries the title so a mid-conversation chunk keeps its topic.
    head = (title or "Untitled").strip()
    return [f"{head}. {text[s:e]}" for s, e in spans]
