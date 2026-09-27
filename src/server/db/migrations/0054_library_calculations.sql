ALTER TABLE campaign_library_traits ADD COLUMN IF NOT EXISTS key varchar(160) NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS source_key varchar(160),
ADD COLUMN IF NOT EXISTS source_locator varchar(240),
ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'complete',
ADD COLUMN IF NOT EXISTS role varchar(24) NOT NULL DEFAULT 'definition',
ADD COLUMN IF NOT EXISTS preferred_edition boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS extraction jsonb;
UPDATE campaign_library_traits SET key = lower(name) WHERE key = '';
DROP INDEX IF EXISTS campaign_library_traits_key;
CREATE UNIQUE INDEX campaign_library_traits_key ON campaign_library_traits (campaign_id, kind, lower(coalesce(nullif(key, ''), name)), coalesce(lower(source_key), ''));
--> statement-breakpoint
ALTER TABLE campaign_library_skills ADD COLUMN IF NOT EXISTS key varchar(160) NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS source_key varchar(160),
ADD COLUMN IF NOT EXISTS source_locator varchar(240),
ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'complete',
ADD COLUMN IF NOT EXISTS role varchar(24) NOT NULL DEFAULT 'definition',
ADD COLUMN IF NOT EXISTS preferred_edition boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS extraction jsonb;
UPDATE campaign_library_skills SET key = lower(name) WHERE key = '';
DROP INDEX IF EXISTS campaign_library_skills_key;
CREATE UNIQUE INDEX campaign_library_skills_key ON campaign_library_skills (campaign_id, lower(coalesce(nullif(key, ''), name)), coalesce(lower(source_key), ''));
--> statement-breakpoint
ALTER TABLE campaign_library_spells ADD COLUMN IF NOT EXISTS key varchar(160) NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS source_key varchar(160),
ADD COLUMN IF NOT EXISTS source_locator varchar(240),
ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'complete',
ADD COLUMN IF NOT EXISTS role varchar(24) NOT NULL DEFAULT 'definition',
ADD COLUMN IF NOT EXISTS preferred_edition boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS extraction jsonb;
UPDATE campaign_library_spells SET key = lower(name) WHERE key = '';
DROP INDEX IF EXISTS campaign_library_spells_key;
CREATE UNIQUE INDEX campaign_library_spells_key ON campaign_library_spells (campaign_id, lower(coalesce(nullif(key, ''), name)), coalesce(lower(source_key), ''));
--> statement-breakpoint
ALTER TABLE campaign_library_items ADD COLUMN IF NOT EXISTS key varchar(160) NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS source_key varchar(160),
ADD COLUMN IF NOT EXISTS source_locator varchar(240),
ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'complete',
ADD COLUMN IF NOT EXISTS role varchar(24) NOT NULL DEFAULT 'definition',
ADD COLUMN IF NOT EXISTS preferred_edition boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS extraction jsonb;
UPDATE campaign_library_items SET key = lower(name) WHERE key = '';
DROP INDEX IF EXISTS campaign_library_items_key;
CREATE UNIQUE INDEX campaign_library_items_key ON campaign_library_items (campaign_id, lower(coalesce(nullif(key, ''), name)), coalesce(lower(source_key), ''));
--> statement-breakpoint
ALTER TABLE campaign_library_languages ADD COLUMN IF NOT EXISTS key varchar(160) NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS source_key varchar(160),
ADD COLUMN IF NOT EXISTS source_locator varchar(240),
ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'complete',
ADD COLUMN IF NOT EXISTS role varchar(24) NOT NULL DEFAULT 'definition',
ADD COLUMN IF NOT EXISTS preferred_edition boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS extraction jsonb;
UPDATE campaign_library_languages SET key = lower(name) WHERE key = '';
DROP INDEX IF EXISTS campaign_library_languages_key;
CREATE UNIQUE INDEX campaign_library_languages_key ON campaign_library_languages (campaign_id, lower(coalesce(nullif(key, ''), name)), coalesce(lower(source_key), ''));
--> statement-breakpoint
ALTER TABLE campaign_library_techniques ADD COLUMN IF NOT EXISTS key varchar(160) NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS source_key varchar(160),
ADD COLUMN IF NOT EXISTS source_locator varchar(240),
ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'complete',
ADD COLUMN IF NOT EXISTS role varchar(24) NOT NULL DEFAULT 'definition',
ADD COLUMN IF NOT EXISTS preferred_edition boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS extraction jsonb;
UPDATE campaign_library_techniques SET key = lower(name) WHERE key = '';
DROP INDEX IF EXISTS campaign_library_techniques_key;
CREATE UNIQUE INDEX campaign_library_techniques_key ON campaign_library_techniques (campaign_id, lower(coalesce(nullif(key, ''), name)), coalesce(lower(source_key), ''));
--> statement-breakpoint
ALTER TABLE campaign_library_styles ADD COLUMN IF NOT EXISTS key varchar(160) NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS source_key varchar(160),
ADD COLUMN IF NOT EXISTS source_locator varchar(240),
ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'complete',
ADD COLUMN IF NOT EXISTS role varchar(24) NOT NULL DEFAULT 'definition',
ADD COLUMN IF NOT EXISTS preferred_edition boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS extraction jsonb;
UPDATE campaign_library_styles SET key = lower(name) WHERE key = '';
DROP INDEX IF EXISTS campaign_library_styles_key;
CREATE UNIQUE INDEX campaign_library_styles_key ON campaign_library_styles (campaign_id, lower(coalesce(nullif(key, ''), name)), coalesce(lower(source_key), ''));
--> statement-breakpoint
ALTER TABLE campaign_library_enchantments ADD COLUMN IF NOT EXISTS key varchar(160) NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS source_key varchar(160),
ADD COLUMN IF NOT EXISTS source_locator varchar(240),
ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'complete',
ADD COLUMN IF NOT EXISTS role varchar(24) NOT NULL DEFAULT 'definition',
ADD COLUMN IF NOT EXISTS preferred_edition boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS extraction jsonb;
UPDATE campaign_library_enchantments SET key = lower(name) WHERE key = '';
DROP INDEX IF EXISTS campaign_library_enchantments_key;
CREATE UNIQUE INDEX campaign_library_enchantments_key ON campaign_library_enchantments (campaign_id, lower(coalesce(nullif(key, ''), name)), coalesce(lower(source_key), ''));
--> statement-breakpoint
ALTER TABLE campaign_library_active_effects ADD COLUMN IF NOT EXISTS key varchar(160) NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS source_key varchar(160),
ADD COLUMN IF NOT EXISTS source_locator varchar(240),
ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'complete',
ADD COLUMN IF NOT EXISTS role varchar(24) NOT NULL DEFAULT 'definition',
ADD COLUMN IF NOT EXISTS preferred_edition boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS extraction jsonb;
UPDATE campaign_library_active_effects SET key = lower(name) WHERE key = '';
DROP INDEX IF EXISTS campaign_library_active_effects_key;
CREATE UNIQUE INDEX campaign_library_active_effects_key ON campaign_library_active_effects (campaign_id, lower(coalesce(nullif(key, ''), name)), coalesce(lower(source_key), ''));
--> statement-breakpoint
ALTER TABLE campaign_library_traits ADD COLUMN IF NOT EXISTS calculation jsonb;
ALTER TABLE campaign_library_items ADD COLUMN IF NOT EXISTS calculation jsonb;
ALTER TABLE character_traits ADD COLUMN IF NOT EXISTS pricing_resolution jsonb;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS pricing_resolution jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS campaign_library_sources (
 id uuid PRIMARY KEY DEFAULT uuidv7(), campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 name varchar(160) NOT NULL, key varchar(160) NOT NULL, abbreviation varchar(40) NOT NULL,
 edition varchar(160), priority integer NOT NULL DEFAULT 100, notes text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT next_sync_revision()
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_library_sources_key ON campaign_library_sources(campaign_id, lower(key));
CREATE INDEX IF NOT EXISTS campaign_library_sources_campaign_revision_idx ON campaign_library_sources(campaign_id, revision);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS campaign_library_modifiers (
 id uuid PRIMARY KEY DEFAULT uuidv7(), campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 name varchar(160) NOT NULL, key varchar(160) NOT NULL DEFAULT '', source_key varchar(160), source_locator varchar(240),
 status varchar(24) NOT NULL DEFAULT 'complete', role varchar(24) NOT NULL DEFAULT 'definition',
 preferred_edition boolean NOT NULL DEFAULT false, extraction jsonb,
 category varchar(20) NOT NULL, description text, source varchar(40), tags jsonb NOT NULL DEFAULT '[]',
 "group" varchar(80), cost_type varchar(16) NOT NULL DEFAULT 'percent', calculation jsonb, applicability jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT next_sync_revision()
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_library_modifiers_key ON campaign_library_modifiers(campaign_id, lower(coalesce(nullif(key, ''), name)), coalesce(lower(source_key), ''));
CREATE INDEX IF NOT EXISTS campaign_library_modifiers_campaign_revision_idx ON campaign_library_modifiers(campaign_id, revision);

--> statement-breakpoint
DROP TRIGGER IF EXISTS bump_revision_trg ON campaign_library_sources;
CREATE TRIGGER bump_revision_trg BEFORE INSERT OR UPDATE ON campaign_library_sources FOR EACH ROW EXECUTE FUNCTION bump_revision();
DROP TRIGGER IF EXISTS record_history_trg ON campaign_library_sources;
CREATE TRIGGER record_history_trg AFTER INSERT OR UPDATE OR DELETE ON campaign_library_sources FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_library_source');
DROP TRIGGER IF EXISTS record_tombstone_trg ON campaign_library_sources;
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON campaign_library_sources FOR EACH ROW EXECUTE FUNCTION record_campaign_library_tombstone('campaign_library_source');

--> statement-breakpoint
DROP TRIGGER IF EXISTS bump_revision_trg ON campaign_library_modifiers;
CREATE TRIGGER bump_revision_trg BEFORE INSERT OR UPDATE ON campaign_library_modifiers FOR EACH ROW EXECUTE FUNCTION bump_revision();
DROP TRIGGER IF EXISTS record_history_trg ON campaign_library_modifiers;
CREATE TRIGGER record_history_trg AFTER INSERT OR UPDATE OR DELETE ON campaign_library_modifiers FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_library_modifier');
DROP TRIGGER IF EXISTS record_tombstone_trg ON campaign_library_modifiers;
CREATE TRIGGER record_tombstone_trg AFTER DELETE ON campaign_library_modifiers FOR EACH ROW EXECUTE FUNCTION record_campaign_library_tombstone('campaign_library_modifier');
