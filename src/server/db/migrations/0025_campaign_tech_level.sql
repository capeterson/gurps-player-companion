ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS tech_level smallint;

ALTER TABLE characters
  DROP COLUMN IF EXISTS player_name,
  DROP COLUMN IF EXISTS tech_level;
