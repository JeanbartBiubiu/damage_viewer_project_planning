-- 阶段 7 验收补项：公共技能作用范围与技能急速修正。
-- 只接受精确 85/16 前置或精确 88/17 目标；部分存在、未知结构或计数不一致必须失败回滚。
-- 本脚本不回填技能急速业务记录、不写种子、不双写、不保留旧字段。

BEGIN;

DO $migration_preflight$
DECLARE
    v_parent_count integer;
    v_new_count integer;
    v_has_old_targets boolean;
    v_constraint_def text;
    v_actual_values text[];
    v_function_src text;
    v_previous_result_values constant text[] := ARRAY[
        'ATTACK_LINK_APPLICATION', 'ATTRIBUTE_CHANGE', 'COOLDOWN_CHANGE', 'DAMAGE',
        'DAMAGE_IMMUNITY', 'DAMAGE_MODIFIER', 'DIRECT_HEAL', 'EXECUTE',
        'HEALING_MODIFIER', 'HEALTH_FLOOR', 'HIT_LINK_APPLICATION',
        'LIFECYCLE_OPERATION', 'NORMAL_SHIELD', 'RESOURCE_CHANGE', 'SPELL_SHIELD',
        'STATUS_OPERATION'
    ];
    v_target_result_values constant text[] := ARRAY[
        'ATTACK_LINK_APPLICATION', 'ATTRIBUTE_CHANGE', 'COOLDOWN_CHANGE', 'DAMAGE',
        'DAMAGE_IMMUNITY', 'DAMAGE_MODIFIER', 'DIRECT_HEAL', 'EXECUTE',
        'HEALING_MODIFIER', 'HEALTH_FLOOR', 'HIT_LINK_APPLICATION',
        'LIFECYCLE_OPERATION', 'NORMAL_SHIELD', 'RESOURCE_CHANGE', 'SKILL_HASTE_MODIFIER',
        'SPELL_SHIELD', 'STATUS_OPERATION'
    ];
    v_new_tables constant text[] := ARRAY[
        'skill_effect_result_skill_scopes',
        'skill_effect_result_skill_targets',
        'skill_effect_result_skill_category_targets',
        'skill_effect_haste_modifier_details'
    ];
    v_stage76_tables constant text[] := ARRAY[
        'skill_effect_result_critical_policies',
        'skill_effect_result_vamp_rules',
        'skill_effect_result_normal_shield_interactions',
        'skill_trigger_rule_damage_events',
        'skill_effect_damage_modifier_details',
        'skill_effect_healing_modifier_details',
        'skill_effect_damage_immunity_details',
        'skill_effect_health_floor_details',
        'modifier_zones',
        'skill_effect_result_spell_shield_policies',
        'skill_trigger_rule_spell_shield_blocked_events',
        'skill_effect_execute_details',
        'skill_trigger_rule_link_events'
    ];
    v_stage76_count integer;
    v_event_type_count integer;
    v_output_count integer;
    v_event_value_count integer;
