-- Append-only audit log for every syncable entity.
--
-- Three trigger functions (character root, character child, campaign) mirror
-- the tombstone trio in 0004 and resolve owner_user_id / campaign_id /
-- character_id from the row at write time.
--
-- actor_user_id and batch_id are read from Postgres session settings
-- (current_setting('app.actor_id', true) / 'app.batch_id') which MUST be set
-- via SET LOCAL inside the same transaction as each write.  See
-- src/server/db/auditContext.ts.  Without the same-transaction guarantee
-- (pg.Pool re-uses connections), the GUC would either be invisible or leak
-- onto unrelated requests.

CREATE TABLE "entity_history" (
  "id" uuid NOT NULL DEFAULT uuidv7(),
  "revision" bigint NOT NULL DEFAULT nextval('revisions_seq'),
  "scope" text NOT NULL,
  "entity_class" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "op" text NOT NULL,
  "character_id" uuid,
  "campaign_id" uuid,
  "owner_user_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "batch_id" uuid,
  "old_row" jsonb,
  "new_row" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
--> statement-breakpoint

CREATE INDEX "entity_history_character_revision_idx"
  ON "entity_history" ("character_id", "revision" DESC);
--> statement-breakpoint

CREATE INDEX "entity_history_campaign_scope_revision_idx"
  ON "entity_history" ("campaign_id", "scope", "revision" DESC);
--> statement-breakpoint

CREATE INDEX "entity_history_owner_revision_idx"
  ON "entity_history" ("owner_user_id", "revision" DESC);
--> statement-breakpoint

CREATE INDEX "entity_history_batch_idx"
  ON "entity_history" ("batch_id") WHERE batch_id IS NOT NULL;
--> statement-breakpoint

-- record_character_history: captures inserts/updates/deletes on the
-- characters table.  owner = owner_id, campaign = campaign_id,
-- character = id.  scope is always 'character'.
CREATE OR REPLACE FUNCTION record_character_history() RETURNS trigger AS $$
DECLARE
  actor uuid;
  batch uuid;
  row_owner uuid;
  row_campaign uuid;
  row_character uuid;
BEGIN
  actor := nullif(current_setting('app.actor_id', true), '')::uuid;
  batch := nullif(current_setting('app.batch_id', true), '')::uuid;
  IF TG_OP = 'DELETE' THEN
    row_owner    := OLD.owner_id;
    row_campaign := OLD.campaign_id;
    row_character := OLD.id;
  ELSE
    row_owner    := NEW.owner_id;
    row_campaign := NEW.campaign_id;
    row_character := NEW.id;
  END IF;
  INSERT INTO entity_history (
    scope, entity_class, entity_id, op,
    character_id, campaign_id, owner_user_id,
    actor_user_id, batch_id, old_row, new_row
  ) VALUES (
    'character', 'character', row_character,
    lower(TG_OP),
    row_character, row_campaign, row_owner,
    actor, batch,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  -- When a character changes campaigns (moved A->B, or removed from a campaign
  -- so campaign_id becomes null), the row above is keyed to the NEW campaign
  -- (or null), so the PREVIOUS campaign's GM would never see the departure in
  -- their scope=character rollup. Emit an extra row keyed to the old campaign
  -- so that move-away/removal is auditable from the campaign it left.
  IF TG_OP = 'UPDATE'
     AND OLD.campaign_id IS DISTINCT FROM NEW.campaign_id
     AND OLD.campaign_id IS NOT NULL THEN
    INSERT INTO entity_history (
      scope, entity_class, entity_id, op,
      character_id, campaign_id, owner_user_id,
      actor_user_id, batch_id, old_row, new_row
    ) VALUES (
      'character', 'character', row_character,
      'update',
      row_character, OLD.campaign_id, row_owner,
      actor, batch,
      to_jsonb(OLD), to_jsonb(NEW)
    );
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- record_character_child_history: captures inserts/updates/deletes on
-- character child tables (traits, skills, spells, inventory, combat).
-- TG_ARGV[0] = entity_class string.
-- Looks up owner_id and campaign_id from the parent character at trigger time.
-- If the parent was already cascade-deleted, falls back to a sentinel uuid
-- (mirrors the defensive pattern in record_character_child_tombstone).
CREATE OR REPLACE FUNCTION record_character_child_history() RETURNS trigger AS $$
DECLARE
  actor uuid;
  batch uuid;
  ent_class text := TG_ARGV[0];
  char_id uuid;
  row_id uuid;
  row_owner uuid;
  row_campaign uuid;
BEGIN
  actor := nullif(current_setting('app.actor_id', true), '')::uuid;
  batch := nullif(current_setting('app.batch_id', true), '')::uuid;
  IF TG_OP = 'DELETE' THEN
    char_id := OLD.character_id;
    row_id  := OLD.id;
  ELSE
    char_id := NEW.character_id;
    row_id  := NEW.id;
  END IF;
  SELECT owner_id, campaign_id INTO row_owner, row_campaign
  FROM characters WHERE id = char_id;
  -- Defensive: parent may be cascade-deleted; still record the child event.
  IF row_owner IS NULL THEN
    row_owner := '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;
  INSERT INTO entity_history (
    scope, entity_class, entity_id, op,
    character_id, campaign_id, owner_user_id,
    actor_user_id, batch_id, old_row, new_row
  ) VALUES (
    'character', ent_class, row_id,
    lower(TG_OP),
    char_id, row_campaign, row_owner,
    actor, batch,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- record_campaign_history: captures inserts/updates/deletes on campaign-
-- scoped tables.  TG_ARGV[0] = entity_class.
-- For the campaigns table itself, campaign = id and owner = owner_id.
-- For child tables (memberships, library, log), campaign and owner come
-- from OLD/NEW.campaign_id and a parent lookup.
CREATE OR REPLACE FUNCTION record_campaign_history() RETURNS trigger AS $$
DECLARE
  actor uuid;
  batch uuid;
  ent_class text := TG_ARGV[0];
  row_id uuid;
  row_campaign uuid;
  row_owner uuid;
BEGIN
  actor := nullif(current_setting('app.actor_id', true), '')::uuid;
  batch := nullif(current_setting('app.batch_id', true), '')::uuid;
  IF ent_class = 'campaign' THEN
    IF TG_OP = 'DELETE' THEN
      row_id := OLD.id; row_campaign := OLD.id; row_owner := OLD.owner_id;
    ELSE
      row_id := NEW.id; row_campaign := NEW.id; row_owner := NEW.owner_id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      row_id := OLD.id; row_campaign := OLD.campaign_id;
    ELSE
      row_id := NEW.id; row_campaign := NEW.campaign_id;
    END IF;
    SELECT owner_id INTO row_owner FROM campaigns WHERE id = row_campaign;
    IF row_owner IS NULL THEN
      row_owner := '00000000-0000-0000-0000-000000000000'::uuid;
    END IF;
  END IF;
  INSERT INTO entity_history (
    scope, entity_class, entity_id, op,
    character_id, campaign_id, owner_user_id,
    actor_user_id, batch_id, old_row, new_row
  ) VALUES (
    'campaign', ent_class, row_id,
    lower(TG_OP),
    NULL, row_campaign, row_owner,
    actor, batch,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Attach triggers to all 12 syncable tables (same set as bump_revision_trg
-- and record_tombstone_trg in 0002/0004).

-- Character root:
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "characters"
  FOR EACH ROW EXECUTE FUNCTION record_character_history();
--> statement-breakpoint

-- Character children:
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "character_traits"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_history('character_trait');
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "character_skills"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_history('character_skill');
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "character_spells"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_history('character_spell');
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "inventory_items"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_history('character_inventory');
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "combat_states"
  FOR EACH ROW EXECUTE FUNCTION record_character_child_history('character_combat');
--> statement-breakpoint

-- Campaign root:
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "campaigns"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign');
--> statement-breakpoint

-- Campaign children:
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "campaign_memberships"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_membership');
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "campaign_library_traits"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_library_trait');
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "campaign_library_skills"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_library_skill');
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "campaign_library_items"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_library_item');
--> statement-breakpoint
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON "adventure_log_entries"
  FOR EACH ROW EXECUTE FUNCTION record_campaign_history('adventure_log');
