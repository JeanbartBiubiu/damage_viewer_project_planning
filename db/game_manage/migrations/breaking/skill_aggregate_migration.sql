-- 91 表迁至 24 表。仅在核对目标、备份和停止业务写入后执行一次。
-- 本脚本由 tools/authoring/ 的验收执行器在事务中调用；自身不提交，便于同连接对照失败回滚。
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
LOCK TABLE public.games,
    public.attributes,
    public.game_level_configs,
    public.characters,
    public.character_attributes,
    public.equipment,
    public.equipment_attributes,
    public.skill_categories,
    public.skills,
    public.skill_category_relations,
    public.skill_parameters,
    public.skill_formulas,
    public.skill_formula_nodes,
    public.damage_types,
    public.modifier_zones,
    public.statuses,
    public.skill_effects,
    public.skill_effect_results,
    public.skill_effect_result_values,
    public.skill_effect_result_spell_shield_policies,
    public.skill_effect_damage_details,
    public.skill_effect_result_critical_policies,
    public.skill_effect_result_vamp_rules,
    public.skill_effect_result_normal_shield_interactions,
    public.skill_effect_damage_modifier_details,
    public.skill_effect_healing_modifier_details,
    public.skill_effect_damage_immunity_details,
    public.skill_effect_health_floor_details,
    public.skill_effect_execute_details,
    public.skill_effect_attribute_change_details,
    public.skill_effect_resource_change_details,
    public.skill_effect_cooldown_change_details,
    public.skill_effect_result_skill_scopes,
    public.skill_effect_result_skill_targets,
    public.skill_effect_result_skill_category_targets,
    public.skill_effect_haste_modifier_details,
    public.skill_effect_status_operation_details,
    public.skill_effect_lifecycles,
    public.skill_effect_result_lifecycle_behaviors,
    public.skill_effect_lifecycle_operation_details,
    public.skill_internal_states,
    public.skill_internal_state_counter_details,
    public.skill_internal_state_ammo_details,
    public.skill_internal_state_flag_details,
    public.skill_internal_state_cooldown_details,
    public.skill_internal_state_mode_options,
    public.skill_processes,
    public.skill_process_steps,
    public.skill_process_delay_step_details,
    public.skill_process_multi_hit_step_details,
    public.skill_process_periodic_step_details,
    public.skill_process_channel_step_details,
    public.skill_process_charge_step_details,
    public.skill_process_recast_step_details,
    public.skill_process_empowered_attack_step_details,
    public.skill_process_cooldowns,
    public.skill_process_effect_bindings,
    public.skill_process_state_operations,
    public.skill_trigger_rules,
    public.skill_trigger_rule_process_events,
    public.skill_trigger_rule_skill_events,
    public.skill_trigger_rule_result_events,
    public.skill_trigger_rule_lifecycle_events,
    public.skill_trigger_rule_status_events,
    public.skill_trigger_rule_health_threshold_events,
    public.skill_trigger_rule_internal_state_events,
    public.skill_trigger_rule_subject_events,
    public.skill_trigger_rule_damage_events,
    public.skill_trigger_rule_spell_shield_blocked_events,
    public.skill_trigger_rule_link_events,
    public.skill_trigger_rule_condition_groups,
    public.skill_trigger_rule_conditions,
    public.skill_trigger_rule_attribute_conditions,
    public.skill_trigger_rule_status_conditions,
    public.skill_trigger_rule_internal_state_conditions,
    public.skill_trigger_rule_event_value_conditions,
    public.skill_trigger_rule_actions,
    public.skill_trigger_rule_effect_actions,
    public.skill_trigger_rule_process_actions,
    public.skill_trigger_rule_runtime_input_bindings,
    public.skill_trigger_rule_internal_state_bindings,
    public.skill_trigger_rule_combat_status_bindings,
    public.skill_trigger_rule_event_value_bindings,
    public.skill_trigger_rule_prior_result_bindings,
    public.skill_trigger_rule_result_modifiers,
    public.skill_trigger_rule_per_target_cooldowns,
    public.skill_trigger_rule_process_limits,
    public.images,
    public.character_skill_relations,
    public.equipment_skill_relations,
    public.image_relations IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
    IF to_regclass('public.skill_object_references') IS NOT NULL THEN
        RAISE EXCEPTION 'aggregate migration already applied';
    END IF;
