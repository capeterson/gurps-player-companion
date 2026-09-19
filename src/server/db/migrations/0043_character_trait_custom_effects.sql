ALTER TABLE character_traits
  ADD COLUMN IF NOT EXISTS custom_effects jsonb NOT NULL DEFAULT '[]'::jsonb;
