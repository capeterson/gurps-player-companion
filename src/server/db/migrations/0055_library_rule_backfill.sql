-- Lossless compatibility normalization. Character paid values remain unchanged.
CREATE OR REPLACE FUNCTION pg_temp.fixed_library_calculation(output_key text, amount numeric, output_unit text, lower_bound numeric, upper_bound numeric, step numeric)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('version', 1, 'inputs', '[]'::jsonb, 'tables', '[]'::jsonb,
 'nodes', jsonb_build_array(jsonb_build_object('id', output_key, 'op', 'constant', 'value', amount)),
 'outputs', jsonb_build_array(jsonb_build_object('key', output_key, 'unit', output_unit, 'node', output_key, 'rounding', 'exact', 'increment', step, 'min', lower_bound, 'max', upper_bound)));
$$;
--> statement-breakpoint
UPDATE campaign_library_traits SET calculation = pg_temp.fixed_library_calculation('points', base_points, 'points', -1000, 1000, 1)
WHERE calculation IS NULL AND status = 'complete';
UPDATE campaign_library_traits SET calculation = calculation ||
 jsonb_build_object(
 'inputs', jsonb_build_array(jsonb_build_object('key','level','label','Level','kind','number','unit','level','min',0,'max',coalesce(max_level,99),'step',1,'default',1)),
 'nodes', calculation->'nodes' || jsonb_build_array(
 jsonb_build_object('id','level','op','input','key','level'),
 jsonb_build_object('id','perLevel','op','constant','value',points_per_level),
 jsonb_build_object('id','leveled','op','multiply','args',jsonb_build_array('level','perLevel')),
 jsonb_build_object('id','total','op','add','args',jsonb_build_array('points','leveled'))),
 'outputs', jsonb_set(calculation->'outputs', '{0,node}', '"total"'))
WHERE points_per_level IS NOT NULL AND calculation->'inputs' = '[]'::jsonb AND status = 'complete';
--> statement-breakpoint
UPDATE campaign_library_items SET calculation =
 pg_temp.fixed_library_calculation('cost', cost, 'currency', 0, 100000000000, 0.01) ||
 jsonb_build_object(
 'nodes', jsonb_build_array(jsonb_build_object('id','cost','op','constant','value',cost), jsonb_build_object('id','weightLbs','op','constant','value',weight_lbs)),
 'outputs', (pg_temp.fixed_library_calculation('cost',cost,'currency',0,100000000000,0.01)->'outputs') ||
 (pg_temp.fixed_library_calculation('weightLbs',weight_lbs,'pounds',0,1000000,0.01)->'outputs'))
WHERE calculation IS NULL AND status = 'complete';
--> statement-breakpoint
UPDATE campaign_library_traits SET available_modifiers = (
 SELECT coalesce(jsonb_agg(CASE WHEN m ? 'calculation' THEN m ELSE m || jsonb_build_object('calculation',
 pg_temp.fixed_library_calculation('modifier', (m->>'costValue')::numeric, CASE WHEN m->>'costType'='flat' THEN 'points' ELSE 'percentage' END,-200,100000,
 greatest(5e-324::numeric, least(0.01::numeric, ('1e-' || scale((m->>'costValue')::numeric))::numeric)))) END ORDER BY ordinal), '[]')
 FROM jsonb_array_elements(available_modifiers) WITH ORDINALITY AS entries(m,ordinal)
) WHERE jsonb_array_length(available_modifiers) > 0;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.normalize_weapon_modes(data jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN data IS NULL OR data ? 'modes' THEN data ELSE data || jsonb_build_object('modes',
 jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
 'key','primary','name','Primary','damage',data->'damage','reach',data->'reach','parry',data->'parry',
 'skill',data->'skill','stRequired',data->'stRequired','ranged',data->'ranged','notes',data->'notes'))) ||
 (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
 'key', 'alternate-' || ordinal, 'name', m->'name','damage',m->'damage','reach',coalesce(nullif(m->'reach','null'::jsonb),data->'reach'),
 'parry',coalesce(nullif(m->'parry','null'::jsonb),data->'parry'),'skill',coalesce(nullif(m->'skill','null'::jsonb),data->'skill'),
 'stRequired',coalesce(nullif(m->'stRequired','null'::jsonb),data->'stRequired'),'ranged',coalesce(m->'ranged',data->'ranged'),'notes',m->'notes')) ORDER BY ordinal), '[]'::jsonb)
 FROM jsonb_array_elements(coalesce(data->'alternateModes','[]')) WITH ORDINALITY AS entries(m,ordinal))) END;
$$;
UPDATE campaign_library_items SET weapon_data = pg_temp.normalize_weapon_modes(weapon_data) WHERE weapon_data IS NOT NULL AND NOT weapon_data ? 'modes';
UPDATE inventory_items SET weapon_data = pg_temp.normalize_weapon_modes(weapon_data) WHERE weapon_data IS NOT NULL AND NOT weapon_data ? 'modes';
