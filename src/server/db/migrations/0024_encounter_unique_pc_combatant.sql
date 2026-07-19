-- A character can appear only once in an encounter. NULL preserves historical
-- PC combatants after their source character is deleted.
CREATE UNIQUE INDEX IF NOT EXISTS "encounter_combatants_pc_character_key"
  ON "encounter_combatants" ("encounter_id", "character_id")
  WHERE "character_id" IS NOT NULL;
