-- =============================================================================
-- LoL generic Kindred P Mark of the Kindred seed（千珏之印固定 25 印 Phase-A）
-- =============================================================================
--
-- 目标：幂等 ensure hero_kindred 最低必要基线（含 attack_range=500），并挂载
--       单一 passive provider_hero_kindred_mark_of_kindred_max_marks，表达
--       用户批准的固定 25 印 Phase-A 可近似 ABI：
--         · 常驻 attack_range add +250（注释代数等式：Wiki 25 印共享普攻/E 射程
--           加成；可执行 SQL 不引入 marks 状态键）；
--         · Q probe：写 kindred_p_q_as_active=1（max1 / 4000ms /
--           refresh_on_write）；AS percent_add =
--           1.60 * provider.state.kindred_p_q_as_active；
--         · W/E probe：rank5 冠军公式（bonus AD/AP=0；E crit 分支排除）。
--       候选整体语义 = partial；Q/W/E 均为 probe-only，不宣称完整技能建模。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / reserved_type / attribute_definitions(hp,attack_speed) 缺失则
--    RAISE EXCEPTION 回滚；attack_range 以 DML ensure（无 DDL）。
-- 4. 自包含 ensure hero_kindred 实体 + attack_range=500；仅 mount 本 provider。
--    实体元数据 ON CONFLICT DO NOTHING，不覆盖无关既有 Kindred 行。
-- 5. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog。
--
-- 明确排除（本脚本不建模 / 保留 gap）：
--   hunting / takedown / kill；中间印记进度；野怪分支/上限；多目标；
--   W 宠物调度；E crit / 第三下完整机制；DDragon；live migration；
--   自动 publish；single_attacker_dps；完整 Q/W/E 生产技能面。
--
-- 数值来源（League Wiki Template:Data；注释引用，无运行时外部依赖；
-- 无截图 / OCR 溯源；无 DDragon / champion-static 数值溯源）：
--   P Mark of the Kindred revision id 3994253
--     content SHA256 9ac60eae427fac9ba279734dba2c01b34852eb0be84a01d95296328794afc14a
--     25 印共享普攻/E 射程 +250 → 基线 500 + 250 = 解析射程 750
--   Q Dance of Arrows revision id 4007746
--     content SHA256 283e590573c7df7385cf317dd4bf881f84af6227080f444ead1d3fd11bb9f3a0
--     total bonus AS 1.60 / 4000ms（probe 态驱动）
--   W Wolf's Frenzy revision id 4038396
--     content SHA256 0bf8193ea5a15df5822b58d5a5412defe2a26f5fc8524100b14d0fe793f08185
--     rank5 champion：45 + 0.265 * target.attr.hp.current；bonus AD/AP 探针为零
--   E Mounting Dread revision id 4022506
--     content SHA256 19b3fcaebacc7f41676122e57574eb3e4a91cbc838a915439c02f6cca79bf5b4
--     rank5 probe：200 + 0.175 * (target.attr.hp.max - target.attr.hp.current)；
--     bonus AD 零；crit 分支排除
--
-- 前置：reserved_types_seed.sql；所需 attribute_definitions(hp,attack_speed) 已存在。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-kindred-mark-of-kindred-max-marks-v1-20260719

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_missing_reserved   text;
    v_missing_attrs      text;
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20111, -- selector/opponent
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20150, -- operation/damage
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20173, -- value_policy/percent_add
        20190, -- refresh_policy/refresh_duration (refresh_on_write)
        20220, -- damage/physical
        20221, -- damage/magic
        20250, -- state_scope/provider
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY[
        'hp', 'attack_speed', 'attack_range'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_kindred_mark_of_kindred_max_marks_seed: game_id=% missing in public.games',
            v_game_id;
    END IF;

    INSERT INTO public.game_data_state (game_id, current_revision, published_revision, updated_at)
    VALUES (v_game_id, 0, 0, NOW())
    ON CONFLICT (game_id) DO NOTHING;

    SELECT gds.current_revision
      INTO v_locked_current
      FROM public.game_data_state gds
     WHERE gds.game_id = v_game_id
     FOR UPDATE;

    IF v_locked_current IS NULL THEN
        RAISE EXCEPTION
            'lol_generic_kindred_mark_of_kindred_max_marks_seed: failed to lock game_data_state for %',
            v_game_id;
    END IF;

    v_candidate := v_locked_current + 1;

    SELECT string_agg(req.type_id::text, ', ' ORDER BY req.type_id)
      INTO v_missing_reserved
      FROM unnest(v_required_reserved) AS req(type_id)
     WHERE NOT EXISTS (
               SELECT 1
                 FROM public.reserved_type rt
                WHERE rt.type_id = req.type_id
           );

    IF v_missing_reserved IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_kindred_mark_of_kindred_max_marks_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- reserved → game-local types（同 ID / 同 type_key / reserved_type_id=type_id）
    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    )
    SELECT
        v_game_id,
        rt.type_id,
        rt.type_key,
        rt.name,
        NULL,
        rt.type_id,
        v_candidate,
        NOW()
      FROM public.reserved_type rt
     WHERE rt.type_id = ANY (v_required_reserved)
    ON CONFLICT (game_id, type_id) DO UPDATE SET
        type_key = EXCLUDED.type_key,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        reserved_type_id = EXCLUDED.reserved_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.types.type_key IS DISTINCT FROM EXCLUDED.type_key
       OR public.types.name IS DISTINCT FROM EXCLUDED.name
       OR public.types.description IS DISTINCT FROM EXCLUDED.description
       OR public.types.reserved_type_id IS DISTINCT FROM EXCLUDED.reserved_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- 安全 ensure：attack_range 属性定义（DML only；已存在则不覆盖元数据）
    INSERT INTO public.attribute_definitions (
        game_id, attr_key, sort_order, attr_name, attr_type, default_value,
        value_kind, rate_target_attr_key, min_value, max_value,
        change_revision, updated_at
    ) VALUES (
        v_game_id, 'attack_range', 40, '攻击距离', 'number', 0,
        'scalar', NULL, NULL, NULL, v_candidate, NOW()
    )
    ON CONFLICT (game_id, attr_key) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    SELECT string_agg(req.attr_key, ', ' ORDER BY req.attr_key)
      INTO v_missing_attrs
      FROM unnest(v_required_attrs) AS req(attr_key)
     WHERE NOT EXISTS (
               SELECT 1
                 FROM public.attribute_definitions ad
                WHERE ad.game_id = v_game_id
                  AND ad.attr_key = req.attr_key
           );

    IF v_missing_attrs IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_kindred_mark_of_kindred_max_marks_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    -- =========================================================================
    -- 自包含 ensure：hero_kindred 基线实体（已存在则不覆盖 display/description）
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_kindred',
        '千珏',
        '千珏 / Kindred（Mark of the Kindred max-marks Phase-A seed 自包含基线）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- 基线 attack_range=500（解析满印射程 = 500 + 250 = 750）
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES (
        v_game_id, 'hero_kindred', 'attack_range', 500, v_candidate, NOW()
    )
    ON CONFLICT (game_id, entity_id, attr_key) DO UPDATE SET
        base_value = EXCLUDED.base_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_attribute_values.base_value IS DISTINCT FROM EXCLUDED.base_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- =========================================================================
    -- hero_kindred Mark of the Kindred（固定 25 印 Phase-A）
    -- 单一 passive；Q/W/E 均为 probe-scoped abilities（非完整生产技能）
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_kindred_mark_of_kindred_max_marks',
        20120,
        '千珏 P 千珏之印 Mark of the Kindred（固定25印 Phase-A + Q/W/E probe）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, provider_id) DO UPDATE SET
        provider_kind_type_id = EXCLUDED.provider_kind_type_id,
        display_name = EXCLUDED.display_name,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_definitions.provider_kind_type_id IS DISTINCT FROM EXCLUDED.provider_kind_type_id
       OR public.provider_definitions.display_name IS DISTINCT FROM EXCLUDED.display_name;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- Q probe 态：number / max1 / 4000ms / refresh_on_write；不写 default_value（运行时缺省 0）
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_kindred_mark_of_kindred_max_marks',
        'kindred_p_q_as_active',
        20100,
        1,
        4000,
        20190,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, provider_id, state_key) DO UPDATE SET
        value_type_id = EXCLUDED.value_type_id,
        max_value = EXCLUDED.max_value,
        duration_ms = EXCLUDED.duration_ms,
        refresh_policy_type_id = EXCLUDED.refresh_policy_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_state_fields.value_type_id IS DISTINCT FROM EXCLUDED.value_type_id
       OR public.provider_state_fields.max_value IS DISTINCT FROM EXCLUDED.max_value
       OR public.provider_state_fields.duration_ms IS DISTINCT FROM EXCLUDED.duration_ms
       OR public.provider_state_fields.refresh_policy_type_id IS DISTINCT FROM EXCLUDED.refresh_policy_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_hero_kindred_mark_of_kindred_max_marks',
            'mark_of_kindred_attack_range_bonus',
            -- 常量烘焙：代数等于 Wiki 25 印共享射程加成 +250（无可执行 marks 状态键）
            '{"op":"const","value":250}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kindred_mark_of_kindred_max_marks',
            'kindred_p_q_as_active_arm',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kindred_mark_of_kindred_max_marks',
            'kindred_p_q_attack_speed',
            '{"op":"mul","args":[{"op":"const","value":1.60},{"op":"read","path":"provider.state.kindred_p_q_as_active"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kindred_mark_of_kindred_max_marks',
            'kindred_p_w_champion_probe_damage',
            '{"op":"add","args":[{"op":"const","value":45},{"op":"mul","args":[{"op":"const","value":0.265},{"op":"read","path":"target.attr.hp.current"}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kindred_mark_of_kindred_max_marks',
            'kindred_p_e_missing_hp_probe_damage',
            '{"op":"add","args":[{"op":"const","value":200},{"op":"mul","args":[{"op":"const","value":0.175},{"op":"sub","args":[{"op":"read","path":"target.attr.hp.max"},{"op":"read","path":"target.attr.hp.current"}]}]}]}'::jsonb,
            v_candidate,
            NOW()
        )
    ON CONFLICT (game_id, provider_id, formula_key) DO UPDATE SET
        expression = EXCLUDED.expression,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_formulas.expression IS DISTINCT FROM EXCLUDED.expression;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- 常驻 attack_range add +250（condition NULL）
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'modifier_hero_kindred_p_max_marks_attack_range',
            'provider_hero_kindred_mark_of_kindred_max_marks',
            'mark_of_kindred_attack_range_bonus',
            NULL,
            20110,
            'attack_range',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20170,
            'mark_of_kindred_attack_range_bonus',
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'modifier_hero_kindred_p_q_as_probe_attack_speed',
            'provider_hero_kindred_mark_of_kindred_max_marks',
            'kindred_p_q_attack_speed',
            NULL,
            20110,
            'attack_speed',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20173,
            'kindred_p_q_attack_speed',
            NULL,
            v_candidate,
            NOW()
        )
    ON CONFLICT (game_id, modifier_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        modifier_key = EXCLUDED.modifier_key,
        modifier_type_id = EXCLUDED.modifier_type_id,
        target_selector_type_id = EXCLUDED.target_selector_type_id,
        target_attr_key = EXCLUDED.target_attr_key,
        command_type_id = EXCLUDED.command_type_id,
        channel_type_id = EXCLUDED.channel_type_id,
        bucket_type_id = EXCLUDED.bucket_type_id,
        stage_type_id = EXCLUDED.stage_type_id,
        priority = EXCLUDED.priority,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        value_formula_key = EXCLUDED.value_formula_key,
        condition_formula_key = EXCLUDED.condition_formula_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_modifiers.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.provider_modifiers.modifier_key IS DISTINCT FROM EXCLUDED.modifier_key
       OR public.provider_modifiers.modifier_type_id IS DISTINCT FROM EXCLUDED.modifier_type_id
       OR public.provider_modifiers.target_selector_type_id IS DISTINCT FROM EXCLUDED.target_selector_type_id
       OR public.provider_modifiers.target_attr_key IS DISTINCT FROM EXCLUDED.target_attr_key
       OR public.provider_modifiers.command_type_id IS DISTINCT FROM EXCLUDED.command_type_id
       OR public.provider_modifiers.channel_type_id IS DISTINCT FROM EXCLUDED.channel_type_id
       OR public.provider_modifiers.bucket_type_id IS DISTINCT FROM EXCLUDED.bucket_type_id
       OR public.provider_modifiers.stage_type_id IS DISTINCT FROM EXCLUDED.stage_type_id
       OR public.provider_modifiers.priority IS DISTINCT FROM EXCLUDED.priority
       OR public.provider_modifiers.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id
       OR public.provider_modifiers.value_formula_key IS DISTINCT FROM EXCLUDED.value_formula_key
       OR public.provider_modifiers.condition_formula_key IS DISTINCT FROM EXCLUDED.condition_formula_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- -------------------------------------------------------------------------
    -- Q probe：impact override kindred_p_q_as_active=1（非完整 Dance of Arrows）
    -- -------------------------------------------------------------------------
    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_kindred_p_q_as_probe',
        'provider_hero_kindred_mark_of_kindred_max_marks',
        'p_q_as_probe',
        20130,
        '千珏 Q AS probe（Mark of the Kindred Phase-A；非完整技能）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, ability_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        ability_key = EXCLUDED.ability_key,
        ability_kind_type_id = EXCLUDED.ability_kind_type_id,
        display_name = EXCLUDED.display_name,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_definitions.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.ability_definitions.ability_key IS DISTINCT FROM EXCLUDED.ability_key
       OR public.ability_definitions.ability_kind_type_id IS DISTINCT FROM EXCLUDED.ability_kind_type_id
       OR public.ability_definitions.display_name IS DISTINCT FROM EXCLUDED.display_name;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_kindred_p_q_as_probe_impact',
        'ability_hero_kindred_p_q_as_probe',
        0,
        20142,
        NULL,
        false,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, phase_id) DO UPDATE SET
        ability_id = EXCLUDED.ability_id,
        phase_order = EXCLUDED.phase_order,
        phase_type_id = EXCLUDED.phase_type_id,
        duration_formula_key = EXCLUDED.duration_formula_key,
        interruptible = EXCLUDED.interruptible,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_phases.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.ability_phases.phase_order IS DISTINCT FROM EXCLUDED.phase_order
       OR public.ability_phases.phase_type_id IS DISTINCT FROM EXCLUDED.phase_type_id
       OR public.ability_phases.duration_formula_key IS DISTINCT FROM EXCLUDED.duration_formula_key
       OR public.ability_phases.interruptible IS DISTINCT FROM EXCLUDED.interruptible;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_kindred_p_q_as_probe_arm',
        'provider_hero_kindred_mark_of_kindred_max_marks',
        'p_q_as_probe_arm',
        'Q AS probe 武装 kindred_p_q_as_active=1',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, sequence_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        sequence_key = EXCLUDED.sequence_key,
        display_name = EXCLUDED.display_name,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.effect_sequences.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.effect_sequences.sequence_key IS DISTINCT FROM EXCLUDED.sequence_key
       OR public.effect_sequences.display_name IS DISTINCT FROM EXCLUDED.display_name;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- deferred exactly-one-detail：state_change 配一 state_effect_details
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_kindred_p_q_as_probe_arm',
        'sequence_hero_kindred_p_q_as_probe_arm',
        0,
        20160,
        20110,
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        sequence_id = EXCLUDED.sequence_id,
        step_order = EXCLUDED.step_order,
        operation_type_id = EXCLUDED.operation_type_id,
        target_selector_type_id = EXCLUDED.target_selector_type_id,
        condition_formula_key = EXCLUDED.condition_formula_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.effect_steps.sequence_id IS DISTINCT FROM EXCLUDED.sequence_id
       OR public.effect_steps.step_order IS DISTINCT FROM EXCLUDED.step_order
       OR public.effect_steps.operation_type_id IS DISTINCT FROM EXCLUDED.operation_type_id
       OR public.effect_steps.target_selector_type_id IS DISTINCT FROM EXCLUDED.target_selector_type_id
       OR public.effect_steps.condition_formula_key IS DISTINCT FROM EXCLUDED.condition_formula_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_kindred_p_q_as_probe_arm',
        20250,
        'kindred_p_q_as_active',
        'kindred_p_q_as_active_arm',
        20172,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        state_scope_type_id = EXCLUDED.state_scope_type_id,
        state_key = EXCLUDED.state_key,
        amount_formula_key = EXCLUDED.amount_formula_key,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.state_effect_details.state_scope_type_id IS DISTINCT FROM EXCLUDED.state_scope_type_id
       OR public.state_effect_details.state_key IS DISTINCT FROM EXCLUDED.state_key
       OR public.state_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.state_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_phase_effect_sequences (
        game_id, phase_id, trigger_type_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_kindred_p_q_as_probe_impact',
        20260,
        'sequence_hero_kindred_p_q_as_probe_arm',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, phase_id, trigger_type_id, sequence_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_phase_effect_sequences.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- -------------------------------------------------------------------------
    -- W probe：rank5 champion 公式（bonus AD/AP=0；非完整 Wolf's Frenzy）
    -- -------------------------------------------------------------------------
    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_kindred_p_w_champion_probe',
        'provider_hero_kindred_mark_of_kindred_max_marks',
        'p_w_champion_probe',
        20130,
        '千珏 W champion probe（Mark of the Kindred Phase-A；非完整技能）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, ability_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        ability_key = EXCLUDED.ability_key,
        ability_kind_type_id = EXCLUDED.ability_kind_type_id,
        display_name = EXCLUDED.display_name,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_definitions.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.ability_definitions.ability_key IS DISTINCT FROM EXCLUDED.ability_key
       OR public.ability_definitions.ability_kind_type_id IS DISTINCT FROM EXCLUDED.ability_kind_type_id
       OR public.ability_definitions.display_name IS DISTINCT FROM EXCLUDED.display_name;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_kindred_p_w_champion_probe_impact',
        'ability_hero_kindred_p_w_champion_probe',
        0,
        20142,
        NULL,
        false,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, phase_id) DO UPDATE SET
        ability_id = EXCLUDED.ability_id,
        phase_order = EXCLUDED.phase_order,
        phase_type_id = EXCLUDED.phase_type_id,
        duration_formula_key = EXCLUDED.duration_formula_key,
        interruptible = EXCLUDED.interruptible,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_phases.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.ability_phases.phase_order IS DISTINCT FROM EXCLUDED.phase_order
       OR public.ability_phases.phase_type_id IS DISTINCT FROM EXCLUDED.phase_type_id
       OR public.ability_phases.duration_formula_key IS DISTINCT FROM EXCLUDED.duration_formula_key
       OR public.ability_phases.interruptible IS DISTINCT FROM EXCLUDED.interruptible;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_kindred_p_w_champion_probe_impact',
        'provider_hero_kindred_mark_of_kindred_max_marks',
        'p_w_champion_probe_impact',
        'W champion probe impact（单目标魔法伤害）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, sequence_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        sequence_key = EXCLUDED.sequence_key,
        display_name = EXCLUDED.display_name,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.effect_sequences.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.effect_sequences.sequence_key IS DISTINCT FROM EXCLUDED.sequence_key
       OR public.effect_sequences.display_name IS DISTINCT FROM EXCLUDED.display_name;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- deferred exactly-one-detail：damage 配一 damage_effect_details
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_kindred_p_w_champion_probe_damage',
        'sequence_hero_kindred_p_w_champion_probe_impact',
        0,
        20150,
        20111,
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        sequence_id = EXCLUDED.sequence_id,
        step_order = EXCLUDED.step_order,
        operation_type_id = EXCLUDED.operation_type_id,
        target_selector_type_id = EXCLUDED.target_selector_type_id,
        condition_formula_key = EXCLUDED.condition_formula_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.effect_steps.sequence_id IS DISTINCT FROM EXCLUDED.sequence_id
       OR public.effect_steps.step_order IS DISTINCT FROM EXCLUDED.step_order
       OR public.effect_steps.operation_type_id IS DISTINCT FROM EXCLUDED.operation_type_id
       OR public.effect_steps.target_selector_type_id IS DISTINCT FROM EXCLUDED.target_selector_type_id
       OR public.effect_steps.condition_formula_key IS DISTINCT FROM EXCLUDED.condition_formula_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.damage_effect_details (
        game_id, step_id, amount_formula_key, damage_type_id, value_policy_type_id,
        copyable_on_hit, crit_eligible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_kindred_p_w_champion_probe_damage',
        'kindred_p_w_champion_probe_damage',
        20221,
        20170,
        false,
        false,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        amount_formula_key = EXCLUDED.amount_formula_key,
        damage_type_id = EXCLUDED.damage_type_id,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        copyable_on_hit = EXCLUDED.copyable_on_hit,
        crit_eligible = EXCLUDED.crit_eligible,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.damage_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.damage_effect_details.damage_type_id IS DISTINCT FROM EXCLUDED.damage_type_id
       OR public.damage_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id
       OR public.damage_effect_details.copyable_on_hit IS DISTINCT FROM EXCLUDED.copyable_on_hit
       OR public.damage_effect_details.crit_eligible IS DISTINCT FROM EXCLUDED.crit_eligible;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_phase_effect_sequences (
        game_id, phase_id, trigger_type_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_kindred_p_w_champion_probe_impact',
        20260,
        'sequence_hero_kindred_p_w_champion_probe_impact',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, phase_id, trigger_type_id, sequence_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_phase_effect_sequences.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- -------------------------------------------------------------------------
    -- E probe：rank5 missing-HP 公式（crit 排除；非完整 Mounting Dread）
    -- -------------------------------------------------------------------------
    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_kindred_p_e_missing_hp_probe',
        'provider_hero_kindred_mark_of_kindred_max_marks',
        'p_e_missing_hp_probe',
        20130,
        '千珏 E missing-HP probe（Mark of the Kindred Phase-A；非完整技能）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, ability_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        ability_key = EXCLUDED.ability_key,
        ability_kind_type_id = EXCLUDED.ability_kind_type_id,
        display_name = EXCLUDED.display_name,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_definitions.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.ability_definitions.ability_key IS DISTINCT FROM EXCLUDED.ability_key
       OR public.ability_definitions.ability_kind_type_id IS DISTINCT FROM EXCLUDED.ability_kind_type_id
       OR public.ability_definitions.display_name IS DISTINCT FROM EXCLUDED.display_name;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_kindred_p_e_missing_hp_probe_impact',
        'ability_hero_kindred_p_e_missing_hp_probe',
        0,
        20142,
        NULL,
        false,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, phase_id) DO UPDATE SET
        ability_id = EXCLUDED.ability_id,
        phase_order = EXCLUDED.phase_order,
        phase_type_id = EXCLUDED.phase_type_id,
        duration_formula_key = EXCLUDED.duration_formula_key,
        interruptible = EXCLUDED.interruptible,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_phases.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.ability_phases.phase_order IS DISTINCT FROM EXCLUDED.phase_order
       OR public.ability_phases.phase_type_id IS DISTINCT FROM EXCLUDED.phase_type_id
       OR public.ability_phases.duration_formula_key IS DISTINCT FROM EXCLUDED.duration_formula_key
       OR public.ability_phases.interruptible IS DISTINCT FROM EXCLUDED.interruptible;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_kindred_p_e_missing_hp_probe_impact',
        'provider_hero_kindred_mark_of_kindred_max_marks',
        'p_e_missing_hp_probe_impact',
        'E missing-HP probe impact（单目标物理伤害；无 crit）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, sequence_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        sequence_key = EXCLUDED.sequence_key,
        display_name = EXCLUDED.display_name,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.effect_sequences.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.effect_sequences.sequence_key IS DISTINCT FROM EXCLUDED.sequence_key
       OR public.effect_sequences.display_name IS DISTINCT FROM EXCLUDED.display_name;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_kindred_p_e_missing_hp_probe_damage',
        'sequence_hero_kindred_p_e_missing_hp_probe_impact',
        0,
        20150,
        20111,
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        sequence_id = EXCLUDED.sequence_id,
        step_order = EXCLUDED.step_order,
        operation_type_id = EXCLUDED.operation_type_id,
        target_selector_type_id = EXCLUDED.target_selector_type_id,
        condition_formula_key = EXCLUDED.condition_formula_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.effect_steps.sequence_id IS DISTINCT FROM EXCLUDED.sequence_id
       OR public.effect_steps.step_order IS DISTINCT FROM EXCLUDED.step_order
       OR public.effect_steps.operation_type_id IS DISTINCT FROM EXCLUDED.operation_type_id
       OR public.effect_steps.target_selector_type_id IS DISTINCT FROM EXCLUDED.target_selector_type_id
       OR public.effect_steps.condition_formula_key IS DISTINCT FROM EXCLUDED.condition_formula_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.damage_effect_details (
        game_id, step_id, amount_formula_key, damage_type_id, value_policy_type_id,
        copyable_on_hit, crit_eligible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_kindred_p_e_missing_hp_probe_damage',
        'kindred_p_e_missing_hp_probe_damage',
        20220,
        20170,
        false,
        false,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        amount_formula_key = EXCLUDED.amount_formula_key,
        damage_type_id = EXCLUDED.damage_type_id,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        copyable_on_hit = EXCLUDED.copyable_on_hit,
        crit_eligible = EXCLUDED.crit_eligible,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.damage_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.damage_effect_details.damage_type_id IS DISTINCT FROM EXCLUDED.damage_type_id
       OR public.damage_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id
       OR public.damage_effect_details.copyable_on_hit IS DISTINCT FROM EXCLUDED.copyable_on_hit
       OR public.damage_effect_details.crit_eligible IS DISTINCT FROM EXCLUDED.crit_eligible;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_phase_effect_sequences (
        game_id, phase_id, trigger_type_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_kindred_p_e_missing_hp_probe_impact',
        20260,
        'sequence_hero_kindred_p_e_missing_hp_probe_impact',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, phase_id, trigger_type_id, sequence_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_phase_effect_sequences.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_provider_mounts (
        game_id, entity_id, provider_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_kindred',
        'provider_hero_kindred_mark_of_kindred_max_marks',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id, provider_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_provider_mounts.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    IF v_changed THEN
        UPDATE public.game_data_state
           SET current_revision = v_candidate,
               updated_at = NOW()
         WHERE game_id = v_game_id;
    END IF;
END $$;

COMMIT;
