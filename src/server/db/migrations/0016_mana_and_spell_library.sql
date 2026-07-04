-- GURPS magic expansion: campaign-wide ambient mana level and a
-- campaign spell library (the table character_spells.library_spell_id
-- has pointed at since 0011).  See src/shared/constants/magic.ts and
-- src/shared/domain/spellCalc.ts for how mana folds into spell math.

-- ---------- campaigns.mana_level ----------

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "mana_level" varchar(12) DEFAULT 'normal' NOT NULL;
--> statement-breakpoint

-- ---------- campaign_library_spells ----------
--
-- Mirrors campaign_library_skills: natural key (campaign_id, name),
-- shared revision sequence, bump-revision trigger, campaign-family
-- history trigger.

CREATE TABLE IF NOT EXISTS "campaign_library_spells" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "college" varchar(80),
  "difficulty" varchar(2) DEFAULT 'H' NOT NULL,
  "base_energy_cost" smallint DEFAULT 1 NOT NULL,
  "maintenance_cost" smallint,
  "casting_time" varchar(40),
  "duration" varchar(40),
  "prerequisites" text,
  "description" text,
  "source" varchar(40),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revision" bigint DEFAULT nextval('revisions_seq') NOT NULL
);
--> statement-breakpoint

ALTER TABLE "campaign_library_spells"
  ADD CONSTRAINT "campaign_library_spells_campaign_id_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE UNIQUE INDEX "campaign_library_spells_key"
  ON "campaign_library_spells" ("campaign_id", "name");
--> statement-breakpoint

-- Mirrors 0002_revision_triggers for the other library tables.
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "campaign_library_spells"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint

-- H1: campaign-family history trigger (see 0013_entity_history).
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "campaign_library_spells"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_library_spell');
