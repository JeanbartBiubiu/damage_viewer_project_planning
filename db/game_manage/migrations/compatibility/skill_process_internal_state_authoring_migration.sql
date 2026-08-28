-- 技能过程、内部状态与效果录入：十八张关系表。
-- 开始前核对 skills / skill_formulas / skill_effects。
-- 十八张目标表全部缺失时按依赖顺序创建；全部存在且结构一致时幂等通过；
-- 只存在部分目标表或任一结构漂移时主动报错。不得用 CREATE TABLE IF NOT EXISTS 掩盖半迁移。
-- 不读取旧过程或内部状态、不写种子、不删业务数据、不使用 DROP CASCADE。
-- 只允许过程/内部状态内部所有权外键出现本设计列出的 ON DELETE CASCADE；被引用公式、效果、内部状态和模式选项全部限制删除。

BEGIN;

DO $skill_process_internal_state_mig$
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

    SELECT COUNT(*) INTO existing_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
          'skill_internal_states',
          'skill_internal_state_counter_details',
          'skill_internal_state_ammo_details',
          'skill_internal_state_flag_details',
          'skill_internal_state_cooldown_details',
          'skill_internal_state_mode_options',
          'skill_processes',
          'skill_process_steps',
          'skill_process_delay_step_details',
          'skill_process_multi_hit_step_details',
          'skill_process_periodic_step_details',
          'skill_process_channel_step_details',
          'skill_process_charge_step_details',
          'skill_process_recast_step_details',
          'skill_process_empowered_attack_step_details',
          'skill_process_cooldowns',
          'skill_process_effect_bindings',
          'skill_process_state_operations'
      );

    IF existing_count NOT IN (0, 18) THEN
        RAISE EXCEPTION
            'public.skill_process/internal_state* is incompatible: partial target structure exists (% of 18 tables)',
            existing_count;
    END IF;

    IF existing_count = 18 THEN

        -- public.skill_internal_states
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_internal_states';
        IF col_count <> 10 THEN
            RAISE EXCEPTION 'public.skill_internal_states is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_states'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_internal_states is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_states'
              AND column_name = 'state_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_states'
              AND column_name = 'name' AND data_type = 'character varying' AND character_maximum_length = 100
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_states'
              AND column_name = 'state_type' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_states'
              AND column_name = 'scope' AND data_type = 'character varying' AND character_maximum_length = 16
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_states'
              AND column_name = 'description' AND data_type = 'character varying' AND character_maximum_length = 2000
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_states'
              AND column_name = 'sort_order' AND data_type = 'integer'
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_states'
              AND column_name = 'created_at' AND data_type = 'timestamp with time zone'
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_states'
              AND column_name = 'updated_at' AND data_type = 'timestamp with time zone'
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_internal_states is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
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
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_states'
              AND c.conname = 'fk_skill_internal_states_skill' AND c.contype = 'f'
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
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_states'
              AND c.conname = 'ck_skill_internal_states_key' AND c.contype = 'c'
              AND position('^[a-z][a-z0-9_]{0,63}$' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_states'
              AND c.conname = 'ck_skill_internal_states_name' AND c.contype = 'c'
              AND position('btrim' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_states'
              AND c.conname = 'ck_skill_internal_states_type' AND c.contype = 'c'
              AND position('''COUNTER''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_states'
              AND c.conname = 'ck_skill_internal_states_scope' AND c.contype = 'c'
              AND position('''SKILL''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_states'
              AND c.conname = 'ck_skill_internal_states_scope_type' AND c.contype = 'c'
              AND position('COUNTER' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_states'
              AND c.conname = 'ck_skill_internal_states_sort_order' AND c.contype = 'c'
              AND position('sort_order>=0' IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g')) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_internal_states is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_internal_states_list'
              AND xi.tablename = 'skill_internal_states'
              AND t.relname = 'skill_internal_states'
              AND i.indisunique = false
              AND i.indnkeyatts = 4
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_internal_states is incompatible: missing or wrong index';
        END IF;

        -- public.skill_internal_state_counter_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_internal_state_counter_details';
        IF col_count <> 5 THEN
            RAISE EXCEPTION 'public.skill_internal_state_counter_details is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_counter_details'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_internal_state_counter_details is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_counter_details'
              AND column_name = 'initial_value_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_counter_details'
              AND column_name = 'max_value_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_counter_details is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_counter_details'
              AND c.conname = 'pk_skill_internal_state_counter_details' AND c.contype = 'p'
              AND cardinality(c.conkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_counter_details'
              AND c.conname = 'fk_skill_internal_state_counter_details_state' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_internal_states'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_counter_details'
              AND c.conname = 'fk_skill_internal_counter_initial_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'initial_value_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_counter_details'
              AND c.conname = 'fk_skill_internal_counter_max_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'max_value_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_counter_details is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_internal_counter_initial_formula'
              AND xi.tablename = 'skill_internal_state_counter_details'
              AND t.relname = 'skill_internal_state_counter_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 4
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_internal_counter_max_formula'
              AND xi.tablename = 'skill_internal_state_counter_details'
              AND t.relname = 'skill_internal_state_counter_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 4
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_counter_details is incompatible: missing or wrong index';
        END IF;

        -- public.skill_internal_state_ammo_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_internal_state_ammo_details';
        IF col_count <> 7 THEN
            RAISE EXCEPTION 'public.skill_internal_state_ammo_details is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_ammo_details'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_internal_state_ammo_details is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_ammo_details'
              AND column_name = 'initial_value_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_ammo_details'
              AND column_name = 'max_value_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_ammo_details'
              AND column_name = 'recovery_interval_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_ammo_details'
              AND column_name = 'recovery_mode' AND data_type = 'character varying' AND character_maximum_length = 16
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_ammo_details is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_ammo_details'
              AND c.conname = 'pk_skill_internal_state_ammo_details' AND c.contype = 'p'
              AND cardinality(c.conkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_ammo_details'
              AND c.conname = 'fk_skill_internal_state_ammo_details_state' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_internal_states'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_ammo_details'
              AND c.conname = 'fk_skill_internal_ammo_initial_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'initial_value_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_ammo_details'
              AND c.conname = 'fk_skill_internal_ammo_max_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'max_value_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_ammo_details'
              AND c.conname = 'fk_skill_internal_ammo_recovery_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'recovery_interval_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_ammo_details'
              AND c.conname = 'ck_skill_internal_state_ammo_recovery_mode' AND c.contype = 'c'
              AND position('''ONE_BY_ONE''' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_ammo_details is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_internal_ammo_initial_formula'
              AND xi.tablename = 'skill_internal_state_ammo_details'
              AND t.relname = 'skill_internal_state_ammo_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 4
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_internal_ammo_max_formula'
              AND xi.tablename = 'skill_internal_state_ammo_details'
              AND t.relname = 'skill_internal_state_ammo_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 4
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_internal_ammo_recovery_formula'
              AND xi.tablename = 'skill_internal_state_ammo_details'
              AND t.relname = 'skill_internal_state_ammo_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 4
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_ammo_details is incompatible: missing or wrong index';
        END IF;

        -- public.skill_internal_state_flag_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_internal_state_flag_details';
        IF col_count <> 4 THEN
            RAISE EXCEPTION 'public.skill_internal_state_flag_details is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_flag_details'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_internal_state_flag_details is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_flag_details'
              AND column_name = 'initial_enabled' AND data_type = 'boolean'
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_flag_details is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_flag_details'
              AND c.conname = 'pk_skill_internal_state_flag_details' AND c.contype = 'p'
              AND cardinality(c.conkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_flag_details'
              AND c.conname = 'fk_skill_internal_state_flag_details_state' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_internal_states'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_flag_details is incompatible: missing or wrong PK/FK/check constraint';
        END IF;


        -- public.skill_internal_state_cooldown_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_internal_state_cooldown_details';
        IF col_count <> 4 THEN
            RAISE EXCEPTION 'public.skill_internal_state_cooldown_details is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_cooldown_details'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_internal_state_cooldown_details is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_cooldown_details'
              AND column_name = 'duration_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_cooldown_details is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_cooldown_details'
              AND c.conname = 'pk_skill_internal_state_cooldown_details' AND c.contype = 'p'
              AND cardinality(c.conkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_cooldown_details'
              AND c.conname = 'fk_skill_internal_state_cooldown_details_state' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_internal_states'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_cooldown_details'
              AND c.conname = 'fk_skill_internal_cooldown_duration_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'duration_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_cooldown_details is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_internal_cooldown_duration_formula'
              AND xi.tablename = 'skill_internal_state_cooldown_details'
              AND t.relname = 'skill_internal_state_cooldown_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 4
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_cooldown_details is incompatible: missing or wrong index';
        END IF;

        -- public.skill_internal_state_mode_options
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_internal_state_mode_options';
        IF col_count <> 7 THEN
            RAISE EXCEPTION 'public.skill_internal_state_mode_options is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_mode_options'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_internal_state_mode_options is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_mode_options'
              AND column_name = 'option_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_mode_options'
              AND column_name = 'name' AND data_type = 'character varying' AND character_maximum_length = 100
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_mode_options'
              AND column_name = 'sort_order' AND data_type = 'integer'
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_internal_state_mode_options'
              AND column_name = 'initial' AND data_type = 'boolean'
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_mode_options is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
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
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_mode_options'
              AND c.conname = 'fk_skill_internal_state_mode_options_state' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_internal_states'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_mode_options'
              AND c.conname = 'ck_skill_internal_state_mode_options_key' AND c.contype = 'c'
              AND position('^[a-z][a-z0-9_]{0,63}$' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_mode_options'
              AND c.conname = 'ck_skill_internal_state_mode_options_name' AND c.contype = 'c'
              AND position('btrim' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_internal_state_mode_options'
              AND c.conname = 'ck_skill_internal_state_mode_options_sort_order' AND c.contype = 'c'
              AND position('sort_order>=0' IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g')) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_mode_options is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_internal_state_mode_options_list'
              AND xi.tablename = 'skill_internal_state_mode_options'
              AND t.relname = 'skill_internal_state_mode_options'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_internal_state_mode_options is incompatible: missing or wrong index';
        END IF;

        -- public.skill_processes
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_processes';
        IF col_count <> 9 THEN
            RAISE EXCEPTION 'public.skill_processes is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_processes'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_processes is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_processes'
              AND column_name = 'process_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_processes'
              AND column_name = 'name' AND data_type = 'character varying' AND character_maximum_length = 100
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_processes'
              AND column_name = 'activation_type' AND data_type = 'character varying' AND character_maximum_length = 16
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_processes'
              AND column_name = 'description' AND data_type = 'character varying' AND character_maximum_length = 2000
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_processes'
              AND column_name = 'sort_order' AND data_type = 'integer'
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_processes'
              AND column_name = 'created_at' AND data_type = 'timestamp with time zone'
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_processes'
              AND column_name = 'updated_at' AND data_type = 'timestamp with time zone'
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_processes is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
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
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_processes'
              AND c.conname = 'fk_skill_processes_skill' AND c.contype = 'f'
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
            WHERE n.nspname = 'public' AND t.relname = 'skill_processes'
              AND c.conname = 'ck_skill_processes_key' AND c.contype = 'c'
              AND position('^[a-z][a-z0-9_]{0,63}$' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_processes'
              AND c.conname = 'ck_skill_processes_name' AND c.contype = 'c'
              AND position('btrim' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_processes'
              AND c.conname = 'ck_skill_processes_activation' AND c.contype = 'c'
              AND position('''ACTIVE''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_processes'
              AND c.conname = 'ck_skill_processes_sort_order' AND c.contype = 'c'
              AND position('sort_order>=0' IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g')) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_processes is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_processes_list'
              AND xi.tablename = 'skill_processes'
              AND t.relname = 'skill_processes'
              AND i.indisunique = false
              AND i.indnkeyatts = 4
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_processes is incompatible: missing or wrong index';
        END IF;

        -- public.skill_process_steps
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_process_steps';
        IF col_count <> 8 THEN
            RAISE EXCEPTION 'public.skill_process_steps is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_steps'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_process_steps is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_steps'
              AND column_name = 'step_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_steps'
              AND column_name = 'name' AND data_type = 'character varying' AND character_maximum_length = 100
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_steps'
              AND column_name = 'step_type' AND data_type = 'character varying' AND character_maximum_length = 32
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_steps'
              AND column_name = 'description' AND data_type = 'character varying' AND character_maximum_length = 2000
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_steps'
              AND column_name = 'sort_order' AND data_type = 'integer'
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_process_steps is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
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
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_steps'
              AND c.conname = 'fk_skill_process_steps_process' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_processes'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_steps'
              AND c.conname = 'ck_skill_process_steps_key' AND c.contype = 'c'
              AND position('^[a-z][a-z0-9_]{0,63}$' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_steps'
              AND c.conname = 'ck_skill_process_steps_name' AND c.contype = 'c'
              AND position('btrim' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_steps'
              AND c.conname = 'ck_skill_process_steps_type' AND c.contype = 'c'
              AND position('''IMMEDIATE''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_steps'
              AND c.conname = 'ck_skill_process_steps_sort_order' AND c.contype = 'c'
              AND position('sort_order>=0' IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g')) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_process_steps is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_steps_list'
              AND xi.tablename = 'skill_process_steps'
              AND t.relname = 'skill_process_steps'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_process_steps is incompatible: missing or wrong index';
        END IF;

        -- public.skill_process_delay_step_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_process_delay_step_details';
        IF col_count <> 5 THEN
            RAISE EXCEPTION 'public.skill_process_delay_step_details is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_delay_step_details'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_process_delay_step_details is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_delay_step_details'
              AND column_name = 'delay_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_process_delay_step_details is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_delay_step_details'
              AND c.conname = 'pk_skill_process_delay_step_details' AND c.contype = 'p'
              AND cardinality(c.conkey) = 4
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_delay_step_details'
              AND c.conname = 'fk_skill_process_delay_step_details_step' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_process_steps'::regclass
              AND cardinality(c.conkey) = 4
              AND cardinality(c.confkey) = 4
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_delay_step_details'
              AND c.conname = 'fk_skill_process_delay_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'delay_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_process_delay_step_details is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_delay_formula'
              AND xi.tablename = 'skill_process_delay_step_details'
              AND t.relname = 'skill_process_delay_step_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_process_delay_step_details is incompatible: missing or wrong index';
        END IF;

        -- public.skill_process_multi_hit_step_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_process_multi_hit_step_details';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_process_multi_hit_step_details is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_multi_hit_step_details'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_process_multi_hit_step_details is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_multi_hit_step_details'
              AND column_name = 'repeat_count_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_multi_hit_step_details'
              AND column_name = 'interval_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'YES'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_process_multi_hit_step_details is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_multi_hit_step_details'
              AND c.conname = 'pk_skill_process_multi_hit_step_details' AND c.contype = 'p'
              AND cardinality(c.conkey) = 4
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_multi_hit_step_details'
              AND c.conname = 'fk_skill_process_multi_hit_step_details_step' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_process_steps'::regclass
              AND cardinality(c.conkey) = 4
              AND cardinality(c.confkey) = 4
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_multi_hit_step_details'
              AND c.conname = 'fk_skill_process_multi_count_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'repeat_count_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_multi_hit_step_details'
              AND c.conname = 'fk_skill_process_multi_interval_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              AND c.confmatchtype = 's'
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'interval_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_process_multi_hit_step_details is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_multi_count_formula'
              AND xi.tablename = 'skill_process_multi_hit_step_details'
              AND t.relname = 'skill_process_multi_hit_step_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_multi_interval_formula'
              AND xi.tablename = 'skill_process_multi_hit_step_details'
              AND t.relname = 'skill_process_multi_hit_step_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_process_multi_hit_step_details is incompatible: missing or wrong index';
        END IF;

        -- public.skill_process_periodic_step_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_process_periodic_step_details';
        IF col_count <> 7 THEN
            RAISE EXCEPTION 'public.skill_process_periodic_step_details is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_periodic_step_details'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_process_periodic_step_details is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_periodic_step_details'
              AND column_name = 'repeat_count_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_periodic_step_details'
              AND column_name = 'interval_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_periodic_step_details'
              AND column_name = 'first_execution' AND data_type = 'character varying' AND character_maximum_length = 16
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_process_periodic_step_details is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_periodic_step_details'
              AND c.conname = 'pk_skill_process_periodic_step_details' AND c.contype = 'p'
              AND cardinality(c.conkey) = 4
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_periodic_step_details'
              AND c.conname = 'fk_skill_process_periodic_step_details_step' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_process_steps'::regclass
              AND cardinality(c.conkey) = 4
              AND cardinality(c.confkey) = 4
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_periodic_step_details'
              AND c.conname = 'fk_skill_process_periodic_count_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'repeat_count_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_periodic_step_details'
              AND c.conname = 'fk_skill_process_periodic_interval_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'interval_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_periodic_step_details'
              AND c.conname = 'ck_skill_process_periodic_first_execution' AND c.contype = 'c'
              AND position('''AFTER_INTERVAL''' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_process_periodic_step_details is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_periodic_count_formula'
              AND xi.tablename = 'skill_process_periodic_step_details'
              AND t.relname = 'skill_process_periodic_step_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_periodic_interval_formula'
              AND xi.tablename = 'skill_process_periodic_step_details'
              AND t.relname = 'skill_process_periodic_step_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_process_periodic_step_details is incompatible: missing or wrong index';
        END IF;

        -- public.skill_process_channel_step_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_process_channel_step_details';
        IF col_count <> 7 THEN
            RAISE EXCEPTION 'public.skill_process_channel_step_details is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_channel_step_details'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_process_channel_step_details is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_channel_step_details'
              AND column_name = 'duration_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_channel_step_details'
              AND column_name = 'execution_count_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_channel_step_details'
              AND column_name = 'first_execution' AND data_type = 'character varying' AND character_maximum_length = 16
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_process_channel_step_details is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_channel_step_details'
              AND c.conname = 'pk_skill_process_channel_step_details' AND c.contype = 'p'
              AND cardinality(c.conkey) = 4
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_channel_step_details'
              AND c.conname = 'fk_skill_process_channel_step_details_step' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_process_steps'::regclass
              AND cardinality(c.conkey) = 4
              AND cardinality(c.confkey) = 4
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_channel_step_details'
              AND c.conname = 'fk_skill_process_channel_duration_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'duration_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_channel_step_details'
              AND c.conname = 'fk_skill_process_channel_count_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'execution_count_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_channel_step_details'
              AND c.conname = 'ck_skill_process_channel_first_execution' AND c.contype = 'c'
              AND position('''AFTER_INTERVAL''' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_process_channel_step_details is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_channel_duration_formula'
              AND xi.tablename = 'skill_process_channel_step_details'
              AND t.relname = 'skill_process_channel_step_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_channel_count_formula'
              AND xi.tablename = 'skill_process_channel_step_details'
              AND t.relname = 'skill_process_channel_step_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_process_channel_step_details is incompatible: missing or wrong index';
        END IF;

        -- public.skill_process_charge_step_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_process_charge_step_details';
        IF col_count <> 7 THEN
            RAISE EXCEPTION 'public.skill_process_charge_step_details is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_charge_step_details'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_process_charge_step_details is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_charge_step_details'
              AND column_name = 'minimum_charge_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_charge_step_details'
              AND column_name = 'maximum_charge_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_charge_step_details'
              AND column_name = 'release_at_maximum' AND data_type = 'boolean'
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_process_charge_step_details is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_charge_step_details'
              AND c.conname = 'pk_skill_process_charge_step_details' AND c.contype = 'p'
              AND cardinality(c.conkey) = 4
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_charge_step_details'
              AND c.conname = 'fk_skill_process_charge_step_details_step' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_process_steps'::regclass
              AND cardinality(c.conkey) = 4
              AND cardinality(c.confkey) = 4
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_charge_step_details'
              AND c.conname = 'fk_skill_process_charge_min_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'minimum_charge_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_charge_step_details'
              AND c.conname = 'fk_skill_process_charge_max_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'maximum_charge_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_process_charge_step_details is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_charge_min_formula'
              AND xi.tablename = 'skill_process_charge_step_details'
              AND t.relname = 'skill_process_charge_step_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_charge_max_formula'
              AND xi.tablename = 'skill_process_charge_step_details'
              AND t.relname = 'skill_process_charge_step_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_process_charge_step_details is incompatible: missing or wrong index';
        END IF;

        -- public.skill_process_recast_step_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_process_recast_step_details';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_process_recast_step_details is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_recast_step_details'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_process_recast_step_details is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_recast_step_details'
              AND column_name = 'window_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_recast_step_details'
              AND column_name = 'maximum_recast_count_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_process_recast_step_details is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_recast_step_details'
              AND c.conname = 'pk_skill_process_recast_step_details' AND c.contype = 'p'
              AND cardinality(c.conkey) = 4
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_recast_step_details'
              AND c.conname = 'fk_skill_process_recast_step_details_step' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_process_steps'::regclass
              AND cardinality(c.conkey) = 4
              AND cardinality(c.confkey) = 4
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_recast_step_details'
              AND c.conname = 'fk_skill_process_recast_window_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'window_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_recast_step_details'
              AND c.conname = 'fk_skill_process_recast_count_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'maximum_recast_count_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_process_recast_step_details is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_recast_window_formula'
              AND xi.tablename = 'skill_process_recast_step_details'
              AND t.relname = 'skill_process_recast_step_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_recast_count_formula'
              AND xi.tablename = 'skill_process_recast_step_details'
              AND t.relname = 'skill_process_recast_step_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_process_recast_step_details is incompatible: missing or wrong index';
        END IF;

        -- public.skill_process_empowered_attack_step_details
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_process_empowered_attack_step_details';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_process_empowered_attack_step_details is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_empowered_attack_step_details'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_process_empowered_attack_step_details is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_empowered_attack_step_details'
              AND column_name = 'window_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_empowered_attack_step_details'
              AND column_name = 'consume_moment' AND data_type = 'character varying' AND character_maximum_length = 16
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_process_empowered_attack_step_details is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_empowered_attack_step_details'
              AND c.conname = 'pk_skill_process_empowered_attack_step_details' AND c.contype = 'p'
              AND cardinality(c.conkey) = 4
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_empowered_attack_step_details'
              AND c.conname = 'fk_skill_process_empowered_attack_step_details_step' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_process_steps'::regclass
              AND cardinality(c.conkey) = 4
              AND cardinality(c.confkey) = 4
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_empowered_attack_step_details'
              AND c.conname = 'fk_skill_process_empowered_window_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'window_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_empowered_attack_step_details'
              AND c.conname = 'ck_skill_process_empowered_consume_moment' AND c.contype = 'c'
              AND position('''ATTACK_START''' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_process_empowered_attack_step_details is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_empowered_window_formula'
              AND xi.tablename = 'skill_process_empowered_attack_step_details'
              AND t.relname = 'skill_process_empowered_attack_step_details'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_process_empowered_attack_step_details is incompatible: missing or wrong index';
        END IF;

        -- public.skill_process_cooldowns
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_process_cooldowns';
        IF col_count <> 6 THEN
            RAISE EXCEPTION 'public.skill_process_cooldowns is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_cooldowns'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_process_cooldowns is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_cooldowns'
              AND column_name = 'duration_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_cooldowns'
              AND column_name = 'moment_type' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_cooldowns'
              AND column_name = 'step_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'YES'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_process_cooldowns is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_cooldowns'
              AND c.conname = 'pk_skill_process_cooldowns' AND c.contype = 'p'
              AND cardinality(c.conkey) = 3
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_cooldowns'
              AND c.conname = 'fk_skill_process_cooldowns_process' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_processes'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_cooldowns'
              AND c.conname = 'fk_skill_process_cooldown_duration_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'duration_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_cooldowns'
              AND c.conname = 'fk_skill_process_cooldowns_step' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_process_steps'::regclass
              AND cardinality(c.conkey) = 4
              AND cardinality(c.confkey) = 4
              AND c.confmatchtype = 's'
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_cooldowns'
              AND c.conname = 'ck_skill_process_cooldowns_moment' AND c.contype = 'c'
              AND position('''PROCESS_START''' IN pg_get_constraintdef(c.oid)) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_process_cooldowns is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_cooldown_duration_formula'
              AND xi.tablename = 'skill_process_cooldowns'
              AND t.relname = 'skill_process_cooldowns'
              AND i.indisunique = false
              AND i.indnkeyatts = 4
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_cooldown_step'
              AND xi.tablename = 'skill_process_cooldowns'
              AND t.relname = 'skill_process_cooldowns'
              AND i.indisunique = false
              AND i.indnkeyatts = 4
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_process_cooldowns is incompatible: missing or wrong index';
        END IF;

        -- public.skill_process_effect_bindings
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_process_effect_bindings';
        IF col_count <> 8 THEN
            RAISE EXCEPTION 'public.skill_process_effect_bindings is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_effect_bindings'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_process_effect_bindings is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_effect_bindings'
              AND column_name = 'binding_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_effect_bindings'
              AND column_name = 'effect_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_effect_bindings'
              AND column_name = 'moment_type' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_effect_bindings'
              AND column_name = 'step_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_effect_bindings'
              AND column_name = 'sort_order' AND data_type = 'integer'
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_process_effect_bindings is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
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
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_effect_bindings'
              AND c.conname = 'fk_skill_process_effect_bindings_process' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_processes'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
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
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_effect_bindings'
              AND c.conname = 'fk_skill_process_effect_bindings_step' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_process_steps'::regclass
              AND cardinality(c.conkey) = 4
              AND cardinality(c.confkey) = 4
              AND c.confmatchtype = 's'
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_effect_bindings'
              AND c.conname = 'ck_skill_process_effect_bindings_key' AND c.contype = 'c'
              AND position('^[a-z][a-z0-9_]{0,63}$' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_effect_bindings'
              AND c.conname = 'ck_skill_process_effect_bindings_moment' AND c.contype = 'c'
              AND position('''PROCESS_START''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_effect_bindings'
              AND c.conname = 'ck_skill_process_effect_bindings_sort_order' AND c.contype = 'c'
              AND position('sort_order>=0' IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g')) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_process_effect_bindings is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_effect_bindings_list'
              AND xi.tablename = 'skill_process_effect_bindings'
              AND t.relname = 'skill_process_effect_bindings'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_effect_bindings_effect'
              AND xi.tablename = 'skill_process_effect_bindings'
              AND t.relname = 'skill_process_effect_bindings'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_effect_bindings_step'
              AND xi.tablename = 'skill_process_effect_bindings'
              AND t.relname = 'skill_process_effect_bindings'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_effect_bindings_moment'
              AND xi.tablename = 'skill_process_effect_bindings'
              AND t.relname = 'skill_process_effect_bindings'
              AND i.indisunique = false
              AND i.indnkeyatts = 6
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_process_effect_bindings is incompatible: missing or wrong index';
        END IF;

        -- public.skill_process_state_operations
        SELECT COUNT(*) INTO col_count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'skill_process_state_operations';
        IF col_count <> 12 THEN
            RAISE EXCEPTION 'public.skill_process_state_operations is incompatible: unexpected column set';
        END IF;
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_state_operations'
              AND (data_type = 'ARRAY' OR udt_name LIKE '%[]' OR udt_name = 'jsonb')
        ) THEN
            RAISE EXCEPTION 'public.skill_process_state_operations is incompatible: array or jsonb column is not allowed';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_state_operations'
              AND column_name = 'operation_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_state_operations'
              AND column_name = 'name' AND data_type = 'character varying' AND character_maximum_length = 100
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_state_operations'
              AND column_name = 'state_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_state_operations'
              AND column_name = 'operation' AND data_type = 'character varying' AND character_maximum_length = 16
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_state_operations'
              AND column_name = 'value_formula_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_state_operations'
              AND column_name = 'option_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_state_operations'
              AND column_name = 'moment_type' AND data_type = 'character varying' AND character_maximum_length = 24
              AND is_nullable = 'NO'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_state_operations'
              AND column_name = 'step_key' AND data_type = 'character varying' AND character_maximum_length = 64
              AND is_nullable = 'YES'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'skill_process_state_operations'
              AND column_name = 'sort_order' AND data_type = 'integer'
              AND is_nullable = 'NO'
        ) INTO col_ok;
        IF NOT col_ok THEN
            RAISE EXCEPTION 'public.skill_process_state_operations is incompatible: missing or wrong column type/nullability';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_constraint c
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
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_state_operations'
              AND c.conname = 'fk_skill_process_state_operations_process' AND c.contype = 'f'
              AND c.confdeltype = 'c'
              AND c.confrelid = 'public.skill_processes'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_state_operations'
              AND c.conname = 'fk_skill_process_state_operations_state' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_internal_states'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_state_operations'
              AND c.conname = 'fk_skill_process_state_operation_value_formula' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_formulas'::regclass
              AND cardinality(c.conkey) = 3
              AND cardinality(c.confkey) = 3
              AND c.confmatchtype = 's'
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'value_formula_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'formula_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_state_operations'
              AND c.conname = 'fk_skill_process_state_operations_option' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_internal_state_mode_options'::regclass
              AND cardinality(c.conkey) = 4
              AND cardinality(c.confkey) = 4
              AND c.confmatchtype = 's'
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key', 'option_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'state_key', 'option_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_state_operations'
              AND c.conname = 'fk_skill_process_state_operations_step' AND c.contype = 'f'
              AND c.confdeltype <> 'c'
              AND c.confrelid = 'public.skill_process_steps'::regclass
              AND cardinality(c.conkey) = 4
              AND cardinality(c.confkey) = 4
              AND c.confmatchtype = 's'
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.conrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
              AND (
                    SELECT array_agg(att.attname::text ORDER BY ord.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
                    JOIN pg_attribute att
                      ON att.attrelid = c.confrelid AND att.attnum = ord.attnum
                  ) = ARRAY['game_id', 'skill_key', 'process_key', 'step_key']::text[]
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_state_operations'
              AND c.conname = 'ck_skill_process_state_operations_key' AND c.contype = 'c'
              AND position('^[a-z][a-z0-9_]{0,63}$' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_state_operations'
              AND c.conname = 'ck_skill_process_state_operations_name' AND c.contype = 'c'
              AND position('btrim' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_state_operations'
              AND c.conname = 'ck_skill_process_state_operations_operation' AND c.contype = 'c'
              AND position('''INCREASE''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_state_operations'
              AND c.conname = 'ck_skill_process_state_operations_moment' AND c.contype = 'c'
              AND position('''PROCESS_START''' IN pg_get_constraintdef(c.oid)) > 0
        ) AND EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public' AND t.relname = 'skill_process_state_operations'
              AND c.conname = 'ck_skill_process_state_operations_sort_order' AND c.contype = 'c'
              AND position('sort_order>=0' IN regexp_replace(pg_get_constraintdef(c.oid), '\s+', '', 'g')) > 0
        ) INTO con_ok;
        IF NOT con_ok THEN
            RAISE EXCEPTION 'public.skill_process_state_operations is incompatible: missing or wrong PK/FK/check constraint';
        END IF;
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_state_operations_list'
              AND xi.tablename = 'skill_process_state_operations'
              AND t.relname = 'skill_process_state_operations'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_state_operations_state'
              AND xi.tablename = 'skill_process_state_operations'
              AND t.relname = 'skill_process_state_operations'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_state_operations_option'
              AND xi.tablename = 'skill_process_state_operations'
              AND t.relname = 'skill_process_state_operations'
              AND i.indisunique = false
              AND i.indnkeyatts = 6
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_state_operation_value_formula'
              AND xi.tablename = 'skill_process_state_operations'
              AND t.relname = 'skill_process_state_operations'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_state_operations_step'
              AND xi.tablename = 'skill_process_state_operations'
              AND t.relname = 'skill_process_state_operations'
              AND i.indisunique = false
              AND i.indnkeyatts = 5
        ) AND EXISTS (
            SELECT 1 FROM pg_indexes xi
            JOIN pg_class idx ON idx.relname = xi.indexname
            JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = xi.schemaname
            JOIN pg_index i ON i.indexrelid = idx.oid
            JOIN pg_class t ON t.oid = i.indrelid
            WHERE xi.schemaname = 'public'
              AND xi.indexname = 'ix_skill_process_state_operations_moment'
              AND xi.tablename = 'skill_process_state_operations'
              AND t.relname = 'skill_process_state_operations'
              AND i.indisunique = false
              AND i.indnkeyatts = 6
        ) INTO idx_ok;
        IF NOT idx_ok THEN
            RAISE EXCEPTION 'public.skill_process_state_operations is incompatible: missing or wrong index';
        END IF;
    ELSE
        CREATE TABLE public.skill_internal_states (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            state_key varchar(64) NOT NULL,
            name varchar(100) NOT NULL,
            state_type varchar(24) NOT NULL,
            scope varchar(16) NOT NULL,
            description varchar(2000),
            sort_order integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_skill_internal_states
                PRIMARY KEY (game_id, skill_key, state_key),
            CONSTRAINT fk_skill_internal_states_skill
                FOREIGN KEY (game_id, skill_key)
                REFERENCES public.skills (game_id, skill_key),
            CONSTRAINT ck_skill_internal_states_key
                CHECK (state_key ~ '^[a-z][a-z0-9_]{0,63}$'),
            CONSTRAINT ck_skill_internal_states_name
                CHECK (btrim(name) <> ''),
            CONSTRAINT ck_skill_internal_states_type
                CHECK (state_type IN (
                    'COUNTER', 'AMMO', 'MODE', 'FLAG', 'INTERNAL_COOLDOWN'
                )),
            CONSTRAINT ck_skill_internal_states_scope
                CHECK (scope IN ('SKILL', 'TARGET')),
            CONSTRAINT ck_skill_internal_states_scope_type
                CHECK (state_type = 'COUNTER' OR scope = 'SKILL'),
            CONSTRAINT ck_skill_internal_states_sort_order
                CHECK (sort_order >= 0)
        );

        CREATE INDEX ix_skill_internal_states_list
            ON public.skill_internal_states (game_id, skill_key, sort_order, state_key);

        COMMENT ON TABLE public.skill_internal_states IS '技能内部状态';

        CREATE TABLE public.skill_internal_state_counter_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            state_key varchar(64) NOT NULL,
            initial_value_formula_key varchar(64) NOT NULL,
            max_value_formula_key varchar(64) NOT NULL,
            CONSTRAINT pk_skill_internal_state_counter_details
                PRIMARY KEY (game_id, skill_key, state_key),
            CONSTRAINT fk_skill_internal_state_counter_details_state
                FOREIGN KEY (game_id, skill_key, state_key)
                REFERENCES public.skill_internal_states (game_id, skill_key, state_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_internal_counter_initial_formula
                FOREIGN KEY (game_id, skill_key, initial_value_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT fk_skill_internal_counter_max_formula
                FOREIGN KEY (game_id, skill_key, max_value_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
        );

        CREATE INDEX ix_skill_internal_counter_initial_formula
            ON public.skill_internal_state_counter_details
            (game_id, skill_key, initial_value_formula_key, state_key);

        CREATE INDEX ix_skill_internal_counter_max_formula
            ON public.skill_internal_state_counter_details
            (game_id, skill_key, max_value_formula_key, state_key);

        COMMENT ON TABLE public.skill_internal_state_counter_details IS '技能内部计数状态明细';

        CREATE TABLE public.skill_internal_state_ammo_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            state_key varchar(64) NOT NULL,
            initial_value_formula_key varchar(64) NOT NULL,
            max_value_formula_key varchar(64) NOT NULL,
            recovery_interval_formula_key varchar(64) NOT NULL,
            recovery_mode varchar(16) NOT NULL,
            CONSTRAINT pk_skill_internal_state_ammo_details
                PRIMARY KEY (game_id, skill_key, state_key),
            CONSTRAINT fk_skill_internal_state_ammo_details_state
                FOREIGN KEY (game_id, skill_key, state_key)
                REFERENCES public.skill_internal_states (game_id, skill_key, state_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_internal_ammo_initial_formula
                FOREIGN KEY (game_id, skill_key, initial_value_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT fk_skill_internal_ammo_max_formula
                FOREIGN KEY (game_id, skill_key, max_value_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT fk_skill_internal_ammo_recovery_formula
                FOREIGN KEY (game_id, skill_key, recovery_interval_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT ck_skill_internal_state_ammo_recovery_mode
                CHECK (recovery_mode IN ('ONE_BY_ONE', 'ALL_AT_ONCE'))
        );

        CREATE INDEX ix_skill_internal_ammo_initial_formula
            ON public.skill_internal_state_ammo_details
            (game_id, skill_key, initial_value_formula_key, state_key);

        CREATE INDEX ix_skill_internal_ammo_max_formula
            ON public.skill_internal_state_ammo_details
            (game_id, skill_key, max_value_formula_key, state_key);

        CREATE INDEX ix_skill_internal_ammo_recovery_formula
            ON public.skill_internal_state_ammo_details
            (game_id, skill_key, recovery_interval_formula_key, state_key);

        COMMENT ON TABLE public.skill_internal_state_ammo_details IS '技能内部弹药状态明细';

        CREATE TABLE public.skill_internal_state_flag_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            state_key varchar(64) NOT NULL,
            initial_enabled boolean NOT NULL,
            CONSTRAINT pk_skill_internal_state_flag_details
                PRIMARY KEY (game_id, skill_key, state_key),
            CONSTRAINT fk_skill_internal_state_flag_details_state
                FOREIGN KEY (game_id, skill_key, state_key)
                REFERENCES public.skill_internal_states (game_id, skill_key, state_key)
                ON DELETE CASCADE
        );

        COMMENT ON TABLE public.skill_internal_state_flag_details IS '技能内部准备标记明细';

        CREATE TABLE public.skill_internal_state_cooldown_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            state_key varchar(64) NOT NULL,
            duration_formula_key varchar(64) NOT NULL,
            CONSTRAINT pk_skill_internal_state_cooldown_details
                PRIMARY KEY (game_id, skill_key, state_key),
            CONSTRAINT fk_skill_internal_state_cooldown_details_state
                FOREIGN KEY (game_id, skill_key, state_key)
                REFERENCES public.skill_internal_states (game_id, skill_key, state_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_internal_cooldown_duration_formula
                FOREIGN KEY (game_id, skill_key, duration_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
        );

        CREATE INDEX ix_skill_internal_cooldown_duration_formula
            ON public.skill_internal_state_cooldown_details
            (game_id, skill_key, duration_formula_key, state_key);

        COMMENT ON TABLE public.skill_internal_state_cooldown_details IS '技能内部冷却明细';

        CREATE TABLE public.skill_internal_state_mode_options (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            state_key varchar(64) NOT NULL,
            option_key varchar(64) NOT NULL,
            name varchar(100) NOT NULL,
            sort_order integer NOT NULL DEFAULT 0,
            initial boolean NOT NULL,
            CONSTRAINT pk_skill_internal_state_mode_options
                PRIMARY KEY (game_id, skill_key, state_key, option_key),
            CONSTRAINT fk_skill_internal_state_mode_options_state
                FOREIGN KEY (game_id, skill_key, state_key)
                REFERENCES public.skill_internal_states (game_id, skill_key, state_key)
                ON DELETE CASCADE,
            CONSTRAINT ck_skill_internal_state_mode_options_key
                CHECK (option_key ~ '^[a-z][a-z0-9_]{0,63}$'),
            CONSTRAINT ck_skill_internal_state_mode_options_name
                CHECK (btrim(name) <> ''),
            CONSTRAINT ck_skill_internal_state_mode_options_sort_order
                CHECK (sort_order >= 0)
        );

        CREATE INDEX ix_skill_internal_state_mode_options_list
            ON public.skill_internal_state_mode_options
            (game_id, skill_key, state_key, sort_order, option_key);

        COMMENT ON TABLE public.skill_internal_state_mode_options IS '技能内部模式选项';

        CREATE TABLE public.skill_processes (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            process_key varchar(64) NOT NULL,
            name varchar(100) NOT NULL,
            activation_type varchar(16) NOT NULL,
            description varchar(2000),
            sort_order integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT pk_skill_processes
                PRIMARY KEY (game_id, skill_key, process_key),
            CONSTRAINT fk_skill_processes_skill
                FOREIGN KEY (game_id, skill_key)
                REFERENCES public.skills (game_id, skill_key),
            CONSTRAINT ck_skill_processes_key
                CHECK (process_key ~ '^[a-z][a-z0-9_]{0,63}$'),
            CONSTRAINT ck_skill_processes_name
                CHECK (btrim(name) <> ''),
            CONSTRAINT ck_skill_processes_activation
                CHECK (activation_type IN ('ACTIVE', 'PASSIVE', 'CONSUMABLE')),
            CONSTRAINT ck_skill_processes_sort_order
                CHECK (sort_order >= 0)
        );

        CREATE INDEX ix_skill_processes_list
            ON public.skill_processes (game_id, skill_key, sort_order, process_key);

        COMMENT ON TABLE public.skill_processes IS '技能过程';

        CREATE TABLE public.skill_process_steps (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            process_key varchar(64) NOT NULL,
            step_key varchar(64) NOT NULL,
            name varchar(100) NOT NULL,
            step_type varchar(32) NOT NULL,
            description varchar(2000),
            sort_order integer NOT NULL DEFAULT 0,
            CONSTRAINT pk_skill_process_steps
                PRIMARY KEY (game_id, skill_key, process_key, step_key),
            CONSTRAINT fk_skill_process_steps_process
                FOREIGN KEY (game_id, skill_key, process_key)
                REFERENCES public.skill_processes (game_id, skill_key, process_key)
                ON DELETE CASCADE,
            CONSTRAINT ck_skill_process_steps_key
                CHECK (step_key ~ '^[a-z][a-z0-9_]{0,63}$'),
            CONSTRAINT ck_skill_process_steps_name
                CHECK (btrim(name) <> ''),
            CONSTRAINT ck_skill_process_steps_type
                CHECK (step_type IN (
                    'IMMEDIATE', 'DELAY', 'MULTI_HIT', 'PERIODIC',
                    'CHANNEL', 'CHARGE', 'RECAST', 'EMPOWERED_BASIC_ATTACK'
                )),
            CONSTRAINT ck_skill_process_steps_sort_order
                CHECK (sort_order >= 0)
        );

        CREATE INDEX ix_skill_process_steps_list
            ON public.skill_process_steps
            (game_id, skill_key, process_key, sort_order, step_key);

        COMMENT ON TABLE public.skill_process_steps IS '技能过程步骤';

        CREATE TABLE public.skill_process_delay_step_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            process_key varchar(64) NOT NULL,
            step_key varchar(64) NOT NULL,
            delay_formula_key varchar(64) NOT NULL,
            CONSTRAINT pk_skill_process_delay_step_details
                PRIMARY KEY (game_id, skill_key, process_key, step_key),
            CONSTRAINT fk_skill_process_delay_step_details_step
                FOREIGN KEY (game_id, skill_key, process_key, step_key)
                REFERENCES public.skill_process_steps
                    (game_id, skill_key, process_key, step_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_process_delay_formula
                FOREIGN KEY (game_id, skill_key, delay_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
        );

        CREATE INDEX ix_skill_process_delay_formula
            ON public.skill_process_delay_step_details
            (game_id, skill_key, delay_formula_key, process_key, step_key);

        COMMENT ON TABLE public.skill_process_delay_step_details IS '延迟步骤明细';

        CREATE TABLE public.skill_process_multi_hit_step_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            process_key varchar(64) NOT NULL,
            step_key varchar(64) NOT NULL,
            repeat_count_formula_key varchar(64) NOT NULL,
            interval_formula_key varchar(64),
            CONSTRAINT pk_skill_process_multi_hit_step_details
                PRIMARY KEY (game_id, skill_key, process_key, step_key),
            CONSTRAINT fk_skill_process_multi_hit_step_details_step
                FOREIGN KEY (game_id, skill_key, process_key, step_key)
                REFERENCES public.skill_process_steps
                    (game_id, skill_key, process_key, step_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_process_multi_count_formula
                FOREIGN KEY (game_id, skill_key, repeat_count_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT fk_skill_process_multi_interval_formula
                FOREIGN KEY (game_id, skill_key, interval_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
                MATCH SIMPLE
        );

        CREATE INDEX ix_skill_process_multi_count_formula
            ON public.skill_process_multi_hit_step_details
            (game_id, skill_key, repeat_count_formula_key, process_key, step_key);

        CREATE INDEX ix_skill_process_multi_interval_formula
            ON public.skill_process_multi_hit_step_details
            (game_id, skill_key, interval_formula_key, process_key, step_key);

        COMMENT ON TABLE public.skill_process_multi_hit_step_details IS '多段步骤明细';

        CREATE TABLE public.skill_process_periodic_step_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            process_key varchar(64) NOT NULL,
            step_key varchar(64) NOT NULL,
            repeat_count_formula_key varchar(64) NOT NULL,
            interval_formula_key varchar(64) NOT NULL,
            first_execution varchar(16) NOT NULL,
            CONSTRAINT pk_skill_process_periodic_step_details
                PRIMARY KEY (game_id, skill_key, process_key, step_key),
            CONSTRAINT fk_skill_process_periodic_step_details_step
                FOREIGN KEY (game_id, skill_key, process_key, step_key)
                REFERENCES public.skill_process_steps
                    (game_id, skill_key, process_key, step_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_process_periodic_count_formula
                FOREIGN KEY (game_id, skill_key, repeat_count_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT fk_skill_process_periodic_interval_formula
                FOREIGN KEY (game_id, skill_key, interval_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT ck_skill_process_periodic_first_execution
                CHECK (first_execution IN ('IMMEDIATE', 'AFTER_INTERVAL'))
        );

        CREATE INDEX ix_skill_process_periodic_count_formula
            ON public.skill_process_periodic_step_details
            (game_id, skill_key, repeat_count_formula_key, process_key, step_key);

        CREATE INDEX ix_skill_process_periodic_interval_formula
            ON public.skill_process_periodic_step_details
            (game_id, skill_key, interval_formula_key, process_key, step_key);

        COMMENT ON TABLE public.skill_process_periodic_step_details IS '周期步骤明细';

        CREATE TABLE public.skill_process_channel_step_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            process_key varchar(64) NOT NULL,
            step_key varchar(64) NOT NULL,
            duration_formula_key varchar(64) NOT NULL,
            execution_count_formula_key varchar(64) NOT NULL,
            first_execution varchar(16) NOT NULL,
            CONSTRAINT pk_skill_process_channel_step_details
                PRIMARY KEY (game_id, skill_key, process_key, step_key),
            CONSTRAINT fk_skill_process_channel_step_details_step
                FOREIGN KEY (game_id, skill_key, process_key, step_key)
                REFERENCES public.skill_process_steps
                    (game_id, skill_key, process_key, step_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_process_channel_duration_formula
                FOREIGN KEY (game_id, skill_key, duration_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT fk_skill_process_channel_count_formula
                FOREIGN KEY (game_id, skill_key, execution_count_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT ck_skill_process_channel_first_execution
                CHECK (first_execution IN ('IMMEDIATE', 'AFTER_INTERVAL'))
        );

        CREATE INDEX ix_skill_process_channel_duration_formula
            ON public.skill_process_channel_step_details
            (game_id, skill_key, duration_formula_key, process_key, step_key);

        CREATE INDEX ix_skill_process_channel_count_formula
            ON public.skill_process_channel_step_details
            (game_id, skill_key, execution_count_formula_key, process_key, step_key);

        COMMENT ON TABLE public.skill_process_channel_step_details IS '引导步骤明细';

        CREATE TABLE public.skill_process_charge_step_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            process_key varchar(64) NOT NULL,
            step_key varchar(64) NOT NULL,
            minimum_charge_formula_key varchar(64) NOT NULL,
            maximum_charge_formula_key varchar(64) NOT NULL,
            release_at_maximum boolean NOT NULL,
            CONSTRAINT pk_skill_process_charge_step_details
                PRIMARY KEY (game_id, skill_key, process_key, step_key),
            CONSTRAINT fk_skill_process_charge_step_details_step
                FOREIGN KEY (game_id, skill_key, process_key, step_key)
                REFERENCES public.skill_process_steps
                    (game_id, skill_key, process_key, step_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_process_charge_min_formula
                FOREIGN KEY (game_id, skill_key, minimum_charge_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT fk_skill_process_charge_max_formula
                FOREIGN KEY (game_id, skill_key, maximum_charge_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
        );

        CREATE INDEX ix_skill_process_charge_min_formula
            ON public.skill_process_charge_step_details
            (game_id, skill_key, minimum_charge_formula_key, process_key, step_key);

        CREATE INDEX ix_skill_process_charge_max_formula
            ON public.skill_process_charge_step_details
            (game_id, skill_key, maximum_charge_formula_key, process_key, step_key);

        COMMENT ON TABLE public.skill_process_charge_step_details IS '蓄力步骤明细';

        CREATE TABLE public.skill_process_recast_step_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            process_key varchar(64) NOT NULL,
            step_key varchar(64) NOT NULL,
            window_formula_key varchar(64) NOT NULL,
            maximum_recast_count_formula_key varchar(64) NOT NULL,
            CONSTRAINT pk_skill_process_recast_step_details
                PRIMARY KEY (game_id, skill_key, process_key, step_key),
            CONSTRAINT fk_skill_process_recast_step_details_step
                FOREIGN KEY (game_id, skill_key, process_key, step_key)
                REFERENCES public.skill_process_steps
                    (game_id, skill_key, process_key, step_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_process_recast_window_formula
                FOREIGN KEY (game_id, skill_key, window_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT fk_skill_process_recast_count_formula
                FOREIGN KEY (game_id, skill_key, maximum_recast_count_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
        );

        CREATE INDEX ix_skill_process_recast_window_formula
            ON public.skill_process_recast_step_details
            (game_id, skill_key, window_formula_key, process_key, step_key);

        CREATE INDEX ix_skill_process_recast_count_formula
            ON public.skill_process_recast_step_details
            (game_id, skill_key, maximum_recast_count_formula_key, process_key, step_key);

        COMMENT ON TABLE public.skill_process_recast_step_details IS '重施步骤明细';

        CREATE TABLE public.skill_process_empowered_attack_step_details (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            process_key varchar(64) NOT NULL,
            step_key varchar(64) NOT NULL,
            window_formula_key varchar(64) NOT NULL,
            consume_moment varchar(16) NOT NULL,
            CONSTRAINT pk_skill_process_empowered_attack_step_details
                PRIMARY KEY (game_id, skill_key, process_key, step_key),
            CONSTRAINT fk_skill_process_empowered_attack_step_details_step
                FOREIGN KEY (game_id, skill_key, process_key, step_key)
                REFERENCES public.skill_process_steps
                    (game_id, skill_key, process_key, step_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_process_empowered_window_formula
                FOREIGN KEY (game_id, skill_key, window_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT ck_skill_process_empowered_consume_moment
                CHECK (consume_moment IN ('ATTACK_START', 'ATTACK_HIT'))
        );

        CREATE INDEX ix_skill_process_empowered_window_formula
            ON public.skill_process_empowered_attack_step_details
            (game_id, skill_key, window_formula_key, process_key, step_key);

        COMMENT ON TABLE public.skill_process_empowered_attack_step_details IS '强化下一次普通攻击步骤明细';

        CREATE TABLE public.skill_process_cooldowns (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            process_key varchar(64) NOT NULL,
            duration_formula_key varchar(64) NOT NULL,
            moment_type varchar(24) NOT NULL,
            step_key varchar(64),
            CONSTRAINT pk_skill_process_cooldowns
                PRIMARY KEY (game_id, skill_key, process_key),
            CONSTRAINT fk_skill_process_cooldowns_process
                FOREIGN KEY (game_id, skill_key, process_key)
                REFERENCES public.skill_processes (game_id, skill_key, process_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_process_cooldown_duration_formula
                FOREIGN KEY (game_id, skill_key, duration_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
            CONSTRAINT fk_skill_process_cooldowns_step
                FOREIGN KEY (game_id, skill_key, process_key, step_key)
                REFERENCES public.skill_process_steps
                    (game_id, skill_key, process_key, step_key)
                MATCH SIMPLE,
            CONSTRAINT ck_skill_process_cooldowns_moment
                CHECK (
                    (
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

        CREATE INDEX ix_skill_process_cooldown_duration_formula
            ON public.skill_process_cooldowns
            (game_id, skill_key, duration_formula_key, process_key);

        CREATE INDEX ix_skill_process_cooldown_step
            ON public.skill_process_cooldowns
            (game_id, skill_key, process_key, step_key);

        COMMENT ON TABLE public.skill_process_cooldowns IS '技能过程普通冷却';

        CREATE TABLE public.skill_process_effect_bindings (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            process_key varchar(64) NOT NULL,
            binding_key varchar(64) NOT NULL,
            effect_key varchar(64) NOT NULL,
            moment_type varchar(24) NOT NULL,
            step_key varchar(64),
            sort_order integer NOT NULL DEFAULT 0,
            CONSTRAINT pk_skill_process_effect_bindings
                PRIMARY KEY (game_id, skill_key, process_key, binding_key),
            CONSTRAINT fk_skill_process_effect_bindings_process
                FOREIGN KEY (game_id, skill_key, process_key)
                REFERENCES public.skill_processes (game_id, skill_key, process_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_process_effect_bindings_effect
                FOREIGN KEY (game_id, skill_key, effect_key)
                REFERENCES public.skill_effects (game_id, skill_key, effect_key),
            CONSTRAINT fk_skill_process_effect_bindings_step
                FOREIGN KEY (game_id, skill_key, process_key, step_key)
                REFERENCES public.skill_process_steps
                    (game_id, skill_key, process_key, step_key)
                MATCH SIMPLE,
            CONSTRAINT ck_skill_process_effect_bindings_key
                CHECK (binding_key ~ '^[a-z][a-z0-9_]{0,63}$'),
            CONSTRAINT ck_skill_process_effect_bindings_moment
                CHECK (
                    (
                        moment_type IN ('PROCESS_START', 'PROCESS_COMPLETE', 'PROCESS_FAILURE')
                        AND step_key IS NULL
                    )
                    OR (
                        moment_type IN (
                            'STEP_START', 'STEP_EXECUTION', 'STEP_COMPLETE', 'STEP_TIMEOUT'
                        )
                        AND step_key IS NOT NULL
                    )
                ),
            CONSTRAINT ck_skill_process_effect_bindings_sort_order
                CHECK (sort_order >= 0)
        );

        CREATE INDEX ix_skill_process_effect_bindings_list
            ON public.skill_process_effect_bindings
            (game_id, skill_key, process_key, sort_order, binding_key);

        CREATE INDEX ix_skill_process_effect_bindings_effect
            ON public.skill_process_effect_bindings
            (game_id, skill_key, effect_key, process_key, binding_key);

        CREATE INDEX ix_skill_process_effect_bindings_step
            ON public.skill_process_effect_bindings
            (game_id, skill_key, process_key, step_key, binding_key);

        CREATE INDEX ix_skill_process_effect_bindings_moment
            ON public.skill_process_effect_bindings
            (game_id, skill_key, process_key, moment_type, step_key, binding_key);

        COMMENT ON TABLE public.skill_process_effect_bindings IS '技能过程效果挂接';

        CREATE TABLE public.skill_process_state_operations (
            game_id varchar(64) NOT NULL,
            skill_key varchar(64) NOT NULL,
            process_key varchar(64) NOT NULL,
            operation_key varchar(64) NOT NULL,
            name varchar(100) NOT NULL,
            state_key varchar(64) NOT NULL,
            operation varchar(16) NOT NULL,
            value_formula_key varchar(64),
            option_key varchar(64),
            moment_type varchar(24) NOT NULL,
            step_key varchar(64),
            sort_order integer NOT NULL DEFAULT 0,
            CONSTRAINT pk_skill_process_state_operations
                PRIMARY KEY (game_id, skill_key, process_key, operation_key),
            CONSTRAINT fk_skill_process_state_operations_process
                FOREIGN KEY (game_id, skill_key, process_key)
                REFERENCES public.skill_processes (game_id, skill_key, process_key)
                ON DELETE CASCADE,
            CONSTRAINT fk_skill_process_state_operations_state
                FOREIGN KEY (game_id, skill_key, state_key)
                REFERENCES public.skill_internal_states (game_id, skill_key, state_key),
            CONSTRAINT fk_skill_process_state_operation_value_formula
                FOREIGN KEY (game_id, skill_key, value_formula_key)
                REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
                MATCH SIMPLE,
            CONSTRAINT fk_skill_process_state_operations_option
                FOREIGN KEY (game_id, skill_key, state_key, option_key)
                REFERENCES public.skill_internal_state_mode_options
                    (game_id, skill_key, state_key, option_key)
                MATCH SIMPLE,
            CONSTRAINT fk_skill_process_state_operations_step
                FOREIGN KEY (game_id, skill_key, process_key, step_key)
                REFERENCES public.skill_process_steps
                    (game_id, skill_key, process_key, step_key)
                MATCH SIMPLE,
            CONSTRAINT ck_skill_process_state_operations_key
                CHECK (operation_key ~ '^[a-z][a-z0-9_]{0,63}$'),
            CONSTRAINT ck_skill_process_state_operations_name
                CHECK (btrim(name) <> ''),
            CONSTRAINT ck_skill_process_state_operations_operation
                CHECK (operation IN (
                    'INCREASE', 'DECREASE', 'CONSUME', 'SET', 'RESET',
                    'SELECT', 'ENABLE', 'DISABLE', 'TOGGLE', 'START'
                )),
            CONSTRAINT ck_skill_process_state_operations_moment
                CHECK (
                    (
                        moment_type IN ('PROCESS_START', 'PROCESS_COMPLETE', 'PROCESS_FAILURE')
                        AND step_key IS NULL
                    )
                    OR (
                        moment_type IN (
                            'STEP_START', 'STEP_EXECUTION', 'STEP_COMPLETE', 'STEP_TIMEOUT'
                        )
                        AND step_key IS NOT NULL
                    )
                ),
            CONSTRAINT ck_skill_process_state_operations_sort_order
                CHECK (sort_order >= 0)
        );

        CREATE INDEX ix_skill_process_state_operations_list
            ON public.skill_process_state_operations
            (game_id, skill_key, process_key, sort_order, operation_key);

        CREATE INDEX ix_skill_process_state_operations_state
            ON public.skill_process_state_operations
            (game_id, skill_key, state_key, process_key, operation_key);

        CREATE INDEX ix_skill_process_state_operations_option
            ON public.skill_process_state_operations
            (game_id, skill_key, state_key, option_key, process_key, operation_key);

        CREATE INDEX ix_skill_process_state_operation_value_formula
            ON public.skill_process_state_operations
            (game_id, skill_key, value_formula_key, process_key, operation_key);

        CREATE INDEX ix_skill_process_state_operations_step
            ON public.skill_process_state_operations
            (game_id, skill_key, process_key, step_key, operation_key);

        CREATE INDEX ix_skill_process_state_operations_moment
            ON public.skill_process_state_operations
            (game_id, skill_key, process_key, moment_type, step_key, operation_key);

        COMMENT ON TABLE public.skill_process_state_operations IS '技能过程内部状态操作';
    END IF;
END;
$skill_process_internal_state_mig$;

COMMIT;
