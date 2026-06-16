CREATE TABLE IF NOT EXISTS "passkey_credentials" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "user_id" uuid NOT NULL,
  "credential_id" text NOT NULL,
  "public_key" text NOT NULL,
  "sign_count" integer DEFAULT 0 NOT NULL,
  "name" varchar(80) DEFAULT 'Passkey' NOT NULL,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "passkey_credentials_credential_id_key" ON "passkey_credentials" USING btree ("credential_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkey_credentials_user_idx" ON "passkey_credentials" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "passkey_challenges" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "challenge_hash" varchar(64) NOT NULL,
  "user_id" uuid,
  "purpose" varchar(32) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "passkey_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "passkey_challenges_hash_key" ON "passkey_challenges" USING btree ("challenge_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkey_challenges_expires_at_idx" ON "passkey_challenges" USING btree ("expires_at");
