ALTER TABLE "oauth_clients"
  ALTER COLUMN "client_id" TYPE text;

ALTER TABLE "oauth_clients"
  ADD COLUMN IF NOT EXISTS "registration_method" varchar(20) NOT NULL DEFAULT 'configured',
  ADD COLUMN IF NOT EXISTS "metadata_expires_at" timestamptz;

DO $$ BEGIN
  ALTER TABLE "oauth_clients"
    ADD CONSTRAINT "oauth_clients_registration_method_check"
    CHECK ("registration_method" IN ('configured', 'cimd', 'dynamic'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
