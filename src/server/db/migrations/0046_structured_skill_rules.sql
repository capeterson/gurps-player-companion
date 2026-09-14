-- GPC-64/GPC-66/GPC-67: portable structured skill rules. Existing concrete
-- TL and prose prerequisites remain intact and backward compatible.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS skill_prerequisite_policy varchar(8) NOT NULL DEFAULT 'block';

DO $$ BEGIN
  ALTER TABLE campaigns ADD CONSTRAINT campaigns_skill_prerequisite_policy_check
    CHECK (skill_prerequisite_policy IN ('block', 'warn'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE campaign_library_skills
  ADD COLUMN IF NOT EXISTS tech_level_policy jsonb NOT NULL DEFAULT '{"kind":"not_applicable"}'::jsonb,
  ADD COLUMN IF NOT EXISTS prerequisite_rules jsonb,
  ADD COLUMN IF NOT EXISTS groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Preserve the semantics of pre-policy rows that already carried a concrete TL.
UPDATE campaign_library_skills
SET tech_level_policy = jsonb_build_object('kind', 'fixed', 'techLevel', tech_level)
WHERE tech_level IS NOT NULL
  AND tech_level_policy = '{"kind":"not_applicable"}'::jsonb;
