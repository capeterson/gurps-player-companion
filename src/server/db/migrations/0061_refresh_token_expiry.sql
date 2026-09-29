-- Nightly cleanup keeps rotation/replay ancestors until their tokens expire.
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx ON refresh_tokens(expires_at);