END $$;
DO $$ DECLARE item record; BEGIN
    FOR item IN
        SELECT t.tgname, c.relname FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_proc p ON p.oid=t.tgfoid
        WHERE n.nspname='public' AND NOT t.tgisinternal
          AND p.proname IN ('trg_skill_effect_result_complete_shape','trg_skill_effect_lifecycle_aggregate_shape','trg_skill_effect_lifecycle_refresh_target_duration','trg_skill_internal_state_complete_shape','trg_skill_process_step_complete_shape','trg_skill_process_complete_shape','trg_skill_trigger_rule_complete_shape')
    LOOP EXECUTE format('DROP TRIGGER %I ON public.%I',item.tgname,item.relname); END LOOP;
END $$;
-- 由系统精简主迁移在外层事务及停写窗口中执行；此片段不删除旧表。
-- 先核对所有树，避免将孤儿、环或超限节点静默丢弃。
DO $formula_preflight$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.skill_formulas f
        LEFT JOIN public.skill_formula_nodes n USING (game_id, skill_key, formula_key)
        GROUP BY f.game_id, f.skill_key, f.formula_key
        HAVING count(n.node_id) NOT BETWEEN 1 AND 256
            OR count(n.node_id) FILTER (WHERE n.parent_node_id IS NULL) <> 1
    ) THEN
        RAISE EXCEPTION '公式迁移失败：每个公式必须有一个根及 1 至 256 个节点';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.skill_formula_nodes n
        LEFT JOIN public.skill_formula_nodes c
          ON c.game_id = n.game_id AND c.skill_key = n.skill_key
         AND c.formula_key = n.formula_key AND c.parent_node_id = n.node_id
        GROUP BY n.game_id, n.skill_key, n.formula_key, n.node_id, n.node_type,
                 n.parent_node_id, n.child_order
        HAVING (n.node_type = 'OPERATION' AND
                    (count(c.node_id) <> 2 OR min(c.child_order) <> 0 OR max(c.child_order) <> 1))
            OR (n.node_type IN ('PARAMETER', 'ATTRIBUTE') AND count(c.node_id) <> 0)
            OR n.node_type NOT IN ('OPERATION', 'PARAMETER', 'ATTRIBUTE')
            OR (n.parent_node_id IS NULL AND n.child_order <> 0)
    ) THEN
        RAISE EXCEPTION '公式迁移失败：运算节点必须按顺序包含两个子节点，引用节点不能有子节点';
    END IF;

    IF EXISTS (
        WITH RECURSIVE reachable AS (
            SELECT n.game_id, n.skill_key, n.formula_key, n.node_id, 1 AS depth,
                   ARRAY[n.node_id] AS visited
            FROM public.skill_formula_nodes n
            WHERE n.parent_node_id IS NULL
            UNION ALL
            SELECT c.game_id, c.skill_key, c.formula_key, c.node_id, p.depth + 1,
                   p.visited || c.node_id
            FROM reachable p
            JOIN public.skill_formula_nodes c
              ON c.game_id = p.game_id AND c.skill_key = p.skill_key
             AND c.formula_key = p.formula_key AND c.parent_node_id = p.node_id
            WHERE p.depth < 33 AND NOT c.node_id = ANY(p.visited)
        )
        SELECT 1
        FROM public.skill_formula_nodes n
        LEFT JOIN reachable r USING (game_id, skill_key, formula_key, node_id)
        WHERE r.node_id IS NULL OR r.depth > 32
    ) THEN
        RAISE EXCEPTION '公式迁移失败：表达式包含环、孤儿或超过 32 层的节点';
    END IF;
END;
$formula_preflight$;

ALTER TABLE public.skill_formulas ADD COLUMN expression jsonb;

-- 会话临时函数仅用于保持运算顺序地重建现有接口表达式。
CREATE FUNCTION pg_temp.damage_formula_expression(
    p_game_id varchar, p_skill_key varchar, p_formula_key varchar,
    p_node_id uuid, p_depth integer
) RETURNS jsonb LANGUAGE plpgsql AS $formula_expression$
DECLARE
    current_node public.skill_formula_nodes%ROWTYPE;
    children jsonb;
