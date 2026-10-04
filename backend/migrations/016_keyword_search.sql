-- Keyword search over conversation chunks, used alongside vector search.
-- Embeddings miss exact terms (names, error messages, library names); this
-- catches them. Indexed per chunk so keyword hits point at the passage that
-- matched, the same way vector hits do.

ALTER TABLE conversation_chunks ADD COLUMN IF NOT EXISTS fts tsvector;

-- Chunks store spans, not text, so the tsvector is built from
-- knowledge_nodes on insert. Chunks are always deleted and re-inserted when a
-- conversation changes (replace_conversation_chunks), so insert is enough.
CREATE OR REPLACE FUNCTION conversation_chunks_set_fts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  SELECT to_tsvector(
    'english',
    coalesce(k.title, '') || ' ' ||
    coalesce(substring(k.full_text FROM NEW.start_char + 1 FOR NEW.end_char - NEW.start_char), '')
  )
  INTO NEW.fts
  FROM knowledge_nodes k
  WHERE k.id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversation_chunks_fts ON conversation_chunks;
CREATE TRIGGER conversation_chunks_fts
  BEFORE INSERT ON conversation_chunks
  FOR EACH ROW EXECUTE FUNCTION conversation_chunks_set_fts();

UPDATE conversation_chunks c
SET fts = to_tsvector(
  'english',
  coalesce(k.title, '') || ' ' ||
  coalesce(substring(k.full_text FROM c.start_char + 1 FOR c.end_char - c.start_char), '')
)
FROM knowledge_nodes k
WHERE k.id = c.conversation_id AND c.fts IS NULL;

CREATE INDEX IF NOT EXISTS conversation_chunks_fts_idx
  ON conversation_chunks USING gin (fts);

-- Scores each chunk by the share of the query's term weight it contains, with
-- terms weighted by rarity across this user's chunks (BM25-style idf). Common
-- words barely count; a query term the user never wrote about counts fully
-- against every chunk, so unrelated drafts score low. keyword_score is 0..1.
-- similarity is the chunk's vector similarity to the query, so callers can
-- reject chunks that share words but not meaning.
DROP FUNCTION IF EXISTS match_keyword_chunks(text, uuid, integer);
DROP FUNCTION IF EXISTS match_keyword_chunks(text, vector, uuid, integer);

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
  -- Pick the top chunks before touching knowledge_nodes: full_text is large
  -- and TOASTed, so slicing it for every candidate costs seconds.
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
    substring(k.full_text FROM t.start_char + 1 FOR t.end_char - t.start_char) AS chunk_text,
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

REVOKE ALL ON FUNCTION match_keyword_chunks(text, vector, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_keyword_chunks(text, vector, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION conversation_chunks_set_fts() FROM PUBLIC, anon, authenticated;
