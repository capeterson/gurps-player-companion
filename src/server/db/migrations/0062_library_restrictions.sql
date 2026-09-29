-- Restricted definitions remain available to the campaign owner but are not
-- distributed to other members. Existing definitions remain public.
ALTER TABLE campaign_library_traits ADD COLUMN restricted boolean NOT NULL DEFAULT false;
ALTER TABLE campaign_library_skills ADD COLUMN restricted boolean NOT NULL DEFAULT false;
ALTER TABLE campaign_library_spells ADD COLUMN restricted boolean NOT NULL DEFAULT false;
ALTER TABLE campaign_library_items ADD COLUMN restricted boolean NOT NULL DEFAULT false;
ALTER TABLE campaign_library_languages ADD COLUMN restricted boolean NOT NULL DEFAULT false;
ALTER TABLE campaign_library_techniques ADD COLUMN restricted boolean NOT NULL DEFAULT false;
ALTER TABLE campaign_library_styles ADD COLUMN restricted boolean NOT NULL DEFAULT false;
ALTER TABLE campaign_library_enchantments ADD COLUMN restricted boolean NOT NULL DEFAULT false;
ALTER TABLE campaign_library_active_effects ADD COLUMN restricted boolean NOT NULL DEFAULT false;
ALTER TABLE campaign_library_modifiers ADD COLUMN restricted boolean NOT NULL DEFAULT false;
