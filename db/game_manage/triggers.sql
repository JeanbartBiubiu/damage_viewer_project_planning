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
        'resource_definitions',
        'resource_definitions_log',
        'entity_resource_values',
        'entity_resource_values_log',
        'entity_resource_stage_values',
        'entity_resource_stage_values_log',
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
        'ability_costs',
        'ability_costs_log',
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
        'resource_effect_details',
        'resource_effect_details_log',
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
        'state_effect_details_log'
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
      + (SELECT COUNT(*) FROM public.resource_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.attribute_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.shield_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.provider_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.event_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.ability_control_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
      + (SELECT COUNT(*) FROM public.state_effect_details d WHERE d.game_id = p_game_id AND d.step_id = p_step_id)
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
        'resource_effect_details',
        'attribute_effect_details',
        'shield_effect_details',
        'provider_effect_details',
        'event_effect_details',
        'ability_control_effect_details',
        'state_effect_details'
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
