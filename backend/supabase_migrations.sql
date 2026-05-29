-- Run this in the Supabase SQL editor at:
-- https://supabase.com/dashboard/project/qlwdoejtszndqifpbadd/sql

-- Function: match_company_conversations
-- Used by /company_search to find relevant conversations shared by
-- colleagues (visibility = 'company') using pgvector cosine similarity.

CREATE OR REPLACE FUNCTION match_company_conversations(
    query_embedding vector(384),
    company_user_ids uuid[],
    exclude_user_id uuid,
    match_count int DEFAULT 5
)
RETURNS TABLE (
    id text,
    title text,
    preview text,
    user_id uuid,
    created_at text,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.title,
        c.preview,
        c.user_id,
        c.created_at,
        1 - (e.embedding <=> query_embedding) AS similarity
    FROM conversations c
    JOIN embeddings e ON e.conversation_id = c.id
    WHERE c.user_id = ANY(company_user_ids)
        AND c.user_id != exclude_user_id
        AND c.visibility = 'team'
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
