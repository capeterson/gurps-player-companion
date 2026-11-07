-- Recycle bin: deleted characters and campaigns stay in place, marked, for 30
-- days. Rows keep their children, library, media references and history; the
-- nightly sweep (services/recycleBin.ts) hard-deletes expired rows, running the
-- existing cascade, tombstone and media-orphan machinery unchanged.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
--> statement-breakpoint
ALTER TABLE characters ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
-- Soft reference (no FK): purging the campaign must not rewrite its characters.
ALTER TABLE characters ADD COLUMN IF NOT EXISTS recycled_from_campaign_id uuid;
--> statement-breakpoint
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
--> statement-breakpoint
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS characters_deleted_at_idx ON characters (deleted_at) WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS characters_recycled_from_campaign_idx ON characters (recycled_from_campaign_id) WHERE recycled_from_campaign_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS campaigns_deleted_at_idx ON campaigns (deleted_at) WHERE deleted_at IS NOT NULL;
