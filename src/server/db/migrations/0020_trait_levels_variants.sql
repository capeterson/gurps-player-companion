-- Trait level + variant support.
--
-- `points_per_level` makes a library trait leveled: total points =
-- base_points + level * points_per_level.  `max_level` is an optional cap.
-- `variants` is a JSONB array of named alternative forms (see
-- src/shared/schemas/trait.ts traitVariant).
--
-- On the character side, `variant_name` records which variant the player
-- picked at trait-add time.  Null = base form.

ALTER TABLE "campaign_library_traits"
  ADD COLUMN "points_per_level" integer,
  ADD COLUMN "max_level" smallint,
  ADD COLUMN "variants" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "character_traits"
  ADD COLUMN "variant_name" varchar(80);
