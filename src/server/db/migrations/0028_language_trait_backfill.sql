-- Move existing `character_traits` rows with kind='language' into the
-- first-class `character_languages` table (migration 0026).
--
-- Point totals are preserved exactly: each trait's `points` carries over
-- verbatim, and the trait row is then deleted, so a character's ledger
-- total is unchanged by this migration -- only which bucket the points
-- land in changes (advantages -> languages).
--
-- Fluency is a GUESS. A trait row records no fluency at all, so every
-- backfilled language lands at spoken='native' / written='none' and the
-- player is expected to correct it on the Languages panel. That choice
-- keeps the common case (a mother tongue recorded as a 0-point trait)
-- right and is obvious enough to spot for the rest.
--
-- `LEAST(GREATEST(points, 0), 100)` clamps into the 0..100 range the
-- language schema validates on both sides (languageCreate/languageOut
-- cap points at 100). A legacy trait may hold up to 1000 points under
-- traitCreate; backfilling a >100 value verbatim would produce a row the
-- API contract rejects, so the upper bound is applied too. GURPS
-- languages never cost negative points or exceed 100, so this should
-- never fire in practice — it exists so the migrated row stays editable
-- through the API no matter what the legacy data held.
--
-- Idempotent two ways: the DELETE at the end removes the source rows, so
-- a rerun finds nothing to migrate; and the INSERT's NOT EXISTS guard
-- skips any (character, name) pair that already has a language row, so a
-- partially-applied run can't create duplicates.

INSERT INTO character_languages (
  character_id, name, spoken_fluency, written_fluency, points, notes, created_at, updated_at
)
SELECT
  t.character_id,
  t.name,
  'native',
  'none',
  LEAST(GREATEST(t.points, 0), 100),
  t.notes,
  t.created_at,
  t.updated_at
FROM character_traits t
WHERE t.kind = 'language'
  AND NOT EXISTS (
    SELECT 1 FROM character_languages l
    WHERE l.character_id = t.character_id
      AND lower(l.name) = lower(t.name)
  );
--> statement-breakpoint

DELETE FROM character_traits WHERE kind = 'language';
