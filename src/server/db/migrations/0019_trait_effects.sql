-- Trait & skill effect declarations on the library tables, plus per-character
-- toggle state for conditional effect groups.
--
-- See src/shared/schemas/effects.ts for the shape of each element in the
-- effects JSONB array.

ALTER TABLE "campaign_library_traits"
  ADD COLUMN "effects" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "campaign_library_skills"
  ADD COLUMN "effects" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "characters"
  ADD COLUMN "active_condition_groups" jsonb NOT NULL DEFAULT '[]'::jsonb;
