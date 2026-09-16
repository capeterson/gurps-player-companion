ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS experimental_turn_tracker boolean NOT NULL DEFAULT false;
