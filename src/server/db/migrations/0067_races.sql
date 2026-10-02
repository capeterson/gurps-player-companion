ALTER TABLE characters ADD COLUMN IF NOT EXISTS race jsonb NOT NULL DEFAULT '{"selection":{"raceId":null,"variantKey":null,"lensIds":[],"formKey":null},"snapshot":null}'::jsonb;
CREATE TABLE IF NOT EXISTS campaign_library_races (
 id uuid PRIMARY KEY DEFAULT uuidv7(), campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 name varchar(160) NOT NULL, description text, source varchar(160), kind varchar(16) NOT NULL DEFAULT 'race' CHECK (kind IN ('race','lens')), points integer NOT NULL DEFAULT 0,
 key varchar(160) NOT NULL DEFAULT '', source_key varchar(160), source_locator varchar(240), status varchar(24) NOT NULL DEFAULT 'complete', role varchar(24) NOT NULL DEFAULT 'definition', preferred_edition boolean NOT NULL DEFAULT false, restricted boolean NOT NULL DEFAULT false, extraction jsonb,
 attribute_modifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
 traits jsonb NOT NULL DEFAULT '[]'::jsonb,
 skills jsonb NOT NULL DEFAULT '[]'::jsonb,
 features jsonb NOT NULL DEFAULT '[]'::jsonb,
 effects jsonb NOT NULL DEFAULT '[]'::jsonb,
 variants jsonb NOT NULL DEFAULT '[]'::jsonb,
 forms jsonb NOT NULL DEFAULT '[]'::jsonb,
 compatible_race_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
 removes_traits jsonb NOT NULL DEFAULT '[]'::jsonb,
 removes_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
 tags jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT next_sync_revision()
);
DROP INDEX IF EXISTS campaign_library_races_key;
CREATE UNIQUE INDEX campaign_library_races_key ON campaign_library_races(campaign_id,kind,lower(coalesce(nullif(key,''),name)),coalesce(lower(source_key),''));
CREATE INDEX IF NOT EXISTS campaign_library_races_campaign_revision_idx ON campaign_library_races(campaign_id,revision);
DROP TRIGGER IF EXISTS bump_revision_trg ON campaign_library_races;
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON campaign_library_races FOR EACH ROW EXECUTE FUNCTION bump_revision();
DROP TRIGGER IF EXISTS record_history_trg ON campaign_library_races;
CREATE TRIGGER record_history_trg AFTER INSERT OR UPDATE OR DELETE ON campaign_library_races FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_library_race');
DROP TRIGGER IF EXISTS record_tombstone_trg ON campaign_library_races;
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON campaign_library_races FOR EACH ROW EXECUTE FUNCTION record_campaign_library_tombstone('campaign_library_race');
