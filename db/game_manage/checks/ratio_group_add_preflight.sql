-- 只读预检；结果用于后续单独核对目标与授权，不执行迁移。
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database() AS database_name,current_setting('server_version_num') AS server_version_number;
SELECT column_name,data_type,character_maximum_length,is_nullable,column_default
  FROM information_schema.columns WHERE table_schema='public' AND table_name='modifier_zones' ORDER BY ordinal_position;
SELECT conname,contype::text AS constraint_type,convalidated,pg_get_constraintdef(oid) AS definition
  FROM pg_catalog.pg_constraint WHERE conrelid='public.modifier_zones'::regclass ORDER BY conname;
SELECT 'modifier_zones' AS table_name,count(*) AS row_count,encode(sha256(convert_to(
    COALESCE(string_agg(to_jsonb(t)::text || chr(10),'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS full_row_sorted_sha256 FROM public.modifier_zones t
UNION ALL
SELECT 'skill_effects',count(*),encode(sha256(convert_to(
    COALESCE(string_agg(to_jsonb(t)::text || chr(10),'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') FROM public.skill_effects t
UNION ALL
SELECT 'skill_object_references',count(*),encode(sha256(convert_to(
    COALESCE(string_agg(to_jsonb(t)::text || chr(10),'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') FROM public.skill_object_references t;
SELECT count(*) AS existing_grouped_amplification_zones FROM public.modifier_zones WHERE calculation_mode='RATIO_GROUP_ADD';
COMMIT;
