-- Replace the ten per-stat temp_* scalar columns on `characters` with a
-- single structured `temp_effects` jsonb list (named effects, plus a
-- reserved 'manual' sentinel id for the existing ✦-popover steppers).
-- Validated by `tempEffectsField` (src/shared/schemas/character.ts) --
-- see docs/specs/json-fields.md.
--
-- Backfill: any character with a nonzero temp_* column gets a single
-- 'manual' effect carrying those values, so a character with an active
-- buff isn't silently reset to baseline by the migration. The backfill
-- UPDATE intentionally runs through the normal bump_revision_trg /
-- record_history_trg triggers (0002/0013) -- an audited, revision-
-- bumping write is desired here, not a side effect to suppress.
--
-- All three steps are guarded so the migration is safe to re-run:
-- ADD COLUMN / DROP COLUMN use IF [NOT] EXISTS, and the backfill checks
-- information_schema before touching the (possibly already-dropped)
-- temp_* columns.

-- ---------- 1. add the new column ----------

ALTER TABLE "characters"
  ADD COLUMN IF NOT EXISTS "temp_effects" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint

-- ---------- 2. backfill from the old scalar columns ----------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'characters' AND column_name = 'temp_st'
  ) THEN
    UPDATE "characters"
    SET "temp_effects" = jsonb_build_array(
      jsonb_build_object(
        'id', 'manual',
        'name', 'Manual adjustment',
        'mods', jsonb_strip_nulls(jsonb_build_object(
          'st', nullif(temp_st, 0),
          'dx', nullif(temp_dx, 0),
          'iq', nullif(temp_iq, 0),
          'ht', nullif(temp_ht, 0),
          'hp', nullif(temp_hp_mod, 0),
          'will', nullif(temp_will_mod, 0),
          'per', nullif(temp_per_mod, 0),
          'fp', nullif(temp_fp_mod, 0),
          'speedQuarter', nullif(temp_speed_quarter_mod, 0),
          'move', nullif(temp_move_mod, 0)
        ))
      )
    )
    WHERE temp_st <> 0 OR temp_dx <> 0 OR temp_iq <> 0 OR temp_ht <> 0
       OR temp_hp_mod <> 0 OR temp_will_mod <> 0 OR temp_per_mod <> 0
       OR temp_fp_mod <> 0 OR temp_speed_quarter_mod <> 0 OR temp_move_mod <> 0;
  END IF;
END $$;
--> statement-breakpoint

-- ---------- 3. drop the old scalar columns ----------

ALTER TABLE "characters" DROP COLUMN IF EXISTS "temp_st";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN IF EXISTS "temp_dx";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN IF EXISTS "temp_iq";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN IF EXISTS "temp_ht";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN IF EXISTS "temp_hp_mod";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN IF EXISTS "temp_will_mod";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN IF EXISTS "temp_per_mod";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN IF EXISTS "temp_fp_mod";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN IF EXISTS "temp_speed_quarter_mod";
--> statement-breakpoint
ALTER TABLE "characters" DROP COLUMN IF EXISTS "temp_move_mod";
