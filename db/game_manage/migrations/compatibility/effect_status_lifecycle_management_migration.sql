-- 效果与状态生命周期管理：三张关系表，并扩展结果种类与延迟形状。
-- 开始前核对阶段 7.2 效果八张表、skill_formulas 和阶段 7.3 效果挂接外键。
-- 三张目标表全部缺失时创建；全部存在且结构一致时幂等通过；
-- 只存在部分目标表或任一结构漂移时主动报错。不得用 CREATE TABLE IF NOT EXISTS 掩盖半迁移。
-- 只核对并替换本阶段需要更新的结果检查约束、结果形状函数、结果形状触发器和原子表明细触发器循环；
-- 不比较或覆盖阶段 7.3 过程/内部状态对象，不改写旧兼容迁移文件。
-- 不读取旧生命周期或 Ability/Provider/combat-data、不写种子、不删业务数据、不使用 DROP CASCADE。

BEGIN;

DO $effect_status_lifecycle_mig$
DECLARE
    existing_count integer;
    col_count integer;
    col_ok boolean;
    con_ok boolean;
    idx_ok boolean;
    result_type_def text;
    result_shape_src text;
    trigger_ok boolean;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skills'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skills'
          AND c.conname = 'pk_skills' AND c.contype = 'p'
          AND cardinality(c.conkey) = 2
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skills is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_formulas'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_formulas'
          AND c.conname = 'pk_skill_formulas' AND c.contype = 'p'
          AND cardinality(c.conkey) = 3
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_formulas is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_effects'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_effects'
          AND c.conname = 'pk_skill_effects' AND c.contype = 'p'
          AND cardinality(c.conkey) = 3
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'effect_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_effects is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_effect_results'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_effect_results'
          AND c.conname = 'pk_skill_effect_results' AND c.contype = 'p'
          AND cardinality(c.conkey) = 4
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'effect_key', 'result_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_effect_results is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_effect_result_values'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_values'
          AND c.conname = 'pk_skill_effect_result_values' AND c.contype = 'p'
          AND cardinality(c.conkey) = 4
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'effect_key', 'result_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_effect_result_values is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_effect_damage_details'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_effect_damage_details'
          AND c.conname = 'pk_skill_effect_damage_details' AND c.contype = 'p'
          AND cardinality(c.conkey) = 4
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'effect_key', 'result_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_effect_damage_details is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_effect_attribute_change_details'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_effect_attribute_change_details'
          AND c.conname = 'pk_skill_effect_attribute_change_details' AND c.contype = 'p'
          AND cardinality(c.conkey) = 4
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'effect_key', 'result_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_effect_attribute_change_details is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_effect_resource_change_details'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_effect_resource_change_details'
          AND c.conname = 'pk_skill_effect_resource_change_details' AND c.contype = 'p'
          AND cardinality(c.conkey) = 4
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'effect_key', 'result_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_effect_resource_change_details is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_effect_cooldown_change_details'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_effect_cooldown_change_details'
          AND c.conname = 'pk_skill_effect_cooldown_change_details' AND c.contype = 'p'
          AND cardinality(c.conkey) = 4
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'effect_key', 'result_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_effect_cooldown_change_details is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_effect_status_operation_details'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_effect_status_operation_details'
          AND c.conname = 'pk_skill_effect_status_operation_details' AND c.contype = 'p'
          AND cardinality(c.conkey) = 4
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'effect_key', 'result_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_effect_status_operation_details is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_process_effect_bindings'
          AND c.conname = 'fk_skill_process_effect_bindings_effect' AND c.contype = 'f'
          AND c.confdeltype <> 'c'
          AND c.confrelid = 'public.skill_effects'::regclass
          AND cardinality(c.conkey) = 3
          AND cardinality(c.confkey) = 3
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'effect_key']::text[]
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'effect_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite fk_skill_process_effect_bindings_effect is missing or incompatible';
    END IF;

    SELECT COUNT(*) INTO existing_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
          'skill_effect_lifecycles',
          'skill_effect_result_lifecycle_behaviors',
          'skill_effect_lifecycle_operation_details'
      );

    IF existing_count NOT IN (0, 3) THEN
        RAISE EXCEPTION
            'public.skill_effect_lifecycle* is incompatible: partial target structure exists (% of 3 tables)',
            existing_count;
    END IF;

    IF existing_count = 3 THEN

        -- public.skill_effect_lifecycles
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles';
        IF col_count <> 12 THEN
            RAISE EXCEPTION 'public.skill_effect_lifecycles is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_effect_lifecycles is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND column_name = 'game_id' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND column_name = 'skill_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND column_name = 'effect_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND column_name = 'duration_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND column_name = 'max_stacks_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND column_name = 'application_stacks_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND column_name = 'instance_scope' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND column_name = 'reapplication_stack_mode' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND column_name = 'reapplication_duration_mode' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND column_name = 'expiry_mode' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND column_name = 'periodic_interval_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
              AND column_name = 'first_periodic_execution' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'YES'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_effect_lifecycles is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'pk_skill_effect_lifecycles' AND c.contype = 'p'
              AND cardinality(c.conkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'effect_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'fk_skill_effect_lifecycles_effect' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_effects'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'effect_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'fk_skill_effect_lifecycles_duration_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'duration_formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'fk_skill_effect_lifecycles_max_stacks_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'fk_skill_effect_lifecycles_application_stacks_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'fk_skill_effect_lifecycles_periodic_interval_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'ck_skill_effect_lifecycles_instance_scope' AND c.contype = 'c'
              AND position('''SKILL''' IN pg_get_constraintdef(c.oid)) > 0
              AND position('''SOURCE_TARGET''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'ck_skill_effect_lifecycles_reapplication_stack_mode' AND c.contype = 'c'
              AND position('''KEEP''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'ck_skill_effect_lifecycles_reapplication_duration_mode' AND c.contype = 'c'
              AND position('''REFRESH_ALL''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'ck_skill_effect_lifecycles_expiry_mode' AND c.contype = 'c'
              AND position('''EXPLICIT_ONLY''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'ck_skill_effect_lifecycles_first_periodic_execution' AND c.contype = 'c'
              AND position('''IMMEDIATE''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'ck_skill_effect_lifecycles_duration_expiry' AND c.contype = 'c'
              AND position('EXPLICIT_ONLY' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'ck_skill_effect_lifecycles_independent_pair' AND c.contype = 'c'
              AND position('INDEPENDENT' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'ck_skill_effect_lifecycles_one_by_one' AND c.contype = 'c'
              AND position('ONE_BY_ONE' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycles'
              AND c.conname = 'ck_skill_effect_lifecycles_periodic_pair' AND c.contype = 'c'
              AND position('first_periodic_execution' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_effect_lifecycles is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_effect_lifecycles_duration_formula'
              AND xi.tablename = 'skill_effect_lifecycles'
              AND i.indisunique = false
              AND i.indnkeyatts = 4
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_effect_lifecycles_max_stacks_formula'
              AND xi.tablename = 'skill_effect_lifecycles'
              AND i.indisunique = false
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_effect_lifecycles_application_stacks_formula'
              AND xi.tablename = 'skill_effect_lifecycles'
              AND i.indisunique = false
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_effect_lifecycles_periodic_interval_formula'
              AND xi.tablename = 'skill_effect_lifecycles'
              AND i.indisunique = false
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_effect_lifecycles is incompatible: missing or wrong index';
        END IF;

        -- public.skill_effect_result_lifecycle_behaviors
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_effect_result_lifecycle_behaviors';
        IF col_count <> 9 THEN
            RAISE EXCEPTION 'public.skill_effect_result_lifecycle_behaviors is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_result_lifecycle_behaviors'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_effect_result_lifecycle_behaviors is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_result_lifecycle_behaviors'
              AND column_name = 'result_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_result_lifecycle_behaviors'
              AND column_name = 'moment' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_result_lifecycle_behaviors'
              AND column_name = 'value_read_mode' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_result_lifecycle_behaviors'
              AND column_name = 'stack_value_mode' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_result_lifecycle_behaviors'
              AND column_name = 'reapplication_value_mode' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_result_lifecycle_behaviors'
              AND column_name = 'periodic_execution_mode' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'YES'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_effect_result_lifecycle_behaviors is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_lifecycle_behaviors'
              AND c.conname = 'pk_skill_effect_result_lifecycle_behaviors' AND c.contype = 'p'
              AND cardinality(c.conkey) = 4
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'effect_key', 'result_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_lifecycle_behaviors'
              AND c.conname = 'fk_skill_effect_result_lifecycle_behaviors_result' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_effect_results'::regclass
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_lifecycle_behaviors'
              AND c.conname = 'ck_skill_effect_result_lifecycle_behaviors_moment' AND c.contype = 'c'
              AND position('''APPLICATION''' IN pg_get_constraintdef(c.oid)) > 0
              AND position('''NATURAL_END''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_lifecycle_behaviors'
              AND c.conname = 'ck_skill_effect_result_lifecycle_behaviors_value_read_mode' AND c.contype = 'c'
              AND position('''APPLICATION_SNAPSHOT''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_lifecycle_behaviors'
              AND c.conname = 'ck_skill_effect_result_lifecycle_behaviors_stack_value_mode' AND c.contype = 'c'
              AND position('''PER_STACK''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_lifecycle_behaviors'
              AND c.conname = 'ck_skill_effect_result_lifecycle_behaviors_reapplication_value_mode' AND c.contype = 'c'
              AND position('''REPLACE''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_lifecycle_behaviors'
              AND c.conname = 'ck_skill_effect_result_lifecycle_behaviors_periodic_execution_mode' AND c.contype = 'c'
              AND position('''ONCE_PER_INSTANCE''' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_effect_result_lifecycle_behaviors is incompatible: missing or wrong PK/FK/check constraint';
        END IF;

        -- public.skill_effect_lifecycle_operation_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycle_operation_details';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_effect_lifecycle_operation_details is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycle_operation_details'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_effect_lifecycle_operation_details is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycle_operation_details'
              AND column_name = 'target_effect_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycle_operation_details'
              AND column_name = 'operation' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_effect_lifecycle_operation_details is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycle_operation_details'
              AND c.conname = 'pk_skill_effect_lifecycle_operation_details' AND c.contype = 'p'
              AND cardinality(c.conkey) = 4
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycle_operation_details'
              AND c.conname = 'fk_skill_effect_lifecycle_operation_details_result' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_effect_results'::regclass
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycle_operation_details'
              AND c.conname = 'fk_skill_effect_lifecycle_operations_target' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_effect_lifecycles'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'target_effect_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'effect_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycle_operation_details'
              AND c.conname = 'ck_skill_effect_lifecycle_operation_details_operation' AND c.contype = 'c'
              AND position('''INCREASE''' IN pg_get_constraintdef(c.oid)) > 0
              AND position('''REFRESH''' IN pg_get_constraintdef(c.oid)) > 0
              AND position('''REMOVE''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycle_operation_details'
              AND c.conname = 'ck_skill_effect_lifecycle_operation_details_not_self' AND c.contype = 'c'
              AND position('target_effect_key' IN pg_get_constraintdef(c.oid)) > 0
              AND position('effect_key' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_effect_lifecycle_operation_details is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_effect_lifecycle_operations_target'
              AND xi.tablename = 'skill_effect_lifecycle_operation_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_effect_lifecycle_operation_details is incompatible: missing or wrong index';
        END IF;

    ELSE
        CREATE TABLE public.skill_effect_lifecycles (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            effect_key varchar(64) NOT NULL,
            duration_formula_key varchar(64),
            max_stacks_formula_key varchar(64) NOT NULL,
            application_stacks_formula_key varchar(64) NOT NULL,
            instance_scope varchar(24) NOT NULL,
            reapplication_stack_mode varchar(24) NOT NULL,
            reapplication_duration_mode varchar(24),
            expiry_mode varchar(24) NOT NULL,
            periodic_interval_formula_key varchar(64),
            first_periodic_execution varchar(24),
            CONSTRAINT pk_skill_effect_lifecycles
                PRIMARY KEY (game_id, skill_key, effect_key),
            CONSTRAINT fk_skill_effect_lifecycles_effect
                FOREIGN KEY (game_id, skill_key, effect_key)
                REFERENCES public.skill_effects (game_id, skill_key, effect_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_effect_lifecycles_duration_formula
                FOREIGN KEY (game_id, skill_key, duration_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT fk_skill_effect_lifecycles_max_stacks_formula
                FOREIGN KEY (game_id, skill_key, max_stacks_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT fk_skill_effect_lifecycles_application_stacks_formula
                FOREIGN KEY (game_id, skill_key, application_stacks_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT fk_skill_effect_lifecycles_periodic_interval_formula
                FOREIGN KEY (game_id, skill_key, periodic_interval_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT ck_skill_effect_lifecycles_instance_scope
                CHECK (instance_scope IN ('SKILL', 'SOURCE', 'TARGET', 'SOURCE_TARGET')),
            CONSTRAINT ck_skill_effect_lifecycles_reapplication_stack_mode
                CHECK (reapplication_stack_mode IN ('KEEP', 'INCREASE', 'REPLACE')),
            CONSTRAINT ck_skill_effect_lifecycles_reapplication_duration_mode
                CHECK (
                    reapplication_duration_mode IS NULL
                    OR reapplication_duration_mode IN ('REFRESH_ALL', 'KEEP_REMAINING', 'INDEPENDENT')
                ),
            CONSTRAINT ck_skill_effect_lifecycles_expiry_mode
                CHECK (expiry_mode IN ('ALL_AT_ONCE', 'ONE_BY_ONE', 'INDEPENDENT', 'EXPLICIT_ONLY')),
            CONSTRAINT ck_skill_effect_lifecycles_first_periodic_execution
                CHECK (
                    first_periodic_execution IS NULL
                    OR first_periodic_execution IN ('IMMEDIATE', 'AFTER_INTERVAL')
                ),
            CONSTRAINT ck_skill_effect_lifecycles_duration_expiry
                CHECK (
                    (
                        duration_formula_key IS NULL
                        AND expiry_mode = 'EXPLICIT_ONLY'
                        AND reapplication_duration_mode IS NULL
                    )
                    OR (
                        duration_formula_key IS NOT NULL
                        AND expiry_mode <> 'EXPLICIT_ONLY'
                        AND reapplication_duration_mode IS NOT NULL
                    )
                ),
            CONSTRAINT ck_skill_effect_lifecycles_independent_pair
                CHECK (
                    (reapplication_duration_mode = 'INDEPENDENT')
                    = (expiry_mode = 'INDEPENDENT')
                ),
            CONSTRAINT ck_skill_effect_lifecycles_one_by_one
                CHECK (
                    expiry_mode <> 'ONE_BY_ONE'
                    OR reapplication_duration_mode IN ('REFRESH_ALL', 'KEEP_REMAINING')
                ),
            CONSTRAINT ck_skill_effect_lifecycles_periodic_pair
                CHECK (
                    (periodic_interval_formula_key IS NULL)
                    = (first_periodic_execution IS NULL)
                )
        );

        CREATE INDEX ix_skill_effect_lifecycles_duration_formula
            ON public.skill_effect_lifecycles
            (game_id, skill_key, duration_formula_key, effect_key);

        CREATE INDEX ix_skill_effect_lifecycles_max_stacks_formula
            ON public.skill_effect_lifecycles
            (game_id, skill_key, max_stacks_formula_key, effect_key);

        CREATE INDEX ix_skill_effect_lifecycles_application_stacks_formula
            ON public.skill_effect_lifecycles
            (game_id, skill_key, application_stacks_formula_key, effect_key);

        CREATE INDEX ix_skill_effect_lifecycles_periodic_interval_formula
            ON public.skill_effect_lifecycles
            (game_id, skill_key, periodic_interval_formula_key, effect_key);

        COMMENT ON TABLE public.skill_effect_lifecycles IS '技能效果生命周期';

        CREATE TABLE public.skill_effect_result_lifecycle_behaviors (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            effect_key varchar(64) NOT NULL,
            result_key varchar(64) NOT NULL,
            moment varchar(24) NOT NULL,
            value_read_mode varchar(24),
            stack_value_mode varchar(24),
            reapplication_value_mode varchar(24),
            periodic_execution_mode varchar(24),
            CONSTRAINT pk_skill_effect_result_lifecycle_behaviors
                PRIMARY KEY (game_id, skill_key, effect_key, result_key),
            CONSTRAINT fk_skill_effect_result_lifecycle_behaviors_result
                FOREIGN KEY (game_id, skill_key, effect_key, result_key)
                REFERENCES public.skill_effect_results
                    (game_id, skill_key, effect_key, result_key)
                ON DELETE CASCADE,
            CONSTRAINT ck_skill_effect_result_lifecycle_behaviors_moment
                CHECK (moment IN (
                    'APPLICATION', 'PERSISTENT', 'FULL_STACKS',
                    'PERIODIC', 'NATURAL_END', 'EARLY_REMOVE'
                )),
            CONSTRAINT ck_skill_effect_result_lifecycle_behaviors_value_read_mode
                CHECK (
                    value_read_mode IS NULL
                    OR value_read_mode IN ('APPLICATION_SNAPSHOT', 'MOMENT_EVALUATION')
                ),
            CONSTRAINT ck_skill_effect_result_lifecycle_behaviors_stack_value_mode
                CHECK (
                    stack_value_mode IS NULL
                    OR stack_value_mode IN ('SHARED', 'PER_STACK')
                ),
            CONSTRAINT ck_skill_effect_result_lifecycle_behaviors_reapplication_value_mode
                CHECK (
                    reapplication_value_mode IS NULL
                    OR reapplication_value_mode IN ('KEEP', 'REPLACE', 'ADD')
                ),
            CONSTRAINT ck_skill_effect_result_lifecycle_behaviors_periodic_execution_mode
                CHECK (
                    periodic_execution_mode IS NULL
                    OR periodic_execution_mode IN ('ONCE_PER_INSTANCE', 'ONCE_PER_ACTIVE_STACK')
                )
        );

        COMMENT ON TABLE public.skill_effect_result_lifecycle_behaviors IS '技能效果结果生命周期行为';

        CREATE TABLE public.skill_effect_lifecycle_operation_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            effect_key varchar(64) NOT NULL,
            result_key varchar(64) NOT NULL,
            target_effect_key varchar(64) NOT NULL,
            operation varchar(24) NOT NULL,
            CONSTRAINT pk_skill_effect_lifecycle_operation_details
                PRIMARY KEY (game_id, skill_key, effect_key, result_key),
            CONSTRAINT fk_skill_effect_lifecycle_operation_details_result
                FOREIGN KEY (game_id, skill_key, effect_key, result_key)
                REFERENCES public.skill_effect_results
                    (game_id, skill_key, effect_key, result_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_effect_lifecycle_operations_target
                FOREIGN KEY (game_id, skill_key, target_effect_key)
                REFERENCES public.skill_effect_lifecycles (game_id, skill_key, effect_key),
            CONSTRAINT ck_skill_effect_lifecycle_operation_details_operation
                CHECK (operation IN (
                    'INCREASE', 'DECREASE', 'SET', 'REFRESH', 'CONSUME', 'REMOVE'
                )),
            CONSTRAINT ck_skill_effect_lifecycle_operation_details_not_self
                CHECK (target_effect_key <> effect_key)
        );

        CREATE INDEX ix_skill_effect_lifecycle_operations_target
            ON public.skill_effect_lifecycle_operation_details
            (game_id, skill_key, target_effect_key, effect_key, result_key);

        COMMENT ON TABLE public.skill_effect_lifecycle_operation_details IS '生命周期操作结果明细';

    END IF;

    SELECT pg_get_constraintdef(c.oid)
      INTO result_type_def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'skill_effect_results'
       AND c.conname = 'ck_skill_effect_results_type'
       AND c.contype = 'c';
    IF result_type_def IS NULL
        OR position('''DAMAGE''' IN result_type_def) = 0
        OR position('''DIRECT_HEAL''' IN result_type_def) = 0
        OR position('''NORMAL_SHIELD''' IN result_type_def) = 0
        OR position('''ATTRIBUTE_CHANGE''' IN result_type_def) = 0
        OR position('''RESOURCE_CHANGE''' IN result_type_def) = 0
        OR position('''COOLDOWN_CHANGE''' IN result_type_def) = 0
        OR position('''STATUS_OPERATION''' IN result_type_def) = 0 THEN
        RAISE EXCEPTION 'prerequisite ck_skill_effect_results_type is missing or incompatible';
    END IF;

    SELECT p.prosrc
      INTO result_shape_src
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'trg_skill_effect_result_complete_shape'
       AND pg_get_function_identity_arguments(p.oid) = '';
    IF result_shape_src IS NULL
        OR position('DAMAGE shape invalid at commit' IN result_shape_src) = 0
        OR position('STATUS_OPERATION shape invalid at commit' IN result_shape_src) = 0 THEN
        RAISE EXCEPTION 'prerequisite trg_skill_effect_result_complete_shape() is missing or incompatible';
    END IF;
    IF position('LIFECYCLE_OPERATION' IN result_shape_src) > 0
        AND position('skill_effect_lifecycle_operation_details' IN result_shape_src) = 0 THEN
        RAISE EXCEPTION 'trg_skill_effect_result_complete_shape() is incompatible: LIFECYCLE_OPERATION without operation details';
    END IF;

    SELECT EXISTS (
        SELECT 1
          FROM pg_trigger tr
          JOIN pg_class t ON t.oid = tr.tgrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'skill_effect_results'
           AND tr.tgname = 'trg_skill_effect_results_complete_shape'
           AND NOT tr.tgisinternal
    ) INTO trigger_ok;
    IF NOT trigger_ok THEN
        RAISE EXCEPTION 'prerequisite trg_skill_effect_results_complete_shape is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger tr
          JOIN pg_class t ON t.oid = tr.tgrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'skill_effect_result_values'
           AND tr.tgname = 'trg_skill_effect_result_values_complete_shape'
           AND NOT tr.tgisinternal
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_trigger tr
          JOIN pg_class t ON t.oid = tr.tgrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'skill_effect_status_operation_details'
           AND tr.tgname = 'trg_skill_effect_status_operation_details_complete_shape'
           AND NOT tr.tgisinternal
    ) THEN
        RAISE EXCEPTION 'prerequisite skill_effect result complete-shape child triggers are missing';
    END IF;

END
$effect_status_lifecycle_mig$;

ALTER TABLE public.skill_effect_results
    DROP CONSTRAINT ck_skill_effect_results_type;
ALTER TABLE public.skill_effect_results
    ADD CONSTRAINT ck_skill_effect_results_type
    CHECK (result_type IN (
        'DAMAGE', 'DIRECT_HEAL', 'NORMAL_SHIELD', 'ATTRIBUTE_CHANGE',
        'RESOURCE_CHANGE', 'COOLDOWN_CHANGE', 'STATUS_OPERATION',
        'LIFECYCLE_OPERATION'
    ));


-- skill_effect_results：事务提交时必须满足八种结果完整形状
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_skill_effect_result_complete_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_game_id varchar(64);
    v_skill_key varchar(64);
    v_effect_key varchar(64);
    v_result_key varchar(64);
    v_result_type varchar(24);
    v_cooldown_operation varchar(16);
    v_lifecycle_operation varchar(24);
    v_value_count int;
    v_damage_count int;
    v_attribute_count int;
    v_resource_count int;
    v_cooldown_count int;
    v_status_count int;
    v_lifecycle_op_count int;
BEGIN
    IF TG_TABLE_NAME = 'skill_effect_results' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        v_game_id := NEW.game_id;
        v_skill_key := NEW.skill_key;
        v_effect_key := NEW.effect_key;
        v_result_key := NEW.result_key;
        v_result_type := NEW.result_type;
    ELSE
        IF TG_OP = 'DELETE' THEN
            v_game_id := OLD.game_id;
            v_skill_key := OLD.skill_key;
            v_effect_key := OLD.effect_key;
            v_result_key := OLD.result_key;
        ELSE
            v_game_id := NEW.game_id;
            v_skill_key := NEW.skill_key;
            v_effect_key := NEW.effect_key;
            v_result_key := NEW.result_key;
        END IF;
        SELECT r.result_type
          INTO v_result_type
          FROM public.skill_effect_results r
         WHERE r.game_id = v_game_id
           AND r.skill_key = v_skill_key
           AND r.effect_key = v_effect_key
           AND r.result_key = v_result_key;
        IF NOT FOUND THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
    END IF;

    SELECT COUNT(*) INTO v_value_count
      FROM public.skill_effect_result_values v
     WHERE v.game_id = v_game_id
       AND v.skill_key = v_skill_key
       AND v.effect_key = v_effect_key
       AND v.result_key = v_result_key;
    SELECT COUNT(*) INTO v_damage_count
      FROM public.skill_effect_damage_details d
     WHERE d.game_id = v_game_id
       AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key
       AND d.result_key = v_result_key;
    SELECT COUNT(*) INTO v_attribute_count
      FROM public.skill_effect_attribute_change_details d
     WHERE d.game_id = v_game_id
       AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key
       AND d.result_key = v_result_key;
    SELECT COUNT(*) INTO v_resource_count
      FROM public.skill_effect_resource_change_details d
     WHERE d.game_id = v_game_id
       AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key
       AND d.result_key = v_result_key;
    SELECT COUNT(*) INTO v_cooldown_count
      FROM public.skill_effect_cooldown_change_details d
     WHERE d.game_id = v_game_id
       AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key
       AND d.result_key = v_result_key;
    SELECT COUNT(*) INTO v_status_count
      FROM public.skill_effect_status_operation_details d
     WHERE d.game_id = v_game_id
       AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key
       AND d.result_key = v_result_key;
    SELECT COUNT(*) INTO v_lifecycle_op_count
      FROM public.skill_effect_lifecycle_operation_details d
     WHERE d.game_id = v_game_id
       AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key
       AND d.result_key = v_result_key;

    IF v_result_type = 'DAMAGE' THEN
        IF v_value_count <> 1
            OR v_damage_count <> 1
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) DAMAGE shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type IN ('DIRECT_HEAL', 'NORMAL_SHIELD') THEN
        IF v_value_count <> 1
            OR v_damage_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) % shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key, v_result_type
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'ATTRIBUTE_CHANGE' THEN
        IF v_value_count <> 1
            OR v_damage_count <> 0
            OR v_attribute_count <> 1
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) ATTRIBUTE_CHANGE shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'RESOURCE_CHANGE' THEN
        IF v_value_count <> 1
            OR v_damage_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 1
            OR v_cooldown_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) RESOURCE_CHANGE shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'COOLDOWN_CHANGE' THEN
        IF v_cooldown_count <> 1
            OR v_damage_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) COOLDOWN_CHANGE shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT d.operation
          INTO v_cooldown_operation
          FROM public.skill_effect_cooldown_change_details d
         WHERE d.game_id = v_game_id
           AND d.skill_key = v_skill_key
           AND d.effect_key = v_effect_key
           AND d.result_key = v_result_key;
        IF v_cooldown_operation IN ('REDUCE', 'INCREASE') AND v_value_count <> 1 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) COOLDOWN_CHANGE % requires value rule at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key, v_cooldown_operation
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_cooldown_operation = 'RESET' AND v_value_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) COOLDOWN_CHANGE RESET must not have value rule at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'STATUS_OPERATION' THEN
        IF v_value_count <> 0
            OR v_damage_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 1
            OR v_lifecycle_op_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) STATUS_OPERATION shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'LIFECYCLE_OPERATION' THEN
        IF v_lifecycle_op_count <> 1
            OR v_damage_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) LIFECYCLE_OPERATION shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT d.operation
          INTO v_lifecycle_operation
          FROM public.skill_effect_lifecycle_operation_details d
         WHERE d.game_id = v_game_id
           AND d.skill_key = v_skill_key
           AND d.effect_key = v_effect_key
           AND d.result_key = v_result_key;
        IF v_lifecycle_operation IN ('INCREASE', 'DECREASE', 'SET', 'CONSUME')
            AND v_value_count <> 1 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) LIFECYCLE_OPERATION % requires value rule at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key, v_lifecycle_operation
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_lifecycle_operation IN ('REFRESH', 'REMOVE') AND v_value_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) LIFECYCLE_OPERATION % must not have value rule at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key, v_lifecycle_operation
                USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        RAISE EXCEPTION
            'skill_effect_results(%, %, %, %) has unsupported result_type %',
            v_game_id, v_skill_key, v_effect_key, v_result_key, v_result_type
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.trg_skill_effect_result_complete_shape() IS
    'deferred：保证每个技能效果结果在提交时具有完整且互斥的数值规则与类型明细';

