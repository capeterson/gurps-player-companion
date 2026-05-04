-- Bump `revision` on every UPDATE for syncable tables.
--
-- Without this, `bigserial` only advances the column on INSERT, so PATCH
-- writes look unchanged to revision-based sync consumers and the client
-- outbox cursor misses change events.
--
-- Each syncable table gets a BEFORE UPDATE trigger that calls a single
-- function which looks up the table's own bigserial sequence and assigns
-- the next value to NEW.revision.

CREATE OR REPLACE FUNCTION bump_revision() RETURNS trigger AS $$
DECLARE
  seq_name text;
BEGIN
  seq_name := pg_get_serial_sequence(TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, 'revision');
  IF seq_name IS NOT NULL THEN
    NEW.revision := nextval(seq_name);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "campaigns"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "campaign_memberships"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "characters"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "character_traits"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "character_skills"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "inventory_items"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "combat_states"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "adventure_log_entries"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "campaign_library_traits"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "campaign_library_skills"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
--> statement-breakpoint
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON "campaign_library_items"
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
