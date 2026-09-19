ALTER TABLE "campaign_library_skills"
  ADD COLUMN IF NOT EXISTS "specialization_policy" jsonb NOT NULL
  DEFAULT '{"kind":"none"}'::jsonb;
--> statement-breakpoint

-- Preserve the meaning of the legacy default_specialization field: these
-- skills already allowed a specialty and pre-filled it when copied.
UPDATE "campaign_library_skills"
SET "specialization_policy" = '{"kind":"optional_freeform"}'::jsonb
WHERE "default_specialization" IS NOT NULL
  AND "specialization_policy" = '{"kind":"none"}'::jsonb;
