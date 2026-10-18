-- 仅增加防御后伤害连乘组合；不新增列、表，不修改业务行。
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.games IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.modifier_zones IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.skill_effects, public.skill_object_references IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE damage_multiply_expected (
    domain varchar(16), calculation_mode varchar(32), application_stage varchar(32),
    CONSTRAINT before_combination CHECK (
        (domain = 'ATTRIBUTE' AND calculation_mode = 'FLAT_ADD' AND application_stage = 'ATTRIBUTE_FLAT')
        OR (domain = 'ATTRIBUTE' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MULTIPLY', 'RATIO_COMPLEMENT_MULTIPLY') AND application_stage = 'ATTRIBUTE_PERCENT')
        OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_ADD' AND application_stage IN ('DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'))
        OR (domain = 'HEALING' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MAX') AND application_stage = 'HEALING_RESULT')
        OR (domain = 'SHIELD' AND calculation_mode = 'RATIO_ADD' AND application_stage = 'SHIELD_RESULT')
    ),
    CONSTRAINT after_combination CHECK (
        (domain = 'ATTRIBUTE' AND calculation_mode = 'FLAT_ADD' AND application_stage = 'ATTRIBUTE_FLAT')
        OR (domain = 'ATTRIBUTE' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MULTIPLY', 'RATIO_COMPLEMENT_MULTIPLY') AND application_stage = 'ATTRIBUTE_PERCENT')
        OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_ADD' AND application_stage IN ('DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'))
        OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_MULTIPLY' AND application_stage = 'DAMAGE_POST_DEFENSE')
        OR (domain = 'HEALING' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MAX') AND application_stage = 'HEALING_RESULT')
        OR (domain = 'SHIELD' AND calculation_mode = 'RATIO_ADD' AND application_stage = 'SHIELD_RESULT')
    )
) ON COMMIT DROP;
DO $preflight$
BEGIN
    IF current_database() <> 'test0221' THEN RAISE EXCEPTION '防御后减伤连乘迁移目标库不符'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint actual JOIN pg_constraint expected
          ON expected.conrelid = 'pg_temp.damage_multiply_expected'::regclass AND expected.conname = 'before_combination'
        WHERE actual.conrelid = 'public.modifier_zones'::regclass AND actual.conname = 'ck_modifier_zones_combination'
          AND actual.contype = 'c' AND actual.convalidated
          AND pg_get_constraintdef(actual.oid) = pg_get_constraintdef(expected.oid)
    ) THEN RAISE EXCEPTION '乘区约束漂移或已执行，禁止重放'; END IF;
END
$preflight$;
CREATE TEMP TABLE damage_multiply_zones_before ON COMMIT DROP AS SELECT to_jsonb(r) AS body FROM public.modifier_zones r;
CREATE TEMP TABLE damage_multiply_effects_before ON COMMIT DROP AS SELECT to_jsonb(r) AS body FROM public.skill_effects r;
CREATE TEMP TABLE damage_multiply_refs_before ON COMMIT DROP AS SELECT to_jsonb(r) AS body FROM public.skill_object_references r;
ALTER TABLE public.modifier_zones
    DROP CONSTRAINT ck_modifier_zones_combination,
    ADD CONSTRAINT ck_modifier_zones_combination CHECK (
        (domain = 'ATTRIBUTE' AND calculation_mode = 'FLAT_ADD' AND application_stage = 'ATTRIBUTE_FLAT')
        OR (domain = 'ATTRIBUTE' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MULTIPLY', 'RATIO_COMPLEMENT_MULTIPLY') AND application_stage = 'ATTRIBUTE_PERCENT')
        OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_ADD' AND application_stage IN ('DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'))
        OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_MULTIPLY' AND application_stage = 'DAMAGE_POST_DEFENSE')
        OR (domain = 'HEALING' AND calculation_mode IN ('RATIO_ADD', 'RATIO_MAX') AND application_stage = 'HEALING_RESULT')
        OR (domain = 'SHIELD' AND calculation_mode = 'RATIO_ADD' AND application_stage = 'SHIELD_RESULT')
    );
DO $verify$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint actual JOIN pg_constraint expected
          ON expected.conrelid = 'pg_temp.damage_multiply_expected'::regclass AND expected.conname = 'after_combination'
        WHERE actual.conrelid = 'public.modifier_zones'::regclass AND actual.conname = 'ck_modifier_zones_combination'
          AND actual.contype = 'c' AND actual.convalidated
          AND pg_get_constraintdef(actual.oid) = pg_get_constraintdef(expected.oid)
    ) THEN RAISE EXCEPTION '防御后减伤连乘新约束验证失败'; END IF;
    IF EXISTS (
        (SELECT body FROM damage_multiply_zones_before EXCEPT ALL SELECT to_jsonb(r) FROM public.modifier_zones r)
        UNION ALL (SELECT to_jsonb(r) FROM public.modifier_zones r EXCEPT ALL SELECT body FROM damage_multiply_zones_before)
        UNION ALL (SELECT body FROM damage_multiply_effects_before EXCEPT ALL SELECT to_jsonb(r) FROM public.skill_effects r)
        UNION ALL (SELECT to_jsonb(r) FROM public.skill_effects r EXCEPT ALL SELECT body FROM damage_multiply_effects_before)
        UNION ALL (SELECT body FROM damage_multiply_refs_before EXCEPT ALL SELECT to_jsonb(r) FROM public.skill_object_references r)
        UNION ALL (SELECT to_jsonb(r) FROM public.skill_object_references r EXCEPT ALL SELECT body FROM damage_multiply_refs_before)
    ) THEN RAISE EXCEPTION '防御后减伤连乘迁移改变了业务行、引用或时间戳'; END IF;
END
$verify$;
COMMIT;
