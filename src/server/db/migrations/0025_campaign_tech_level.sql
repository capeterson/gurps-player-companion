ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS tech_level smallint;

-- Backfill campaigns.tech_level from the characters that are about to
-- lose their own tech_level column, so existing data isn't silently
-- dropped. Tech level was previously per-character, so a campaign's
-- characters may disagree; pick each campaign's most common non-null
-- value, breaking ties by the highest value for determinism.
--
-- Guarded so the migration stays idempotent/repeatable: characters.tech_level
-- is dropped below, so a rerun (e.g. after an interrupted first run) would
-- otherwise fail with "column tech_level does not exist" once the source
-- column is already gone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'characters' AND column_name = 'tech_level'
  ) THEN
    WITH ranked AS (
      SELECT
        campaign_id,
        tech_level,
        count(*) AS n,
        row_number() OVER (
          PARTITION BY campaign_id
          ORDER BY count(*) DESC, tech_level DESC
        ) AS rn
      FROM characters
      WHERE campaign_id IS NOT NULL AND tech_level IS NOT NULL
      GROUP BY campaign_id, tech_level
    )
    UPDATE campaigns
    SET tech_level = ranked.tech_level
    FROM ranked
    WHERE campaigns.id = ranked.campaign_id
      AND ranked.rn = 1
      AND campaigns.tech_level IS NULL;
  END IF;
END $$;

ALTER TABLE characters
  DROP COLUMN IF EXISTS player_name,
  DROP COLUMN IF EXISTS tech_level;
