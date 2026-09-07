ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS birthdate VARCHAR(40);

-- Index not needed: birthdate is non-mechanical display metadata, only
-- ever read as part of the whole character row. Idempotent / repeatable
-- via IF NOT EXISTS.
