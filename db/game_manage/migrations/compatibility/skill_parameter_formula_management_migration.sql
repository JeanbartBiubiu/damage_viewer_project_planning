-- 技能参数与公式管理：skill_parameters / skill_formulas / skill_formula_nodes。
-- 该脚本只补齐结构，不写种子、不拷贝旧战斗数据、不改写已有行，不创建 calculation_variables，
-- 不读取/修改 provider_formulas。
-- 已存在表/索引必须通过 information_schema / pg_constraint / pg_indexes 预检：
-- 列、空值、PK/FK 列映射、删除动作、CHECK 表达式与索引定义均须与冻结 DDL 兼容，
-- 否则 RAISE 停止。缺失对象再由 CREATE TABLE/INDEX IF NOT EXISTS 创建。

BEGIN;

DO $$
DECLARE
    col_count integer;
    col_ok boolean;
    con_ok boolean;
    idx_ok boolean;
BEGIN
    -- public.skill_parameters
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_parameters'
    ) THEN
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_parameters';
        IF col_count <> 12 THEN
            RAISE EXCEPTION 'public.skill_parameters is incompatible: unexpected column set';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_parameters'
              AND column_name = 'game_id' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_parameters'
              AND column_name = 'skill_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_parameters'
              AND column_name = 'parameter_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_parameters'
              AND column_name = 'name' AND data_type = 'character varying'
              AND character_maximum_length = 100 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_parameters'
              AND column_name = 'value_type' AND data_type = 'character varying'
              AND character_maximum_length = 16 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_parameters'
              AND column_name = 'value_mode' AND data_type = 'character varying'
              AND character_maximum_length = 24 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_parameters'
              AND column_name = 'fixed_value' AND data_type = 'numeric' AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_parameters'
              AND column_name = 'level_values' AND udt_name = 'jsonb' AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_parameters'
              AND column_name = 'description' AND data_type = 'character varying'
              AND character_maximum_length = 2000 AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_parameters'
              AND column_name = 'sort_order' AND data_type = 'integer' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_parameters'
              AND column_name = 'created_at'
              AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_parameters'
              AND column_name = 'updated_at'
              AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_parameters is incompatible: missing or wrong column type/nullability';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_parameters'
              AND c.conname = 'pk_skill_parameters' AND c.contype = 'p'
              AND cardinality(c.conkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'parameter_key']::text[]
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_parameters'
              AND c.conname = 'fk_skill_parameters_skill' AND c.contype = 'f'
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
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_parameters'
              AND c.conname = 'ck_skill_parameters_key' AND c.contype = 'c'
              AND position('parameter_key' IN pg_get_constraintdef(c.oid)) > 0
              AND position('^[a-z][a-z0-9_]{0,63}$' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_parameters'
              AND c.conname = 'ck_skill_parameters_name' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) ILIKE '%btrim%name%'
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_parameters'
              AND c.conname = 'ck_skill_parameters_value_type' AND c.contype = 'c'
              AND position('DECIMAL' IN pg_get_constraintdef(c.oid)) > 0
              AND position('INTEGER' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_parameters'
              AND c.conname = 'ck_skill_parameters_value_mode' AND c.contype = 'c'
              AND position('FIXED' IN pg_get_constraintdef(c.oid)) > 0
              AND position('SKILL_LEVEL' IN pg_get_constraintdef(c.oid)) > 0
              AND position('CHARACTER_LEVEL' IN pg_get_constraintdef(c.oid)) > 0
              AND position('RUNTIME_INPUT' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_parameters'
              AND c.conname = 'ck_skill_parameters_value_shape' AND c.contype = 'c'
              AND position('FIXED' IN pg_get_constraintdef(c.oid)) > 0
              AND position('RUNTIME_INPUT' IN pg_get_constraintdef(c.oid)) > 0
              AND position('level_values' IN pg_get_constraintdef(c.oid)) > 0
              AND position('fixed_value' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_parameters'
              AND c.conname = 'ck_skill_parameters_sort_order' AND c.contype = 'c'
              AND position(
                    'sort_order>=0'
                    IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g')
                  ) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_parameters is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
    END IF;

    -- public.skill_formulas
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_formulas'
    ) THEN
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_formulas';
        IF col_count <> 8 THEN
            RAISE EXCEPTION 'public.skill_formulas is incompatible: unexpected column set';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formulas'
              AND column_name = 'game_id' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formulas'
              AND column_name = 'skill_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formulas'
              AND column_name = 'formula_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formulas'
              AND column_name = 'name' AND data_type = 'character varying'
              AND character_maximum_length = 100 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formulas'
              AND column_name = 'description' AND data_type = 'character varying'
              AND character_maximum_length = 2000 AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formulas'
              AND column_name = 'sort_order' AND data_type = 'integer' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formulas'
              AND column_name = 'created_at'
              AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formulas'
              AND column_name = 'updated_at'
              AND data_type = 'timestamp with time zone' AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_formulas is incompatible: missing or wrong column type/nullability';
        END IF;

        SELECT EXISTS (
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
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_formulas'
              AND c.conname = 'fk_skill_formulas_skill' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skills'::regclass
              AND cardinality(c.conkey) = 2
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key']::text[]
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_formulas'
              AND c.conname = 'ck_skill_formulas_key' AND c.contype = 'c'
              AND position('formula_key' IN pg_get_constraintdef(c.oid)) > 0
              AND position('^[a-z][a-z0-9_]{0,63}$' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_formulas'
              AND c.conname = 'ck_skill_formulas_name' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) ILIKE '%btrim%name%'
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_formulas'
              AND c.conname = 'ck_skill_formulas_sort_order' AND c.contype = 'c'
              AND position(
                    'sort_order>=0'
                    IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g')
                  ) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_formulas is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
    END IF;

    -- public.skill_formula_nodes
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
    ) THEN
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes';
        IF col_count <> 12 THEN
            RAISE EXCEPTION 'public.skill_formula_nodes is incompatible: unexpected column set';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
              AND column_name = 'game_id' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
              AND column_name = 'skill_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
              AND column_name = 'formula_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
              AND column_name = 'node_id' AND udt_name = 'uuid' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
              AND column_name = 'parent_node_id' AND udt_name = 'uuid' AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
              AND column_name = 'child_order' AND data_type = 'smallint' AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
              AND column_name = 'node_type' AND data_type = 'character varying'
              AND character_maximum_length = 16 AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
              AND column_name = 'operation' AND data_type = 'character varying'
              AND character_maximum_length = 16 AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
              AND column_name = 'parameter_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
              AND column_name = 'attribute_owner' AND data_type = 'character varying'
              AND character_maximum_length = 16 AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
              AND column_name = 'attribute_key' AND data_type = 'character varying'
              AND character_maximum_length = 64 AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
              AND column_name = 'attribute_value_kind' AND data_type = 'character varying'
              AND character_maximum_length = 24 AND is_nullable = 'YES'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_formula_nodes is incompatible: missing or wrong column type/nullability';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_formula_nodes'
              AND c.conname = 'pk_skill_formula_nodes' AND c.contype = 'p'
              AND cardinality(c.conkey) = 4
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key', 'node_id']::text[]
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_formula_nodes'
              AND c.conname = 'fk_skill_formula_nodes_formula' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_formula_nodes'
              AND c.conname = 'fk_skill_formula_nodes_parent' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.condeferrable AND c.condeferred
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_formula_nodes'
              AND c.conname = 'fk_skill_formula_nodes_parameter' AND c.contype = 'f'
              AND c.confrelid = 'public.skill_parameters'::regclass
              AND cardinality(c.conkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'parameter_key']::text[]
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_formula_nodes'
              AND c.conname = 'fk_skill_formula_nodes_attribute' AND c.contype = 'f'
              AND c.confrelid = 'public.attributes'::regclass
              AND cardinality(c.conkey) = 2
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'attribute_key']::text[]
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_formula_nodes'
              AND c.conname = 'uq_skill_formula_nodes_child' AND c.contype = 'u'
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_formula_nodes'
              AND c.conname = 'ck_skill_formula_nodes_child_order' AND c.contype = 'c'
              AND position('parent_node_id' IN pg_get_constraintdef(c.oid)) > 0
              AND position('child_order' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_formula_nodes'
              AND c.conname = 'ck_skill_formula_nodes_payload' AND c.contype = 'c'
              AND position('OPERATION' IN pg_get_constraintdef(c.oid)) > 0
              AND position('PARAMETER' IN pg_get_constraintdef(c.oid)) > 0
              AND position('ATTRIBUTE' IN pg_get_constraintdef(c.oid)) > 0
              AND position('MISSING_RATIO' IN pg_get_constraintdef(c.oid)) > 0
              AND position('operation IS NOT NULL' IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', ' ', 'g')) > 0
              AND position('parameter_key IS NOT NULL' IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', ' ', 'g')) > 0
              AND position('attribute_value_kind IS NOT NULL' IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', ' ', 'g')) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_formula_nodes is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
    END IF;

    -- Indexes: existing same-name indexes must match frozen coverage.
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'ix_skill_parameters_list'
    ) THEN
        SELECT EXISTS (
            SELECT 1
            FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            JOIN pg_namespace tn ON tn.oid = t.relnamespace
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_parameters_list'
              AND xi.tablename = 'skill_parameters'
              AND tn.nspname = 'public' AND t.relname = 'skill_parameters'
              AND NOT i.indisunique AND i.indpred IS NULL
              AND i.indnkeyatts = 5
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'sort_order', 'name', 'parameter_key']::text[]
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_parameters is incompatible: index ix_skill_parameters_list has wrong definition';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'ix_skill_parameters_character_level'
    ) THEN
        SELECT EXISTS (
            SELECT 1
            FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_parameters_character_level'
              AND xi.tablename = 'skill_parameters'
              AND NOT i.indisunique
              AND i.indpred IS NOT NULL
              AND pg_get_expr(i.indpred, i.indrelid) ILIKE '%CHARACTER_LEVEL%'
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'parameter_key']::text[]
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_parameters is incompatible: index ix_skill_parameters_character_level has wrong definition';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'ix_skill_formulas_list'
    ) THEN
        SELECT EXISTS (
            SELECT 1
            FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_formulas_list'
              AND xi.tablename = 'skill_formulas'
              AND NOT i.indisunique AND i.indpred IS NULL
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'sort_order', 'name', 'formula_key']::text[]
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_formulas is incompatible: index ix_skill_formulas_list has wrong definition';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'uq_skill_formula_nodes_root'
    ) THEN
        SELECT EXISTS (
            SELECT 1
            FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'uq_skill_formula_nodes_root'
              AND xi.tablename = 'skill_formula_nodes'
              AND i.indisunique
              AND i.indpred IS NOT NULL
              AND pg_get_expr(i.indpred, i.indrelid) ILIKE '%parent_node_id%IS%NULL%'
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_formula_nodes is incompatible: index uq_skill_formula_nodes_root has wrong definition';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'ix_skill_formula_nodes_parameter_ref'
    ) THEN
        SELECT EXISTS (
            SELECT 1
            FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_formula_nodes_parameter_ref'
              AND xi.tablename = 'skill_formula_nodes'
              AND NOT i.indisunique
              AND i.indpred IS NOT NULL
              AND pg_get_expr(i.indpred, i.indrelid) ILIKE '%parameter_key%IS%NOT%NULL%'
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'parameter_key']::text[]
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_formula_nodes is incompatible: index ix_skill_formula_nodes_parameter_ref has wrong definition';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'ix_skill_formula_nodes_attribute_ref'
    ) THEN
        SELECT EXISTS (
            SELECT 1
            FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_formula_nodes_attribute_ref'
              AND xi.tablename = 'skill_formula_nodes'
              AND NOT i.indisunique
              AND i.indpred IS NOT NULL
              AND pg_get_expr(i.indpred, i.indrelid) ILIKE '%attribute_key%IS%NOT%NULL%'
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'attribute_key']::text[]
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_formula_nodes is incompatible: index ix_skill_formula_nodes_attribute_ref has wrong definition';
        END IF;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.skill_parameters (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    parameter_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    value_type varchar(16) NOT NULL,
    value_mode varchar(24) NOT NULL,
    fixed_value numeric,
    level_values jsonb,
    description varchar(2000),
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skill_parameters
        PRIMARY KEY (game_id, skill_key, parameter_key),
    CONSTRAINT fk_skill_parameters_skill
        FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key),
    CONSTRAINT ck_skill_parameters_key
        CHECK (parameter_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_parameters_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_parameters_value_type
        CHECK (value_type IN ('DECIMAL', 'INTEGER')),
    CONSTRAINT ck_skill_parameters_value_mode
        CHECK (value_mode IN (
            'FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT'
        )),
    CONSTRAINT ck_skill_parameters_value_shape
        CHECK (
            (value_mode = 'FIXED'
                AND fixed_value IS NOT NULL
                AND level_values IS NULL)
            OR
            (value_mode IN ('SKILL_LEVEL', 'CHARACTER_LEVEL')
                AND fixed_value IS NULL
                AND level_values IS NOT NULL
                AND jsonb_typeof(level_values) = 'object')
            OR
            (value_mode = 'RUNTIME_INPUT'
                AND fixed_value IS NULL
                AND level_values IS NULL)
        ),
    CONSTRAINT ck_skill_parameters_sort_order
        CHECK (sort_order >= 0)
);

