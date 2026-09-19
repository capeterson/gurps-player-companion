ALTER TABLE characters ADD COLUMN IF NOT EXISTS active_effects jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS campaign_library_active_effects (
 id uuid PRIMARY KEY DEFAULT uuidv7(), campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 name varchar(160) NOT NULL, description text, source varchar(160), tags jsonb NOT NULL DEFAULT '[]',
 effects jsonb NOT NULL DEFAULT '[]', capabilities jsonb NOT NULL DEFAULT '[]',duration jsonb NOT NULL,stacking jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT next_sync_revision()
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_library_active_effects_key ON campaign_library_active_effects(campaign_id,lower(name));
DROP TRIGGER IF EXISTS bump_revision_trg ON campaign_library_active_effects;
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON campaign_library_active_effects FOR EACH ROW EXECUTE FUNCTION bump_revision();
DROP TRIGGER IF EXISTS record_history_trg ON campaign_library_active_effects;
CREATE TRIGGER record_history_trg AFTER INSERT OR UPDATE OR DELETE ON campaign_library_active_effects FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_library_active_effect');

-- Publish the new empty/read-only template projection to existing installations once.
DO $$ BEGIN
 IF obj_description('campaign_library_active_effects'::regclass) IS DISTINCT FROM 'active-effect-projection-v1' THEN
  UPDATE campaigns SET updated_at=updated_at;
  COMMENT ON TABLE campaign_library_active_effects IS 'active-effect-projection-v1';
 END IF;
END $$;
