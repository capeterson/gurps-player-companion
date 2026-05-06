-- Instance-admin support: superuser flag + purge timer.
--
-- `is_superuser` is set ONLY via direct DB edit (bootstrap convention) —
-- there's no API or UI path to grant it.  The admin router gates on this
-- flag.  `purge_scheduled_at` is a 30-day soft-delete timer set via
-- /admin/users/{id}/purge; the actual hard-delete sweep is left as a
-- future job (the timestamp is the contract).

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_superuser" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "purge_scheduled_at" timestamp with time zone;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_purge_scheduled_at_idx"
  ON "users" ("purge_scheduled_at");
