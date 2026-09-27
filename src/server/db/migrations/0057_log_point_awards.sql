ALTER TABLE users DROP CONSTRAINT users_dark_theme_check;
ALTER TABLE users ADD CONSTRAINT users_dark_theme_check CHECK (dark_theme IN ('gilded-tome', 'midnight-gilt', 'verdigris-brass', 'arcane-dark'));
ALTER TABLE users DROP CONSTRAINT users_light_theme_check;
ALTER TABLE users ADD CONSTRAINT users_light_theme_check CHECK (light_theme IN ('illuminated-manuscript', 'heraldic-vellum', 'arcane-light'));
--> statement-breakpoint
ALTER TABLE characters ADD COLUMN earned_points integer NOT NULL DEFAULT 0;
ALTER TABLE adventure_log_entries ADD COLUMN points_gained integer CHECK (points_gained BETWEEN 0 AND 1000);
--> statement-breakpoint
-- Existing award lists become credited once. Scan the log once; rows without awards
-- retain the column default and need no revision/history churn.
WITH totals AS (
  SELECT (award->>'characterId')::uuid AS character_id,
         sum((award->>'amount')::integer)::integer AS amount
  FROM adventure_log_entries e, jsonb_array_elements(e.xp_awards) award
  GROUP BY award->>'characterId'
)
UPDATE characters c SET earned_points = totals.amount
FROM totals WHERE c.id = totals.character_id;
