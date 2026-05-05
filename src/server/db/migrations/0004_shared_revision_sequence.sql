-- Unify all `revision` columns and the entity_tombstones revision
-- onto a single shared sequence so cursor ordering is total across
-- every entity class and across upserts + deletes.
--
-- Before this migration each table had its own bigserial sequence
-- ('campaigns_revision_seq', 'characters_revision_seq', ...).  After
-- this migration every revision-bumping write nextval()s from
-- 'revisions_seq' instead, and the trigger that bumps revision on
-- UPDATE (from 0002) is rewritten to use the same shared sequence.
-- Tombstone INSERTs also pull from this sequence.

CREATE SEQUENCE IF NOT EXISTS "revisions_seq" AS bigint;
--> statement-breakpoint

-- Seed the shared sequence above the highest existing per-table value
-- so post-migration cursors don't collide with pre-migration revisions.
DO $$
DECLARE
  max_rev bigint := 0;
  v bigint;
BEGIN
  FOR v IN
    SELECT MAX(revision) FROM campaigns UNION ALL
    SELECT MAX(revision) FROM campaign_memberships UNION ALL
    SELECT MAX(revision) FROM characters UNION ALL
    SELECT MAX(revision) FROM character_traits UNION ALL
    SELECT MAX(revision) FROM character_skills UNION ALL
    SELECT MAX(revision) FROM inventory_items UNION ALL
    SELECT MAX(revision) FROM combat_states UNION ALL
    SELECT MAX(revision) FROM adventure_log_entries UNION ALL
    SELECT MAX(revision) FROM campaign_library_traits UNION ALL
    SELECT MAX(revision) FROM campaign_library_skills UNION ALL
    SELECT MAX(revision) FROM campaign_library_items
  LOOP
    IF v IS NOT NULL AND v > max_rev THEN
      max_rev := v;
    END IF;
  END LOOP;
  -- setval() with is_called=true means nextval() returns max_rev+1.
  PERFORM setval('revisions_seq', GREATEST(max_rev, 1), true);
END$$;
--> statement-breakpoint

-- Rewrite each per-table column default to use the shared sequence.
ALTER TABLE "campaigns"               ALTER COLUMN "revision" SET DEFAULT nextval('revisions_seq');
--> statement-breakpoint
ALTER TABLE "campaign_memberships"    ALTER COLUMN "revision" SET DEFAULT nextval('revisions_seq');
--> statement-breakpoint
ALTER TABLE "characters"              ALTER COLUMN "revision" SET DEFAULT nextval('revisions_seq');
--> statement-breakpoint
ALTER TABLE "character_traits"        ALTER COLUMN "revision" SET DEFAULT nextval('revisions_seq');
--> statement-breakpoint
ALTER TABLE "character_skills"        ALTER COLUMN "revision" SET DEFAULT nextval('revisions_seq');
--> statement-breakpoint
ALTER TABLE "inventory_items"         ALTER COLUMN "revision" SET DEFAULT nextval('revisions_seq');
--> statement-breakpoint
ALTER TABLE "combat_states"           ALTER COLUMN "revision" SET DEFAULT nextval('revisions_seq');
--> statement-breakpoint
ALTER TABLE "adventure_log_entries"   ALTER COLUMN "revision" SET DEFAULT nextval('revisions_seq');
--> statement-breakpoint
ALTER TABLE "campaign_library_traits" ALTER COLUMN "revision" SET DEFAULT nextval('revisions_seq');
--> statement-breakpoint
ALTER TABLE "campaign_library_skills" ALTER COLUMN "revision" SET DEFAULT nextval('revisions_seq');
--> statement-breakpoint
ALTER TABLE "campaign_library_items"  ALTER COLUMN "revision" SET DEFAULT nextval('revisions_seq');
--> statement-breakpoint

-- Replace the bump_revision() function so UPDATE triggers also pull from
-- the shared sequence (instead of pg_get_serial_sequence on the per-table
-- bigserial, which would silently diverge after this migration).
CREATE OR REPLACE FUNCTION bump_revision() RETURNS trigger AS $$
BEGIN
  NEW.revision := nextval('revisions_seq');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- record_tombstone() inserts into entity_tombstones with a fresh
-- revision from the shared sequence.  Each AFTER DELETE trigger passes
-- its entity_class label and resolves owner_user_id / campaign_id from
-- OLD via TG_ARGV ($1 = entity_class, $2 = owner_user_id source column,
-- optional $3 = campaign_id source column or 'null').
--
-- For child rows (traits/skills/inventory/combat) the owner is on the
-- parent character; we look it up via the OLD.character_id at trigger
-- time.  If the parent character is itself being deleted in the same
-- transaction, PG fires the child's AFTER DELETE before the parent's,
-- and the parent row is still visible inside the trigger -- so the
-- subquery resolves correctly even on cascade.
CREATE OR REPLACE FUNCTION record_character_tombstone() RETURNS trigger AS $$
BEGIN
  INSERT INTO entity_tombstones (entity_class, entity_id, owner_user_id, campaign_id, revision)
  VALUES ('character', OLD.id, OLD.owner_id, OLD.campaign_id, nextval('revisions_seq'));
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION record_character_child_tombstone() RETURNS trigger AS $$
DECLARE
  owner uuid;
  camp uuid;
  ent_class text := TG_ARGV[0];
BEGIN
  SELECT owner_id, campaign_id INTO owner, camp FROM characters WHERE id = OLD.character_id;
  -- If parent already gone (defensive) skip; the parent's own tombstone
  -- + child cascade tombstones from earlier rows still cover it.
  IF owner IS NULL THEN
    RETURN OLD;
  END IF;
  INSERT INTO entity_tombstones (entity_class, entity_id, owner_user_id, campaign_id, revision)
  VALUES (ent_class, OLD.id, owner, camp, nextval('revisions_seq'));
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION record_campaign_tombstone() RETURNS trigger AS $$
BEGIN
  INSERT INTO entity_tombstones (entity_class, entity_id, owner_user_id, campaign_id, revision)
  VALUES ('campaign', OLD.id, OLD.owner_id, OLD.id, nextval('revisions_seq'));
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "characters"
  FOR EACH ROW EXECUTE FUNCTION record_character_tombstone();
--> statement-breakpoint

CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "character_traits"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_tombstone('character_trait');
--> statement-breakpoint

CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "character_skills"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_tombstone('character_skill');
--> statement-breakpoint

CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "inventory_items"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_tombstone('character_inventory');
--> statement-breakpoint

CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "combat_states"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_tombstone('character_combat');
--> statement-breakpoint

CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "campaigns"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_tombstone();
