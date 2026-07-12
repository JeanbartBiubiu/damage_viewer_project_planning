-- =============================================================================
-- LoL ADC item on-hit passives (Batch-C 破败 / 海妖 / 鬼索首批) seed
-- =============================================================================
--
-- 目标：在 Batch-B 六 ADC 普攻闭环与 Batch-C 三件装备实体之上，幂等挂载首批
--       on-hit 被动，并统一为六个 basic attack damage sequence 追加
--       emit_event(event/basic_attack_hit)（薇恩已有同名稳定行时幂等 upsert）。
--
-- 范围：
-- 1. item_3153 破败：每次 owner 普攻命中，对 opponent 造成其
--    event.entry_target.attr.hp.current 的 6% 物理伤害
--    （父 execution frame 入口快照 / 基础普攻伤害前）。
-- 2. item_6672 海妖：provider_target 计数；每第 3 次造成
--    120 * (1 + missingHpRatio * 0.75) 物理伤害后重置；
--    missingHpRatio = clamp((maxHP-currentHP)/max(maxHP,1), 0, 1)；
--    max/current HP 均读 event.entry_target.attr.hp.*
--    （父 execution frame 入口快照 / 基础普攻伤害前）。
-- 3. item_3124 鬼索首批：每次 owner 普攻命中造成固定 30 魔法伤害
--    （不含叠攻速 / 持续时间 / 满层 / 幻影复击）。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 三件装备实体、六个 ADC 普攻 provider/ability/phase/sequence/damage step、
--    所需 reserved_type、hp attribute_definitions 缺失则 RAISE EXCEPTION 回滚。
-- 4. listener 必须 ALL-match event/basic_attack_hit + event/source_owner。
-- 5. 不自动 publish；不做 DELETE；不写 legacy item/skill、Bundle/Catalog。
--
-- 前置：reserved_types_seed.sql；lol_batch_b_adc_entities_seed.sql；
--       lol_batch_c_adc_items_seed.sql（或等价实体/普攻图已存在）。
--       薇恩 emit 行可与 lol_vayne_silver_bolts_seed.sql 并存（同稳定 ID 幂等）。

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_missing_reserved   text;
    v_missing_basic      text;
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20111, -- selector/opponent
        20120, -- provider_kind/passive
        20150, -- operation/damage
        20158, -- operation/emit_event
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20181, -- match_mode/all
        20211, -- event/basic_attack_hit
        20212, -- event/source_owner
        20220, -- damage/physical
        20221, -- damage/magic
        20252  -- state_scope/provider_target
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_adc_item_on_hit_passives_seed: game_id=% missing in public.games',
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
            'lol_adc_item_on_hit_passives_seed: failed to lock game_data_state for %',
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
            'lol_adc_item_on_hit_passives_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'hp'
    ) THEN
        RAISE EXCEPTION
            'lol_adc_item_on_hit_passives_seed: missing attribute_definitions for game_id=% attr_key=hp',
            v_game_id;
    END IF;

    -- 三件 Batch-C 装备实体必须已存在
    IF NOT EXISTS (
        SELECT 1 FROM public.game_entities ge
         WHERE ge.game_id = v_game_id AND ge.entity_id = 'item_3153'
    ) THEN
        RAISE EXCEPTION
            'lol_adc_item_on_hit_passives_seed: missing game_entities item_3153 (Batch-C prerequisite)';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.game_entities ge
         WHERE ge.game_id = v_game_id AND ge.entity_id = 'item_6672'
    ) THEN
        RAISE EXCEPTION
            'lol_adc_item_on_hit_passives_seed: missing game_entities item_6672 (Batch-C prerequisite)';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.game_entities ge
         WHERE ge.game_id = v_game_id AND ge.entity_id = 'item_3124'
    ) THEN
        RAISE EXCEPTION
            'lol_adc_item_on_hit_passives_seed: missing game_entities item_3124 (Batch-C prerequisite)';
    END IF;

    -- 六个 ADC 的 basic attack provider / ability / phase / sequence / damage step
    SELECT string_agg(req.provider_id, ', ' ORDER BY req.provider_id)
      INTO v_missing_basic
      FROM (VALUES
            ('provider_hero_vayne_basic_attack'),
            ('provider_hero_teemo_basic_attack'),
            ('provider_hero_varus_basic_attack'),
            ('provider_hero_kaisa_basic_attack'),
            ('provider_hero_twitch_basic_attack'),
            ('provider_hero_kogmaw_basic_attack')
           ) AS req(provider_id)
     WHERE NOT EXISTS (
               SELECT 1
                 FROM public.provider_definitions pd
                WHERE pd.game_id = v_game_id
                  AND pd.provider_id = req.provider_id
           );
    IF v_missing_basic IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_adc_item_on_hit_passives_seed: missing provider(s) (Batch-B prerequisite): %',
            v_missing_basic;
    END IF;

    SELECT string_agg(req.ability_id, ', ' ORDER BY req.ability_id)
      INTO v_missing_basic
      FROM (VALUES
            ('ability_hero_vayne_basic_attack', 'provider_hero_vayne_basic_attack'),
            ('ability_hero_teemo_basic_attack', 'provider_hero_teemo_basic_attack'),
            ('ability_hero_varus_basic_attack', 'provider_hero_varus_basic_attack'),
            ('ability_hero_kaisa_basic_attack', 'provider_hero_kaisa_basic_attack'),
            ('ability_hero_twitch_basic_attack', 'provider_hero_twitch_basic_attack'),
            ('ability_hero_kogmaw_basic_attack', 'provider_hero_kogmaw_basic_attack')
           ) AS req(ability_id, provider_id)
     WHERE NOT EXISTS (
               SELECT 1
                 FROM public.ability_definitions ad
                WHERE ad.game_id = v_game_id
                  AND ad.ability_id = req.ability_id
                  AND ad.provider_id = req.provider_id
           );
    IF v_missing_basic IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_adc_item_on_hit_passives_seed: missing ability(ies) (Batch-B prerequisite): %',
            v_missing_basic;
    END IF;

    SELECT string_agg(req.phase_id, ', ' ORDER BY req.phase_id)
      INTO v_missing_basic
      FROM (VALUES
            ('phase_hero_vayne_basic_attack_impact', 'ability_hero_vayne_basic_attack'),
            ('phase_hero_teemo_basic_attack_impact', 'ability_hero_teemo_basic_attack'),
            ('phase_hero_varus_basic_attack_impact', 'ability_hero_varus_basic_attack'),
            ('phase_hero_kaisa_basic_attack_impact', 'ability_hero_kaisa_basic_attack'),
            ('phase_hero_twitch_basic_attack_impact', 'ability_hero_twitch_basic_attack'),
            ('phase_hero_kogmaw_basic_attack_impact', 'ability_hero_kogmaw_basic_attack')
           ) AS req(phase_id, ability_id)
     WHERE NOT EXISTS (
               SELECT 1
                 FROM public.ability_phases ap
                WHERE ap.game_id = v_game_id
                  AND ap.phase_id = req.phase_id
                  AND ap.ability_id = req.ability_id
           );
    IF v_missing_basic IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_adc_item_on_hit_passives_seed: missing phase(s) (Batch-B prerequisite): %',
            v_missing_basic;
    END IF;

    SELECT string_agg(req.sequence_id, ', ' ORDER BY req.sequence_id)
      INTO v_missing_basic
      FROM (VALUES
            ('sequence_hero_vayne_basic_attack_damage', 'provider_hero_vayne_basic_attack'),
            ('sequence_hero_teemo_basic_attack_damage', 'provider_hero_teemo_basic_attack'),
            ('sequence_hero_varus_basic_attack_damage', 'provider_hero_varus_basic_attack'),
            ('sequence_hero_kaisa_basic_attack_damage', 'provider_hero_kaisa_basic_attack'),
            ('sequence_hero_twitch_basic_attack_damage', 'provider_hero_twitch_basic_attack'),
            ('sequence_hero_kogmaw_basic_attack_damage', 'provider_hero_kogmaw_basic_attack')
           ) AS req(sequence_id, provider_id)
     WHERE NOT EXISTS (
               SELECT 1
                 FROM public.effect_sequences es
                WHERE es.game_id = v_game_id
                  AND es.sequence_id = req.sequence_id
                  AND es.provider_id = req.provider_id
           );
    IF v_missing_basic IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_adc_item_on_hit_passives_seed: missing sequence(s) (Batch-B prerequisite): %',
            v_missing_basic;
    END IF;

    SELECT string_agg(req.step_id, ', ' ORDER BY req.step_id)
      INTO v_missing_basic
      FROM (VALUES
            ('step_hero_vayne_basic_attack_damage', 'sequence_hero_vayne_basic_attack_damage'),
            ('step_hero_teemo_basic_attack_damage', 'sequence_hero_teemo_basic_attack_damage'),
            ('step_hero_varus_basic_attack_damage', 'sequence_hero_varus_basic_attack_damage'),
            ('step_hero_kaisa_basic_attack_damage', 'sequence_hero_kaisa_basic_attack_damage'),
            ('step_hero_twitch_basic_attack_damage', 'sequence_hero_twitch_basic_attack_damage'),
            ('step_hero_kogmaw_basic_attack_damage', 'sequence_hero_kogmaw_basic_attack_damage')
           ) AS req(step_id, sequence_id)
     WHERE NOT EXISTS (
               SELECT 1
                 FROM public.effect_steps st
                WHERE st.game_id = v_game_id
                  AND st.step_id = req.step_id
                  AND st.sequence_id = req.sequence_id
                  AND st.step_order = 0
           );
    IF v_missing_basic IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_adc_item_on_hit_passives_seed: missing damage step(s) order=0 (Batch-B prerequisite): %',
            v_missing_basic;
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
    -- item_3153 破败：每次命中 6% entry-snapshot current HP 物理伤害
    -- （event.entry_target；基础普攻伤害前）
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_3153_ruined_king',
        20120,
        '破败王者之刃 on-hit',
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

    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_3153_ruined_king',
        'ruined_king_on_hit_damage',
        '{"op":"mul","args":[{"op":"read","path":"event.entry_target.attr.hp.current"},{"op":"const","value":0.06}]}'::jsonb,
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

    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_item_3153_ruined_king',
        'provider_item_3153_ruined_king',
        'ruined_king_on_hit',
        '破败命中结算',
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
        'step_item_3153_ruined_king_damage',
        'sequence_item_3153_ruined_king',
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

    -- detail 与 effect_steps 同事务，满足 deferred exactly-one-detail
    INSERT INTO public.damage_effect_details (
        game_id, step_id, amount_formula_key, damage_type_id, value_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_item_3153_ruined_king_damage',
        'ruined_king_on_hit_damage',
        20220,
        20170,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        amount_formula_key = EXCLUDED.amount_formula_key,
        damage_type_id = EXCLUDED.damage_type_id,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.damage_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.damage_effect_details.damage_type_id IS DISTINCT FROM EXCLUDED.damage_type_id
       OR public.damage_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_item_3153_ruined_king',
        'provider_item_3153_ruined_king',
        'ruined_king_on_basic_attack_hit',
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
        (v_game_id, 'listener_item_3153_ruined_king', 20181, 20211, v_candidate, NOW()),
        (v_game_id, 'listener_item_3153_ruined_king', 20181, 20212, v_candidate, NOW())
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
        'listener_item_3153_ruined_king',
        'sequence_item_3153_ruined_king',
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
        'item_3153',
        'provider_item_3153_ruined_king',
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

    -- =========================================================================
    -- item_6672 海妖：计数 → 条件物理伤害 → 条件重置（provider_target）
    -- missing HP 读 event.entry_target.attr.hp.max/current（入口快照）
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_6672_kraken',
        20120,
        '海妖杀手 on-hit',
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

    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_6672_kraken',
        'kraken_hits',
        20100,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, provider_id, state_key) DO UPDATE SET
        value_type_id = EXCLUDED.value_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_state_fields.value_type_id IS DISTINCT FROM EXCLUDED.value_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_item_6672_kraken',
            'kraken_hit_add',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_6672_kraken',
            'kraken_proc_condition',
            '{"op":"gte","args":[{"op":"read","path":"provider.target_state.kraken_hits"},{"op":"const","value":3}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_6672_kraken',
            'kraken_proc_damage',
            '{"op":"mul","args":[{"op":"const","value":120},{"op":"add","args":[{"op":"const","value":1},{"op":"mul","args":[{"op":"clamp","expr":{"op":"div","args":[{"op":"sub","args":[{"op":"read","path":"event.entry_target.attr.hp.max"},{"op":"read","path":"event.entry_target.attr.hp.current"}]},{"op":"max","args":[{"op":"read","path":"event.entry_target.attr.hp.max"},{"op":"const","value":1}]}]},"min":{"op":"const","value":0},"max":{"op":"const","value":1}},{"op":"const","value":0.75}]}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_6672_kraken',
            'kraken_hit_reset',
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

    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_item_6672_kraken',
        'provider_item_6672_kraken',
        'kraken_on_hit',
        '海妖命中结算',
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

    -- 三步：计数 → 条件物理伤害 → 条件重置
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_item_6672_kraken_hit_add',
            'sequence_item_6672_kraken',
            0,
            20160,
            20110,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_6672_kraken_proc_damage',
            'sequence_item_6672_kraken',
            1,
            20150,
            20111,
            'kraken_proc_condition',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_6672_kraken_hit_reset',
            'sequence_item_6672_kraken',
            2,
            20160,
            20110,
            'kraken_proc_condition',
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
            'step_item_6672_kraken_hit_add',
            20252,
            'kraken_hits',
            'kraken_hit_add',
            20170,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_6672_kraken_hit_reset',
            20252,
            'kraken_hits',
            'kraken_hit_reset',
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

    INSERT INTO public.damage_effect_details (
        game_id, step_id, amount_formula_key, damage_type_id, value_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_item_6672_kraken_proc_damage',
        'kraken_proc_damage',
        20220,
        20170,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        amount_formula_key = EXCLUDED.amount_formula_key,
        damage_type_id = EXCLUDED.damage_type_id,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.damage_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.damage_effect_details.damage_type_id IS DISTINCT FROM EXCLUDED.damage_type_id
       OR public.damage_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_item_6672_kraken',
        'provider_item_6672_kraken',
        'kraken_on_basic_attack_hit',
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
        (v_game_id, 'listener_item_6672_kraken', 20181, 20211, v_candidate, NOW()),
        (v_game_id, 'listener_item_6672_kraken', 20181, 20212, v_candidate, NOW())
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
        'listener_item_6672_kraken',
        'sequence_item_6672_kraken',
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
        'item_6672',
        'provider_item_6672_kraken',
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

    -- =========================================================================
    -- item_3124 鬼索首批：每次命中固定 30 魔法伤害（无叠层/幻影复击）
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_3124_guinsoos',
        20120,
        '鬼索的狂暴之刃 on-hit',
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

    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_3124_guinsoos',
        'guinsoos_on_hit_damage',
        '{"op":"const","value":30}'::jsonb,
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

    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_item_3124_guinsoos',
        'provider_item_3124_guinsoos',
        'guinsoos_on_hit',
        '鬼索命中结算',
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
        'step_item_3124_guinsoos_damage',
        'sequence_item_3124_guinsoos',
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
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_item_3124_guinsoos_damage',
        'guinsoos_on_hit_damage',
        20221,
        20170,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        amount_formula_key = EXCLUDED.amount_formula_key,
        damage_type_id = EXCLUDED.damage_type_id,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.damage_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.damage_effect_details.damage_type_id IS DISTINCT FROM EXCLUDED.damage_type_id
       OR public.damage_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_item_3124_guinsoos',
        'provider_item_3124_guinsoos',
        'guinsoos_on_basic_attack_hit',
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
        (v_game_id, 'listener_item_3124_guinsoos', 20181, 20211, v_candidate, NOW()),
        (v_game_id, 'listener_item_3124_guinsoos', 20181, 20212, v_candidate, NOW())
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
        'listener_item_3124_guinsoos',
        'sequence_item_3124_guinsoos',
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
        'item_3124',
        'provider_item_3124_guinsoos',
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

    -- =========================================================================
    -- 六个 ADC 普攻序列追加 emit_event（step_order=1；薇恩同稳定 ID 幂等）
    -- =========================================================================
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_vayne_basic_attack_emit_hit',
            'sequence_hero_vayne_basic_attack_damage',
            1,
            20158,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_teemo_basic_attack_emit_hit',
            'sequence_hero_teemo_basic_attack_damage',
            1,
            20158,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_varus_basic_attack_emit_hit',
            'sequence_hero_varus_basic_attack_damage',
            1,
            20158,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kaisa_basic_attack_emit_hit',
            'sequence_hero_kaisa_basic_attack_damage',
            1,
            20158,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_twitch_basic_attack_emit_hit',
            'sequence_hero_twitch_basic_attack_damage',
            1,
            20158,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kogmaw_basic_attack_emit_hit',
            'sequence_hero_kogmaw_basic_attack_damage',
            1,
            20158,
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

    INSERT INTO public.event_effect_details (
        game_id, step_id, event_type_id, event_ref, payload, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_vayne_basic_attack_emit_hit',
            20211,
            'event_ref_hero_vayne_basic_attack_hit',
            '{}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_teemo_basic_attack_emit_hit',
            20211,
            'event_ref_hero_teemo_basic_attack_hit',
            '{}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_varus_basic_attack_emit_hit',
            20211,
            'event_ref_hero_varus_basic_attack_hit',
            '{}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kaisa_basic_attack_emit_hit',
            20211,
            'event_ref_hero_kaisa_basic_attack_hit',
            '{}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_twitch_basic_attack_emit_hit',
            20211,
            'event_ref_hero_twitch_basic_attack_hit',
            '{}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kogmaw_basic_attack_emit_hit',
            20211,
            'event_ref_hero_kogmaw_basic_attack_hit',
            '{}'::jsonb,
            v_candidate,
            NOW()
        )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        event_type_id = EXCLUDED.event_type_id,
        event_ref = EXCLUDED.event_ref,
        payload = EXCLUDED.payload,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.event_effect_details.event_type_id IS DISTINCT FROM EXCLUDED.event_type_id
       OR public.event_effect_details.event_ref IS DISTINCT FROM EXCLUDED.event_ref
       OR public.event_effect_details.payload IS DISTINCT FROM EXCLUDED.payload;
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