DROP TRIGGER IF EXISTS trg_skill_effect_results_complete_shape
    ON public.skill_effect_results;
CREATE CONSTRAINT TRIGGER trg_skill_effect_results_complete_shape
AFTER INSERT OR UPDATE ON public.skill_effect_results
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_skill_effect_result_complete_shape();

DO $$
DECLARE
    v_detail text;
    v_details text[] := ARRAY[
        'skill_effect_result_values',
        'skill_effect_damage_details',
        'skill_effect_attribute_change_details',
        'skill_effect_resource_change_details',
        'skill_effect_cooldown_change_details',
        'skill_effect_status_operation_details',
        'skill_effect_lifecycle_operation_details'
    ];
BEGIN
    FOREACH v_detail IN ARRAY v_details
    LOOP
        IF to_regclass('public.' || v_detail) IS NULL THEN
            CONTINUE;
        END IF;
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_%I_complete_shape ON public.%I',
            v_detail,
            v_detail
        );
        EXECUTE format(
            'CREATE CONSTRAINT TRIGGER trg_%I_complete_shape
             AFTER INSERT OR UPDATE OR DELETE ON public.%I
             DEFERRABLE INITIALLY DEFERRED
             FOR EACH ROW
             EXECUTE FUNCTION public.trg_skill_effect_result_complete_shape()',
            v_detail,
            v_detail
        );
    END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- skill_effect 生命周期聚合形状：效果 / 生命周期 / 结果 / 行为
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_skill_effect_lifecycle_aggregate_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_game_id varchar(64);
    v_skill_key varchar(64);
    v_effect_key varchar(64);
    v_has_lifecycle boolean;
    v_duration_formula_key varchar(64);
    v_periodic_interval_formula_key varchar(64);
    v_first_periodic_execution varchar(24);
    v_result record;
    v_behavior_count int;
    v_value_count int;
    v_moment varchar(24);
    v_value_read_mode varchar(24);
    v_stack_value_mode varchar(24);
    v_reapplication_value_mode varchar(24);
    v_periodic_execution_mode varchar(24);
    v_status_operation varchar(16);
    v_attribute_operation varchar(16);
    v_periodic_behavior_count int;
