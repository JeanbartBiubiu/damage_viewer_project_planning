-- 剩余比例连乘：扩大现有列长度与两项 CHECK，不新增表、不修改业务行。
-- 原约束必须与当前已核定基线完全相同；错误、重放或中途失败均回滚。
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.games IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.modifier_zones IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.skill_effects, public.skill_object_references IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE complement_expected (
    domain varchar(16), calculation_mode varchar(32), application_stage varchar(32),
    CONSTRAINT old_mode CHECK (calculation_mode IN ('FLAT_ADD', 'RATIO_ADD', 'RATIO_MULTIPLY', 'RATIO_MAX')),
    CONSTRAINT new_mode CHECK (calculation_mode IN ('FLAT_ADD', 'RATIO_ADD', 'RATIO_MULTIPLY', 'RATIO_COMPLEMENT_MULTIPLY', 'RATIO_MAX')),
    CONSTRAINT old_combination CHECK (
        (domain = 'ATTRIBUTE' AND calculation_mode = 'FLAT_ADD' AND application_stage = 'ATTRIBUTE_FLAT')
        OR (domain = 'ATTRIBUTE' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MULTIPLY') AND application_stage = 'ATTRIBUTE_PERCENT')
        OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_ADD' AND application_stage IN ('DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'))
        OR (domain = 'HEALING' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MAX') AND application_stage = 'HEALING_RESULT')
        OR (domain = 'SHIELD' AND calculation_mode = 'RATIO_ADD' AND application_stage = 'SHIELD_RESULT')
    ),
    CONSTRAINT new_combination CHECK (
        (domain = 'ATTRIBUTE' AND calculation_mode = 'FLAT_ADD' AND application_stage = 'ATTRIBUTE_FLAT')
        OR (domain = 'ATTRIBUTE' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MULTIPLY', 'RATIO_COMPLEMENT_MULTIPLY') AND application_stage = 'ATTRIBUTE_PERCENT')
        OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_ADD' AND application_stage IN ('DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'))
        OR (domain = 'HEALING' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MAX') AND application_stage = 'HEALING_RESULT')
        OR (domain = 'SHIELD' AND calculation_mode = 'RATIO_ADD' AND application_stage = 'SHIELD_RESULT')
    )
) ON COMMIT DROP;
DO $preflight$
BEGIN
    IF current_database() <> 'test0221' THEN RAISE EXCEPTION '剩余比例连乘迁移目标库不符'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'modifier_zones'
          AND column_name = 'calculation_mode' AND data_type = 'character varying'
          AND character_maximum_length = 16 AND is_nullable = 'NO' AND column_default IS NULL
    ) THEN RAISE EXCEPTION '计算方式列漂移或已执行，禁止重放'; END IF;
    IF (SELECT count(*) FROM pg_constraint actual JOIN pg_constraint expected
          ON expected.conrelid = 'pg_temp.complement_expected'::regclass
          AND expected.conname = CASE actual.conname
              WHEN 'ck_modifier_zones_calculation_mode' THEN 'old_mode'
              WHEN 'ck_modifier_zones_combination' THEN 'old_combination' END
        WHERE actual.conrelid = 'public.modifier_zones'::regclass AND actual.contype = 'c' AND actual.convalidated
          AND pg_get_constraintdef(actual.oid) = pg_get_constraintdef(expected.oid)) <> 2
    THEN RAISE EXCEPTION '乘区检查约束漂移或已执行，禁止重放'; END IF;
END
$preflight$;
CREATE TEMP TABLE complement_zones_before ON COMMIT DROP AS SELECT to_jsonb(r) AS body FROM public.modifier_zones r;
CREATE TEMP TABLE complement_effects_before ON COMMIT DROP AS SELECT to_jsonb(r) AS body FROM public.skill_effects r;
CREATE TEMP TABLE complement_refs_before ON COMMIT DROP AS SELECT to_jsonb(r) AS body FROM public.skill_object_references r;
ALTER TABLE public.modifier_zones ALTER COLUMN calculation_mode TYPE varchar(32);
ALTER TABLE public.modifier_zones
    DROP CONSTRAINT ck_modifier_zones_calculation_mode,
    DROP CONSTRAINT ck_modifier_zones_combination,
    ADD CONSTRAINT ck_modifier_zones_calculation_mode
        CHECK (calculation_mode IN ('FLAT_ADD', 'RATIO_ADD', 'RATIO_MULTIPLY', 'RATIO_COMPLEMENT_MULTIPLY', 'RATIO_MAX')),
    ADD CONSTRAINT ck_modifier_zones_combination CHECK (
        (domain = 'ATTRIBUTE' AND calculation_mode = 'FLAT_ADD' AND application_stage = 'ATTRIBUTE_FLAT')
        OR (domain = 'ATTRIBUTE' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MULTIPLY', 'RATIO_COMPLEMENT_MULTIPLY') AND application_stage = 'ATTRIBUTE_PERCENT')
        OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_ADD' AND application_stage IN ('DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'))
        OR (domain = 'HEALING' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MAX') AND application_stage = 'HEALING_RESULT')
        OR (domain = 'SHIELD' AND calculation_mode = 'RATIO_ADD' AND application_stage = 'SHIELD_RESULT')
    );
DO $verify$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'modifier_zones'
          AND column_name = 'calculation_mode' AND data_type = 'character varying'
          AND character_maximum_length = 32 AND is_nullable = 'NO' AND column_default IS NULL
    ) THEN RAISE EXCEPTION '计算方式新列长度验证失败'; END IF;
    IF (SELECT count(*) FROM pg_constraint actual JOIN pg_constraint expected
          ON expected.conrelid = 'pg_temp.complement_expected'::regclass
          AND expected.conname = CASE actual.conname
              WHEN 'ck_modifier_zones_calculation_mode' THEN 'new_mode'
              WHEN 'ck_modifier_zones_combination' THEN 'new_combination' END
        WHERE actual.conrelid = 'public.modifier_zones'::regclass AND actual.contype = 'c' AND actual.convalidated
          AND pg_get_constraintdef(actual.oid) = pg_get_constraintdef(expected.oid)) <> 2
    THEN RAISE EXCEPTION '剩余比例连乘新约束验证失败'; END IF;
    IF EXISTS (
        (SELECT body FROM complement_zones_before EXCEPT ALL SELECT to_jsonb(r) FROM public.modifier_zones r)
        UNION ALL (SELECT to_jsonb(r) FROM public.modifier_zones r EXCEPT ALL SELECT body FROM complement_zones_before)
        UNION ALL (SELECT body FROM complement_effects_before EXCEPT ALL SELECT to_jsonb(r) FROM public.skill_effects r)
        UNION ALL (SELECT to_jsonb(r) FROM public.skill_effects r EXCEPT ALL SELECT body FROM complement_effects_before)
        UNION ALL (SELECT body FROM complement_refs_before EXCEPT ALL SELECT to_jsonb(r) FROM public.skill_object_references r)
        UNION ALL (SELECT to_jsonb(r) FROM public.skill_object_references r EXCEPT ALL SELECT body FROM complement_refs_before)
    ) THEN RAISE EXCEPTION '剩余比例连乘迁移改变了业务行、引用或时间戳'; END IF;
END
$verify$;
COMMIT;
