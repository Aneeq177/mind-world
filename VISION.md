# Mind World — Vision & Long Term Roadmap

## The One-Line Vision
Mind World is the operating system for human knowledge — 
a layer that sits on top of all AI interactions and turns 
thousands of isolated conversations into a single growing 
body of thought that compounds over time.

## The Problem We Are Solving
Every day, millions of people have deeply valuable 
conversations with AI. They research problems, draft 
strategies, explore ideas, build things, and make 
decisions. All of that thinking disappears the moment 
they close the tab.

The AI remembers nothing. The human has to re-explain 
their situation from scratch every single time. Years 
of accumulated knowledge and context evaporates into 
nothing.

This is not just a personal problem. It is an 
organizational catastrophe. Companies lose billions 
of dollars of institutional knowledge every year when 
employees leave. New hires spend months trying to 
understand why decisions were made. Teams re-solve 
problems that were already solved. The thinking that 
happens inside AI conversations — which is where the 
most sophisticated problem-solving now occurs — is 
completely invisible and completely lost.

Mind World fixes this.

## What Mind World Is

### Layer 1 — Personal Memory
Your entire AI conversation history becomes a 
searchable, injectable memory layer. When you start 
a new conversation, Mind World surfaces what you 
already know. You never re-explain your situation 
from scratch. Every conversation you have makes the 
next one better.

### Layer 2 — Smart Prompt Engineering  
Mind World does not just retrieve your past 
conversations — it understands them. When you start 
typing, it reads your message, finds the most 
relevant context from your history, and engineers 
a complete, contextually-aware prompt that gets you 
dramatically better answers. The AI you talk to 
knows your background, your constraints, your goals, 
and what you have already tried.

### Layer 3 — Team Brain
When multiple people at a company use Mind World, 
their shared conversations form a collective 
intelligence. New employees do not read 200 Notion 
pages — they ask the company brain. Teams do not 
re-solve problems — they find who already solved 
them. Institutional knowledge stops evaporating 
when people leave.

### Layer 4 — Visual Knowledge Map
Every conversation is embedded using machine learning 
and positioned in a 2D semantic map. Similar topics 
cluster together. You can see your entire intellectual 
history as a navigable landscape. You can watch your 
thinking evolve over time using the time machine 
slider. You can identify patterns in your thinking 
you were not even aware of.

### Layer 5 — Agent Orchestration (Future)
The map becomes a visual control room for AI agents. 
Instead of chatting with one AI at a time, you set up 
assembly lines of specialized agents that pass work 
between each other automatically. The map shows which 
knowledge nodes agents are drawing from, where 
bottlenecks are, and what context is flowing between 
agents in real time. This is something no other 
interface provides.

## Current Product State (May 2026)

### What Is Built
- Chrome extension working on claude.ai, chatgpt.com, 
  gemini.google.com
- Auto-search as user types — surfaces relevant past 
  conversations in a sidebar
- Smart prompt engineering — Claude Haiku reads your 
  message and engineers a complete contextual prompt
- Auto-save — captures conversations automatically 
  as they happen
- 2D semantic map at mind-world.app — conversations 
  plotted by meaning, clustered by topic
- Time machine slider — watch your knowledge grow 
  over time
- Context blender — select multiple past conversations 
  and blend them into one focused chat
- Team workspaces — invite-based, share conversations 
  with teammates
- Company search — search across team members' 
  shared conversations
- Chrome Web Store submission pending

### What Is In Progress
- Company brain search reliability fix
- Auto-recluster for new auto-saved conversations
- Chrome Web Store approval

## The Roadmap

### Phase 1 — Personal Memory Layer (NOW)
Make the individual product work so well that people 
cannot imagine using AI without it.

Goals:
- 100 people with their own real data using the 
  extension daily
- Auto-save working reliably across all platforms
- Chrome Web Store live
- Prompt engineering producing noticeably better 
  AI responses

Success metric: People say "I can't use Claude 
without Mind World anymore"

### Phase 2 — Growth and Monetization (Months 1-2)
Turn early users into paying customers and grow 
the user base.

Pricing:
- Free: 500 conversations stored, 10 prompt 
  injections per day
- Pro ($9/month): unlimited storage, unlimited 
  injections, priority search, multi-device sync

Actions:
- Chrome Web Store launch post on LinkedIn
- Posts on r/ClaudeAI, r/ChatGPT, Hacker News, 
  Product Hunt
- Email campaign to existing Supabase users
- Stripe integration
- Usage tracking per user

Success metric: 10 paying Pro subscribers, 
1,000 Chrome Web Store installs

### Phase 3 — Team Brain (Months 2-3)
Build the B2B product on top of the personal layer.

The problem it solves: Every employee is having 
thousands of AI conversations every week. All of 
that thinking, research, and problem-solving 
disappears the moment they close the tab. Mind World 
captures it, organizes it, and makes it searchable 
by everyone in the company.

Features:
- Reliable company search across team conversations
- Org knowledge map — see which employees are the 
  knowledge centers for each topic cluster
