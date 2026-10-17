-- 纯只读：与已冻结的当前库及本次迁移摘要一起审查；不得据此自动执行迁移。
SELECT current_database() AS database_name, current_schema() AS schema_name;
SELECT table_name, column_name, data_type, character_maximum_length, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND ((table_name = 'modifier_zones' AND column_name = 'calculation_mode')
    OR (table_name = 'skill_trigger_rules' AND column_name = 'event_type'))
ORDER BY table_name, column_name;
SELECT conrelid::regclass AS table_name, conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE (conrelid = 'public.modifier_zones'::regclass
    AND conname IN ('ck_modifier_zones_calculation_mode', 'ck_modifier_zones_combination', 'pk_modifier_zones', 'fk_modifier_zones_game'))
    OR (conrelid = 'public.skill_trigger_rules'::regclass AND conname = 'ck_skill_trigger_rules_event_type')
ORDER BY conrelid::regclass::text, conname;
SELECT 'modifier_zones' AS table_name, count(*) AS row_count FROM public.modifier_zones
UNION ALL SELECT 'skill_effects', count(*) FROM public.skill_effects
UNION ALL SELECT 'skill_object_references', count(*) FROM public.skill_object_references
UNION ALL SELECT 'skill_trigger_rules', count(*) FROM public.skill_trigger_rules;
