-- Preserve uncertainty: existing definitions did not record their defaults.
ALTER TABLE character_skills ADD COLUMN IF NOT EXISTS defaults jsonb;
ALTER TABLE campaign_library_skills ADD COLUMN IF NOT EXISTS defaults jsonb;
