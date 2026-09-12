-- Existing and new campaigns opt in; owners may restore standard penetration.
-- A one-time cursor advance refreshes existing offline campaign mirrors.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'campaigns' AND column_name = 'house_rules') THEN
    ALTER TABLE campaigns ADD COLUMN house_rules jsonb
      NOT NULL DEFAULT '{"protectNaturalDr":true}'::jsonb;
    UPDATE campaigns SET updated_at = clock_timestamp();
  END IF;
END;
$$;
