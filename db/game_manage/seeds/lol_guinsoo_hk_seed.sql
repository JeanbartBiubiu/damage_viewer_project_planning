-- =============================================================================
-- LoL Guinsoo H+K upgrade seed (stack AS / duration / phantom copyable-on-hit)
-- =============================================================================
--
-- 目标：在 Batch-C 鬼索首批（固定 30 魔法 on-hit）之上，幂等升级为完整 H+K：
--       provider 叠层状态 + 每层 8% attack_speed percent_add + 满 4 层
--       repeat(copyable_on_hit / phantom_hit)；并为四条纯可复制 on-hit 伤害
--       打开 copyable_on_hit（不碰 Kraken / Vayne W / Hullbreaker 等）。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 复用既有 provider_item_3124_guinsoos / listener / sequence / mount /
--    guinsoos_on_hit_damage / step_item_3124_guinsoos_damage；不重建 provider。
-- 4. 必需 game / reserved_type / attack_speed / provider/listener/sequence /
--    四条可复制源 damage 行缺失则 RAISE EXCEPTION 回滚。
-- 5. 不自动 publish；不做 DELETE；不写 legacy Bundle/Catalog/item/skill。
--
-- 前置：reserved_types_seed.sql；lol_adc_item_on_hit_passives_seed.sql；
--       lol_formula_on_hit_mechanisms_seed.sql（BotRK/Nashor/Terminus 伤害行）；
--       Guinsoo H+K DDL（schema 或 compatibility migration + triggers）。

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_missing_reserved   text;
    v_missing_damage     text;
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20150, -- operation/damage
        20160, -- operation/state_change
        20161, -- operation/repeat
        20170, -- value_policy/add
        20173, -- value_policy/percent_add
        20190, -- refresh_policy/refresh_duration
        20250, -- state_scope/provider
        20263  -- repeat_scope/copyable_on_hit
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_guinsoo_hk_seed: game_id=% missing in public.games',
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
            'lol_guinsoo_hk_seed: failed to lock game_data_state for %',
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
            'lol_guinsoo_hk_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'attack_speed'
    ) THEN
        RAISE EXCEPTION
            'lol_guinsoo_hk_seed: missing attribute_definitions for game_id=% attr_key=attack_speed',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_item_3124_guinsoos'
    ) THEN
        RAISE EXCEPTION
            'lol_guinsoo_hk_seed: missing provider_item_3124_guinsoos (on-hit passives prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_listeners pl
         WHERE pl.game_id = v_game_id
           AND pl.listener_id = 'listener_item_3124_guinsoos'
           AND pl.provider_id = 'provider_item_3124_guinsoos'
    ) THEN
        RAISE EXCEPTION
            'lol_guinsoo_hk_seed: missing listener_item_3124_guinsoos (on-hit passives prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_sequences es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_item_3124_guinsoos'
           AND es.provider_id = 'provider_item_3124_guinsoos'
    ) THEN
        RAISE EXCEPTION
            'lol_guinsoo_hk_seed: missing sequence_item_3124_guinsoos (on-hit passives prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_steps st
         WHERE st.game_id = v_game_id
           AND st.step_id = 'step_item_3124_guinsoos_damage'
           AND st.sequence_id = 'sequence_item_3124_guinsoos'
           AND st.step_order = 0
           AND st.operation_type_id = 20150
    ) THEN
        RAISE EXCEPTION
            'lol_guinsoo_hk_seed: missing step_item_3124_guinsoos_damage order=0 (on-hit passives prerequisite)';
    END IF;

    SELECT string_agg(req.step_id, ', ' ORDER BY req.step_id)
      INTO v_missing_damage
      FROM (VALUES
            ('step_item_3124_guinsoos_damage'),
            ('step_item_3153_ruined_king_damage'),
            ('step_item_3115_nashors_damage'),
            ('step_item_3302_terminus_damage')
           ) AS req(step_id)
     WHERE NOT EXISTS (
               SELECT 1
                 FROM public.damage_effect_details d
                WHERE d.game_id = v_game_id
                  AND d.step_id = req.step_id
           );
    IF v_missing_damage IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_guinsoo_hk_seed: missing copyable source damage_effect_details: %',
            v_missing_damage;
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
    -- provider state：guinsoos_seething_strike（max 4 / 3000ms / refresh_duration）
    -- =========================================================================
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_3124_guinsoos',
        'guinsoos_seething_strike',
        20100,
        4,
        3000,
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

    -- formulas：叠层 +1；每层 8% attack_speed
    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_item_3124_guinsoos',
            'guinsoos_seething_strike_add',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3124_guinsoos',
            'guinsoos_seething_strike_attack_speed',
            '{"op":"mul","args":[{"op":"const","value":0.08},{"op":"read","path":"provider.state.guinsoos_seething_strike"}]}'::jsonb,
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

    -- provider-bound attack_speed percent_add（可选分类字段保持 null）
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'modifier_item_3124_guinsoos_seething_strike_attack_speed',
        'provider_item_3124_guinsoos',
        'guinsoos_seething_strike_attack_speed',
        NULL,
        20110,
        'attack_speed',
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        20173,
        'guinsoos_seething_strike_attack_speed',
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

    -- =========================================================================
    -- sequence 升级：order0 damage（既有）→ order1 stack add → order2 phantom repeat
    -- =========================================================================
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_item_3124_guinsoos_seething_strike_add',
            'sequence_item_3124_guinsoos',
            1,
            20160,
            20110,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_3124_guinsoos_phantom_hit',
            'sequence_item_3124_guinsoos',
            2,
            20161,
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

    -- detail 与 effect_steps 同事务，满足 deferred exactly-one-detail
    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_item_3124_guinsoos_seething_strike_add',
        20250,
        'guinsoos_seething_strike',
        'guinsoos_seething_strike_add',
        20170,
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

    INSERT INTO public.repeat_effect_details (
        game_id, step_id, repeat_scope_type_id, repeat_count, repeat_tag,
        trigger_state_key, threshold, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_item_3124_guinsoos_phantom_hit',
        20263,
        1,
        'phantom_hit',
        'guinsoos_seething_strike',
        4,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        repeat_scope_type_id = EXCLUDED.repeat_scope_type_id,
        repeat_count = EXCLUDED.repeat_count,
        repeat_tag = EXCLUDED.repeat_tag,
        trigger_state_key = EXCLUDED.trigger_state_key,
        threshold = EXCLUDED.threshold,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.repeat_effect_details.repeat_scope_type_id IS DISTINCT FROM EXCLUDED.repeat_scope_type_id
       OR public.repeat_effect_details.repeat_count IS DISTINCT FROM EXCLUDED.repeat_count
       OR public.repeat_effect_details.repeat_tag IS DISTINCT FROM EXCLUDED.repeat_tag
       OR public.repeat_effect_details.trigger_state_key IS DISTINCT FROM EXCLUDED.trigger_state_key
       OR public.repeat_effect_details.threshold IS DISTINCT FROM EXCLUDED.threshold;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- 仅打开四条纯可复制 on-hit；保留其余列；绝不触碰其它 damage 行
    UPDATE public.damage_effect_details d
       SET copyable_on_hit = true,
           change_revision = v_candidate,
           updated_at = NOW()
     WHERE d.game_id = v_game_id
       AND d.step_id IN (
            'step_item_3124_guinsoos_damage',
            'step_item_3153_ruined_king_damage',
            'step_item_3115_nashors_damage',
            'step_item_3302_terminus_damage'
       )
       AND d.copyable_on_hit IS DISTINCT FROM true;
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
