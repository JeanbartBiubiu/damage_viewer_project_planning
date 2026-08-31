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
        'images'
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

COMMENT ON FUNCTION public.ensure_game_partitions(varchar) IS '为指定 game_id 创建 images 子分区（幂等；缺失父表时跳过）';

CREATE OR REPLACE FUNCTION public.trg_games_after_insert_create_partitions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM public.ensure_game_partitions(NEW.game_id);
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_games_after_insert_create_partitions() IS 'games 插入后自动创建图片分区';

DROP TRIGGER IF EXISTS trg_games_after_insert_create_partitions ON public.games;
CREATE TRIGGER trg_games_after_insert_create_partitions
AFTER INSERT ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.trg_games_after_insert_create_partitions();

-- -----------------------------------------------------------------------------
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
    v_special_count int;
    v_attribute_count int;
    v_resource_count int;
    v_cooldown_count int;
    v_cooldown_target_count int;
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
    SELECT COUNT(*) INTO v_cooldown_target_count
      FROM public.skill_effect_cooldown_change_targets t
     WHERE t.game_id = v_game_id
       AND t.skill_key = v_skill_key
       AND t.effect_key = v_effect_key
       AND t.result_key = v_result_key;
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
    SELECT b.moment
      INTO v_result_moment
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
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 THEN
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
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 THEN
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
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 THEN
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
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 THEN
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
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 THEN
            RAISE EXCEPTION
                'skill_effect_results(%, %, %, %) RESOURCE_CHANGE shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'COOLDOWN_CHANGE' THEN
        IF v_cooldown_count <> 1
            OR v_cooldown_target_count < 1
            OR v_damage_count <> 0
            OR v_critical_count <> 0
            OR v_vamp_count <> 0
            OR v_normal_shield_count <> 0
            OR v_attribute_count <> 0
            OR v_resource_count <> 0
            OR v_status_count <> 0
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 THEN
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
            OR v_lifecycle_op_count <> 0 OR v_special_count <> 0 THEN
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
            OR v_status_count <> 0 OR v_special_count <> 0 THEN
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
                + v_status_count + v_lifecycle_op_count <> 0 THEN
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
                + v_status_count + v_lifecycle_op_count <> 0 THEN
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
                + v_status_count + v_lifecycle_op_count <> 0 THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) DAMAGE_IMMUNITY shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'HEALTH_FLOOR' THEN
        IF v_value_count <> 1 OR v_health_floor_count <> 1 OR v_special_count <> 1
            OR v_damage_count + v_critical_count + v_vamp_count + v_normal_shield_count
                + v_attribute_count + v_resource_count + v_cooldown_count
                + v_status_count + v_lifecycle_op_count <> 0 THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) HEALTH_FLOOR shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key USING ERRCODE = 'check_violation';
        END IF;
    ELSIF v_result_type = 'SPELL_SHIELD' THEN
        IF v_value_count <> 0
            OR v_damage_count + v_critical_count + v_vamp_count + v_normal_shield_count
                + v_attribute_count + v_resource_count + v_cooldown_count
                + v_status_count + v_lifecycle_op_count + v_special_count <> 0 THEN
            RAISE EXCEPTION 'skill_effect_results(%, %, %, %) SPELL_SHIELD shape invalid at commit',
                v_game_id, v_skill_key, v_effect_key, v_result_key USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        RAISE EXCEPTION
            'skill_effect_results(%, %, %, %) has unsupported result_type %',
            v_game_id, v_skill_key, v_effect_key, v_result_key, v_result_type
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_spell_shield_policy_count > 0 THEN
        IF v_target IS DISTINCT FROM 'TARGET'
            OR v_result_moment = 'PERSISTENT'
            OR v_result_type NOT IN (
                'DAMAGE', 'ATTRIBUTE_CHANGE', 'RESOURCE_CHANGE',
                'COOLDOWN_CHANGE', 'STATUS_OPERATION', 'LIFECYCLE_OPERATION'
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
        'skill_effect_attribute_change_details',
        'skill_effect_resource_change_details',
        'skill_effect_cooldown_change_details',
        'skill_effect_cooldown_change_targets',
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
                   'DAMAGE_IMMUNITY', 'HEALTH_FLOOR', 'SPELL_SHIELD'
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
                'DAMAGE_IMMUNITY', 'HEALTH_FLOOR', 'SPELL_SHIELD'
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
                'SPELL_SHIELD'
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
    v_damage_event_count int;
    v_spell_shield_event_count int;
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

    v_event_detail_count := v_process_event_count + v_skill_event_count + v_result_event_count
        + v_lifecycle_event_count + v_status_event_count + v_health_event_count
        + v_istate_event_count + v_subject_event_count + v_damage_event_count
        + v_spell_shield_event_count;

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
        'skill_trigger_rule_damage_events',
        'skill_trigger_rule_spell_shield_blocked_events',
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
-- Backfill images partitions for existing games
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
    END LOOP;
END;
$$;
