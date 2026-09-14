-- GPC-57: reusable campaign enchantment definitions. Existing item
-- enchantments remain untouched; entries without mechanics stay metadata-only.
CREATE TABLE IF NOT EXISTS campaign_library_enchantments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  description text,
  source varchar(40),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  applicability varchar(16) NOT NULL DEFAULT 'any',
  effects jsonb NOT NULL DEFAULT '[]'::jsonb,
  levels jsonb NOT NULL DEFAULT '[]'::jsonb,
  stacking_policy jsonb NOT NULL DEFAULT '{"kind":"stack"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT nextval('revisions_seq'),
  CONSTRAINT campaign_library_enchantments_applicability_check
    CHECK (applicability IN ('weapon', 'armor', 'shield', 'any'))
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_library_enchantments_key
  ON campaign_library_enchantments (campaign_id, lower(name));

DROP TRIGGER IF EXISTS bump_revision_trg ON campaign_library_enchantments;
CREATE TRIGGER bump_revision_trg BEFORE UPDATE ON campaign_library_enchantments
  FOR EACH ROW EXECUTE FUNCTION bump_revision();

DROP TRIGGER IF EXISTS record_history_trg ON campaign_library_enchantments;
CREATE TRIGGER record_history_trg
  AFTER INSERT OR UPDATE OR DELETE ON campaign_library_enchantments
  FOR EACH ROW EXECUTE FUNCTION record_campaign_history('campaign_library_enchantment');