BEGIN
    IF TG_TABLE_NAME = 'skill_effects' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        v_game_id := NEW.game_id;
        v_skill_key := NEW.skill_key;
        v_effect_key := NEW.effect_key;
    ELSIF TG_TABLE_NAME = 'skill_effect_results' THEN
        IF TG_OP = 'DELETE' THEN
            v_game_id := OLD.game_id;
            v_skill_key := OLD.skill_key;
            v_effect_key := OLD.effect_key;
        ELSE
            v_game_id := NEW.game_id;
            v_skill_key := NEW.skill_key;
            v_effect_key := NEW.effect_key;
        END IF;
    ELSIF TG_TABLE_NAME = 'skill_effect_lifecycles' THEN
        IF TG_OP = 'DELETE' THEN
            v_game_id := OLD.game_id;
            v_skill_key := OLD.skill_key;
            v_effect_key := OLD.effect_key;
        ELSE
            v_game_id := NEW.game_id;
            v_skill_key := NEW.skill_key;
            v_effect_key := NEW.effect_key;
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            v_game_id := OLD.game_id;
            v_skill_key := OLD.skill_key;
            v_effect_key := OLD.effect_key;
        ELSE
            v_game_id := NEW.game_id;
            v_skill_key := NEW.skill_key;
            v_effect_key := NEW.effect_key;
        END IF;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.skill_effects e
         WHERE e.game_id = v_game_id
           AND e.skill_key = v_skill_key
           AND e.effect_key = v_effect_key
    ) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    SELECT true,
           l.duration_formula_key,
           l.periodic_interval_formula_key,
           l.first_periodic_execution
      INTO v_has_lifecycle,
           v_duration_formula_key,
           v_periodic_interval_formula_key,
           v_first_periodic_execution
      FROM public.skill_effect_lifecycles l
     WHERE l.game_id = v_game_id
       AND l.skill_key = v_skill_key
       AND l.effect_key = v_effect_key;
    IF NOT FOUND THEN
        v_has_lifecycle := false;
        v_duration_formula_key := NULL;
        v_periodic_interval_formula_key := NULL;
        v_first_periodic_execution := NULL;
    END IF;

    IF NOT v_has_lifecycle THEN
        IF EXISTS (
            SELECT 1
              FROM public.skill_effect_result_lifecycle_behaviors b
             WHERE b.game_id = v_game_id
               AND b.skill_key = v_skill_key
               AND b.effect_key = v_effect_key
        ) THEN
            RAISE EXCEPTION
                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: behaviors without lifecycle',
                v_game_id, v_skill_key, v_effect_key
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN COALESCE(NEW, OLD);
    END IF;

    FOR v_result IN
        SELECT r.result_key, r.result_type
          FROM public.skill_effect_results r
         WHERE r.game_id = v_game_id
           AND r.skill_key = v_skill_key
           AND r.effect_key = v_effect_key
    LOOP
        SELECT COUNT(*) INTO v_behavior_count
          FROM public.skill_effect_result_lifecycle_behaviors b
         WHERE b.game_id = v_game_id
           AND b.skill_key = v_skill_key
           AND b.effect_key = v_effect_key
           AND b.result_key = v_result.result_key;
        IF v_behavior_count <> 1 THEN
            RAISE EXCEPTION
                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % must have exactly one behavior',
                v_game_id, v_skill_key, v_effect_key, v_result.result_key
                USING ERRCODE = 'check_violation';
        END IF;

        SELECT b.moment,
               b.value_read_mode,
               b.stack_value_mode,
               b.reapplication_value_mode,
               b.periodic_execution_mode
          INTO v_moment,
               v_value_read_mode,
               v_stack_value_mode,
               v_reapplication_value_mode,
               v_periodic_execution_mode
          FROM public.skill_effect_result_lifecycle_behaviors b
         WHERE b.game_id = v_game_id
           AND b.skill_key = v_skill_key
           AND b.effect_key = v_effect_key
           AND b.result_key = v_result.result_key;

        SELECT COUNT(*) INTO v_value_count
          FROM public.skill_effect_result_values v
         WHERE v.game_id = v_game_id
           AND v.skill_key = v_skill_key
           AND v.effect_key = v_effect_key
           AND v.result_key = v_result.result_key;

        IF v_moment = 'PERSISTENT' THEN
            IF v_result.result_type NOT IN ('NORMAL_SHIELD', 'ATTRIBUTE_CHANGE', 'STATUS_OPERATION') THEN
                RAISE EXCEPTION
                    'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % cannot be PERSISTENT',
                    v_game_id, v_skill_key, v_effect_key, v_result.result_key
                    USING ERRCODE = 'check_violation';
            END IF;
            IF v_result.result_type = 'STATUS_OPERATION' THEN
                SELECT d.operation
                  INTO v_status_operation
                  FROM public.skill_effect_status_operation_details d
                 WHERE d.game_id = v_game_id
                   AND d.skill_key = v_skill_key
                   AND d.effect_key = v_effect_key
                   AND d.result_key = v_result.result_key;
                IF v_status_operation IS DISTINCT FROM 'APPLY' THEN
                    RAISE EXCEPTION
                        'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % cannot be PERSISTENT',
                        v_game_id, v_skill_key, v_effect_key, v_result.result_key
                        USING ERRCODE = 'check_violation';
                END IF;
                IF v_stack_value_mode IS NOT NULL OR v_reapplication_value_mode IS NOT NULL THEN
                    RAISE EXCEPTION
                        'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % persistent status stack fields invalid',
                        v_game_id, v_skill_key, v_effect_key, v_result.result_key
                        USING ERRCODE = 'check_violation';
                END IF;
            ELSE
                IF v_stack_value_mode IS NULL THEN
                    RAISE EXCEPTION
                        'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % stack_value_mode required',
                        v_game_id, v_skill_key, v_effect_key, v_result.result_key
                        USING ERRCODE = 'check_violation';
                END IF;
                IF v_stack_value_mode = 'PER_STACK' THEN
                    IF v_reapplication_value_mode IS NOT NULL THEN
                        RAISE EXCEPTION
                            'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % PER_STACK forbids reapplication_value_mode',
                            v_game_id, v_skill_key, v_effect_key, v_result.result_key
                            USING ERRCODE = 'check_violation';
                    END IF;
                ELSIF v_reapplication_value_mode IS NULL THEN
                    RAISE EXCEPTION
                        'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % SHARED requires reapplication_value_mode',
                        v_game_id, v_skill_key, v_effect_key, v_result.result_key
                        USING ERRCODE = 'check_violation';
                END IF;
                IF v_result.result_type = 'ATTRIBUTE_CHANGE' THEN
                    SELECT d.operation
                      INTO v_attribute_operation
                      FROM public.skill_effect_attribute_change_details d
                     WHERE d.game_id = v_game_id
                       AND d.skill_key = v_skill_key
                       AND d.effect_key = v_effect_key
                       AND d.result_key = v_result.result_key;
                    IF v_attribute_operation = 'SET' THEN
                        IF v_stack_value_mode IS DISTINCT FROM 'SHARED'
                            OR v_reapplication_value_mode NOT IN ('KEEP', 'REPLACE') THEN
                            RAISE EXCEPTION
                                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % SET stack merge invalid',
                                v_game_id, v_skill_key, v_effect_key, v_result.result_key
                                USING ERRCODE = 'check_violation';
                        END IF;
                    END IF;
                END IF;
            END IF;
        ELSE
            IF v_stack_value_mode IS NOT NULL OR v_reapplication_value_mode IS NOT NULL THEN
                RAISE EXCEPTION
                    'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % stack fields only for PERSISTENT',
                    v_game_id, v_skill_key, v_effect_key, v_result.result_key
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        IF v_value_count > 0 THEN
            IF v_value_read_mode IS NULL THEN
                RAISE EXCEPTION
                    'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % value_read_mode required',
                    v_game_id, v_skill_key, v_effect_key, v_result.result_key
                    USING ERRCODE = 'check_violation';
            END IF;
            IF v_moment IN ('APPLICATION', 'PERSISTENT')
                AND v_value_read_mode IS DISTINCT FROM 'APPLICATION_SNAPSHOT' THEN
                RAISE EXCEPTION
                    'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % APPLICATION/PERSISTENT must snapshot',
                    v_game_id, v_skill_key, v_effect_key, v_result.result_key
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSIF v_value_read_mode IS NOT NULL THEN
            RAISE EXCEPTION
                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % value_read_mode must be empty',
                v_game_id, v_skill_key, v_effect_key, v_result.result_key
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_moment = 'PERIODIC' THEN
            IF v_periodic_execution_mode IS NULL THEN
                RAISE EXCEPTION
                    'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % periodic_execution_mode required',
                    v_game_id, v_skill_key, v_effect_key, v_result.result_key
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSIF v_periodic_execution_mode IS NOT NULL THEN
            RAISE EXCEPTION
                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % periodic_execution_mode must be empty',
                v_game_id, v_skill_key, v_effect_key, v_result.result_key
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_moment = 'NATURAL_END' AND v_duration_formula_key IS NULL THEN
            RAISE EXCEPTION
                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: NATURAL_END requires duration',
                v_game_id, v_skill_key, v_effect_key
                USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;

    SELECT COUNT(*) INTO v_periodic_behavior_count
      FROM public.skill_effect_result_lifecycle_behaviors b
     WHERE b.game_id = v_game_id
       AND b.skill_key = v_skill_key
       AND b.effect_key = v_effect_key
       AND b.moment = 'PERIODIC';
    IF v_periodic_behavior_count > 0 THEN
        IF v_periodic_interval_formula_key IS NULL OR v_first_periodic_execution IS NULL THEN
            RAISE EXCEPTION
                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: periodic fields required',
                v_game_id, v_skill_key, v_effect_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_periodic_interval_formula_key IS NOT NULL OR v_first_periodic_execution IS NOT NULL THEN
        RAISE EXCEPTION
            'skill_effects(%, %, %) lifecycle aggregate invalid at commit: periodic fields must be empty',
            v_game_id, v_skill_key, v_effect_key
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.trg_skill_effect_lifecycle_aggregate_shape() IS
    'deferred：保证效果、生命周期、结果与结果行为在提交时满足聚合形状';

