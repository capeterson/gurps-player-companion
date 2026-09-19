ALTER TABLE campaign_library_skills ADD COLUMN IF NOT EXISTS procedures jsonb NOT NULL DEFAULT '{"modifiers":[],"actions":[],"benefits":[]}'::jsonb;
-- Flat modifiers retain their opt-in task-roll meaning. Stable IDs are per definition.
UPDATE campaign_library_skills SET procedures = jsonb_set(procedures, '{modifiers}', (
 SELECT coalesce(jsonb_agg(jsonb_build_object('id', 'legacy-' || ord, 'label', entry->>'name',
 'when', jsonb_build_array(jsonb_build_object('input', jsonb_build_object('domain','task','key','legacy-' || ord,'label',entry->>'name'), 'operator','equals','value',true)),
 'value',jsonb_build_object('kind','fixed','value',entry->'modifier'), 'appliesTo','task_roll','stacking','stack','sourceText',coalesce(entry->>'description',''))), '[]'::jsonb)
 FROM jsonb_array_elements(situational_modifiers) WITH ORDINALITY AS e(entry,ord)
)) WHERE procedures->'modifiers' = '[]'::jsonb AND jsonb_array_length(situational_modifiers) > 0;
UPDATE character_skills AS c SET library_mechanics = jsonb_set(c.library_mechanics, '{skillRules,procedures}', l.procedures)
FROM campaign_library_skills AS l WHERE c.library_skill_id=l.id AND c.library_mechanics->'skillRules' IS NOT NULL;
