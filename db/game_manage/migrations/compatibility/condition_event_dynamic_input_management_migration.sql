-- 条件、事件与动态输入供值管理：26 张技能触发规则关系表，并安装延迟形状约束。
-- 开始前核对阶段 6、7.1、7.2、7.3 和阶段 7.4 最终表、复合键及必要唯一约束。
-- 二十六张目标表全部缺失时创建；全部存在且结构一致时幂等通过；
-- 只存在部分目标表或任一结构漂移时主动报错。不得用 CREATE TABLE IF NOT EXISTS 掩盖半迁移。
-- 不读取旧 Ability/Provider/combat-data、不写种子、不删业务数据、不使用 DROP CASCADE。

BEGIN;

DO $condition_event_dynamic_input_mig$
DECLARE
    existing_count integer;
    col_count integer;
    col_ok boolean;
    con_ok boolean;
    idx_ok boolean;
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
        WHERE table_schema = 'public' AND table_name = 'skill_parameters'
    ) OR NOT EXISTS (
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
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_parameters is missing or incompatible';
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
        WHERE table_schema = 'public' AND table_name = 'skill_formula_nodes'
    ) OR NOT EXISTS (
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
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_formula_nodes is missing or incompatible';
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
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycles'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
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
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_effect_lifecycles is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_effect_result_lifecycle_behaviors'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
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
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_effect_result_lifecycle_behaviors is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_effect_lifecycle_operation_details'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_effect_lifecycle_operation_details'
          AND c.conname = 'pk_skill_effect_lifecycle_operation_details' AND c.contype = 'p'
          AND cardinality(c.conkey) = 4
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'effect_key', 'result_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_effect_lifecycle_operation_details is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_internal_states'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_internal_states'
          AND c.conname = 'pk_skill_internal_states' AND c.contype = 'p'
          AND cardinality(c.conkey) = 3
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_internal_states is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_internal_state_mode_options'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_mode_options'
          AND c.conname = 'pk_skill_internal_state_mode_options' AND c.contype = 'p'
          AND cardinality(c.conkey) = 4
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'state_key', 'option_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_internal_state_mode_options is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_processes'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_processes'
          AND c.conname = 'pk_skill_processes' AND c.contype = 'p'
          AND cardinality(c.conkey) = 3
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'process_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_processes is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_process_steps'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_process_steps'
          AND c.conname = 'pk_skill_process_steps' AND c.contype = 'p'
          AND cardinality(c.conkey) = 4
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_process_steps is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_process_effect_bindings'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_process_effect_bindings'
          AND c.conname = 'pk_skill_process_effect_bindings' AND c.contype = 'p'
          AND cardinality(c.conkey) = 4
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'process_key', 'binding_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_process_effect_bindings is missing or incompatible';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'skill_process_state_operations'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'skill_process_state_operations'
          AND c.conname = 'pk_skill_process_state_operations' AND c.contype = 'p'
          AND cardinality(c.conkey) = 4
          AND (
                SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                JOIN pg_attribute att
                  ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
              ) = ARRAY['game_id', 'skill_key', 'process_key', 'operation_key']::text[]
    ) THEN
        RAISE EXCEPTION 'prerequisite public.skill_process_state_operations is missing or incompatible';
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
          'skill_trigger_rules',
          'skill_trigger_rule_process_events',
          'skill_trigger_rule_skill_events',
          'skill_trigger_rule_result_events',
          'skill_trigger_rule_lifecycle_events',
          'skill_trigger_rule_status_events',
          'skill_trigger_rule_health_threshold_events',
          'skill_trigger_rule_internal_state_events',
          'skill_trigger_rule_subject_events',
          'skill_trigger_rule_condition_groups',
          'skill_trigger_rule_conditions',
          'skill_trigger_rule_attribute_conditions',
          'skill_trigger_rule_status_conditions',
          'skill_trigger_rule_internal_state_conditions',
          'skill_trigger_rule_event_value_conditions',
          'skill_trigger_rule_actions',
          'skill_trigger_rule_effect_actions',
          'skill_trigger_rule_process_actions',
          'skill_trigger_rule_runtime_input_bindings',
          'skill_trigger_rule_internal_state_bindings',
          'skill_trigger_rule_combat_status_bindings',
          'skill_trigger_rule_event_value_bindings',
          'skill_trigger_rule_prior_result_bindings',
          'skill_trigger_rule_result_modifiers',
          'skill_trigger_rule_per_target_cooldowns',
          'skill_trigger_rule_process_limits'
      );

    IF existing_count NOT IN (0, 26) THEN
        RAISE EXCEPTION
            'public.skill_trigger_rule* is incompatible: partial target structure exists (% of 26 tables)',
            existing_count;
    END IF;

    IF existing_count = 26 THEN
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rules';
        IF col_count <> 9 THEN
            RAISE EXCEPTION 'public.skill_trigger_rules is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rules'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rules is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rules'
              AND c.conname = 'pk_skill_trigger_rules' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rules is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_process_events';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_process_events is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_process_events'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_process_events is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_process_events'
              AND c.conname = 'pk_skill_trigger_rule_process_events' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_process_events is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_skill_events';
        IF col_count <> 5 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_skill_events is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_skill_events'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_skill_events is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_skill_events'
              AND c.conname = 'pk_skill_trigger_rule_skill_events' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_skill_events is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_result_events';
        IF col_count <> 5 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_result_events is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_result_events'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_result_events is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_result_events'
              AND c.conname = 'pk_skill_trigger_rule_result_events' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_result_events is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_lifecycle_events';
        IF col_count <> 5 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_lifecycle_events is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_lifecycle_events'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_lifecycle_events is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_lifecycle_events'
              AND c.conname = 'pk_skill_trigger_rule_lifecycle_events' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_lifecycle_events is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_status_events';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_status_events is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_status_events'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_status_events is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_status_events'
              AND c.conname = 'pk_skill_trigger_rule_status_events' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_status_events is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_health_threshold_events';
        IF col_count <> 7 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_health_threshold_events is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_health_threshold_events'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_health_threshold_events is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_health_threshold_events'
              AND c.conname = 'pk_skill_trigger_rule_health_threshold_events' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_health_threshold_events is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_internal_state_events';
        IF col_count <> 5 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_internal_state_events is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_internal_state_events'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_internal_state_events is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_internal_state_events'
              AND c.conname = 'pk_skill_trigger_rule_internal_state_events' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_internal_state_events is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_subject_events';
        IF col_count <> 4 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_subject_events is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_subject_events'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_subject_events is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_subject_events'
              AND c.conname = 'pk_skill_trigger_rule_subject_events' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_subject_events is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_condition_groups';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_condition_groups is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_condition_groups'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_condition_groups is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_condition_groups'
              AND c.conname = 'pk_skill_trigger_rule_condition_groups' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_condition_groups is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_conditions';
        IF col_count <> 7 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_conditions is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_conditions'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_conditions is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_conditions'
              AND c.conname = 'pk_skill_trigger_rule_conditions' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_conditions is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_attribute_conditions';
        IF col_count <> 10 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_attribute_conditions is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_attribute_conditions'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_attribute_conditions is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_attribute_conditions'
              AND c.conname = 'pk_skill_trigger_rule_attribute_conditions' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_attribute_conditions is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_status_conditions';
        IF col_count <> 12 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_status_conditions is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_status_conditions'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_status_conditions is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_status_conditions'
              AND c.conname = 'pk_skill_trigger_rule_status_conditions' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_status_conditions is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_internal_state_conditions';
        IF col_count <> 11 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_internal_state_conditions is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_internal_state_conditions'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_internal_state_conditions is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_internal_state_conditions'
              AND c.conname = 'pk_skill_trigger_rule_internal_state_conditions' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_internal_state_conditions is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_event_value_conditions';
        IF col_count <> 8 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_event_value_conditions is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_event_value_conditions'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_event_value_conditions is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_event_value_conditions'
              AND c.conname = 'pk_skill_trigger_rule_event_value_conditions' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_event_value_conditions is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_actions';
        IF col_count <> 8 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_actions is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_actions'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_actions is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_actions'
              AND c.conname = 'pk_skill_trigger_rule_actions' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_actions is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_effect_actions';
        IF col_count <> 5 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_effect_actions is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_effect_actions'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_effect_actions is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_effect_actions'
              AND c.conname = 'pk_skill_trigger_rule_effect_actions' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_effect_actions is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_process_actions';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_process_actions is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_process_actions'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_process_actions is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_process_actions'
              AND c.conname = 'pk_skill_trigger_rule_process_actions' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_process_actions is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_runtime_input_bindings';
        IF col_count <> 7 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_runtime_input_bindings is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_runtime_input_bindings'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_runtime_input_bindings is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_runtime_input_bindings'
              AND c.conname = 'pk_skill_trigger_rule_runtime_input_bindings' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_runtime_input_bindings is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_internal_state_bindings';
        IF col_count <> 8 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_internal_state_bindings is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_internal_state_bindings'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_internal_state_bindings is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_internal_state_bindings'
              AND c.conname = 'pk_skill_trigger_rule_internal_state_bindings' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_internal_state_bindings is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_combat_status_bindings';
        IF col_count <> 10 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_combat_status_bindings is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_combat_status_bindings'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_combat_status_bindings is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_combat_status_bindings'
              AND c.conname = 'pk_skill_trigger_rule_combat_status_bindings' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_combat_status_bindings is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_event_value_bindings';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_event_value_bindings is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_event_value_bindings'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_event_value_bindings is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_event_value_bindings'
              AND c.conname = 'pk_skill_trigger_rule_event_value_bindings' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_event_value_bindings is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_prior_result_bindings';
        IF col_count <> 9 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_prior_result_bindings is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_prior_result_bindings'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_prior_result_bindings is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_prior_result_bindings'
              AND c.conname = 'pk_skill_trigger_rule_prior_result_bindings' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_prior_result_bindings is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_result_modifiers';
        IF col_count <> 9 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_result_modifiers is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_result_modifiers'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_result_modifiers is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_result_modifiers'
              AND c.conname = 'pk_skill_trigger_rule_result_modifiers' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_result_modifiers is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_per_target_cooldowns';
        IF col_count <> 5 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_per_target_cooldowns is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_per_target_cooldowns'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_per_target_cooldowns is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_per_target_cooldowns'
              AND c.conname = 'pk_skill_trigger_rule_per_target_cooldowns' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_per_target_cooldowns is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_process_limits';
        IF col_count <> 5 THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_process_limits is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_trigger_rule_process_limits'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_process_limits is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_process_limits'
              AND c.conname = 'pk_skill_trigger_rule_process_limits' AND c.contype = 'p'
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule_process_limits is incompatible: missing or wrong pk/fk/check constraint';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_effect_actions'
              AND c.conname = 'uq_skill_trigger_effect_action_effect' AND c.contype = 'u'
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_runtime_input_bindings'
              AND c.conname = 'uq_skill_trigger_runtime_bindings_parameter' AND c.contype = 'u'
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rules'
              AND c.conname = 'ck_skill_trigger_rules_event_type' AND c.contype = 'c'
              AND position('''SKILL_USED''' IN pg_get_constraintdef(c.oid)) > 0
              AND position('''PROCESS_CANCEL_REQUESTED''' IN pg_get_constraintdef(c.oid)) > 0
              AND position('''VALUE_REACHED''' IN pg_get_constraintdef(c.oid)) = 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_internal_state_events'
              AND c.conname = 'ck_skill_trigger_istate_events_change' AND c.contype = 'c'
              AND position('''VALUE_CHANGED''' IN pg_get_constraintdef(c.oid)) > 0
              AND position('''COOLDOWN_READY''' IN pg_get_constraintdef(c.oid)) > 0
              AND position('''VALUE_REACHED''' IN pg_get_constraintdef(c.oid)) = 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_process_events'
              AND c.conname = 'fk_skill_trigger_process_events_rule' AND c.contype = 'f'
              AND c.confdeltype = 'c'
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_process_events'
              AND c.conname = 'fk_skill_trigger_process_events_process' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_prior_result_bindings'
              AND c.conname = 'fk_skill_trigger_prior_result_bind_source_action' AND c.contype = 'f'
              AND c.condeferrable AND c.condeferred
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_trigger_rule_prior_result_bindings'
              AND c.conname = 'fk_skill_trigger_prior_result_bind_result' AND c.contype = 'f'
              AND c.condeferrable AND c.condeferred
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule* is incompatible: missing or wrong pk/fk/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = 'ix_skill_trigger_rules_list'
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = 'ix_skill_trigger_skill_events_source_skill'
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = 'ix_skill_trigger_result_events_result'
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = 'ix_skill_trigger_prior_result_bind_source_action'
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = 'ix_skill_trigger_runtime_bindings_parameter'
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_trigger_rule* is incompatible: missing reverse index';
        END IF;
    ELSE
        -- 技能触发规则（阶段 7.5）：26 张关系表
