CREATE TYPE "public"."campaign_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."posture" AS ENUM('standing', 'prone', 'kneeling', 'crawling', 'sitting', 'crouching', 'lying');--> statement-breakpoint
CREATE TYPE "public"."skill_attribute" AS ENUM('ST', 'DX', 'IQ', 'HT', 'Will', 'Per', 'Other');--> statement-breakpoint
CREATE TYPE "public"."skill_difficulty" AS ENUM('E', 'A', 'H', 'VH');--> statement-breakpoint
CREATE TYPE "public"."trait_kind" AS ENUM('advantage', 'disadvantage', 'perk', 'quirk', 'language', 'cultural_familiarity');--> statement-breakpoint
CREATE TYPE "public"."log_visibility" AS ENUM('campaign', 'private');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "adventure_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"visibility" "log_visibility" DEFAULT 'campaign' NOT NULL,
	"xp_awards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean GENERATED ALWAYS AS ((revoked_at is null)) STORED
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_library_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"category" varchar(40) DEFAULT 'general' NOT NULL,
	"default_quantity" integer DEFAULT 1 NOT NULL,
	"weight_lbs" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"source" varchar(40),
	"is_armor" boolean DEFAULT false NOT NULL,
	"armor" jsonb,
	"weapon_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_library_skills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"attribute" "skill_attribute" NOT NULL,
	"difficulty" "skill_difficulty" NOT NULL,
	"tech_level" smallint,
	"description" text,
	"source" varchar(40),
	"default_specialization" varchar(160),
	"prerequisites" text,
	"situational_modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_library_traits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"kind" "trait_kind" NOT NULL,
	"base_points" integer DEFAULT 0 NOT NULL,
	"description" text,
	"source" varchar(40),
	"available_modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "campaign_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"point_target" integer,
	"disadvantage_cap" integer,
	"quirk_cap" integer DEFAULT 5,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_skills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"character_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"attribute" "skill_attribute" NOT NULL,
	"difficulty" "skill_difficulty" NOT NULL,
	"points" integer DEFAULT 1 NOT NULL,
	"tech_level" smallint,
	"specialization" varchar(160),
	"notes" text,
	"library_skill_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_traits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"character_id" uuid NOT NULL,
	"kind" "trait_kind" NOT NULL,
	"name" varchar(160) NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"level" smallint,
	"notes" text,
	"modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"library_trait_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "characters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"campaign_id" uuid,
	"name" varchar(120) NOT NULL,
	"player_name" varchar(120),
	"height" varchar(40),
	"weight" varchar(40),
	"age" integer,
	"appearance" text,
	"tech_level" smallint,
	"st" smallint DEFAULT 10 NOT NULL,
	"dx" smallint DEFAULT 10 NOT NULL,
	"iq" smallint DEFAULT 10 NOT NULL,
	"ht" smallint DEFAULT 10 NOT NULL,
	"hp_mod" smallint DEFAULT 0 NOT NULL,
	"will_mod" smallint DEFAULT 0 NOT NULL,
	"per_mod" smallint DEFAULT 0 NOT NULL,
	"fp_mod" smallint DEFAULT 0 NOT NULL,
	"speed_quarter_mod" smallint DEFAULT 0 NOT NULL,
	"move_mod" smallint DEFAULT 0 NOT NULL,
	"temp_st" smallint DEFAULT 0 NOT NULL,
	"temp_dx" smallint DEFAULT 0 NOT NULL,
	"temp_iq" smallint DEFAULT 0 NOT NULL,
	"temp_ht" smallint DEFAULT 0 NOT NULL,
	"temp_hp_mod" smallint DEFAULT 0 NOT NULL,
	"temp_will_mod" smallint DEFAULT 0 NOT NULL,
	"temp_per_mod" smallint DEFAULT 0 NOT NULL,
	"temp_fp_mod" smallint DEFAULT 0 NOT NULL,
	"temp_speed_quarter_mod" smallint DEFAULT 0 NOT NULL,
	"temp_move_mod" smallint DEFAULT 0 NOT NULL,
	"dismissed_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "combat_states" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"character_id" uuid NOT NULL,
	"current_hp" integer DEFAULT 10 NOT NULL,
	"current_fp" integer DEFAULT 10 NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"maneuver" varchar(80),
	"posture" "posture" DEFAULT 'standing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"character_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"weight_lbs" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"parent_id" uuid,
	"external_location" varchar(160),
	"worn" boolean DEFAULT false NOT NULL,
	"equipped" boolean DEFAULT false NOT NULL,
	"is_container" boolean DEFAULT false NOT NULL,
	"hideaway_capacity_lbs" numeric(10, 2) DEFAULT '0' NOT NULL,
	"weight_reduction_percent" smallint DEFAULT 0 NOT NULL,
	"is_armor" boolean DEFAULT false NOT NULL,
	"armor" jsonb,
	"weapon_data" jsonb,
	"library_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"jti" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean GENERATED ALWAYS AS ((revoked_at is null)) STORED
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adventure_log_entries" ADD CONSTRAINT "adventure_log_entries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adventure_log_entries" ADD CONSTRAINT "adventure_log_entries_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_library_items" ADD CONSTRAINT "campaign_library_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_library_skills" ADD CONSTRAINT "campaign_library_skills_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_library_traits" ADD CONSTRAINT "campaign_library_traits_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_memberships" ADD CONSTRAINT "campaign_memberships_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_memberships" ADD CONSTRAINT "campaign_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_skills" ADD CONSTRAINT "character_skills_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_traits" ADD CONSTRAINT "character_traits_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characters" ADD CONSTRAINT "characters_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characters" ADD CONSTRAINT "characters_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "combat_states" ADD CONSTRAINT "combat_states_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adventure_log_campaign_idx" ON "adventure_log_entries" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adventure_log_author_idx" ON "adventure_log_entries" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_key" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_library_items_key" ON "campaign_library_items" USING btree ("campaign_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_library_skills_key" ON "campaign_library_skills" USING btree ("campaign_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_library_traits_key" ON "campaign_library_traits" USING btree ("campaign_id","name","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_memberships_campaign_user_key" ON "campaign_memberships" USING btree ("campaign_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_skills_character_idx" ON "character_skills" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_traits_character_idx" ON "character_traits" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_owner_idx" ON "characters" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_campaign_idx" ON "characters" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "combat_states_character_key" ON "combat_states" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_character_idx" ON "inventory_items" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_parent_idx" ON "inventory_items" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_jti_key" ON "refresh_tokens" USING btree ("jti");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users" USING btree ("email");