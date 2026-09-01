-- 阶段 7.6.4：斩杀结果明细、命中/攻击联动结果与联动事件。
-- 只接受完整前置（阶段 7.6.3）或完整目标结构；部分结构、未知列宽、约束、函数或触发器漂移必须失败。
-- 本脚本不写业务数据、不回填、不双写、不 CASCADE。

BEGIN;

DO $migration_preflight$
DECLARE
    v_existing_count integer;
    v_constraint_def text;
    v_actual_values text[];
    v_result_type_udt text;
    v_result_type_len integer;
    v_result_type_default text;
    v_execute_columns text[];
    v_link_columns text[];
    v_function_src text;
    v_previous_result_values constant text[] := ARRAY[
        'ATTRIBUTE_CHANGE', 'COOLDOWN_CHANGE', 'DAMAGE', 'DAMAGE_IMMUNITY',
        'DAMAGE_MODIFIER', 'DIRECT_HEAL', 'HEALING_MODIFIER', 'HEALTH_FLOOR',
        'LIFECYCLE_OPERATION', 'NORMAL_SHIELD', 'RESOURCE_CHANGE', 'SPELL_SHIELD',
        'STATUS_OPERATION'
    ];
    v_target_result_values constant text[] := ARRAY[
        'ATTACK_LINK_APPLICATION', 'ATTRIBUTE_CHANGE', 'COOLDOWN_CHANGE', 'DAMAGE',
        'DAMAGE_IMMUNITY', 'DAMAGE_MODIFIER', 'DIRECT_HEAL', 'EXECUTE',
        'HEALING_MODIFIER', 'HEALTH_FLOOR', 'HIT_LINK_APPLICATION',
        'LIFECYCLE_OPERATION', 'NORMAL_SHIELD', 'RESOURCE_CHANGE', 'SPELL_SHIELD',
        'STATUS_OPERATION'
    ];
    v_previous_event_values constant text[] := ARRAY[
        'BASIC_ATTACK_HIT', 'BASIC_ATTACK_START', 'CONTROL_RECEIVED', 'DAMAGE_DEALT',
        'DAMAGE_PENDING', 'DAMAGE_TAKEN', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
        'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED', 'KILL', 'LIFECYCLE_MOMENT',
        'PROCESS_CANCEL_REQUESTED', 'PROCESS_MOMENT', 'RESULT_AVAILABLE', 'SKILL_HIT',
        'SKILL_USED', 'SPELL_SHIELD_BLOCKED', 'STATUS_CHANGED'
    ];
    v_target_event_values constant text[] := ARRAY[
        'ATTACK_LINK_APPLIED', 'BASIC_ATTACK_HIT', 'BASIC_ATTACK_START', 'CONTROL_RECEIVED',
        'DAMAGE_DEALT', 'DAMAGE_PENDING', 'DAMAGE_TAKEN', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
        'HEALTH_THRESHOLD_CROSSED', 'HIT_LINK_APPLIED', 'INTERNAL_STATE_CHANGED', 'KILL',
        'LIFECYCLE_MOMENT', 'PROCESS_CANCEL_REQUESTED', 'PROCESS_MOMENT', 'RESULT_AVAILABLE',
        'SKILL_HIT', 'SKILL_USED', 'SPELL_SHIELD_BLOCKED', 'STATUS_CHANGED'
    ];
