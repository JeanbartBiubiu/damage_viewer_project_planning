-- 技能效果结构与基础结果管理：八张关系表。
-- 开始前核对 skills / skill_formulas / damage_types / attributes / statuses。
-- 八张目标表全部缺失时按依赖顺序创建；全部存在且结构一致时幂等通过；
-- 只存在部分目标表或任一结构漂移时主动报错。不得用 CREATE TABLE IF NOT EXISTS 掩盖半迁移。
-- 不读取旧效果、不写种子、不删业务数据、不使用 DROP CASCADE。
-- 只允许效果内部所有权外键出现本设计列出的 ON DELETE CASCADE；目录外键全部限制删除。

BEGIN;

DO $skill_effect_mig$
DECLARE
    existing_count integer;
    col_count integer;
    col_ok boolean;
    con_ok boolean;
    idx_ok boolean;
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
        WHERE table_schema = 'public' AND table_name = 'damage_types'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'damage_types'
          AND c.conname = 'pk_damage_types' AND c.contype = 'p'
          AND cardinality(c.conkey) = 2
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'damage_type_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.damage_types is missing or incompatible';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'attributes'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'attributes'
          AND c.conname = 'pk_attributes' AND c.contype = 'p'
          AND cardinality(c.conkey) = 2
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'attribute_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.attributes is missing or incompatible';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'statuses'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'statuses'
          AND c.conname = 'pk_statuses' AND c.contype = 'p'
          AND cardinality(c.conkey) = 2
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'status_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.statuses is missing or incompatible';
    END IF;

    SELECT COUNT(*) INTO existing_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
          'skill_effects',
          'skill_effect_results',
          'skill_effect_result_values',
          'skill_effect_damage_details',
          'skill_effect_attribute_change_details',
          'skill_effect_resource_change_details',
          'skill_effect_cooldown_change_details',
          'skill_effect_status_operation_details'
      );

    IF existing_count NOT IN (0, 8) THEN
        RAISE EXCEPTION
            'public.skill_effect* is incompatible: partial target structure exists (% of 8 tables)',
            existing_count;
    END IF;

    IF existing_count = 8 THEN
        -- public.skill_effects
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_effects';
        IF col_count <> 8 THEN
            RAISE EXCEPTION 'public.skill_effects is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effects'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_effects is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effects'
              AND column_name = 'game_id' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effects'
              AND column_name = 'skill_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effects'
              AND column_name = 'effect_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effects'
              AND column_name = 'name' AND data_type = 'character varying'
              AND character_maximum_length = 100 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effects'
              AND column_name = 'description' AND data_type = 'character varying'
              AND character_maximum_length = 2000 AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effects'
              AND column_name = 'sort_order' AND data_type = 'integer' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effects'
              AND column_name = 'created_at'
              AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effects'
              AND column_name = 'updated_at'
              AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_effects is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
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
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effects'
              AND c.conname = 'fk_skill_effects_skill' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skills'::regclass
              AND cardinality(c.conkey) = 2
              AND cardinality(c.confkey) = 2
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effects'
              AND c.conname = 'ck_skill_effects_key' AND c.contype = 'c'
              AND position('effect_key' IN pg_get_constraintdef(c.oid)) > 0
              AND position('^[a-z][a-z0-9_]{0,63}$' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effects'
              AND c.conname = 'ck_skill_effects_name' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) ILIKE '%btrim%name%'
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effects'
              AND c.conname = 'ck_skill_effects_sort_order' AND c.contype = 'c'
              AND position(
                    'sort_order>=0'
                    IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g')
                  ) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_effects is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_effects_list'
              AND xi.tablename = 'skill_effects'
              AND t.relname = 'skill_effects'
              AND i.indisunique = false
              AND i.indnkeyatts = 4
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_effects is incompatible: missing or wrong index ix_skill_effects_list';
        END IF;

        -- public.skill_effect_results
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_effect_results';
        IF col_count <> 9 THEN
            RAISE EXCEPTION 'public.skill_effect_results is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_results'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_effect_results is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_results'
              AND column_name = 'result_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_results'
              AND column_name = 'result_type' AND data_type = 'character varying'
              AND character_maximum_length = 24 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_results'
              AND column_name = 'target' AND data_type = 'character varying'
              AND character_maximum_length = 16 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_results'
              AND column_name = 'name' AND data_type = 'character varying'
              AND character_maximum_length = 100 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_results'
              AND column_name = 'description' AND data_type = 'character varying'
              AND character_maximum_length = 2000 AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_results'
              AND column_name = 'sort_order' AND data_type = 'integer' AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_effect_results is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
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
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_results'
              AND c.conname = 'fk_skill_effect_results_effect' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_effects'::regclass
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_results'
              AND c.conname = 'ck_skill_effect_results_type' AND c.contype = 'c'
              AND position('DAMAGE' IN pg_get_constraintdef(c.oid)) > 0
              AND position('DIRECT_HEAL' IN pg_get_constraintdef(c.oid)) > 0
              AND position('NORMAL_SHIELD' IN pg_get_constraintdef(c.oid)) > 0
              AND position('ATTRIBUTE_CHANGE' IN pg_get_constraintdef(c.oid)) > 0
              AND position('RESOURCE_CHANGE' IN pg_get_constraintdef(c.oid)) > 0
              AND position('COOLDOWN_CHANGE' IN pg_get_constraintdef(c.oid)) > 0
              AND position('STATUS_OPERATION' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_results'
              AND c.conname = 'ck_skill_effect_results_target' AND c.contype = 'c'
              AND position('SOURCE' IN pg_get_constraintdef(c.oid)) > 0
              AND position('TARGET' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_results'
              AND c.conname = 'ck_skill_effect_results_key' AND c.contype = 'c'
              AND position('^[a-z][a-z0-9_]{0,63}$' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_effect_results is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_effect_results_list'
              AND xi.tablename = 'skill_effect_results'
              AND i.indnkeyatts = 5
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_effect_results is incompatible: missing or wrong index ix_skill_effect_results_list';
        END IF;

        -- public.skill_effect_result_values
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_effect_result_values';
        IF col_count <> 8 THEN
            RAISE EXCEPTION 'public.skill_effect_result_values is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_result_values'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_effect_result_values is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_result_values'
              AND column_name = 'formula_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_result_values'
              AND column_name = 'fixed_multiplier' AND data_type = 'numeric' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_result_values'
              AND column_name = 'fixed_min_value' AND data_type = 'numeric' AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_effect_result_values'
              AND column_name = 'fixed_max_value' AND data_type = 'numeric' AND is_nullable = 'YES'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_effect_result_values is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_values'
              AND c.conname = 'pk_skill_effect_result_values' AND c.contype = 'p'
              AND cardinality(c.conkey) = 4
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_values'
              AND c.conname = 'fk_skill_effect_result_values_result' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_effect_results'::regclass
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_values'
              AND c.conname = 'fk_skill_effect_result_values_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_values'
              AND c.conname = 'ck_skill_effect_result_values_multiplier' AND c.contype = 'c'
              AND position(
                    'fixed_multiplier>=0'
                    IN regexp_replace(
                         replace(
                           regexp_replace(
                             lower(pg_get_constraintdef(c.oid)),
                             '\s+',
                             '',
                             'g'
                           ),
                           '(0)::numeric',
                           '0'
                         ),
                         '[()]',
                         '',
                         'g'
                       )
                  ) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_result_values'
              AND c.conname = 'ck_skill_effect_result_values_bounds' AND c.contype = 'c'
              AND position('fixed_min_value' IN pg_get_constraintdef(c.oid)) > 0
              AND position('fixed_max_value' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_effect_result_values is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_effect_result_values_formula'
              AND xi.tablename = 'skill_effect_result_values'
              AND i.indnkeyatts = 5
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_effect_result_values is incompatible: missing or wrong reverse index';
        END IF;

        -- public.skill_effect_damage_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_effect_damage_details';
        IF col_count <> 5 THEN
            RAISE EXCEPTION 'public.skill_effect_damage_details is incompatible: unexpected column set';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_damage_details'
              AND c.conname = 'pk_skill_effect_damage_details' AND c.contype = 'p'
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_damage_details'
              AND c.conname = 'fk_skill_effect_damage_details_result' AND c.contype = 'f'
              AND c.confdeltype = 'c'
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_damage_details'
              AND c.conname = 'fk_skill_effect_damage_details_damage_type' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.damage_types'::regclass
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_effect_damage_details is incompatible: missing or wrong PK/FK';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = 'ix_skill_effect_damage_details_type'
              AND tablename = 'skill_effect_damage_details'
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_effect_damage_details is incompatible: missing reverse index';
        END IF;

        -- public.skill_effect_attribute_change_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_effect_attribute_change_details';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_effect_attribute_change_details is incompatible: unexpected column set';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_attribute_change_details'
              AND c.conname = 'fk_skill_effect_attribute_change_details_result'
              AND c.contype = 'f' AND c.confdeltype = 'c'
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_attribute_change_details'
              AND c.conname = 'fk_skill_effect_attribute_change_details_attribute'
              AND c.contype = 'f' AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.attributes'::regclass
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_attribute_change_details'
              AND c.conname = 'ck_skill_effect_attribute_change_details_operation'
              AND c.contype = 'c'
              AND position('INCREASE' IN pg_get_constraintdef(c.oid)) > 0
              AND position('DECREASE' IN pg_get_constraintdef(c.oid)) > 0
              AND position('SET' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_effect_attribute_change_details is incompatible: missing or wrong constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = 'ix_skill_effect_attribute_change_details_attribute'
              AND tablename = 'skill_effect_attribute_change_details'
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_effect_attribute_change_details is incompatible: missing reverse index';
        END IF;

        -- public.skill_effect_resource_change_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_effect_resource_change_details';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_effect_resource_change_details is incompatible: unexpected column set';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_resource_change_details'
              AND c.conname = 'fk_skill_effect_resource_change_details_result'
              AND c.contype = 'f' AND c.confdeltype = 'c'
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_resource_change_details'
              AND c.conname = 'fk_skill_effect_resource_change_details_attribute'
              AND c.contype = 'f' AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.attributes'::regclass
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_resource_change_details'
              AND c.conname = 'ck_skill_effect_resource_change_details_operation'
              AND c.contype = 'c'
              AND position('RESTORE' IN pg_get_constraintdef(c.oid)) > 0
              AND position('CONSUME' IN pg_get_constraintdef(c.oid)) > 0
              AND position('REFUND' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_effect_resource_change_details is incompatible: missing or wrong constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = 'ix_skill_effect_resource_change_details_attribute'
              AND tablename = 'skill_effect_resource_change_details'
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_effect_resource_change_details is incompatible: missing reverse index';
        END IF;

        -- public.skill_effect_cooldown_change_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_effect_cooldown_change_details';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_effect_cooldown_change_details is incompatible: unexpected column set';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_cooldown_change_details'
              AND c.conname = 'fk_skill_effect_cooldown_change_details_result'
              AND c.contype = 'f' AND c.confdeltype = 'c'
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_cooldown_change_details'
              AND c.conname = 'fk_skill_effect_cooldown_change_details_skill'
              AND c.contype = 'f' AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skills'::regclass
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'affected_skill_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_cooldown_change_details'
              AND c.conname = 'ck_skill_effect_cooldown_change_details_operation'
              AND c.contype = 'c'
              AND position('REDUCE' IN pg_get_constraintdef(c.oid)) > 0
              AND position('INCREASE' IN pg_get_constraintdef(c.oid)) > 0
              AND position('RESET' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_effect_cooldown_change_details is incompatible: missing or wrong constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = 'ix_skill_effect_cooldown_change_details_skill'
              AND tablename = 'skill_effect_cooldown_change_details'
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_effect_cooldown_change_details is incompatible: missing reverse index';
        END IF;

        -- public.skill_effect_status_operation_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_effect_status_operation_details';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_effect_status_operation_details is incompatible: unexpected column set';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_status_operation_details'
              AND c.conname = 'fk_skill_effect_status_operation_details_result'
              AND c.contype = 'f' AND c.confdeltype = 'c'
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_status_operation_details'
              AND c.conname = 'fk_skill_effect_status_operation_details_status'
              AND c.contype = 'f' AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.statuses'::regclass
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_effect_status_operation_details'
              AND c.conname = 'ck_skill_effect_status_operation_details_operation'
              AND c.contype = 'c'
              AND position('APPLY' IN pg_get_constraintdef(c.oid)) > 0
              AND position('REMOVE' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_effect_status_operation_details is incompatible: missing or wrong constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = 'ix_skill_effect_status_operation_details_status'
              AND tablename = 'skill_effect_status_operation_details'
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_effect_status_operation_details is incompatible: missing reverse index';
        END IF;
    ELSE
        CREATE TABLE public.skill_effects (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            effect_key varchar(64) NOT NULL,
            name varchar(100) NOT NULL,
            description varchar(2000),
            sort_order integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_skill_effects
                PRIMARY KEY (game_id, skill_key, effect_key),
            CONSTRAINT fk_skill_effects_skill
                FOREIGN KEY (game_id, skill_key)
                REFERENCES public.skills (game_id, skill_key),
            CONSTRAINT ck_skill_effects_key
                CHECK (effect_key ~ '^[a-z][a-z0-9_]{0,63}$'),
            CONSTRAINT ck_skill_effects_name
                CHECK (btrim(name) <> ''),
            CONSTRAINT ck_skill_effects_sort_order
                CHECK (sort_order >= 0)
        );

        CREATE INDEX ix_skill_effects_list
            ON public.skill_effects (game_id, skill_key, sort_order, effect_key);

        COMMENT ON TABLE public.skill_effects IS '技能效果';

        CREATE TABLE public.skill_effect_results (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            effect_key varchar(64) NOT NULL,
            result_key varchar(64) NOT NULL,
            name varchar(100) NOT NULL,
            result_type varchar(24) NOT NULL,
            target varchar(16) NOT NULL,
            description varchar(2000),
            sort_order integer NOT NULL DEFAULT 0,
            CONSTRAINT pk_skill_effect_results
                PRIMARY KEY (game_id, skill_key, effect_key, result_key),
            CONSTRAINT fk_skill_effect_results_effect
                FOREIGN KEY (game_id, skill_key, effect_key)
                REFERENCES public.skill_effects (game_id, skill_key, effect_key)
                ON DELETE CASCADE,
            CONSTRAINT ck_skill_effect_results_key
                CHECK (result_key ~ '^[a-z][a-z0-9_]{0,63}$'),
            CONSTRAINT ck_skill_effect_results_name
                CHECK (btrim(name) <> ''),
            CONSTRAINT ck_skill_effect_results_type
                CHECK (result_type IN (
                    'DAMAGE', 'DIRECT_HEAL', 'NORMAL_SHIELD', 'ATTRIBUTE_CHANGE',
                    'RESOURCE_CHANGE', 'COOLDOWN_CHANGE', 'STATUS_OPERATION'
                )),
            CONSTRAINT ck_skill_effect_results_target
                CHECK (target IN ('SOURCE', 'TARGET')),
            CONSTRAINT ck_skill_effect_results_sort_order
                CHECK (sort_order >= 0)
        );

        CREATE INDEX ix_skill_effect_results_list
            ON public.skill_effect_results
            (game_id, skill_key, effect_key, sort_order, result_key);

        COMMENT ON TABLE public.skill_effect_results IS '技能效果结果';

        CREATE TABLE public.skill_effect_result_values (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            effect_key varchar(64) NOT NULL,
            result_key varchar(64) NOT NULL,
            formula_key varchar(64) NOT NULL,
            fixed_multiplier numeric NOT NULL DEFAULT 1,
            fixed_min_value numeric,
            fixed_max_value numeric,
            CONSTRAINT pk_skill_effect_result_values
                PRIMARY KEY (game_id, skill_key, effect_key, result_key),
            CONSTRAINT fk_skill_effect_result_values_result
                FOREIGN KEY (game_id, skill_key, effect_key, result_key)
                REFERENCES public.skill_effect_results
                    (game_id, skill_key, effect_key, result_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_effect_result_values_formula
                FOREIGN KEY (game_id, skill_key, formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT ck_skill_effect_result_values_multiplier
                CHECK (fixed_multiplier >= 0),
            CONSTRAINT ck_skill_effect_result_values_bounds
                CHECK (
                    fixed_min_value IS NULL
                    OR fixed_max_value IS NULL
                    OR fixed_min_value <= fixed_max_value
                )
        );

        CREATE INDEX ix_skill_effect_result_values_formula
            ON public.skill_effect_result_values
            (game_id, skill_key, formula_key, effect_key, result_key);

        COMMENT ON TABLE public.skill_effect_result_values IS '技能效果结果数值规则';

        CREATE TABLE public.skill_effect_damage_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            effect_key varchar(64) NOT NULL,
            result_key varchar(64) NOT NULL,
            damage_type_key varchar(64) NOT NULL,
            CONSTRAINT pk_skill_effect_damage_details
                PRIMARY KEY (game_id, skill_key, effect_key, result_key),
            CONSTRAINT fk_skill_effect_damage_details_result
                FOREIGN KEY (game_id, skill_key, effect_key, result_key)
                REFERENCES public.skill_effect_results
                    (game_id, skill_key, effect_key, result_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_effect_damage_details_damage_type
                FOREIGN KEY (game_id, damage_type_key)
                REFERENCES public.damage_types (game_id, damage_type_key)
        );

        CREATE INDEX ix_skill_effect_damage_details_type
            ON public.skill_effect_damage_details
            (game_id, damage_type_key, skill_key, effect_key, result_key);

        COMMENT ON TABLE public.skill_effect_damage_details IS '伤害结果明细';

        CREATE TABLE public.skill_effect_attribute_change_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            effect_key varchar(64) NOT NULL,
            result_key varchar(64) NOT NULL,
            attribute_key varchar(64) NOT NULL,
            operation varchar(16) NOT NULL,
            CONSTRAINT pk_skill_effect_attribute_change_details
                PRIMARY KEY (game_id, skill_key, effect_key, result_key),
            CONSTRAINT fk_skill_effect_attribute_change_details_result
                FOREIGN KEY (game_id, skill_key, effect_key, result_key)
                REFERENCES public.skill_effect_results
                    (game_id, skill_key, effect_key, result_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_effect_attribute_change_details_attribute
                FOREIGN KEY (game_id, attribute_key)
                REFERENCES public.attributes (game_id, attribute_key),
            CONSTRAINT ck_skill_effect_attribute_change_details_operation
                CHECK (operation IN ('INCREASE', 'DECREASE', 'SET'))
        );

        CREATE INDEX ix_skill_effect_attribute_change_details_attribute
            ON public.skill_effect_attribute_change_details
            (game_id, attribute_key, skill_key, effect_key, result_key);

        COMMENT ON TABLE public.skill_effect_attribute_change_details IS '属性变化结果明细';

        CREATE TABLE public.skill_effect_resource_change_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            effect_key varchar(64) NOT NULL,
            result_key varchar(64) NOT NULL,
            attribute_key varchar(64) NOT NULL,
            operation varchar(16) NOT NULL,
            CONSTRAINT pk_skill_effect_resource_change_details
                PRIMARY KEY (game_id, skill_key, effect_key, result_key),
            CONSTRAINT fk_skill_effect_resource_change_details_result
                FOREIGN KEY (game_id, skill_key, effect_key, result_key)
                REFERENCES public.skill_effect_results
                    (game_id, skill_key, effect_key, result_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_effect_resource_change_details_attribute
                FOREIGN KEY (game_id, attribute_key)
                REFERENCES public.attributes (game_id, attribute_key),
            CONSTRAINT ck_skill_effect_resource_change_details_operation
                CHECK (operation IN ('RESTORE', 'CONSUME', 'REFUND'))
        );

        CREATE INDEX ix_skill_effect_resource_change_details_attribute
            ON public.skill_effect_resource_change_details
            (game_id, attribute_key, skill_key, effect_key, result_key);

        COMMENT ON TABLE public.skill_effect_resource_change_details IS '资源变化结果明细';

        CREATE TABLE public.skill_effect_cooldown_change_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            effect_key varchar(64) NOT NULL,
            result_key varchar(64) NOT NULL,
            affected_skill_key varchar(64) NOT NULL,
            operation varchar(16) NOT NULL,
            CONSTRAINT pk_skill_effect_cooldown_change_details
                PRIMARY KEY (game_id, skill_key, effect_key, result_key),
            CONSTRAINT fk_skill_effect_cooldown_change_details_result
                FOREIGN KEY (game_id, skill_key, effect_key, result_key)
                REFERENCES public.skill_effect_results
                    (game_id, skill_key, effect_key, result_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_effect_cooldown_change_details_skill
                FOREIGN KEY (game_id, affected_skill_key)
                REFERENCES public.skills (game_id, skill_key),
            CONSTRAINT ck_skill_effect_cooldown_change_details_operation
                CHECK (operation IN ('REDUCE', 'INCREASE', 'RESET'))
        );

        CREATE INDEX ix_skill_effect_cooldown_change_details_skill
            ON public.skill_effect_cooldown_change_details
            (game_id, affected_skill_key, skill_key, effect_key, result_key);

        COMMENT ON TABLE public.skill_effect_cooldown_change_details IS '冷却变化结果明细';

        CREATE TABLE public.skill_effect_status_operation_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            effect_key varchar(64) NOT NULL,
            result_key varchar(64) NOT NULL,
            status_key varchar(64) NOT NULL,
            operation varchar(16) NOT NULL,
            CONSTRAINT pk_skill_effect_status_operation_details
                PRIMARY KEY (game_id, skill_key, effect_key, result_key),
            CONSTRAINT fk_skill_effect_status_operation_details_result
                FOREIGN KEY (game_id, skill_key, effect_key, result_key)
                REFERENCES public.skill_effect_results
                    (game_id, skill_key, effect_key, result_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_effect_status_operation_details_status
                FOREIGN KEY (game_id, status_key)
                REFERENCES public.statuses (game_id, status_key),
            CONSTRAINT ck_skill_effect_status_operation_details_operation
                CHECK (operation IN ('APPLY', 'REMOVE'))
        );

        CREATE INDEX ix_skill_effect_status_operation_details_status
            ON public.skill_effect_status_operation_details
            (game_id, status_key, skill_key, effect_key, result_key);

        COMMENT ON TABLE public.skill_effect_status_operation_details IS '状态操作结果明细';
    END IF;
END
$skill_effect_mig$;

COMMIT;