BEGIN
    IF p_depth > 32 THEN
        RAISE EXCEPTION '公式迁移失败：表达式超过 32 层';
    END IF;
    SELECT * INTO STRICT current_node
    FROM public.skill_formula_nodes
    WHERE game_id = p_game_id AND skill_key = p_skill_key
      AND formula_key = p_formula_key AND node_id = p_node_id;
    CASE current_node.node_type
        WHEN 'OPERATION' THEN
            SELECT jsonb_agg(pg_temp.damage_formula_expression(
                p_game_id, p_skill_key, p_formula_key, n.node_id, p_depth + 1
            ) ORDER BY n.child_order) INTO children
            FROM public.skill_formula_nodes n
            WHERE n.game_id = p_game_id AND n.skill_key = p_skill_key
              AND n.formula_key = p_formula_key AND n.parent_node_id = p_node_id;
            RETURN jsonb_build_object('nodeType', 'OPERATION',
                'operation', current_node.operation, 'operands', children);
        WHEN 'PARAMETER' THEN
            RETURN jsonb_build_object('nodeType', 'PARAMETER',
                'parameterKey', current_node.parameter_key);
        WHEN 'ATTRIBUTE' THEN
            RETURN jsonb_build_object('nodeType', 'ATTRIBUTE',
                'attributeOwner', current_node.attribute_owner,
                'attributeKey', current_node.attribute_key,
                'attributeValueKind', current_node.attribute_value_kind);
        ELSE
            RAISE EXCEPTION '公式迁移失败：未知节点类型';
    END CASE;
END;
$formula_expression$;

UPDATE public.skill_formulas f
SET expression = pg_temp.damage_formula_expression(f.game_id, f.skill_key, f.formula_key, n.node_id, 1)
FROM public.skill_formula_nodes n
WHERE n.game_id = f.game_id AND n.skill_key = f.skill_key AND n.formula_key = f.formula_key
  AND n.parent_node_id IS NULL;

ALTER TABLE public.skill_formulas
    ALTER COLUMN expression SET NOT NULL,
    ADD CONSTRAINT ck_skill_formulas_expression CHECK (jsonb_typeof(expression) = 'object');


-- 技能效果聚合转换。由总迁移在同一外层事务中执行；此片段不删除旧表。
-- 数值直接构造为 JSON 数值，不经过浮点或文本转换；保留显式 null 和既有回读排序。
ALTER TABLE public.skill_effects ADD COLUMN results jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.skill_effects ADD COLUMN lifecycle jsonb;

