-- Convert every persisted ranged Range string, including normalized modes and
-- legacy alternate modes, to an object. Unknown notation stays identifiable
-- for explicit owner repair; it is never parsed during an attack roll.
CREATE FUNCTION migrate_weapon_range_value(raw text, skill text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  parts text[];
  half_value integer;
  max_value integer;
  source text := CASE WHEN skill ~* '^(bow|crossbow)(\W|$)' THEN 'weapon' ELSE 'wielder' END;
BEGIN
  raw := btrim(raw);
  IF raw = '' THEN RETURN 'null'::jsonb; END IF;
  parts := regexp_match(raw, '^([0-9]+)/([0-9]+)$');
  IF parts IS NOT NULL THEN
    half_value := parts[1]::integer;
    max_value := parts[2]::integer;
    IF half_value > 0 AND max_value >= half_value AND max_value <= 1000000000 THEN
      RETURN jsonb_build_object('kind', 'fixed', 'halfDamageYards', half_value, 'maxYards', max_value);
    END IF;
  END IF;
  parts := regexp_match(raw, '^([0-9]+)$');
  IF parts IS NOT NULL THEN
    max_value := parts[1]::integer;
    IF max_value > 0 AND max_value <= 1000000000 THEN
      RETURN jsonb_build_object('kind', 'fixed', 'halfDamageYards', NULL, 'maxYards', max_value);
    END IF;
  END IF;
  parts := regexp_match(raw, '^[xX×]([0-9]+)/[xX×]([0-9]+)$');
  IF parts IS NOT NULL THEN
    half_value := parts[1]::integer;
    max_value := parts[2]::integer;
    IF half_value > 0 AND max_value >= half_value AND max_value <= 1000000 THEN
      RETURN jsonb_build_object('kind', 'st_multiplier', 'halfDamageFactor', half_value,
        'maxFactor', max_value, 'strengthSource', source);
    END IF;
  END IF;
  parts := regexp_match(raw, '^[xX×]([0-9]+)$');
  IF parts IS NOT NULL THEN
    max_value := parts[1]::integer;
    IF max_value > 0 AND max_value <= 1000000 THEN
      RETURN jsonb_build_object('kind', 'st_multiplier', 'halfDamageFactor', NULL,
        'maxFactor', max_value, 'strengthSource', source);
    END IF;
  END IF;
  RETURN jsonb_build_object('kind', 'legacy', 'notation', raw);
EXCEPTION WHEN numeric_value_out_of_range THEN
  RETURN jsonb_build_object('kind', 'legacy', 'notation', raw);
END $$;
--> statement-breakpoint
CREATE FUNCTION migrate_weapon_ranged_block(block jsonb, skill text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF block IS NULL OR jsonb_typeof(block) <> 'object' OR jsonb_typeof(block->'range') <> 'string' THEN
    RETURN block;
  END IF;
  RETURN jsonb_set(block, '{range}', migrate_weapon_range_value(block->>'range', skill));
END $$;
--> statement-breakpoint
CREATE FUNCTION migrate_weapon_range_data(data jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  next_data jsonb := data;
  converted jsonb;
BEGIN
  IF data IS NULL OR jsonb_typeof(data) <> 'object' THEN RETURN data; END IF;
  IF data ? 'ranged' THEN
    next_data := jsonb_set(next_data, '{ranged}',
      migrate_weapon_ranged_block(data->'ranged', data->>'skill'));
  END IF;
  IF jsonb_typeof(data->'modes') = 'array' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(mode->'ranged') = 'object' THEN
        jsonb_set(mode, '{ranged}', migrate_weapon_ranged_block(mode->'ranged', coalesce(mode->>'skill', data->>'skill')))
      ELSE mode END ORDER BY ordinal), '[]'::jsonb)
    INTO converted FROM jsonb_array_elements(data->'modes') WITH ORDINALITY AS entries(mode, ordinal);
    next_data := jsonb_set(next_data, '{modes}', converted);
  END IF;
  IF jsonb_typeof(data->'alternateModes') = 'array' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(mode->'ranged') = 'object' THEN
        jsonb_set(mode, '{ranged}', migrate_weapon_ranged_block(mode->'ranged', coalesce(mode->>'skill', data->>'skill')))
      ELSE mode END ORDER BY ordinal), '[]'::jsonb)
    INTO converted FROM jsonb_array_elements(data->'alternateModes') WITH ORDINALITY AS entries(mode, ordinal);
    next_data := jsonb_set(next_data, '{alternateModes}', converted);
  END IF;
  RETURN next_data;
END $$;
--> statement-breakpoint
UPDATE inventory_items SET weapon_data = migrate_weapon_range_data(weapon_data)
WHERE weapon_data::text ~ '"range"[[:space:]]*:[[:space:]]*"';
--> statement-breakpoint
UPDATE campaign_library_items SET weapon_data = migrate_weapon_range_data(weapon_data)
WHERE weapon_data::text ~ '"range"[[:space:]]*:[[:space:]]*"';
--> statement-breakpoint
DROP FUNCTION migrate_weapon_range_data(jsonb);
DROP FUNCTION migrate_weapon_ranged_block(jsonb, text);
DROP FUNCTION migrate_weapon_range_value(text, text);
