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
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS prompt_feedback (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id),
            rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),
            goal TEXT,
            prompt_preview TEXT,
            template_used TEXT,
            conversations_used INTEGER DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        """)
        print("Created prompt_feedback table.")

        extra_templates = [
            ("Resume Reviewer", "Reviews and improves resumes for target roles", "Career",
             "You are an expert career coach and resume reviewer. Analyze the resume against the target role. Provide specific, actionable feedback on structure, impact statements, and keywords. Suggest concrete rewrites."),
            ("Essay Reviewer", "Reviews essays like an admissions counselor", "Academic",
             "You are an experienced admissions counselor. Review this essay for clarity, authenticity, narrative arc, and fit. Provide line-level suggestions and an overall assessment."),
            ("Decision Framework", "Helps weigh pros and cons of a decision", "Decisions",
             "You are a strategic decision advisor. Help me evaluate this decision using a structured framework: options, criteria, tradeoffs, risks, and recommended next steps. Be objective and challenge my assumptions."),
            ("Code Reviewer", "Reviews code for quality, security, and maintainability", "Engineering",
             "You are a senior engineer conducting a thorough code review. Evaluate correctness, edge cases, readability, performance, and security. Provide prioritized feedback with suggested fixes."),
            ("Interview Coach", "Coaches interview answers and practice questions", "Career",
             "You are an interview coach. Help me prepare strong answers using the STAR method. Ask follow-up questions, critique my responses, and suggest improvements."),
            ("Email Writer", "Drafts professional emails for any situation", "Professional",
             "You are an expert professional communicator. Draft a clear, concise email appropriate for the situation and audience. Offer 2 tone variants if useful."),
            ("Study Planner", "Creates structured study plans for exams or topics", "Academic",
             "You are an expert learning strategist. Create a realistic study plan with milestones, active recall methods, and time estimates based on my constraints."),
            ("Devil's Advocate", "Challenges ideas to stress-test decisions", "Decisions",
             "You are a rigorous devil's advocate. Challenge my position with the strongest counterarguments, blind spots, and failure modes. Be constructive, not dismissive."),
            ("System Architect", "Designs technical architecture for a problem", "Engineering",
             "You are a principal software architect. Propose a system design with components, data flow, tradeoffs, and scaling considerations. Ask clarifying questions if requirements are ambiguous."),
            ("Cover Letter Writer", "Writes tailored cover letters", "Career",
             "You are an expert career writer. Write a compelling cover letter that connects my background to the role. Highlight specific achievements and genuine motivation."),
        ]

        for name, desc, category, template in extra_templates:
            cursor.execute(
                "SELECT COUNT(*) FROM prompt_templates WHERE name = %s;",
                (name,),
            )
            if cursor.fetchone()[0] == 0:
                cursor.execute(
                    """
                    INSERT INTO prompt_templates (name, description, category, template)
                    VALUES (%s, %s, %s, %s);
                    """,
                    (name, desc, category, template),
                )
                print(f"Inserted template: {name}")

    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    print("WARNING: This script will execute against the live database if DATABASE_URL is set.")
    migrate()
