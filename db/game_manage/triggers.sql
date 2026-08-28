-- =============================================================================
-- Damage Viewer System - Database Schema V2 (Triggers / Functions)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_game_partitions(p_game_id varchar)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_game_id varchar := p_game_id;
    v_parent text;
    v_parents text[] := ARRAY[
        'images',
        -- revision baseline partitioned tables
        'attribute_definitions',
        'attribute_definitions_log',
        'types',
        'types_log',
        'type_relations',
        'type_relations_log',
        -- generic 1v1 combat partitioned tables
        'game_entities',
        'game_entities_log',
        'entity_attribute_values',
        'entity_attribute_values_log',
        'entity_attribute_stage_values',
        'entity_attribute_stage_values_log',
        'provider_definitions',
        'provider_definitions_log',
        'provider_formulas',
        'provider_formulas_log',
        'provider_lifecycles',
        'provider_lifecycles_log',
        'entity_provider_mounts',
        'entity_provider_mounts_log',
        'provider_state_fields',
        'provider_state_fields_log',
        'ability_definitions',
        'ability_definitions_log',
        'ability_parameters',
        'ability_parameters_log',
        'ability_state_fields',
        'ability_state_fields_log',
        'ability_phases',
        'ability_phases_log',
        'ability_cooldowns',
        'ability_cooldowns_log',
        'provider_modifiers',
        'provider_modifiers_log',
        'provider_listeners',
        'provider_listeners_log',
        'listener_match_types',
        'listener_match_types_log',
        'effect_sequences',
        'effect_sequences_log',
        'effect_steps',
        'effect_steps_log',
        'ability_phase_effect_sequences',
        'ability_phase_effect_sequences_log',
        'listener_effect_sequences',
        'listener_effect_sequences_log',
        'provider_tick_sequences',
        'provider_tick_sequences_log',
        'damage_effect_details',
        'damage_effect_details_log',
        'heal_effect_details',
        'heal_effect_details_log',
        'attribute_effect_details',
        'attribute_effect_details_log',
        'shield_effect_details',
        'shield_effect_details_log',
        'provider_effect_details',
        'provider_effect_details_log',
        'event_effect_details',
        'event_effect_details_log',
        'ability_control_effect_details',
        'ability_control_effect_details_log',
        'state_effect_details',
        'state_effect_details_log',
        'repeat_effect_details',
        'repeat_effect_details_log',
        'execute_effect_details',
        'execute_effect_details_log'
    ];
BEGIN
    FOREACH v_parent IN ARRAY v_parents
    LOOP
        IF to_regclass('public.' || v_parent) IS NULL THEN
            CONTINUE;
        END IF;
        BEGIN
            EXECUTE format(
                'CREATE TABLE %I PARTITION OF public.%I FOR VALUES IN (%L)',
                v_parent || '_' || v_game_id,
                v_parent,
                v_game_id
            );
        EXCEPTION WHEN duplicate_table THEN
            NULL;
        END;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.ensure_game_partitions(varchar) IS '为指定 game_id 按表清单创建分区（幂等；缺失父表时跳过）';

