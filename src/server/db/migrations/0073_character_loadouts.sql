-- Equipment loadouts: named sets of inventory items equipped in one gesture.
--
-- `character_loadouts` is a character-family child table (sync class
-- `character_loadout`). `item_ids` is validated by `loadoutItemIds`; ids of
-- deleted items may remain and are ignored by readers.
-- `characters.last_equipment_switch` holds the latest switch, validated by
-- `equipmentSwitch`: the Last Equipped loadout, the remembered active loadout
-- and the switch's undo journal. Idempotent throughout.

ALTER TABLE characters ADD COLUMN IF NOT EXISTS last_equipment_switch jsonb;

CREATE TABLE IF NOT EXISTS character_loadouts (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  item_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(item_ids) = 'array'),
  sort_order double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT next_sync_revision()
);

CREATE INDEX IF NOT EXISTS character_loadouts_character_idx ON character_loadouts(character_id);
CREATE INDEX IF NOT EXISTS character_loadouts_character_revision_idx
  ON character_loadouts(character_id, revision);

DROP TRIGGER IF EXISTS bump_revision_trg ON character_loadouts;
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON character_loadouts
  FOR EACH ROW EXECUTE FUNCTION bump_revision();

-- S6: tombstone on delete so the cursor can propagate the removal.
DROP TRIGGER IF EXISTS record_tombstone_trg ON character_loadouts;
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON character_loadouts
  FOR EACH ROW EXECUTE FUNCTION record_character_child_tombstone('character_loadout');

-- H1: character-family history trigger.
DROP TRIGGER IF EXISTS record_history_trg ON character_loadouts;
CREATE TRIGGER record_history_trg AFTER INSERT OR UPDATE OR DELETE ON character_loadouts
  FOR EACH ROW EXECUTE FUNCTION record_character_child_history('character_loadout');

-- The read-only guest preview campaign guards every character-family table.
DROP TRIGGER IF EXISTS guard_preview_campaign_trg ON character_loadouts;
CREATE TRIGGER guard_preview_campaign_trg BEFORE INSERT OR UPDATE OR DELETE ON character_loadouts
  FOR EACH ROW EXECUTE FUNCTION guard_preview_campaign('character_id');
