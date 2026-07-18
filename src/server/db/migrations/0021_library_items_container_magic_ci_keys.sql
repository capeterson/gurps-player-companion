-- Two changes to the campaign library tables:
--
-- 1. `campaign_library_items` gains the container / powerstone /
--    magic-item columns character `inventory_items` already has (see
--    0000 / 0011_magic_system.sql), so a GM can share a backpack,
--    powerstone, or wand template through the library the same way
--    they already share armor and weapons.
--
-- 2. Case-insensitive natural keys.  The YAML import loop matches rows
--    by lowercased name (`keyOf` in campaignLibraryEntities.ts; traits
--    by `kind::lower(name)`), but the unique indexes on all four
--    `campaign_library_*` tables were case-sensitive
--    (`UNIQUE (campaign_id, name)`), so `Sword` and `sword` could
--    coexist via the POST routes and shadow each other on import. Fix:
--    dedupe existing case-insensitive collisions (keep the row with the
--    greatest `updated_at`, tiebreak greatest `id` -- the loser is an
--    unreachable shadow for import purposes), then replace each
--    case-sensitive unique index with a functional one on `lower(name)`
--    (+ `kind` for traits).

-- ---------- dedupe case-insensitive collisions ----------
--
-- Standard self-join dedupe: for every row `a`, delete it if some row
-- `b` in the same natural-key group sorts strictly greater by
-- (updated_at, id) -- this leaves exactly the max-sorting row per
-- group and is correct for groups of any size (not just pairs).

DELETE FROM "campaign_library_traits" a
USING "campaign_library_traits" b
WHERE a."campaign_id" = b."campaign_id"
  AND a."kind" = b."kind"
  AND lower(a."name") = lower(b."name")
  AND (a."updated_at", a."id") < (b."updated_at", b."id");
--> statement-breakpoint

DELETE FROM "campaign_library_skills" a
USING "campaign_library_skills" b
WHERE a."campaign_id" = b."campaign_id"
  AND lower(a."name") = lower(b."name")
  AND (a."updated_at", a."id") < (b."updated_at", b."id");
--> statement-breakpoint

DELETE FROM "campaign_library_spells" a
USING "campaign_library_spells" b
WHERE a."campaign_id" = b."campaign_id"
  AND lower(a."name") = lower(b."name")
  AND (a."updated_at", a."id") < (b."updated_at", b."id");
--> statement-breakpoint

DELETE FROM "campaign_library_items" a
USING "campaign_library_items" b
WHERE a."campaign_id" = b."campaign_id"
  AND lower(a."name") = lower(b."name")
  AND (a."updated_at", a."id") < (b."updated_at", b."id");
--> statement-breakpoint

-- ---------- replace unique indexes with case-insensitive equivalents ----------

DROP INDEX IF EXISTS "campaign_library_traits_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_library_traits_key"
  ON "campaign_library_traits" USING btree ("campaign_id", "kind", (lower("name")));
--> statement-breakpoint

DROP INDEX IF EXISTS "campaign_library_skills_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_library_skills_key"
  ON "campaign_library_skills" USING btree ("campaign_id", (lower("name")));
--> statement-breakpoint

DROP INDEX IF EXISTS "campaign_library_spells_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_library_spells_key"
  ON "campaign_library_spells" USING btree ("campaign_id", (lower("name")));
--> statement-breakpoint

DROP INDEX IF EXISTS "campaign_library_items_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_library_items_key"
  ON "campaign_library_items" USING btree ("campaign_id", (lower("name")));
--> statement-breakpoint

-- ---------- campaign_library_items: container / powerstone / magic item ----------
--
-- Mirrors inventory_items (0000 / 0011_magic_system.sql).  Null
-- powerstone_data/magic_item_data = not that kind of item, same
-- convention as the existing `armor`/`weapon_data` columns.

ALTER TABLE "campaign_library_items"
  ADD COLUMN "is_container" boolean DEFAULT false NOT NULL,
  ADD COLUMN "hideaway_capacity_lbs" numeric(10, 2) DEFAULT '0' NOT NULL,
  ADD COLUMN "weight_reduction_percent" smallint DEFAULT 0 NOT NULL,
  ADD COLUMN "powerstone_data" jsonb,
  ADD COLUMN "magic_item_data" jsonb;
