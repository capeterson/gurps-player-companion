-- Read-only guest preview of a server-provisioned Lantern Coast campaign.
--
-- System accounts own the preview campaign and its characters (`preview_fixture`)
-- or read it as the shared guest (`preview_guest`). They carry an unusable
-- password hash and a reserved `.invalid` address, so no one can sign in as them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS system_role varchar(32);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_system_role_check;
ALTER TABLE users ADD CONSTRAINT users_system_role_check
  CHECK (system_role IS NULL OR system_role IN ('preview_guest', 'preview_fixture'));

-- Singleton pointer to the current preview campaign. Provisioning records the
-- content version it built so a deploy with newer seed content rebuilds it.
CREATE TABLE IF NOT EXISTS preview_campaign (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  guest_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_version text NOT NULL,
  provisioned_at timestamptz NOT NULL DEFAULT now()
);

-- Rejects every application write that touches the preview campaign. Writes
-- made with an application actor (`withAudit` sets app.actor_id) are refused
-- unless provisioning set app.preview_refresh for its own transaction. Schema
-- migrations and actor-less maintenance may still repair preview rows.
-- TG_ARGV[0] names how a row reaches its campaign:
--   id           the row is the campaign
--   campaign_id  the row's campaign_id column
--   character_id the owning character's campaign
--   encounter_id the owning encounter's campaign
CREATE OR REPLACE FUNCTION guard_preview_campaign() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  preview uuid;
  touched uuid[] := ARRAY[]::uuid[];
  rec jsonb;
  ref text;
BEGIN
  IF coalesce(current_setting('app.actor_id', true), '') = ''
     OR coalesce(current_setting('app.preview_refresh', true), '') = 'on' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  SELECT campaign_id INTO preview FROM preview_campaign;
  IF preview IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  FOREACH rec IN ARRAY ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
  ] LOOP
    CONTINUE WHEN rec IS NULL;
    ref := rec ->> CASE TG_ARGV[0] WHEN 'id' THEN 'id' ELSE TG_ARGV[0] END;
    CONTINUE WHEN ref IS NULL;
    touched := touched || CASE TG_ARGV[0]
      WHEN 'character_id' THEN (SELECT campaign_id FROM characters WHERE id = ref::uuid)
      WHEN 'encounter_id' THEN (SELECT campaign_id FROM encounters WHERE id = ref::uuid)
      ELSE ref::uuid
    END;
  END LOOP;

  IF preview = ANY(touched) THEN
    RAISE EXCEPTION 'the preview campaign is read-only'
      USING ERRCODE = 'insufficient_privilege', HINT = 'preview_read_only';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('campaigns', 'id'),
      ('campaign_memberships', 'campaign_id'),
      ('campaign_invitations', 'campaign_id'),
      ('characters', 'campaign_id'),
      ('character_traits', 'character_id'),
      ('character_skills', 'character_id'),
      ('character_languages', 'character_id'),
      ('character_techniques', 'character_id'),
      ('character_spells', 'character_id'),
      ('inventory_items', 'character_id'),
      ('combat_states', 'character_id'),
      ('encounters', 'campaign_id'),
      ('encounter_combatants', 'encounter_id'),
      ('encounter_effects', 'encounter_id'),
      ('adventure_log_entries', 'campaign_id'),
      ('campaign_library_sources', 'campaign_id'),
      ('campaign_library_modifiers', 'campaign_id'),
      ('campaign_library_traits', 'campaign_id'),
      ('campaign_library_skills', 'campaign_id'),
      ('campaign_library_spells', 'campaign_id'),
      ('campaign_library_items', 'campaign_id'),
      ('campaign_library_languages', 'campaign_id'),
      ('campaign_library_techniques', 'campaign_id'),
      ('campaign_library_styles', 'campaign_id'),
      ('campaign_library_enchantments', 'campaign_id'),
      ('campaign_library_active_effects', 'campaign_id'),
      ('campaign_library_races', 'campaign_id'),
      ('demo_seed_updates', 'campaign_id')
    ) AS guarded(table_name, mode)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS guard_preview_campaign_trg ON %I', target.table_name);
    EXECUTE format(
      'CREATE TRIGGER guard_preview_campaign_trg BEFORE INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION guard_preview_campaign(%L)',
      target.table_name,
      target.mode
    );
  END LOOP;
END;
$$;

-- System accounts never join, own or get invited to a campaign outside preview
-- provisioning. Otherwise a campaign admin could add the shared guest and make
-- their campaign readable to every anonymous preview visitor.
-- TG_ARGV[0] is the column holding the account id.
CREATE OR REPLACE FUNCTION guard_system_account_access() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> TG_ARGV[0]) IS NOT DISTINCT FROM account::text THEN
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('app.preview_refresh', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id = account AND system_role IS NOT NULL) THEN
    RAISE EXCEPTION 'system preview accounts cannot join, own or be invited to campaigns'
      USING ERRCODE = 'insufficient_privilege', HINT = 'preview_read_only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_system_account_access_trg ON campaign_memberships;
CREATE TRIGGER guard_system_account_access_trg BEFORE INSERT OR UPDATE ON campaign_memberships
  FOR EACH ROW EXECUTE FUNCTION guard_system_account_access('user_id');
DROP TRIGGER IF EXISTS guard_system_account_access_trg ON campaigns;
CREATE TRIGGER guard_system_account_access_trg BEFORE INSERT OR UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION guard_system_account_access('owner_id');
DROP TRIGGER IF EXISTS guard_system_account_access_trg ON campaign_invitations;
CREATE TRIGGER guard_system_account_access_trg BEFORE INSERT OR UPDATE ON campaign_invitations
  FOR EACH ROW EXECUTE FUNCTION guard_system_account_access('invitee_id');
