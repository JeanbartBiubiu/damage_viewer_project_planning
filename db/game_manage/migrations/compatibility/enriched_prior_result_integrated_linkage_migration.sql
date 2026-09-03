-- 阶段 7.6.5：扩展前序结果输出与事件值固定检查。
-- 只接受完整前置（阶段 7.6.4 + 乘区基线）或完整目标检查；部分完成、未知值或两处事件值不一致必须失败。
-- 本脚本不写业务数据、不回填、不双写、不 CASCADE、不增加表或列。

BEGIN;

DO $migration_preflight$
DECLARE
    v_parent_count integer;
    v_stage76_count integer;
    v_constraint_def text;
    v_actual_values text[];
    v_cond_values text[];
    v_bind_values text[];
    v_output_values text[];
    v_function_src text;
    v_unknown_event_value_rows integer;
    v_unknown_output_rows integer;
    v_event_value_state text;
    v_output_state text;
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
    v_target_result_values constant text[] := ARRAY[
        'ATTACK_LINK_APPLICATION', 'ATTRIBUTE_CHANGE', 'COOLDOWN_CHANGE', 'DAMAGE',
        'DAMAGE_IMMUNITY', 'DAMAGE_MODIFIER', 'DIRECT_HEAL', 'EXECUTE',
        'HEALING_MODIFIER', 'HEALTH_FLOOR', 'HIT_LINK_APPLICATION',
        'LIFECYCLE_OPERATION', 'NORMAL_SHIELD', 'RESOURCE_CHANGE', 'SPELL_SHIELD',
        'STATUS_OPERATION'
    ];
    v_target_event_types constant text[] := ARRAY[
        'ATTACK_LINK_APPLIED', 'BASIC_ATTACK_HIT', 'BASIC_ATTACK_START', 'CONTROL_RECEIVED',
        'DAMAGE_DEALT', 'DAMAGE_PENDING', 'DAMAGE_TAKEN', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
        'HEALTH_THRESHOLD_CROSSED', 'HIT_LINK_APPLIED', 'INTERNAL_STATE_CHANGED', 'KILL',
        'LIFECYCLE_MOMENT', 'PROCESS_CANCEL_REQUESTED', 'PROCESS_MOMENT', 'RESULT_AVAILABLE',
        'SKILL_HIT', 'SKILL_USED', 'SPELL_SHIELD_BLOCKED', 'STATUS_CHANGED'
    ];
    v_previous_event_value_keys constant text[] := ARRAY[
        'ATTRIBUTE_AFTER', 'ATTRIBUTE_BEFORE', 'CHARGE_DURATION_MS', 'HEALTH_BEFORE',
        'HIT_INDEX', 'LIFECYCLE_STACKS', 'PERIOD_INDEX', 'POST_DEFENSE_DAMAGE',
        'PROJECTED_HEALTH_AFTER', 'RAW_DAMAGE', 'RECAST_COUNT', 'REMAINING_MS',
        'STATE_AFTER', 'STATE_BEFORE', 'STEP_EXECUTION_INDEX', 'THRESHOLD_VALUE'
    ];
    v_target_event_value_keys constant text[] := ARRAY[
        'ACTUAL_HP_LOSS', 'ATTRIBUTE_AFTER', 'ATTRIBUTE_BEFORE', 'BLOCKED',
        'CHARGE_DURATION_MS', 'HEALTH_BEFORE', 'HIT_INDEX', 'IMMUNE', 'KILLED',
        'LIFECYCLE_STACKS', 'LINK_COUNT', 'LINK_INDEX', 'PERIOD_INDEX',
        'POST_DEFENSE_DAMAGE', 'PROJECTED_HEALTH_AFTER', 'RAW_DAMAGE', 'RECAST_COUNT',
        'REMAINING_MS', 'SHIELD_ABSORBED', 'STATE_AFTER', 'STATE_BEFORE',
        'STEP_EXECUTION_INDEX', 'THRESHOLD_VALUE'
    ];
    v_previous_output_kinds constant text[] := ARRAY['CONFIGURED_VALUE'];
    v_target_output_kinds constant text[] := ARRAY[
        'ACTUAL_HEALING', 'ACTUAL_HP_LOSS', 'BLOCKED', 'CONFIGURED_VALUE',
        'IMMUNE', 'KILLED', 'POST_DEFENSE_DAMAGE', 'RAW_DAMAGE',
        'SHIELD_ABSORBED', 'STATUS_APPLIED'
    ];
