-- Source changes must participate in the character cursor even without WS.
-- Existing revision/history triggers run in the library writer's audited transaction.
CREATE INDEX IF NOT EXISTS character_traits_library_idx ON character_traits (library_trait_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS character_skills_library_idx ON character_skills (library_skill_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION invalidate_owned_library_mechanics() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'campaign_library_traits' THEN
    UPDATE character_traits AS child SET updated_at = clock_timestamp()
    FROM characters AS parent
    WHERE child.character_id = parent.id AND parent.campaign_id = OLD.campaign_id
      AND child.library_trait_id = OLD.id;
  ELSE
    UPDATE character_skills AS child SET updated_at = clock_timestamp()
    FROM characters AS parent
    WHERE child.character_id = parent.id AND parent.campaign_id = OLD.campaign_id
      AND child.library_skill_id = OLD.id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS invalidate_owned_mechanics_trg ON campaign_library_traits;
--> statement-breakpoint
CREATE TRIGGER invalidate_owned_mechanics_trg AFTER UPDATE OR DELETE ON campaign_library_traits
FOR EACH ROW EXECUTE FUNCTION invalidate_owned_library_mechanics();
--> statement-breakpoint
DROP TRIGGER IF EXISTS invalidate_owned_mechanics_trg ON campaign_library_skills;
--> statement-breakpoint
CREATE TRIGGER invalidate_owned_mechanics_trg AFTER UPDATE OR DELETE ON campaign_library_skills
FOR EACH ROW EXECUTE FUNCTION invalidate_owned_library_mechanics();
--> statement-breakpoint
-- A function comment is the durable marker for this one-time data repair.
-- CREATE OR REPLACE above preserves the comment when the SQL is reapplied.
DO $repair$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('gpc-30-linked-cursor-repair', 0));
  IF obj_description('invalidate_owned_library_mechanics()'::regprocedure, 'pg_proc')
      IS DISTINCT FROM 'GPC-30 linked cursor repair applied' THEN
    UPDATE character_traits SET updated_at = clock_timestamp() WHERE library_trait_id IS NOT NULL;
    UPDATE character_skills SET updated_at = clock_timestamp() WHERE library_skill_id IS NOT NULL;
    COMMENT ON FUNCTION invalidate_owned_library_mechanics() IS 'GPC-30 linked cursor repair applied';
  END IF;
END;
$repair$;
