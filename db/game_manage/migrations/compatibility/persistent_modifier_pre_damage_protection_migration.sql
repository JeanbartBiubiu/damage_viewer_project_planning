BEGIN;

-- 阶段 7.6.2：持续修正、伤害免疫、生命下限与伤前事件。
-- 本脚本不写业务数据；执行后必须立即执行 db/game_manage/triggers.sql 刷新累计形状约束。

DO $$
BEGIN
    IF to_regclass('public.skill_effect_results') IS NULL
        OR to_regclass('public.skill_effect_result_normal_shield_interactions') IS NULL
        OR to_regclass('public.skill_trigger_rules') IS NULL
        OR to_regclass('public.skill_trigger_rule_damage_events') IS NULL THEN
        RAISE EXCEPTION 'stage 7.6.1 schema is required before stage 7.6.2';
    END IF;
END;
$$;

DO $$
DECLARE
    v_existing_count integer;
    v_constraint_def text;
    v_actual_values text[];
    v_previous_result_values constant text[] := ARRAY[
        'ATTRIBUTE_CHANGE', 'COOLDOWN_CHANGE', 'DAMAGE', 'DIRECT_HEAL',
        'LIFECYCLE_OPERATION', 'NORMAL_SHIELD', 'RESOURCE_CHANGE', 'STATUS_OPERATION'
    ];
    v_target_result_values constant text[] := ARRAY[
        'ATTRIBUTE_CHANGE', 'COOLDOWN_CHANGE', 'DAMAGE', 'DAMAGE_IMMUNITY',
        'DAMAGE_MODIFIER', 'DIRECT_HEAL', 'HEALING_MODIFIER', 'HEALTH_FLOOR',
        'LIFECYCLE_OPERATION', 'NORMAL_SHIELD', 'RESOURCE_CHANGE', 'STATUS_OPERATION'
    ];
    v_previous_event_values constant text[] := ARRAY[
        'BASIC_ATTACK_HIT', 'BASIC_ATTACK_START', 'CONTROL_RECEIVED', 'DAMAGE_DEALT',
        'DAMAGE_TAKEN', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE', 'HEALTH_THRESHOLD_CROSSED',
        'INTERNAL_STATE_CHANGED', 'KILL', 'LIFECYCLE_MOMENT', 'PROCESS_CANCEL_REQUESTED',
        'PROCESS_MOMENT', 'RESULT_AVAILABLE', 'SKILL_HIT', 'SKILL_USED', 'STATUS_CHANGED'
    ];
    v_target_event_values constant text[] := ARRAY[
        'BASIC_ATTACK_HIT', 'BASIC_ATTACK_START', 'CONTROL_RECEIVED', 'DAMAGE_DEALT',
        'DAMAGE_PENDING', 'DAMAGE_TAKEN', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
        'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED', 'KILL', 'LIFECYCLE_MOMENT',
        'PROCESS_CANCEL_REQUESTED', 'PROCESS_MOMENT', 'RESULT_AVAILABLE', 'SKILL_HIT',
        'SKILL_USED', 'STATUS_CHANGED'
    ];
    v_previous_event_value_keys constant text[] := ARRAY[
        'ATTRIBUTE_AFTER', 'ATTRIBUTE_BEFORE', 'CHARGE_DURATION_MS', 'HIT_INDEX',
        'LIFECYCLE_STACKS', 'PERIOD_INDEX', 'RECAST_COUNT', 'REMAINING_MS',
        'STATE_AFTER', 'STATE_BEFORE', 'STEP_EXECUTION_INDEX', 'THRESHOLD_VALUE'
    ];
    v_target_event_value_keys constant text[] := ARRAY[
        'ATTRIBUTE_AFTER', 'ATTRIBUTE_BEFORE', 'CHARGE_DURATION_MS', 'HEALTH_BEFORE',
        'HIT_INDEX', 'LIFECYCLE_STACKS', 'PERIOD_INDEX', 'POST_DEFENSE_DAMAGE',
        'PROJECTED_HEALTH_AFTER', 'RAW_DAMAGE', 'RECAST_COUNT', 'REMAINING_MS',
        'STATE_AFTER', 'STATE_BEFORE', 'STEP_EXECUTION_INDEX', 'THRESHOLD_VALUE'
    ];
