-- Run in Supabase SQL Editor
-- Adds consumer-facing template categories (Everyday, Learning, Career).
-- The existing library skews Engineering/Writing; these serve the non-technical
-- daily-driver use cases the personal wedge targets.
-- Template bodies follow the eval-validated prompt principles (backend/evals):
-- no demand-everything checklists, no invented user facts — placeholders instead.

INSERT INTO prompt_templates (name, description, category, tier, template, tags, platforms, search_text)
SELECT v.name, v.description, v.category, v.tier, v.template, v.tags, v.platforms,
  lower(v.name || ' ' || v.description || ' ' || v.category || ' ' || array_to_string(v.tags, ' '))
FROM (VALUES
  (
    'Trip Planner',
    'Plans a realistic trip itinerary around your dates, budget, and interests',
    'Everyday',
    'standard',
    E'You are a practical travel planner. Plan a trip for me.\n\nDESTINATION & DATES\n[Where and when]\n\nBUDGET & TRAVELERS\n[Rough budget, who is going]\n\nINTERESTS\n[Food / nature / museums / nightlife / relaxed pace...]\n\nGive me a day-by-day outline with 2-3 options per day, realistic travel times, and a rough cost estimate. Flag anything that needs booking ahead.',
    ARRAY['travel', 'planning', 'everyday'],
    ARRAY['web']
  ),
  (
    'Purchase Research',
    'Compares options and helps you decide before buying something',
    'Everyday',
    'standard',
    E'Help me decide what to buy.\n\nWHAT I NEED\n[Product type and what you will use it for]\n\nBUDGET\n[Range]\n\nWHAT MATTERS TO ME\n[e.g. durability, size, battery life, brand support]\n\nCompare the 3-4 strongest options: key differences, who each one is best for, and what you would pick in my situation with a one-line reason. Note anything I should check before buying.',
    ARRAY['shopping', 'comparison', 'decision'],
    ARRAY['web']
  ),
  (
    'Negotiation Helper',
    'Prepares you to negotiate a price, bill, rent, or offer',
    'Everyday',
    'standard',
    E'You are a negotiation coach. Help me prepare to negotiate.\n\nSITUATION\n[What you are negotiating and with whom]\n\nMY TARGET\n[What outcome you want]\n\nWHAT I KNOW\n[Their position, alternatives you have, any leverage]\n\nGive me: an opening line, my strongest 2-3 arguments, likely pushback and how to answer it, and my walk-away point. Keep it conversational — phrases I can actually say.',
    ARRAY['negotiation', 'money', 'everyday'],
    ARRAY['web']
  ),
  (
    'Study Plan Builder',
    'Builds a study schedule that fits your deadline and current level',
    'Learning',
    'standard',
    E'You are a study coach. Build me a study plan.\n\nSUBJECT / EXAM\n[What you are studying for]\n\nDEADLINE & TIME AVAILABLE\n[Test date, hours per week you can commit]\n\nCURRENT LEVEL\n[What you already know, what feels weakest]\n\nGive me a week-by-week plan that prioritizes my weak areas, mixes learning with active practice, and ends with review time. Keep each week to 3-4 concrete tasks.',
    ARRAY['study', 'exam', 'learning'],
    ARRAY['web']
  ),
  (
    'Explain At My Level',
    'Explains any concept at exactly the depth you need',
    'Learning',
    'standard',
    E'Explain this concept to me.\n\nCONCEPT\n[What you want to understand]\n\nMY BACKGROUND\n[e.g. total beginner / know the basics / studied it years ago]\n\nWHY I''M ASKING\n[Exam, work, curiosity — helps calibrate depth]\n\nStart with the core idea in plain language, then build up one layer of detail. Use one concrete example. End by checking the most common misconception about it.',
    ARRAY['explain', 'concept', 'learning'],
    ARRAY['web']
  ),
  (
    'Quiz Me',
    'Turns any topic into an active-recall quiz session',
    'Learning',
    'standard',
    E'Quiz me for active recall practice.\n\nTOPIC\n[What to quiz you on]\n\nLEVEL\n[Intro course / advanced / professional]\n\nAsk me one question at a time and wait for my answer before continuing. After each answer, tell me what I got right, correct what I missed, and adjust difficulty based on how I am doing. Mix question styles: definitions, applications, and "why" questions.',
    ARRAY['quiz', 'practice', 'learning'],
    ARRAY['web']
  ),
  (
    'Resume Bullet Improver',
    'Rewrites your real experience into strong resume bullets — no invented metrics',
    'Career',
    'standard',
    E'You are a resume coach. Rewrite my experience into strong resume bullets.\n\nWHAT I ACTUALLY DID\n[Describe the work in your own words — tasks, tools, outcomes]\n\nTARGET ROLE\n[Job or field you are applying to]\n\nRewrite this as 3-5 bullets: action verb first, outcome-focused, tailored to the target role. Use only facts I gave you — where a number would strengthen a bullet, mark it like [X%] and tell me what to measure. Do not invent accomplishments.',
    ARRAY['resume', 'job', 'career'],
    ARRAY['web']
  ),
  (
    'LinkedIn Post Writer',
    'Drafts a LinkedIn post in your voice from a rough idea',
    'Career',
    'standard',
    E'Help me write a LinkedIn post.\n\nWHAT I WANT TO SHARE\n[The story, lesson, launch, or opinion]\n\nAUDIENCE & GOAL\n[Who should care, and what you want: discussion / visibility / leads]\n\nTONE\n[e.g. direct, personal, analytical — or paste a past post of mine to match]\n\nWrite a post with a strong first line (it gets cut off after ~2 lines), short paragraphs, and a closing question or takeaway. No hashtag spam — 3 relevant ones max. Give me 2 alternative opening lines.',
    ARRAY['linkedin', 'writing', 'career'],
    ARRAY['web']
  ),
  (
    'Cold Outreach Message',
    'Writes a short, non-cringe DM or email to a recruiter or contact',
    'Career',
    'standard',
    E'Help me write a cold outreach message.\n\nWHO I''M CONTACTING\n[Role and why them specifically]\n\nWHAT I WANT\n[Referral / advice call / intro / job interest]\n\nMY RELEVANT BACKGROUND\n[1-2 things that make you worth their time]\n\nWrite a message under 120 words: personal first line showing I did my homework, one line of credibility, one specific low-friction ask. No flattery padding. Give me one shorter follow-up message to send if they don''t reply in a week.',
    ARRAY['networking', 'outreach', 'career'],
    ARRAY['web']
  )
) AS v(name, description, category, tier, template, tags, platforms)
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_templates pt WHERE pt.name = v.name
);

-- Refresh search_text for all rows after insert
UPDATE prompt_templates
SET search_text = lower(
  coalesce(name, '') || ' ' ||
  coalesce(description, '') || ' ' ||
  coalesce(category, '') || ' ' ||
  coalesce(array_to_string(tags, ' '), '')
);
