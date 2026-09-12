ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS enforce_attribute_caps boolean;

-- Existing campaigns opt in as requested, while the default keeps every new
-- campaign on the canonical limits unless its GM explicitly turns them off.
UPDATE campaigns
SET enforce_attribute_caps = true
WHERE enforce_attribute_caps IS NULL;

ALTER TABLE campaigns
  ALTER COLUMN enforce_attribute_caps SET DEFAULT true,
  ALTER COLUMN enforce_attribute_caps SET NOT NULL;
