-- Store each chunk's text on its own row. Slicing it out of
-- knowledge_nodes.full_text at query time decompresses the whole (TOASTed)
-- conversation once per chunk, which is what pushed match_chunks past the
-- statement timeout on long conversations. full_text stays the source of
-- truth: chunks are deleted and re-inserted whenever it changes
-- (replace_conversation_chunks), so chunk_text can't go stale.

ALTER TABLE conversation_chunks ADD COLUMN IF NOT EXISTS chunk_text text;

-- Decompress each conversation once (|| '' forces it into memory), not once
-- per chunk: one conversation has over a thousand chunks.
WITH src AS MATERIALIZED (
  SELECT k.id, k.full_text || '' AS full_text
  FROM knowledge_nodes k
  WHERE k.id IN (SELECT conversation_id FROM conversation_chunks WHERE chunk_text IS NULL)
)
UPDATE conversation_chunks c
SET chunk_text = substring(src.full_text FROM c.start_char + 1 FOR c.end_char - c.start_char)
FROM src
WHERE src.id = c.conversation_id AND c.chunk_text IS NULL;

-- The backend sends chunk_text with each row. Rows without it (a backend
-- deployed before this migration) are filled from full_text here.
CREATE OR REPLACE FUNCTION conversation_chunks_set_fts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.chunk_text IS NULL THEN
    SELECT substring(k.full_text FROM NEW.start_char + 1 FOR NEW.end_char - NEW.start_char)
    INTO NEW.chunk_text
    FROM knowledge_nodes k
    WHERE k.id = NEW.conversation_id;
  END IF;
  SELECT to_tsvector('english', coalesce(k.title, '') || ' ' || coalesce(NEW.chunk_text, ''))
  INTO NEW.fts
  FROM knowledge_nodes k
  WHERE k.id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(384),
  match_user_id uuid,
  match_count int DEFAULT 60
)
RETURNS TABLE (
  conversation_id text,
  chunk_index int,
  start_char int,
  end_char int,
  similarity float,
  chunk_text text,
  title text,
  preview text,
  created_at text,
  user_id uuid
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH top AS (
    SELECT
      c.conversation_id,
      c.chunk_index,
      c.start_char,
      c.end_char,
      c.chunk_text,
      c.user_id,
      1 - (c.embedding <=> query_embedding) AS similarity
    FROM conversation_chunks c
    WHERE c.user_id = match_user_id
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count
  )
  SELECT
    t.conversation_id,
    t.chunk_index,
    t.start_char,
    t.end_char,
    t.similarity,
    t.chunk_text,
    k.title,
    k.preview,
    k.created_at,
    t.user_id
  FROM top t
  JOIN knowledge_nodes k ON k.id = t.conversation_id
  ORDER BY t.similarity DESC;
$$;

CREATE OR REPLACE FUNCTION match_keyword_chunks(
  query_text text,
  query_embedding vector(384),
  match_user_id uuid,
  match_count int DEFAULT 30
)
RETURNS TABLE (
  conversation_id text,
  chunk_index int,
  start_char int,
  end_char int,
  keyword_score float,
  matched_terms int,
  similarity float,
  chunk_text text,
  title text,
  preview text,
  created_at text,
  user_id uuid
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH terms AS (
    SELECT DISTINCT t.lexeme, quote_literal(t.lexeme)::tsquery AS q
    FROM unnest(to_tsvector('english', left(coalesce(query_text, ''), 2000))) AS t
    WHERE length(t.lexeme) >= 2
  ),
  total AS (
    SELECT greatest(count(*), 1)::float AS n
    FROM conversation_chunks
    WHERE conversation_chunks.user_id = match_user_id
  ),
  weighted AS (
    SELECT
      terms.q,
      df.n_docs,
      ln(1 + ((SELECT n FROM total) - df.n_docs + 0.5) / (df.n_docs + 0.5)) AS idf
    FROM terms
    CROSS JOIN LATERAL (
      SELECT count(*)::float AS n_docs
      FROM conversation_chunks c
      WHERE c.user_id = match_user_id AND c.fts @@ terms.q
    ) df
  ),
  top AS (
    SELECT c.conversation_id, c.chunk_index, c.start_char, c.end_char, c.user_id,
           sum(w.idf) AS weight, count(*)::int AS matched
    FROM conversation_chunks c
    JOIN weighted w ON w.n_docs > 0 AND c.fts @@ w.q
    WHERE c.user_id = match_user_id
    GROUP BY c.conversation_id, c.chunk_index, c.start_char, c.end_char, c.user_id
    ORDER BY weight DESC
    LIMIT match_count
  )
  SELECT
    t.conversation_id,
    t.chunk_index,
    t.start_char,
    t.end_char,
    (t.weight / nullif((SELECT sum(idf) FROM weighted), 0))::float AS keyword_score,
    t.matched AS matched_terms,
    (1 - (c.embedding <=> query_embedding))::float AS similarity,
    c.chunk_text,
    k.title,
    k.preview,
    k.created_at,
    t.user_id
  FROM top t
  JOIN conversation_chunks c
    ON c.conversation_id = t.conversation_id AND c.chunk_index = t.chunk_index
  JOIN knowledge_nodes k ON k.id = t.conversation_id
  ORDER BY t.weight DESC;
$$;
