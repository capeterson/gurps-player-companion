-- entity_tombstones records every delete on a syncable table so the sync
-- cursor endpoint can tell clients which local rows to drop.  Without
-- tombstones, a client that was offline when a row was deleted would
-- never learn about the deletion -- it'd see no upsert for the row and
-- assume "still exists, just unchanged".
--
-- The `revision` here uses the same shared sequence as live row updates
-- (see 0004_shared_revision_sequence.sql), so tombstones interleave with
-- upserts in monotonic per-class cursor order.
--
-- `owner_user_id` is denormalized so the cursor query can scope the
-- response cheaply (no joining back to the now-deleted parent chain).
-- For child rows (traits, skills, inventory, combat) we resolve owner
-- via the parent character at trigger time.

CREATE TABLE "entity_tombstones" (
  "entity_class" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "campaign_id" uuid,
  "revision" bigint NOT NULL,
  "deleted_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("entity_class", "entity_id")
);
--> statement-breakpoint

CREATE INDEX "entity_tombstones_owner_revision_idx"
  ON "entity_tombstones" ("owner_user_id", "revision");
--> statement-breakpoint

CREATE INDEX "entity_tombstones_campaign_revision_idx"
  ON "entity_tombstones" ("campaign_id", "revision");
