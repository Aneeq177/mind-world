-- Short-lived one-time codes for OAuth callback → frontend/extension handoff.
-- Session tokens must never appear in URL query strings.
CREATE TABLE IF NOT EXISTS auth_handoff_codes (
  code_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  has_password BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_handoff_codes_expires_at_idx
  ON auth_handoff_codes (expires_at);

ALTER TABLE auth_handoff_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE auth_handoff_codes FROM anon, authenticated;
GRANT ALL ON TABLE auth_handoff_codes TO service_role;
