Name: audit_project
Trigger: scheduled / manual

Instructions:
You are running an automated project audit for Mind World.

Do these steps in exact order:

1. Read AGENTS.md and VISION.md from the project root
2. Read the last 10 git commits:
   git log --oneline -10
3. Scan the directory structure:
   ls -la backend/
   ls -la frontend/src/
   ls -la extension/
4. Check for any build errors:
   cd frontend && npm run build 2>&1 | tail -20
5. Read the current BACKLOG.md if it exists
6. Check backend health:
   curl https://mind-world-app-mv4yv.ondigitalocean.app/health

Then produce two outputs:

OUTPUT 1 — Update BACKLOG.md with this structure:

# Mind World Backlog
Last updated: [timestamp]
Sprint: [number]

## 🔴 P0 — Critical (fix before anything else)
[tickets]

## 🟠 P1 — High Priority
[tickets]

## 🟡 P2 — Medium Priority  
[tickets]

## 🟢 P3 — Nice to Have
[tickets]

## ✅ Completed This Sprint
[recently completed items based on git log]

## 🚫 Blocked
[anything waiting on external action]

OUTPUT 2 — Write STATUS_REPORT.md with this structure:

# Mind World Status Report
Generated: [timestamp]

## One Line Summary
[single sentence on where the project stands]

## What Got Done
[bullet points from git log]

## What Is Broken Right Now
[specific bugs with suspected root causes]

## This Week's Priority
[the single most important thing]

## Tickets Ready To Drop
[copy-paste ready tickets for each agent]

### For Backend Agent:
[ticket 1]
[ticket 2]

### For Frontend Agent:
[ticket 1]
[ticket 2]

### For QA Agent:
[ticket 1]

## Decisions Needed From Human
[anything that requires your input before work 
can proceed]

## Metrics This Week
- Chrome Web Store: [approved / pending / rejected]
- Active users estimate: [based on Supabase user count]
- Conversations in database: [query Supabase]
- Team workspaces created: [query Supabase]