-- -----------------------------------------------------------------------------

CREATE TABLE public.skill_trigger_rules (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description varchar(1000),
    sort_order integer NOT NULL DEFAULT 0,
    event_type varchar(32) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skill_trigger_rules
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_rules_skill
        FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key),
    CONSTRAINT ck_skill_trigger_rules_key
        CHECK (rule_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_trigger_rules_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_trigger_rules_sort_order
        CHECK (sort_order >= 0 AND sort_order <= 999999),
    CONSTRAINT ck_skill_trigger_rules_event_type
        CHECK (event_type IN (
            'SKILL_USED', 'BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'SKILL_HIT',
            'PROCESS_MOMENT', 'RESULT_AVAILABLE', 'LIFECYCLE_MOMENT',
            'DAMAGE_DEALT', 'DAMAGE_TAKEN', 'STATUS_CHANGED',
            'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED',
            'CONTROL_RECEIVED', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
            'KILL', 'PROCESS_CANCEL_REQUESTED'
        ))
);

CREATE INDEX ix_skill_trigger_rules_list
    ON public.skill_trigger_rules (game_id, skill_key, sort_order, rule_key);

CREATE INDEX ix_skill_trigger_rules_event_type
    ON public.skill_trigger_rules (game_id, skill_key, event_type, rule_key);

COMMENT ON TABLE public.skill_trigger_rules IS '技能触发规则';

CREATE TABLE public.skill_trigger_rule_process_events (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    moment_type varchar(24),
    step_key varchar(64),
    CONSTRAINT pk_skill_trigger_rule_process_events
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_process_events_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_process_events_process
        FOREIGN KEY (game_id, skill_key, process_key)
        REFERENCES public.skill_processes (game_id, skill_key, process_key),
    CONSTRAINT fk_skill_trigger_process_events_step
        FOREIGN KEY (game_id, skill_key, process_key, step_key)
        REFERENCES public.skill_process_steps
            (game_id, skill_key, process_key, step_key)
        MATCH SIMPLE,
    CONSTRAINT ck_skill_trigger_process_events_moment
        CHECK (
            (
                moment_type IS NULL
                AND step_key IS NULL
            )
            OR (
                moment_type IN ('PROCESS_START', 'PROCESS_COMPLETE', 'PROCESS_FAILURE')
                AND step_key IS NULL
            )
            OR (
                moment_type IN (
                    'STEP_START', 'STEP_EXECUTION', 'STEP_COMPLETE', 'STEP_TIMEOUT'
                )
                AND step_key IS NOT NULL
            )
        )
);

CREATE INDEX ix_skill_trigger_process_events_process
    ON public.skill_trigger_rule_process_events
    (game_id, skill_key, process_key, rule_key);

CREATE INDEX ix_skill_trigger_process_events_step
    ON public.skill_trigger_rule_process_events
    (game_id, skill_key, process_key, step_key, rule_key);

COMMENT ON TABLE public.skill_trigger_rule_process_events IS '技能触发规则过程事件明细';

CREATE TABLE public.skill_trigger_rule_skill_events (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    source_skill_key varchar(64),
    use_kind varchar(16),
    CONSTRAINT pk_skill_trigger_rule_skill_events
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_skill_events_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_skill_events_source_skill
        FOREIGN KEY (game_id, source_skill_key)
        REFERENCES public.skills (game_id, skill_key)
        MATCH SIMPLE,
    CONSTRAINT ck_skill_trigger_skill_events_use_kind
        CHECK (
            use_kind IS NULL
            OR use_kind IN ('ACTIVE', 'CONSUMABLE', 'ANY')
        )
);

CREATE INDEX ix_skill_trigger_skill_events_source_skill
    ON public.skill_trigger_rule_skill_events
    (game_id, source_skill_key, skill_key, rule_key);

COMMENT ON TABLE public.skill_trigger_rule_skill_events IS '技能触发规则技能使用或命中事件明细';

CREATE TABLE public.skill_trigger_rule_result_events (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_result_events
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_result_events_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_result_events_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
);

CREATE INDEX ix_skill_trigger_result_events_result
    ON public.skill_trigger_rule_result_events
    (game_id, skill_key, effect_key, result_key, rule_key);

COMMENT ON TABLE public.skill_trigger_rule_result_events IS '技能触发规则无生命周期结果可用事件明细';

CREATE TABLE public.skill_trigger_rule_lifecycle_events (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    lifecycle_moment varchar(24) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_lifecycle_events
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_lifecycle_events_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_lifecycle_events_effect
        FOREIGN KEY (game_id, skill_key, effect_key)
        REFERENCES public.skill_effects (game_id, skill_key, effect_key),
    CONSTRAINT fk_skill_trigger_lifecycle_events_lifecycle
        FOREIGN KEY (game_id, skill_key, effect_key)
        REFERENCES public.skill_effect_lifecycles (game_id, skill_key, effect_key),
    CONSTRAINT ck_skill_trigger_lifecycle_events_moment
        CHECK (lifecycle_moment IN (
            'APPLICATION', 'FULL_STACKS', 'PERIODIC', 'NATURAL_END', 'EARLY_REMOVE'
        ))
);

CREATE INDEX ix_skill_trigger_lifecycle_events_effect
    ON public.skill_trigger_rule_lifecycle_events
    (game_id, skill_key, effect_key, rule_key);

COMMENT ON TABLE public.skill_trigger_rule_lifecycle_events IS '技能触发规则生命周期时点事件明细';

CREATE TABLE public.skill_trigger_rule_status_events (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    subject varchar(24) NOT NULL,
    status_key varchar(64) NOT NULL,
    change_kind varchar(16) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_status_events
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_status_events_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_status_events_status
        FOREIGN KEY (game_id, status_key)
        REFERENCES public.statuses (game_id, status_key),
    CONSTRAINT ck_skill_trigger_status_events_subject
        CHECK (subject IN ('SOURCE', 'CURRENT_TARGET')),
    CONSTRAINT ck_skill_trigger_status_events_change
        CHECK (change_kind IN ('APPLY', 'REMOVE'))
);

CREATE INDEX ix_skill_trigger_status_events_status
    ON public.skill_trigger_rule_status_events
    (game_id, status_key, skill_key, rule_key);

COMMENT ON TABLE public.skill_trigger_rule_status_events IS '技能触发规则战斗状态变化事件明细';

