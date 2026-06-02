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
        CREATE TABLE IF NOT EXISTS prompt_templates (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            description TEXT,
            template TEXT NOT NULL,
            category TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        """
        cursor.execute(create_table_sql)
        print("Created prompt_templates table.")

        # Check if templates exist before inserting
        cursor.execute("SELECT COUNT(*) FROM prompt_templates;")
        count = cursor.fetchone()[0]
        
        if count == 0:
            insert_defaults_sql = """
            INSERT INTO prompt_templates (name, description, category, template) VALUES 
            ('Academic Reviewer', 'Critiques writing and arguments from an academic lens', 'Writing', 'Act as an expert academic reviewer. Analyze the draft for logic, flow, and evidence. Provide structured feedback.'),
            ('Code Debugger', 'Analyzes code snippets to find bugs or optimize performance', 'Engineering', 'You are an expert senior software engineer. Review the provided code, identify bugs, suggest optimizations, and explain your reasoning clearly.'),
            ('Creative Copywriter', 'Brainstorms catchy titles and marketing copy', 'Marketing', 'You are a world-class creative copywriter. Write 5 catchy, engaging variations of marketing copy based on the provided topic. Focus on tone, audience, and actionability.'),
            ('Brainstorming Partner', 'Generates out-of-the-box ideas and perspectives', 'Ideation', 'Act as a brilliant brainstorming partner. Generate 10 highly creative, unconventional ideas related to the topic. Do not hold back on wild concepts.'),
            ('Interview Prep', 'Acts as a strict interviewer to practice answering questions', 'Career', 'You are a rigorous technical interviewer. Ask me one deep, challenging question at a time related to my field. Wait for my response before grading it and asking the next question.');
            """
            cursor.execute(insert_defaults_sql)
            print("Inserted default prompt templates.")
        else:
            print(f"Skipping insert: found {count} existing prompt templates.")

    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    print("WARNING: This script will execute against the live database if DATABASE_URL is set.")
    migrate()
