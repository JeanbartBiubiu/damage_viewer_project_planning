-- 由统一迁移在同一停写事务内调用；仅转换业务内容，不删除旧表。
-- 字段取自原技能触发规则聚合接口。前序结果与结果修正的冗余效果标识不进入业务 JSON。
ALTER TABLE public.skill_trigger_rules
    ADD COLUMN event_source jsonb,
    ADD COLUMN condition_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN actions jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN limits jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.skill_trigger_rules r SET
    event_source = jsonb_build_object('eventType', r.event_type, 'detail', CASE
        WHEN r.event_type IN ('PROCESS_MOMENT') THEN (SELECT jsonb_build_object('processKey', d.process_key,
                'moment', jsonb_build_object('momentType', d.moment_type, 'stepKey', d.step_key))
            FROM public.skill_trigger_rule_process_events d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
        WHEN r.event_type IN ('PROCESS_CANCEL_REQUESTED') THEN (SELECT jsonb_build_object('processKey', d.process_key)
            FROM public.skill_trigger_rule_process_events d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
        WHEN r.event_type IN ('SKILL_USED', 'SKILL_HIT') THEN (SELECT jsonb_build_object('sourceSkillKey', d.source_skill_key, 'useKind', d.use_kind)
            FROM public.skill_trigger_rule_skill_events d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
        WHEN r.event_type IN ('RESULT_AVAILABLE') THEN (SELECT jsonb_build_object('effectKey', d.effect_key, 'resultKey', d.result_key)
            FROM public.skill_trigger_rule_result_events d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
        WHEN r.event_type IN ('LIFECYCLE_MOMENT') THEN (SELECT jsonb_build_object('effectKey', d.effect_key, 'moment', d.lifecycle_moment)
            FROM public.skill_trigger_rule_lifecycle_events d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
        WHEN r.event_type IN ('STATUS_CHANGED') THEN (SELECT jsonb_build_object('subject', d.subject, 'statusKey', d.status_key, 'change', d.change_kind)
            FROM public.skill_trigger_rule_status_events d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
        WHEN r.event_type IN ('HEALTH_THRESHOLD_CROSSED') THEN (SELECT jsonb_build_object('subject', d.subject, 'attributeKey', d.attribute_key, 'thresholdFormulaKey', d.threshold_formula_key, 'direction', d.direction)
            FROM public.skill_trigger_rule_health_threshold_events d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
        WHEN r.event_type IN ('INTERNAL_STATE_CHANGED') THEN (SELECT jsonb_build_object('stateKey', d.state_key, 'changeKind', d.change_kind)
            FROM public.skill_trigger_rule_internal_state_events d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
        WHEN r.event_type IN ('ENTITY_DIED', 'ENTITY_UNTARGETABLE') THEN (SELECT jsonb_build_object('subject', d.subject)
            FROM public.skill_trigger_rule_subject_events d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
        WHEN r.event_type IN ('DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN') THEN (SELECT jsonb_build_object('damageTypeKey', d.damage_type_key, 'deliveryKind', d.delivery_kind, 'originKind', d.origin_kind)
            FROM public.skill_trigger_rule_damage_events d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
        WHEN r.event_type IN ('SPELL_SHIELD_BLOCKED') THEN (SELECT jsonb_build_object('shieldEffectKey', d.shield_effect_key)
            FROM public.skill_trigger_rule_spell_shield_blocked_events d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
        WHEN r.event_type IN ('HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED') THEN (SELECT jsonb_build_object('sourceSkillKey', d.source_skill_key)
            FROM public.skill_trigger_rule_link_events d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
        WHEN r.event_type IN ('BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'CONTROL_RECEIVED', 'KILL') THEN '{}'::jsonb
    END),
    condition_groups = COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'groupKey', g.group_key, 'name', g.name, 'sortOrder', g.sort_order,
        'conditions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'conditionKey', c.condition_key, 'conditionType', c.condition_type, 'sortOrder', c.sort_order,
            'detail', CASE c.condition_type
                    WHEN 'ATTRIBUTE_COMPARE' THEN (SELECT jsonb_build_object('subject', d.subject, 'attributeKey', d.attribute_key, 'attributeValueKind', d.attribute_value_kind, 'comparator', d.comparator, 'comparisonFormulaKey', d.comparison_formula_key)
                        FROM public.skill_trigger_rule_attribute_conditions d
                        WHERE (d.game_id, d.skill_key, d.rule_key, d.group_key, d.condition_key) = (c.game_id, c.skill_key, c.rule_key, c.group_key, c.condition_key))
                    WHEN 'STATUS_CHECK' THEN (SELECT jsonb_build_object('subject', d.subject, 'statusKey', d.status_key, 'checkKind', d.check_kind, 'sourceEffectKey', d.source_effect_key, 'sourceResultKey', d.source_result_key, 'comparator', d.comparator, 'comparisonFormulaKey', d.comparison_formula_key)
                        FROM public.skill_trigger_rule_status_conditions d
                        WHERE (d.game_id, d.skill_key, d.rule_key, d.group_key, d.condition_key) = (c.game_id, c.skill_key, c.rule_key, c.group_key, c.condition_key))
                    WHEN 'INTERNAL_STATE_CHECK' THEN (SELECT jsonb_build_object('stateKey', d.state_key, 'valueKind', d.value_kind, 'optionKey', d.option_key, 'expectedBoolean', d.expected_boolean, 'comparator', d.comparator, 'comparisonFormulaKey', d.comparison_formula_key)
                        FROM public.skill_trigger_rule_internal_state_conditions d
                        WHERE (d.game_id, d.skill_key, d.rule_key, d.group_key, d.condition_key) = (c.game_id, c.skill_key, c.rule_key, c.group_key, c.condition_key))
                    WHEN 'EVENT_VALUE_COMPARE' THEN (SELECT jsonb_build_object('eventValueKey', d.event_value_key, 'comparator', d.comparator, 'comparisonFormulaKey', d.comparison_formula_key)
                        FROM public.skill_trigger_rule_event_value_conditions d
                        WHERE (d.game_id, d.skill_key, d.rule_key, d.group_key, d.condition_key) = (c.game_id, c.skill_key, c.rule_key, c.group_key, c.condition_key))
            END) ORDER BY c.sort_order, c.condition_key)
            FROM public.skill_trigger_rule_conditions c
            WHERE (c.game_id, c.skill_key, c.rule_key, c.group_key) = (g.game_id, g.skill_key, g.rule_key, g.group_key)), '[]'::jsonb))
        ORDER BY g.sort_order, g.group_key)
        FROM public.skill_trigger_rule_condition_groups g
        WHERE (g.game_id, g.skill_key, g.rule_key) = (r.game_id, r.skill_key, r.rule_key)), '[]'::jsonb),
    actions = COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'actionKey', a.action_key, 'name', a.name, 'actionType', a.action_type, 'sortOrder', a.sort_order,
        'targetContext', CASE WHEN a.action_type = 'FAIL_PROCESS' THEN NULL ELSE a.target_context END,
        'detail', CASE a.action_type
            WHEN 'EXECUTE_EFFECT' THEN (SELECT jsonb_build_object('effectKey', d.effect_key)
            FROM public.skill_trigger_rule_effect_actions d
            WHERE (d.game_id, d.skill_key, d.rule_key, d.action_key) = (a.game_id, a.skill_key, a.rule_key, a.action_key))
            WHEN 'START_PROCESS' THEN (SELECT jsonb_build_object('processKey', d.process_key)
            FROM public.skill_trigger_rule_process_actions d
            WHERE (d.game_id, d.skill_key, d.rule_key, d.action_key) = (a.game_id, a.skill_key, a.rule_key, a.action_key))
            WHEN 'FAIL_PROCESS' THEN (SELECT jsonb_build_object('processKey', d.process_key, 'failureReason', d.failure_reason)
            FROM public.skill_trigger_rule_process_actions d
            WHERE (d.game_id, d.skill_key, d.rule_key, d.action_key) = (a.game_id, a.skill_key, a.rule_key, a.action_key))
        END,
        'runtimeInputBindings', CASE WHEN a.action_type = 'FAIL_PROCESS' THEN '[]'::jsonb ELSE
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'bindingKey', b.binding_key, 'parameterKey', b.parameter_key, 'sourceType', b.source_type,
                'detail', CASE b.source_type
                WHEN 'INTERNAL_STATE' THEN (SELECT jsonb_build_object('stateKey', d.state_key, 'valueKind', d.value_kind, 'optionKey', d.option_key)
                    FROM public.skill_trigger_rule_internal_state_bindings d
                    WHERE (d.game_id, d.skill_key, d.rule_key, d.action_key, d.binding_key) = (b.game_id, b.skill_key, b.rule_key, b.action_key, b.binding_key))
                WHEN 'COMBAT_STATUS' THEN (SELECT jsonb_build_object('subject', d.subject, 'statusKey', d.status_key, 'valueKind', d.value_kind, 'sourceEffectKey', d.source_effect_key, 'sourceResultKey', d.source_result_key)
                    FROM public.skill_trigger_rule_combat_status_bindings d
                    WHERE (d.game_id, d.skill_key, d.rule_key, d.action_key, d.binding_key) = (b.game_id, b.skill_key, b.rule_key, b.action_key, b.binding_key))
                WHEN 'EVENT_VALUE' THEN (SELECT jsonb_build_object('eventValueKey', d.event_value_key)
                    FROM public.skill_trigger_rule_event_value_bindings d
                    WHERE (d.game_id, d.skill_key, d.rule_key, d.action_key, d.binding_key) = (b.game_id, b.skill_key, b.rule_key, b.action_key, b.binding_key))
                WHEN 'PRIOR_ACTION_RESULT' THEN (SELECT jsonb_build_object('sourceActionKey', d.source_action_key, 'sourceResultKey', d.source_result_key, 'outputKind', d.output_kind)
                    FROM public.skill_trigger_rule_prior_result_bindings d
                    WHERE (d.game_id, d.skill_key, d.rule_key, d.action_key, d.binding_key) = (b.game_id, b.skill_key, b.rule_key, b.action_key, b.binding_key))
                END) ORDER BY b.binding_key)
                FROM public.skill_trigger_rule_runtime_input_bindings b
                WHERE (b.game_id, b.skill_key, b.rule_key, b.action_key) = (a.game_id, a.skill_key, a.rule_key, a.action_key)), '[]'::jsonb)
            END,
        'resultModifiers', CASE WHEN a.action_type = 'EXECUTE_EFFECT' THEN
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'resultKey', m.result_key, 'fixedMultiplier', m.fixed_multiplier,
                'fixedMinValue', m.fixed_min_value, 'fixedMaxValue', m.fixed_max_value)
                ORDER BY m.result_key)
                FROM public.skill_trigger_rule_result_modifiers m
                WHERE (m.game_id, m.skill_key, m.rule_key, m.action_key) = (a.game_id, a.skill_key, a.rule_key, a.action_key)), '[]'::jsonb)
            ELSE '[]'::jsonb END)
        ORDER BY a.sort_order, a.action_key)
        FROM public.skill_trigger_rule_actions a
        WHERE (a.game_id, a.skill_key, a.rule_key) = (r.game_id, r.skill_key, r.rule_key)), '[]'::jsonb),
    limits = jsonb_build_object(
        'perTargetCooldown', (SELECT jsonb_build_object('durationFormulaKey', d.duration_formula_key, 'targetContext', d.target_context)
            FROM public.skill_trigger_rule_per_target_cooldowns d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key)),
        'maxTriggersPerProcess', (SELECT jsonb_build_object('processKey', d.process_key, 'limitFormulaKey', d.limit_formula_key)
            FROM public.skill_trigger_rule_process_limits d
            WHERE (d.game_id, d.skill_key, d.rule_key) = (r.game_id, r.skill_key, r.rule_key))
    );

ALTER TABLE public.skill_trigger_rules
    ALTER COLUMN event_source SET NOT NULL,
    ADD CONSTRAINT ck_skill_trigger_rules_event_source_object CHECK (jsonb_typeof(event_source) = 'object'),
    ADD CONSTRAINT ck_skill_trigger_rules_condition_groups_array CHECK (jsonb_typeof(condition_groups) = 'array'),
    ADD CONSTRAINT ck_skill_trigger_rules_actions_array CHECK (jsonb_typeof(actions) = 'array'),
    ADD CONSTRAINT ck_skill_trigger_rules_limits_object CHECK (jsonb_typeof(limits) = 'object');
