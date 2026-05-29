# Mind World Backlog
Last updated: May 2026
Sprint: 1

## 🔴 QA Re-Assignments (Must Fix First)

---
ID: MW-011
Title: Fix QA Code Cleanup Failures (Backend)
Agent: Backend
Priority: P0 Critical
Status: ✅ Complete
Blocked by: nothing

Description:
QA Report (62c97332) returned "NEEDS WORK". Multiple code cleanup failures were identified in the backend:
- `backend/main.py` (Line 12): Unused `ProcessResponse` and `BlendResponse` imports.
- `backend/services/database.py` (Line 38): Duplicate `import numpy as np`.
- `backend/services/embedder.py` (Line 66): Duplicate `from sentence_transformers import SentenceTransformer`.
- `backend/services/blender.py` (Line 3): Unused `import os`.

Acceptance criteria:
- Remove all specified unused and duplicate imports.
- Ensure backend code is clean for production.

Notes for agent:
This is a QA rejection. Fix this before picking up any new sprint work.
---

---
ID: MW-012
Title: Fix QA Code Cleanup Failures (Extension/Frontend)
Agent: Frontend
Priority: P0 Critical
Status: ✅ Complete
Blocked by: nothing

Description:
QA Report (62c97332) returned "NEEDS WORK". Multiple debug logs and hardcoded URLs were left in production code:
- `extension/background.js`: Remove 7 `console.log` statements starting with "Mind World:". Fix hardcoded URL on Line 1.
- `extension/content.js`: Remove 11 `console.log` statements starting with "Mind World:".
- `extension/popup.js`: Fix hardcoded URLs on lines 1, 2.
- `frontend/src/api.js`: Fix hardcoded backend URL on Line 1.

Acceptance criteria:
- All debug `console.log("Mind World:...")` statements are removed from extension files.
- Hardcoded URLs are replaced with central configuration constants or environment variables (e.g. `import.meta.env.VITE_API_URL`).

Notes for agent:
This is a QA rejection. Fix this before picking up any new sprint work.
---

## 🔴 P0 — Critical

---
ID: MW-001
Title: Fix Company Search filtering logic and user_id mapping
Agent: Backend
Priority: P0 Critical
Status: To Do
Blocked by: nothing

Description:
The `/company_search` endpoint is returning no results even though conversations are marked `visibility='team'` and users share a workspace. The root cause is suspected to be a mismatch between the `user_id` in the `conversations` table and the `users` table, or a bug in the `match_company_conversations` Supabase RPC function.

Acceptance criteria:
- `/company_search` successfully returns relevant team-visible conversations from other users in the same workspace.
- The `user_id` mapping is verified and corrected for stored conversations.

Notes for agent:
Focus on the `/company_search` endpoint in `backend/main.py` and the Supabase RPC parameters. Add logging to verify parameters being passed.
---

---
ID: MW-002
Title: Trigger auto-recluster on new conversation save
Agent: Backend
Priority: P0 Critical
Status: ✅ Complete
Blocked by: nothing

Description:
Auto-saved conversations get x=0 y=0 coordinates. /recluster exists but must be called manually. Should trigger automatically when new conversations are saved so they don't pile up.

Acceptance criteria:
- After a new conversation is auto-saved, its position on the map reflects semantic meaning.
- No conversations sit at 0,0 on the map.

Notes for agent:
Consider using FastAPI BackgroundTasks in `/save_conversation` so as not to block the extension request.
---

## 🟠 P1 — High Priority

---
ID: MW-003
Title: Fix mobile responsive layout for three-column design
Agent: Frontend
Priority: P1 High
Status: ✅ Complete
Blocked by: nothing

Description:
The three-column layout breaks on screens under 768px. Need a single column layout for mobile to ensure a good experience for the 100 DAUs.

Acceptance criteria:
- Map fills screen on iPhone and Android.
- Sidebars work as bottom sheets on mobile.
- No horizontal scrolling or overlapping elements.

Notes for agent:
Check `frontend/src/App.jsx` and the Tailwind classes used for the main layout grid.
---

---
ID: MW-004
Title: Chrome Web Store approval follow-up
Agent: Human
Priority: P1 High
Status: To Do
Blocked by: nothing

Description:
Check approval status. If rejected, fix issues and resubmit same day.

Acceptance criteria:
- Extension live on Chrome Web Store with install link.

Notes for agent:
This is the primary external blocker.
---

## 🟡 P2 — Medium Priority

---
ID: MW-005
Title: Implement Company World / My World toggle on map
Agent: Frontend
Priority: P2 Medium
Status: To Do
Blocked by: MW-001

Description:
Add My World / Team World toggle to map top bar. Team World shows team members' shared conversations with initials labels.

Acceptance criteria:
- Toggle button visible in top bar.
- Clicking Team World loads company conversations.
- Each dot shows owner initials on hover.

Notes for agent:
Do not start this until the Backend agent verifies that company data can be successfully retrieved (MW-001).
---

---
ID: MW-006
Title: Semantic search on map
Agent: Frontend
Priority: P2 Medium
Status: ✅ Complete
Blocked by: nothing

Description:
Search box above map that highlights matching conversations and fades others.

Acceptance criteria:
- Matching dots stay at full opacity.
- Non-matching dots fade to 0.1 opacity.
- Clears on empty search.

Notes for agent:
Ensure visual updates are smooth via Plotly.
---

## 🟢 P3 — Low Priority

---
ID: MW-007
Title: Implement Stripe monetization flow
Agent: Architect
Priority: P3 Low
Status: To Do
Blocked by: MW-002, MW-004

Description:
We need to design the monetization flow for Phase 2 (Pro tier at $9/month) before agents start coding it. This involves defining database schema changes for subscription states, usage limits, and webhook handling.

Acceptance criteria:
- Architectural spec for Stripe integration is written.
- Required database schema changes are mapped out.

Notes for agent:
Keep it simple. Free vs Pro tier only.
---

---
ID: MW-008
Title: Weekly digest email
Agent: Backend
Priority: P3 Low
Status: To Do
Blocked by: MW-007

Description:
Weekly email summarizing thinking patterns and unresolved threads.

Acceptance criteria:
- Users receive a weekly digest of their patterns.

Notes for agent:
Depends on Pro tier state if we make this a Pro feature.
---