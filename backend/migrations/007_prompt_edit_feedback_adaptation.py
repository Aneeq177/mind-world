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
        cursor.execute(
            """
            ALTER TABLE prompt_feedback
            ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'rating',
            ADD COLUMN IF NOT EXISTS goal_hash TEXT,
            ADD COLUMN IF NOT EXISTS engineered_prompt_hash TEXT,
            ADD COLUMN IF NOT EXISTS final_prompt_hash TEXT,
            ADD COLUMN IF NOT EXISTS diff_metrics JSONB DEFAULT '{}'::jsonb,
            ADD COLUMN IF NOT EXISTS accepted_unedited BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_prompt_feedback_user_event_created
            ON prompt_feedback(user_id, event_type, created_at DESC);
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS personalization_metric_counters (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                metric_day DATE NOT NULL DEFAULT CURRENT_DATE,
                key TEXT NOT NULL,
                value INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(user_id, metric_day, key)
            );
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_personalization_metric_counters_day
            ON personalization_metric_counters(metric_day DESC);
            """
        )

        print("Applied prompt edit feedback + adaptation migration.")
    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    print("WARNING: This script will execute against the live database if DATABASE_URL is set.")
    migrate()
