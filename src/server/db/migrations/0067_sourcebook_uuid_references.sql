-- Portable YAML labels are not live identities. Resolve all existing links
-- before dropping their old strings. Every lookup is scoped to the campaign.
-- Drizzle applies this file atomically; an unresolved live link aborts it.
CREATE OR REPLACE FUNCTION migrate_sourcebook_refs(value jsonb, campaign uuid, strict_links boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; item record; source_uuid uuid; source_key text; definition_campaign uuid; definition_table text;
BEGIN
  IF value IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(value) = 'array' THEN
    SELECT coalesce(jsonb_agg(migrate_sourcebook_refs(element, campaign, strict_links) ORDER BY ordinal), '[]'::jsonb)
    INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS a(element, ordinal);
    RETURN result;
  END IF;
  IF jsonb_typeof(value) <> 'object' THEN RETURN value; END IF;
  -- Purchases retain their original definition when a character changes
  -- campaigns. Resolve that book in the definition's campaign, not the current
  -- character campaign (where the same portable label may mean another UUID).
  IF value ? 'definitionId' AND value #>> '{reference,section}' IN ('traits', 'items', 'modifiers') THEN
    definition_table := 'campaign_library_' || (value #>> '{reference,section}');
    EXECUTE format('SELECT campaign_id FROM %I WHERE id = $1', definition_table)
      INTO definition_campaign USING (value ->> 'definitionId')::uuid;
    -- A deleted original definition supplies no campaign evidence. Never
    -- reconnect its retained purchase to a same-key book in a new campaign.
    IF value ->> 'definitionId' IS NOT NULL THEN campaign := definition_campaign; END IF;
  END IF;
  result := '{}'::jsonb;
  FOR item IN SELECT * FROM jsonb_each(value) LOOP
    IF item.key = 'sourceKey' THEN
      source_key := item.value #>> '{}';
      source_uuid := NULL;
      IF source_key IS NOT NULL THEN
        SELECT id INTO source_uuid FROM campaign_library_sources
        WHERE campaign_id = campaign AND lower(regexp_replace(trim(key), '\s+', ' ', 'g')) = lower(regexp_replace(trim(source_key), '\s+', ' ', 'g'));
        IF source_uuid IS NULL AND strict_links THEN
          RAISE EXCEPTION 'Cannot migrate unresolved sourcebook % in campaign %', source_key, campaign;
        END IF;
      END IF;
      -- A detached historical purchase can lack its former book. Its retained
      -- definitionId, complete rules and paid values stay intact; it stays detached.
      result := result || jsonb_build_object('sourceId', source_uuid);
    ELSE
      result := result || jsonb_build_object(item.key, migrate_sourcebook_refs(item.value, campaign, strict_links));
    END IF;
  END LOOP;
  RETURN result;
END $$;
--> statement-breakpoint
DO $$
DECLARE tbl_name text; missing_key text; campaign uuid; column_name text;
BEGIN
  FOR tbl_name IN SELECT unnest(ARRAY[
    'campaign_library_traits', 'campaign_library_skills', 'campaign_library_spells',
    'campaign_library_items', 'campaign_library_languages', 'campaign_library_techniques',
    'campaign_library_styles', 'campaign_library_enchantments',
    'campaign_library_active_effects', 'campaign_library_modifiers'
  ]) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = current_schema() AND c.table_name = tbl_name AND c.column_name = 'source_key') THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS source_id uuid', tbl_name);
    EXECUTE format('SELECT e.source_key, e.campaign_id FROM %I e LEFT JOIN campaign_library_sources s ON s.campaign_id = e.campaign_id AND lower(regexp_replace(trim(s.key), ''\s+'', '' '', ''g'')) = lower(regexp_replace(trim(e.source_key), ''\s+'', '' '', ''g'')) WHERE e.source_key IS NOT NULL AND s.id IS NULL LIMIT 1', tbl_name)
      INTO missing_key, campaign;
    IF missing_key IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot migrate unresolved sourcebook % in % (campaign %)', missing_key, tbl_name, campaign;
    END IF;
    EXECUTE format('UPDATE %I e SET source_id = s.id FROM campaign_library_sources s WHERE s.campaign_id = e.campaign_id AND lower(regexp_replace(trim(s.key), ''\s+'', '' '', ''g'')) = lower(regexp_replace(trim(e.source_key), ''\s+'', '' '', ''g''))', tbl_name);
    FOR column_name IN SELECT c.column_name FROM information_schema.columns c
      WHERE c.table_schema = current_schema() AND c.table_name = tbl_name
      AND c.column_name IN ('calculation', 'available_modifiers', 'applicability')
      AND c.data_type = 'jsonb'
    LOOP
      EXECUTE format('UPDATE %I SET %I = migrate_sourcebook_refs(%I, campaign_id, true) WHERE %I IS NOT NULL', tbl_name, column_name, column_name, column_name);
    END LOOP;
    EXECUTE format('DROP INDEX IF EXISTS %I', tbl_name || '_key');
    EXECUTE format('ALTER TABLE %I DROP COLUMN source_key', tbl_name);
    EXECUTE format('CREATE UNIQUE INDEX %I ON %I (campaign_id, %s lower(coalesce(nullif(key, ''''), name)), coalesce(source_id::text, ''''))', tbl_name || '_key', tbl_name, CASE WHEN tbl_name = 'campaign_library_traits' THEN 'kind,' ELSE '' END);
  END LOOP;
END $$;
--> statement-breakpoint
UPDATE character_traits e SET
  pricing_resolution = migrate_sourcebook_refs(e.pricing_resolution, c.campaign_id, false),
  modifiers = migrate_sourcebook_refs(e.modifiers, c.campaign_id, false)
FROM characters c WHERE c.id = e.character_id;
UPDATE inventory_items e SET pricing_resolution = migrate_sourcebook_refs(e.pricing_resolution, c.campaign_id, false)
FROM characters c WHERE c.id = e.character_id;
--> statement-breakpoint
DROP INDEX IF EXISTS campaign_library_sources_key;
ALTER TABLE campaign_library_sources DROP COLUMN IF EXISTS key;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_library_sources_campaign_id_key ON campaign_library_sources(campaign_id, id);
DO $$
DECLARE tbl_name text;
BEGIN
  FOR tbl_name IN SELECT unnest(ARRAY[
    'campaign_library_traits', 'campaign_library_skills', 'campaign_library_spells',
    'campaign_library_items', 'campaign_library_languages', 'campaign_library_techniques',
    'campaign_library_styles', 'campaign_library_enchantments',
    'campaign_library_active_effects', 'campaign_library_modifiers'
  ]) LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass(tbl_name) AND conname = tbl_name || '_source_book_fk') THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (campaign_id, source_id) REFERENCES campaign_library_sources(campaign_id, id) ON DELETE NO ACTION', tbl_name, tbl_name || '_source_book_fk');
  END LOOP;
END $$;
DROP FUNCTION migrate_sourcebook_refs(jsonb, uuid, boolean);
