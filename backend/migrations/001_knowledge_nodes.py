import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

def migrate():
    # Retrieve Postgres connection string from environment
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not found. Please set it in your .env file.")
        return

    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cursor = conn.cursor()

    try:
        # 1. Create knowledge_nodes table
        create_table_sql = """
        CREATE TABLE IF NOT EXISTS knowledge_nodes (
            id TEXT PRIMARY KEY,
            user_id UUID,
            title TEXT,
            type TEXT,
            source_app TEXT,
            created_at TEXT,
            updated_at TEXT,
            num_messages INTEGER,
            char_count INTEGER,
            preview TEXT,
            full_text TEXT,
            cluster_id INTEGER,
            region TEXT,
            color TEXT,
            x FLOAT,
            y FLOAT,
            z FLOAT,
            visibility TEXT DEFAULT 'private'
        );
        """
        cursor.execute(create_table_sql)
        print("Created knowledge_nodes table.")

        # 2. Migrate data from conversations
        migrate_data_sql = """
        INSERT INTO knowledge_nodes (
            id, user_id, title, type, source_app, created_at, updated_at,
            num_messages, char_count, preview, full_text, cluster_id,
            region, color, x, y, z, visibility
        )
        SELECT 
            id, user_id, title, 'ai_chat', source, created_at, updated_at,
            num_messages, char_count, preview, full_text, cluster_id,
            region, color, x, y, z, visibility
        FROM conversations
        ON CONFLICT (id) DO NOTHING;
        """
        cursor.execute(migrate_data_sql)
        print("Migrated data from conversations to knowledge_nodes.")

        # 3. Rename old conversations table
        rename_table_sql = """
        ALTER TABLE conversations RENAME TO conversations_old;
        """
        cursor.execute(rename_table_sql)
        print("Renamed conversations table to conversations_old.")
        
        # 4. Update RPCs
        update_rpcs_sql = """
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
                COALESCE(c.user_id, e.user_id) as user_id,
                c.created_at,
                1 - (e.embedding <=> query_embedding) AS similarity
            FROM knowledge_nodes c
            JOIN embeddings e ON e.conversation_id = c.id
            WHERE COALESCE(c.user_id, e.user_id) = ANY(company_user_ids)
                AND COALESCE(c.user_id, e.user_id) != exclude_user_id
                AND c.visibility = 'team'
            ORDER BY e.embedding <=> query_embedding
            LIMIT match_count;
        END;
        $$;

        CREATE OR REPLACE FUNCTION match_conversations(
            query_embedding vector(384),
            match_user_id uuid,
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
                COALESCE(c.user_id, e.user_id) as user_id,
                c.created_at,
                1 - (e.embedding <=> query_embedding) AS similarity
            FROM knowledge_nodes c
            JOIN embeddings e ON e.conversation_id = c.id
            WHERE COALESCE(c.user_id, e.user_id) = match_user_id
            ORDER BY e.embedding <=> query_embedding
            LIMIT match_count;
        END;
        $$;
        """
        cursor.execute(update_rpcs_sql)
        print("Updated RPC functions to use knowledge_nodes.")

    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    print("WARNING: This script will execute against the live database if DATABASE_URL is set.")
    # migrate() # Uncomment to run