BEGIN
    IF to_regclass('public.skill_effect_execute_details') IS NULL
        OR to_regclass('public.skill_trigger_rule_link_events') IS NULL
        OR to_regclass('public.modifier_zones') IS NULL
        OR to_regclass('public.skill_effect_cooldown_change_targets') IS NULL
        OR to_regclass('public.skill_trigger_rule_prior_result_bindings') IS NULL
        OR to_regclass('public.skill_trigger_rule_event_value_conditions') IS NULL
        OR to_regclass('public.skill_trigger_rule_event_value_bindings') IS NULL
        OR to_regclass('public.skill_effect_result_lifecycle_behaviors') IS NULL THEN
        RAISE EXCEPTION 'stage 7.6.4 schema is required before stage 7.6.5';
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
    IF v_parent_count <> 85 THEN
        RAISE EXCEPTION 'parent table count drifted: %', v_parent_count;
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

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'skill_effect_damage_modifier_details'
          AND c.conname = 'fk_skill_effect_damage_modifier_zone'
          AND c.contype = 'f'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'skill_effect_healing_modifier_details'
          AND c.conname = 'fk_skill_effect_healing_modifier_zone'
          AND c.contype = 'f'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'skill_effect_attribute_change_details'
          AND c.conname = 'fk_skill_effect_attribute_change_details_zone'
          AND c.contype = 'f'
    ) THEN
        RAISE EXCEPTION 'modifier_zone result references drifted';
    END IF;

    IF to_regprocedure('public.trg_skill_effect_result_complete_shape()') IS NULL
        OR to_regprocedure('public.trg_skill_effect_lifecycle_aggregate_shape()') IS NULL
        OR to_regprocedure('public.trg_skill_trigger_rule_complete_shape()') IS NULL THEN
        RAISE EXCEPTION 'stage 7.6.4 shape functions are missing';
    END IF;
    SELECT pg_get_functiondef('public.trg_skill_effect_result_complete_shape()'::regprocedure)
      INTO v_function_src;
    IF v_function_src NOT ILIKE '%modifier zone domain invalid at commit%' THEN
        RAISE EXCEPTION 'stage 7.6.4 result shape function drifted';
    END IF;
    SELECT pg_get_functiondef('public.trg_skill_effect_lifecycle_aggregate_shape()'::regprocedure)
      INTO v_function_src;
    IF v_function_src NOT ILIKE '%MOMENT_EVALUATION%' THEN
        RAISE EXCEPTION 'stage 7.6.4 lifecycle aggregate function drifted';
    END IF;
    SELECT pg_get_functiondef('public.trg_skill_trigger_rule_complete_shape()'::regprocedure)
      INTO v_function_src;
    IF v_function_src NOT ILIKE '%v_link_event_count%'
        OR v_function_src NOT ILIKE '%HIT_LINK_APPLIED%' THEN
        RAISE EXCEPTION 'stage 7.6.4 trigger-rule shape function drifted';
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
        IF NOT (
            cardinality(v_actual_values) = cardinality(v_target_result_values)
            AND v_actual_values @> v_target_result_values
            AND v_target_result_values @> v_actual_values
        ) THEN
            RAISE EXCEPTION 'skill effect result type constraint drifted: %', v_actual_values;
        END IF;
    END LOOP;
    IF v_constraint_def IS NULL THEN
        RAISE EXCEPTION 'skill effect result type constraint is missing';
    END IF;

    v_constraint_def := NULL;
    FOR v_constraint_def IN
        SELECT pg_get_constraintdef(c.oid)
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'skill_trigger_rules'
           AND c.conname = 'ck_skill_trigger_rules_event_type'
    LOOP
        SELECT array_agg(match[1] ORDER BY match[1])
          INTO v_actual_values
          FROM regexp_matches(v_constraint_def, '''([A-Z_]+)''', 'g') AS match;
        IF NOT (
            cardinality(v_actual_values) = cardinality(v_target_event_types)
            AND v_actual_values @> v_target_event_types
            AND v_target_event_types @> v_actual_values
        ) THEN
            RAISE EXCEPTION 'skill trigger event type constraint drifted: %', v_actual_values;
        END IF;
    END LOOP;
    IF v_constraint_def IS NULL THEN
        RAISE EXCEPTION 'skill trigger event type constraint is missing';
    END IF;

    SELECT array_agg(match[1] ORDER BY match[1])
      INTO v_cond_values
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([A-Z_]+)''', 'g') AS match
     WHERE n.nspname = 'public'
       AND t.relname = 'skill_trigger_rule_event_value_conditions'
       AND c.conname = 'ck_skill_trigger_event_value_cond_key';
    SELECT array_agg(match[1] ORDER BY match[1])
      INTO v_bind_values
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([A-Z_]+)''', 'g') AS match
     WHERE n.nspname = 'public'
       AND t.relname = 'skill_trigger_rule_event_value_bindings'
       AND c.conname = 'ck_skill_trigger_event_value_bind_key';
    IF v_cond_values IS NULL OR v_bind_values IS NULL THEN
        RAISE EXCEPTION 'skill trigger event value constraints are missing';
    END IF;
    IF v_cond_values IS DISTINCT FROM v_bind_values THEN
        RAISE EXCEPTION 'skill trigger event value constraints are inconsistent: cond=%, bind=%',
            v_cond_values, v_bind_values;
    END IF;
    IF cardinality(v_cond_values) = cardinality(v_previous_event_value_keys)
        AND v_cond_values @> v_previous_event_value_keys
        AND v_previous_event_value_keys @> v_cond_values THEN
        v_event_value_state := 'previous';
    ELSIF cardinality(v_cond_values) = cardinality(v_target_event_value_keys)
        AND v_cond_values @> v_target_event_value_keys
        AND v_target_event_value_keys @> v_cond_values THEN
        v_event_value_state := 'target';
    ELSE
        RAISE EXCEPTION 'skill trigger event value constraint drifted: %', v_cond_values;
    END IF;

    SELECT array_agg(match[1] ORDER BY match[1])
      INTO v_output_values
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([A-Z_]+)''', 'g') AS match
     WHERE n.nspname = 'public'
       AND t.relname = 'skill_trigger_rule_prior_result_bindings'
       AND c.conname = 'ck_skill_trigger_prior_result_bind_output';
    IF v_output_values IS NULL THEN
        RAISE EXCEPTION 'prior result output constraint is missing';
    END IF;
    IF cardinality(v_output_values) = cardinality(v_previous_output_kinds)
        AND v_output_values @> v_previous_output_kinds
        AND v_previous_output_kinds @> v_output_values THEN
        v_output_state := 'previous';
    ELSIF cardinality(v_output_values) = cardinality(v_target_output_kinds)
        AND v_output_values @> v_target_output_kinds
        AND v_target_output_kinds @> v_output_values THEN
        v_output_state := 'target';
    ELSE
        RAISE EXCEPTION 'prior result output constraint drifted: %', v_output_values;
    END IF;

    IF v_event_value_state IS DISTINCT FROM v_output_state THEN
        RAISE EXCEPTION 'stage 7.6.5 checks are partial: event_value=%, output_kind=%',
            v_event_value_state, v_output_state;
    END IF;

    IF v_event_value_state = 'previous' THEN
        SELECT COUNT(*) INTO v_unknown_event_value_rows
          FROM (
              SELECT event_value_key AS value_key
                FROM public.skill_trigger_rule_event_value_conditions
              UNION ALL
              SELECT event_value_key
                FROM public.skill_trigger_rule_event_value_bindings
          ) rows
         WHERE value_key <> ALL (v_previous_event_value_keys);
        IF v_unknown_event_value_rows <> 0 THEN
            RAISE EXCEPTION 'existing event value rows are outside the predecessor set';
        END IF;
        SELECT COUNT(*) INTO v_unknown_output_rows
          FROM public.skill_trigger_rule_prior_result_bindings
         WHERE output_kind <> ALL (v_previous_output_kinds);
        IF v_unknown_output_rows <> 0 THEN
            RAISE EXCEPTION 'existing prior result rows are outside the predecessor set';
        END IF;
    END IF;

    PERFORM set_config(
        'damage.viewer.stage765.state',
        v_event_value_state,
        true
    );
END;
$migration_preflight$;

DO $migration_apply$
DECLARE
    v_state text := current_setting('damage.viewer.stage765.state', true);
BEGIN
    IF v_state = 'target' THEN
        RETURN;
    END IF;
    IF v_state IS DISTINCT FROM 'previous' THEN
        RAISE EXCEPTION 'stage 7.6.5 checks are incomplete';
    END IF;

    ALTER TABLE public.skill_trigger_rule_event_value_conditions
        DROP CONSTRAINT ck_skill_trigger_event_value_cond_key;
    ALTER TABLE public.skill_trigger_rule_event_value_conditions
        ADD CONSTRAINT ck_skill_trigger_event_value_cond_key
            CHECK (event_value_key IN (
                'STEP_EXECUTION_INDEX', 'CHARGE_DURATION_MS', 'RECAST_COUNT',
                'HIT_INDEX', 'LIFECYCLE_STACKS', 'PERIOD_INDEX', 'REMAINING_MS',
                'STATE_BEFORE', 'STATE_AFTER',
                'ATTRIBUTE_BEFORE', 'ATTRIBUTE_AFTER', 'THRESHOLD_VALUE',
                'RAW_DAMAGE', 'POST_DEFENSE_DAMAGE', 'HEALTH_BEFORE', 'PROJECTED_HEALTH_AFTER',
                'SHIELD_ABSORBED', 'ACTUAL_HP_LOSS', 'BLOCKED', 'IMMUNE', 'KILLED',
                'LINK_INDEX', 'LINK_COUNT'
            ));

    ALTER TABLE public.skill_trigger_rule_event_value_bindings
        DROP CONSTRAINT ck_skill_trigger_event_value_bind_key;
    ALTER TABLE public.skill_trigger_rule_event_value_bindings
        ADD CONSTRAINT ck_skill_trigger_event_value_bind_key
            CHECK (event_value_key IN (
                'STEP_EXECUTION_INDEX', 'CHARGE_DURATION_MS', 'RECAST_COUNT',
                'HIT_INDEX', 'LIFECYCLE_STACKS', 'PERIOD_INDEX', 'REMAINING_MS',
                'STATE_BEFORE', 'STATE_AFTER',
                'ATTRIBUTE_BEFORE', 'ATTRIBUTE_AFTER', 'THRESHOLD_VALUE',
                'RAW_DAMAGE', 'POST_DEFENSE_DAMAGE', 'HEALTH_BEFORE', 'PROJECTED_HEALTH_AFTER',
                'SHIELD_ABSORBED', 'ACTUAL_HP_LOSS', 'BLOCKED', 'IMMUNE', 'KILLED',
                'LINK_INDEX', 'LINK_COUNT'
            ));

    ALTER TABLE public.skill_trigger_rule_prior_result_bindings
        DROP CONSTRAINT ck_skill_trigger_prior_result_bind_output;
    ALTER TABLE public.skill_trigger_rule_prior_result_bindings
        ADD CONSTRAINT ck_skill_trigger_prior_result_bind_output
            CHECK (output_kind IN (
                'CONFIGURED_VALUE', 'RAW_DAMAGE', 'POST_DEFENSE_DAMAGE',
                'SHIELD_ABSORBED', 'ACTUAL_HP_LOSS', 'ACTUAL_HEALING',
                'BLOCKED', 'IMMUNE', 'STATUS_APPLIED', 'KILLED'
            ));
END;
$migration_apply$;

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
    v_damage_event_count int;
    v_spell_shield_event_count int;
    v_link_event_count int;
    v_event_detail_count int;
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
    SELECT COUNT(*) INTO v_damage_event_count
    FROM public.skill_trigger_rule_damage_events
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
    SELECT COUNT(*) INTO v_spell_shield_event_count
    FROM public.skill_trigger_rule_spell_shield_blocked_events
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;
    SELECT COUNT(*) INTO v_link_event_count
    FROM public.skill_trigger_rule_link_events
    WHERE game_id = v_game_id AND skill_key = v_skill_key AND rule_key = v_skill_trigger_rule_key;

    v_event_detail_count := v_process_event_count + v_skill_event_count + v_result_event_count
        + v_lifecycle_event_count + v_status_event_count + v_health_event_count
        + v_istate_event_count + v_subject_event_count + v_damage_event_count
        + v_spell_shield_event_count + v_link_event_count;

    v_expected_detail := CASE
        WHEN v_event_type IN ('PROCESS_MOMENT', 'PROCESS_CANCEL_REQUESTED') THEN
            CASE WHEN v_process_event_count = 1 AND v_event_detail_count = 1 THEN 1 ELSE 0 END
        WHEN v_event_type IN ('SKILL_USED', 'SKILL_HIT') THEN
            CASE WHEN v_skill_event_count = 1 AND v_event_detail_count = 1 THEN 1 ELSE 0 END
        WHEN v_event_type = 'RESULT_AVAILABLE' THEN
            CASE WHEN v_result_event_count = 1 AND v_event_detail_count = 1 THEN 1 ELSE 0 END
        WHEN v_event_type = 'LIFECYCLE_MOMENT' THEN
            CASE WHEN v_lifecycle_event_count = 1 AND v_event_detail_count = 1 THEN 1 ELSE 0 END
        WHEN v_event_type = 'STATUS_CHANGED' THEN
            CASE WHEN v_status_event_count = 1 AND v_event_detail_count = 1 THEN 1 ELSE 0 END
        WHEN v_event_type = 'HEALTH_THRESHOLD_CROSSED' THEN
            CASE WHEN v_health_event_count = 1 AND v_event_detail_count = 1 THEN 1 ELSE 0 END
        WHEN v_event_type = 'INTERNAL_STATE_CHANGED' THEN
            CASE WHEN v_istate_event_count = 1 AND v_event_detail_count = 1 THEN 1 ELSE 0 END
        WHEN v_event_type IN ('ENTITY_DIED', 'ENTITY_UNTARGETABLE') THEN
            CASE WHEN v_subject_event_count = 1 AND v_event_detail_count = 1 THEN 1 ELSE 0 END
        WHEN v_event_type IN ('DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN') THEN
            CASE WHEN v_damage_event_count = 1 AND v_event_detail_count = 1 THEN 1 ELSE 0 END
        WHEN v_event_type = 'SPELL_SHIELD_BLOCKED' THEN
            CASE WHEN v_spell_shield_event_count = 1 AND v_event_detail_count = 1 THEN 1 ELSE 0 END
        WHEN v_event_type IN ('HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED') THEN
            CASE WHEN v_link_event_count = 1 AND v_event_detail_count = 1 THEN 1 ELSE 0 END
        WHEN v_event_type IN (
            'BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'CONTROL_RECEIVED', 'KILL'
        ) THEN
            CASE WHEN v_event_detail_count = 0 THEN 1 ELSE 0 END
        ELSE 0
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
    ELSIF v_event_type = 'SPELL_SHIELD_BLOCKED' THEN
        IF NOT EXISTS (
            SELECT 1
              FROM public.skill_trigger_rule_spell_shield_blocked_events e
              JOIN public.skill_effect_results r
                ON r.game_id = e.game_id
               AND r.skill_key = e.skill_key
               AND r.effect_key = e.shield_effect_key
              JOIN public.skill_effect_result_lifecycle_behaviors b
                ON b.game_id = r.game_id
               AND b.skill_key = r.skill_key
               AND b.effect_key = r.effect_key
               AND b.result_key = r.result_key
             WHERE e.game_id = v_game_id
               AND e.skill_key = v_skill_key
               AND e.rule_key = v_skill_trigger_rule_key
               AND r.result_type = 'SPELL_SHIELD'
               AND b.moment = 'PERSISTENT'
        ) THEN
            RAISE EXCEPTION
                'skill_trigger_rules(%, %, %) SPELL_SHIELD_BLOCKED requires a persistent spell shield effect at commit',
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
            IF v_prior.output_kind = 'CONFIGURED_VALUE' THEN
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


COMMIT;
