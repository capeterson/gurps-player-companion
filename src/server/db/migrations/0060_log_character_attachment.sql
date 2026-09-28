-- Keep legacy private notes private; no character can be inferred safely.
-- Deleting a character detaches its notes without changing their visibility.
ALTER TABLE adventure_log_entries ADD COLUMN IF NOT EXISTS character_id uuid
  REFERENCES characters(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS adventure_log_character_idx ON adventure_log_entries(character_id);
