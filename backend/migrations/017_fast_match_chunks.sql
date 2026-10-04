-- match_chunks sliced chunk_text out of knowledge_nodes.full_text for every
-- one of the user's chunks before keeping the top match_count. full_text is
-- large and TOASTed, so with long conversations that took ~20 s and hit the
-- statement timeout. Rank chunks first, then slice text for the winners only.

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
    substring(k.full_text FROM t.start_char + 1 FOR t.end_char - t.start_char) AS chunk_text,
    k.title,
    k.preview,
    k.created_at,
    t.user_id
  FROM top t
  JOIN knowledge_nodes k ON k.id = t.conversation_id
  ORDER BY t.similarity DESC;
$$;

REVOKE ALL ON FUNCTION match_chunks(vector, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_chunks(vector, uuid, integer) TO service_role;