UPDATE public.skill_effects e
SET results = COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'resultKey', r.result_key, 'name', r.name, 'resultType', r.result_type,
        'target', r.target, 'description', r.description, 'sortOrder', r.sort_order,
        'valueRule', (SELECT jsonb_build_object('formulaKey', d.formula_key, 'fixedMultiplier', d.fixed_multiplier, 'fixedMinValue', d.fixed_min_value, 'fixedMaxValue', d.fixed_max_value) FROM public.skill_effect_result_values d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key),
        'detail', CASE r.result_type
            WHEN 'DAMAGE' THEN (SELECT jsonb_build_object('damageTypeKey', d.damage_type_key, 'deliveryKind', d.delivery_kind, 'originKind', d.origin_kind)
            || jsonb_build_object('critical', (SELECT jsonb_build_object('mode', d.critical_mode, 'multiplierFormulaKey', d.multiplier_formula_key) FROM public.skill_effect_result_critical_policies d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key),
                'vampRules', COALESCE((SELECT jsonb_agg(jsonb_build_object('vampType', v.vamp_type, 'basisOutputKind', v.basis_output_kind, 'efficiencyFormulaKey', v.efficiency_formula_key) ORDER BY v.vamp_type)
                    FROM public.skill_effect_result_vamp_rules v WHERE v.game_id = r.game_id AND v.skill_key = r.skill_key AND v.effect_key = r.effect_key AND v.result_key = r.result_key), '[]'::jsonb))
            FROM public.skill_effect_damage_details d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            WHEN 'DIRECT_HEAL' THEN '{}'::jsonb
            WHEN 'NORMAL_SHIELD' THEN (SELECT jsonb_build_object('absorbedDamageTypeKey', d.absorbed_damage_type_key, 'decayMode', d.decay_mode) FROM public.skill_effect_result_normal_shield_interactions d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            WHEN 'ATTRIBUTE_CHANGE' THEN (SELECT jsonb_build_object('attributeKey', d.attribute_key, 'operation', d.operation, 'modifierZoneKey', d.modifier_zone_key) FROM public.skill_effect_attribute_change_details d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            WHEN 'RESOURCE_CHANGE' THEN (SELECT jsonb_build_object('attributeKey', d.attribute_key, 'operation', d.operation) FROM public.skill_effect_resource_change_details d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            WHEN 'COOLDOWN_CHANGE' THEN (SELECT jsonb_build_object('operation', d.operation, 'affectedSkillScope', (SELECT jsonb_build_object('mode', s.mode,
                'skillKeys', COALESCE((SELECT jsonb_agg(t.affected_skill_key ORDER BY (SELECT sk.sort_order FROM public.skills sk WHERE sk.game_id=t.game_id AND sk.skill_key=t.affected_skill_key), t.affected_skill_key)
                    FROM public.skill_effect_result_skill_targets t WHERE t.game_id = r.game_id AND t.skill_key = r.skill_key AND t.effect_key = r.effect_key AND t.result_key = r.result_key), '[]'::jsonb),
                'skillCategoryKeys', COALESCE((SELECT jsonb_agg(t.skill_category_key ORDER BY (SELECT sc.sort_order FROM public.skill_categories sc WHERE sc.game_id=t.game_id AND sc.skill_category_key=t.skill_category_key), t.skill_category_key)
                    FROM public.skill_effect_result_skill_category_targets t WHERE t.game_id = r.game_id AND t.skill_key = r.skill_key AND t.effect_key = r.effect_key AND t.result_key = r.result_key), '[]'::jsonb))
            FROM public.skill_effect_result_skill_scopes s WHERE s.game_id = r.game_id AND s.skill_key = r.skill_key AND s.effect_key = r.effect_key AND s.result_key = r.result_key))
            FROM public.skill_effect_cooldown_change_details d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            WHEN 'STATUS_OPERATION' THEN (SELECT jsonb_build_object('statusKey', d.status_key, 'operation', d.operation) FROM public.skill_effect_status_operation_details d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            WHEN 'LIFECYCLE_OPERATION' THEN (SELECT jsonb_build_object('targetEffectKey', d.target_effect_key, 'operation', d.operation) FROM public.skill_effect_lifecycle_operation_details d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            WHEN 'DAMAGE_MODIFIER' THEN (SELECT jsonb_build_object('modifierZoneKey', d.modifier_zone_key, 'direction', d.direction, 'operation', d.operation, 'damageTypeKey', d.damage_type_key, 'deliveryKind', d.delivery_kind, 'originKind', d.origin_kind, 'criticalFilter', d.critical_filter) FROM public.skill_effect_damage_modifier_details d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            WHEN 'HEALING_MODIFIER' THEN (SELECT jsonb_build_object('modifierZoneKey', d.modifier_zone_key, 'direction', d.direction, 'operation', d.operation, 'healingKind', d.healing_kind) FROM public.skill_effect_healing_modifier_details d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            WHEN 'DAMAGE_IMMUNITY' THEN (SELECT jsonb_build_object('damageTypeKey', d.damage_type_key, 'deliveryKind', d.delivery_kind, 'originKind', d.origin_kind) FROM public.skill_effect_damage_immunity_details d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            WHEN 'HEALTH_FLOOR' THEN (SELECT jsonb_build_object('attributeKey', d.attribute_key) FROM public.skill_effect_health_floor_details d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            WHEN 'SPELL_SHIELD' THEN '{}'::jsonb
            WHEN 'EXECUTE' THEN (SELECT jsonb_build_object('attributeKey', d.attribute_key) FROM public.skill_effect_execute_details d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            WHEN 'HIT_LINK_APPLICATION' THEN '{}'::jsonb
            WHEN 'ATTACK_LINK_APPLICATION' THEN '{}'::jsonb
            WHEN 'SKILL_HASTE_MODIFIER' THEN (SELECT jsonb_build_object('operation', d.operation, 'affectedSkillScope', (SELECT jsonb_build_object('mode', s.mode,
                'skillKeys', COALESCE((SELECT jsonb_agg(t.affected_skill_key ORDER BY (SELECT sk.sort_order FROM public.skills sk WHERE sk.game_id=t.game_id AND sk.skill_key=t.affected_skill_key), t.affected_skill_key)
                    FROM public.skill_effect_result_skill_targets t WHERE t.game_id = r.game_id AND t.skill_key = r.skill_key AND t.effect_key = r.effect_key AND t.result_key = r.result_key), '[]'::jsonb),
                'skillCategoryKeys', COALESCE((SELECT jsonb_agg(t.skill_category_key ORDER BY (SELECT sc.sort_order FROM public.skill_categories sc WHERE sc.game_id=t.game_id AND sc.skill_category_key=t.skill_category_key), t.skill_category_key)
                    FROM public.skill_effect_result_skill_category_targets t WHERE t.game_id = r.game_id AND t.skill_key = r.skill_key AND t.effect_key = r.effect_key AND t.result_key = r.result_key), '[]'::jsonb))
            FROM public.skill_effect_result_skill_scopes s WHERE s.game_id = r.game_id AND s.skill_key = r.skill_key AND s.effect_key = r.effect_key AND s.result_key = r.result_key))
            FROM public.skill_effect_haste_modifier_details d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key)
            ELSE NULL
        END,
        'lifecycleBehavior', (SELECT jsonb_build_object('moment', d.moment, 'valueReadMode', d.value_read_mode, 'stackValueMode', d.stack_value_mode, 'reapplicationValueMode', d.reapplication_value_mode, 'periodicExecutionMode', d.periodic_execution_mode) FROM public.skill_effect_result_lifecycle_behaviors d WHERE d.game_id = r.game_id AND d.skill_key = r.skill_key AND d.effect_key = r.effect_key AND d.result_key = r.result_key),
        'spellShieldBlockScope', (SELECT p.block_scope FROM public.skill_effect_result_spell_shield_policies p WHERE p.game_id = r.game_id AND p.skill_key = r.skill_key AND p.effect_key = r.effect_key AND p.result_key = r.result_key)
    ) ORDER BY r.sort_order, r.result_key)
    FROM public.skill_effect_results r
    WHERE r.game_id = e.game_id AND r.skill_key = e.skill_key AND r.effect_key = e.effect_key
), '[]'::jsonb),
    lifecycle = (
        SELECT jsonb_build_object('durationFormulaKey', l.duration_formula_key, 'maxStacksFormulaKey', l.max_stacks_formula_key, 'applicationStacksFormulaKey', l.application_stacks_formula_key, 'instanceScope', l.instance_scope, 'reapplicationStackMode', l.reapplication_stack_mode, 'reapplicationDurationMode', l.reapplication_duration_mode, 'expiryMode', l.expiry_mode, 'periodicIntervalFormulaKey', l.periodic_interval_formula_key, 'firstPeriodicExecution', l.first_periodic_execution)
        FROM public.skill_effect_lifecycles l
        WHERE l.game_id = e.game_id AND l.skill_key = e.skill_key AND l.effect_key = e.effect_key
    );

ALTER TABLE public.skill_effects
    ADD CONSTRAINT ck_skill_effects_results_array CHECK (jsonb_typeof(results) = 'array'),
    ADD CONSTRAINT ck_skill_effects_lifecycle_object CHECK (lifecycle IS NULL OR jsonb_typeof(lifecycle) = 'object');


-- 由统一迁移在同一停写事务内调用；仅转换业务内容，不删除旧表。
ALTER TABLE public.skill_internal_states ADD COLUMN detail jsonb;

UPDATE public.skill_internal_states s
SET detail = CASE s.state_type
    WHEN 'COUNTER' THEN (SELECT jsonb_build_object(
        'initialValueFormulaKey', d.initial_value_formula_key, 'maxValueFormulaKey', d.max_value_formula_key)
        FROM public.skill_internal_state_counter_details d
        WHERE (d.game_id, d.skill_key, d.state_key) = (s.game_id, s.skill_key, s.state_key))
    WHEN 'AMMO' THEN (SELECT jsonb_build_object(
        'initialValueFormulaKey', d.initial_value_formula_key, 'maxValueFormulaKey', d.max_value_formula_key,
        'recoveryIntervalFormulaKey', d.recovery_interval_formula_key, 'recoveryMode', d.recovery_mode)
        FROM public.skill_internal_state_ammo_details d
        WHERE (d.game_id, d.skill_key, d.state_key) = (s.game_id, s.skill_key, s.state_key))
    WHEN 'FLAG' THEN (SELECT jsonb_build_object('initialEnabled', d.initial_enabled)
        FROM public.skill_internal_state_flag_details d
        WHERE (d.game_id, d.skill_key, d.state_key) = (s.game_id, s.skill_key, s.state_key))
    WHEN 'INTERNAL_COOLDOWN' THEN (SELECT jsonb_build_object('durationFormulaKey', d.duration_formula_key)
        FROM public.skill_internal_state_cooldown_details d
        WHERE (d.game_id, d.skill_key, d.state_key) = (s.game_id, s.skill_key, s.state_key))
    WHEN 'MODE' THEN jsonb_build_object('options', (SELECT jsonb_agg(jsonb_build_object(
        'optionKey', o.option_key, 'name', o.name, 'sortOrder', o.sort_order, 'initial', o.initial)
        ORDER BY o.sort_order, o.option_key)
        FROM public.skill_internal_state_mode_options o
        WHERE (o.game_id, o.skill_key, o.state_key) = (s.game_id, s.skill_key, s.state_key)))
END;

ALTER TABLE public.skill_internal_states ALTER COLUMN detail SET NOT NULL;
ALTER TABLE public.skill_internal_states ADD CONSTRAINT ck_skill_internal_states_detail_object
    CHECK (jsonb_typeof(detail) = 'object');


-- 由统一迁移在同一停写事务内调用；仅转换业务内容，不删除旧表。
ALTER TABLE public.skill_processes
    ADD COLUMN steps jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN cooldown jsonb,
    ADD COLUMN effect_bindings jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN state_operations jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.skill_processes p SET
    steps = COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'stepKey', s.step_key, 'name', s.name, 'stepType', s.step_type,
        'description', s.description, 'sortOrder', s.sort_order,
        'detail', CASE s.step_type
            WHEN 'IMMEDIATE' THEN '{}'::jsonb
            WHEN 'DELAY' THEN (SELECT jsonb_build_object(
                'delayFormulaKey', d.delay_formula_key)
                FROM public.skill_process_delay_step_details d
                WHERE (d.game_id, d.skill_key, d.process_key, d.step_key)
                    = (s.game_id, s.skill_key, s.process_key, s.step_key))
            WHEN 'MULTI_HIT' THEN (SELECT jsonb_build_object(
                'repeatCountFormulaKey', d.repeat_count_formula_key, 'intervalFormulaKey', d.interval_formula_key)
                FROM public.skill_process_multi_hit_step_details d
                WHERE (d.game_id, d.skill_key, d.process_key, d.step_key)
                    = (s.game_id, s.skill_key, s.process_key, s.step_key))
            WHEN 'PERIODIC' THEN (SELECT jsonb_build_object(
                'repeatCountFormulaKey', d.repeat_count_formula_key, 'intervalFormulaKey', d.interval_formula_key, 'firstExecution', d.first_execution)
                FROM public.skill_process_periodic_step_details d
                WHERE (d.game_id, d.skill_key, d.process_key, d.step_key)
                    = (s.game_id, s.skill_key, s.process_key, s.step_key))
            WHEN 'CHANNEL' THEN (SELECT jsonb_build_object(
                'durationFormulaKey', d.duration_formula_key, 'executionCountFormulaKey', d.execution_count_formula_key, 'firstExecution', d.first_execution)
                FROM public.skill_process_channel_step_details d
                WHERE (d.game_id, d.skill_key, d.process_key, d.step_key)
                    = (s.game_id, s.skill_key, s.process_key, s.step_key))
            WHEN 'CHARGE' THEN (SELECT jsonb_build_object(
                'minimumChargeFormulaKey', d.minimum_charge_formula_key, 'maximumChargeFormulaKey', d.maximum_charge_formula_key, 'releaseAtMaximum', d.release_at_maximum)
                FROM public.skill_process_charge_step_details d
                WHERE (d.game_id, d.skill_key, d.process_key, d.step_key)
                    = (s.game_id, s.skill_key, s.process_key, s.step_key))
            WHEN 'RECAST' THEN (SELECT jsonb_build_object(
                'windowFormulaKey', d.window_formula_key, 'maximumRecastCountFormulaKey', d.maximum_recast_count_formula_key)
                FROM public.skill_process_recast_step_details d
                WHERE (d.game_id, d.skill_key, d.process_key, d.step_key)
                    = (s.game_id, s.skill_key, s.process_key, s.step_key))
            WHEN 'EMPOWERED_BASIC_ATTACK' THEN (SELECT jsonb_build_object(
                'windowFormulaKey', d.window_formula_key, 'consumeMoment', d.consume_moment)
                FROM public.skill_process_empowered_attack_step_details d
                WHERE (d.game_id, d.skill_key, d.process_key, d.step_key)
                    = (s.game_id, s.skill_key, s.process_key, s.step_key))
        END) ORDER BY s.sort_order, s.step_key)
        FROM public.skill_process_steps s
        WHERE (s.game_id, s.skill_key, s.process_key) = (p.game_id, p.skill_key, p.process_key)), '[]'::jsonb),
    cooldown = (SELECT jsonb_build_object('durationFormulaKey', c.duration_formula_key,
        'startMoment', jsonb_build_object('momentType', c.moment_type, 'stepKey', c.step_key))
        FROM public.skill_process_cooldowns c
        WHERE (c.game_id, c.skill_key, c.process_key) = (p.game_id, p.skill_key, p.process_key)),
    effect_bindings = COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'bindingKey', b.binding_key, 'effectKey', b.effect_key,
        'moment', jsonb_build_object('momentType', b.moment_type, 'stepKey', b.step_key),
        'sortOrder', b.sort_order) ORDER BY b.sort_order, b.binding_key)
        FROM public.skill_process_effect_bindings b
        WHERE (b.game_id, b.skill_key, b.process_key) = (p.game_id, p.skill_key, p.process_key)), '[]'::jsonb),
    state_operations = COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'operationKey', o.operation_key, 'name', o.name, 'stateKey', o.state_key,
        'operation', o.operation, 'valueFormulaKey', o.value_formula_key, 'optionKey', o.option_key,
        'moment', jsonb_build_object('momentType', o.moment_type, 'stepKey', o.step_key),
        'sortOrder', o.sort_order) ORDER BY o.sort_order, o.operation_key)
        FROM public.skill_process_state_operations o
        WHERE (o.game_id, o.skill_key, o.process_key) = (p.game_id, p.skill_key, p.process_key)), '[]'::jsonb);