BEGIN
    IF to_regclass('public.skill_effect_results') IS NULL
        OR to_regclass('public.skill_effect_cooldown_change_details') IS NULL
        OR to_regclass('public.skills') IS NULL
        OR to_regclass('public.skill_categories') IS NULL
        OR to_regclass('public.skill_effect_result_lifecycle_behaviors') IS NULL
        OR to_regclass('public.skill_trigger_rule_prior_result_bindings') IS NULL THEN
        RAISE EXCEPTION 'skill scope management migration prerequisites are missing';
    END IF;

    SELECT COUNT(*)
      INTO v_stage76_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname = ANY (v_stage76_tables);
    IF v_stage76_count <> 13 THEN
        RAISE EXCEPTION 'stage 7.6 table set drifted: found % of 13', v_stage76_count;
    END IF;

    SELECT COUNT(*)
      INTO v_parent_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r';

    SELECT COUNT(*)
      INTO v_new_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname = ANY (v_new_tables);
    IF v_new_count NOT IN (0, 4) THEN
        RAISE EXCEPTION 'skill scope structure is partial: new_tables=%', v_new_count;
    END IF;

    v_has_old_targets := to_regclass('public.skill_effect_cooldown_change_targets') IS NOT NULL;

    v_constraint_def := NULL;
    FOR v_constraint_def IN
        SELECT pg_get_constraintdef(c.oid)
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'skill_effect_results'
           AND c.conname = 'ck_skill_effect_results_type'
    LOOP
        SELECT array_agg(match[1] ORDER BY match[1])
          INTO v_actual_values
          FROM regexp_matches(v_constraint_def, '''([A-Z_]+)''', 'g') AS match;
    END LOOP;
    IF v_constraint_def IS NULL THEN
        RAISE EXCEPTION 'skill effect result type constraint is missing';
    END IF;

    SELECT cardinality(array_agg(match[1]))
      INTO v_event_type_count
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([A-Z_]+)''', 'g') AS match
     WHERE n.nspname = 'public'
       AND t.relname = 'skill_trigger_rules'
       AND c.conname = 'ck_skill_trigger_rules_event_type';
    SELECT cardinality(array_agg(match[1]))
      INTO v_output_count
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([A-Z_]+)''', 'g') AS match
     WHERE n.nspname = 'public'
       AND t.relname = 'skill_trigger_rule_prior_result_bindings'
       AND c.conname = 'ck_skill_trigger_prior_result_bind_output';
    SELECT cardinality(array_agg(DISTINCT match[1]))
      INTO v_event_value_count
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([A-Z_]+)''', 'g') AS match
     WHERE n.nspname = 'public'
       AND t.relname = 'skill_trigger_rule_event_value_conditions'
       AND c.conname = 'ck_skill_trigger_event_value_cond_key';
    IF v_event_type_count IS DISTINCT FROM 21
        OR v_output_count IS DISTINCT FROM 10
        OR v_event_value_count IS DISTINCT FROM 23 THEN
        RAISE EXCEPTION 'stage 7.6.5 event/output/event-value counts drifted: events=%, outputs=%, values=%',
            v_event_type_count, v_output_count, v_event_value_count;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'skill_effect_result_lifecycle_behaviors'
           AND pg_get_constraintdef(c.oid) ILIKE '%MOMENT_EVALUATION%'
    ) THEN
        RAISE EXCEPTION 'MOMENT_EVALUATION lifecycle matrix is missing';
    END IF;

    IF to_regprocedure('public.trg_skill_effect_result_complete_shape()') IS NULL
        OR to_regprocedure('public.trg_skill_effect_lifecycle_aggregate_shape()') IS NULL THEN
        RAISE EXCEPTION 'stage 7.6.5 shape functions are missing';
    END IF;

    IF v_new_count = 0 THEN
        IF v_parent_count <> 85 THEN
            RAISE EXCEPTION 'parent table count drifted: %', v_parent_count;
        END IF;
        IF NOT v_has_old_targets THEN
            RAISE EXCEPTION 'precondition requires skill_effect_cooldown_change_targets';
        END IF;
        IF NOT (
            cardinality(v_actual_values) = cardinality(v_previous_result_values)
            AND v_actual_values @> v_previous_result_values
            AND v_previous_result_values @> v_actual_values
        ) THEN
            RAISE EXCEPTION 'precondition result type constraint drifted: %', v_actual_values;
        END IF;
        SELECT pg_get_functiondef('public.trg_skill_effect_result_complete_shape()'::regprocedure)
          INTO v_function_src;
        IF v_function_src NOT ILIKE '%v_cooldown_target_count%'
            OR v_function_src ILIKE '%SKILL_HASTE_MODIFIER%' THEN
            RAISE EXCEPTION 'precondition result shape function drifted';
        END IF;
    ELSE
        IF v_parent_count <> 88 THEN
            RAISE EXCEPTION 'target parent table count drifted: %', v_parent_count;
        END IF;
        IF v_has_old_targets THEN
            RAISE EXCEPTION 'target state still has skill_effect_cooldown_change_targets';
        END IF;
        IF NOT (
            cardinality(v_actual_values) = cardinality(v_target_result_values)
            AND v_actual_values @> v_target_result_values
            AND v_target_result_values @> v_actual_values
        ) THEN
            RAISE EXCEPTION 'target result type constraint drifted: %', v_actual_values;
        END IF;
        PERFORM 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skill_effect_result_skill_scopes'
           AND column_name = 'mode';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'skill_effect_result_skill_scopes unknown structure';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'skill_effect_result_skill_scopes'
              AND c.conname = 'ck_skill_effect_result_skill_scopes_mode'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'skill_effect_result_skill_targets'
              AND c.conname = 'fk_skill_effect_result_skill_targets_scope'
              AND c.confdeltype = 'c'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'skill_effect_result_skill_targets'
              AND c.conname = 'fk_skill_effect_result_skill_targets_skill'
              AND c.confdeltype = 'a'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'skill_effect_result_skill_targets'
              AND indexname = 'ix_skill_effect_result_skill_targets_skill'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'skill_effect_result_skill_category_targets'
              AND c.conname = 'fk_skill_effect_result_skill_category_targets_category'
              AND c.confdeltype = 'a'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'skill_effect_result_skill_category_targets'
              AND indexname = 'ix_skill_effect_result_skill_category_targets_category'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'skill_effect_haste_modifier_details'
              AND c.conname = 'ck_skill_effect_haste_modifier_details_operation'
        ) THEN
            RAISE EXCEPTION 'target skill scope constraints, indexes or functions are incomplete';
        END IF;
        SELECT pg_get_functiondef('public.trg_skill_effect_result_complete_shape()'::regprocedure)
          INTO v_function_src;
        IF v_function_src NOT ILIKE '%SKILL_HASTE_MODIFIER%'
            OR v_function_src NOT ILIKE '%ALL skill scope must not have targets at commit%'
            OR v_function_src ILIKE '%v_cooldown_target_count%' THEN
            RAISE EXCEPTION 'target result shape function drifted';
        END IF;
        SELECT pg_get_functiondef('public.trg_skill_effect_lifecycle_aggregate_shape()'::regprocedure)
          INTO v_function_src;
        IF v_function_src NOT ILIKE '%SKILL_HASTE_MODIFIER%' THEN
            RAISE EXCEPTION 'target lifecycle aggregate function drifted';
        END IF;
    END IF;
END;
$migration_preflight$;

LOCK TABLE public.skill_effect_results,
    public.skill_effect_cooldown_change_details IN ACCESS EXCLUSIVE MODE;

DO $migration_lock_old$
BEGIN
    IF to_regclass('public.skill_effect_cooldown_change_targets') IS NOT NULL THEN
        EXECUTE 'LOCK TABLE public.skill_effect_cooldown_change_targets IN ACCESS EXCLUSIVE MODE';
    END IF;
END;
$migration_lock_old$;

CREATE TABLE IF NOT EXISTS public.skill_effect_result_skill_scopes (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    mode varchar(16) NOT NULL,
    CONSTRAINT pk_skill_effect_result_skill_scopes
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_result_skill_scopes_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_skill_effect_result_skill_scopes_mode
        CHECK (mode IN ('ALL', 'SKILLS', 'CATEGORIES'))
);

COMMENT ON TABLE public.skill_effect_result_skill_scopes IS '结果级公共技能作用范围';

CREATE TABLE IF NOT EXISTS public.skill_effect_result_skill_targets (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    affected_skill_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_effect_result_skill_targets
        PRIMARY KEY (game_id, skill_key, effect_key, result_key, affected_skill_key),
    CONSTRAINT fk_skill_effect_result_skill_targets_scope
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_result_skill_scopes
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_result_skill_targets_skill
        FOREIGN KEY (game_id, affected_skill_key)
        REFERENCES public.skills (game_id, skill_key)
);

CREATE INDEX IF NOT EXISTS ix_skill_effect_result_skill_targets_skill
    ON public.skill_effect_result_skill_targets
    (game_id, affected_skill_key, skill_key, effect_key, result_key);

COMMENT ON TABLE public.skill_effect_result_skill_targets IS '公共技能作用范围的明确技能关系';

CREATE TABLE IF NOT EXISTS public.skill_effect_result_skill_category_targets (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    skill_category_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_effect_result_skill_category_targets
        PRIMARY KEY (game_id, skill_key, effect_key, result_key, skill_category_key),
    CONSTRAINT fk_skill_effect_result_skill_category_targets_scope
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_result_skill_scopes
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_result_skill_category_targets_category
        FOREIGN KEY (game_id, skill_category_key)
        REFERENCES public.skill_categories (game_id, skill_category_key)
);

CREATE INDEX IF NOT EXISTS ix_skill_effect_result_skill_category_targets_category
    ON public.skill_effect_result_skill_category_targets
    (game_id, skill_category_key, skill_key, effect_key, result_key);

COMMENT ON TABLE public.skill_effect_result_skill_category_targets IS '公共技能作用范围的技能分类关系';

CREATE TABLE IF NOT EXISTS public.skill_effect_haste_modifier_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    operation varchar(16) NOT NULL,
    CONSTRAINT pk_skill_effect_haste_modifier_details
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_haste_modifier_details_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_skill_effect_haste_modifier_details_operation
        CHECK (operation IN ('INCREASE', 'DECREASE'))
);

COMMENT ON TABLE public.skill_effect_haste_modifier_details IS '技能急速修正结果明细';

DO $migration_copy$
DECLARE
    v_has_old_targets boolean;
    v_cooldown_result_count bigint;
    v_old_target_count bigint;
    v_new_scope_count bigint;
    v_new_target_count bigint;
    v_mismatch_count bigint;
BEGIN
    v_has_old_targets := to_regclass('public.skill_effect_cooldown_change_targets') IS NOT NULL;
    IF NOT v_has_old_targets THEN
        RETURN;
    END IF;

    SELECT COUNT(*) INTO v_cooldown_result_count
      FROM public.skill_effect_cooldown_change_details;
    SELECT COUNT(*) INTO v_old_target_count
      FROM public.skill_effect_cooldown_change_targets;

    INSERT INTO public.skill_effect_result_skill_scopes (
        game_id, skill_key, effect_key, result_key, mode
    )
    SELECT d.game_id, d.skill_key, d.effect_key, d.result_key, 'SKILLS'
      FROM public.skill_effect_cooldown_change_details d
    ON CONFLICT DO NOTHING;

    INSERT INTO public.skill_effect_result_skill_targets (
        game_id, skill_key, effect_key, result_key, affected_skill_key
    )
    SELECT t.game_id, t.skill_key, t.effect_key, t.result_key, t.affected_skill_key
      FROM public.skill_effect_cooldown_change_targets t
    ON CONFLICT DO NOTHING;

    SELECT COUNT(*) INTO v_new_scope_count
      FROM public.skill_effect_result_skill_scopes s
      JOIN public.skill_effect_cooldown_change_details d
        ON d.game_id = s.game_id
       AND d.skill_key = s.skill_key
       AND d.effect_key = s.effect_key
       AND d.result_key = s.result_key;
    SELECT COUNT(*) INTO v_new_target_count
      FROM public.skill_effect_result_skill_targets;
    SELECT COUNT(*) INTO v_mismatch_count
      FROM (
          SELECT d.game_id, d.skill_key, d.effect_key, d.result_key,
                 (SELECT COUNT(*)
                    FROM public.skill_effect_cooldown_change_targets t
                   WHERE t.game_id = d.game_id
                     AND t.skill_key = d.skill_key
                     AND t.effect_key = d.effect_key
                     AND t.result_key = d.result_key) AS old_count,
                 (SELECT COUNT(*)
                    FROM public.skill_effect_result_skill_targets n
                   WHERE n.game_id = d.game_id
                     AND n.skill_key = d.skill_key
                     AND n.effect_key = d.effect_key
                     AND n.result_key = d.result_key) AS new_count
            FROM public.skill_effect_cooldown_change_details d
      ) counted
     WHERE counted.old_count <> counted.new_count;

    IF v_new_scope_count <> v_cooldown_result_count
        OR v_new_target_count <> v_old_target_count
        OR v_mismatch_count <> 0 THEN
        RAISE EXCEPTION
            'cooldown target copy count mismatch: results=%/%, relations=%/%, per-result mismatches=%',
            v_new_scope_count, v_cooldown_result_count,
            v_new_target_count, v_old_target_count,
            v_mismatch_count;
    END IF;
END;
$migration_copy$;

ALTER TABLE public.skill_effect_results
    DROP CONSTRAINT IF EXISTS ck_skill_effect_results_type;
ALTER TABLE public.skill_effect_results
    ADD CONSTRAINT ck_skill_effect_results_type
        CHECK (result_type IN (
            'DAMAGE', 'DIRECT_HEAL', 'NORMAL_SHIELD', 'ATTRIBUTE_CHANGE',
            'RESOURCE_CHANGE', 'COOLDOWN_CHANGE', 'STATUS_OPERATION',
            'LIFECYCLE_OPERATION', 'DAMAGE_MODIFIER', 'HEALING_MODIFIER',
            'DAMAGE_IMMUNITY', 'HEALTH_FLOOR', 'SPELL_SHIELD',
            'EXECUTE', 'HIT_LINK_APPLICATION', 'ATTACK_LINK_APPLICATION',
            'SKILL_HASTE_MODIFIER'
        ));

CREATE OR REPLACE FUNCTION public.trg_skill_effect_result_complete_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_game_id varchar(64);
    v_skill_key varchar(64);
    v_effect_key varchar(64);
    v_result_key varchar(64);
    v_result_type varchar(32);
    v_target varchar(16);
    v_result_moment varchar(24);
    v_spell_shield_block_scope varchar(24);
    v_cooldown_operation varchar(16);
    v_lifecycle_operation varchar(24);
    v_modifier_zone_domain varchar(16);
    v_value_count int;
    v_damage_count int;
    v_critical_count int;
    v_vamp_count int;
    v_normal_shield_count int;
    v_damage_modifier_count int;
    v_healing_modifier_count int;
    v_damage_immunity_count int;
    v_health_floor_count int;
    v_execute_count int;
    v_special_count int;
    v_attribute_count int;
    v_resource_count int;
    v_cooldown_count int;
    v_skill_scope_count int;
    v_skill_target_count int;
    v_skill_category_target_count int;
    v_haste_count int;
    v_scope_mode varchar(16);
    v_value_read_mode varchar(32);
    v_stack_value_mode varchar(16);
    v_reapplication_value_mode varchar(16);
    v_periodic_execution_mode varchar(16);
    v_status_count int;
    v_lifecycle_op_count int;
    v_spell_shield_policy_count int;
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
        v_target := NEW.target;
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
        SELECT r.result_type, r.target
          INTO v_result_type, v_target
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
    SELECT COUNT(*) INTO v_critical_count
      FROM public.skill_effect_result_critical_policies d
     WHERE d.game_id = v_game_id
       AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key
       AND d.result_key = v_result_key;
    SELECT COUNT(*) INTO v_vamp_count
      FROM public.skill_effect_result_vamp_rules d
     WHERE d.game_id = v_game_id
       AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key
       AND d.result_key = v_result_key;
    SELECT COUNT(*) INTO v_normal_shield_count
      FROM public.skill_effect_result_normal_shield_interactions d
     WHERE d.game_id = v_game_id
       AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key
       AND d.result_key = v_result_key;
    SELECT COUNT(*) INTO v_damage_modifier_count
      FROM public.skill_effect_damage_modifier_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key AND d.result_key = v_result_key;
    SELECT COUNT(*) INTO v_healing_modifier_count
      FROM public.skill_effect_healing_modifier_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key AND d.result_key = v_result_key;
    SELECT COUNT(*) INTO v_damage_immunity_count
      FROM public.skill_effect_damage_immunity_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key AND d.result_key = v_result_key;
    SELECT COUNT(*) INTO v_health_floor_count
      FROM public.skill_effect_health_floor_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key AND d.result_key = v_result_key;
    SELECT COUNT(*) INTO v_execute_count
      FROM public.skill_effect_execute_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key
       AND d.effect_key = v_effect_key AND d.result_key = v_result_key;
    v_special_count := v_damage_modifier_count + v_healing_modifier_count
        + v_damage_immunity_count + v_health_floor_count;
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
    SELECT COUNT(*) INTO v_skill_scope_count
      FROM public.skill_effect_result_skill_scopes s
     WHERE s.game_id = v_game_id
       AND s.skill_key = v_skill_key
       AND s.effect_key = v_effect_key
       AND s.result_key = v_result_key;
    SELECT COUNT(*) INTO v_skill_target_count
      FROM public.skill_effect_result_skill_targets t
     WHERE t.game_id = v_game_id
       AND t.skill_key = v_skill_key
       AND t.effect_key = v_effect_key
       AND t.result_key = v_result_key;
    SELECT COUNT(*) INTO v_skill_category_target_count
      FROM public.skill_effect_result_skill_category_targets t
     WHERE t.game_id = v_game_id
       AND t.skill_key = v_skill_key
       AND t.effect_key = v_effect_key
       AND t.result_key = v_result_key;
    SELECT COUNT(*) INTO v_haste_count
      FROM public.skill_effect_haste_modifier_details d
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
    SELECT COUNT(*), max(p.block_scope)
      INTO v_spell_shield_policy_count, v_spell_shield_block_scope
      FROM public.skill_effect_result_spell_shield_policies p
     WHERE p.game_id = v_game_id
       AND p.skill_key = v_skill_key
       AND p.effect_key = v_effect_key
       AND p.result_key = v_result_key;
    SELECT b.moment,
           b.value_read_mode,
           b.stack_value_mode,
           b.reapplication_value_mode,
           b.periodic_execution_mode
      INTO v_result_moment,
           v_value_read_mode,
           v_stack_value_mode,
           v_reapplication_value_mode,
           v_periodic_execution_mode
      FROM public.skill_effect_result_lifecycle_behaviors b
     WHERE b.game_id = v_game_id
       AND b.skill_key = v_skill_key
       AND b.effect_key = v_effect_key
       AND b.result_key = v_result_key;

    IF v_result_type = 'DAMAGE' THEN
        IF v_value_count <> 1
            OR v_damage_count <> 1
            OR v_critical_count <> 1
            OR v_vamp_count < 0 OR v_vamp_count > 4
            OR v_normal_shield_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 OR v_execute_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) DAMAGE shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'DIRECT_HEAL' THEN
        IF v_value_count <> 1
            OR v_damage_count <> 0
            OR v_critical_count <> 0
            OR v_vamp_count <> 0
            OR v_normal_shield_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 OR v_execute_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) % shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key, v_result_type
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'NORMAL_SHIELD' THEN
        IF v_value_count <> 1
            OR v_damage_count <> 0
            OR v_critical_count <> 0
            OR v_vamp_count <> 0
            OR v_normal_shield_count <> 1
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 OR v_execute_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) NORMAL_SHIELD shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'ATTRIBUTE_CHANGE' THEN
        IF v_value_count <> 1
            OR v_damage_count <> 0
            OR v_critical_count <> 0
            OR v_vamp_count <> 0
            OR v_normal_shield_count <> 0
            OR v_attribute_count <> 1
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 OR v_execute_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) ATTRIBUTE_CHANGE shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT z.domain
          INTO v_modifier_zone_domain
          FROM public.skill_effect_attribute_change_details d
          JOIN public.modifier_zones z
            ON z.game_id = d.game_id
           AND z.modifier_zone_key = d.modifier_zone_key
         WHERE d.game_id = v_game_id
           AND d.skill_key = v_skill_key
           AND d.effect_key = v_effect_key
           AND d.result_key = v_result_key;
        IF FOUND AND v_modifier_zone_domain IS DISTINCT FROM 'ATTRIBUTE' THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) ATTRIBUTE_CHANGE modifier zone domain invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'RESOURCE_CHANGE' THEN
        IF v_value_count <> 1
            OR v_damage_count <> 0
            OR v_critical_count <> 0
            OR v_vamp_count <> 0
            OR v_normal_shield_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 1
            OR v_cooldown_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 OR v_execute_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) RESOURCE_CHANGE shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'COOLDOWN_CHANGE' THEN
        IF v_cooldown_count <> 1
            OR v_skill_scope_count <> 1
            OR v_haste_count <> 0
            OR v_damage_count <> 0
            OR v_critical_count <> 0
            OR v_vamp_count <> 0
            OR v_normal_shield_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 OR v_execute_count <> 0 THEN
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
            OR v_critical_count <> 0
            OR v_vamp_count <> 0
            OR v_normal_shield_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 1
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 OR v_execute_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) STATUS_OPERATION shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'LIFECYCLE_OPERATION' THEN
        IF v_lifecycle_op_count <> 1
            OR v_damage_count <> 0
            OR v_critical_count <> 0
            OR v_vamp_count <> 0
            OR v_normal_shield_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 0 OR v_special_count <> 0 OR v_execute_count <> 0 THEN
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
    ELSIF v_result_type = 'DAMAGE_MODIFIER' THEN
        IF v_value_count <> 1 OR v_damage_modifier_count <> 1 OR v_special_count <> 1
            OR v_damage_count + v_critical_count + v_vamp_count + v_normal_shield_count
                + v_attribute_count + v_resource_count + v_cooldown_count
                + v_status_count + v_lifecycle_op_count + v_execute_count <> 0 THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) DAMAGE_MODIFIER shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key USING ERRCODE = 'check_violation';
        END IF;
        SELECT z.domain
          INTO v_modifier_zone_domain
          FROM public.skill_effect_damage_modifier_details d
          JOIN public.modifier_zones z
            ON z.game_id = d.game_id
           AND z.modifier_zone_key = d.modifier_zone_key
         WHERE d.game_id = v_game_id
           AND d.skill_key = v_skill_key
           AND d.effect_key = v_effect_key
           AND d.result_key = v_result_key;
        IF v_modifier_zone_domain IS DISTINCT FROM 'DAMAGE' THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) DAMAGE_MODIFIER modifier zone domain invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'HEALING_MODIFIER' THEN
        IF v_value_count <> 1 OR v_healing_modifier_count <> 1 OR v_special_count <> 1
            OR v_damage_count + v_critical_count + v_vamp_count + v_normal_shield_count
                + v_attribute_count + v_resource_count + v_cooldown_count
                + v_status_count + v_lifecycle_op_count + v_execute_count <> 0 THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) HEALING_MODIFIER shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key USING ERRCODE = 'check_violation';
        END IF;
        SELECT z.domain
          INTO v_modifier_zone_domain
          FROM public.skill_effect_healing_modifier_details d
          JOIN public.modifier_zones z
            ON z.game_id = d.game_id
           AND z.modifier_zone_key = d.modifier_zone_key
         WHERE d.game_id = v_game_id
           AND d.skill_key = v_skill_key
           AND d.effect_key = v_effect_key
           AND d.result_key = v_result_key;
        IF v_modifier_zone_domain IS DISTINCT FROM 'HEALING' THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) HEALING_MODIFIER modifier zone domain invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'DAMAGE_IMMUNITY' THEN
        IF v_value_count <> 0 OR v_damage_immunity_count <> 1 OR v_special_count <> 1
            OR v_damage_count + v_critical_count + v_vamp_count + v_normal_shield_count
                + v_attribute_count + v_resource_count + v_cooldown_count
                + v_status_count + v_lifecycle_op_count + v_execute_count <> 0 THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) DAMAGE_IMMUNITY shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'HEALTH_FLOOR' THEN
        IF v_value_count <> 1 OR v_health_floor_count <> 1 OR v_special_count <> 1
            OR v_damage_count + v_critical_count + v_vamp_count + v_normal_shield_count
                + v_attribute_count + v_resource_count + v_cooldown_count
                + v_status_count + v_lifecycle_op_count + v_execute_count <> 0 THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) HEALTH_FLOOR shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'SPELL_SHIELD' THEN
        IF v_value_count <> 0
            OR v_damage_count + v_critical_count + v_vamp_count + v_normal_shield_count
                + v_attribute_count + v_resource_count + v_cooldown_count
                + v_status_count + v_lifecycle_op_count + v_special_count + v_execute_count <> 0 THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) SPELL_SHIELD shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'EXECUTE' THEN
        IF v_value_count <> 1
            OR v_execute_count <> 1
            OR v_result_moment = 'PERSISTENT'
            OR v_damage_count + v_critical_count + v_vamp_count + v_normal_shield_count
                + v_attribute_count + v_resource_count + v_cooldown_count
                + v_status_count + v_lifecycle_op_count + v_special_count <> 0 THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) EXECUTE shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type IN ('HIT_LINK_APPLICATION', 'ATTACK_LINK_APPLICATION') THEN
        IF v_value_count <> 1
            OR v_execute_count <> 0
            OR v_result_moment = 'PERSISTENT'
            OR v_damage_count + v_critical_count + v_vamp_count + v_normal_shield_count
                + v_attribute_count + v_resource_count + v_cooldown_count
                + v_status_count + v_lifecycle_op_count + v_special_count <> 0 THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) % shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key, v_result_type
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'SKILL_HASTE_MODIFIER' THEN
        IF v_value_count <> 1
            OR v_skill_scope_count <> 1
            OR v_haste_count <> 1
            OR v_result_moment IS DISTINCT FROM 'PERSISTENT'
            OR v_value_read_mode IS DISTINCT FROM 'APPLICATION_SNAPSHOT'
            OR v_stack_value_mode IS DISTINCT FROM 'SHARED'
            OR v_reapplication_value_mode IS DISTINCT FROM 'KEEP'
            OR v_periodic_execution_mode IS NOT NULL
            OR v_spell_shield_policy_count <> 0
            OR v_damage_count <> 0
            OR v_critical_count <> 0
            OR v_vamp_count <> 0
            OR v_normal_shield_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 OR v_execute_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) SKILL_HASTE_MODIFIER shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        RAISE EXCEPTION
            'skill_effect_results(%, %, %, %) has unsupported result_type %',
            v_game_id, v_skill_key, v_effect_key, v_result_key, v_result_type
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_result_type IN ('COOLDOWN_CHANGE', 'SKILL_HASTE_MODIFIER') THEN
        SELECT s.mode
          INTO v_scope_mode
          FROM public.skill_effect_result_skill_scopes s
         WHERE s.game_id = v_game_id
           AND s.skill_key = v_skill_key
           AND s.effect_key = v_effect_key
           AND s.result_key = v_result_key;
        IF v_scope_mode = 'ALL' THEN
            IF v_skill_target_count <> 0 OR v_skill_category_target_count <> 0 THEN
                RAISE EXCEPTION
                    'skill_effect_results(%, %, %, %) ALL skill scope must not have targets at commit',
                    v_game_id, v_skill_key, v_effect_key, v_result_key
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSIF v_scope_mode = 'SKILLS' THEN
            IF v_skill_target_count < 1 OR v_skill_category_target_count <> 0 THEN
                RAISE EXCEPTION
                    'skill_effect_results(%, %, %, %) SKILLS scope requires explicit skills at commit',
                    v_game_id, v_skill_key, v_effect_key, v_result_key
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSIF v_scope_mode = 'CATEGORIES' THEN
            IF v_skill_target_count <> 0 OR v_skill_category_target_count < 1 THEN
                RAISE EXCEPTION
                    'skill_effect_results(%, %, %, %) CATEGORIES scope requires skill categories at commit',
                    v_game_id, v_skill_key, v_effect_key, v_result_key
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSE
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) skill scope mode invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_skill_scope_count <> 0 OR v_haste_count <> 0 THEN
        RAISE EXCEPTION
            'skill_effect_results(%, %, %, %) % must not have skill scope or haste detail at commit',
            v_game_id, v_skill_key, v_effect_key, v_result_key, v_result_type
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_spell_shield_policy_count > 0 THEN
        IF v_target IS DISTINCT FROM 'TARGET'
            OR v_result_moment = 'PERSISTENT'
            OR v_result_type NOT IN (
                'DAMAGE', 'ATTRIBUTE_CHANGE', 'RESOURCE_CHANGE',
                'COOLDOWN_CHANGE', 'STATUS_OPERATION', 'LIFECYCLE_OPERATION',
                'EXECUTE', 'HIT_LINK_APPLICATION', 'ATTACK_LINK_APPLICATION'
            )
            OR (
                v_spell_shield_block_scope = 'DAMAGE_INSTANCE'
                AND v_result_type <> 'DAMAGE'
            ) THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) spell shield block scope invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
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
        'skill_effect_result_critical_policies',
        'skill_effect_result_vamp_rules',
        'skill_effect_result_normal_shield_interactions',
        'skill_effect_result_spell_shield_policies',
        'skill_effect_damage_modifier_details',
        'skill_effect_healing_modifier_details',
        'skill_effect_damage_immunity_details',
        'skill_effect_health_floor_details',
        'skill_effect_execute_details',
        'skill_effect_attribute_change_details',
        'skill_effect_resource_change_details',
        'skill_effect_cooldown_change_details',
        'skill_effect_result_skill_scopes',
        'skill_effect_result_skill_targets',
        'skill_effect_result_skill_category_targets',
        'skill_effect_haste_modifier_details',
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
    v_expiry_mode varchar(24);
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
    v_modifier_zone_key varchar(64);
    v_normal_shield_decay_mode varchar(32);
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
           l.expiry_mode,
           l.periodic_interval_formula_key,
           l.first_periodic_execution
      INTO v_has_lifecycle,
           v_duration_formula_key,
           v_expiry_mode,
           v_periodic_interval_formula_key,
           v_first_periodic_execution
      FROM public.skill_effect_lifecycles l
     WHERE l.game_id = v_game_id
       AND l.skill_key = v_skill_key
       AND l.effect_key = v_effect_key;
    IF NOT FOUND THEN
        v_has_lifecycle := false;
        v_duration_formula_key := NULL;
        v_expiry_mode := NULL;
        v_periodic_interval_formula_key := NULL;
        v_first_periodic_execution := NULL;
    END IF;

    IF NOT v_has_lifecycle THEN
        IF EXISTS (
            SELECT 1
              FROM public.skill_effect_results r
             WHERE r.game_id = v_game_id
               AND r.skill_key = v_skill_key
               AND r.effect_key = v_effect_key
               AND r.result_type IN (
                   'NORMAL_SHIELD', 'DAMAGE_MODIFIER', 'HEALING_MODIFIER',
                   'DAMAGE_IMMUNITY', 'HEALTH_FLOOR', 'SPELL_SHIELD',
                   'SKILL_HASTE_MODIFIER'
               )
        ) THEN
            RAISE EXCEPTION
                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: persistent result requires lifecycle',
                v_game_id, v_skill_key, v_effect_key
                USING ERRCODE = 'check_violation';
        END IF;
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
        IF EXISTS (
            SELECT 1
              FROM public.skill_trigger_rule_spell_shield_blocked_events e
             WHERE e.game_id = v_game_id
               AND e.skill_key = v_skill_key
               AND e.shield_effect_key = v_effect_key
        ) THEN
            RAISE EXCEPTION
                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: referenced spell shield requires lifecycle',
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

        IF v_result.result_type IN (
                'NORMAL_SHIELD', 'DAMAGE_MODIFIER', 'HEALING_MODIFIER',
                'DAMAGE_IMMUNITY', 'HEALTH_FLOOR', 'SPELL_SHIELD',
                'SKILL_HASTE_MODIFIER'
            )
            AND v_moment IS DISTINCT FROM 'PERSISTENT' THEN
            RAISE EXCEPTION
                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % must be PERSISTENT',
                v_game_id, v_skill_key, v_effect_key, v_result.result_key
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_moment = 'PERSISTENT' THEN
            IF v_result.result_type NOT IN (
                'NORMAL_SHIELD', 'ATTRIBUTE_CHANGE', 'STATUS_OPERATION',
                'DAMAGE_MODIFIER', 'HEALING_MODIFIER', 'DAMAGE_IMMUNITY', 'HEALTH_FLOOR',
                'SPELL_SHIELD', 'SKILL_HASTE_MODIFIER'
            ) THEN
                RAISE EXCEPTION
                    'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % cannot be PERSISTENT',
                    v_game_id, v_skill_key, v_effect_key, v_result.result_key
                    USING ERRCODE = 'check_violation';
            END IF;
            IF v_result.result_type IN ('STATUS_OPERATION', 'DAMAGE_IMMUNITY', 'SPELL_SHIELD') THEN
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
                ELSIF v_value_read_mode = 'MOMENT_EVALUATION' THEN
                    IF v_reapplication_value_mode IS NOT NULL THEN
                        RAISE EXCEPTION
                            'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % MOMENT_EVALUATION forbids reapplication_value_mode',
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
                    SELECT d.operation, d.modifier_zone_key
                      INTO v_attribute_operation, v_modifier_zone_key
                      FROM public.skill_effect_attribute_change_details d
                     WHERE d.game_id = v_game_id
                       AND d.skill_key = v_skill_key
                       AND d.effect_key = v_effect_key
                       AND d.result_key = v_result.result_key;
                    IF v_attribute_operation = 'SET' THEN
                        IF v_modifier_zone_key IS NOT NULL THEN
                            RAISE EXCEPTION
                                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % SET forbids modifier zone',
                                v_game_id, v_skill_key, v_effect_key, v_result.result_key
                                USING ERRCODE = 'check_violation';
                        END IF;
                        IF v_stack_value_mode IS DISTINCT FROM 'SHARED'
                            OR v_reapplication_value_mode NOT IN ('KEEP', 'REPLACE') THEN
                            RAISE EXCEPTION
                                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % SET stack merge invalid',
                                v_game_id, v_skill_key, v_effect_key, v_result.result_key
                                USING ERRCODE = 'check_violation';
                        END IF;
                    ELSIF v_modifier_zone_key IS NULL THEN
                        RAISE EXCEPTION
                            'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % persistent attribute adjustment requires modifier zone',
                            v_game_id, v_skill_key, v_effect_key, v_result.result_key
                            USING ERRCODE = 'check_violation';
                    END IF;
                END IF;
                IF v_result.result_type = 'HEALTH_FLOOR'
                    AND (
                        v_stack_value_mode IS DISTINCT FROM 'SHARED'
                        OR v_reapplication_value_mode NOT IN ('KEEP', 'REPLACE')
                    ) THEN
                    RAISE EXCEPTION
                        'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % HEALTH_FLOOR stack merge invalid',
                        v_game_id, v_skill_key, v_effect_key, v_result.result_key
                        USING ERRCODE = 'check_violation';
                END IF;
                IF v_result.result_type = 'SKILL_HASTE_MODIFIER'
                    AND (
                        v_value_read_mode IS DISTINCT FROM 'APPLICATION_SNAPSHOT'
                        OR v_stack_value_mode IS DISTINCT FROM 'SHARED'
                        OR v_reapplication_value_mode IS DISTINCT FROM 'KEEP'
                    ) THEN
                    RAISE EXCEPTION
                        'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % SKILL_HASTE_MODIFIER snapshot merge invalid',
                        v_game_id, v_skill_key, v_effect_key, v_result.result_key
                        USING ERRCODE = 'check_violation';
                END IF;
                IF v_result.result_type = 'NORMAL_SHIELD' THEN
                    SELECT d.decay_mode
                      INTO v_normal_shield_decay_mode
                      FROM public.skill_effect_result_normal_shield_interactions d
                     WHERE d.game_id = v_game_id
                       AND d.skill_key = v_skill_key
                       AND d.effect_key = v_effect_key
                       AND d.result_key = v_result.result_key;
                    IF v_normal_shield_decay_mode = 'LINEAR_TO_ZERO'
                        AND (
                            v_duration_formula_key IS NULL
                            OR v_expiry_mode IS DISTINCT FROM 'ALL_AT_ONCE'
                            OR v_stack_value_mode IS DISTINCT FROM 'SHARED'
                        ) THEN
                        RAISE EXCEPTION
                            'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % linear shield decay invalid',
                            v_game_id, v_skill_key, v_effect_key, v_result.result_key
                            USING ERRCODE = 'check_violation';
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
            IF v_result.result_type = 'ATTRIBUTE_CHANGE'
                AND EXISTS (
                    SELECT 1
                      FROM public.skill_effect_attribute_change_details d
                     WHERE d.game_id = v_game_id
                       AND d.skill_key = v_skill_key
                       AND d.effect_key = v_effect_key
                       AND d.result_key = v_result.result_key
                       AND d.modifier_zone_key IS NOT NULL
                ) THEN
                RAISE EXCEPTION
                    'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % non-persistent attribute change forbids modifier zone',
                    v_game_id, v_skill_key, v_effect_key, v_result.result_key
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        IF v_moment = 'PERSISTENT' AND EXISTS (
            SELECT 1
              FROM public.skill_effect_result_spell_shield_policies p
             WHERE p.game_id = v_game_id
               AND p.skill_key = v_skill_key
               AND p.effect_key = v_effect_key
               AND p.result_key = v_result.result_key
        ) THEN
            RAISE EXCEPTION
                'skill_effects(%, %, %) lifecycle aggregate invalid at commit: persistent result % cannot be spell-shield blockable',
                v_game_id, v_skill_key, v_effect_key, v_result.result_key
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_value_count > 0 THEN
            IF v_value_read_mode IS NULL THEN
                RAISE EXCEPTION
                    'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % value_read_mode required',
                    v_game_id, v_skill_key, v_effect_key, v_result.result_key
                    USING ERRCODE = 'check_violation';
            END IF;
            IF v_moment = 'APPLICATION'
                AND v_value_read_mode IS DISTINCT FROM 'APPLICATION_SNAPSHOT' THEN
                RAISE EXCEPTION
                    'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % APPLICATION must snapshot',
                    v_game_id, v_skill_key, v_effect_key, v_result.result_key
                    USING ERRCODE = 'check_violation';
            END IF;
            IF v_moment = 'PERSISTENT' AND v_value_read_mode = 'MOMENT_EVALUATION' THEN
                IF v_result.result_type NOT IN ('ATTRIBUTE_CHANGE', 'DAMAGE_MODIFIER', 'HEALING_MODIFIER')
                    OR (
                        v_result.result_type = 'ATTRIBUTE_CHANGE'
                        AND EXISTS (
                            SELECT 1
                              FROM public.skill_effect_attribute_change_details d
                             WHERE d.game_id = v_game_id
                               AND d.skill_key = v_skill_key
                               AND d.effect_key = v_effect_key
                               AND d.result_key = v_result.result_key
                               AND d.operation = 'SET'
                        )
                    ) THEN
                    RAISE EXCEPTION
                        'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % cannot use MOMENT_EVALUATION',
                        v_game_id, v_skill_key, v_effect_key, v_result.result_key
                        USING ERRCODE = 'check_violation';
                END IF;
                IF EXISTS (
                    SELECT 1
                      FROM public.skill_effect_result_values rv
                      JOIN public.skill_formula_nodes n
                        ON n.game_id = rv.game_id
                       AND n.skill_key = rv.skill_key
                       AND n.formula_key = rv.formula_key
                      JOIN public.skill_parameters p
                        ON p.game_id = n.game_id
                       AND p.skill_key = n.skill_key
                       AND p.parameter_key = n.parameter_key
                     WHERE rv.game_id = v_game_id
                       AND rv.skill_key = v_skill_key
                       AND rv.effect_key = v_effect_key
                       AND rv.result_key = v_result.result_key
                       AND p.value_mode = 'RUNTIME_INPUT'
                ) THEN
                    RAISE EXCEPTION
                        'skill_effects(%, %, %) lifecycle aggregate invalid at commit: result % MOMENT_EVALUATION formula uses runtime input',
                        v_game_id, v_skill_key, v_effect_key, v_result.result_key
                        USING ERRCODE = 'check_violation';
                END IF;
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

    IF EXISTS (
        SELECT 1
          FROM public.skill_trigger_rule_spell_shield_blocked_events e
         WHERE e.game_id = v_game_id
           AND e.skill_key = v_skill_key
           AND e.shield_effect_key = v_effect_key
    ) AND NOT EXISTS (
        SELECT 1
          FROM public.skill_effect_results r
          JOIN public.skill_effect_result_lifecycle_behaviors b
            ON b.game_id = r.game_id
           AND b.skill_key = r.skill_key
           AND b.effect_key = r.effect_key
           AND b.result_key = r.result_key
         WHERE r.game_id = v_game_id
           AND r.skill_key = v_skill_key
           AND r.effect_key = v_effect_key
           AND r.result_type = 'SPELL_SHIELD'
           AND b.moment = 'PERSISTENT'
    ) THEN
        RAISE EXCEPTION
            'skill_effects(%, %, %) lifecycle aggregate invalid at commit: referenced spell shield result missing',
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

DROP TRIGGER IF EXISTS trg_skill_effect_normal_shield_interactions_aggregate_shape
    ON public.skill_effect_result_normal_shield_interactions;
CREATE CONSTRAINT TRIGGER trg_skill_effect_normal_shield_interactions_aggregate_shape
AFTER INSERT OR UPDATE OR DELETE ON public.skill_effect_result_normal_shield_interactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_skill_effect_lifecycle_aggregate_shape();

DO $migration_drop_old$
BEGIN
    IF to_regclass('public.skill_effect_cooldown_change_targets') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trg_skill_effect_cooldown_change_targets_complete_shape ON public.skill_effect_cooldown_change_targets';
        EXECUTE 'DROP TABLE public.skill_effect_cooldown_change_targets';
    END IF;
END;
$migration_drop_old$;

DO $migration_postcheck$
DECLARE
    v_parent_count integer;
    v_new_count integer;
    v_constraint_def text;
    v_actual_values text[];
    v_function_src text;
    v_event_type_count integer;
    v_output_count integer;
    v_event_value_count integer;
    v_target_result_values constant text[] := ARRAY[
        'ATTACK_LINK_APPLICATION', 'ATTRIBUTE_CHANGE', 'COOLDOWN_CHANGE', 'DAMAGE',
        'DAMAGE_IMMUNITY', 'DAMAGE_MODIFIER', 'DIRECT_HEAL', 'EXECUTE',
        'HEALING_MODIFIER', 'HEALTH_FLOOR', 'HIT_LINK_APPLICATION',
        'LIFECYCLE_OPERATION', 'NORMAL_SHIELD', 'RESOURCE_CHANGE', 'SKILL_HASTE_MODIFIER',
        'SPELL_SHIELD', 'STATUS_OPERATION'
    ];
    v_new_tables constant text[] := ARRAY[
        'skill_effect_result_skill_scopes',
        'skill_effect_result_skill_targets',
        'skill_effect_result_skill_category_targets',
        'skill_effect_haste_modifier_details'
    ];
BEGIN
    IF to_regclass('public.skill_effect_cooldown_change_targets') IS NOT NULL THEN
        RAISE EXCEPTION 'old cooldown target table still exists after migration';
    END IF;

    SELECT COUNT(*)
      INTO v_parent_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r';
    IF v_parent_count <> 88 THEN
        RAISE EXCEPTION 'migration postcheck parent table count drifted: %', v_parent_count;
    END IF;

    SELECT COUNT(*)
      INTO v_new_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname = ANY (v_new_tables);
    IF v_new_count <> 4 THEN
        RAISE EXCEPTION 'migration postcheck new tables missing: %', v_new_count;
    END IF;

    v_constraint_def := NULL;
    FOR v_constraint_def IN
        SELECT pg_get_constraintdef(c.oid)
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'skill_effect_results'
           AND c.conname = 'ck_skill_effect_results_type'
    LOOP
        SELECT array_agg(match[1] ORDER BY match[1])
          INTO v_actual_values
          FROM regexp_matches(v_constraint_def, '''([A-Z_]+)''', 'g') AS match;
    END LOOP;
    IF NOT (
        cardinality(v_actual_values) = cardinality(v_target_result_values)
        AND v_actual_values @> v_target_result_values
        AND v_target_result_values @> v_actual_values
    ) THEN
        RAISE EXCEPTION 'migration postcheck result type constraint drifted: %', v_actual_values;
    END IF;

    SELECT cardinality(array_agg(match[1]))
      INTO v_event_type_count
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([A-Z_]+)''', 'g') AS match
     WHERE n.nspname = 'public'
       AND t.relname = 'skill_trigger_rules'
       AND c.conname = 'ck_skill_trigger_rules_event_type';
    SELECT cardinality(array_agg(match[1]))
      INTO v_output_count
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([A-Z_]+)''', 'g') AS match
     WHERE n.nspname = 'public'
       AND t.relname = 'skill_trigger_rule_prior_result_bindings'
       AND c.conname = 'ck_skill_trigger_prior_result_bind_output';
    SELECT cardinality(array_agg(DISTINCT match[1]))
      INTO v_event_value_count
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([A-Z_]+)''', 'g') AS match
     WHERE n.nspname = 'public'
       AND t.relname = 'skill_trigger_rule_event_value_conditions'
       AND c.conname = 'ck_skill_trigger_event_value_cond_key';
    IF v_event_type_count IS DISTINCT FROM 21
        OR v_output_count IS DISTINCT FROM 10
        OR v_event_value_count IS DISTINCT FROM 23 THEN
        RAISE EXCEPTION 'migration postcheck event/output/event-value counts drifted: events=%, outputs=%, values=%',
            v_event_type_count, v_output_count, v_event_value_count;
    END IF;

    SELECT pg_get_functiondef('public.trg_skill_effect_result_complete_shape()'::regprocedure)
      INTO v_function_src;
    IF v_function_src NOT ILIKE '%SKILL_HASTE_MODIFIER%'
        OR v_function_src NOT ILIKE '%ALL skill scope must not have targets at commit%'
        OR v_function_src ILIKE '%v_cooldown_target_count%' THEN
        RAISE EXCEPTION 'migration postcheck result shape function drifted';
    END IF;
    SELECT pg_get_functiondef('public.trg_skill_effect_lifecycle_aggregate_shape()'::regprocedure)
      INTO v_function_src;
    IF v_function_src NOT ILIKE '%SKILL_HASTE_MODIFIER%' THEN
        RAISE EXCEPTION 'migration postcheck lifecycle aggregate function drifted';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'skill_effect_result_skill_targets'
          AND c.conname = 'fk_skill_effect_result_skill_targets_skill'
          AND c.confdeltype = 'a'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'skill_effect_result_skill_targets'
          AND indexname = 'ix_skill_effect_result_skill_targets_skill'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'skill_effect_result_skill_category_targets'
          AND c.conname = 'fk_skill_effect_result_skill_category_targets_category'
          AND c.confdeltype = 'a'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'skill_effect_haste_modifier_details'
          AND c.conname = 'ck_skill_effect_haste_modifier_details_operation'
    ) THEN
        RAISE EXCEPTION 'migration postcheck constraints or indexes missing';
    END IF;
END;
$migration_postcheck$;

COMMIT;
