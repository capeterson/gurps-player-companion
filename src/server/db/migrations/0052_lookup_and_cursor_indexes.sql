-- Lookup and cursor-paging indexes.
--
-- campaign_memberships(user_id) / campaigns(owner_id): every cursor pull,
-- GET /characters, GET /campaigns and idempotent mutation resolves the
-- caller's campaigns by user; the only membership index led with
-- campaign_id and campaigns.owner_id had none.
--
-- (character_id, revision) / (campaign_id, revision): /sync/cursor pages
-- each class with `WHERE <scope> IN (...) AND revision > $since ORDER BY
-- revision LIMIT n`. Without a revision-ordered index every page re-sorted
-- all of the scope's rows.
CREATE INDEX IF NOT EXISTS "campaign_memberships_user_campaign_idx"
  ON "campaign_memberships" USING btree ("user_id", "campaign_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_owner_idx" ON "campaigns" USING btree ("owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_owner_revision_idx"
  ON "characters" USING btree ("owner_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_traits_character_revision_idx"
  ON "character_traits" USING btree ("character_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_skills_character_revision_idx"
  ON "character_skills" USING btree ("character_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_spells_character_revision_idx"
  ON "character_spells" USING btree ("character_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_languages_character_revision_idx"
  ON "character_languages" USING btree ("character_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_techniques_character_revision_idx"
  ON "character_techniques" USING btree ("character_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_items_character_revision_idx"
  ON "inventory_items" USING btree ("character_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_library_traits_campaign_revision_idx"
  ON "campaign_library_traits" USING btree ("campaign_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_library_skills_campaign_revision_idx"
  ON "campaign_library_skills" USING btree ("campaign_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_library_spells_campaign_revision_idx"
  ON "campaign_library_spells" USING btree ("campaign_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_library_languages_campaign_revision_idx"
  ON "campaign_library_languages" USING btree ("campaign_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_library_techniques_campaign_revision_idx"
  ON "campaign_library_techniques" USING btree ("campaign_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_library_styles_campaign_revision_idx"
  ON "campaign_library_styles" USING btree ("campaign_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_library_enchantments_campaign_revision_idx"
  ON "campaign_library_enchantments" USING btree ("campaign_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_library_items_campaign_revision_idx"
  ON "campaign_library_items" USING btree ("campaign_id", "revision");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_library_active_effects_campaign_revision_idx"
  ON "campaign_library_active_effects" USING btree ("campaign_id", "revision");
