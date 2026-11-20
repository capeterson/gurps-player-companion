ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_dark_theme_check,
  DROP CONSTRAINT IF EXISTS users_light_theme_check;
--> statement-breakpoint
-- Only retired palettes need resetting. Replaying this migration after someone
-- has chosen Daybreak Lens must not undo their choice.
UPDATE users SET dark_theme = 'corona-obsidian', light_theme = 'heliolance'
WHERE dark_theme <> 'corona-obsidian' OR light_theme NOT IN ('heliolance', 'daybreak-lens');
--> statement-breakpoint
ALTER TABLE users
  ALTER COLUMN dark_theme SET DEFAULT 'corona-obsidian',
  ALTER COLUMN light_theme SET DEFAULT 'heliolance',
  ADD CONSTRAINT users_dark_theme_check CHECK (dark_theme = 'corona-obsidian'),
  ADD CONSTRAINT users_light_theme_check CHECK (light_theme IN ('heliolance', 'daybreak-lens'));
