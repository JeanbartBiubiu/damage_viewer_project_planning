-- =============================================================================
-- LoL generic Spellblade seed（巫妖之祸 item_3100 Lich Bane）
-- =============================================================================
--
-- 目标：幂等写入 item_3100 Spellblade provider：ability_started（ICD 可用）武装
--       ready；下一次 basic_attack_hit 造成
--       0.75 * event.entry_source.attr.ad.base + 0.45 * event.entry_source.attr.ap.resolved
--       魔法伤害并消费 ready；ready 期间 provider-bound attack_speed percent_add
--       = 0.5 * provider.state.spellblade_ready（消费/过期后自然为 0）。
--
-- 数值与描述引用（仅注释，无运行时外部依赖）：
--   C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.normalized.json
--   item 3100 Lich Bane / Spellblade
--   （75% base AD + 45% AP bonus magic on-hit；50% bonus attack speed；10s / 1.5s ICD）
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / item_3100 / hero_vayne / ability_hero_vayne_tumble /
--    ability/basic_attack（62003）及至少一条 ability relation / reserved_type /
--    attribute_definitions ad·ap·attack_speed 缺失则 RAISE EXCEPTION 回滚。
-- 4. 复用 lol_generic_spellblade_seed.sql 的 game-local ability/basic_attack 与
--    ability_hero_vayne_tumble；本脚本不创建/不修改这些前置行。
-- 5. proc 顺序与 3078 一致：damage then consume；copyable_on_hit=false（phantom 排除）。
-- 6. 不自动 publish；不做 DELETE/DROP/CASCADE；不写 legacy Bundle/Catalog。
--
-- 前置：reserved_types_seed.sql；Batch-B hero_vayne；Batch-C item_3100；
--       lol_generic_spellblade_seed.sql（ability/basic_attack + tumble）；
--       basic_attack_hit emit 基线（on-hit passives 或等价）。
-- 建议发布版本（本脚本不负责 publish）：lol-generic-lich-bane-spellblade-v1-20260713

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_missing_reserved   text;
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20111, -- selector/opponent
        20120, -- provider_kind/passive
        20150, -- operation/damage
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20173, -- value_policy/percent_add
        20181, -- match_mode/all
        20190, -- refresh_policy/refresh_duration
        20205, -- event/ability_started
        20211, -- event/basic_attack_hit
        20212, -- event/source_owner
        20221, -- damage/magic
        20250  -- state_scope/provider
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_lich_bane_spellblade_seed: game_id=% missing in public.games',
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
            'lol_generic_lich_bane_spellblade_seed: failed to lock game_data_state for %',
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
            'lol_generic_lich_bane_spellblade_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'item_3100'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lich_bane_spellblade_seed: missing game_entities item_3100 (Batch-C prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_vayne'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lich_bane_spellblade_seed: missing game_entities hero_vayne (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.ability_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.ability_id = 'ability_hero_vayne_tumble'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lich_bane_spellblade_seed: missing ability_hero_vayne_tumble (lol_generic_spellblade_seed prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.types t
         WHERE t.game_id = v_game_id
           AND t.type_id = 62003
           AND t.type_key = 'ability/basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lich_bane_spellblade_seed: missing types 62003 ability/basic_attack (lol_generic_spellblade_seed prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.type_relations tr
         WHERE tr.game_id = v_game_id
           AND tr.type_id = 62003
           AND tr.target_category = 'ability'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lich_bane_spellblade_seed: missing ability/basic_attack relation (lol_generic_spellblade_seed prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lich_bane_spellblade_seed: missing attribute_definitions for game_id=% attr_key=ad',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lich_bane_spellblade_seed: missing attribute_definitions for game_id=% attr_key=ap',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'attack_speed'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lich_bane_spellblade_seed: missing attribute_definitions for game_id=% attr_key=attack_speed',
            v_game_id;
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

    -- =========================================================================
    -- item_3100 Lich Bane Spellblade provider / states / formulas / modifier /
    -- listeners / effect graph（顺序与 phantom 排除对齐 3078）
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_3100_lich_bane_spellblade',
        20120,
        '巫妖之祸 Spellblade',
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

    -- state fields：不写 default_value（运行时缺省 0）
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_item_3100_lich_bane_spellblade',
            'spellblade_ready',
            20100,
            1,
            10000,
            20190,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3100_lich_bane_spellblade',
            'spellblade_icd',
            20100,
            1,
            1500,
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
            'provider_item_3100_lich_bane_spellblade',
            'spellblade_icd_available',
            '{"op":"eq","args":[{"op":"read","path":"provider.state.spellblade_icd"},{"op":"const","value":0}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3100_lich_bane_spellblade',
            'spellblade_ready_arm',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3100_lich_bane_spellblade',
            'spellblade_icd_arm',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3100_lich_bane_spellblade',
            'spellblade_ready_armed',
            '{"op":"gte","args":[{"op":"read","path":"provider.state.spellblade_ready"},{"op":"const","value":1}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3100_lich_bane_spellblade',
            'spellblade_proc_damage',
            '{"op":"add","args":[{"op":"mul","args":[{"op":"const","value":0.75},{"op":"read","path":"event.entry_source.attr.ad.base"}]},{"op":"mul","args":[{"op":"const","value":0.45},{"op":"read","path":"event.entry_source.attr.ap.resolved"}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3100_lich_bane_spellblade',
            'spellblade_ready_consume',
            '{"op":"const","value":0}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3100_lich_bane_spellblade',
            'spellblade_attack_speed',
            '{"op":"mul","args":[{"op":"const","value":0.5},{"op":"read","path":"provider.state.spellblade_ready"}]}'::jsonb,
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

    -- provider-bound attack_speed percent_add（对齐 lol_guinsoo_hk_seed.sql；分类字段 null）
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'modifier_item_3100_lich_bane_spellblade_attack_speed',
        'provider_item_3100_lich_bane_spellblade',
        'spellblade_attack_speed',
        NULL,
        20110,
        'attack_speed',
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        20173,
        'spellblade_attack_speed',
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

    -- Listener A：ability_started → arm ready then icd（ICD == 0）
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_item_3100_lich_bane_spellblade_arm',
        'provider_item_3100_lich_bane_spellblade',
        'spellblade_arm',
        'Spellblade 武装',
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
    ) VALUES
        (
            v_game_id,
            'step_item_3100_lich_bane_spellblade_ready_arm',
            'sequence_item_3100_lich_bane_spellblade_arm',
            0,
            20160,
            20110,
            'spellblade_icd_available',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_3100_lich_bane_spellblade_icd_arm',
            'sequence_item_3100_lich_bane_spellblade_arm',
            1,
            20160,
            20110,
            'spellblade_icd_available',
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
    ) VALUES
        (
            v_game_id,
            'step_item_3100_lich_bane_spellblade_ready_arm',
            20250,
            'spellblade_ready',
            'spellblade_ready_arm',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_3100_lich_bane_spellblade_icd_arm',
            20250,
            'spellblade_icd',
            'spellblade_icd_arm',
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

    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_item_3100_lich_bane_spellblade_ability_started',
        'provider_item_3100_lich_bane_spellblade',
        'spellblade_on_ability_started',
        20205,
        NULL,
        1,
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, listener_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        listener_key = EXCLUDED.listener_key,
        event_type_id = EXCLUDED.event_type_id,
        ability_id = EXCLUDED.ability_id,
        max_triggers_per_event = EXCLUDED.max_triggers_per_event,
        chain_limit_key = EXCLUDED.chain_limit_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_listeners.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.provider_listeners.listener_key IS DISTINCT FROM EXCLUDED.listener_key
       OR public.provider_listeners.event_type_id IS DISTINCT FROM EXCLUDED.event_type_id
       OR public.provider_listeners.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.provider_listeners.max_triggers_per_event IS DISTINCT FROM EXCLUDED.max_triggers_per_event
       OR public.provider_listeners.chain_limit_key IS DISTINCT FROM EXCLUDED.chain_limit_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.listener_match_types (
        game_id, listener_id, match_mode_type_id, type_id, change_revision, updated_at
    ) VALUES
        (v_game_id, 'listener_item_3100_lich_bane_spellblade_ability_started', 20181, 20205, v_candidate, NOW()),
        (v_game_id, 'listener_item_3100_lich_bane_spellblade_ability_started', 20181, 20212, v_candidate, NOW())
    ON CONFLICT (game_id, listener_id, match_mode_type_id, type_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.listener_match_types.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.listener_effect_sequences (
        game_id, listener_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_item_3100_lich_bane_spellblade_ability_started',
        'sequence_item_3100_lich_bane_spellblade_arm',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, listener_id, sequence_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.listener_effect_sequences.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- Listener B：basic_attack_hit → damage then consume ready（ready >= 1；对齐 3078）
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_item_3100_lich_bane_spellblade_proc',
        'provider_item_3100_lich_bane_spellblade',
        'spellblade_proc',
        'Spellblade 触发',
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
    ) VALUES
        (
            v_game_id,
            'step_item_3100_lich_bane_spellblade_damage',
            'sequence_item_3100_lich_bane_spellblade_proc',
            0,
            20150,
            20111,
            'spellblade_ready_armed',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_3100_lich_bane_spellblade_ready_consume',
            'sequence_item_3100_lich_bane_spellblade_proc',
            1,
            20160,
            20110,
            'spellblade_ready_armed',
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
        copyable_on_hit, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_item_3100_lich_bane_spellblade_damage',
        'spellblade_proc_damage',
        20221,
        20170,
        false,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        amount_formula_key = EXCLUDED.amount_formula_key,
        damage_type_id = EXCLUDED.damage_type_id,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        copyable_on_hit = EXCLUDED.copyable_on_hit,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.damage_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.damage_effect_details.damage_type_id IS DISTINCT FROM EXCLUDED.damage_type_id
       OR public.damage_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id
       OR public.damage_effect_details.copyable_on_hit IS DISTINCT FROM EXCLUDED.copyable_on_hit;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_item_3100_lich_bane_spellblade_ready_consume',
        20250,
        'spellblade_ready',
        'spellblade_ready_consume',
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

    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_item_3100_lich_bane_spellblade_basic_attack_hit',
        'provider_item_3100_lich_bane_spellblade',
        'spellblade_on_basic_attack_hit',
        20211,
        NULL,
        1,
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, listener_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        listener_key = EXCLUDED.listener_key,
        event_type_id = EXCLUDED.event_type_id,
        ability_id = EXCLUDED.ability_id,
        max_triggers_per_event = EXCLUDED.max_triggers_per_event,
        chain_limit_key = EXCLUDED.chain_limit_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_listeners.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.provider_listeners.listener_key IS DISTINCT FROM EXCLUDED.listener_key
       OR public.provider_listeners.event_type_id IS DISTINCT FROM EXCLUDED.event_type_id
       OR public.provider_listeners.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.provider_listeners.max_triggers_per_event IS DISTINCT FROM EXCLUDED.max_triggers_per_event
       OR public.provider_listeners.chain_limit_key IS DISTINCT FROM EXCLUDED.chain_limit_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.listener_match_types (
        game_id, listener_id, match_mode_type_id, type_id, change_revision, updated_at
    ) VALUES
        (v_game_id, 'listener_item_3100_lich_bane_spellblade_basic_attack_hit', 20181, 20211, v_candidate, NOW()),
        (v_game_id, 'listener_item_3100_lich_bane_spellblade_basic_attack_hit', 20181, 20212, v_candidate, NOW())
    ON CONFLICT (game_id, listener_id, match_mode_type_id, type_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.listener_match_types.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.listener_effect_sequences (
        game_id, listener_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_item_3100_lich_bane_spellblade_basic_attack_hit',
        'sequence_item_3100_lich_bane_spellblade_proc',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, listener_id, sequence_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.listener_effect_sequences.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_provider_mounts (
        game_id, entity_id, provider_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'item_3100',
        'provider_item_3100_lich_bane_spellblade',
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
