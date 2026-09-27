-- Per-user colour theme choices (dark-mode and light-mode palettes). Stored on
-- the user row so every device a player signs in on shows the same palettes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS dark_theme varchar(32) NOT NULL DEFAULT 'gilded-tome';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS light_theme varchar(32) NOT NULL DEFAULT 'illuminated-manuscript';
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_dark_theme_check
    CHECK (dark_theme IN ('gilded-tome', 'midnight-gilt', 'verdigris-brass'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_light_theme_check
    CHECK (light_theme IN ('illuminated-manuscript', 'heraldic-vellum'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
