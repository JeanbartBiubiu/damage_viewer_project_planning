-- 治疗乘区比例减少取强增量；只扩大现有两项 CHECK，不改表、列、索引、外键或业务行。
-- 执行方核对目标库、本脚本摘要与当前约束真名；source schema 不代表实库已迁移。
-- 旧约束不符或已含 RATIO_MAX 时拒绝，禁止 DROP CASCADE 与重放。提交结果不明时先独立只读核对。
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.games IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.modifier_zones IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.skill_effects, public.skill_object_references IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
    IF current_database() <> 'test0221' THEN
        RAISE EXCEPTION '治疗比例减少取强迁移目标库不符';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'modifier_zones'
          AND column_name = 'calculation_mode'
          AND data_type = 'character varying' AND character_maximum_length = 16
          AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION '乘区 calculation_mode 列定义漂移';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.modifier_zones'::regclass
          AND conname = 'ck_modifier_zones_calculation_mode'
          AND pg_get_constraintdef(oid) LIKE '%RATIO_MAX%'
    ) THEN
        RAISE EXCEPTION '治疗比例减少取强约束已执行，禁止重放：ck_modifier_zones_calculation_mode';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.modifier_zones'::regclass
          AND conname = 'ck_modifier_zones_combination'
          AND pg_get_constraintdef(oid) LIKE '%RATIO_MAX%'
    ) THEN
        RAISE EXCEPTION '治疗比例减少取强约束已执行，禁止重放：ck_modifier_zones_combination';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.modifier_zones'::regclass
          AND conname = 'ck_modifier_zones_calculation_mode'
          AND contype = 'c' AND convalidated
          AND pg_get_constraintdef(oid) = $old_mode$CHECK (((calculation_mode)::text = ANY ((ARRAY['FLAT_ADD'::character varying, 'RATIO_ADD'::character varying])::text[])))$old_mode$
    ) THEN
        RAISE EXCEPTION '计算方式约束漂移或已执行：ck_modifier_zones_calculation_mode';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.modifier_zones'::regclass
          AND conname = 'ck_modifier_zones_combination'
          AND contype = 'c' AND convalidated
          AND pg_get_constraintdef(oid) = $old_comb$CHECK (((((domain)::text = 'ATTRIBUTE'::text) AND ((calculation_mode)::text = 'FLAT_ADD'::text) AND ((application_stage)::text = 'ATTRIBUTE_FLAT'::text)) OR (((domain)::text = 'ATTRIBUTE'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = 'ATTRIBUTE_PERCENT'::text)) OR (((domain)::text = 'DAMAGE'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = ANY ((ARRAY['DAMAGE_PRE_DEFENSE'::character varying, 'DAMAGE_POST_DEFENSE'::character varying])::text[]))) OR (((domain)::text = 'HEALING'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = 'HEALING_RESULT'::text)) OR (((domain)::text = 'SHIELD'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = 'SHIELD_RESULT'::text))))$old_comb$
    ) THEN
        RAISE EXCEPTION '组合约束漂移或已执行：ck_modifier_zones_combination';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.modifier_zones'::regclass AND conname = 'pk_modifier_zones'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.modifier_zones'::regclass AND conname = 'fk_modifier_zones_game'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'modifier_zones' AND indexname = 'uq_modifier_zones_name'
    ) THEN
        RAISE EXCEPTION '乘区主键、外键或唯一索引漂移';
    END IF;
END
$preflight$;
CREATE TEMP TABLE healing_ratio_max_zones_before ON COMMIT DROP AS SELECT to_jsonb(t) AS body FROM public.modifier_zones t;
CREATE TEMP TABLE healing_ratio_max_effects_before ON COMMIT DROP AS SELECT to_jsonb(t) AS body FROM public.skill_effects t;
CREATE TEMP TABLE healing_ratio_max_refs_before ON COMMIT DROP AS SELECT to_jsonb(t) AS body FROM public.skill_object_references t;
ALTER TABLE public.modifier_zones DROP CONSTRAINT ck_modifier_zones_calculation_mode;
ALTER TABLE public.modifier_zones DROP CONSTRAINT ck_modifier_zones_combination;
ALTER TABLE public.modifier_zones
    ADD CONSTRAINT ck_modifier_zones_calculation_mode
        CHECK (calculation_mode IN ('FLAT_ADD', 'RATIO_ADD', 'RATIO_MAX')),
    ADD CONSTRAINT ck_modifier_zones_combination CHECK (
        (domain = 'ATTRIBUTE' AND calculation_mode = 'FLAT_ADD' AND application_stage = 'ATTRIBUTE_FLAT')
        OR (domain = 'ATTRIBUTE' AND calculation_mode = 'RATIO_ADD' AND application_stage = 'ATTRIBUTE_PERCENT')
        OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_ADD' AND application_stage IN ('DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'))
        OR (domain = 'HEALING' AND calculation_mode = 'RATIO_ADD' AND application_stage = 'HEALING_RESULT')
        OR (domain = 'HEALING' AND calculation_mode = 'RATIO_MAX' AND application_stage = 'HEALING_RESULT')
        OR (domain = 'SHIELD' AND calculation_mode = 'RATIO_ADD' AND application_stage = 'SHIELD_RESULT')
    );
