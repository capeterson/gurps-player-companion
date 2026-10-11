-- Charged magic items have no basis in GURPS Magic: using an item costs the
-- same energy as a normal casting of its spell (M19). Former "charged" items
-- become ordinary user-powered items and lose their charge counts. Updates
-- bump revisions, so every device pulls the corrected rows.
UPDATE inventory_items
SET magic_item_data = (magic_item_data - 'chargesMax' - 'chargesCurrent')
  || CASE WHEN magic_item_data->>'mode' = 'charged'
       THEN '{"mode":"powered"}'::jsonb ELSE '{}'::jsonb END
WHERE magic_item_data IS NOT NULL
  AND (magic_item_data->>'mode' = 'charged'
    OR magic_item_data ? 'chargesMax' OR magic_item_data ? 'chargesCurrent');
--> statement-breakpoint
UPDATE campaign_library_items
SET magic_item_data = (magic_item_data - 'chargesMax' - 'chargesCurrent')
  || CASE WHEN magic_item_data->>'mode' = 'charged'
       THEN '{"mode":"powered"}'::jsonb ELSE '{}'::jsonb END
WHERE magic_item_data IS NOT NULL
  AND (magic_item_data->>'mode' = 'charged'
    OR magic_item_data ? 'chargesMax' OR magic_item_data ? 'chargesCurrent');