CREATE OR REPLACE FUNCTION public.ensure_game_data_state(p_game_id varchar)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO public.game_data_state (game_id, current_revision, published_revision, updated_at)
    VALUES (p_game_id, 0, 0, NOW())
    ON CONFLICT (game_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.ensure_game_data_state(varchar) IS '为指定 game_id 初始化 game_data_state（幂等）';

CREATE OR REPLACE FUNCTION public.trg_games_after_insert_create_partitions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM public.ensure_game_partitions(NEW.game_id);
    PERFORM public.ensure_game_data_state(NEW.game_id);
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_games_after_insert_create_partitions() IS 'games 插入后自动创建分区并初始化 game_data_state';

DROP TRIGGER IF EXISTS trg_games_after_insert_create_partitions ON public.games;
CREATE TRIGGER trg_games_after_insert_create_partitions
AFTER INSERT ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.trg_games_after_insert_create_partitions();

-- -----------------------------------------------------------------------------
-- effect_steps：事务提交时必须恰好存在一种 detail
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.count_effect_step_details(p_game_id varchar, p_step_id varchar)
RETURNS int
LANGUAGE sql
STABLE
AS $$
    SELECT (
        (SELECT COUNT(*) FROM public.damage_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.heal_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.attribute_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.shield_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.provider_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.event_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.ability_control_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.state_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.repeat_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.execute_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
    )::int;
$$;

CREATE OR REPLACE FUNCTION public.trg_effect_step_exactly_one_detail()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_game_id varchar(64);
    v_step_id varchar(256);
    v_count int;
BEGIN
    IF TG_TABLE_NAME = 'effect_steps' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        v_game_id := NEW.game_id;
        v_step_id := NEW.step_id;
    ELSE
        IF TG_OP = 'DELETE' THEN
            v_game_id := OLD.game_id;
            v_step_id := OLD.step_id;
        ELSE
            v_game_id := NEW.game_id;
            v_step_id := NEW.step_id;
        END IF;
        -- detail 行变更时，若对应 effect_steps 已不存在则跳过（避免删除顺序噪音）
        IF NOT EXISTS (
            SELECT 1
              FROM public.effect_steps s
             WHERE s.game_id = v_game_id
               AND s.step_id = v_step_id
        ) THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
    END IF;

    v_count := public.count_effect_step_details(v_game_id, v_step_id);
    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'effect_steps(%, %) must have exactly one detail at commit, found %',
            v_game_id, v_step_id, v_count
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.trg_effect_step_exactly_one_detail() IS 'deferred：保证每个 effect step 在提交时恰好一种 detail';

DROP TRIGGER IF EXISTS trg_effect_steps_exactly_one_detail ON public.effect_steps;
CREATE CONSTRAINT TRIGGER trg_effect_steps_exactly_one_detail
AFTER INSERT OR UPDATE ON public.effect_steps
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_effect_step_exactly_one_detail();

DO $$
DECLARE
    v_detail text;
    v_details text[] := ARRAY[
        'damage_effect_details',
        'heal_effect_details',
        'attribute_effect_details',
        'shield_effect_details',
        'provider_effect_details',
        'event_effect_details',
        'ability_control_effect_details',
        'state_effect_details',
        'repeat_effect_details',
        'execute_effect_details'
    ];
BEGIN
    FOREACH v_detail IN ARRAY v_details
    LOOP
        IF to_regclass('public.' || v_detail) IS NULL THEN
            CONTINUE;
        END IF;
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_exactly_one_detail ON public.%I', v_detail, v_detail);
        EXECUTE format(
            'CREATE CONSTRAINT TRIGGER trg_%I_exactly_one_detail
             AFTER INSERT OR UPDATE OR DELETE ON public.%I
             DEFERRABLE INITIALLY DEFERRED
             FOR EACH ROW
             EXECUTE FUNCTION public.trg_effect_step_exactly_one_detail()',
            v_detail,
            v_detail
        );
    END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- skill_effect_results：事务提交时必须满足七种结果完整形状
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
    v_value_count int;
    v_damage_count int;
    v_attribute_count int;
    v_resource_count int;
    v_cooldown_count int;
    v_status_count int;
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

    IF v_result_type = 'DAMAGE' THEN
        IF v_value_count <> 1
            OR v_damage_count <> 1
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_cooldown_count <> 0
            OR v_status_count <> 0 THEN
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
            OR v_status_count <> 0 THEN
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
            OR v_status_count <> 0 THEN
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
            OR v_status_count <> 0 THEN
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
            OR v_status_count <> 0 THEN
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
            OR v_status_count <> 1 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) STATUS_OPERATION shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
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
        'skill_effect_status_operation_details'
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
-- skill_internal_states：事务提交时必须满足五种内部状态完整形状
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_skill_internal_state_complete_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_game_id varchar(64);
    v_skill_key varchar(64);
    v_state_key varchar(64);
    v_state_type varchar(24);
    v_scope varchar(16);
    v_counter_count int;
    v_ammo_count int;
    v_flag_count int;
    v_cooldown_count int;
    v_option_count int;
    v_initial_count int;
BEGIN
    IF TG_TABLE_NAME = 'skill_internal_states' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        v_game_id := NEW.game_id;
        v_skill_key := NEW.skill_key;
        v_state_key := NEW.state_key;
        v_state_type := NEW.state_type;
        v_scope := NEW.scope;
    ELSE
        IF TG_OP = 'DELETE' THEN
            v_game_id := OLD.game_id;
            v_skill_key := OLD.skill_key;
            v_state_key := OLD.state_key;
        ELSE
            v_game_id := NEW.game_id;
            v_skill_key := NEW.skill_key;
            v_state_key := NEW.state_key;
        END IF;
        SELECT s.state_type, s.scope
          INTO v_state_type, v_scope
          FROM public.skill_internal_states s
         WHERE s.game_id = v_game_id
           AND s.skill_key = v_skill_key
           AND s.state_key = v_state_key;
        IF NOT FOUND THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
    END IF;

    SELECT COUNT(*) INTO v_counter_count
      FROM public.skill_internal_state_counter_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key AND d.state_key = v_state_key;
    SELECT COUNT(*) INTO v_ammo_count
      FROM public.skill_internal_state_ammo_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key AND d.state_key = v_state_key;
    SELECT COUNT(*) INTO v_flag_count
      FROM public.skill_internal_state_flag_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key AND d.state_key = v_state_key;
    SELECT COUNT(*) INTO v_cooldown_count
      FROM public.skill_internal_state_cooldown_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key AND d.state_key = v_state_key;
    SELECT COUNT(*) INTO v_option_count
      FROM public.skill_internal_state_mode_options d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key AND d.state_key = v_state_key;
    SELECT COUNT(*) INTO v_initial_count
      FROM public.skill_internal_state_mode_options d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key AND d.state_key = v_state_key
       AND d.initial IS TRUE;

    IF v_state_type = 'COUNTER' THEN
        IF v_counter_count <> 1
            OR v_ammo_count <> 0
            OR v_flag_count <> 0
            OR v_cooldown_count <> 0
            OR v_option_count <> 0
            OR v_scope NOT IN ('SKILL', 'TARGET') THEN
            RAISE EXCEPTION
                'skill_internal_states(%, %, %) COUNTER shape invalid at commit',
                v_game_id, v_skill_key, v_state_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_state_type = 'AMMO' THEN
        IF v_counter_count <> 0
            OR v_ammo_count <> 1
            OR v_flag_count <> 0
            OR v_cooldown_count <> 0
            OR v_option_count <> 0
            OR v_scope <> 'SKILL' THEN
            RAISE EXCEPTION
                'skill_internal_states(%, %, %) AMMO shape invalid at commit',
                v_game_id, v_skill_key, v_state_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_state_type = 'MODE' THEN
        IF v_counter_count <> 0
            OR v_ammo_count <> 0
            OR v_flag_count <> 0
            OR v_cooldown_count <> 0
            OR v_option_count < 2
            OR v_initial_count <> 1
            OR v_scope <> 'SKILL' THEN
            RAISE EXCEPTION
                'skill_internal_states(%, %, %) MODE shape invalid at commit',
                v_game_id, v_skill_key, v_state_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_state_type = 'FLAG' THEN
        IF v_counter_count <> 0
            OR v_ammo_count <> 0
            OR v_flag_count <> 1
            OR v_cooldown_count <> 0
            OR v_option_count <> 0
            OR v_scope <> 'SKILL' THEN
            RAISE EXCEPTION
                'skill_internal_states(%, %, %) FLAG shape invalid at commit',
                v_game_id, v_skill_key, v_state_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_state_type = 'INTERNAL_COOLDOWN' THEN
        IF v_counter_count <> 0
            OR v_ammo_count <> 0
            OR v_flag_count <> 0
            OR v_cooldown_count <> 1
            OR v_option_count <> 0
            OR v_scope <> 'SKILL' THEN
            RAISE EXCEPTION
                'skill_internal_states(%, %, %) INTERNAL_COOLDOWN shape invalid at commit',
                v_game_id, v_skill_key, v_state_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        RAISE EXCEPTION
            'skill_internal_states(%, %, %) has unsupported state_type %',
            v_game_id, v_skill_key, v_state_key, v_state_type
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.trg_skill_internal_state_complete_shape() IS
    'deferred：保证每个技能内部状态在提交时具有完整且互斥的类型明细或模式选项';

DROP TRIGGER IF EXISTS trg_skill_internal_states_complete_shape
    ON public.skill_internal_states;
CREATE CONSTRAINT TRIGGER trg_skill_internal_states_complete_shape
AFTER INSERT OR UPDATE ON public.skill_internal_states
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_skill_internal_state_complete_shape();

DO $$
DECLARE
    v_detail text;
    v_details text[] := ARRAY[
        'skill_internal_state_counter_details',
        'skill_internal_state_ammo_details',
        'skill_internal_state_flag_details',
        'skill_internal_state_cooldown_details',
        'skill_internal_state_mode_options'
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
             EXECUTE FUNCTION public.trg_skill_internal_state_complete_shape()',
            v_detail,
            v_detail
        );
    END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- skill_process_steps：事务提交时必须满足八种步骤完整形状
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_skill_process_step_complete_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_game_id varchar(64);
    v_skill_key varchar(64);
    v_process_key varchar(64);
    v_step_key varchar(64);
    v_step_type varchar(32);
    v_delay_count int;
    v_multi_count int;
    v_periodic_count int;
    v_channel_count int;
    v_charge_count int;
    v_recast_count int;
    v_empowered_count int;
BEGIN
    IF TG_TABLE_NAME = 'skill_process_steps' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        v_game_id := NEW.game_id;
        v_skill_key := NEW.skill_key;
        v_process_key := NEW.process_key;
        v_step_key := NEW.step_key;
        v_step_type := NEW.step_type;
    ELSE
        IF TG_OP = 'DELETE' THEN
            v_game_id := OLD.game_id;
            v_skill_key := OLD.skill_key;
            v_process_key := OLD.process_key;
            v_step_key := OLD.step_key;
        ELSE
            v_game_id := NEW.game_id;
            v_skill_key := NEW.skill_key;
            v_process_key := NEW.process_key;
            v_step_key := NEW.step_key;
        END IF;
        SELECT s.step_type
          INTO v_step_type
          FROM public.skill_process_steps s
         WHERE s.game_id = v_game_id
           AND s.skill_key = v_skill_key
           AND s.process_key = v_process_key
           AND s.step_key = v_step_key;
        IF NOT FOUND THEN
            RETURN COALESCE(NEW, OLD);
        END IF;
    END IF;

    SELECT COUNT(*) INTO v_delay_count
      FROM public.skill_process_delay_step_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key
       AND d.process_key = v_process_key AND d.step_key = v_step_key;
    SELECT COUNT(*) INTO v_multi_count
      FROM public.skill_process_multi_hit_step_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key
       AND d.process_key = v_process_key AND d.step_key = v_step_key;
    SELECT COUNT(*) INTO v_periodic_count
      FROM public.skill_process_periodic_step_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key
       AND d.process_key = v_process_key AND d.step_key = v_step_key;
    SELECT COUNT(*) INTO v_channel_count
      FROM public.skill_process_channel_step_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key
       AND d.process_key = v_process_key AND d.step_key = v_step_key;
    SELECT COUNT(*) INTO v_charge_count
      FROM public.skill_process_charge_step_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key
       AND d.process_key = v_process_key AND d.step_key = v_step_key;
    SELECT COUNT(*) INTO v_recast_count
      FROM public.skill_process_recast_step_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key
       AND d.process_key = v_process_key AND d.step_key = v_step_key;
    SELECT COUNT(*) INTO v_empowered_count
      FROM public.skill_process_empowered_attack_step_details d
     WHERE d.game_id = v_game_id AND d.skill_key = v_skill_key
       AND d.process_key = v_process_key AND d.step_key = v_step_key;

    IF v_step_type = 'IMMEDIATE' THEN
        IF v_delay_count <> 0 OR v_multi_count <> 0 OR v_periodic_count <> 0
            OR v_channel_count <> 0 OR v_charge_count <> 0
            OR v_recast_count <> 0 OR v_empowered_count <> 0 THEN
            RAISE EXCEPTION
                'skill_process_steps(%, %, %, %) IMMEDIATE shape invalid at commit',
                v_game_id, v_skill_key, v_process_key, v_step_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_step_type = 'DELAY' THEN
        IF v_delay_count <> 1 OR v_multi_count <> 0 OR v_periodic_count <> 0
            OR v_channel_count <> 0 OR v_charge_count <> 0
            OR v_recast_count <> 0 OR v_empowered_count <> 0 THEN
            RAISE EXCEPTION
                'skill_process_steps(%, %, %, %) DELAY shape invalid at commit',
                v_game_id, v_skill_key, v_process_key, v_step_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_step_type = 'MULTI_HIT' THEN
        IF v_delay_count <> 0 OR v_multi_count <> 1 OR v_periodic_count <> 0
            OR v_channel_count <> 0 OR v_charge_count <> 0
            OR v_recast_count <> 0 OR v_empowered_count <> 0 THEN
            RAISE EXCEPTION
                'skill_process_steps(%, %, %, %) MULTI_HIT shape invalid at commit',
                v_game_id, v_skill_key, v_process_key, v_step_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_step_type = 'PERIODIC' THEN
        IF v_delay_count <> 0 OR v_multi_count <> 0 OR v_periodic_count <> 1
            OR v_channel_count <> 0 OR v_charge_count <> 0
            OR v_recast_count <> 0 OR v_empowered_count <> 0 THEN
            RAISE EXCEPTION
                'skill_process_steps(%, %, %, %) PERIODIC shape invalid at commit',
                v_game_id, v_skill_key, v_process_key, v_step_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_step_type = 'CHANNEL' THEN
        IF v_delay_count <> 0 OR v_multi_count <> 0 OR v_periodic_count <> 0
            OR v_channel_count <> 1 OR v_charge_count <> 0
            OR v_recast_count <> 0 OR v_empowered_count <> 0 THEN
            RAISE EXCEPTION
                'skill_process_steps(%, %, %, %) CHANNEL shape invalid at commit',
                v_game_id, v_skill_key, v_process_key, v_step_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_step_type = 'CHARGE' THEN
        IF v_delay_count <> 0 OR v_multi_count <> 0 OR v_periodic_count <> 0
            OR v_channel_count <> 0 OR v_charge_count <> 1
            OR v_recast_count <> 0 OR v_empowered_count <> 0 THEN
            RAISE EXCEPTION
                'skill_process_steps(%, %, %, %) CHARGE shape invalid at commit',
                v_game_id, v_skill_key, v_process_key, v_step_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_step_type = 'RECAST' THEN
        IF v_delay_count <> 0 OR v_multi_count <> 0 OR v_periodic_count <> 0
            OR v_channel_count <> 0 OR v_charge_count <> 0
            OR v_recast_count <> 1 OR v_empowered_count <> 0 THEN
            RAISE EXCEPTION
                'skill_process_steps(%, %, %, %) RECAST shape invalid at commit',
                v_game_id, v_skill_key, v_process_key, v_step_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_step_type = 'EMPOWERED_BASIC_ATTACK' THEN
        IF v_delay_count <> 0 OR v_multi_count <> 0 OR v_periodic_count <> 0
            OR v_channel_count <> 0 OR v_charge_count <> 0
            OR v_recast_count <> 0 OR v_empowered_count <> 1 THEN
            RAISE EXCEPTION
                'skill_process_steps(%, %, %, %) EMPOWERED_BASIC_ATTACK shape invalid at commit',
                v_game_id, v_skill_key, v_process_key, v_step_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        RAISE EXCEPTION
            'skill_process_steps(%, %, %, %) has unsupported step_type %',
            v_game_id, v_skill_key, v_process_key, v_step_key, v_step_type
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.trg_skill_process_step_complete_shape() IS
    'deferred：保证每个技能过程步骤在提交时具有完整且互斥的类型明细';

DROP TRIGGER IF EXISTS trg_skill_process_steps_complete_shape
    ON public.skill_process_steps;
CREATE CONSTRAINT TRIGGER trg_skill_process_steps_complete_shape
AFTER INSERT OR UPDATE ON public.skill_process_steps
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_skill_process_step_complete_shape();

DO $$
DECLARE
    v_detail text;
    v_details text[] := ARRAY[
        'skill_process_delay_step_details',
        'skill_process_multi_hit_step_details',
        'skill_process_periodic_step_details',
        'skill_process_channel_step_details',
        'skill_process_charge_step_details',
        'skill_process_recast_step_details',
        'skill_process_empowered_attack_step_details'
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
             EXECUTE FUNCTION public.trg_skill_process_step_complete_shape()',
            v_detail,
            v_detail
        );
    END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- skill_processes：事务提交时必须满足步骤、行为、时点与状态操作形状
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_skill_process_complete_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_game_id varchar(64);
    v_skill_key varchar(64);
    v_process_key varchar(64);
    v_step_count int;
    v_binding_count int;
    v_operation_count int;
    v_timeout record;
    v_operation record;
    v_state_type varchar(24);
    v_option_state_key varchar(64);
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_game_id := OLD.game_id;
        v_skill_key := OLD.skill_key;
        v_process_key := OLD.process_key;
    ELSE
        v_game_id := NEW.game_id;
        v_skill_key := NEW.skill_key;
        v_process_key := NEW.process_key;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.skill_processes p
         WHERE p.game_id = v_game_id
           AND p.skill_key = v_skill_key
           AND p.process_key = v_process_key
    ) THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    SELECT COUNT(*) INTO v_step_count
      FROM public.skill_process_steps s
     WHERE s.game_id = v_game_id AND s.skill_key = v_skill_key AND s.process_key = v_process_key;
    SELECT COUNT(*) INTO v_binding_count
      FROM public.skill_process_effect_bindings b
     WHERE b.game_id = v_game_id AND b.skill_key = v_skill_key AND b.process_key = v_process_key;
    SELECT COUNT(*) INTO v_operation_count
      FROM public.skill_process_state_operations o
     WHERE o.game_id = v_game_id AND o.skill_key = v_skill_key AND o.process_key = v_process_key;

    IF v_step_count < 1 THEN
        RAISE EXCEPTION
            'skill_processes(%, %, %) requires at least one step at commit',
            v_game_id, v_skill_key, v_process_key
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_binding_count < 1 AND v_operation_count < 1 THEN
        RAISE EXCEPTION
            'skill_processes(%, %, %) requires at least one effect binding or state operation at commit',
            v_game_id, v_skill_key, v_process_key
            USING ERRCODE = 'check_violation';
    END IF;

    FOR v_timeout IN
        SELECT 'cooldown' AS source, c.step_key
          FROM public.skill_process_cooldowns c
         WHERE c.game_id = v_game_id AND c.skill_key = v_skill_key
           AND c.process_key = v_process_key AND c.moment_type = 'STEP_TIMEOUT'
        UNION ALL
        SELECT 'binding' AS source, b.step_key
          FROM public.skill_process_effect_bindings b
         WHERE b.game_id = v_game_id AND b.skill_key = v_skill_key
           AND b.process_key = v_process_key AND b.moment_type = 'STEP_TIMEOUT'
        UNION ALL
        SELECT 'operation' AS source, o.step_key
          FROM public.skill_process_state_operations o
         WHERE o.game_id = v_game_id AND o.skill_key = v_skill_key
           AND o.process_key = v_process_key AND o.moment_type = 'STEP_TIMEOUT'
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM public.skill_process_steps s
             WHERE s.game_id = v_game_id
               AND s.skill_key = v_skill_key
               AND s.process_key = v_process_key
               AND s.step_key = v_timeout.step_key
               AND s.step_type IN ('CHARGE', 'RECAST', 'EMPOWERED_BASIC_ATTACK')
        ) THEN
            RAISE EXCEPTION
                'skill_processes(%, %, %) STEP_TIMEOUT must reference CHARGE, RECAST or EMPOWERED_BASIC_ATTACK at commit',
                v_game_id, v_skill_key, v_process_key
                USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;

    FOR v_operation IN
        SELECT o.operation_key, o.state_key, o.operation, o.value_formula_key, o.option_key
          FROM public.skill_process_state_operations o
         WHERE o.game_id = v_game_id AND o.skill_key = v_skill_key AND o.process_key = v_process_key
    LOOP
        SELECT s.state_type
          INTO v_state_type
          FROM public.skill_internal_states s
         WHERE s.game_id = v_game_id
           AND s.skill_key = v_skill_key
           AND s.state_key = v_operation.state_key;
        IF NOT FOUND THEN
            RAISE EXCEPTION
                'skill_process_state_operations(%, %, %, %) references missing internal state at commit',
                v_game_id, v_skill_key, v_process_key, v_operation.operation_key
                USING ERRCODE = 'check_violation';
        END IF;

        IF v_state_type IN ('COUNTER', 'AMMO')
            AND v_operation.operation IN ('INCREASE', 'DECREASE', 'CONSUME', 'SET') THEN
            IF v_operation.value_formula_key IS NULL OR v_operation.option_key IS NOT NULL THEN
                RAISE EXCEPTION
                    'skill_process_state_operations(%, %, %, %) COUNTER/AMMO value operation shape invalid at commit',
                    v_game_id, v_skill_key, v_process_key, v_operation.operation_key
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSIF v_state_type IN ('COUNTER', 'AMMO') AND v_operation.operation = 'RESET' THEN
            IF v_operation.value_formula_key IS NOT NULL OR v_operation.option_key IS NOT NULL THEN
                RAISE EXCEPTION
                    'skill_process_state_operations(%, %, %, %) COUNTER/AMMO RESET shape invalid at commit',
                    v_game_id, v_skill_key, v_process_key, v_operation.operation_key
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSIF v_state_type = 'MODE' AND v_operation.operation = 'SELECT' THEN
            IF v_operation.value_formula_key IS NOT NULL OR v_operation.option_key IS NULL THEN
                RAISE EXCEPTION
                    'skill_process_state_operations(%, %, %, %) MODE SELECT shape invalid at commit',
                    v_game_id, v_skill_key, v_process_key, v_operation.operation_key
                    USING ERRCODE = 'check_violation';
            END IF;
            SELECT o.state_key
              INTO v_option_state_key
              FROM public.skill_internal_state_mode_options o
             WHERE o.game_id = v_game_id
               AND o.skill_key = v_skill_key
               AND o.state_key = v_operation.state_key
               AND o.option_key = v_operation.option_key;
            IF NOT FOUND THEN
                RAISE EXCEPTION
                    'skill_process_state_operations(%, %, %, %) MODE option does not belong to the same state at commit',
                    v_game_id, v_skill_key, v_process_key, v_operation.operation_key
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSIF v_state_type = 'FLAG'
            AND v_operation.operation IN ('ENABLE', 'DISABLE', 'TOGGLE') THEN
            IF v_operation.value_formula_key IS NOT NULL OR v_operation.option_key IS NOT NULL THEN
                RAISE EXCEPTION
                    'skill_process_state_operations(%, %, %, %) FLAG operation shape invalid at commit',
                    v_game_id, v_skill_key, v_process_key, v_operation.operation_key
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSIF v_state_type = 'INTERNAL_COOLDOWN'
            AND v_operation.operation IN ('START', 'RESET') THEN
            IF v_operation.value_formula_key IS NOT NULL OR v_operation.option_key IS NOT NULL THEN
                RAISE EXCEPTION
                    'skill_process_state_operations(%, %, %, %) INTERNAL_COOLDOWN operation shape invalid at commit',
                    v_game_id, v_skill_key, v_process_key, v_operation.operation_key
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSE
            RAISE EXCEPTION
                'skill_process_state_operations(%, %, %, %) operation does not match internal state type at commit',
                v_game_id, v_skill_key, v_process_key, v_operation.operation_key
                USING ERRCODE = 'check_violation';
        END IF;
    END LOOP;

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.trg_skill_process_complete_shape() IS
    'deferred：保证每个技能过程在提交时至少有步骤和行为，并且时点与状态操作形状合法';