BEGIN
    IF to_regclass('public.skill_effect_results') IS NULL
        OR to_regclass('public.skill_effect_result_spell_shield_policies') IS NULL
        OR to_regclass('public.skill_trigger_rule_spell_shield_blocked_events') IS NULL
        OR to_regclass('public.skill_effect_health_floor_details') IS NULL
        OR to_regclass('public.modifier_zones') IS NULL
        OR to_regclass('public.skill_effect_cooldown_change_targets') IS NULL
        OR to_regclass('public.skill_effect_result_critical_policies') IS NULL
        OR to_regclass('public.skill_effect_result_vamp_rules') IS NULL
        OR to_regclass('public.skill_effect_result_lifecycle_behaviors') IS NULL
        OR to_regclass('public.skills') IS NULL THEN
        RAISE EXCEPTION 'stage 7.6.3 schema is required before stage 7.6.4';
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

    SELECT COUNT(*)
      INTO v_existing_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname IN (
           'skill_effect_execute_details',
           'skill_trigger_rule_link_events'
       );
    IF v_existing_count NOT IN (0, 2) THEN
        RAISE EXCEPTION 'stage 7.6.4 structure is partial';
    END IF;

    SELECT data_type, character_maximum_length, column_default
      INTO v_result_type_udt, v_result_type_len, v_result_type_default
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'skill_effect_results'
       AND column_name = 'result_type';
    IF v_result_type_udt IS DISTINCT FROM 'character varying'
        OR v_result_type_default IS NOT NULL
        OR v_result_type_len NOT IN (24, 32) THEN
        RAISE EXCEPTION 'skill_effect_results.result_type column width drifted: type=%, length=%, default=%',
            v_result_type_udt, v_result_type_len, v_result_type_default;
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

    IF to_regprocedure('public.trg_skill_effect_result_complete_shape()') IS NOT NULL THEN
        SELECT pg_get_functiondef('public.trg_skill_effect_result_complete_shape()'::regprocedure)
          INTO v_function_src;
        IF v_function_src NOT ILIKE '%v_result_type varchar(24)%'
            AND v_function_src NOT ILIKE '%v_result_type varchar(32)%' THEN
            RAISE EXCEPTION 'trg_skill_effect_result_complete_shape function drifted';
        END IF;
    END IF;
    IF to_regprocedure('public.trg_skill_trigger_rule_complete_shape()') IS NOT NULL THEN
        SELECT pg_get_functiondef('public.trg_skill_trigger_rule_complete_shape()'::regprocedure)
          INTO v_function_src;
        IF v_function_src NOT ILIKE '%v_event_type varchar(32)%' THEN
            RAISE EXCEPTION 'trg_skill_trigger_rule_complete_shape function drifted';
        END IF;
    END IF;

    IF v_existing_count = 2 THEN
        SELECT array_agg(column_name::text ORDER BY ordinal_position)
          INTO v_execute_columns
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skill_effect_execute_details';
        IF v_execute_columns IS DISTINCT FROM ARRAY[
            'game_id', 'skill_key', 'effect_key', 'result_key', 'attribute_key'
        ]::text[] THEN
            RAISE EXCEPTION 'skill_effect_execute_details column set drifted: %', v_execute_columns;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'skill_effect_execute_details'
              AND c.conname = 'pk_skill_effect_execute_details'
              AND c.contype = 'p'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'skill_effect_execute_details'
              AND c.conname = 'fk_skill_effect_execute_details_result'
              AND c.contype = 'f'
              AND c.confrelid = 'public.skill_effect_results'::regclass
              AND c.confdeltype = 'c'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'skill_effect_execute_details'
              AND c.conname = 'fk_skill_effect_execute_details_attribute'
              AND c.contype = 'f'
              AND c.confrelid = 'public.attributes'::regclass
              AND c.confdeltype = 'r'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'skill_effect_execute_details'
              AND indexname = 'ix_skill_effect_execute_details_attribute'
        ) THEN
            RAISE EXCEPTION 'skill_effect_execute_details constraint drifted';
        END IF;

        SELECT array_agg(column_name::text ORDER BY ordinal_position)
          INTO v_link_columns
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'skill_trigger_rule_link_events';
        IF v_link_columns IS DISTINCT FROM ARRAY[
            'game_id', 'skill_key', 'rule_key', 'source_skill_key'
        ]::text[] THEN
            RAISE EXCEPTION 'skill_trigger_rule_link_events column set drifted: %', v_link_columns;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'skill_trigger_rule_link_events'
              AND c.conname = 'pk_skill_trigger_rule_link_events'
              AND c.contype = 'p'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'skill_trigger_rule_link_events'
              AND c.conname = 'fk_skill_trigger_link_events_rule'
              AND c.contype = 'f'
              AND c.confrelid = 'public.skill_trigger_rules'::regclass
              AND c.confdeltype = 'c'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'skill_trigger_rule_link_events'
              AND c.conname = 'fk_skill_trigger_link_events_source_skill'
              AND c.contype = 'f'
              AND c.confrelid = 'public.skills'::regclass
              AND c.confdeltype = 'r'
              AND c.confmatchtype = 's'
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = 'skill_trigger_rule_link_events'
              AND indexname = 'ix_skill_trigger_link_events_source_skill'
        ) THEN
            RAISE EXCEPTION 'skill_trigger_rule_link_events constraint drifted';
        END IF;
    END IF;