CREATE TABLE IF NOT EXISTS public.skill_formulas (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    formula_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description varchar(2000),
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skill_formulas
        PRIMARY KEY (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_formulas_skill
        FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key),
    CONSTRAINT ck_skill_formulas_key
        CHECK (formula_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_formulas_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_formulas_sort_order
        CHECK (sort_order >= 0)
);

CREATE TABLE IF NOT EXISTS public.skill_formula_nodes (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    formula_key varchar(64) NOT NULL,
    node_id uuid NOT NULL,
    parent_node_id uuid,
    child_order smallint NOT NULL,
    node_type varchar(16) NOT NULL,
    operation varchar(16),
    parameter_key varchar(64),
    attribute_owner varchar(16),
    attribute_key varchar(64),
    attribute_value_kind varchar(24),
    CONSTRAINT pk_skill_formula_nodes
        PRIMARY KEY (game_id, skill_key, formula_key, node_id),
    CONSTRAINT fk_skill_formula_nodes_formula
        FOREIGN KEY (game_id, skill_key, formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_formula_nodes_parent
        FOREIGN KEY (game_id, skill_key, formula_key, parent_node_id)
        REFERENCES public.skill_formula_nodes
            (game_id, skill_key, formula_key, node_id)
        ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT fk_skill_formula_nodes_parameter
        FOREIGN KEY (game_id, skill_key, parameter_key)
        REFERENCES public.skill_parameters
            (game_id, skill_key, parameter_key),
    CONSTRAINT fk_skill_formula_nodes_attribute
        FOREIGN KEY (game_id, attribute_key)
        REFERENCES public.attributes (game_id, attribute_key),
    CONSTRAINT uq_skill_formula_nodes_child
        UNIQUE (game_id, skill_key, formula_key, parent_node_id, child_order),
    CONSTRAINT ck_skill_formula_nodes_child_order
        CHECK (
            (parent_node_id IS NULL AND child_order = 0)
            OR
            (parent_node_id IS NOT NULL AND child_order IN (0, 1))
        ),
    CONSTRAINT ck_skill_formula_nodes_payload
        CHECK (
            (node_type = 'OPERATION'
                AND operation IS NOT NULL
                AND operation IN (
                    'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'
                )
                AND parameter_key IS NULL
                AND attribute_owner IS NULL
                AND attribute_key IS NULL
                AND attribute_value_kind IS NULL)
            OR
            (node_type = 'PARAMETER'
                AND operation IS NULL
                AND parameter_key IS NOT NULL
                AND attribute_owner IS NULL
                AND attribute_key IS NULL
                AND attribute_value_kind IS NULL)
            OR
            (node_type = 'ATTRIBUTE'
                AND operation IS NULL
                AND parameter_key IS NULL
                AND attribute_owner IS NOT NULL
                AND attribute_owner IN ('SOURCE', 'TARGET')
                AND attribute_key IS NOT NULL
                AND attribute_value_kind IS NOT NULL
                AND attribute_value_kind IN (
                    'BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING',
                    'CURRENT_RATIO', 'MISSING_RATIO'
                ))
        )
);

CREATE INDEX IF NOT EXISTS ix_skill_parameters_list
    ON public.skill_parameters
    (game_id, skill_key, sort_order, name, parameter_key);

CREATE INDEX IF NOT EXISTS ix_skill_parameters_character_level
    ON public.skill_parameters
    (game_id, skill_key, parameter_key)
    WHERE value_mode = 'CHARACTER_LEVEL';

CREATE INDEX IF NOT EXISTS ix_skill_formulas_list
    ON public.skill_formulas
    (game_id, skill_key, sort_order, name, formula_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_formula_nodes_root
    ON public.skill_formula_nodes (game_id, skill_key, formula_key)
    WHERE parent_node_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_skill_formula_nodes_parameter_ref
    ON public.skill_formula_nodes (game_id, skill_key, parameter_key)
    WHERE parameter_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_skill_formula_nodes_attribute_ref
    ON public.skill_formula_nodes (game_id, attribute_key)
    WHERE attribute_key IS NOT NULL;

COMMENT ON TABLE public.skill_parameters IS '技能参数';
COMMENT ON TABLE public.skill_formulas IS '技能公式';
COMMENT ON TABLE public.skill_formula_nodes IS '技能公式节点';

COMMIT;
