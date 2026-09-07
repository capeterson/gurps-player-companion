-- Multi-enchantment metadata for magic gear (B262 enchantment economy):
-- a single item can carry several enchantments ("Fortify +3" plus
-- "Deflect +2" plus "Cornucopia"), which the single-spell magicItemData
-- block can't represent. Non-mechanical metadata: nothing consumes it in
-- combat math; it records what the enchantments are.
--
-- campaign_library_items carries the same list so library templates can
-- define enchantments and the inventory copy path picks them up.
-- Idempotent via IF NOT EXISTS; existing rows get the column default.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS enchantments JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE campaign_library_items
  ADD COLUMN IF NOT EXISTS enchantments JSONB NOT NULL DEFAULT '[]'::jsonb;
