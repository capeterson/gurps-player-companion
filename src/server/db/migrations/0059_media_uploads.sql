ALTER TABLE users ADD COLUMN IF NOT EXISTS media_uploads_disabled boolean NOT NULL DEFAULT false;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS portrait_asset_id uuid;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cover_asset_id uuid;
CREATE TABLE IF NOT EXISTS media_assets (
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 uploader_id uuid REFERENCES users(id) ON DELETE SET NULL,
 client_upload_id uuid NOT NULL,
 target_type varchar(16) NOT NULL CHECK (target_type IN ('character','campaign')),
 target_id uuid NOT NULL,
 input_bytes integer NOT NULL CHECK (input_bytes BETWEEN 1 AND 10485760),
 sha256 varchar(64) NOT NULL,
 token varchar(64) NOT NULL,
 state varchar(16) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','ready','cancelled','deleting','rejected')),
 object_prefix text,
 thumb_bytes integer NOT NULL DEFAULT 0,
 display_bytes integer NOT NULL DEFAULT 0,
 width integer, height integer, reason text,
 lease_until timestamptz, published_at timestamptz, detached_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS media_assets_retry ON media_assets(uploader_id, client_upload_id);
CREATE UNIQUE INDEX IF NOT EXISTS media_assets_token ON media_assets(token);
CREATE INDEX IF NOT EXISTS media_assets_target ON media_assets(target_type,target_id);
CREATE TABLE IF NOT EXISTS media_counters (key text PRIMARY KEY, amount bigint NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS media_counters_expiry ON media_counters(expires_at);
-- Existing parent history/revision triggers cover attachment changes. A removed
-- reference starts retention at detachment, not at the original upload date.
CREATE OR REPLACE FUNCTION detach_media_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_id uuid; new_id uuid;
BEGIN
 IF TG_TABLE_NAME = 'characters' THEN
  old_id := OLD.portrait_asset_id;
  IF TG_OP <> 'DELETE' THEN new_id := NEW.portrait_asset_id; END IF;
 ELSE
  old_id := OLD.cover_asset_id;
  IF TG_OP <> 'DELETE' THEN new_id := NEW.cover_asset_id; END IF;
 END IF;
 IF old_id IS NOT NULL AND old_id IS DISTINCT FROM new_id THEN
  UPDATE media_assets SET detached_at = now() WHERE id = old_id;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS detach_media_reference_trg ON characters;
CREATE TRIGGER detach_media_reference_trg AFTER UPDATE OR DELETE ON characters FOR EACH ROW EXECUTE FUNCTION detach_media_reference();
DROP TRIGGER IF EXISTS detach_media_reference_trg ON campaigns;
CREATE TRIGGER detach_media_reference_trg AFTER UPDATE OR DELETE ON campaigns FOR EACH ROW EXECUTE FUNCTION detach_media_reference();