BEGIN
    SELECT COUNT(*)
      INTO v_existing_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname IN (
           'skill_effect_damage_modifier_details',
           'skill_effect_healing_modifier_details',
           'skill_effect_damage_immunity_details',
           'skill_effect_health_floor_details'
       );
    IF v_existing_count NOT IN (0, 4) THEN
        RAISE EXCEPTION 'stage 7.6.2 structure is partial';
    END IF;

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
                cardinality(v_actual_values) = cardinality(v_previous_result_values)
                AND v_actual_values @> v_previous_result_values
            )
            AND NOT (
                cardinality(v_actual_values) = cardinality(v_target_result_values)
                AND v_actual_values @> v_target_result_values
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
                cardinality(v_actual_values) = cardinality(v_previous_event_values)
                AND v_actual_values @> v_previous_event_values
            )
            AND NOT (
                cardinality(v_actual_values) = cardinality(v_target_event_values)
                AND v_actual_values @> v_target_event_values
            ) THEN
            RAISE EXCEPTION 'skill trigger event type constraint drifted: %', v_actual_values;
        END IF;
    END LOOP;
    IF v_constraint_def IS NULL THEN
        RAISE EXCEPTION 'skill trigger event type constraint is missing';
    END IF;

    FOR v_constraint_def IN
        SELECT pg_get_constraintdef(c.oid)
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND (
               (t.relname = 'skill_trigger_rule_event_value_conditions'
                   AND c.conname = 'ck_skill_trigger_event_value_cond_key')
               OR
               (t.relname = 'skill_trigger_rule_event_value_bindings'
                   AND c.conname = 'ck_skill_trigger_event_value_bind_key')
           )
    LOOP
        SELECT array_agg(match[1] ORDER BY match[1])
          INTO v_actual_values
          FROM regexp_matches(v_constraint_def, '''([A-Z_]+)''', 'g') AS match;
        IF NOT (
                cardinality(v_actual_values) = cardinality(v_previous_event_value_keys)
                AND v_actual_values @> v_previous_event_value_keys
            )
            AND NOT (
                cardinality(v_actual_values) = cardinality(v_target_event_value_keys)
                AND v_actual_values @> v_target_event_value_keys
            ) THEN
            RAISE EXCEPTION 'skill trigger event value constraint drifted: %', v_actual_values;
        END IF;
    END LOOP;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'skill trigger event value constraints are missing';
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.skill_effect_damage_modifier_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    direction varchar(16) NOT NULL,
    operation varchar(16) NOT NULL,
    damage_type_key varchar(64),
    delivery_kind varchar(32) NOT NULL,
    origin_kind varchar(32) NOT NULL,
    critical_filter varchar(32) NOT NULL,
    CONSTRAINT pk_skill_effect_damage_modifier_details PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_damage_modifier_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results (game_id, skill_key, effect_key, result_key) ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_damage_modifier_damage_type
        FOREIGN KEY (game_id, damage_type_key)
        REFERENCES public.damage_types (game_id, damage_type_key) ON DELETE RESTRICT,
    CONSTRAINT ck_skill_effect_damage_modifier_direction CHECK (direction IN ('DEALT', 'TAKEN')),
    CONSTRAINT ck_skill_effect_damage_modifier_operation CHECK (operation IN ('INCREASE', 'DECREASE')),
    CONSTRAINT ck_skill_effect_damage_modifier_delivery CHECK (delivery_kind IN ('ANY', 'SKILL', 'BASIC_ATTACK')),
    CONSTRAINT ck_skill_effect_damage_modifier_origin CHECK (origin_kind IN ('ANY', 'DIRECT', 'REFLECTED')),
    CONSTRAINT ck_skill_effect_damage_modifier_critical CHECK (critical_filter IN ('ANY', 'CRITICAL_ONLY', 'NON_CRITICAL_ONLY'))
);

CREATE INDEX IF NOT EXISTS ix_skill_effect_damage_modifier_damage_type
    ON public.skill_effect_damage_modifier_details
    (game_id, damage_type_key, skill_key, effect_key, result_key);

CREATE TABLE IF NOT EXISTS public.skill_effect_healing_modifier_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    direction varchar(16) NOT NULL,
    operation varchar(16) NOT NULL,
    healing_kind varchar(16) NOT NULL,
    CONSTRAINT pk_skill_effect_healing_modifier_details PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_healing_modifier_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results (game_id, skill_key, effect_key, result_key) ON DELETE CASCADE,
    CONSTRAINT ck_skill_effect_healing_modifier_direction CHECK (direction IN ('DONE', 'RECEIVED')),
    CONSTRAINT ck_skill_effect_healing_modifier_operation CHECK (operation IN ('INCREASE', 'DECREASE')),
    CONSTRAINT ck_skill_effect_healing_modifier_kind CHECK (healing_kind IN ('ANY', 'DIRECT', 'VAMP'))
);

