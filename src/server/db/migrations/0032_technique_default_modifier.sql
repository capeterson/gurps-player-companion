-- The technique's default line: how far below its governing skill it
-- starts (GURPS Martial Arts p. 87). Previously the model assumed every
-- technique defaults at full skill (defaultModifier = 0), which inflated
-- roll targets for techniques with a written penalty (e.g. Combat Riding
-- defaulting at Riding-6+). Existing rows get the old behavior.
-- Idempotent via IF NOT EXISTS.

ALTER TABLE character_techniques
  ADD COLUMN IF NOT EXISTS default_modifier SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE campaign_library_techniques
  ADD COLUMN IF NOT EXISTS default_modifier SMALLINT NOT NULL DEFAULT 0;