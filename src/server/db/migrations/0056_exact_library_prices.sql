-- Rules declare their own rounding. Do not silently round a resolved output a
-- second time when storing it. Existing paid values retain their exact value.
ALTER TABLE campaign_library_items
  ALTER COLUMN cost TYPE numeric,
  ALTER COLUMN weight_lbs TYPE numeric;
ALTER TABLE inventory_items
  ALTER COLUMN cost TYPE numeric,
  ALTER COLUMN weight_lbs TYPE numeric;