ALTER TABLE public.skill_processes
    ADD CONSTRAINT ck_skill_processes_steps_array CHECK (jsonb_typeof(steps) = 'array'),
    ADD CONSTRAINT ck_skill_processes_cooldown_object CHECK (cooldown IS NULL OR jsonb_typeof(cooldown) = 'object'),
    ADD CONSTRAINT ck_skill_processes_bindings_array CHECK (jsonb_typeof(effect_bindings) = 'array'),
    ADD CONSTRAINT ck_skill_processes_operations_array CHECK (jsonb_typeof(state_operations) = 'array');


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


-- 系统派生的引用明细，没有独立业务编辑入口；由游戏配置写事务整体重建。
CREATE TABLE public.skill_object_references (
    game_id varchar(64) NOT NULL,
    source_skill_key varchar(64) NOT NULL,
    source_type varchar(16) NOT NULL,
    source_key varchar(64) NOT NULL,
    field_path text NOT NULL,
    target_type varchar(16) NOT NULL,
    target_skill_key varchar(64) NOT NULL,
    target_key varchar(64) NOT NULL,
    target_sub_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_object_references PRIMARY KEY (
        game_id, source_skill_key, source_type, source_key, field_path,
        target_type, target_skill_key, target_key, target_sub_key
    ),
    CONSTRAINT fk_skill_object_references_game FOREIGN KEY (game_id)
        REFERENCES public.games (game_id) ON DELETE CASCADE,
    CONSTRAINT fk_skill_object_references_skill FOREIGN KEY (game_id, source_skill_key)
        REFERENCES public.skills (game_id, skill_key) ON DELETE CASCADE,
    CONSTRAINT ck_skill_object_references_source_type CHECK (
        source_type IN ('FORMULA', 'EFFECT', 'STATE', 'PROCESS', 'TRIGGER')
    ),
    CONSTRAINT ck_skill_object_references_target_type CHECK (
        target_type IN ('ATTRIBUTE', 'PARAMETER', 'FORMULA', 'SKILL', 'CATEGORY', 'DAMAGE_TYPE',
            'MODIFIER_ZONE', 'STATUS', 'EFFECT', 'RESULT', 'LIFECYCLE', 'STATE', 'OPTION',
            'PROCESS', 'STEP', 'ACTION')
    ),
    CONSTRAINT ck_skill_object_references_path CHECK (btrim(field_path) <> ''),
    CONSTRAINT ck_skill_object_references_target CHECK (btrim(target_key) <> '')
);

