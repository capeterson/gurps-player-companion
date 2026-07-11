ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS allow_gm_character_editing boolean NOT NULL DEFAULT false;
