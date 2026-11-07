-- Sunbolt replaces Illuminated Manuscript as the default light palette.
-- Existing choices carry over to the new palette; the column default and the
-- allowed values follow.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_light_theme_check;
UPDATE users SET light_theme = 'sunbolt' WHERE light_theme = 'illuminated-manuscript';
ALTER TABLE users ALTER COLUMN light_theme SET DEFAULT 'sunbolt';
ALTER TABLE users ADD CONSTRAINT users_light_theme_check CHECK (light_theme IN ('sunbolt', 'heraldic-vellum', 'arcane-light'));
--> statement-breakpoint
-- Security alert emails use the new app name; triggers keep pointing at this function.
CREATE OR REPLACE FUNCTION queue_security_mail() RETURNS trigger AS $$
DECLARE target_id uuid; msg text;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    IF OLD.password_hash IS NOT DISTINCT FROM NEW.password_hash THEN RETURN NEW; END IF;
    target_id := NEW.id; msg := 'Your Sunbolt password was changed.';
  ELSE
    target_id := coalesce(NEW.user_id, OLD.user_id);
    -- Account purges must not recreate jobs referencing a deleted account.
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = target_id) THEN RETURN coalesce(NEW, OLD); END IF;
    IF TG_TABLE_NAME = 'passkey_credentials' THEN
      msg := CASE WHEN TG_OP = 'INSERT' THEN 'A passkey was added to' ELSE 'A passkey was removed from' END || ' your Sunbolt account.';
    ELSE
      IF TG_OP = 'UPDATE' AND (OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL) THEN RETURN NEW; END IF;
      msg := CASE WHEN TG_OP = 'INSERT' THEN 'An API key was created for' ELSE 'An API key was revoked for' END || ' your Sunbolt account.';
    END IF;
  END IF;
  -- One alert per account/transaction (password recovery also removes credentials).
  INSERT INTO notification_email_queue(user_id, kind, event_key, subject, message)
    VALUES (target_id, 'security', 'security:' || target_id || ':' || pg_current_xact_id(),
      'Sunbolt security alert', msg || ' If this was not you, reset your password and review your sign-in credentials.') ON CONFLICT DO NOTHING;
  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
