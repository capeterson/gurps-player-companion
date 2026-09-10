CREATE TABLE IF NOT EXISTS "auth_rate_limits" (
  "scope" varchar(32) NOT NULL,
  "key" varchar(128) NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "attempts" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "auth_rate_limits_scope_key_pk" PRIMARY KEY("scope", "key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_rate_limits_expires_at_idx" ON "auth_rate_limits" USING btree ("expires_at");
