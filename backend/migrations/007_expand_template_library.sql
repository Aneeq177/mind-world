-- Run in Supabase SQL Editor
-- Expands prompt_templates for searchable library (tags, platforms, search_text, use_count)

ALTER TABLE prompt_templates
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

ALTER TABLE prompt_templates
  ADD COLUMN IF NOT EXISTS platforms TEXT[] DEFAULT '{web}';

ALTER TABLE prompt_templates
  ADD COLUMN IF NOT EXISTS use_count INTEGER DEFAULT 0;

ALTER TABLE prompt_templates
  ADD COLUMN IF NOT EXISTS search_text TEXT;

-- Backfill search_text for existing rows
UPDATE prompt_templates
SET search_text = lower(
  coalesce(name, '') || ' ' ||
  coalesce(description, '') || ' ' ||
  coalesce(category, '') || ' ' ||
  coalesce(array_to_string(tags, ' '), '')
)
WHERE search_text IS NULL OR search_text = '';

-- Seed expanded template library (skip if name already exists)
INSERT INTO prompt_templates (name, description, category, tier, template, tags, platforms, search_text)
SELECT v.name, v.description, v.category, v.tier, v.template, v.tags, v.platforms,
  lower(v.name || ' ' || v.description || ' ' || v.category || ' ' || array_to_string(v.tags, ' '))
