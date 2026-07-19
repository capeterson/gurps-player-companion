-- Online-only campaign encounter tracker.  These guards keep the hand-written
-- migration safe for a partially-provisioned local development database.

DO $$ BEGIN
  CREATE TYPE "encounter_status" AS ENUM ('active', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "encounter_combatant_kind" AS ENUM ('pc', 'npc');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "encounters" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE cascade,
  "name" varchar(120) NOT NULL DEFAULT 'Encounter',
  "status" "encounter_status" NOT NULL DEFAULT 'active',
  "round" integer NOT NULL DEFAULT 1,
  "active_combatant_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "ended_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "encounter_combatants" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "encounter_id" uuid NOT NULL REFERENCES "encounters"("id") ON DELETE cascade,
  "kind" "encounter_combatant_kind" NOT NULL,
  "character_id" uuid REFERENCES "characters"("id") ON DELETE set null,
  "name" varchar(120) NOT NULL,
  "basic_speed" numeric(6,2),
  "dx" integer,
  "order_key" numeric(14,4) NOT NULL DEFAULT 10,
  "active" boolean NOT NULL DEFAULT true,
  "max_hp" integer,
  "current_hp" integer,
  "move" integer,
  "dodge" integer,
  "dr" integer,
  "maneuver" varchar(80),
  "conditions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "hidden_from_players" boolean NOT NULL DEFAULT false,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "encounter_combatants_kind_character_check"
    CHECK ((kind = 'pc') OR (kind = 'npc' AND character_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "encounter_effects" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "encounter_id" uuid NOT NULL REFERENCES "encounters"("id") ON DELETE cascade,
  "target_combatant_id" uuid NOT NULL REFERENCES "encounter_combatants"("id") ON DELETE cascade,
  "caster_combatant_id" uuid REFERENCES "encounter_combatants"("id") ON DELETE set null,
  "created_by_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "name" varchar(120) NOT NULL,
  "duration" jsonb NOT NULL,
  "started_at_round" integer NOT NULL,
  "maintenance_cost" integer,
  "last_maintained_round" integer,
  "expiry_acknowledged_at_round" integer,
  "linked_condition" varchar(80),
  "linked_temp_effect_id" varchar(120),
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "encounters_campaign_idx" ON "encounters" ("campaign_id");
CREATE INDEX IF NOT EXISTS "encounter_combatants_encounter_idx" ON "encounter_combatants" ("encounter_id");
CREATE INDEX IF NOT EXISTS "encounter_combatants_character_idx" ON "encounter_combatants" ("character_id");
CREATE INDEX IF NOT EXISTS "encounter_effects_encounter_idx" ON "encounter_effects" ("encounter_id");
CREATE INDEX IF NOT EXISTS "encounter_effects_target_idx" ON "encounter_effects" ("target_combatant_id");
