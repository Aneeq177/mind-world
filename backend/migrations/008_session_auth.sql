-- Session tokens and API key fingerprints for authenticated export/delete.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
