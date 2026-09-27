-- 已有聚合存储库追加伤害类型结算公式列。新库直接使用 schema.sql，不执行本脚本。
-- 只增加可空 JSONB 列、根对象检查和列注释。不写入公式，不修改现有伤害类型或引用。
-- 列、约束已存在或表结构漂移时拒绝重放。提交结果不明时先独立只读核对，不能直接重试。
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.games IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.damage_types IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.skill_object_references IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
    IF to_regclass('public.damage_types') IS NULL THEN
        RAISE EXCEPTION '伤害类型表不存在';
    END IF;
    IF to_regclass('public.skill_object_references') IS NULL THEN
        RAISE EXCEPTION '引用索引表不存在';
    END IF;
    IF (
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'damage_types'
    ) <> 8 THEN
        RAISE EXCEPTION '伤害类型列数量漂移或结算公式列已存在，禁止重放';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'damage_types'
          AND column_name = 'calculation_formula'
    ) OR EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.damage_types'::regclass
          AND conname = 'ck_damage_types_calculation_formula'
    ) THEN
        RAISE EXCEPTION '结算公式列或约束已存在，禁止重放';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'damage_types' AND column_name = 'game_id'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'damage_types' AND column_name = 'damage_type_key'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'damage_types' AND column_name = 'name'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'damage_types' AND column_name = 'description'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'damage_types' AND column_name = 'status'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'damage_types' AND column_name = 'sort_order'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'damage_types' AND column_name = 'created_at'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'damage_types' AND column_name = 'updated_at'
    ) THEN
        RAISE EXCEPTION '伤害类型原列漂移';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.damage_types'::regclass AND conname = 'pk_damage_types'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.damage_types'::regclass AND conname = 'fk_damage_types_game'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'damage_types' AND indexname = 'uq_damage_types_name'
    ) THEN
        RAISE EXCEPTION '伤害类型主键、外键或名称唯一索引漂移';
    END IF;
END
$preflight$;
CREATE TEMP TABLE damage_type_formula_rows_before ON COMMIT DROP AS
SELECT game_id, damage_type_key, name, description, status, sort_order, created_at, updated_at
FROM public.damage_types;
CREATE TEMP TABLE damage_type_formula_refs_before ON COMMIT DROP AS
SELECT to_jsonb(t) AS body FROM public.skill_object_references t;
ALTER TABLE public.damage_types
    ADD COLUMN calculation_formula jsonb,
    ADD CONSTRAINT ck_damage_types_calculation_formula
        CHECK (calculation_formula IS NULL OR jsonb_typeof(calculation_formula) = 'object');
COMMENT ON COLUMN public.damage_types.calculation_formula IS '伤害类型结算公式；NULL 表示未配置，非空仅要求 JSON 对象，阶段语义由服务层校验';
DO $verify$
BEGIN
    IF (
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'damage_types'
    ) <> 9 OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'damage_types'
          AND column_name = 'calculation_formula' AND udt_name = 'jsonb'
          AND is_nullable = 'YES' AND column_default IS NULL
    ) THEN
        RAISE EXCEPTION '结算公式列定义验证失败';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.damage_types'::regclass
          AND conname = 'ck_damage_types_calculation_formula'
          AND contype = 'c' AND convalidated
          AND pg_get_constraintdef(oid) LIKE '%jsonb_typeof%'
          AND pg_get_constraintdef(oid) LIKE '%object%'
    ) THEN
        RAISE EXCEPTION '结算公式约束验证失败';
    END IF;
    IF col_description(
        'public.damage_types'::regclass,
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.damage_types'::regclass AND attname = 'calculation_formula' AND NOT attisdropped)
    ) IS NULL THEN
        RAISE EXCEPTION '结算公式列缺少注释';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'damage_types' AND indexdef ILIKE '%calculation_formula%'
    ) THEN
        RAISE EXCEPTION '结算公式不应创建索引';
    END IF;
    IF EXISTS (SELECT 1 FROM public.damage_types WHERE calculation_formula IS NOT NULL) THEN
        RAISE EXCEPTION '迁移写入了结算公式';
    END IF;
    IF EXISTS (
        (SELECT game_id, damage_type_key, name, description, status, sort_order, created_at, updated_at
         FROM damage_type_formula_rows_before
         EXCEPT ALL
         SELECT game_id, damage_type_key, name, description, status, sort_order, created_at, updated_at
         FROM public.damage_types)
        UNION ALL
        (SELECT game_id, damage_type_key, name, description, status, sort_order, created_at, updated_at
         FROM public.damage_types
         EXCEPT ALL
         SELECT game_id, damage_type_key, name, description, status, sort_order, created_at, updated_at
         FROM damage_type_formula_rows_before)
    ) THEN
        RAISE EXCEPTION '迁移改变了现有伤害类型';
    END IF;
    IF EXISTS (
        (SELECT body FROM damage_type_formula_refs_before EXCEPT ALL SELECT to_jsonb(t) FROM public.skill_object_references t)
        UNION ALL
        (SELECT to_jsonb(t) FROM public.skill_object_references t EXCEPT ALL SELECT body FROM damage_type_formula_refs_before)
    ) THEN
        RAISE EXCEPTION '迁移改变了技能对象引用';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.damage_types'::regclass AND conname = 'pk_damage_types'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.damage_types'::regclass AND conname = 'fk_damage_types_game'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'damage_types' AND indexname = 'uq_damage_types_name'
    ) THEN
        RAISE EXCEPTION '伤害类型主键、外键或名称唯一索引在迁移后缺失';
    END IF;
END
$verify$;
COMMIT;
