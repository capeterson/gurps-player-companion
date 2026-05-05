-- Combat-state tombstones are keyed on character_id, not combat_states.id.
--
-- The local Dexie `characterCombat` store uses characterId as its
-- primary key (1:1 with the character), and the cursor route emits
-- combat upserts under the same key (see fetchChildClass entityIdField
-- = 'characterId').  Tombstones must follow the same convention so a
-- server-side combat delete -- typically a cascade from `characters`
-- being deleted -- removes the matching local row.
--
-- The previous trigger inherited the generic
-- `record_character_child_tombstone` function which uses OLD.id, so
-- combat deletes ended up with entity_id = combat_states.id, and the
-- client's `deleteLocal('character_combat', entityId)` never matched.

DROP TRIGGER IF EXISTS record_tombstone_trg ON "combat_states";
--> statement-breakpoint

CREATE OR REPLACE FUNCTION record_combat_tombstone() RETURNS trigger AS $$
DECLARE
  owner uuid;
  camp uuid;
BEGIN
  SELECT owner_id, campaign_id INTO owner, camp FROM characters WHERE id = OLD.character_id;
  -- Defensive: parent character may already be gone (concurrent
  -- delete); if so the parent's own tombstone covers it and we
  -- skip emitting an orphan combat tombstone.
  IF owner IS NULL THEN
    RETURN OLD;
  END IF;
  INSERT INTO entity_tombstones (entity_class, entity_id, owner_user_id, campaign_id, revision)
  VALUES ('character_combat', OLD.character_id, owner, camp, nextval('revisions_seq'));
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER record_tombstone_trg AFTER DELETE ON "combat_states"
  FOR EACH ROW EXECUTE FUNCTION record_combat_tombstone();
