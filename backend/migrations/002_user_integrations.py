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
        # Create user_integrations table
        create_table_sql = """
        CREATE TABLE IF NOT EXISTS user_integrations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            provider TEXT NOT NULL,
            access_token TEXT NOT NULL,
            workspace_id TEXT,
            workspace_name TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(user_id, provider)
        );
        """
        cursor.execute(create_table_sql)
        print("Created user_integrations table.")

    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    print("WARNING: This script will execute against the live database if DATABASE_URL is set.")
    migrate()
