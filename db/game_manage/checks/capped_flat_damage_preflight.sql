-- 只读预检：不创建临时表、不改约束和业务。保存结果供独立复核；迁移另有一次性漂移守卫。
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database() AS database_name, current_setting('server_version_num') AS server_version_number;
SELECT conname,contype::text AS constraint_type,convalidated,pg_get_constraintdef(oid) AS definition
  FROM pg_catalog.pg_constraint WHERE conrelid='public.modifier_zones'::regclass ORDER BY conname;
SELECT 'modifier_zones' AS table_name, count(*) AS row_count, encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text || chr(10), '' ORDER BY to_jsonb(t)::text), ''), 'UTF8')), 'hex') AS full_row_sorted_sha256 FROM public.modifier_zones t
UNION ALL
SELECT 'skill_effects' AS table_name, count(*) AS row_count, encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text || chr(10), '' ORDER BY to_jsonb(t)::text), ''), 'UTF8')), 'hex') AS full_row_sorted_sha256 FROM public.skill_effects t
UNION ALL
SELECT 'skill_object_references' AS table_name, count(*) AS row_count, encode(sha256(convert_to(COALESCE(string_agg(to_jsonb(t)::text || chr(10), '' ORDER BY to_jsonb(t)::text), ''), 'UTF8')), 'hex') AS full_row_sorted_sha256 FROM public.skill_object_references t;
SELECT count(*) AS existing_flat_pre_zones FROM public.modifier_zones
 WHERE domain='DAMAGE' AND calculation_mode='FLAT_ADD' AND application_stage='DAMAGE_PRE_DEFENSE';
COMMIT;
