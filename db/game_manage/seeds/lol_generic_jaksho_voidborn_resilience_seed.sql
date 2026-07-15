-- =============================================================================
-- LoL generic Jak'Sho Voidborn Resilience seed（千变者贾修 item_6665）
-- =============================================================================
--
-- 目标：幂等写入自包含 item_6665「虚空生物的复原力 / Voidborn Resilience」
--       受控 partial：run 起算 5s 后 provider.state.full_stack → 1（overwrite），
--       之后 owner-self armor/MR 各 add
--       0.30 * max(0, $owner.attr.bonus_*.resolved) * provider.state.full_stack。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / reserved_type / attribute_definitions(hp,armor,magic_resist)
--    缺失则 RAISE EXCEPTION 回滚；本脚本幂等 ensure bonus_armor / bonus_magic_resist。
-- 4. 自包含写入 item_6665 实体与静态 hp=350 / armor=45 / magic_resist=45；
--    仅 mount provider_item_6665_jaksho_voidborn_resilience。
-- 5. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog。
--
-- 明确排除（本脚本不建模）：
--   真实目标装备/loadout 投影；自动战斗态检测（超出「run 起算即在战斗」假设）；
--   旧 DPS lane / Batch-V full-stack-at-time-zero；5 层逐秒叠层；
--   live migration；自动 publish；damage / listener / ability 行。
--
-- 数值来源（注释引用，无运行时外部依赖；current-items.normalized.json item 6665）：
--   45 armor / 45 MR / 350 HP；与英雄战斗 5 秒后激活；+30% bonus armor/MR。
--   本合同用 start_delay_ms=5000 + tick 覆盖为 full_stack=1，不复制「开局即满层」。
--
-- 前置：reserved_types_seed.sql；基线 attribute_definitions(hp/armor/magic_resist)。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-jaksho-voidborn-resilience-v1-20260715

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
        20120, -- provider_kind/passive
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20250  -- state_scope/provider
    ];
    v_required_attrs     text[] := ARRAY['hp', 'armor', 'magic_resist'];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_jaksho_voidborn_resilience_seed: game_id=% missing in public.games',
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
            'lol_generic_jaksho_voidborn_resilience_seed: failed to lock game_data_state for %',
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
            'lol_generic_jaksho_voidborn_resilience_seed: missing reserved_type id(s): %',
            v_missing_reserved;
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
            'lol_generic_jaksho_voidborn_resilience_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
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

    -- 合成 owner 输入：bonus_armor / bonus_magic_resist（显式输入；不推断装备）
    INSERT INTO public.attribute_definitions (
        game_id, attr_key, sort_order, attr_name, attr_type, default_value,
        value_kind, rate_target_attr_key, min_value, max_value,
        change_revision, updated_at
    ) VALUES
        (v_game_id, 'bonus_armor', 910, '额外护甲', 'number', 0,
         'scalar', NULL, NULL, NULL, v_candidate, NOW()),
        (v_game_id, 'bonus_magic_resist', 911, '额外魔抗', 'number', 0,
         'scalar', NULL, NULL, NULL, v_candidate, NOW())
    ON CONFLICT (game_id, attr_key) DO UPDATE SET
        sort_order = EXCLUDED.sort_order,
        attr_name = EXCLUDED.attr_name,
        attr_type = EXCLUDED.attr_type,
        default_value = EXCLUDED.default_value,
        value_kind = EXCLUDED.value_kind,
        rate_target_attr_key = EXCLUDED.rate_target_attr_key,
        min_value = EXCLUDED.min_value,
        max_value = EXCLUDED.max_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.attribute_definitions.sort_order IS DISTINCT FROM EXCLUDED.sort_order
       OR public.attribute_definitions.attr_name IS DISTINCT FROM EXCLUDED.attr_name
       OR public.attribute_definitions.attr_type IS DISTINCT FROM EXCLUDED.attr_type
       OR public.attribute_definitions.default_value IS DISTINCT FROM EXCLUDED.default_value
       OR public.attribute_definitions.value_kind IS DISTINCT FROM EXCLUDED.value_kind
       OR public.attribute_definitions.rate_target_attr_key IS DISTINCT FROM EXCLUDED.rate_target_attr_key
       OR public.attribute_definitions.min_value IS DISTINCT FROM EXCLUDED.min_value
       OR public.attribute_definitions.max_value IS DISTINCT FROM EXCLUDED.max_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- =========================================================================
    -- item_6665 实体 + 静态面板（source item id 6665）
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'item_6665',
        '千变者贾修',
        'Jak''Sho, The Protean（source item id 6665；Voidborn Resilience generic partial）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.game_entities.display_name IS DISTINCT FROM EXCLUDED.display_name
       OR public.game_entities.description IS DISTINCT FROM EXCLUDED.description;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'item_6665', 'hp', 350, v_candidate, NOW()),
        (v_game_id, 'item_6665', 'armor', 45, v_candidate, NOW()),
        (v_game_id, 'item_6665', 'magic_resist', 45, v_candidate, NOW())
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
    -- provider / state / lifecycle / formulas / modifiers / tick sequence
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_6665_jaksho_voidborn_resilience',
        20120,
        '虚空生物的复原力',
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

    -- full_stack：numeric max=1；untimed；schema 无 default 列，runtime 默认 0
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_6665_jaksho_voidborn_resilience',
        'full_stack',
        20100,
        1,
        NULL,
        NULL,
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

    -- lifecycle：首 tick 5000ms，之后每 5000ms；无 duration（战斗结束前保持）
    INSERT INTO public.provider_lifecycles (
        game_id, provider_id, duration_formula_key, max_stacks,
        refresh_policy_type_id, tick_interval_ms, start_delay_ms,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_6665_jaksho_voidborn_resilience',
        NULL,
        1,
        NULL,
        5000,
        5000,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, provider_id) DO UPDATE SET
        duration_formula_key = EXCLUDED.duration_formula_key,
        max_stacks = EXCLUDED.max_stacks,
        refresh_policy_type_id = EXCLUDED.refresh_policy_type_id,
        tick_interval_ms = EXCLUDED.tick_interval_ms,
        start_delay_ms = EXCLUDED.start_delay_ms,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_lifecycles.duration_formula_key IS DISTINCT FROM EXCLUDED.duration_formula_key
       OR public.provider_lifecycles.max_stacks IS DISTINCT FROM EXCLUDED.max_stacks
       OR public.provider_lifecycles.refresh_policy_type_id IS DISTINCT FROM EXCLUDED.refresh_policy_type_id
       OR public.provider_lifecycles.tick_interval_ms IS DISTINCT FROM EXCLUDED.tick_interval_ms
       OR public.provider_lifecycles.start_delay_ms IS DISTINCT FROM EXCLUDED.start_delay_ms;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_item_6665_jaksho_voidborn_resilience',
            'full_stack_set',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_6665_jaksho_voidborn_resilience',
            'voidborn_bonus_armor',
            '{"op":"mul","args":[{"op":"mul","args":[{"op":"const","value":0.30},{"op":"max","args":[{"op":"const","value":0},{"op":"read","path":"$owner.attr.bonus_armor.resolved"}]}]},{"op":"read","path":"provider.state.full_stack"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_6665_jaksho_voidborn_resilience',
            'voidborn_bonus_magic_resist',
            '{"op":"mul","args":[{"op":"mul","args":[{"op":"const","value":0.30},{"op":"max","args":[{"op":"const","value":0},{"op":"read","path":"$owner.attr.bonus_magic_resist.resolved"}]}]},{"op":"read","path":"provider.state.full_stack"}]}'::jsonb,
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

    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'modifier_item_6665_jaksho_voidborn_resilience_armor',
            'provider_item_6665_jaksho_voidborn_resilience',
            'voidborn_bonus_armor',
            NULL,
            20110,
            'armor',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20170,
            'voidborn_bonus_armor',
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'modifier_item_6665_jaksho_voidborn_resilience_magic_resist',
            'provider_item_6665_jaksho_voidborn_resilience',
            'voidborn_bonus_magic_resist',
            NULL,
            20110,
            'magic_resist',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20170,
            'voidborn_bonus_magic_resist',
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

    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_item_6665_jaksho_voidborn_resilience_tick',
        'provider_item_6665_jaksho_voidborn_resilience',
        'voidborn_full_stack_tick',
        '虚空生物的复原力 tick 满层',
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
        'step_item_6665_jaksho_voidborn_resilience_full_stack_set',
        'sequence_item_6665_jaksho_voidborn_resilience_tick',
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

    -- override/set full_stack=1（重复 tick 幂等）
    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_item_6665_jaksho_voidborn_resilience_full_stack_set',
        20250,
        'full_stack',
        'full_stack_set',
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

    INSERT INTO public.provider_tick_sequences (
        game_id, provider_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_6665_jaksho_voidborn_resilience',
        'sequence_item_6665_jaksho_voidborn_resilience_tick',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, provider_id, sequence_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_tick_sequences.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_provider_mounts (
        game_id, entity_id, provider_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'item_6665',
        'provider_item_6665_jaksho_voidborn_resilience',
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