CREATE TABLE IF NOT EXISTS public.skill_effect_damage_immunity_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    damage_type_key varchar(64),
    delivery_kind varchar(32) NOT NULL,
    origin_kind varchar(32) NOT NULL,
    CONSTRAINT pk_skill_effect_damage_immunity_details PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_damage_immunity_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results (game_id, skill_key, effect_key, result_key) ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_damage_immunity_damage_type
        FOREIGN KEY (game_id, damage_type_key)
        REFERENCES public.damage_types (game_id, damage_type_key) ON DELETE RESTRICT,
    CONSTRAINT ck_skill_effect_damage_immunity_delivery CHECK (delivery_kind IN ('ANY', 'SKILL', 'BASIC_ATTACK')),
    CONSTRAINT ck_skill_effect_damage_immunity_origin CHECK (origin_kind IN ('ANY', 'DIRECT', 'REFLECTED'))
);

CREATE INDEX IF NOT EXISTS ix_skill_effect_damage_immunity_damage_type
    ON public.skill_effect_damage_immunity_details
    (game_id, damage_type_key, skill_key, effect_key, result_key);

CREATE TABLE IF NOT EXISTS public.skill_effect_health_floor_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    attribute_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_effect_health_floor_details PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_health_floor_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results (game_id, skill_key, effect_key, result_key) ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_health_floor_attribute
        FOREIGN KEY (game_id, attribute_key)
        REFERENCES public.attributes (game_id, attribute_key) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_skill_effect_health_floor_attribute
    ON public.skill_effect_health_floor_details
    (game_id, attribute_key, skill_key, effect_key, result_key);

ALTER TABLE public.skill_effect_results DROP CONSTRAINT IF EXISTS ck_skill_effect_results_type;
ALTER TABLE public.skill_effect_results ADD CONSTRAINT ck_skill_effect_results_type CHECK (result_type IN (
    'DAMAGE', 'DIRECT_HEAL', 'NORMAL_SHIELD', 'ATTRIBUTE_CHANGE',
    'RESOURCE_CHANGE', 'COOLDOWN_CHANGE', 'STATUS_OPERATION', 'LIFECYCLE_OPERATION',
    'DAMAGE_MODIFIER', 'HEALING_MODIFIER', 'DAMAGE_IMMUNITY', 'HEALTH_FLOOR'
));

ALTER TABLE public.skill_trigger_rules DROP CONSTRAINT IF EXISTS ck_skill_trigger_rules_event_type;
ALTER TABLE public.skill_trigger_rules ADD CONSTRAINT ck_skill_trigger_rules_event_type CHECK (event_type IN (
    'SKILL_USED', 'BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'SKILL_HIT',
    'PROCESS_MOMENT', 'RESULT_AVAILABLE', 'LIFECYCLE_MOMENT',
    'DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN', 'STATUS_CHANGED',
    'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED', 'CONTROL_RECEIVED',
    'ENTITY_DIED', 'ENTITY_UNTARGETABLE', 'KILL', 'PROCESS_CANCEL_REQUESTED'
));

ALTER TABLE public.skill_trigger_rule_event_value_conditions
    DROP CONSTRAINT IF EXISTS ck_skill_trigger_event_value_cond_key;
ALTER TABLE public.skill_trigger_rule_event_value_conditions
    ADD CONSTRAINT ck_skill_trigger_event_value_cond_key CHECK (event_value_key IN (
        'STEP_EXECUTION_INDEX', 'CHARGE_DURATION_MS', 'RECAST_COUNT', 'HIT_INDEX',
        'LIFECYCLE_STACKS', 'PERIOD_INDEX', 'REMAINING_MS', 'STATE_BEFORE', 'STATE_AFTER',
        'ATTRIBUTE_BEFORE', 'ATTRIBUTE_AFTER', 'THRESHOLD_VALUE',
        'RAW_DAMAGE', 'POST_DEFENSE_DAMAGE', 'HEALTH_BEFORE', 'PROJECTED_HEALTH_AFTER'
    ));

ALTER TABLE public.skill_trigger_rule_event_value_bindings
    DROP CONSTRAINT IF EXISTS ck_skill_trigger_event_value_bind_key;
ALTER TABLE public.skill_trigger_rule_event_value_bindings
    ADD CONSTRAINT ck_skill_trigger_event_value_bind_key CHECK (event_value_key IN (
        'STEP_EXECUTION_INDEX', 'CHARGE_DURATION_MS', 'RECAST_COUNT', 'HIT_INDEX',
        'LIFECYCLE_STACKS', 'PERIOD_INDEX', 'REMAINING_MS', 'STATE_BEFORE', 'STATE_AFTER',
        'ATTRIBUTE_BEFORE', 'ATTRIBUTE_AFTER', 'THRESHOLD_VALUE',
        'RAW_DAMAGE', 'POST_DEFENSE_DAMAGE', 'HEALTH_BEFORE', 'PROJECTED_HEALTH_AFTER'
    ));

COMMIT;