END;
$migration_preflight$;

CREATE TABLE IF NOT EXISTS public.skill_effect_execute_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    attribute_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_effect_execute_details
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_execute_details_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_execute_details_attribute
        FOREIGN KEY (game_id, attribute_key)
        REFERENCES public.attributes (game_id, attribute_key)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_skill_effect_execute_details_attribute
    ON public.skill_effect_execute_details
    (game_id, attribute_key, skill_key, effect_key, result_key);

COMMENT ON TABLE public.skill_effect_execute_details IS '斩杀结果明细';

CREATE TABLE IF NOT EXISTS public.skill_trigger_rule_link_events (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    source_skill_key varchar(64),
    CONSTRAINT pk_skill_trigger_rule_link_events
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_link_events_rule
        FOREIGN KEY (game_id, skill_key, rule_key)
        REFERENCES public.skill_trigger_rules (game_id, skill_key, rule_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_trigger_link_events_source_skill
        FOREIGN KEY (game_id, source_skill_key)
        REFERENCES public.skills (game_id, skill_key)
        MATCH SIMPLE
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_skill_trigger_link_events_source_skill
    ON public.skill_trigger_rule_link_events
    (game_id, source_skill_key, skill_key, rule_key);

COMMENT ON TABLE public.skill_trigger_rule_link_events IS '技能触发规则命中或攻击联动事件明细';

DO $migration_alter_result_type$
DECLARE
    v_result_type_len integer;
BEGIN
    SELECT character_maximum_length
      INTO v_result_type_len
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'skill_effect_results'
       AND column_name = 'result_type';
    IF v_result_type_len = 24 THEN
        ALTER TABLE public.skill_effect_results
            ALTER COLUMN result_type TYPE varchar(32);
    ELSIF v_result_type_len IS DISTINCT FROM 32 THEN
        RAISE EXCEPTION 'skill_effect_results.result_type column width drifted: %', v_result_type_len;
    END IF;
END;
$migration_alter_result_type$;

ALTER TABLE public.skill_effect_results
    DROP CONSTRAINT IF EXISTS ck_skill_effect_results_type;
ALTER TABLE public.skill_effect_results
    ADD CONSTRAINT ck_skill_effect_results_type
        CHECK (result_type IN (
            'DAMAGE', 'DIRECT_HEAL', 'NORMAL_SHIELD', 'ATTRIBUTE_CHANGE',
            'RESOURCE_CHANGE', 'COOLDOWN_CHANGE', 'STATUS_OPERATION',
            'LIFECYCLE_OPERATION', 'DAMAGE_MODIFIER', 'HEALING_MODIFIER',
            'DAMAGE_IMMUNITY', 'HEALTH_FLOOR', 'SPELL_SHIELD',
            'EXECUTE', 'HIT_LINK_APPLICATION', 'ATTACK_LINK_APPLICATION'
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
            'KILL', 'PROCESS_CANCEL_REQUESTED', 'SPELL_SHIELD_BLOCKED',
            'HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED'
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
            OR v_cooldown_target_count < 1
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
        'skill_trigger_rule_link_events',
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

COMMIT;