FROM (VALUES
  (
    'SQL Query Builder',
    'Writes optimized SQL from natural language requirements',
    'Engineering',
    'standard',
    E'You are an expert database engineer. Write a SQL query for the requirement below.\n\nREQUIREMENTS\n[Describe what data you need]\n\nDATABASE\n- Engine (Postgres/MySQL/SQLite): [FILL IN]\n- Relevant tables/columns: [FILL IN]\n\nOUTPUT\n1) The SQL query with comments\n2) Brief explanation of joins/filters\n3) Index suggestions if performance matters',
    ARRAY['sql', 'database', 'query'],
    ARRAY['web', 'vscode']
  ),
  (
    'Regex Builder',
    'Creates and explains regular expressions for a pattern',
    'Engineering',
    'standard',
    E'You are a regex expert. Build a regular expression for my use case.\n\nUSE CASE\n[Describe what you want to match]\n\nLANGUAGE\n[JavaScript/Python/etc.]\n\nOUTPUT\n1) The regex pattern\n2) Explanation of each part\n3) 3 example strings that match and 2 that do not',
    ARRAY['regex', 'pattern', 'code'],
    ARRAY['web', 'vscode']
  ),
  (
    'API Design Review',
    'Reviews REST/GraphQL API designs for consistency and usability',
    'Engineering',
    'standard',
    E'You are a senior API architect. Review this API design.\n\nAPI DESCRIPTION\n[Paste endpoints, schemas, or OpenAPI snippet]\n\nEVALUATE\n- Naming consistency\n- Error handling\n- Versioning\n- Security concerns\n- Developer experience\n\nOUTPUT: prioritized issues + concrete fixes',
    ARRAY['api', 'rest', 'architecture'],
    ARRAY['web', 'vscode']
  ),
  (
    'Unit Test Generator',
    'Generates focused unit tests for a function or module',
    'Engineering',
    'standard',
    E'You are a test-driven development expert. Write unit tests for the code below.\n\nFRAMEWORK\n[Jest/pytest/etc.]\n\nCODE\n[PASTE CODE]\n\nOUTPUT\n1) Test cases covering happy path, edge cases, and errors\n2) Brief note on what each test validates\n3) Any mocks or fixtures needed',
    ARRAY['testing', 'unit-test', 'code'],
    ARRAY['vscode', 'web']
  ),
  (
    'Refactoring Plan',
    'Plans a safe step-by-step refactor for legacy code',
    'Engineering',
    'standard',
    E'You are a staff engineer planning a safe refactor.\n\nCODE / MODULE\n[Describe or paste code]\n\nGOAL\n[What you want to improve]\n\nOUTPUT\n1) Current problems (ranked)\n2) Refactor steps in order (small, shippable PRs)\n3) Risks and how to mitigate\n4) Tests to add before changing behavior',
    ARRAY['refactor', 'legacy', 'code'],
    ARRAY['vscode', 'web']
  ),
  (
    'Bug Report Writer',
    'Turns rough notes into a clear bug report for engineers',
    'Engineering',
    'standard',
    E'You are a QA lead. Turn my notes into a clear bug report.\n\nNOTES\n[Paste rough description]\n\nOUTPUT FORMAT\n- Title\n- Environment\n- Steps to reproduce\n- Expected vs actual\n- Severity suggestion\n- Screenshots/logs to attach (if any)',
    ARRAY['bug', 'qa', 'engineering'],
    ARRAY['web', 'vscode']
  ),
  (
    'Technical Doc Writer',
    'Writes clear technical documentation from bullet notes',
    'Writing',
    'standard',
    E'You are a technical writer. Turn my notes into polished documentation.\n\nAUDIENCE\n[Developers / end users / mixed]\n\nNOTES\n[Paste bullet points or rough draft]\n\nOUTPUT\n- Overview\n- Prerequisites\n- Step-by-step instructions\n- Troubleshooting section\n- FAQ (3 items)',
    ARRAY['documentation', 'technical-writing'],
    ARRAY['web', 'vscode']
  ),
  (
    'Blog Post Outliner',
    'Creates a structured outline for a technical or thought-leadership post',
    'Writing',
    'standard',
    E'You are an editor for technical blogs. Create an outline for this post idea.\n\nTOPIC\n[FILL IN]\n\nAUDIENCE\n[FILL IN]\n\nGOAL\n[Inform / persuade / teach]\n\nOUTPUT\n- Working title (3 options)\n- Hook paragraph\n- Section headings with 2-3 bullets each\n- Suggested CTA',
    ARRAY['blog', 'outline', 'writing'],
    ARRAY['web']
  ),
  (
    'Tone Rewriter',
    'Rewrites text in a different tone while preserving meaning',
    'Writing',
    'standard',
    E'You are an expert editor. Rewrite the text below in the requested tone.\n\nTARGET TONE\n[Professional / friendly / concise / persuasive]\n\nORIGINAL TEXT\n[PASTE TEXT]\n\nRULES\n- Preserve facts and intent\n- Do not add new claims\n- Output only the rewritten text',
    ARRAY['rewrite', 'tone', 'editing'],
    ARRAY['web']
  ),
  (
    'Executive Summary',
    'Condenses long content into a one-page executive summary',
    'Writing',
    'standard',
    E'You are a strategy consultant. Write a one-page executive summary.\n\nSOURCE MATERIAL\n[Paste document or notes]\n\nOUTPUT\n- Situation (2-3 sentences)\n- Key findings (5 bullets)\n- Recommendations (3 bullets)\n- Risks / open questions',
    ARRAY['summary', 'business', 'writing'],
    ARRAY['web']
  ),
  (
    'LinkedIn Post',
    'Drafts an engaging LinkedIn post from a topic or achievement',
    'Career',
    'standard',
    E'You are a LinkedIn content strategist. Write a post from my notes.\n\nTOPIC / ACHIEVEMENT\n[FILL IN]\n\nVOICE\n[Professional but human / thought-leader / humble]\n\nOUTPUT\n- Hook line\n- Short post (150-250 words)\n- 3 hashtag suggestions\n- Optional shorter version (under 80 words)',
    ARRAY['linkedin', 'social', 'career'],
    ARRAY['web']
  ),
  (
    'Salary Negotiation',
    'Prepares talking points for salary or offer negotiation',
    'Career',
    'standard',
    E'You are a career negotiation coach. Help me prepare for this conversation.\n\nROLE / OFFER\n[FILL IN]\n\nMY LEVERAGE\n[Experience, competing offers, unique skills]\n\nOUTPUT\n1) Target range rationale\n2) Scripts for asking and countering\n3) Non-salary items to negotiate\n4) What to avoid saying',
    ARRAY['salary', 'negotiation', 'career'],
    ARRAY['web']
  ),
  (
    'STAR Interview Answer',
    'Structures an interview answer using STAR method',
    'Career',
    'standard',
    E'You are an interview coach. Help me craft a STAR answer.\n\nQUESTION\n[FILL IN]\n\nMY ROUGH STORY\n[FILL IN]\n\nOUTPUT\n- Situation (2 sentences)\n- Task\n- Action (specific steps I took)\n- Result (metrics if possible)\n- 30-second spoken version',
    ARRAY['interview', 'star', 'career'],
    ARRAY['web']
  ),
  (
    'Networking Message',
    'Writes a concise outreach message for networking or informational interviews',
    'Career',
    'standard',
    E'You are a career coach. Write a short networking message.\n\nCONTEXT\n[How I found them / mutual connection]\n\nMY GOAL\n[Learn about role / advice / referral]\n\nOUTPUT\n- Subject line (if email)\n- Message under 120 words\n- Clear, low-friction ask',
    ARRAY['networking', 'outreach', 'career'],
    ARRAY['web']
  ),
  (
    'Literature Review',
    'Synthesizes sources into a structured literature review section',
    'Research',
    'standard',
    E'You are an academic researcher. Help me synthesize these sources.\n\nTOPIC\n[FILL IN]\n\nSOURCES / NOTES\n[Paste summaries or citations]\n\nOUTPUT\n- Thematic paragraphs (not one source per paragraph)\n- Gaps in the literature\n- Suggested research questions',
    ARRAY['research', 'academic', 'literature'],
    ARRAY['web']
  ),
  (
    'Fact Checker',
    'Checks claims and lists what needs verification',
    'Research',
    'standard',
    E'You are a careful fact-checker. Review the claims below.\n\nTEXT\n[PASTE CLAIMS OR DRAFT]\n\nOUTPUT\nFor each major claim:\n- Verdict: Supported / Unclear / Likely wrong\n- What evidence would verify it\n- Safer wording if uncertain\n\nDo not invent citations.',
    ARRAY['fact-check', 'research', 'accuracy'],
    ARRAY['web']
  ),
  (
    'Compare Options',
    'Builds a comparison table for two or more options',
    'Research',
    'standard',
    E'You are an analyst. Compare these options objectively.\n\nOPTIONS\n[List options]\n\nCRITERIA THAT MATTER TO ME\n[FILL IN]\n\nOUTPUT\n1) Comparison table (criteria × options)\n2) Tradeoffs summary\n3) Recommendation based on my stated priorities (not generic)',
    ARRAY['compare', 'analysis', 'decision'],
    ARRAY['web']
  ),
  (
    'Meeting Agenda',
    'Creates a focused agenda with time boxes and outcomes',
    'Business',
    'standard',
    E'You are an executive assistant. Create a meeting agenda.\n\nMEETING PURPOSE\n[FILL IN]\n\nATTENDEES\n[FILL IN]\n\nDURATION\n[FILL IN]\n\nOUTPUT\n- Objective (one sentence)\n- Agenda items with time boxes\n- Pre-reads needed\n- Desired decisions / outputs',
    ARRAY['meeting', 'agenda', 'business'],
    ARRAY['web']
  ),
  (
    'OKR Draft',
    'Drafts OKRs from team goals and constraints',
    'Business',
    'standard',
    E'You are a product leader. Draft OKRs for this team.\n\nTEAM / QUARTER\n[FILL IN]\n\nTOP PRIORITIES\n[FILL IN]\n\nOUTPUT\n- 1 Objective with 3 Key Results\n- Each KR measurable and time-bound\n- Risks to hitting KRs',
    ARRAY['okr', 'goals', 'business'],
    ARRAY['web']
  ),
  (
    'Stakeholder Update',
    'Writes a concise status update for stakeholders',
    'Business',
    'standard',
    E'You are a project lead. Write a stakeholder update.\n\nPROJECT\n[FILL IN]\n\nRAW NOTES\n[What happened, blockers, next steps]\n\nOUTPUT\n- TL;DR (2 sentences)\n- Progress (bullets)\n- Risks / blockers\n- Asks from leadership\n- Next milestones',
    ARRAY['status', 'stakeholder', 'business'],
    ARRAY['web']
  ),
  (
    'User Story Writer',
    'Writes INVEST-compliant user stories with acceptance criteria',
    'Business',
    'standard',
    E'You are an agile product owner. Write user stories from this requirement.\n\nFEATURE / REQUIREMENT\n[FILL IN]\n\nOUTPUT\nFor each story:\n- As a / I want / So that\n- Acceptance criteria (Given/When/Then)\n- Notes on edge cases',
    ARRAY['agile', 'user-story', 'product'],
    ARRAY['web', 'vscode']
  ),
  (
    'Naming Brainstorm',
    'Generates name ideas for a product, feature, or company',
    'Creative',
    'standard',
    E'You are a branding consultant. Brainstorm names.\n\nWHAT WE ARE NAMING\n[FILL IN]\n\nVIBE\n[Modern / playful / serious / technical]\n\nCONSTRAINTS\n[Length, domain, avoid X]\n\nOUTPUT\n- 15 name ideas grouped by style\n- Top 3 with pros/cons\n- Tagline option for each top pick',
    ARRAY['naming', 'branding', 'creative'],
    ARRAY['web']
  ),
  (
    'Story Premise',
    'Develops a story premise with conflict and stakes',
    'Creative',
    'standard',
    E'You are a fiction writing coach. Develop this premise.\n\nSEED IDEA\n[FILL IN]\n\nGENRE\n[FILL IN]\n\nOUTPUT\n- Logline\n- Protagonist goal and flaw\n- Antagonistic force\n- Act 1 ending hook\n- 3 possible twists',
    ARRAY['fiction', 'story', 'creative'],
    ARRAY['web']
  ),
  (
    'Ad Copy Variations',
    'Writes multiple ad copy variants for A/B testing',
    'Creative',
    'standard',
    E'You are a performance marketer. Write ad copy variants.\n\nPRODUCT / OFFER\n[FILL IN]\n\nAUDIENCE\n[FILL IN]\n\nCHANNEL\n[Google / Meta / LinkedIn]\n\nOUTPUT\n- 5 headline options (under 40 chars where needed)\n- 3 primary text variants\n- Suggested CTA',
    ARRAY['marketing', 'ads', 'copy'],
    ARRAY['web']
  ),
  (
    'Excel Formula Helper',
    'Writes Excel or Google Sheets formulas from plain English',
    'Data',
    'standard',
    E'You are a spreadsheet expert. Write the formula I need.\n\nGOAL\n[Describe calculation in plain English]\n\nSHEET LAYOUT\n[Column names / example cells]\n\nPLATFORM\n[Excel / Google Sheets]\n\nOUTPUT\n1) The formula\n2) Step-by-step explanation\n3) Common mistakes to avoid',
    ARRAY['excel', 'spreadsheet', 'formula'],
    ARRAY['web']
  ),
  (
    'Data Analysis Plan',
    'Plans an analysis approach before writing code',
    'Data',
    'standard',
    E'You are a data scientist. Plan an analysis before coding.\n\nQUESTION\n[What we want to learn]\n\nDATA AVAILABLE\n[Tables, columns, sample size]\n\nOUTPUT\n1) Hypotheses\n2) Metrics and segments\n3) Methods (SQL, viz, stats)\n4) Pitfalls (bias, missing data)\n5) Deliverable outline',
    ARRAY['data', 'analysis', 'statistics'],
    ARRAY['web', 'vscode']
  ),
  (
    'Chart Explainer',
    'Explains what a chart shows and what actions to take',
    'Data',
    'standard',
    E'You are a data analyst presenting to executives. Explain this chart.\n\nCHART DESCRIPTION OR DATA\n[Paste or describe]\n\nOUTPUT\n- What happened (2 sentences)\n- Why it might matter\n- 2 recommended actions\n- What additional data would strengthen the conclusion',
    ARRAY['chart', 'visualization', 'data'],
    ARRAY['web']
  ),
  (
    'Socratic Tutor',
    'Teaches through questions instead of giving direct answers',
    'Academic',
    'standard',
    E'You are a Socratic tutor. Help me learn this topic by asking questions.\n\nTOPIC\n[FILL IN]\n\nMY LEVEL\n[Beginner / intermediate]\n\nRULES\n- Ask one question at a time\n- Wait for my answer before continuing\n- Give hints, not full solutions\n- After 5 exchanges, summarize what I learned',
    ARRAY['tutoring', 'learning', 'education'],
    ARRAY['web']
  ),
  (
    'Exam Cram Sheet',
    'Creates a one-page cram sheet from notes or syllabus',
    'Academic',
    'standard',
    E'You are a study coach. Create a one-page cram sheet.\n\nSUBJECT / EXAM\n[FILL IN]\n\nNOTES OR SYLLABUS\n[PASTE]\n\nOUTPUT\n- Key definitions\n- Formulas / frameworks\n- Common mistake traps\n- 5 practice questions with brief answers',
    ARRAY['exam', 'study', 'academic'],
    ARRAY['web']
  ),
  (
    'Explain Like Im Five',
    'Explains complex topics in simple language',
    'Academic',
    'standard',
    E'Explain the topic below as if to a smart 12-year-old.\n\nTOPIC\n[FILL IN]\n\nOUTPUT\n- Simple explanation (no jargon)\n- One analogy\n- One real-world example\n- "If you remember one thing" summary',
    ARRAY['explain', 'simple', 'learning'],
    ARRAY['web']
  ),
  (
    'Pitch Deck Narrative',
    'Structures the narrative for a startup pitch deck',
    'Business',
    'standard',
    E'You are a startup advisor. Structure a pitch deck narrative.\n\nSTARTUP\n[Problem, solution, traction]\n\nAUDIENCE\n[Investors / customers]\n\nOUTPUT\nSlide-by-slide: title + 3 bullets of what to say\nCover: Problem, Solution, Market, Product, Traction, Team, Ask',
    ARRAY['pitch', 'startup', 'business'],
    ARRAY['web']
  ),
  (
    'Customer Reply',
    'Drafts empathetic replies to customer complaints or questions',
    'Professional',
    'standard',
    E'You are a customer success lead. Draft a reply.\n\nCUSTOMER MESSAGE\n[PASTE]\n\nOUR POLICY / FACTS\n[FILL IN]\n\nTONE\n[Apologetic / firm but kind / celebratory]\n\nOUTPUT\n- Reply email\n- Internal note on root cause if applicable',
    ARRAY['customer', 'support', 'email'],
    ARRAY['web']
  ),
  (
    'Meeting Notes to Actions',
    'Turns messy meeting notes into action items and owners',
    'Business',
    'standard',
    E'You are a chief of staff. Structure these meeting notes.\n\nRAW NOTES\n[PASTE]\n\nOUTPUT\n- Summary (3 bullets)\n- Decisions made\n- Action items (owner, due date, status)\n- Open questions\n- Suggested follow-up email draft',
    ARRAY['meeting', 'notes', 'actions'],
    ARRAY['web']
  ),
  (
    'PR Description',
    'Writes a clear pull request description for reviewers',
    'Engineering',
    'standard',
    E'You are a senior engineer. Write a PR description from my changes.\n\nWHAT CHANGED\n[Summary or diff notes]\n\nWHY\n[Motivation]\n\nOUTPUT\n- Title\n- Summary\n- Test plan checklist\n- Screenshots / rollout notes if needed\n- Breaking changes (if any)',
    ARRAY['pull-request', 'github', 'engineering'],
    ARRAY['vscode', 'web']
  ),
  (
    'Commit Message',
    'Writes conventional commit messages from a change summary',
    'Engineering',
    'standard',
    E'You are a git expert. Write a conventional commit message.\n\nCHANGES\n[Describe what changed]\n\nOUTPUT\n- Subject line (50 chars max, imperative mood)\n- Body with context and rationale\n- Footer for breaking changes or issue refs if needed',
    ARRAY['git', 'commit', 'engineering'],
    ARRAY['vscode', 'web']
  ),
  (
    'Security Review',
    'Quick security review checklist for code or design',
    'Engineering',
    'standard',
    E'You are an application security engineer. Review for security issues.\n\nSCOPE\n[Code snippet, API, or feature description]\n\nCHECK\n- Injection, authz, secrets, SSRF, XSS\n- Data exposure\n- Dependency risks\n\nOUTPUT: findings by severity + remediation',
    ARRAY['security', 'review', 'engineering'],
    ARRAY['vscode', 'web']
  ),
  (
    'Product FAQ',
    'Generates FAQ entries from product docs or rough notes',
    'Business',
    'standard',
    E'You are a product marketer. Create an FAQ.\n\nPRODUCT\n[FILL IN]\n\nSOURCE NOTES\n[PASTE]\n\nOUTPUT\n10 Q&A pairs ordered from most common to advanced. Keep answers under 80 words each.',
    ARRAY['faq', 'product', 'support'],
    ARRAY['web']
  ),
  (
    'Competitive Analysis',
    'Compares your product against competitors on key dimensions',
    'Business',
    'standard',
    E'You are a product strategist. Compare us to competitors.\n\nOUR PRODUCT\n[FILL IN]\n\nCOMPETITORS\n[List 2-4]\n\nOUTPUT\n- Comparison table (features, pricing, positioning)\n- Our strengths and gaps\n- Messaging angles against each competitor',
    ARRAY['competitive', 'strategy', 'business'],
    ARRAY['web']
  ),
  (
    'Weekly Plan',
    'Turns goals into a realistic weekly plan with time blocks',
    'Professional',
    'standard',
    E'You are a productivity coach. Build my weekly plan.\n\nTOP 3 GOALS THIS WEEK\n[FILL IN]\n\nCONSTRAINTS\n[Meetings, deadlines, energy]\n\nOUTPUT\n- Day-by-day priorities (not hour-by-hour unless asked)\n- What to defer\n- One habit to protect',
    ARRAY['planning', 'productivity', 'weekly'],
    ARRAY['web']
  ),
  (
    'Feedback Giver',
    'Helps deliver constructive feedback to a colleague',
    'Professional',
    'standard',
    E'You are an HR coach. Help me give constructive feedback.\n\nSITUATION\n[What happened]\n\nRELATIONSHIP\n[Peer / report / manager]\n\nOUTPUT\n- SBI framework draft (Situation, Behavior, Impact)\n- Suggested phrasing\n- What to avoid\n- Follow-up question to invite dialogue',
    ARRAY['feedback', 'management', 'professional'],
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

CREATE INDEX IF NOT EXISTS idx_prompt_templates_search_text
  ON prompt_templates USING gin (to_tsvector('english', coalesce(search_text, '')));

CREATE INDEX IF NOT EXISTS idx_prompt_templates_category
  ON prompt_templates (category);
