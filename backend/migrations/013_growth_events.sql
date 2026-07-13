-- Migration 013: Lightweight growth/activation event log.
-- Metadata-only (no prompt/conversation content) so it's safe to keep
-- indefinitely and query freely for funnel/retention analysis.
--
-- Events currently logged by the backend:
--   'connected'      — user completed sign-in + consent in the popup (activation)
--   'improve_used'   — a successful /engineer_prompt call (Improve or template weave)
--   'autosave_used'  — a conversation was auto-saved via /save_conversation (memory fuel)

CREATE TABLE IF NOT EXISTS growth_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  platform TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_growth_events_user_event
  ON growth_events(user_id, event, created_at);

CREATE INDEX IF NOT EXISTS idx_growth_events_event_created
  ON growth_events(event, created_at);
