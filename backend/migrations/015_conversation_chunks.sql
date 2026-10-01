-- Chunk-level retrieval: search the whole conversation, not just its opening.
-- Each chunk is a (start_char, end_char) span into knowledge_nodes.full_text;
-- full_text stays the source of truth and chunks can be rebuilt from it.

-- Hash of full_text at last chunking, so unchanged re-saves skip re-embedding.
ALTER TABLE knowledge_nodes ADD COLUMN IF NOT EXISTS text_hash TEXT;

CREATE TABLE IF NOT EXISTS conversation_chunks (
  conversation_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL,
  start_char INTEGER NOT NULL,
  end_char INTEGER NOT NULL,
  embedding VECTOR(384) NOT NULL,
  PRIMARY KEY (conversation_id, chunk_index)
);

-- Searches are always scoped to one user, so match_chunks scans that user's
-- chunks exactly. An HNSW index would rank the whole table first and filter by
-- user afterwards, which can silently return fewer than match_count rows.
CREATE INDEX IF NOT EXISTS conversation_chunks_user_id_idx
  ON conversation_chunks (user_id);

ALTER TABLE conversation_chunks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE conversation_chunks FROM anon, authenticated;
GRANT ALL ON TABLE conversation_chunks TO service_role;

DROP FUNCTION IF EXISTS match_chunks(vector, uuid, integer);

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
  SELECT
    c.conversation_id,
    c.chunk_index,
    c.start_char,
    c.end_char,
    1 - (c.embedding <=> query_embedding) AS similarity,
    substring(k.full_text FROM c.start_char + 1 FOR c.end_char - c.start_char) AS chunk_text,
    k.title,
    k.preview,
    k.created_at,
    c.user_id
  FROM conversation_chunks c
  JOIN knowledge_nodes k ON k.id = c.conversation_id
  WHERE c.user_id = match_user_id
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION match_chunks(vector, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_chunks(vector, uuid, integer) TO service_role;
