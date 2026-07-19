-- A deleted character remains a historical PC combatant with its captured stats.
ALTER TABLE "encounter_combatants"
  DROP CONSTRAINT IF EXISTS "encounter_combatants_kind_character_check";
--> statement-breakpoint
ALTER TABLE "encounter_combatants"
  ADD CONSTRAINT "encounter_combatants_kind_character_check"
  CHECK ((kind = 'pc') OR (kind = 'npc' AND character_id IS NULL));
