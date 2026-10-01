from services.chunker import (
    CHUNK_SIZE,
    MIN_TAIL,
    chunk_embed_inputs,
    chunk_spans,
    text_hash,
)


def _conversation(n_messages: int, words_per_message: int = 60) -> str:
    parts = []
    for i in range(n_messages):
        role = "human" if i % 2 == 0 else "assistant"
        body = " ".join(f"word{i}_{j}" for j in range(words_per_message))
        parts.append(f"[{role}] {body}.")
    return "\n\n".join(parts)


def test_empty_text_has_no_chunks():
    assert chunk_spans("") == []


def test_short_text_is_one_chunk():
    text = "[human] how do I deploy fastapi?"
    assert chunk_spans(text) == [(0, len(text))]


def test_chunks_cover_whole_text_with_overlap():
    text = _conversation(30)
    spans = chunk_spans(text)
    assert len(spans) > 1
    assert spans[0][0] == 0
    assert spans[-1][1] == len(text)
    for (_, prev_end), (start, _) in zip(spans, spans[1:]):
        assert start < prev_end, "consecutive chunks should overlap"
        assert start > 0


def test_chunks_respect_size_limit():
    text = _conversation(30)
    for s, e in chunk_spans(text)[:-1]:
        assert e - s <= CHUNK_SIZE
    last_s, last_e = chunk_spans(text)[-1]
    assert last_e - last_s <= CHUNK_SIZE + MIN_TAIL


def test_chunks_prefer_message_boundaries():
    text = _conversation(30)
    for _, e in chunk_spans(text)[:-1]:
        assert text[e:e + 3] == "\n\n[", f"chunk should end before a message, got {text[e:e + 20]!r}"


def test_chunks_do_not_start_mid_word():
    text = " ".join(f"token{i}" for i in range(2000))
    for s, _ in chunk_spans(text)[1:]:
        assert text[s - 1].isspace()


def test_unbroken_text_still_makes_progress():
    text = "x" * 5000
    spans = chunk_spans(text)
    assert spans[-1][1] == len(text)
    assert all(e > s for s, e in spans)


def test_embed_inputs_carry_title():
    text = _conversation(10)
    spans = chunk_spans(text)
    inputs = chunk_embed_inputs("Deploying FastAPI", text, spans)
    assert len(inputs) == len(spans)
    assert all(i.startswith("Deploying FastAPI. ") for i in inputs)


def test_text_hash_changes_with_text():
    assert text_hash("a") == text_hash("a")
    assert text_hash("a") != text_hash("b")
