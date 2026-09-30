ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS experimental_active_effects boolean NOT NULL DEFAULT false;
