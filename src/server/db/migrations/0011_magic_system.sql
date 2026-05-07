-- GURPS magic system: spells (per-character), powerstones + magic items
-- (extensions to inventory).  See src/shared/domain/spellCalc.ts for the
-- math; this migration only sets up storage + sync plumbing.

-- ---------- character_spells ----------
--
-- Mechanically a spell IS an IQ/Hard skill, but we keep them in a
-- separate table so spell-specific fields (college, energy cost,
-- casting time, duration) stay out of the regular skill row and the
-- Magic panel can render without a filter pass.

CREATE TABLE IF NOT EXISTS "character_spells" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "character_id" uuid NOT NULL,
  "name" varchar(160) NOT NULL,
  "college" varchar(80),
  "points" integer DEFAULT 1 NOT NULL,
  "base_energy_cost" smallint DEFAULT 1 NOT NULL,
  "maintenance_cost" smallint,
  "casting_time" varchar(40),
  "duration" varchar(40),
  "prerequisites" text,
  "notes" text,
  "library_spell_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Pull from the shared sequence (see 0004) so cursor ordering is total
  -- across every entity class and across upserts + deletes.
  "revision" bigint DEFAULT nextval('revisions_seq') NOT NULL
);
--> statement-breakpoint

ALTER TABLE "character_spells"
  ADD CONSTRAINT "character_spells_character_id_fk"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE;
--> statement-breakpoint

CREATE INDEX "character_spells_character_idx" ON "character_spells" ("character_id");
--> statement-breakpoint

-- BEFORE UPDATE trigger: bump revision on every UPDATE so per-field
-- patches advance the sync cursor.  Mirrors 0002_revision_triggers.
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "character_spells"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint

-- AFTER DELETE trigger: record a tombstone on the shared revision
-- sequence so /sync/cursor can tell offline clients to drop the row.
-- Mirrors the existing character_skills wiring in 0004.
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "character_spells"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_tombstone('character_spell');
--> statement-breakpoint

-- ---------- inventory_items: powerstone + magic item metadata ----------
--
-- Both columns are nullable: null means "this item is not a powerstone /
-- not a magic item".  Mirrors the existing armor / weapon_data jsonb
-- pattern so weight, cost, container hierarchy etc. all flow through
-- the same inventory plumbing.

ALTER TABLE "inventory_items" ADD COLUMN "powerstone_data" jsonb;
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "magic_item_data" jsonb;
