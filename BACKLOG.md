# Mind World Backlog
Last updated: May 2026
Sprint: 1

## 🔴 P0 — Critical

MW-001
Title: Fix company search returning no results
Agent: Backend
Blocked by: nothing
Description: /company_search returns empty results 
despite 424 conversations marked visibility='team' 
and both test users in same company_id. Suspected 
user_id mismatch in conversations table.
Acceptance criteria:
- Search returns at least 1 result when team member 
  searches a topic they have discussed
- Verified in browser with Network tab showing 
  non-empty results array

MW-002  
Title: Auto-trigger recluster after auto-save
Agent: Backend
Blocked by: nothing
Description: Auto-saved conversations get x=0 y=0 
coordinates. /recluster exists but must be called 
manually. Should trigger automatically when new 
conversations are saved.
Acceptance criteria:
- After a new conversation is auto-saved, its 
  position on the map reflects semantic meaning
- No conversations sitting at 0,0 on the map

## 🟠 P1 — High Priority

MW-003
Title: Company World toggle on map
Agent: Frontend
Blocked by: MW-001
Description: Add My World / Team World toggle to 
map top bar. Team World shows team members' shared 
conversations with initials labels.
Acceptance criteria:
- Toggle button visible in top bar
- Clicking Team World loads company conversations
- Each dot shows owner initials on hover

MW-004
Title: Chrome Web Store approval follow-up
Agent: Human
Blocked by: external
Description: Check approval status. If rejected, 
fix issues and resubmit same day.
Acceptance criteria:
- Extension live on Chrome Web Store with install link

MW-005
Title: Mobile responsive layout
Agent: Frontend
Blocked by: nothing
Description: Three column layout breaks on screens 
under 768px. Need single column layout for mobile.
Acceptance criteria:
- Map fills screen on iPhone and Android
- Sidebars work as bottom sheets on mobile
- Time slider usable on touch screen

## 🟡 P2 — Medium Priority

MW-006
Title: Stripe integration for Pro plan
Agent: Backend + Frontend
Blocked by: MW-004
Description: Add $9/month Pro tier with usage limits
Acceptance criteria:
- Stripe checkout flow works
- Free tier limited to 500 conversations stored
- Pro tier has unlimited storage

MW-007
Title: Semantic search on map
Agent: Frontend
Blocked by: nothing
Description: Search box above map that highlights 
matching conversations and fades others
Acceptance criteria:
- Matching dots stay at full opacity
- Non-matching dots fade to 0.1 opacity
- Clears on empty search

## 🟢 P3 — Nice to Have

MW-008
Title: Weekly digest email
Agent: Backend
Blocked by: MW-006
Description: Weekly email summarizing thinking 
patterns and unresolved threads

MW-009
Title: Landing page demo video
Agent: Human
Blocked by: MW-004
Description: Record 60 second screen recording 
of extension working for LinkedIn post

## ✅ Completed
- Chrome extension auto-save working
- Engineer Prompt feature working
- Team workspaces (invite-based)
- Share conversations with team
- 2D map with time slider
- Context blender
- mind-world.app domain live
- Privacy policy and terms live
- Chrome Web Store submitted

## 🚫 Blocked On External
- Chrome Web Store approval (MW-004)
- LinkedIn launch post (waiting on MW-004)
- Community posts on Reddit/HN (waiting on MW-004)
- Pro plan launch email (waiting on MW-006)