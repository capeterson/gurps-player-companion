CREATE TABLE IF NOT EXISTS "oauth_clients" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "client_id" varchar(200) NOT NULL,
  "name" varchar(120) NOT NULL,
  "redirect_uris" text[] NOT NULL,
  "allowed_scopes" text[] NOT NULL,
  "disabled_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_clients_client_id_key" UNIQUE("client_id")
);

CREATE TABLE IF NOT EXISTS "oauth_grants" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "client_id" uuid NOT NULL REFERENCES "oauth_clients"("id") ON DELETE CASCADE,
  "scopes" text[] NOT NULL,
  "resource" text NOT NULL,
  "auth_version" integer NOT NULL,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "oauth_grants_user_idx" ON "oauth_grants"("user_id");
CREATE INDEX IF NOT EXISTS "oauth_grants_client_idx" ON "oauth_grants"("client_id");

CREATE TABLE IF NOT EXISTS "oauth_authorization_requests" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "client_id" uuid NOT NULL REFERENCES "oauth_clients"("id") ON DELETE CASCADE,
  "csrf_hash" varchar(64) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_authorization_requests_csrf_key" UNIQUE("csrf_hash")
);

CREATE TABLE IF NOT EXISTS "oauth_authorization_codes" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "grant_id" uuid NOT NULL REFERENCES "oauth_grants"("id") ON DELETE CASCADE,
  "code_hash" varchar(64) NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" varchar(128) NOT NULL,
  "scopes" text[] NOT NULL,
  "resource" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_authorization_codes_code_key" UNIQUE("code_hash")
);

CREATE TABLE IF NOT EXISTS "oauth_access_tokens" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "grant_id" uuid NOT NULL REFERENCES "oauth_grants"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL,
  "scopes" text[] NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_access_tokens_token_key" UNIQUE("token_hash")
);

CREATE TABLE IF NOT EXISTS "oauth_refresh_tokens" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "grant_id" uuid NOT NULL REFERENCES "oauth_grants"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL,
  "family_id" uuid DEFAULT uuidv7() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "revoked_at" timestamptz,
  "rotation_request_id" varchar(200),
  "replacement_token_hash" varchar(64),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "oauth_refresh_tokens_token_key" UNIQUE("token_hash")
);
CREATE INDEX IF NOT EXISTS "oauth_refresh_tokens_family_idx" ON "oauth_refresh_tokens"("family_id");

CREATE TABLE IF NOT EXISTS "mutation_idempotency" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "client_key" varchar(200) NOT NULL,
  "operation_key" varchar(300) NOT NULL,
  "idempotency_key" varchar(200) NOT NULL,
  "input_hash" varchar(64) NOT NULL,
  "permission_hash" varchar(64) NOT NULL,
  "response_status" integer,
  "response_content_type" varchar(200),
  "response_body" text,
  "completed_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "mutation_idempotency_key" UNIQUE("actor_user_id", "client_key", "operation_key", "idempotency_key")
);
CREATE INDEX IF NOT EXISTS "mutation_idempotency_expiry_idx" ON "mutation_idempotency"("expires_at");

ALTER TABLE "entity_history" ADD COLUMN IF NOT EXISTS "agent_client_id" uuid
  REFERENCES "oauth_clients"("id") ON DELETE SET NULL;
ALTER TABLE "entity_history" ADD COLUMN IF NOT EXISTS "agent_grant_id" uuid
  REFERENCES "oauth_grants"("id") ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION set_history_agent_client() RETURNS trigger AS $$
BEGIN
  NEW.agent_client_id := nullif(current_setting('app.oauth_client_id', true), '')::uuid;
  NEW.agent_grant_id := nullif(current_setting('app.oauth_grant_id', true), '')::uuid;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_history_agent_client_trg ON "entity_history";
CREATE TRIGGER set_history_agent_client_trg
  BEFORE INSERT ON "entity_history"
  FOR EACH ROW EXECUTE FUNCTION set_history_agent_client();
