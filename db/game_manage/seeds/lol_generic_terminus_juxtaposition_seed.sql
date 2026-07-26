-- =============================================================================
-- LoL generic Terminus Juxtaposition seed（界弓 item_3302 / 交相）
-- =============================================================================
--
-- 目标：在公式 OnHit 批次已写入的 Shadow（固定 30 魔法 on-hit）之上，幂等扩展
--       同一 provider_item_3302_terminus / mount / listener / sequence，补齐
--       Juxtaposition 光暗交替叠层与双抗/穿透修正。
--
-- Wiki 真源（League Wiki item manifest only）：
--   revid 4030984
--   SHA256 e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
--   Juxtaposition：对英雄的 on-hit 在 Light / Dark 间轮换；各叠层最多 3、持续 5s；
--   Light 提供 {{pp|6 to 8 for 3|1;11;14|type=level}} 护甲与魔抗（× stacks）；
--   Dark 提供 10% 护甲穿透与法术穿透（× stacks；满层 30%）。
--
-- Phase-A 近似（须在测试中断言文档存在）：
--   1. first-Light：next_polarity 无时长、运行时缺省 0=Light，首击先叠 Light 再切 Dark。
--   2. aggregate refresh：light_stacks / dark_stacks 使用单计数器 + 5000ms
--      refresh_on_write(20190)，以整窗刷新近似 Wiki 各层独立 5s 计时；不建模逐层
--      独立过期。
--   3. champion-only 门控本批不建模；凡既有 listener 合格的 real basic_attack_hit
--      均推进一次（与 Shadow 同 listener / max_triggers_per_event=1）。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 复用既有 provider_item_3302_terminus / listener_item_3302_terminus /
--    sequence_item_3302_terminus / step_item_3302_terminus_damage（order 0）/
--    item_3302 mount；不重建 provider；不写 entity_provider_mounts。
-- 4. 不改 Shadow：terminus_on_hit_damage 仍为 const 30；不触碰
--    damage_effect_details（含 copyable_on_hit，由 Guinsoo H+K 等既有合同拥有）。
-- 5. 状态推进步骤仅为 state_change，不可被 phantom/copyable_on_hit 复制。
-- 6. 必需 game / reserved / item_3302 / 既有 Terminus 图 / armor·magic_resist·
--    armor_pen_percent 缺失则 RAISE；幂等 ensure magic_pen_percent 与 champion_level。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE；不写 legacy Bundle/Catalog。
--
-- listener 顺序（既有 order-0 Shadow damage 之后）：
--   1 light_stacks +1（仅 next_polarity=Light/0）
--   2 dark_stacks +1（仅 next_polarity=Dark/1）
--   3 next_polarity toggle override = 1 - next_polarity（无条件）
--
-- 前置：reserved_types_seed.sql；Batch-C item_3302；
--       lol_formula_on_hit_mechanisms_seed.sql（Shadow 30 magic）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-terminus-juxtaposition-v1-20260719

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_temp_order_base    integer;
    v_missing_reserved   text;
    v_missing_attrs      text;
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20150, -- operation/damage（校验既有 Shadow step）
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20190, -- refresh_policy/refresh_duration
        20250  -- state_scope/provider
    ];
    v_required_attrs     text[] := ARRAY[
        'armor',
        'magic_resist',
        'armor_pen_percent'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_terminus_juxtaposition_seed: game_id=% missing in public.games',
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
            'lol_generic_terminus_juxtaposition_seed: failed to lock game_data_state for %',
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
            'lol_generic_terminus_juxtaposition_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'item_3302'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_terminus_juxtaposition_seed: missing game_entities item_3302 (Batch-C prerequisite)';
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
            'lol_generic_terminus_juxtaposition_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_item_3302_terminus'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_terminus_juxtaposition_seed: missing provider_item_3302_terminus (Shadow on-hit prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_provider_mounts epm
         WHERE epm.game_id = v_game_id
           AND epm.entity_id = 'item_3302'
           AND epm.provider_id = 'provider_item_3302_terminus'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_terminus_juxtaposition_seed: missing item_3302 mount of provider_item_3302_terminus';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_listeners pl
         WHERE pl.game_id = v_game_id
           AND pl.listener_id = 'listener_item_3302_terminus'
           AND pl.provider_id = 'provider_item_3302_terminus'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_terminus_juxtaposition_seed: missing listener_item_3302_terminus (Shadow on-hit prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_sequences es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_item_3302_terminus'
           AND es.provider_id = 'provider_item_3302_terminus'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_terminus_juxtaposition_seed: missing sequence_item_3302_terminus (Shadow on-hit prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_steps st
         WHERE st.game_id = v_game_id
           AND st.step_id = 'step_item_3302_terminus_damage'
           AND st.sequence_id = 'sequence_item_3302_terminus'
           AND st.step_order = 0
           AND st.operation_type_id = 20150
    ) THEN
        RAISE EXCEPTION
            'lol_generic_terminus_juxtaposition_seed: missing step_item_3302_terminus_damage order=0 (Shadow prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_formulas pf
         WHERE pf.game_id = v_game_id
           AND pf.provider_id = 'provider_item_3302_terminus'
           AND pf.formula_key = 'terminus_on_hit_damage'
           AND pf.expression = '{"op":"const","value":30}'::jsonb
    ) THEN
        RAISE EXCEPTION
            'lol_generic_terminus_juxtaposition_seed: Shadow terminus_on_hit_damage must remain const 30';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.damage_effect_details d
         WHERE d.game_id = v_game_id
           AND d.step_id = 'step_item_3302_terminus_damage'
           AND d.amount_formula_key = 'terminus_on_hit_damage'
           AND d.damage_type_id = 20221
           AND d.value_policy_type_id = 20170
    ) THEN
        RAISE EXCEPTION
            'lol_generic_terminus_juxtaposition_seed: missing Shadow damage_effect_details (30 magic add)';
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

    -- 幂等 ensure：magic_pen_percent（Dark 穿透）/ champion_level（Light pp）
    INSERT INTO public.attribute_definitions (
        game_id, attr_key, sort_order, attr_name, attr_type, default_value,
        value_kind, rate_target_attr_key, min_value, max_value,
        change_revision, updated_at
    ) VALUES
        (v_game_id, 'magic_pen_percent', 930, '百分比魔法穿透', 'number', 0,
         'scalar', NULL, NULL, NULL, v_candidate, NOW()),
        (v_game_id, 'champion_level', 920, '英雄等级', 'number', 1,
         'scalar', NULL, 1, 18, v_candidate, NOW())
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
    -- provider state：
    --   next_polarity（untimed / max1；运行时缺省 0=Light / first-Light）
    --   light_stacks / dark_stacks（max3 / 5000ms / refresh_on_write aggregate）
    -- =========================================================================
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_item_3302_terminus',
            'next_polarity',
            20100,
            1,
            NULL,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3302_terminus',
            'light_stacks',
            20100,
            3,
            5000,
            20190,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3302_terminus',
            'dark_stacks',
            20100,
            3,
            5000,
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

    -- formulas：极性条件 / 叠层 +1 / 极性翻转 / Light pp×stacks / Dark 0.10×stacks
    -- Light pp：Wiki 6@1, 7@11, 8@14 端点钳制分段线性
    --   6 + clamp((level-1)/10,0,1) + clamp((level-11)/3,0,1)
    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_item_3302_terminus',
            'terminus_polarity_is_light',
            '{"op":"eq","args":[{"op":"read","path":"provider.state.next_polarity"},{"op":"const","value":0}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3302_terminus',
            'terminus_polarity_is_dark',
            '{"op":"eq","args":[{"op":"read","path":"provider.state.next_polarity"},{"op":"const","value":1}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3302_terminus',
            'terminus_light_stacks_add',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3302_terminus',
            'terminus_dark_stacks_add',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3302_terminus',
            'terminus_polarity_toggle',
            '{"op":"sub","args":[{"op":"const","value":1},{"op":"read","path":"provider.state.next_polarity"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3302_terminus',
            'terminus_light_resist_bonus',
            '{"op":"mul","args":[{"op":"add","args":[{"op":"add","args":[{"op":"const","value":6},{"op":"clamp","expr":{"op":"div","args":[{"op":"sub","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":1}]},{"op":"const","value":10}]},"min":{"op":"const","value":0},"max":{"op":"const","value":1}}]},{"op":"clamp","expr":{"op":"div","args":[{"op":"sub","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":11}]},{"op":"const","value":3}]},"min":{"op":"const","value":0},"max":{"op":"const","value":1}}]},{"op":"read","path":"provider.state.light_stacks"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3302_terminus',
            'terminus_dark_pen_bonus',
            '{"op":"mul","args":[{"op":"const","value":0.10},{"op":"read","path":"provider.state.dark_stacks"}]}'::jsonb,
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

    -- provider-bound flat add：Light → armor / magic_resist；Dark → pen percents
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'modifier_item_3302_terminus_light_armor',
            'provider_item_3302_terminus',
            'terminus_light_armor',
            NULL,
            20110,
            'armor',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20170,
            'terminus_light_resist_bonus',
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'modifier_item_3302_terminus_light_magic_resist',
            'provider_item_3302_terminus',
            'terminus_light_magic_resist',
            NULL,
            20110,
            'magic_resist',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20170,
            'terminus_light_resist_bonus',
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'modifier_item_3302_terminus_dark_armor_pen',
            'provider_item_3302_terminus',
            'terminus_dark_armor_pen',
            NULL,
            20110,
            'armor_pen_percent',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20170,
            'terminus_dark_pen_bonus',
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'modifier_item_3302_terminus_dark_magic_pen',
            'provider_item_3302_terminus',
            'terminus_dark_magic_pen',
            NULL,
            20110,
            'magic_pen_percent',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20170,
            'terminus_dark_pen_bonus',
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
    -- sequence 扩展：order0 Shadow damage（既有，不触碰）
    --   → order1 light_stacks +1（polarity Light）
    --   → order2 dark_stacks +1（polarity Dark）
    --   → order3 next_polarity toggle
    --
    -- Collision-safe reorder (uq_effect_steps_order): only when an existing
    -- Juxtaposition-owned step already sits on a non-final order.
    -- =========================================================================
    IF EXISTS (
        SELECT 1
          FROM public.effect_steps es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_item_3302_terminus'
           AND (
                (es.step_id = 'step_item_3302_terminus_light_stacks_add'
                    AND es.step_order IS DISTINCT FROM 1)
             OR (es.step_id = 'step_item_3302_terminus_dark_stacks_add'
                    AND es.step_order IS DISTINCT FROM 2)
             OR (es.step_id = 'step_item_3302_terminus_polarity_toggle'
                    AND es.step_order IS DISTINCT FROM 3)
           )
    ) THEN
        SELECT COALESCE(MAX(es.step_order), 0)
          INTO v_temp_order_base
          FROM public.effect_steps es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_item_3302_terminus';

        WITH owned AS (
            SELECT es.step_id,
                   ROW_NUMBER() OVER (ORDER BY es.step_id) AS rn
              FROM public.effect_steps es
             WHERE es.game_id = v_game_id
               AND es.sequence_id = 'sequence_item_3302_terminus'
               AND es.step_id IN (
                    'step_item_3302_terminus_light_stacks_add',
                    'step_item_3302_terminus_dark_stacks_add',
                    'step_item_3302_terminus_polarity_toggle'
               )
        )
        UPDATE public.effect_steps es
           SET step_order = v_temp_order_base + owned.rn,
               updated_at = NOW()
          FROM owned
         WHERE es.game_id = v_game_id
           AND es.step_id = owned.step_id;
        -- Temporary parking only; do not set v_changed here.
    END IF;

    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_item_3302_terminus_light_stacks_add',
            'sequence_item_3302_terminus',
            1,
            20160,
            20110,
            'terminus_polarity_is_light',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_3302_terminus_dark_stacks_add',
            'sequence_item_3302_terminus',
            2,
            20160,
            20110,
            'terminus_polarity_is_dark',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_3302_terminus_polarity_toggle',
            'sequence_item_3302_terminus',
            3,
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

    -- detail 与 effect_steps 同事务，满足 deferred exactly-one-detail
    -- state_change only → 不可 phantom copy（无 damage / copyable_on_hit）
    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_item_3302_terminus_light_stacks_add',
            20250,
            'light_stacks',
            'terminus_light_stacks_add',
            20170,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_3302_terminus_dark_stacks_add',
            20250,
            'dark_stacks',
            'terminus_dark_stacks_add',
            20170,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_3302_terminus_polarity_toggle',
            20250,
            'next_polarity',
            'terminus_polarity_toggle',
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

    IF v_changed THEN
        UPDATE public.game_data_state
           SET current_revision = v_candidate,
               updated_at = NOW()
         WHERE game_id = v_game_id;
    END IF;
END $$;

COMMIT;
