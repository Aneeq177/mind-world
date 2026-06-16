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
            ALTER TABLE personal_profiles
            ADD COLUMN IF NOT EXISTS profile_version INTEGER DEFAULT 1,
            ADD COLUMN IF NOT EXISTS last_inferred_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS last_signal_at TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS confidence_floor NUMERIC DEFAULT 0.60;
            """
        )

        cursor.execute(
            """
            UPDATE personal_profiles
            SET profile_data = jsonb_strip_nulls(
                COALESCE(profile_data, '{}'::jsonb) ||
                jsonb_build_object(
                    'domains', COALESCE(profile_data->'domains', '{}'::jsonb),
                    'preferences', COALESCE(profile_data->'preferences', '{}'::jsonb),
                    'active_projects', COALESCE(profile_data->'active_projects', '[]'::jsonb),
                    'constraints', COALESCE(profile_data->'constraints', '[]'::jsonb),
                    'last_observed_at', COALESCE(profile_data->>'last_observed_at', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SSOF'))
                )
            )
            WHERE profile_data IS NULL
               OR profile_data->'domains' IS NULL
               OR profile_data->'preferences' IS NULL
               OR profile_data->'active_projects' IS NULL;
            """
        )

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_personal_profiles_last_signal_at
            ON personal_profiles(last_signal_at DESC);
            """
        )

        print("Applied personalization phase 1 schema migration.")
    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    print("WARNING: This script will execute against the live database if DATABASE_URL is set.")
    migrate()
