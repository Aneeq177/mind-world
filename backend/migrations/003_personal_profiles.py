import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

def migrate():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not found. Please set it in your .env file.")
        return

    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cursor = conn.cursor()

    try:
        create_table_sql = """
        CREATE TABLE IF NOT EXISTS personal_profiles (
            user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            profile_data JSONB DEFAULT '{}'::jsonb,
            is_profile_enabled BOOLEAN DEFAULT false,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        """
        cursor.execute(create_table_sql)
        print("Created personal_profiles table.")

    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    print("WARNING: This script will execute against the live database if DATABASE_URL is set.")
    migrate()
