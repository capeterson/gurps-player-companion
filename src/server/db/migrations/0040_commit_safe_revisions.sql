-- Cursor publication must follow transaction commit order. PostgreSQL sequences
-- are intentionally non-transactional: without a fence, transaction A can reserve
-- revision N, transaction B can commit N+1, and a cursor can advance past A before
-- A commits. Acquire one transaction-scoped advisory lock before every sync-visible
-- revision allocation so commits cannot become visible out of revision order.

CREATE OR REPLACE FUNCTION next_sync_revision() RETURNS bigint AS $$
BEGIN
  -- Stable, application-private two-int key ("GPC", "SYNC"). Re-entrant within
  -- a transaction, so trigger fan-out and tombstones can allocate more revisions.
  PERFORM pg_advisory_xact_lock(1196442400, 1398361667);
  RETURN nextval('revisions_seq');
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION bump_revision() RETURNS trigger AS $$
BEGIN
  NEW.revision := next_sync_revision();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Defaults invoke the fence before INSERT revision allocation. UPDATE paths use
-- bump_revision() above. These are the complete history/sync entity registry.
ALTER TABLE "campaigns"                    ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "campaign_memberships"         ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "characters"                   ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "character_traits"             ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "character_skills"             ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "character_spells"             ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "character_languages"          ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "character_techniques"         ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "inventory_items"              ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "combat_states"                ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "campaign_library_traits"      ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "campaign_library_skills"      ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "campaign_library_spells"      ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "campaign_library_items"       ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "campaign_library_languages"   ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "campaign_library_techniques"  ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "campaign_library_styles"      ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "adventure_log_entries"        ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint
ALTER TABLE "entity_history"               ALTER COLUMN "revision" SET DEFAULT next_sync_revision();
--> statement-breakpoint

-- DELETE never runs the BEFORE UPDATE revision trigger, so every tombstone
-- wrapper must acquire the same fence explicitly.
CREATE OR REPLACE FUNCTION record_character_tombstone() RETURNS trigger AS $$
BEGIN
  INSERT INTO entity_tombstones (entity_class, entity_id, owner_user_id, campaign_id, revision)
  VALUES ('character', OLD.id, OLD.owner_id, OLD.campaign_id, next_sync_revision());
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
  IF owner IS NULL THEN
    RETURN OLD;
  END IF;
  INSERT INTO entity_tombstones (entity_class, entity_id, owner_user_id, campaign_id, revision)
  VALUES (ent_class, OLD.id, owner, camp, next_sync_revision());
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION record_campaign_tombstone() RETURNS trigger AS $$
BEGIN
  INSERT INTO entity_tombstones (entity_class, entity_id, owner_user_id, campaign_id, revision)
  VALUES ('campaign', OLD.id, OLD.owner_id, OLD.id, next_sync_revision());
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION record_combat_tombstone() RETURNS trigger AS $$
DECLARE
  owner uuid;
  camp uuid;
BEGIN
  SELECT owner_id, campaign_id INTO owner, camp FROM characters WHERE id = OLD.character_id;
  IF owner IS NULL THEN
    RETURN OLD;
  END IF;
  INSERT INTO entity_tombstones (entity_class, entity_id, owner_user_id, campaign_id, revision)
  VALUES ('character_combat', OLD.character_id, owner, camp, next_sync_revision());
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
