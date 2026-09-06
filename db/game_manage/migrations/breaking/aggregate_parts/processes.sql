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
