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
