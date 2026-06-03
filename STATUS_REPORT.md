# Mind World Status Report
Date: May 2026

## STEP 1 — AUDIT
I have reviewed the repository architecture across `/backend` (FastAPI), `/frontend` (React/Vite), and `/extension` (Manifest V3). 
- **Built & Working**: Extension logic, semantic search, prompt engineering, core map UI, company search RPC (`/company_search`), and Company World map toggle.
- **Built but Broken**: Nothing currently tracked.
- **Built but Incomplete**: None.
- **Not Started**: Monetization (Stripe), weekly digest emails.

## STEP 2 — IDENTIFY THE MILESTONE
**Current Phase:** Phase 4 (Extension Pivot). 
**North Star Metric:** Users getting noticeably better responses from their LLMs using our extension's prompt engineering templates.
**Sprint Goal:** Transition away from the company knowledge graph and begin building the core Template Library and Custom Prompt Builder UI.

## STEP 3 — TICKETS (Tickets Ready To Drop)

### For Backend Engineer:
---
ID: MW-018
Title: Build Personal Profiles & Prompt Templates Database Schema
Agent: Backend Engineer
Priority: P0 Critical
Blocked by: None

Description:
To support the new Extension-first vision, we need to introduce the `personal_profiles` and `prompt_templates` tables to Supabase.

Acceptance criteria:
- Create a python migration script to add the `personal_profiles` table (linked to `users`, holding a JSONB column for profile data like goals, background, constraints, AND a boolean flag `is_profile_enabled` default false).
- Create a python migration script to add the `prompt_templates` table.
- Build a new FastAPI endpoint `GET /templates` that returns the templates.
- Update `POST /engineer_prompt` to fetch the user's `personal_profile`. ONLY inject this context if `is_profile_enabled` is true.
- Build a settings endpoint `POST /update_profile_settings` to allow the user to toggle `is_profile_enabled`.

Notes for agent:
Use the `run_command` tool to test the endpoints locally and ensure the database migrations run cleanly.
---

### For Frontend Engineer:
---
ID: MW-019
Title: Build Prompt Engineering UI in Extension Popup
Agent: Frontend Engineer
Priority: P0 Critical
Blocked by: None

Description:
The Chrome Extension popup is transitioning from a simple settings panel to the core Custom Prompt Builder interface. 

Acceptance criteria:
- In `extension/popup.html` and `extension/popup.js`, build a new "Custom Prompt Builder" view.
- Add an input for the user to describe their goal ("What do you want to achieve?").
- Implement a conversational UI chat window inside the popup that handles the "Clarifying Questions" step (where the AI asks 2-3 questions before engineering the final prompt).
- Hardcode 5 common prompt templates (e.g. Academic Reviewer, Code Debugger) directly into a Template Library dropdown for zero-latency access.
- Build an Onboarding screen / Settings toggle that explicitly asks the user to opt-in or opt-out of the "Personal Profile Context" feature. Wire this toggle to the backend.

Notes for agent:
You do not need to wire this up to the live backend yet, just build the state management, the UI flow, and mock the clarifying questions sequence so we can test the UX.
---

### For Backend Engineer:
---
ID: MW-020
Title: Build Dynamic Clarifying Questions Endpoint
Agent: Backend Engineer
Priority: P1 High
Blocked by: None

Description:
The Custom Prompt Builder needs to ask the user context-specific clarifying questions before generating the prompt. The current hardcoded generic questions (target audience, tone) don't make sense for tasks like coding or data analysis.

Acceptance criteria:
- Create a new endpoint `POST /generate_clarifying_questions`.
- It should take the user's initial goal (e.g. "I want to debug some code") and pass it to Claude Haiku.
- Claude Haiku should return exactly 2-3 highly specific clarifying questions tailored to the goal (e.g. "What programming language is it?", "What is the error message?").
- Return the questions as a structured JSON array to the frontend.

Notes for agent:
Ensure the prompt to Claude enforces a strict JSON array output format for the questions so the frontend can parse them easily.
---

### For Frontend Engineer:
---
ID: MW-021
Title: DOM-Injected Conversational UI for Clarifying Questions
Agent: Frontend Engineer
Priority: P1 High
Blocked by: MW-020

Description:
The UI flow inside the extension popup felt too disconnected. We are moving the entire "Custom Prompt Builder" conversational flow into the host chat window (Claude, ChatGPT, Gemini). 

Acceptance criteria:
- Revert `extension/popup.html` and `extension/popup.js` back to their clean settings/stats state, removing the custom prompt builder mock.
- In `extension/content.js`, inject a sleek inline widget or overlay near the host chat textarea.
- When the user clicks the Mind World icon (or hotkey), show an input: "What do you want to achieve?".
- When they submit their goal, hit the `POST /generate_clarifying_questions` backend endpoint and display the dynamic clarifying questions natively within this DOM-injected widget.
- Collect their answers, send them to `POST /engineer_prompt`, and populate the host textarea with the final prompt.

Notes for agent:
Use Shadow DOM for the injected widget to ensure the CSS doesn't collide with the host site. Ensure the loading states look clean and premium.
---

## STEP 4 — IDENTIFY BLOCKERS
1. **Chrome Web Store Approval (MW-004):** Pending review.

## STEP 5 — WEEKLY SUMMARY
- **Completed this week:** Executed a massive architectural pivot based on the new `VISION.md`. Decided to focus entirely on the Prompt Engineering Extension and simplify the React map down to just the 3D context blender.
- **In progress:** Building the Template Library and Custom Prompt Builder.
- **Blocked:** Growth push is blocked by the pending Chrome Web Store review.