CREATE TABLE public.skill_trigger_rule_health_threshold_events (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    subject varchar(24) NOT NULL,
    attribute_key varchar(64) NOT NULL,
    threshold_formula_key varchar(64) NOT NULL,
    direction varchar(16) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_health_threshold_events
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_health_threshold_events_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_health_threshold_events_attribute
        FOREIGN KEY (game_id, attribute_key)
        REFERENCES public.attributes (game_id, attribute_key),
    CONSTRAINT fk_skill_trigger_health_threshold_formula
        FOREIGN KEY (game_id, skill_key, threshold_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT ck_skill_trigger_health_threshold_events_subject
        CHECK (subject IN ('SOURCE', 'CURRENT_TARGET')),
    CONSTRAINT ck_skill_trigger_health_threshold_events_direction
        CHECK (direction IN ('UPWARD', 'DOWNWARD'))
);

CREATE INDEX ix_skill_trigger_health_threshold_events_attribute
    ON public.skill_trigger_rule_health_threshold_events
    (game_id, attribute_key, skill_key, rule_key);

CREATE INDEX ix_skill_trigger_health_threshold_events_formula
    ON public.skill_trigger_rule_health_threshold_events
    (game_id, skill_key, threshold_formula_key, rule_key);

COMMENT ON TABLE public.skill_trigger_rule_health_threshold_events IS '技能触发规则生命阈值事件明细';

CREATE TABLE public.skill_trigger_rule_internal_state_events (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    state_key varchar(64) NOT NULL,
    change_kind varchar(24) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_internal_state_events
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_istate_events_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_istate_events_state
        FOREIGN KEY (game_id, skill_key, state_key)
        REFERENCES public.skill_internal_states (game_id, skill_key, state_key),
    CONSTRAINT ck_skill_trigger_istate_events_change
        CHECK (change_kind IN (
            'VALUE_CHANGED', 'OPTION_SELECTED', 'FLAG_CHANGED', 'COOLDOWN_READY'
        ))
);

CREATE INDEX ix_skill_trigger_istate_events_state
    ON public.skill_trigger_rule_internal_state_events
    (game_id, skill_key, state_key, rule_key);

COMMENT ON TABLE public.skill_trigger_rule_internal_state_events IS '技能触发规则内部状态变化事件明细';

CREATE TABLE public.skill_trigger_rule_subject_events (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    subject varchar(24) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_subject_events
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_subject_events_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_skill_trigger_subject_events_subject
        CHECK (subject IN ('SOURCE', 'CURRENT_TARGET'))
);

COMMENT ON TABLE public.skill_trigger_rule_subject_events IS '技能触发规则对象死亡或不可选取事件明细';

CREATE TABLE public.skill_trigger_rule_condition_groups (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_skill_trigger_rule_condition_groups
        PRIMARY KEY (game_id, skill_key, rule_key, group_key),
    CONSTRAINT fk_skill_trigger_condition_groups_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_skill_trigger_condition_groups_key
        CHECK (group_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_trigger_condition_groups_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_trigger_condition_groups_sort_order
        CHECK (sort_order >= 0 AND sort_order <= 999999)
);

CREATE INDEX ix_skill_trigger_condition_groups_list
    ON public.skill_trigger_rule_condition_groups
    (game_id, skill_key, rule_key, sort_order, group_key);

COMMENT ON TABLE public.skill_trigger_rule_condition_groups IS '技能触发规则条件组';

CREATE TABLE public.skill_trigger_rule_conditions (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    condition_key varchar(64) NOT NULL,
    condition_type varchar(32) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_skill_trigger_rule_conditions
        PRIMARY KEY (game_id, skill_key, rule_key, group_key, condition_key),
    CONSTRAINT fk_skill_trigger_conditions_group
        FOREIGN KEY (game_id, skill_key, rule_key, group_key)
        REFERENCES public.skill_trigger_rule_condition_groups
            (game_id, skill_key, rule_key, group_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_skill_trigger_conditions_key
        CHECK (condition_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_trigger_conditions_type
        CHECK (condition_type IN (
            'ATTRIBUTE_COMPARE', 'STATUS_CHECK',
            'INTERNAL_STATE_CHECK', 'EVENT_VALUE_COMPARE'
        )),
    CONSTRAINT ck_skill_trigger_conditions_sort_order
        CHECK (sort_order >= 0 AND sort_order <= 999999)
);

CREATE INDEX ix_skill_trigger_conditions_list
    ON public.skill_trigger_rule_conditions
    (game_id, skill_key, rule_key, group_key, sort_order, condition_key);

COMMENT ON TABLE public.skill_trigger_rule_conditions IS '技能触发规则条件';

CREATE TABLE public.skill_trigger_rule_attribute_conditions (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    condition_key varchar(64) NOT NULL,
    subject varchar(24) NOT NULL,
    attribute_key varchar(64) NOT NULL,
    attribute_value_kind varchar(24) NOT NULL,
    comparator varchar(8) NOT NULL,
    comparison_formula_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_attribute_conditions
        PRIMARY KEY (game_id, skill_key, rule_key, group_key, condition_key),
    CONSTRAINT fk_skill_trigger_attr_cond_condition
        FOREIGN KEY (game_id, skill_key, rule_key, group_key, condition_key)
        REFERENCES public.skill_trigger_rule_conditions
            (game_id, skill_key, rule_key, group_key, condition_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_attr_cond_attribute
        FOREIGN KEY (game_id, attribute_key)
        REFERENCES public.attributes (game_id, attribute_key),
    CONSTRAINT fk_skill_trigger_attr_cond_formula
        FOREIGN KEY (game_id, skill_key, comparison_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT ck_skill_trigger_attr_cond_subject
        CHECK (subject IN ('SOURCE', 'CURRENT_TARGET', 'EVENT_SOURCE')),
    CONSTRAINT ck_skill_trigger_attr_cond_value_kind
        CHECK (attribute_value_kind IN (
            'BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING',
            'CURRENT_RATIO', 'MISSING_RATIO'
        )),
    CONSTRAINT ck_skill_trigger_attr_cond_comparator
        CHECK (comparator IN ('LT', 'LTE', 'EQ', 'NE', 'GTE', 'GT'))
);

CREATE INDEX ix_skill_trigger_attr_cond_attribute
    ON public.skill_trigger_rule_attribute_conditions
    (game_id, attribute_key, skill_key, rule_key, group_key, condition_key);

CREATE INDEX ix_skill_trigger_attr_cond_formula
    ON public.skill_trigger_rule_attribute_conditions
    (game_id, skill_key, comparison_formula_key, rule_key, group_key, condition_key);

COMMENT ON TABLE public.skill_trigger_rule_attribute_conditions IS '技能触发规则属性比较条件明细';

CREATE TABLE public.skill_trigger_rule_status_conditions (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    condition_key varchar(64) NOT NULL,
    subject varchar(24) NOT NULL,
    status_key varchar(64) NOT NULL,
    check_kind varchar(24) NOT NULL,
    source_effect_key varchar(64),
    source_result_key varchar(64),
    comparator varchar(8),
    comparison_formula_key varchar(64),
    CONSTRAINT pk_skill_trigger_rule_status_conditions
        PRIMARY KEY (game_id, skill_key, rule_key, group_key, condition_key),
    CONSTRAINT fk_skill_trigger_status_cond_condition
        FOREIGN KEY (game_id, skill_key, rule_key, group_key, condition_key)
        REFERENCES public.skill_trigger_rule_conditions
            (game_id, skill_key, rule_key, group_key, condition_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_status_cond_status
        FOREIGN KEY (game_id, status_key)
        REFERENCES public.statuses (game_id, status_key),
    CONSTRAINT fk_skill_trigger_status_cond_source_result
        FOREIGN KEY (game_id, skill_key, source_effect_key, source_result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        MATCH SIMPLE,
    CONSTRAINT fk_skill_trigger_status_cond_formula
        FOREIGN KEY (game_id, skill_key, comparison_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
        MATCH SIMPLE,
    CONSTRAINT ck_skill_trigger_status_cond_subject
        CHECK (subject IN ('SOURCE', 'CURRENT_TARGET', 'EVENT_SOURCE')),
    CONSTRAINT ck_skill_trigger_status_cond_check_kind
        CHECK (check_kind IN ('PRESENT', 'ABSENT', 'STACKS_COMPARE', 'REMAINING_MS_COMPARE')),
    CONSTRAINT ck_skill_trigger_status_cond_shape
        CHECK (
            (
                check_kind IN ('PRESENT', 'ABSENT')
                AND source_effect_key IS NULL
                AND source_result_key IS NULL
                AND comparator IS NULL
                AND comparison_formula_key IS NULL
            )
            OR (
                check_kind IN ('STACKS_COMPARE', 'REMAINING_MS_COMPARE')
                AND source_effect_key IS NOT NULL
                AND source_result_key IS NOT NULL
                AND comparator IN ('LT', 'LTE', 'EQ', 'NE', 'GTE', 'GT')
                AND comparison_formula_key IS NOT NULL
            )
        )
);

CREATE INDEX ix_skill_trigger_status_cond_status
    ON public.skill_trigger_rule_status_conditions
    (game_id, status_key, skill_key, rule_key, group_key, condition_key);

CREATE INDEX ix_skill_trigger_status_cond_source_result
    ON public.skill_trigger_rule_status_conditions
    (game_id, skill_key, source_effect_key, source_result_key, rule_key, group_key, condition_key);

CREATE INDEX ix_skill_trigger_status_cond_formula
    ON public.skill_trigger_rule_status_conditions
    (game_id, skill_key, comparison_formula_key, rule_key, group_key, condition_key);

COMMENT ON TABLE public.skill_trigger_rule_status_conditions IS '技能触发规则战斗状态检查条件明细';

CREATE TABLE public.skill_trigger_rule_internal_state_conditions (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    condition_key varchar(64) NOT NULL,
    state_key varchar(64) NOT NULL,
    value_kind varchar(24) NOT NULL,
    option_key varchar(64),
    expected_boolean boolean,
    comparator varchar(8),
    comparison_formula_key varchar(64),
    CONSTRAINT pk_skill_trigger_rule_internal_state_conditions
        PRIMARY KEY (game_id, skill_key, rule_key, group_key, condition_key),
    CONSTRAINT fk_skill_trigger_istate_cond_condition
        FOREIGN KEY (game_id, skill_key, rule_key, group_key, condition_key)
        REFERENCES public.skill_trigger_rule_conditions
            (game_id, skill_key, rule_key, group_key, condition_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_istate_cond_state
        FOREIGN KEY (game_id, skill_key, state_key)
        REFERENCES public.skill_internal_states (game_id, skill_key, state_key),
    CONSTRAINT fk_skill_trigger_istate_cond_option
        FOREIGN KEY (game_id, skill_key, state_key, option_key)
        REFERENCES public.skill_internal_state_mode_options
            (game_id, skill_key, state_key, option_key)
        MATCH SIMPLE,
    CONSTRAINT fk_skill_trigger_istate_cond_formula
        FOREIGN KEY (game_id, skill_key, comparison_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
        MATCH SIMPLE,
    CONSTRAINT ck_skill_trigger_istate_cond_value_kind
        CHECK (value_kind IN ('VALUE', 'OPTION_SELECTED', 'ENABLED', 'REMAINING_MS')),
    CONSTRAINT ck_skill_trigger_istate_cond_shape
        CHECK (
            (
                value_kind IN ('VALUE', 'REMAINING_MS')
                AND option_key IS NULL
                AND expected_boolean IS NULL
                AND comparator IN ('LT', 'LTE', 'EQ', 'NE', 'GTE', 'GT')
                AND comparison_formula_key IS NOT NULL
            )
            OR (
                value_kind = 'OPTION_SELECTED'
                AND option_key IS NOT NULL
                AND expected_boolean IS NULL
                AND comparator IS NULL
                AND comparison_formula_key IS NULL
            )
            OR (
                value_kind = 'ENABLED'
                AND option_key IS NULL
                AND expected_boolean IS NOT NULL
                AND comparator IS NULL
                AND comparison_formula_key IS NULL
            )
        )
);

CREATE INDEX ix_skill_trigger_istate_cond_state
    ON public.skill_trigger_rule_internal_state_conditions
    (game_id, skill_key, state_key, rule_key, group_key, condition_key);

CREATE INDEX ix_skill_trigger_istate_cond_option
    ON public.skill_trigger_rule_internal_state_conditions
    (game_id, skill_key, state_key, option_key, rule_key, group_key, condition_key);

CREATE INDEX ix_skill_trigger_istate_cond_formula
    ON public.skill_trigger_rule_internal_state_conditions
    (game_id, skill_key, comparison_formula_key, rule_key, group_key, condition_key);

COMMENT ON TABLE public.skill_trigger_rule_internal_state_conditions IS '技能触发规则内部状态检查条件明细';

CREATE TABLE public.skill_trigger_rule_event_value_conditions (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    condition_key varchar(64) NOT NULL,
    event_value_key varchar(32) NOT NULL,
    comparator varchar(8) NOT NULL,
    comparison_formula_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_event_value_conditions
        PRIMARY KEY (game_id, skill_key, rule_key, group_key, condition_key),
    CONSTRAINT fk_skill_trigger_event_value_cond_condition
        FOREIGN KEY (game_id, skill_key, rule_key, group_key, condition_key)
        REFERENCES public.skill_trigger_rule_conditions
            (game_id, skill_key, rule_key, group_key, condition_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_event_value_cond_formula
        FOREIGN KEY (game_id, skill_key, comparison_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT ck_skill_trigger_event_value_cond_key
        CHECK (event_value_key IN (
            'STEP_EXECUTION_INDEX', 'CHARGE_DURATION_MS', 'RECAST_COUNT',
            'HIT_INDEX', 'LIFECYCLE_STACKS', 'PERIOD_INDEX', 'REMAINING_MS',
            'STATE_BEFORE', 'STATE_AFTER',
            'ATTRIBUTE_BEFORE', 'ATTRIBUTE_AFTER', 'THRESHOLD_VALUE'
        )),
    CONSTRAINT ck_skill_trigger_event_value_cond_comparator
        CHECK (comparator IN ('LT', 'LTE', 'EQ', 'NE', 'GTE', 'GT'))
);

CREATE INDEX ix_skill_trigger_event_value_cond_formula
    ON public.skill_trigger_rule_event_value_conditions
    (game_id, skill_key, comparison_formula_key, rule_key, group_key, condition_key);

COMMENT ON TABLE public.skill_trigger_rule_event_value_conditions IS '技能触发规则事件值比较条件明细';

CREATE TABLE public.skill_trigger_rule_actions (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    action_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    action_type varchar(24) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    target_context varchar(24),
    CONSTRAINT pk_skill_trigger_rule_actions
        PRIMARY KEY (game_id, skill_key, rule_key, action_key),
    CONSTRAINT fk_skill_trigger_actions_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_skill_trigger_actions_key
        CHECK (action_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_trigger_actions_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_trigger_actions_type
        CHECK (action_type IN ('EXECUTE_EFFECT', 'START_PROCESS', 'FAIL_PROCESS')),
    CONSTRAINT ck_skill_trigger_actions_sort_order
        CHECK (sort_order >= 0 AND sort_order <= 999999),
    CONSTRAINT ck_skill_trigger_actions_target_context
        CHECK (
            (
                action_type IN ('EXECUTE_EFFECT', 'START_PROCESS')
                AND target_context IN ('CURRENT_TARGET', 'EVENT_SOURCE')
            )
            OR (
                action_type = 'FAIL_PROCESS'
                AND target_context IS NULL
            )
        )
);

CREATE INDEX ix_skill_trigger_actions_list
    ON public.skill_trigger_rule_actions
    (game_id, skill_key, rule_key, sort_order, action_key);

CREATE INDEX ix_skill_trigger_actions_type
    ON public.skill_trigger_rule_actions
    (game_id, skill_key, rule_key, action_type, action_key);

COMMENT ON TABLE public.skill_trigger_rule_actions IS '技能触发规则有序动作';

CREATE TABLE public.skill_trigger_rule_effect_actions (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    action_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_effect_actions
        PRIMARY KEY (game_id, skill_key, rule_key, action_key),
    CONSTRAINT fk_skill_trigger_effect_actions_action
        FOREIGN KEY (game_id, skill_key, rule_key, action_key)
        REFERENCES public.skill_trigger_rule_actions
            (game_id, skill_key, rule_key, action_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_effect_actions_effect
        FOREIGN KEY (game_id, skill_key, effect_key)
        REFERENCES public.skill_effects (game_id, skill_key, effect_key),
    CONSTRAINT uq_skill_trigger_effect_action_effect
        UNIQUE (game_id, skill_key, rule_key, action_key, effect_key)
);

CREATE INDEX ix_skill_trigger_effect_actions_effect
    ON public.skill_trigger_rule_effect_actions
    (game_id, skill_key, effect_key, rule_key, action_key);

COMMENT ON TABLE public.skill_trigger_rule_effect_actions IS '技能触发规则执行效果动作明细';

CREATE TABLE public.skill_trigger_rule_process_actions (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    action_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    failure_reason varchar(24),
    CONSTRAINT pk_skill_trigger_rule_process_actions
        PRIMARY KEY (game_id, skill_key, rule_key, action_key),
    CONSTRAINT fk_skill_trigger_process_actions_action
        FOREIGN KEY (game_id, skill_key, rule_key, action_key)
        REFERENCES public.skill_trigger_rule_actions
            (game_id, skill_key, rule_key, action_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_process_actions_process
        FOREIGN KEY (game_id, skill_key, process_key)
        REFERENCES public.skill_processes (game_id, skill_key, process_key),
    CONSTRAINT ck_skill_trigger_process_actions_failure
        CHECK (
            failure_reason IS NULL
            OR failure_reason IN (
                'CONTROLLED', 'SOURCE_DIED', 'TARGET_UNTARGETABLE',
                'ACTIVE_CANCELLED', 'EVENT_ABORTED'
            )
        )
);

CREATE INDEX ix_skill_trigger_process_actions_process
    ON public.skill_trigger_rule_process_actions
    (game_id, skill_key, process_key, rule_key, action_key);

COMMENT ON TABLE public.skill_trigger_rule_process_actions IS '技能触发规则启动或令过程失败动作明细';

CREATE TABLE public.skill_trigger_rule_runtime_input_bindings (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    action_key varchar(64) NOT NULL,
    binding_key varchar(64) NOT NULL,
    parameter_key varchar(64) NOT NULL,
    source_type varchar(24) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_runtime_input_bindings
        PRIMARY KEY (game_id, skill_key, rule_key, action_key, binding_key),
    CONSTRAINT fk_skill_trigger_runtime_bindings_action
        FOREIGN KEY (game_id, skill_key, rule_key, action_key)
        REFERENCES public.skill_trigger_rule_actions
            (game_id, skill_key, rule_key, action_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_runtime_bindings_parameter
        FOREIGN KEY (game_id, skill_key, parameter_key)
        REFERENCES public.skill_parameters (game_id, skill_key, parameter_key),
    CONSTRAINT uq_skill_trigger_runtime_bindings_parameter
        UNIQUE (game_id, skill_key, rule_key, action_key, parameter_key),
    CONSTRAINT ck_skill_trigger_runtime_bindings_key
        CHECK (binding_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_trigger_runtime_bindings_source_type
        CHECK (source_type IN (
            'INTERNAL_STATE', 'COMBAT_STATUS', 'EVENT_VALUE', 'PRIOR_ACTION_RESULT'
        ))
);

CREATE INDEX ix_skill_trigger_runtime_bindings_parameter
    ON public.skill_trigger_rule_runtime_input_bindings
    (game_id, skill_key, parameter_key, rule_key, action_key, binding_key);

COMMENT ON TABLE public.skill_trigger_rule_runtime_input_bindings IS '技能触发规则动态输入来源绑定';

CREATE TABLE public.skill_trigger_rule_internal_state_bindings (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    action_key varchar(64) NOT NULL,
    binding_key varchar(64) NOT NULL,
    state_key varchar(64) NOT NULL,
    value_kind varchar(24) NOT NULL,
    option_key varchar(64),
    CONSTRAINT pk_skill_trigger_rule_internal_state_bindings
        PRIMARY KEY (game_id, skill_key, rule_key, action_key, binding_key),
    CONSTRAINT fk_skill_trigger_istate_bind_binding
        FOREIGN KEY (game_id, skill_key, rule_key, action_key, binding_key)
        REFERENCES public.skill_trigger_rule_runtime_input_bindings
            (game_id, skill_key, rule_key, action_key, binding_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_istate_bind_state
        FOREIGN KEY (game_id, skill_key, state_key)
        REFERENCES public.skill_internal_states (game_id, skill_key, state_key),
    CONSTRAINT fk_skill_trigger_istate_bind_option
        FOREIGN KEY (game_id, skill_key, state_key, option_key)
        REFERENCES public.skill_internal_state_mode_options
            (game_id, skill_key, state_key, option_key)
        MATCH SIMPLE,
    CONSTRAINT ck_skill_trigger_istate_bind_value_kind
        CHECK (value_kind IN ('VALUE', 'OPTION_SELECTED', 'ENABLED', 'REMAINING_MS')),
    CONSTRAINT ck_skill_trigger_istate_bind_shape
        CHECK (
            (
                value_kind = 'OPTION_SELECTED'
                AND option_key IS NOT NULL
            )
            OR (
                value_kind IN ('VALUE', 'ENABLED', 'REMAINING_MS')
                AND option_key IS NULL
            )
        )
);

CREATE INDEX ix_skill_trigger_istate_bind_state
    ON public.skill_trigger_rule_internal_state_bindings
    (game_id, skill_key, state_key, rule_key, action_key, binding_key);

CREATE INDEX ix_skill_trigger_istate_bind_option
    ON public.skill_trigger_rule_internal_state_bindings
    (game_id, skill_key, state_key, option_key, rule_key, action_key, binding_key);

COMMENT ON TABLE public.skill_trigger_rule_internal_state_bindings IS '技能触发规则内部状态动态输入来源明细';

CREATE TABLE public.skill_trigger_rule_combat_status_bindings (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    action_key varchar(64) NOT NULL,
    binding_key varchar(64) NOT NULL,
    subject varchar(24) NOT NULL,
    status_key varchar(64) NOT NULL,
    value_kind varchar(24) NOT NULL,
    source_effect_key varchar(64),
    source_result_key varchar(64),
    CONSTRAINT pk_skill_trigger_rule_combat_status_bindings
        PRIMARY KEY (game_id, skill_key, rule_key, action_key, binding_key),
    CONSTRAINT fk_skill_trigger_combat_status_bind_binding
        FOREIGN KEY (game_id, skill_key, rule_key, action_key, binding_key)
        REFERENCES public.skill_trigger_rule_runtime_input_bindings
            (game_id, skill_key, rule_key, action_key, binding_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_combat_status_bind_status
        FOREIGN KEY (game_id, status_key)
        REFERENCES public.statuses (game_id, status_key),
    CONSTRAINT fk_skill_trigger_combat_status_bind_result
        FOREIGN KEY (game_id, skill_key, source_effect_key, source_result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        MATCH SIMPLE,
    CONSTRAINT ck_skill_trigger_combat_status_bind_subject
        CHECK (subject IN ('SOURCE', 'CURRENT_TARGET', 'EVENT_SOURCE')),
    CONSTRAINT ck_skill_trigger_combat_status_bind_value_kind
        CHECK (value_kind IN ('PRESENT', 'STACKS', 'REMAINING_MS')),
    CONSTRAINT ck_skill_trigger_combat_status_bind_shape
        CHECK (
            (
                value_kind = 'PRESENT'
                AND source_effect_key IS NULL
                AND source_result_key IS NULL
            )
            OR (
                value_kind IN ('STACKS', 'REMAINING_MS')
                AND source_effect_key IS NOT NULL
                AND source_result_key IS NOT NULL
            )
        )
);

CREATE INDEX ix_skill_trigger_combat_status_bind_status
    ON public.skill_trigger_rule_combat_status_bindings
    (game_id, status_key, skill_key, rule_key, action_key, binding_key);

CREATE INDEX ix_skill_trigger_combat_status_bind_source_result
    ON public.skill_trigger_rule_combat_status_bindings
    (game_id, skill_key, source_effect_key, source_result_key, rule_key, action_key, binding_key);

COMMENT ON TABLE public.skill_trigger_rule_combat_status_bindings IS '技能触发规则战斗状态动态输入来源明细';

CREATE TABLE public.skill_trigger_rule_event_value_bindings (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    action_key varchar(64) NOT NULL,
    binding_key varchar(64) NOT NULL,
    event_value_key varchar(32) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_event_value_bindings
        PRIMARY KEY (game_id, skill_key, rule_key, action_key, binding_key),
    CONSTRAINT fk_skill_trigger_event_value_bind_binding
        FOREIGN KEY (game_id, skill_key, rule_key, action_key, binding_key)
        REFERENCES public.skill_trigger_rule_runtime_input_bindings
            (game_id, skill_key, rule_key, action_key, binding_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_skill_trigger_event_value_bind_key
        CHECK (event_value_key IN (
            'STEP_EXECUTION_INDEX', 'CHARGE_DURATION_MS', 'RECAST_COUNT',
            'HIT_INDEX', 'LIFECYCLE_STACKS', 'PERIOD_INDEX', 'REMAINING_MS',
            'STATE_BEFORE', 'STATE_AFTER',
            'ATTRIBUTE_BEFORE', 'ATTRIBUTE_AFTER', 'THRESHOLD_VALUE'
        ))
);

COMMENT ON TABLE public.skill_trigger_rule_event_value_bindings IS '技能触发规则事件值动态输入来源明细';

CREATE TABLE public.skill_trigger_rule_prior_result_bindings (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    action_key varchar(64) NOT NULL,
    binding_key varchar(64) NOT NULL,
    source_action_key varchar(64) NOT NULL,
    source_effect_key varchar(64) NOT NULL,
    source_result_key varchar(64) NOT NULL,
    output_kind varchar(24) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_prior_result_bindings
        PRIMARY KEY (game_id, skill_key, rule_key, action_key, binding_key),
    CONSTRAINT fk_skill_trigger_prior_result_bind_binding
        FOREIGN KEY (game_id, skill_key, rule_key, action_key, binding_key)
        REFERENCES public.skill_trigger_rule_runtime_input_bindings
            (game_id, skill_key, rule_key, action_key, binding_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_prior_result_bind_source_action
        FOREIGN KEY (game_id, skill_key, rule_key, source_action_key, source_effect_key)
        REFERENCES public.skill_trigger_rule_effect_actions
            (game_id, skill_key, rule_key, action_key, effect_key)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT fk_skill_trigger_prior_result_bind_result
        FOREIGN KEY (game_id, skill_key, source_effect_key, source_result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT ck_skill_trigger_prior_result_bind_output
        CHECK (output_kind = 'CONFIGURED_VALUE')
);

CREATE INDEX ix_skill_trigger_prior_result_bind_source_action
    ON public.skill_trigger_rule_prior_result_bindings
    (game_id, skill_key, rule_key, source_action_key, action_key, binding_key);

CREATE INDEX ix_skill_trigger_prior_result_bind_result
    ON public.skill_trigger_rule_prior_result_bindings
    (game_id, skill_key, source_effect_key, source_result_key, rule_key, action_key, binding_key);

COMMENT ON TABLE public.skill_trigger_rule_prior_result_bindings IS '技能触发规则前序动作基础结果动态输入来源明细';

CREATE TABLE public.skill_trigger_rule_result_modifiers (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    action_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    fixed_multiplier numeric,
    fixed_min_value numeric,
    fixed_max_value numeric,
    CONSTRAINT pk_skill_trigger_rule_result_modifiers
        PRIMARY KEY (game_id, skill_key, rule_key, action_key, result_key),
    CONSTRAINT fk_skill_trigger_result_modifiers_action
        FOREIGN KEY (game_id, skill_key, rule_key, action_key)
        REFERENCES public.skill_trigger_rule_actions
            (game_id, skill_key, rule_key, action_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_result_modifiers_effect_action
        FOREIGN KEY (game_id, skill_key, rule_key, action_key, effect_key)
        REFERENCES public.skill_trigger_rule_effect_actions
            (game_id, skill_key, rule_key, action_key, effect_key),
    CONSTRAINT fk_skill_trigger_result_modifiers_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key),
    CONSTRAINT ck_skill_trigger_result_modifiers_present
        CHECK (
            fixed_multiplier IS NOT NULL
            OR fixed_min_value IS NOT NULL
            OR fixed_max_value IS NOT NULL
        ),
    CONSTRAINT ck_skill_trigger_result_modifiers_multiplier
        CHECK (fixed_multiplier IS NULL OR fixed_multiplier >= 0),
    CONSTRAINT ck_skill_trigger_result_modifiers_bounds
        CHECK (
            fixed_min_value IS NULL
            OR fixed_max_value IS NULL
            OR fixed_min_value <= fixed_max_value
        )
);

CREATE INDEX ix_skill_trigger_result_modifiers_result
    ON public.skill_trigger_rule_result_modifiers
    (game_id, skill_key, effect_key, result_key, rule_key, action_key);

COMMENT ON TABLE public.skill_trigger_rule_result_modifiers IS '技能触发规则执行效果固定结果修正';

CREATE TABLE public.skill_trigger_rule_per_target_cooldowns (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    duration_formula_key varchar(64) NOT NULL,
    target_context varchar(24) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_per_target_cooldowns
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_per_target_cd_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_per_target_cd_formula
        FOREIGN KEY (game_id, skill_key, duration_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT ck_skill_trigger_per_target_cd_target
        CHECK (target_context IN ('CURRENT_TARGET', 'EVENT_SOURCE'))
);

CREATE INDEX ix_skill_trigger_per_target_cd_formula
    ON public.skill_trigger_rule_per_target_cooldowns
    (game_id, skill_key, duration_formula_key, rule_key);

COMMENT ON TABLE public.skill_trigger_rule_per_target_cooldowns IS '技能触发规则每目标冷却';

CREATE TABLE public.skill_trigger_rule_process_limits (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    limit_formula_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_process_limits
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_process_limits_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_process_limits_process
        FOREIGN KEY (game_id, skill_key, process_key)
        REFERENCES public.skill_processes (game_id, skill_key, process_key),
    CONSTRAINT fk_skill_trigger_process_limit_formula
        FOREIGN KEY (game_id, skill_key, limit_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
);

CREATE INDEX ix_skill_trigger_process_limits_process
    ON public.skill_trigger_rule_process_limits
    (game_id, skill_key, process_key, rule_key);

CREATE INDEX ix_skill_trigger_process_limits_formula
    ON public.skill_trigger_rule_process_limits
    (game_id, skill_key, limit_formula_key, rule_key);

COMMENT ON TABLE public.skill_trigger_rule_process_limits IS '技能触发规则单次过程最大触发次数';

-- -----------------------------------------------------------------------------


    END IF;
END;
$condition_event_dynamic_input_mig$;
-- skill_trigger_rules：事务提交时必须满足事件、条件、动作、绑定与保护完整形状
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_skill_trigger_rule_complete_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_game_id varchar(64);
    v_skill_key varchar(64);
    v_skill_trigger_rule_key varchar(64);
    v_event_type varchar(32);
    v_process_event_count int;
    v_skill_event_count int;
    v_result_event_count int;
    v_lifecycle_event_count int;
    v_status_event_count int;
    v_health_event_count int;
    v_istate_event_count int;
    v_subject_event_count int;
    v_action_count int;
    v_fail_count int;
    v_group record;
    v_condition record;
    v_action record;
    v_binding record;
    v_modifier record;
    v_process_event record;
    v_skill_event record;
    v_result_event record;
    v_lifecycle_event record;
    v_istate_event record;
    v_process_limit record;
    v_prior record;
    v_source_action record;
    v_lifecycle record;
    v_state_type varchar(24);
    v_step_type varchar(32);
    v_has_value int;
    v_behavior_moment varchar(24);
    v_status_op varchar(16);
    v_status_key varchar(64);
    v_expected_detail int;
    v_attr_count int;
    v_status_count int;
    v_istate_cond_count int;
    v_event_value_count int;
    v_effect_action_count int;
    v_process_action_count int;
    v_istate_bind_count int;
    v_combat_bind_count int;
    v_event_bind_count int;
    v_prior_bind_count int;
    v_last_action_key varchar(64);
    v_last_action_type varchar(24);
BEGIN
    IF TG_TABLE_NAME = 'skill_trigger_rules' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        v_game_id := NEW.game_id;
        v_skill_key := NEW.skill_key;
        v_skill_trigger_rule_key := NEW.rule_key;
    ELSE
        v_game_id := COALESCE(NEW.game_id, OLD.game_id);
        v_skill_key := COALESCE(NEW.skill_key, OLD.skill_key);
        v_skill_trigger_rule_key := COALESCE(NEW.rule_key, OLD.rule_key);
    END IF;

    SELECT event_type
    INTO v_event_type
    FROM public.skill_trigger_rules
    WHERE game_id = v_game_id
      AND skill_key = v_skill_key
      AND rule_key = v_skill_trigger_rule_key;
    IF v_event_type IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    SELECT COUNT(*) INTO v_process_event_count
    FROM public.skill_trigger_rule_process_events
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
    SELECT COUNT(*) INTO v_skill_event_count
    FROM public.skill_trigger_rule_skill_events
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
    SELECT COUNT(*) INTO v_result_event_count
    FROM public.skill_trigger_rule_result_events
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
    SELECT COUNT(*) INTO v_lifecycle_event_count
    FROM public.skill_trigger_rule_lifecycle_events
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
    SELECT COUNT(*) INTO v_status_event_count
    FROM public.skill_trigger_rule_status_events
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
    SELECT COUNT(*) INTO v_health_event_count
    FROM public.skill_trigger_rule_health_threshold_events
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
    SELECT COUNT(*) INTO v_istate_event_count
    FROM public.skill_trigger_rule_internal_state_events
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
    SELECT COUNT(*) INTO v_subject_event_count
    FROM public.skill_trigger_rule_subject_events
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;

    v_expected_detail := CASE
        WHEN v_event_type IN ('PROCESS_MOMENT', 'PROCESS_CANCEL_REQUESTED') THEN
            CASE WHEN v_process_event_count = 1
                AND v_skill_event_count + v_result_event_count + v_lifecycle_event_count
                    + v_status_event_count + v_health_event_count + v_istate_event_count
                    + v_subject_event_count = 0
            THEN 1 ELSE 0 END
        WHEN v_event_type IN ('SKILL_USED', 'SKILL_HIT') THEN
            CASE WHEN v_skill_event_count = 1
                AND v_process_event_count + v_result_event_count + v_lifecycle_event_count
                    + v_status_event_count + v_health_event_count + v_istate_event_count
                    + v_subject_event_count = 0
            THEN 1 ELSE 0 END
        WHEN v_event_type = 'RESULT_AVAILABLE' THEN
            CASE WHEN v_result_event_count = 1
                AND v_process_event_count + v_skill_event_count + v_lifecycle_event_count
                    + v_status_event_count + v_health_event_count + v_istate_event_count
                    + v_subject_event_count = 0
            THEN 1 ELSE 0 END
        WHEN v_event_type = 'LIFECYCLE_MOMENT' THEN
            CASE WHEN v_lifecycle_event_count = 1
                AND v_process_event_count + v_skill_event_count + v_result_event_count
                    + v_status_event_count + v_health_event_count + v_istate_event_count
                    + v_subject_event_count = 0
            THEN 1 ELSE 0 END
        WHEN v_event_type = 'STATUS_CHANGED' THEN
            CASE WHEN v_status_event_count = 1
                AND v_process_event_count + v_skill_event_count + v_result_event_count
                    + v_lifecycle_event_count + v_health_event_count + v_istate_event_count
                    + v_subject_event_count = 0
            THEN 1 ELSE 0 END
        WHEN v_event_type = 'HEALTH_THRESHOLD_CROSSED' THEN
            CASE WHEN v_health_event_count = 1
                AND v_process_event_count + v_skill_event_count + v_result_event_count
                    + v_lifecycle_event_count + v_status_event_count + v_istate_event_count
                    + v_subject_event_count = 0
            THEN 1 ELSE 0 END
        WHEN v_event_type = 'INTERNAL_STATE_CHANGED' THEN
            CASE WHEN v_istate_event_count = 1
                AND v_process_event_count + v_skill_event_count + v_result_event_count
                    + v_lifecycle_event_count + v_status_event_count + v_health_event_count
                    + v_subject_event_count = 0
            THEN 1 ELSE 0 END
        WHEN v_event_type IN ('ENTITY_DIED', 'ENTITY_UNTARGETABLE') THEN
            CASE WHEN v_subject_event_count = 1
                AND v_process_event_count + v_skill_event_count + v_result_event_count
                    + v_lifecycle_event_count + v_status_event_count + v_health_event_count
                    + v_istate_event_count = 0
            THEN 1 ELSE 0 END
        ELSE
            CASE WHEN v_process_event_count + v_skill_event_count + v_result_event_count
                    + v_lifecycle_event_count + v_status_event_count + v_health_event_count
                    + v_istate_event_count + v_subject_event_count = 0
            THEN 1 ELSE 0 END
    END;

    IF v_expected_detail = 0 THEN
        RAISE EXCEPTION
            'skill_trigger_rules(%, %, %) event detail shape invalid at commit',
            v_game_id, v_skill_key, v_skill_trigger_rule_key
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_event_type = 'PROCESS_MOMENT' THEN
        SELECT * INTO v_process_event
        FROM public.skill_trigger_rule_process_events
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
        IF v_process_event.moment_type IS NULL THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) PROCESS_MOMENT requires process moment at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_process_event.moment_type = 'STEP_TIMEOUT' THEN
            SELECT step_type INTO v_step_type
            FROM public.skill_process_steps
            WHERE game_id = v_game_id AND skill_key = v_skill_key
              AND process_key = v_process_event.process_key
              AND step_key = v_process_event.step_key;
            IF v_step_type IS NULL OR v_step_type NOT IN ('CHARGE', 'RECAST', 'EMPOWERED_BASIC_ATTACK') THEN
                RAISE EXCEPTION
                    'skill_trigger_rules(%, %, %) STEP_TIMEOUT only references timeout-capable steps at commit',
                    v_game_id, v_skill_key, v_skill_trigger_rule_key
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    ELSIF v_event_type = 'PROCESS_CANCEL_REQUESTED' THEN
        SELECT * INTO v_process_event
        FROM public.skill_trigger_rule_process_events
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
        IF v_process_event.moment_type IS NOT NULL OR v_process_event.step_key IS NOT NULL THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) PROCESS_CANCEL_REQUESTED moment fields must be empty at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_event_type = 'SKILL_USED' THEN
        SELECT * INTO v_skill_event
        FROM public.skill_trigger_rule_skill_events
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
        IF v_skill_event.use_kind IS NULL THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) SKILL_USED requires use_kind at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_event_type = 'SKILL_HIT' THEN
        SELECT * INTO v_skill_event
        FROM public.skill_trigger_rule_skill_events
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
        IF v_skill_event.use_kind IS NOT NULL THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) SKILL_HIT must not provide use_kind at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_event_type = 'RESULT_AVAILABLE' THEN
        SELECT * INTO v_result_event
        FROM public.skill_trigger_rule_result_events
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
        IF EXISTS (
            SELECT 1 FROM public.skill_effect_lifecycles
            WHERE game_id = v_game_id AND skill_key = v_skill_key
              AND effect_key = v_result_event.effect_key
        ) THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) RESULT_AVAILABLE requires no lifecycle at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_event_type = 'LIFECYCLE_MOMENT' THEN
        SELECT * INTO v_lifecycle_event
        FROM public.skill_trigger_rule_lifecycle_events
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
        IF v_lifecycle_event.lifecycle_moment = 'PERSISTENT' THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) LIFECYCLE_MOMENT PERSISTENT is not allowed at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT * INTO v_lifecycle
        FROM public.skill_effect_lifecycles
        WHERE game_id = v_game_id AND skill_key = v_skill_key
          AND effect_key = v_lifecycle_event.effect_key;
        IF NOT FOUND THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) LIFECYCLE_MOMENT requires lifecycle at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_lifecycle_event.lifecycle_moment = 'PERIODIC'
            AND v_lifecycle.periodic_interval_formula_key IS NULL THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) PERIODIC requires periodic interval at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_lifecycle_event.lifecycle_moment = 'NATURAL_END'
            AND (v_lifecycle.duration_formula_key IS NULL OR v_lifecycle.expiry_mode = 'EXPLICIT_ONLY') THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) NATURAL_END requires duration and non-explicit expiry at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_event_type = 'INTERNAL_STATE_CHANGED' THEN
        SELECT * INTO v_istate_event
        FROM public.skill_trigger_rule_internal_state_events
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
        SELECT state_type INTO v_state_type
        FROM public.skill_internal_states
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND state_key = v_istate_event.state_key;
        IF v_istate_event.change_kind = 'VALUE_CHANGED' AND v_state_type NOT IN ('COUNTER', 'AMMO') THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) internal state change_kind does not match state type at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        ELSIF v_istate_event.change_kind = 'OPTION_SELECTED' AND v_state_type <> 'MODE' THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) internal state change_kind does not match state type at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        ELSIF v_istate_event.change_kind = 'FLAG_CHANGED' AND v_state_type <> 'FLAG' THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) internal state change_kind does not match state type at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        ELSIF v_istate_event.change_kind = 'COOLDOWN_READY' AND v_state_type <> 'INTERNAL_COOLDOWN' THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) internal state change_kind does not match state type at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    FOR v_group IN
        SELECT group_key
        FROM public.skill_trigger_rule_condition_groups
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.skill_trigger_rule_conditions
            WHERE game_id = v_game_id AND skill_key = v_skill_key
              AND rule_key = v_skill_trigger_rule_key AND group_key = v_group.group_key
        ) THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) empty condition group at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;

    FOR v_condition IN
        SELECT *
        FROM public.skill_trigger_rule_conditions
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
    LOOP
        SELECT COUNT(*) INTO v_attr_count
        FROM public.skill_trigger_rule_attribute_conditions
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
          AND group_key = v_condition.group_key AND condition_key = v_condition.condition_key;
        SELECT COUNT(*) INTO v_status_count
        FROM public.skill_trigger_rule_status_conditions
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
          AND group_key = v_condition.group_key AND condition_key = v_condition.condition_key;
        SELECT COUNT(*) INTO v_istate_cond_count
        FROM public.skill_trigger_rule_internal_state_conditions
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
          AND group_key = v_condition.group_key AND condition_key = v_condition.condition_key;
        SELECT COUNT(*) INTO v_event_value_count
        FROM public.skill_trigger_rule_event_value_conditions
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
          AND group_key = v_condition.group_key AND condition_key = v_condition.condition_key;
        IF (v_condition.condition_type = 'ATTRIBUTE_COMPARE' AND NOT (v_attr_count = 1 AND v_status_count + v_istate_cond_count + v_event_value_count = 0))
            OR (v_condition.condition_type = 'STATUS_CHECK' AND NOT (v_status_count = 1 AND v_attr_count + v_istate_cond_count + v_event_value_count = 0))
            OR (v_condition.condition_type = 'INTERNAL_STATE_CHECK' AND NOT (v_istate_cond_count = 1 AND v_attr_count + v_status_count + v_event_value_count = 0))
            OR (v_condition.condition_type = 'EVENT_VALUE_COMPARE' AND NOT (v_event_value_count = 1 AND v_attr_count + v_status_count + v_istate_cond_count = 0))
        THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) condition detail shape invalid at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_condition.condition_type = 'STATUS_CHECK' THEN
            PERFORM 1
            FROM public.skill_trigger_rule_status_conditions c
            WHERE c.game_id = v_game_id AND c.skill_key = v_skill_key
              AND c.rule_key = v_skill_trigger_rule_key
              AND c.group_key = v_condition.group_key
              AND c.condition_key = v_condition.condition_key
              AND c.check_kind IN ('STACKS_COMPARE', 'REMAINING_MS_COMPARE');
            IF FOUND THEN
                SELECT b.moment, d.operation, d.status_key
                INTO v_behavior_moment, v_status_op, v_status_key
                FROM public.skill_trigger_rule_status_conditions c
                JOIN public.skill_effect_result_lifecycle_behaviors b
                  ON b.game_id = c.game_id AND c.skill_key = b.skill_key
                 AND b.effect_key = c.source_effect_key AND b.result_key = c.source_result_key
                JOIN public.skill_effect_status_operation_details d
                  ON d.game_id = c.game_id AND d.skill_key = c.skill_key
                 AND d.effect_key = c.source_effect_key AND d.result_key = c.source_result_key
                WHERE c.game_id = v_game_id AND c.skill_key = v_skill_key
                  AND c.rule_key = v_skill_trigger_rule_key
                  AND c.group_key = v_condition.group_key
                  AND c.condition_key = v_condition.condition_key;
                IF v_behavior_moment IS DISTINCT FROM 'PERSISTENT'
                    OR v_status_op IS DISTINCT FROM 'APPLY'
                    OR v_status_key IS NULL THEN
                    RAISE EXCEPTION
                        'skill_trigger_rules(%, %, %) status source result must be PERSISTENT STATUS_OPERATION APPLY at commit',
                        v_game_id, v_skill_key, v_skill_trigger_rule_key
                        USING ERRCODE = 'check_violation';
                END IF;
            END IF;
        END IF;
    END LOOP;

    SELECT COUNT(*) INTO v_action_count
    FROM public.skill_trigger_rule_actions
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
    IF v_action_count = 0 THEN
        RAISE EXCEPTION
            'skill_trigger_rules(%, %, %) missing action at commit',
            v_game_id, v_skill_key, v_skill_trigger_rule_key
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT COUNT(*) INTO v_fail_count
    FROM public.skill_trigger_rule_actions
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
      AND action_type = 'FAIL_PROCESS';
    IF v_fail_count > 1 THEN
        RAISE EXCEPTION
            'skill_trigger_rules(%, %, %) FAIL_PROCESS must be last at commit',
            v_game_id, v_skill_key, v_skill_trigger_rule_key
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT action_key, action_type
    INTO v_last_action_key, v_last_action_type
    FROM public.skill_trigger_rule_actions
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
    ORDER BY sort_order ASC, action_key ASC
    OFFSET v_action_count - 1;
    IF v_fail_count = 1 AND v_last_action_type <> 'FAIL_PROCESS' THEN
        RAISE EXCEPTION
            'skill_trigger_rules(%, %, %) FAIL_PROCESS must be last at commit',
            v_game_id, v_skill_key, v_skill_trigger_rule_key
            USING ERRCODE = 'check_violation';
    END IF;

    FOR v_action IN
        SELECT *
        FROM public.skill_trigger_rule_actions
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
    LOOP
        SELECT COUNT(*) INTO v_effect_action_count
        FROM public.skill_trigger_rule_effect_actions
        WHERE game_id = v_game_id AND skill_key = v_skill_key
          AND rule_key = v_skill_trigger_rule_key AND action_key = v_action.action_key;
        SELECT COUNT(*) INTO v_process_action_count
        FROM public.skill_trigger_rule_process_actions
        WHERE game_id = v_game_id AND skill_key = v_skill_key
          AND rule_key = v_skill_trigger_rule_key AND action_key = v_action.action_key;
        IF (v_action.action_type = 'EXECUTE_EFFECT' AND NOT (v_effect_action_count = 1 AND v_process_action_count = 0))
            OR (v_action.action_type IN ('START_PROCESS', 'FAIL_PROCESS')
                AND NOT (v_process_action_count = 1 AND v_effect_action_count = 0))
        THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) action detail shape invalid at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_action.action_type = 'START_PROCESS' THEN
            IF EXISTS (
                SELECT 1 FROM public.skill_trigger_rule_process_actions
                WHERE game_id = v_game_id AND skill_key = v_skill_key
                  AND rule_key = v_skill_trigger_rule_key AND action_key = v_action.action_key
                  AND failure_reason IS NOT NULL
            ) THEN
                RAISE EXCEPTION
                    'skill_trigger_rules(%, %, %) START_PROCESS failure_reason must be empty at commit',
                    v_game_id, v_skill_key, v_skill_trigger_rule_key
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSIF v_action.action_type = 'FAIL_PROCESS' THEN
            IF EXISTS (
                SELECT 1 FROM public.skill_trigger_rule_process_actions
                WHERE game_id = v_game_id AND skill_key = v_skill_key
                  AND rule_key = v_skill_trigger_rule_key AND action_key = v_action.action_key
                  AND failure_reason IS NULL
            ) THEN
                RAISE EXCEPTION
                    'skill_trigger_rules(%, %, %) FAIL_PROCESS requires failure_reason at commit',
                    v_game_id, v_skill_key, v_skill_trigger_rule_key
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END LOOP;

    FOR v_binding IN
        SELECT *
        FROM public.skill_trigger_rule_runtime_input_bindings
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
    LOOP
        SELECT COUNT(*) INTO v_istate_bind_count
        FROM public.skill_trigger_rule_internal_state_bindings
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
          AND action_key = v_binding.action_key AND binding_key = v_binding.binding_key;
        SELECT COUNT(*) INTO v_combat_bind_count
        FROM public.skill_trigger_rule_combat_status_bindings
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
          AND action_key = v_binding.action_key AND binding_key = v_binding.binding_key;
        SELECT COUNT(*) INTO v_event_bind_count
        FROM public.skill_trigger_rule_event_value_bindings
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
          AND action_key = v_binding.action_key AND binding_key = v_binding.binding_key;
        SELECT COUNT(*) INTO v_prior_bind_count
        FROM public.skill_trigger_rule_prior_result_bindings
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
          AND action_key = v_binding.action_key AND binding_key = v_binding.binding_key;
        IF (v_binding.source_type = 'INTERNAL_STATE' AND NOT (v_istate_bind_count = 1 AND v_combat_bind_count + v_event_bind_count + v_prior_bind_count = 0))
            OR (v_binding.source_type = 'COMBAT_STATUS' AND NOT (v_combat_bind_count = 1 AND v_istate_bind_count + v_event_bind_count + v_prior_bind_count = 0))
            OR (v_binding.source_type = 'EVENT_VALUE' AND NOT (v_event_bind_count = 1 AND v_istate_bind_count + v_combat_bind_count + v_prior_bind_count = 0))
            OR (v_binding.source_type = 'PRIOR_ACTION_RESULT' AND NOT (v_prior_bind_count = 1 AND v_istate_bind_count + v_combat_bind_count + v_event_bind_count = 0))
        THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) binding source detail shape invalid at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_binding.source_type = 'PRIOR_ACTION_RESULT' THEN
            SELECT * INTO v_prior
            FROM public.skill_trigger_rule_prior_result_bindings
            WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
              AND action_key = v_binding.action_key AND binding_key = v_binding.binding_key;
            SELECT a.action_type, a.sort_order, a.action_key, e.effect_key
            INTO v_source_action
            FROM public.skill_trigger_rule_actions a
            LEFT JOIN public.skill_trigger_rule_effect_actions e
              ON e.game_id = a.game_id AND e.skill_key = a.skill_key
             AND e.rule_key = a.rule_key AND e.action_key = a.action_key
            WHERE a.game_id = v_game_id AND a.skill_key = v_skill_key
              AND a.rule_key = v_skill_trigger_rule_key
              AND a.action_key = v_prior.source_action_key;
            SELECT a.sort_order, a.action_key
            INTO v_action
            FROM public.skill_trigger_rule_actions a
            WHERE a.game_id = v_game_id AND a.skill_key = v_skill_key
              AND a.rule_key = v_skill_trigger_rule_key
              AND a.action_key = v_binding.action_key;
            IF v_source_action.action_type IS DISTINCT FROM 'EXECUTE_EFFECT' THEN
                RAISE EXCEPTION
                    'skill_trigger_rules(%, %, %) prior action is not EXECUTE_EFFECT at commit',
                    v_game_id, v_skill_key, v_skill_trigger_rule_key
                    USING ERRCODE = 'check_violation';
            END IF;
            IF v_source_action.effect_key IS DISTINCT FROM v_prior.source_effect_key THEN
                RAISE EXCEPTION
                    'skill_trigger_rules(%, %, %) prior source_effect_key mismatch at commit',
                    v_game_id, v_skill_key, v_skill_trigger_rule_key
                    USING ERRCODE = 'check_violation';
            END IF;
            IF (v_source_action.sort_order, v_source_action.action_key)
                >= (v_action.sort_order, v_action.action_key) THEN
                RAISE EXCEPTION
                    'skill_trigger_rules(%, %, %) prior action is not earlier at commit',
                    v_game_id, v_skill_key, v_skill_trigger_rule_key
                    USING ERRCODE = 'check_violation';
            END IF;
            SELECT COUNT(*) INTO v_has_value
            FROM public.skill_effect_result_values
            WHERE game_id = v_game_id AND skill_key = v_skill_key
              AND effect_key = v_prior.source_effect_key
              AND result_key = v_prior.source_result_key;
            IF v_has_value = 0 THEN
                RAISE EXCEPTION
                    'skill_trigger_rules(%, %, %) prior action result is not immediately available at commit',
                    v_game_id, v_skill_key, v_skill_trigger_rule_key
                    USING ERRCODE = 'check_violation';
            END IF;
            SELECT moment INTO v_behavior_moment
            FROM public.skill_effect_result_lifecycle_behaviors
            WHERE game_id = v_game_id AND skill_key = v_skill_key
              AND effect_key = v_prior.source_effect_key
              AND result_key = v_prior.source_result_key;
            IF FOUND AND v_behavior_moment IS DISTINCT FROM 'APPLICATION' THEN
                RAISE EXCEPTION
                    'skill_trigger_rules(%, %, %) prior action result is not immediately available at commit',
                    v_game_id, v_skill_key, v_skill_trigger_rule_key
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END LOOP;

    FOR v_modifier IN
        SELECT *
        FROM public.skill_trigger_rule_result_modifiers
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.skill_trigger_rule_actions
            WHERE game_id = v_game_id AND skill_key = v_skill_key
              AND rule_key = v_skill_trigger_rule_key AND action_key = v_modifier.action_key
              AND action_type = 'EXECUTE_EFFECT'
        ) THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) result modifier target invalid at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT COUNT(*) INTO v_has_value
        FROM public.skill_effect_result_values
        WHERE game_id = v_game_id AND skill_key = v_skill_key
          AND effect_key = v_modifier.effect_key AND result_key = v_modifier.result_key;
        IF v_has_value = 0 THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) result modifier target invalid at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;

    SELECT * INTO v_process_limit
    FROM public.skill_trigger_rule_process_limits
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
    IF FOUND THEN
        IF v_event_type <> 'PROCESS_MOMENT' THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) process limit requires matching PROCESS_MOMENT at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT * INTO v_process_event
        FROM public.skill_trigger_rule_process_events
        WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
        IF v_process_event.process_key IS DISTINCT FROM v_process_limit.process_key THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) process limit requires matching PROCESS_MOMENT at commit',
                v_game_id, v_skill_key, v_skill_trigger_rule_key
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.trg_skill_trigger_rule_complete_shape() IS
    'deferred：保证每个技能触发规则在提交时事件、条件、动作、绑定与保护形状合法';

DROP TRIGGER IF EXISTS trg_skill_trigger_rules_complete_shape
    ON public.skill_trigger_rules;
CREATE CONSTRAINT TRIGGER trg_skill_trigger_rules_complete_shape
AFTER INSERT OR UPDATE ON public.skill_trigger_rules
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_skill_trigger_rule_complete_shape();

DO $$
DECLARE
    v_detail text;
    v_details text[] := ARRAY[
        'skill_trigger_rule_process_events',
        'skill_trigger_rule_skill_events',
        'skill_trigger_rule_result_events',
        'skill_trigger_rule_lifecycle_events',
        'skill_trigger_rule_status_events',
        'skill_trigger_rule_health_threshold_events',
        'skill_trigger_rule_internal_state_events',
        'skill_trigger_rule_subject_events',
        'skill_trigger_rule_condition_groups',
        'skill_trigger_rule_conditions',
        'skill_trigger_rule_attribute_conditions',
        'skill_trigger_rule_status_conditions',
        'skill_trigger_rule_internal_state_conditions',
        'skill_trigger_rule_event_value_conditions',
        'skill_trigger_rule_actions',
        'skill_trigger_rule_effect_actions',
        'skill_trigger_rule_process_actions',
        'skill_trigger_rule_runtime_input_bindings',
        'skill_trigger_rule_internal_state_bindings',
        'skill_trigger_rule_combat_status_bindings',
        'skill_trigger_rule_event_value_bindings',
        'skill_trigger_rule_prior_result_bindings',
        'skill_trigger_rule_result_modifiers',
        'skill_trigger_rule_per_target_cooldowns',
        'skill_trigger_rule_process_limits'
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
             EXECUTE FUNCTION public.trg_skill_trigger_rule_complete_shape()',
            v_detail,
            v_detail
        );
    END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------


COMMIT;