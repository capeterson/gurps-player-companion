ALTER TABLE adventure_log_entries
  ADD COLUMN IF NOT EXISTS session_number INTEGER,
  ADD COLUMN IF NOT EXISTS location VARCHAR(200);

-- Both columns are optional display metadata (a session ordinal for
-- cross-referencing and a free-form location). No index needed: they are
-- only ever read as part of the whole entry row. Idempotent via
-- IF NOT EXISTS.
