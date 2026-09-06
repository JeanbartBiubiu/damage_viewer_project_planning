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
