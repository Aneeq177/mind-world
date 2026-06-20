-- Password and Google account login (separate from Anthropic API key for Improve).
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_key ON users (google_id) WHERE google_id IS NOT NULL;
