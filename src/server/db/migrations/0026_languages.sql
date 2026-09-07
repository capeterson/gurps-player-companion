-- Languages as first-class entities.
--
-- `character_languages` is a character-family child table (sync-backed
-- through the outbox, exactly like character_skills); the fluency pair
-- and the point cost live here.  `campaign_library_languages` is the
-- campaign-family book definition a player copies from.
--
-- Both follow the standard plumbing: shared revision sequence (0004),
-- bump_revision BEFORE UPDATE trigger (0002), record_history_trg (0013,
-- H1), and — for the character child — an AFTER DELETE tombstone trigger
-- so /sync/cursor can tell offline clients to drop the row (S6).
--
-- Idempotent: IF NOT EXISTS / DROP TRIGGER IF EXISTS everywhere so a
-- rerun against a partially-migrated database is a no-op.

-- ---------- campaign_library_languages ----------

CREATE TABLE IF NOT EXISTS "campaign_library_languages" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" text,
  "source" varchar(40),
  "is_sign_language" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revision" bigint DEFAULT nextval('revisions_seq') NOT NULL
);
--> statement-breakpoint

ALTER TABLE "campaign_library_languages"
  DROP CONSTRAINT IF EXISTS "campaign_library_languages_campaign_id_fk";
--> statement-breakpoint

ALTER TABLE "campaign_library_languages"
  ADD CONSTRAINT "campaign_library_languages_campaign_id_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Case-insensitive natural key, matching the YAML import loop's `keyOf`
-- (lower(name)) -- mirrors campaign_library_skills/spells (see 0021).
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_library_languages_key"
  ON "campaign_library_languages" ("campaign_id", lower("name"));
--> statement-breakpoint

DROP TRIGGER IF EXISTS bump_revision_trg ON "campaign_library_languages";
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "campaign_library_languages"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint

-- H1: campaign-family history trigger (see 0013_entity_history).
DROP TRIGGER IF EXISTS record_history_trg ON "campaign_library_languages";
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "campaign_library_languages"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_library_language');
--> statement-breakpoint

-- ---------- character_languages ----------

CREATE TABLE IF NOT EXISTS "character_languages" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "character_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "spoken_fluency" varchar(20) DEFAULT 'none' NOT NULL,
  "written_fluency" varchar(20) DEFAULT 'none' NOT NULL,
  "points" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "library_language_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revision" bigint DEFAULT nextval('revisions_seq') NOT NULL
);
--> statement-breakpoint

ALTER TABLE "character_languages"
  DROP CONSTRAINT IF EXISTS "character_languages_character_id_fk";
--> statement-breakpoint

ALTER TABLE "character_languages"
  ADD CONSTRAINT "character_languages_character_id_fk"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "character_languages_character_idx"
  ON "character_languages" ("character_id");
--> statement-breakpoint

DROP TRIGGER IF EXISTS bump_revision_trg ON "character_languages";
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "character_languages"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint

-- S6: tombstone on delete so the cursor can propagate the removal.
DROP TRIGGER IF EXISTS record_tombstone_trg ON "character_languages";
--> statement-breakpoint
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "character_languages"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_tombstone('character_language');
--> statement-breakpoint

-- H1: character-family history trigger.
DROP TRIGGER IF EXISTS record_history_trg ON "character_languages";
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "character_languages"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_history('character_language');