DROP TRIGGER IF EXISTS trg_skill_effects_lifecycle_aggregate_shape
    ON public.skill_effects;
CREATE CONSTRAINT TRIGGER trg_skill_effects_lifecycle_aggregate_shape
AFTER INSERT OR UPDATE ON public.skill_effects
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_skill_effect_lifecycle_aggregate_shape();

DROP TRIGGER IF EXISTS trg_skill_effect_results_lifecycle_aggregate_shape
    ON public.skill_effect_results;
CREATE CONSTRAINT TRIGGER trg_skill_effect_results_lifecycle_aggregate_shape
AFTER INSERT OR UPDATE OR DELETE ON public.skill_effect_results
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_skill_effect_lifecycle_aggregate_shape();

DROP TRIGGER IF EXISTS trg_skill_effect_lifecycles_aggregate_shape
    ON public.skill_effect_lifecycles;
CREATE CONSTRAINT TRIGGER trg_skill_effect_lifecycles_aggregate_shape
AFTER INSERT OR UPDATE OR DELETE ON public.skill_effect_lifecycles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_skill_effect_lifecycle_aggregate_shape();

DROP TRIGGER IF EXISTS trg_skill_effect_result_lifecycle_behaviors_aggregate_shape
    ON public.skill_effect_result_lifecycle_behaviors;