CREATE INDEX ix_skill_object_references_target ON public.skill_object_references
    (game_id, target_type, target_skill_key, target_key, target_sub_key);

COMMENT ON TABLE public.skill_object_references IS '从技能组成提取的系统引用明细';

-- 同一 DROP 列出全部被吸收表，只允许内部依赖一并移除，不使用 CASCADE。
DROP TABLE public.skill_formula_nodes,
    public.skill_effect_results,
    public.skill_effect_result_values,
    public.skill_effect_result_spell_shield_policies,
    public.skill_effect_damage_details,
    public.skill_effect_result_critical_policies,
    public.skill_effect_result_vamp_rules,
    public.skill_effect_result_normal_shield_interactions,
    public.skill_effect_damage_modifier_details,
    public.skill_effect_healing_modifier_details,
    public.skill_effect_damage_immunity_details,
    public.skill_effect_health_floor_details,
    public.skill_effect_execute_details,
    public.skill_effect_attribute_change_details,
    public.skill_effect_resource_change_details,
    public.skill_effect_cooldown_change_details,
    public.skill_effect_result_skill_scopes,
    public.skill_effect_result_skill_targets,
    public.skill_effect_result_skill_category_targets,
    public.skill_effect_haste_modifier_details,
    public.skill_effect_status_operation_details,
    public.skill_effect_lifecycles,
    public.skill_effect_result_lifecycle_behaviors,
    public.skill_effect_lifecycle_operation_details,
    public.skill_internal_state_counter_details,
    public.skill_internal_state_ammo_details,
    public.skill_internal_state_flag_details,
    public.skill_internal_state_cooldown_details,
    public.skill_internal_state_mode_options,
    public.skill_process_steps,
    public.skill_process_delay_step_details,
    public.skill_process_multi_hit_step_details,
    public.skill_process_periodic_step_details,
    public.skill_process_channel_step_details,
    public.skill_process_charge_step_details,
    public.skill_process_recast_step_details,
    public.skill_process_empowered_attack_step_details,
    public.skill_process_cooldowns,
    public.skill_process_effect_bindings,
    public.skill_process_state_operations,
    public.skill_trigger_rule_process_events,
    public.skill_trigger_rule_skill_events,
    public.skill_trigger_rule_result_events,
    public.skill_trigger_rule_lifecycle_events,
    public.skill_trigger_rule_status_events,
    public.skill_trigger_rule_health_threshold_events,
    public.skill_trigger_rule_internal_state_events,
    public.skill_trigger_rule_subject_events,
    public.skill_trigger_rule_damage_events,
    public.skill_trigger_rule_spell_shield_blocked_events,
    public.skill_trigger_rule_link_events,
    public.skill_trigger_rule_condition_groups,
    public.skill_trigger_rule_conditions,
    public.skill_trigger_rule_attribute_conditions,
    public.skill_trigger_rule_status_conditions,
    public.skill_trigger_rule_internal_state_conditions,
    public.skill_trigger_rule_event_value_conditions,
    public.skill_trigger_rule_actions,
    public.skill_trigger_rule_effect_actions,
    public.skill_trigger_rule_process_actions,
    public.skill_trigger_rule_runtime_input_bindings,
    public.skill_trigger_rule_internal_state_bindings,
    public.skill_trigger_rule_combat_status_bindings,
    public.skill_trigger_rule_event_value_bindings,
    public.skill_trigger_rule_prior_result_bindings,
    public.skill_trigger_rule_result_modifiers,
    public.skill_trigger_rule_per_target_cooldowns,
    public.skill_trigger_rule_process_limits;
DROP FUNCTION public.trg_skill_effect_result_complete_shape();
DROP FUNCTION public.trg_skill_effect_lifecycle_aggregate_shape();
DROP FUNCTION public.trg_skill_effect_lifecycle_refresh_target_duration();
DROP FUNCTION public.trg_skill_internal_state_complete_shape();
DROP FUNCTION public.trg_skill_process_step_complete_shape();
DROP FUNCTION public.trg_skill_process_complete_shape();
DROP FUNCTION public.trg_skill_trigger_rule_complete_shape();
