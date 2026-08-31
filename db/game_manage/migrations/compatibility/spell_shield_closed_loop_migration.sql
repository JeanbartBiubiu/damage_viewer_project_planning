BEGIN;

-- 阶段 7.6.3：法术护盾结果、结果阻挡粒度与已阻挡事件。
-- 本脚本不写业务数据；执行后必须立即执行 db/game_manage/triggers.sql 刷新累计形状约束。

DO $$
BEGIN
    IF to_regclass('public.skill_effect_results') IS NULL
        OR to_regclass('public.skill_effect_result_lifecycle_behaviors') IS NULL
        OR to_regclass('public.skill_trigger_rules') IS NULL
        OR to_regclass('public.skill_effects') IS NULL THEN
        RAISE EXCEPTION 'stage 7.6.2 schema is required before stage 7.6.3';
    END IF;
END;
$$;

DO $$
DECLARE
    v_existing_count integer;
    v_constraint_def text;
    v_actual_values text[];
    v_previous_result_values constant text[] := ARRAY[
        'ATTRIBUTE_CHANGE', 'COOLDOWN_CHANGE', 'DAMAGE', 'DAMAGE_IMMUNITY',
        'DAMAGE_MODIFIER', 'DIRECT_HEAL', 'HEALING_MODIFIER', 'HEALTH_FLOOR',
        'LIFECYCLE_OPERATION', 'NORMAL_SHIELD', 'RESOURCE_CHANGE', 'STATUS_OPERATION'
    ];
    v_target_result_values constant text[] := ARRAY[
        'ATTRIBUTE_CHANGE', 'COOLDOWN_CHANGE', 'DAMAGE', 'DAMAGE_IMMUNITY',
        'DAMAGE_MODIFIER', 'DIRECT_HEAL', 'HEALING_MODIFIER', 'HEALTH_FLOOR',
        'LIFECYCLE_OPERATION', 'NORMAL_SHIELD', 'RESOURCE_CHANGE', 'SPELL_SHIELD',
        'STATUS_OPERATION'
    ];
    v_previous_event_values constant text[] := ARRAY[
        'BASIC_ATTACK_HIT', 'BASIC_ATTACK_START', 'CONTROL_RECEIVED', 'DAMAGE_DEALT',
        'DAMAGE_PENDING', 'DAMAGE_TAKEN', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
        'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED', 'KILL', 'LIFECYCLE_MOMENT',
        'PROCESS_CANCEL_REQUESTED', 'PROCESS_MOMENT', 'RESULT_AVAILABLE', 'SKILL_HIT',
        'SKILL_USED', 'STATUS_CHANGED'
    ];
    v_target_event_values constant text[] := ARRAY[
        'BASIC_ATTACK_HIT', 'BASIC_ATTACK_START', 'CONTROL_RECEIVED', 'DAMAGE_DEALT',
        'DAMAGE_PENDING', 'DAMAGE_TAKEN', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
        'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED', 'KILL', 'LIFECYCLE_MOMENT',
        'PROCESS_CANCEL_REQUESTED', 'PROCESS_MOMENT', 'RESULT_AVAILABLE', 'SKILL_HIT',
        'SKILL_USED', 'SPELL_SHIELD_BLOCKED', 'STATUS_CHANGED'
    ];
BEGIN
    SELECT COUNT(*)
      INTO v_existing_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname IN (
           'skill_effect_result_spell_shield_policies',
           'skill_trigger_rule_spell_shield_blocked_events'
       );
    IF v_existing_count NOT IN (0, 2) THEN
        RAISE EXCEPTION 'stage 7.6.3 structure is partial';
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
END;
$$;

CREATE TABLE IF NOT EXISTS public.skill_effect_result_spell_shield_policies (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    block_scope varchar(24) NOT NULL,
    CONSTRAINT pk_skill_effect_result_spell_shield_policies
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_spell_shield_policy_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_skill_effect_spell_shield_policy_scope
        CHECK (block_scope IN ('SKILL', 'EFFECT', 'DAMAGE_INSTANCE', 'RESULT'))
);

COMMENT ON TABLE public.skill_effect_result_spell_shield_policies IS '结果被法术护盾阻挡的粒度';

CREATE TABLE IF NOT EXISTS public.skill_trigger_rule_spell_shield_blocked_events (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    shield_effect_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_trigger_rule_spell_shield_blocked_events
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_spell_shield_blocked_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_spell_shield_blocked_effect
        FOREIGN KEY (game_id, skill_key, shield_effect_key)
        REFERENCES public.skill_effects (game_id, skill_key, effect_key)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_skill_trigger_spell_shield_blocked_effect
    ON public.skill_trigger_rule_spell_shield_blocked_events
    (game_id, skill_key, shield_effect_key, rule_key);

COMMENT ON TABLE public.skill_trigger_rule_spell_shield_blocked_events IS '技能触发规则法术护盾已阻挡事件明细';

ALTER TABLE public.skill_effect_results
    DROP CONSTRAINT IF EXISTS ck_skill_effect_results_type;
ALTER TABLE public.skill_effect_results
    ADD CONSTRAINT ck_skill_effect_results_type
        CHECK (result_type IN (
            'DAMAGE', 'DIRECT_HEAL', 'NORMAL_SHIELD', 'ATTRIBUTE_CHANGE',
            'RESOURCE_CHANGE', 'COOLDOWN_CHANGE', 'STATUS_OPERATION',
            'LIFECYCLE_OPERATION', 'DAMAGE_MODIFIER', 'HEALING_MODIFIER',
            'DAMAGE_IMMUNITY', 'HEALTH_FLOOR', 'SPELL_SHIELD'
        ));

ALTER TABLE public.skill_trigger_rules
    DROP CONSTRAINT IF EXISTS ck_skill_trigger_rules_event_type;
ALTER TABLE public.skill_trigger_rules
    ADD CONSTRAINT ck_skill_trigger_rules_event_type
        CHECK (event_type IN (
            'SKILL_USED', 'BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'SKILL_HIT',
            'PROCESS_MOMENT', 'RESULT_AVAILABLE', 'LIFECYCLE_MOMENT',
            'DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN', 'STATUS_CHANGED',
            'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED',
            'CONTROL_RECEIVED', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
            'KILL', 'PROCESS_CANCEL_REQUESTED', 'SPELL_SHIELD_BLOCKED'
        ));

COMMIT;