DO $verify$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.modifier_zones'::regclass
          AND conname = 'ck_modifier_zones_calculation_mode'
          AND contype = 'c' AND convalidated
          AND pg_get_constraintdef(oid) = $new_mode$CHECK (((calculation_mode)::text = ANY ((ARRAY['FLAT_ADD'::character varying, 'RATIO_ADD'::character varying, 'RATIO_MAX'::character varying])::text[])))$new_mode$
    ) THEN
        RAISE EXCEPTION '计算方式约束验证失败';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.modifier_zones'::regclass
          AND conname = 'ck_modifier_zones_combination'
          AND contype = 'c' AND convalidated
          AND pg_get_constraintdef(oid) = $new_comb$CHECK (((((domain)::text = 'ATTRIBUTE'::text) AND ((calculation_mode)::text = 'FLAT_ADD'::text) AND ((application_stage)::text = 'ATTRIBUTE_FLAT'::text)) OR (((domain)::text = 'ATTRIBUTE'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = 'ATTRIBUTE_PERCENT'::text)) OR (((domain)::text = 'DAMAGE'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = ANY ((ARRAY['DAMAGE_PRE_DEFENSE'::character varying, 'DAMAGE_POST_DEFENSE'::character varying])::text[]))) OR (((domain)::text = 'HEALING'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = 'HEALING_RESULT'::text)) OR (((domain)::text = 'HEALING'::text) AND ((calculation_mode)::text = 'RATIO_MAX'::text) AND ((application_stage)::text = 'HEALING_RESULT'::text)) OR (((domain)::text = 'SHIELD'::text) AND ((calculation_mode)::text = 'RATIO_ADD'::text) AND ((application_stage)::text = 'SHIELD_RESULT'::text))))$new_comb$
    ) THEN
        RAISE EXCEPTION '组合约束验证失败';
    END IF;
    IF EXISTS (
        (SELECT body FROM healing_ratio_max_zones_before EXCEPT ALL SELECT to_jsonb(t) FROM public.modifier_zones t)
        UNION ALL
        (SELECT to_jsonb(t) FROM public.modifier_zones t EXCEPT ALL SELECT body FROM healing_ratio_max_zones_before)
    ) THEN
        RAISE EXCEPTION '迁移改变原业务内容或时间戳：modifier_zones';
    END IF;
    IF EXISTS (
        (SELECT body FROM healing_ratio_max_effects_before EXCEPT ALL SELECT to_jsonb(t) FROM public.skill_effects t)
        UNION ALL
        (SELECT to_jsonb(t) FROM public.skill_effects t EXCEPT ALL SELECT body FROM healing_ratio_max_effects_before)
    ) THEN
        RAISE EXCEPTION '迁移改变原业务内容或时间戳：skill_effects';
    END IF;
    IF EXISTS (
        (SELECT body FROM healing_ratio_max_refs_before EXCEPT ALL SELECT to_jsonb(t) FROM public.skill_object_references t)
        UNION ALL
        (SELECT to_jsonb(t) FROM public.skill_object_references t EXCEPT ALL SELECT body FROM healing_ratio_max_refs_before)
    ) THEN
        RAISE EXCEPTION '迁移改变原业务内容或时间戳：skill_object_references';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.modifier_zones'::regclass AND conname = 'pk_modifier_zones'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.modifier_zones'::regclass AND conname = 'fk_modifier_zones_game'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'modifier_zones' AND indexname = 'uq_modifier_zones_name'
    ) THEN
        RAISE EXCEPTION '乘区主键、外键或唯一索引在迁移后缺失';
    END IF;
END
$verify$;
COMMIT;
