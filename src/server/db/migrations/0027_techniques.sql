-- Techniques and martial-arts styles as first-class entities.
--
-- `character_techniques` is a character-family child table (sync-backed
-- through the outbox, same shape as character_languages in 0026).
-- `campaign_library_techniques` and `campaign_library_styles` are the
-- campaign-family book definitions; styles denormalize their technique
-- list into jsonb (validated by `styleTechniqueRef[]`) so a style stays
-- valid through a YAML round trip into a campaign whose technique rows
-- don't exist yet.
--
-- Idempotent: IF NOT EXISTS / DROP TRIGGER IF EXISTS everywhere.

-- ---------- campaign_library_techniques ----------

CREATE TABLE IF NOT EXISTS "campaign_library_techniques" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "default_skill_name" varchar(160) NOT NULL,
  "difficulty" varchar(2) DEFAULT 'A' NOT NULL,
  "max_level" smallint,
  "description" text,
  "source" varchar(40),
  "prereq" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revision" bigint DEFAULT nextval('revisions_seq') NOT NULL
);
--> statement-breakpoint

ALTER TABLE "campaign_library_techniques"
  DROP CONSTRAINT IF EXISTS "campaign_library_techniques_campaign_id_fk";
--> statement-breakpoint

ALTER TABLE "campaign_library_techniques"
  ADD CONSTRAINT "campaign_library_techniques_campaign_id_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_library_techniques_key"
  ON "campaign_library_techniques" ("campaign_id", lower("name"));
--> statement-breakpoint

DROP TRIGGER IF EXISTS bump_revision_trg ON "campaign_library_techniques";
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "campaign_library_techniques"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint

DROP TRIGGER IF EXISTS record_history_trg ON "campaign_library_techniques";
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "campaign_library_techniques"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_library_technique');
--> statement-breakpoint

-- ---------- campaign_library_styles ----------

CREATE TABLE IF NOT EXISTS "campaign_library_styles" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" text,
  "source" varchar(40),
  -- Validated by `styleTechniqueRef[]` (shared/schemas/campaignLibrary.ts).
  "techniques" jsonb DEFAULT '[]'::jsonb NOT NULL,
  -- Both validated by `styleNameList` (shared/schemas/campaignLibrary.ts).
  "perks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revision" bigint DEFAULT nextval('revisions_seq') NOT NULL
);
--> statement-breakpoint

ALTER TABLE "campaign_library_styles"
  DROP CONSTRAINT IF EXISTS "campaign_library_styles_campaign_id_fk";
--> statement-breakpoint

ALTER TABLE "campaign_library_styles"
  ADD CONSTRAINT "campaign_library_styles_campaign_id_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_library_styles_key"
  ON "campaign_library_styles" ("campaign_id", lower("name"));
--> statement-breakpoint

DROP TRIGGER IF EXISTS bump_revision_trg ON "campaign_library_styles";
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "campaign_library_styles"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint

DROP TRIGGER IF EXISTS record_history_trg ON "campaign_library_styles";
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "campaign_library_styles"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_library_style');
--> statement-breakpoint

-- ---------- character_techniques ----------

CREATE TABLE IF NOT EXISTS "character_techniques" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "character_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "default_skill_name" varchar(160) NOT NULL,
  "difficulty" varchar(2) DEFAULT 'A' NOT NULL,
  "points" integer DEFAULT 0 NOT NULL,
  "max_level" smallint,
  "notes" text,
  "library_technique_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revision" bigint DEFAULT nextval('revisions_seq') NOT NULL
);
--> statement-breakpoint

ALTER TABLE "character_techniques"
  DROP CONSTRAINT IF EXISTS "character_techniques_character_id_fk";
--> statement-breakpoint

ALTER TABLE "character_techniques"
  ADD CONSTRAINT "character_techniques_character_id_fk"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "character_techniques_character_idx"
  ON "character_techniques" ("character_id");
--> statement-breakpoint

DROP TRIGGER IF EXISTS bump_revision_trg ON "character_techniques";
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "character_techniques"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint

-- S6: tombstone on delete so the cursor can propagate the removal.
DROP TRIGGER IF EXISTS record_tombstone_trg ON "character_techniques";
--> statement-breakpoint
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "character_techniques"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_tombstone('character_technique');
--> statement-breakpoint

-- H1: character-family history trigger.
DROP TRIGGER IF EXISTS record_history_trg ON "character_techniques";
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "character_techniques"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_history('character_technique');