CREATE CONSTRAINT TRIGGER trg_skill_effect_result_lifecycle_behaviors_aggregate_shape
AFTER INSERT OR UPDATE OR DELETE ON public.skill_effect_result_lifecycle_behaviors
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_skill_effect_lifecycle_aggregate_shape();

-- -----------------------------------------------------------------------------
-- REFRESH 操作目标必须有自然到期；从操作方与目标生命周期两侧延迟保护
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_skill_effect_lifecycle_refresh_target_duration()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_game_id varchar(64);
    v_skill_key varchar(64);
    v_target_effect_key varchar(64);
    v_duration_formula_key varchar(64);
    v_refresh_count int;
BEGIN
    IF TG_TABLE_NAME = 'skill_effect_lifecycle_operation_details' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        IF NEW.operation IS DISTINCT FROM 'REFRESH' THEN
            RETURN NEW;
        END IF;
        v_game_id := NEW.game_id;
        v_skill_key := NEW.skill_key;
        v_target_effect_key := NEW.target_effect_key;
        SELECT l.duration_formula_key
          INTO v_duration_formula_key
          FROM public.skill_effect_lifecycles l
         WHERE l.game_id = v_game_id
           AND l.skill_key = v_skill_key
           AND l.effect_key = v_target_effect_key;
        IF NOT FOUND THEN
            RETURN NEW;
        END IF;
        IF v_duration_formula_key IS NULL THEN
            RAISE EXCEPTION
                'ck_skill_effect_lifecycle_refresh_target_duration: REFRESH target % has no duration',
                v_target_effect_key
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_game_id := OLD.game_id;
        v_skill_key := OLD.skill_key;
        v_target_effect_key := OLD.effect_key;
        IF NOT EXISTS (
            SELECT 1
              FROM public.skill_effects e
             WHERE e.game_id = v_game_id
               AND e.skill_key = v_skill_key
               AND e.effect_key = v_target_effect_key
        ) THEN
            RETURN OLD;
        END IF;
        v_duration_formula_key := NULL;
    ELSE
        v_game_id := NEW.game_id;
        v_skill_key := NEW.skill_key;
        v_target_effect_key := NEW.effect_key;
        v_duration_formula_key := NEW.duration_formula_key;
        IF v_duration_formula_key IS NOT NULL THEN
            RETURN NEW;
        END IF;
    END IF;

    SELECT COUNT(*) INTO v_refresh_count
      FROM public.skill_effect_lifecycle_operation_details d
     WHERE d.game_id = v_game_id
       AND d.skill_key = v_skill_key
       AND d.target_effect_key = v_target_effect_key
       AND d.operation = 'REFRESH';
    IF v_refresh_count > 0 THEN
        RAISE EXCEPTION
            'ck_skill_effect_lifecycle_refresh_target_duration: lifecycle % still referenced by REFRESH',
            v_target_effect_key
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.trg_skill_effect_lifecycle_refresh_target_duration() IS
    'deferred：REFRESH 操作目标必须有自然到期，操作方写入与目标清空持续时间两侧保护';

DROP TRIGGER IF EXISTS trg_skill_effect_lifecycle_refresh_target_duration_ops
    ON public.skill_effect_lifecycle_operation_details;
CREATE CONSTRAINT TRIGGER trg_skill_effect_lifecycle_refresh_target_duration_ops
AFTER INSERT OR UPDATE ON public.skill_effect_lifecycle_operation_details
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_skill_effect_lifecycle_refresh_target_duration();

DROP TRIGGER IF EXISTS trg_skill_effect_lifecycle_refresh_target_duration_lc
    ON public.skill_effect_lifecycles;
CREATE CONSTRAINT TRIGGER trg_skill_effect_lifecycle_refresh_target_duration_lc
AFTER UPDATE OR DELETE ON public.skill_effect_lifecycles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_skill_effect_lifecycle_refresh_target_duration();

-- -----------------------------------------------------------------------------

COMMIT;
