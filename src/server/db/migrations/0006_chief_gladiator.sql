-- Add a per-campaign toggle for sharing character sheets with non-owner
-- members. When false, non-owner members fetching a character get a
-- minimal "readily apparent" view (race / height / weight / age /
-- appearance / TL) instead of the full sheet. Defaults to true so
-- existing campaigns keep their previous behaviour. The owner and the
-- character's author always see the full sheet.
ALTER TABLE "campaigns" ADD COLUMN "share_character_sheets" boolean DEFAULT true NOT NULL;
