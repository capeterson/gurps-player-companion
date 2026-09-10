ALTER TABLE character_traits ADD COLUMN IF NOT EXISTS library_mechanics jsonb;
--> statement-breakpoint
ALTER TABLE character_skills ADD COLUMN IF NOT EXISTS library_mechanics jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS character_traits_library_idx ON character_traits (library_trait_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS character_skills_library_idx ON character_skills (library_skill_id);
--> statement-breakpoint
-- One-time backfill from existing validated declarations, only within the owning
-- character's current campaign. Already missing/foreign sources remain unresolved.
UPDATE character_traits AS child SET library_mechanics = jsonb_build_object(
  'sourceId', source.id, 'campaignId', source.campaign_id,
  'sourceRevision', source.revision, 'effects', source.effects)
  || CASE WHEN child.kind <> source.kind THEN '{"detached":true}'::jsonb ELSE '{}'::jsonb END,
  library_trait_id = CASE WHEN child.kind <> source.kind THEN NULL ELSE child.library_trait_id END
FROM campaign_library_traits AS source, characters AS parent
WHERE child.library_mechanics IS NULL AND child.library_trait_id = source.id
  AND child.character_id = parent.id AND parent.campaign_id = source.campaign_id;
--> statement-breakpoint
UPDATE character_skills AS child SET library_mechanics = jsonb_build_object(
  'sourceId', source.id, 'campaignId', source.campaign_id,
  'sourceRevision', source.revision, 'effects', source.effects)
FROM campaign_library_skills AS source, characters AS parent
WHERE child.library_mechanics IS NULL AND child.library_skill_id = source.id
  AND child.character_id = parent.id AND parent.campaign_id = source.campaign_id;
--> statement-breakpoint
-- Application library writes now update the actual owned declarations through
-- their shared Zod schema in the audited transaction, which also advances revisions.
DROP TRIGGER IF EXISTS invalidate_owned_mechanics_trg ON campaign_library_traits;
--> statement-breakpoint
DROP TRIGGER IF EXISTS invalidate_owned_mechanics_trg ON campaign_library_skills;
