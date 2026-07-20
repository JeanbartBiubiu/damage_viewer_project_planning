-- =============================================================================
-- LoL generic Spellblade seed（黄昏与黎明 item_2510 Dusk and Dawn）
-- =============================================================================
--
-- 目标：幂等写入 item_2510 Spellblade provider：ability_started（ready=0 且
--       icd=0）仅武装 ready；下一次 basic_attack_hit 造成
--       0.75 * event.entry_source.attr.ad.base
--       + 0.10 * event.entry_source.attr.ap.resolved
--       魔法伤害，self heal（0.10 AP + 0.03 bonus HP），以及 delay_ms=200 的
--       copyable_on_hit repeat（tag dusk_and_dawn_delayed_on_hit），然后清
--       ready 并开始 ICD（ICD 以强化攻击消耗时开始）。
--
-- Wiki 真源（仅注释，无运行时外部依赖）：
--   current-items item 2510 Dusk and Dawn / Spellblade
--   revid 4030984
--   SHA256 e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
--   C:\project\damage_wasm_dev\数据参考\lol-wiki-current-items\current-items.normalized.json
--   （75% base AD + 10% AP on-hit magic；heal 10% AP + 3% bonus HP；
--    +200ms delayed copyable on-hit；10s ready / 1.5s ICD starts after
--    empowered attack）
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / item_2510（静态 ap=60、hp=300 为 Batch-C 既有输入，本脚本不改写）/
--    reserved_type（含 20151 heal / 20161 repeat / 20263 copyable_on_hit）/
--    attribute_definitions ad·ap 缺失则 RAISE EXCEPTION 回滚。
--    不依赖 hero_vayne / ability_hero_vayne_tumble / ability/basic_attack（62003）/
--    type_relations / lol_generic_spellblade_seed.sql / item_3100 / item_3508。
-- 4. provider 只监听已存在的 ability_started / basic_attack_hit / source_owner
--    事件；不创建 ability 或 game-local ability type；不写 provider_modifiers。
-- 5. spellblade_can_arm 用 mul(eq(ready,0), eq(icd,0)) 数值门控（formula VM
--    无 and/or/not）；proc 五步同 condition spellblade_ready_armed，最终顺序：
--    0 damage → 1 heal → 2 repeat(+200ms) → 3 arm icd → 4 consume ready；
--    自身 damage copyable_on_hit=false；damage/magic 20221 + value_policy/add 20170。
-- 6. effect_steps 另有 uq_effect_steps_order UNIQUE (game_id, sequence_id, step_order)；
--    live 旧合同（damage=0 / icd=1 / consume=2）升级到 0..4 前，若任一已有
--    owned step 的 order 与最终目标不同，则先按序列当前 MAX(step_order) 派生
--    临时基址，把既有 owned 行挪到互不冲突的临时 order，再做最终 upsert；
--    已对齐最终 order（含仅缺新行）时跳过临时重排。不 DELETE / 不禁用约束。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE；不写 legacy Bundle/Catalog；
--    不做 live migration。
--
-- 前置：reserved_types_seed.sql；Batch-C item_2510；
--       basic_attack_hit emit 基线（on-hit passives 或等价）；
--       generic_repeat_delay_compatibility_migration.sql（已有库需先补 delay_ms）。
-- 建议发布版本（本脚本不负责 publish）：lol-generic-dusk-and-dawn-spellblade-v2-20260721

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
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20111, -- selector/opponent
        20120, -- provider_kind/passive
        20150, -- operation/damage
        20151, -- operation/heal
        20160, -- operation/state_change
        20161, -- operation/repeat
        20170, -- value_policy/add
        20172, -- value_policy/override
        20181, -- match_mode/all
        20190, -- refresh_policy/refresh_duration
        20205, -- event/ability_started
        20211, -- event/basic_attack_hit
        20212, -- event/source_owner
        20221, -- damage/magic
        20250, -- state_scope/provider
        20263  -- repeat_scope/copyable_on_hit
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_dusk_and_dawn_spellblade_seed: game_id=% missing in public.games',
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
            'lol_generic_dusk_and_dawn_spellblade_seed: failed to lock game_data_state for %',
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
            'lol_generic_dusk_and_dawn_spellblade_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'item_2510'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_dusk_and_dawn_spellblade_seed: missing game_entities item_2510 (Batch-C prerequisite)';
    END IF;

    -- Batch-C 静态属性仅为既有输入校验；本脚本不 mutate / recreate Batch-C
    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'item_2510'
           AND eav.attr_key = 'ap'
           AND eav.base_value = 60
    ) THEN
        RAISE EXCEPTION
            'lol_generic_dusk_and_dawn_spellblade_seed: item_2510 missing static ap=60';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'item_2510'
           AND eav.attr_key = 'hp'
           AND eav.base_value = 300
    ) THEN
        RAISE EXCEPTION
            'lol_generic_dusk_and_dawn_spellblade_seed: item_2510 missing static hp=300';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_dusk_and_dawn_spellblade_seed: missing attribute_definitions for game_id=% attr_key=ad',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_dusk_and_dawn_spellblade_seed: missing attribute_definitions for game_id=% attr_key=ap',
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
    -- item_2510 Dusk and Dawn Spellblade provider / states / formulas /
    -- listeners / effect graph（ICD 在强化普攻消耗时开始，对齐 Essence Reaver）
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_2510_dusk_and_dawn_spellblade',
        20120,
        '黄昏与黎明 Spellblade',
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
            'provider_item_2510_dusk_and_dawn_spellblade',
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
            'provider_item_2510_dusk_and_dawn_spellblade',
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
            'provider_item_2510_dusk_and_dawn_spellblade',
            'spellblade_can_arm',
            '{"op":"mul","args":[{"op":"eq","args":[{"op":"read","path":"provider.state.spellblade_ready"},{"op":"const","value":0}]},{"op":"eq","args":[{"op":"read","path":"provider.state.spellblade_icd"},{"op":"const","value":0}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_2510_dusk_and_dawn_spellblade',
            'spellblade_ready_arm',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_2510_dusk_and_dawn_spellblade',
            'spellblade_icd_arm',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_2510_dusk_and_dawn_spellblade',
            'spellblade_ready_armed',
            '{"op":"gte","args":[{"op":"read","path":"provider.state.spellblade_ready"},{"op":"const","value":1}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_2510_dusk_and_dawn_spellblade',
            'spellblade_proc_damage',
            '{"op":"add","args":[{"op":"mul","args":[{"op":"const","value":0.75},{"op":"read","path":"event.entry_source.attr.ad.base"}]},{"op":"mul","args":[{"op":"const","value":0.10},{"op":"read","path":"event.entry_source.attr.ap.resolved"}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_2510_dusk_and_dawn_spellblade',
            'spellblade_proc_heal',
            '{"op":"add","args":[{"op":"mul","args":[{"op":"const","value":0.10},{"op":"read","path":"event.entry_source.attr.ap.resolved"}]},{"op":"mul","args":[{"op":"const","value":0.03},{"op":"max","args":[{"op":"const","value":0},{"op":"sub","args":[{"op":"read","path":"event.entry_source.attr.hp.max"},{"op":"read","path":"event.entry_source.attr.hp.base"}]}]}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_2510_dusk_and_dawn_spellblade',
            'spellblade_ready_consume',
            '{"op":"const","value":0}'::jsonb,
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

    -- Listener A：ability_started → arm ready only（ready == 0 AND icd == 0）
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_item_2510_dusk_and_dawn_spellblade_arm',
        'provider_item_2510_dusk_and_dawn_spellblade',
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
    ) VALUES (
        v_game_id,
        'step_item_2510_dusk_and_dawn_spellblade_ready_arm',
        'sequence_item_2510_dusk_and_dawn_spellblade_arm',
        0,
        20160,
        20110,
        'spellblade_can_arm',
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
        'step_item_2510_dusk_and_dawn_spellblade_ready_arm',
        20250,
        'spellblade_ready',
        'spellblade_ready_arm',
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
        'listener_item_2510_dusk_and_dawn_spellblade_ability_started',
        'provider_item_2510_dusk_and_dawn_spellblade',
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
        (v_game_id, 'listener_item_2510_dusk_and_dawn_spellblade_ability_started', 20181, 20205, v_candidate, NOW()),
        (v_game_id, 'listener_item_2510_dusk_and_dawn_spellblade_ability_started', 20181, 20212, v_candidate, NOW())
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
        'listener_item_2510_dusk_and_dawn_spellblade_ability_started',
        'sequence_item_2510_dusk_and_dawn_spellblade_arm',
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

    -- Listener B：basic_attack_hit → damage → heal → repeat(+200ms) → arm icd → consume ready
    -- （ICD 以强化攻击消耗序列开始；arm icd 在 consume 之前，保证逐步 condition 仍见 ready）
    --
    -- Collision-safe reorder (uq_effect_steps_order): only when an existing
    -- owned step already sits on a non-final order. Temporary orders are
    -- derived from the current sequence MAX(step_order); final upsert below
    -- still owns material-change / v_changed detection via IS DISTINCT FROM.
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_item_2510_dusk_and_dawn_spellblade_proc',
        'provider_item_2510_dusk_and_dawn_spellblade',
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

    IF EXISTS (
        SELECT 1
          FROM public.effect_steps es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_item_2510_dusk_and_dawn_spellblade_proc'
           AND (
                (es.step_id = 'step_item_2510_dusk_and_dawn_spellblade_damage'
                    AND es.step_order IS DISTINCT FROM 0)
             OR (es.step_id = 'step_item_2510_dusk_and_dawn_spellblade_heal'
                    AND es.step_order IS DISTINCT FROM 1)
             OR (es.step_id = 'step_item_2510_dusk_and_dawn_spellblade_delayed_on_hit'
                    AND es.step_order IS DISTINCT FROM 2)
             OR (es.step_id = 'step_item_2510_dusk_and_dawn_spellblade_icd_arm'
                    AND es.step_order IS DISTINCT FROM 3)
             OR (es.step_id = 'step_item_2510_dusk_and_dawn_spellblade_ready_consume'
                    AND es.step_order IS DISTINCT FROM 4)
           )
    ) THEN
        SELECT COALESCE(MAX(es.step_order), 0)
          INTO v_temp_order_base
          FROM public.effect_steps es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_item_2510_dusk_and_dawn_spellblade_proc';

        WITH owned AS (
            SELECT es.step_id,
                   ROW_NUMBER() OVER (ORDER BY es.step_id) AS rn
              FROM public.effect_steps es
             WHERE es.game_id = v_game_id
               AND es.sequence_id = 'sequence_item_2510_dusk_and_dawn_spellblade_proc'
               AND es.step_id IN (
                    'step_item_2510_dusk_and_dawn_spellblade_damage',
                    'step_item_2510_dusk_and_dawn_spellblade_heal',
                    'step_item_2510_dusk_and_dawn_spellblade_delayed_on_hit',
                    'step_item_2510_dusk_and_dawn_spellblade_icd_arm',
                    'step_item_2510_dusk_and_dawn_spellblade_ready_consume'
               )
        )
        UPDATE public.effect_steps es
           SET step_order = v_temp_order_base + owned.rn,
               updated_at = NOW()
          FROM owned
         WHERE es.game_id = v_game_id
           AND es.step_id = owned.step_id;
        -- Temporary parking only; do not set v_changed here. Final upsert below
        -- remains conditional on actual contract differences (rerun idempotent).
    END IF;

    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_item_2510_dusk_and_dawn_spellblade_damage',
            'sequence_item_2510_dusk_and_dawn_spellblade_proc',
            0,
            20150,
            20111,
            'spellblade_ready_armed',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_2510_dusk_and_dawn_spellblade_heal',
            'sequence_item_2510_dusk_and_dawn_spellblade_proc',
            1,
            20151,
            20110,
            'spellblade_ready_armed',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_2510_dusk_and_dawn_spellblade_delayed_on_hit',
            'sequence_item_2510_dusk_and_dawn_spellblade_proc',
            2,
            20161,
            20110,
            'spellblade_ready_armed',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_2510_dusk_and_dawn_spellblade_icd_arm',
            'sequence_item_2510_dusk_and_dawn_spellblade_proc',
            3,
            20160,
            20110,
            'spellblade_ready_armed',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_2510_dusk_and_dawn_spellblade_ready_consume',
            'sequence_item_2510_dusk_and_dawn_spellblade_proc',
            4,
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
        'step_item_2510_dusk_and_dawn_spellblade_damage',
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

    INSERT INTO public.heal_effect_details (
        game_id, step_id, amount_formula_key, value_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_item_2510_dusk_and_dawn_spellblade_heal',
        'spellblade_proc_heal',
        20170,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        amount_formula_key = EXCLUDED.amount_formula_key,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.heal_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.heal_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.repeat_effect_details (
        game_id, step_id, repeat_scope_type_id, repeat_count, repeat_tag,
        trigger_state_key, threshold, delay_ms, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_item_2510_dusk_and_dawn_spellblade_delayed_on_hit',
        20263,
        1,
        'dusk_and_dawn_delayed_on_hit',
        'spellblade_icd',
        1,
        200,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        repeat_scope_type_id = EXCLUDED.repeat_scope_type_id,
        repeat_count = EXCLUDED.repeat_count,
        repeat_tag = EXCLUDED.repeat_tag,
        trigger_state_key = EXCLUDED.trigger_state_key,
        threshold = EXCLUDED.threshold,
        delay_ms = EXCLUDED.delay_ms,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.repeat_effect_details.repeat_scope_type_id IS DISTINCT FROM EXCLUDED.repeat_scope_type_id
       OR public.repeat_effect_details.repeat_count IS DISTINCT FROM EXCLUDED.repeat_count
       OR public.repeat_effect_details.repeat_tag IS DISTINCT FROM EXCLUDED.repeat_tag
       OR public.repeat_effect_details.trigger_state_key IS DISTINCT FROM EXCLUDED.trigger_state_key
       OR public.repeat_effect_details.threshold IS DISTINCT FROM EXCLUDED.threshold
       OR public.repeat_effect_details.delay_ms IS DISTINCT FROM EXCLUDED.delay_ms;
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
            'step_item_2510_dusk_and_dawn_spellblade_ready_consume',
            20250,
            'spellblade_ready',
            'spellblade_ready_consume',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_2510_dusk_and_dawn_spellblade_icd_arm',
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
        'listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit',
        'provider_item_2510_dusk_and_dawn_spellblade',
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
        (v_game_id, 'listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit', 20181, 20211, v_candidate, NOW()),
        (v_game_id, 'listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit', 20181, 20212, v_candidate, NOW())
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
        'listener_item_2510_dusk_and_dawn_spellblade_basic_attack_hit',
        'sequence_item_2510_dusk_and_dawn_spellblade_proc',
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
        'item_2510',
        'provider_item_2510_dusk_and_dawn_spellblade',
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