DROP TRIGGER IF EXISTS trg_skill_processes_complete_shape
    ON public.skill_processes;
CREATE CONSTRAINT TRIGGER trg_skill_processes_complete_shape
AFTER INSERT OR UPDATE ON public.skill_processes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.trg_skill_process_complete_shape();

DO $$
DECLARE
    v_detail text;
    v_details text[] := ARRAY[
        'skill_process_steps',
        'skill_process_cooldowns',
        'skill_process_effect_bindings',
        'skill_process_state_operations'
    ];
BEGIN
    FOREACH v_detail IN ARRAY v_details
    LOOP
        IF to_regclass('public.' || v_detail) IS NULL THEN
            CONTINUE;
        END IF;
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_%I_process_complete_shape ON public.%I',
            v_detail,
            v_detail
        );
        EXECUTE format(
            'CREATE CONSTRAINT TRIGGER trg_%I_process_complete_shape
             AFTER INSERT OR UPDATE OR DELETE ON public.%I
             DEFERRABLE INITIALLY DEFERRED
             FOR EACH ROW
             EXECUTE FUNCTION public.trg_skill_process_complete_shape()',
            v_detail,
            v_detail
        );
    END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- Backfill partitions and game_data_state for existing games
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    v_game_id varchar;
BEGIN
    FOR v_game_id IN
        SELECT game_id
        FROM public.games
    LOOP
        PERFORM public.ensure_game_partitions(v_game_id);
        PERFORM public.ensure_game_data_state(v_game_id);
    END LOOP;
END;
$$;
