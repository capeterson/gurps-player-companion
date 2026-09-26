-- Campaign-library rows are sync-backed (AGENTS.md S0/S6): deletes must reach
-- other devices through /sync/cursor tombstones. Members see them through
-- entity_tombstones.campaign_id; the owner column records the campaign owner.
-- A cascade from a deleted campaign finds no campaign row and skips: the
-- campaign tombstone plus the client's access prune remove those rows.
CREATE OR REPLACE FUNCTION record_campaign_library_tombstone() RETURNS trigger AS $$
DECLARE
  owner uuid;
BEGIN
  SELECT owner_id INTO owner FROM campaigns WHERE id = OLD.campaign_id;
  IF owner IS NULL THEN
    RETURN OLD;
  END IF;
  INSERT INTO entity_tombstones (entity_class, entity_id, owner_user_id, campaign_id, revision)
  VALUES (TG_ARGV[0], OLD.id, owner, OLD.campaign_id, next_sync_revision())
  ON CONFLICT (entity_class, entity_id) DO UPDATE
    SET revision = EXCLUDED.revision, deleted_at = now(),
        owner_user_id = EXCLUDED.owner_user_id, campaign_id = EXCLUDED.campaign_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_tombstone_trg ON "campaign_library_traits";
--> statement-breakpoint
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "campaign_library_traits"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_library_tombstone('campaign_library_trait');
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_tombstone_trg ON "campaign_library_skills";
--> statement-breakpoint
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "campaign_library_skills"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_library_tombstone('campaign_library_skill');
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_tombstone_trg ON "campaign_library_spells";
--> statement-breakpoint
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "campaign_library_spells"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_library_tombstone('campaign_library_spell');
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_tombstone_trg ON "campaign_library_items";
--> statement-breakpoint
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "campaign_library_items"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_library_tombstone('campaign_library_item');
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_tombstone_trg ON "campaign_library_languages";
--> statement-breakpoint
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "campaign_library_languages"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_library_tombstone('campaign_library_language');
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_tombstone_trg ON "campaign_library_techniques";
--> statement-breakpoint
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "campaign_library_techniques"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_library_tombstone('campaign_library_technique');
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_tombstone_trg ON "campaign_library_styles";
--> statement-breakpoint
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "campaign_library_styles"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_library_tombstone('campaign_library_style');
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_tombstone_trg ON "campaign_library_enchantments";
--> statement-breakpoint
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "campaign_library_enchantments"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_library_tombstone('campaign_library_enchantment');
--> statement-breakpoint
DROP TRIGGER IF EXISTS record_tombstone_trg ON "campaign_library_active_effects";
--> statement-breakpoint
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "campaign_library_active_effects"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_library_tombstone('campaign_library_active_effect');
