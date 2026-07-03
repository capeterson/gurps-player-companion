-- Spell difficulty: most GURPS 4e spells are IQ/Hard, but a number
-- (Major Healing, Great Haste, Enchant, ...) are IQ/Very Hard and
-- compute one level lower.  Existing rows were all implicitly Hard, so
-- backfilling with the 'H' default preserves every computed level.
-- See src/shared/domain/spellCalc.ts for the math.

ALTER TABLE "character_spells"
  ADD COLUMN IF NOT EXISTS "difficulty" varchar(2) DEFAULT 'H' NOT NULL;