- "Who knows about this?" — search a topic and see 
  which employees have been thinking about it most
- Knowledge health dashboard — see where knowledge 
  is concentrated, where gaps exist
- Knowledge transfer — when someone leaves, their 
  relevant work conversations are preserved

Pricing:
- Team: $49/user/month, minimum 5 seats
- Enterprise: custom pricing, SSO, dedicated instance

Why this is the real business:
- A 10-person company = $490/month
- A 50-person company = $2,500/month
- Ten companies = $25,000/month
- Companies never churn because switching means 
  losing institutional memory

Target first customers:
- AI-native startups (10-50 people, everyone uses 
  Claude/ChatGPT daily)
- Consulting firms (knowledge is literally their product)
- Research teams at universities
- Any company that has said "we have a knowledge 
  management problem"

Success metric: First paying company on Team plan

### Phase 4 — Proactive Intelligence (Month 3-4)
The extension stops being reactive and becomes 
proactive.

Features:
- Before you type, surfaces relevant past 
  conversations based on the website you are on
- Pattern detection: "You have been researching X 
  across 12 conversations — here is what you have 
  not figured out yet"
- Cross-conversation insight: "These 4 conversations 
  are all circling the same unresolved problem"
- Weekly digest: email summary of your thinking 
  patterns and unresolved threads
- Frontier suggestions: topics adjacent to your 
  interests you have never explored

### Phase 5 — Developer API (Month 4-5)
Become infrastructure, not just a tool.

Features:
- Public API: POST /api/search with API key auth
- Developers integrate Mind World memory into their 
  own apps
- Webhook support: get notified when new relevant 
  conversations are saved
- Pricing: per API call ($0.001 per search)

Why this matters: Other products build on top of 
your memory layer. Mind World becomes the memory 
infrastructure for the AI ecosystem.

### Phase 6 — Visual Agent Orchestration (Month 5-7)
The 2D map becomes a drag-and-drop workflow builder.

The concept: Instead of chatting with one AI at a 
time, you set up assembly lines of specialized AI 
agents that pass work between each other 
automatically. The map is the visual control room.

How it works:
1. Conversations in the map become knowledge nodes
2. You drag a Research Agent onto a knowledge cluster
3. You draw a visual connection to a Coding Agent
4. You hit Go — agents execute autonomously
5. You watch the workflow on the map in real time
6. Agents flag you only when they hit something 
   they cannot solve

Example personal workflow:
- You are building a new feature
- Research Agent reads all your past conversations 
  about that codebase
- Passes findings to Coding Agent with full context
- Coding Agent writes the implementation
- Review Agent checks for errors
- You get the result without copy-pasting once

Example company workflow:
- New client project starts
- Research Agent searches company brain for every 
  past conversation about similar clients
- Synthesis Agent combines findings into a briefing
- Strategy Agent drafts a proposal
- Team reviews and approves
- No one started from zero

Tech for this:
- Agent definitions stored in Supabase
- Workflow execution via FastAPI + async task queue
- Real-time status via WebSockets
- Visual workflow editor in the map (drag, connect, 
  execute)
- Agent marketplace — pre-built agents for 
  common tasks

### Phase 7 — The Platform (Month 8+)
Mind World becomes the operating system for 
AI-native work.

Features:
- Third-party agent marketplace
- Cross-company knowledge sharing with permission 
  controls
- Mind World for education — students build 
  knowledge maps across their entire degree
- Mind World for research — academic teams share 
  and build on each other's AI conversations
- API ecosystem — other products build memory 
  features powered by Mind World

## The Structural Moat
No single AI company can build cross-platform memory 
because it requires ingesting competitors' data. 
Anthropic cannot ingest ChatGPT conversations. 
OpenAI cannot ingest Claude conversations. A neutral 
third party can. That is Mind World's structural 
advantage. The more platforms it supports, the 
stronger the moat.

The company brain product has network effects. The 
more employees use it, the more valuable it becomes. 
A company that has 2 years of employee AI 
conversations stored is not switching to a 
competitor — that data is their institutional memory.

## The Acquisition Story
Who would buy Mind World:
- Anthropic / OpenAI — solves memory, makes their 
  platform stickier, cross-platform angle is their 
  blind spot
- Notion / Obsidian — new category of knowledge 
  management they do not own yet
- Microsoft — fits into Copilot + Teams strategy
- Salesforce — they already sell company brain 
  products, this is a natural extension

When to have acquisition conversations: After 1,000 
daily active users and $10K MRR. Not before.

## Key Metrics To Track
- Individual users with data in Supabase: target 100
- Daily active extension users: target 50
- Pro subscribers: target 10
- Chrome Web Store installs: target 1,000
- First paying company: target 1
- Companies on Team plan: target 10
- MRR: target $10,000

## The One Thing That Matters Right Now
Get 100 people with their own real data using the 
extension every single day. Everything else — 
the team brain, the agent orchestration, the API, 
the acquisition — follows from that. Without real 
daily users, nothing else matters.

The extension is the product. The map is the story. 
The team brain is the business.