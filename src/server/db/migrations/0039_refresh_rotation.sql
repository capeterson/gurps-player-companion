ALTER TABLE "refresh_tokens"
ADD COLUMN IF NOT EXISTS "family_id" uuid DEFAULT uuidv7() NOT NULL;

ALTER TABLE "refresh_tokens"
ADD COLUMN IF NOT EXISTS "rotation_request_id" uuid;

ALTER TABLE "refresh_tokens"
ADD COLUMN IF NOT EXISTS "replacement_jti" varchar(64);

ALTER TABLE "refresh_tokens"
ADD COLUMN IF NOT EXISTS "rotated_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "refresh_tokens_family_idx"
ON "refresh_tokens" USING btree ("family_id");
