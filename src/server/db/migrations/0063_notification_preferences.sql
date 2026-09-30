ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb NOT NULL DEFAULT '{"emailInvitations":true,"emailInvitationAccepted":true,"invitations":true,"membership":true,"characterChanges":true,"points":true,"campaignChanges":true,"adventureLog":true,"libraryChanges":true}'::jsonb;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "group_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_group_key" ON "notifications" ("user_id", "group_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_history_queue" (
  "gesture_batch_id" uuid,
  "history_id" uuid PRIMARY KEY REFERENCES entity_history(id) ON DELETE CASCADE,
  "recipient_ids" uuid[] NOT NULL,
  "campaign_name" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_email_queue" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7(),
  "user_id" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "kind" varchar(32) NOT NULL CHECK (kind IN ('invitation', 'invitation_accepted', 'security')),
  "related_id" uuid,
  "event_key" text NOT NULL UNIQUE,
  "subject" varchar(300) NOT NULL,
  "message" varchar(1500) NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz,
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_email_due_idx ON notification_email_queue(next_attempt_at) WHERE sent_at IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION queue_notification_history() RETURNS trigger AS $$
DECLARE recipients uuid[] := '{}'; camp_name text;
BEGIN
  -- System maintenance/migrations and unrelated history never generate inbox noise.
  IF NEW.actor_user_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.scope = 'character' THEN
    recipients := ARRAY[NEW.owner_user_id];
  ELSIF NEW.entity_class = 'campaign_membership' THEN
    recipients := ARRAY[(coalesce(NEW.new_row, NEW.old_row)->>'user_id')::uuid];
  ELSIF NEW.entity_class IN ('campaign', 'adventure_log') THEN
    SELECT ARRAY(SELECT user_id FROM campaign_memberships WHERE campaign_id = NEW.campaign_id
      UNION SELECT owner_id FROM campaigns WHERE id = NEW.campaign_id) INTO recipients;
    IF NEW.entity_class = 'campaign' THEN
      recipients := recipients || ARRAY[NEW.owner_user_id];
      IF NEW.op IN ('patch', 'update') THEN
        recipients := recipients || ARRAY[(NEW.old_row->>'owner_id')::uuid, (NEW.new_row->>'owner_id')::uuid];
      END IF;
    END IF;
  ELSE RETURN NEW;
  END IF;
  SELECT name INTO camp_name FROM campaigns WHERE id = NEW.campaign_id;
  IF camp_name IS NULL AND NEW.entity_class = 'campaign' THEN
    camp_name := coalesce(NEW.new_row, NEW.old_row)->>'name';
  END IF;
  INSERT INTO notification_history_queue(history_id, recipient_ids, campaign_name, gesture_batch_id)
    VALUES (NEW.id, recipients, camp_name, nullif(current_setting('app.notification_batch_id', true), '')::uuid) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS queue_notification_history_trg ON entity_history;
CREATE TRIGGER queue_notification_history_trg AFTER INSERT ON entity_history FOR EACH ROW EXECUTE FUNCTION queue_notification_history();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION queue_invitation_mail() RETURNS trigger AS $$
DECLARE camp_name text; actor_name text; target_id uuid; mail_kind text; title text; msg text;
BEGIN
  SELECT name INTO camp_name FROM campaigns WHERE id = NEW.campaign_id;
  IF TG_OP = 'INSERT' THEN
    SELECT display_name INTO actor_name FROM users WHERE id = NEW.inviter_id;
    target_id := NEW.invitee_id; mail_kind := 'invitation';
    title := actor_name || ' invited you to join ' || camp_name;
    msg := 'You have been invited to ' || camp_name || '. Sign in to accept or decline.';
  ELSIF OLD.status = 'pending' AND NEW.status IN ('accepted', 'rejected') THEN
    SELECT display_name INTO actor_name FROM users WHERE id = NEW.invitee_id;
    IF NEW.status <> 'accepted' THEN RETURN NEW; END IF;
    target_id := NEW.inviter_id; mail_kind := 'invitation_accepted';
    title := actor_name || ' accepted your campaign invitation';
    msg := actor_name || ' joined ' || camp_name || '.';
  ELSE RETURN NEW;
  END IF;
  INSERT INTO notification_email_queue(user_id, kind, related_id, event_key, subject, message)
    VALUES (target_id, mail_kind, NEW.id, mail_kind || ':' || NEW.id, title, msg) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS queue_invitation_mail_trg ON campaign_invitations;
CREATE TRIGGER queue_invitation_mail_trg AFTER INSERT OR UPDATE ON campaign_invitations FOR EACH ROW EXECUTE FUNCTION queue_invitation_mail();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION queue_security_mail() RETURNS trigger AS $$
DECLARE target_id uuid; msg text;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    IF OLD.password_hash IS NOT DISTINCT FROM NEW.password_hash THEN RETURN NEW; END IF;
    target_id := NEW.id; msg := 'Your Player Companion password was changed.';
  ELSE
    target_id := coalesce(NEW.user_id, OLD.user_id);
    -- Account purges must not recreate jobs referencing a deleted account.
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = target_id) THEN RETURN coalesce(NEW, OLD); END IF;
    IF TG_TABLE_NAME = 'passkey_credentials' THEN
      msg := CASE WHEN TG_OP = 'INSERT' THEN 'A passkey was added to' ELSE 'A passkey was removed from' END || ' your Player Companion account.';
    ELSE
      IF TG_OP = 'UPDATE' AND (OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL) THEN RETURN NEW; END IF;
      msg := CASE WHEN TG_OP = 'INSERT' THEN 'An API key was created for' ELSE 'An API key was revoked for' END || ' your Player Companion account.';
    END IF;
  END IF;
  -- One alert per account/transaction (password recovery also removes credentials).
  INSERT INTO notification_email_queue(user_id, kind, event_key, subject, message)
    VALUES (target_id, 'security', 'security:' || target_id || ':' || pg_current_xact_id(),
      'Player Companion security alert', msg || ' If this was not you, reset your password and review your sign-in credentials.') ON CONFLICT DO NOTHING;
  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS queue_security_mail_trg ON users;
CREATE TRIGGER queue_security_mail_trg AFTER UPDATE OF password_hash ON users FOR EACH ROW EXECUTE FUNCTION queue_security_mail();
DROP TRIGGER IF EXISTS queue_security_mail_trg ON passkey_credentials;
CREATE TRIGGER queue_security_mail_trg AFTER INSERT OR DELETE ON passkey_credentials FOR EACH ROW EXECUTE FUNCTION queue_security_mail();
DROP TRIGGER IF EXISTS queue_security_mail_trg ON api_keys;
CREATE TRIGGER queue_security_mail_trg AFTER INSERT OR UPDATE OF revoked_at ON api_keys FOR EACH ROW EXECUTE FUNCTION queue_security_mail();
