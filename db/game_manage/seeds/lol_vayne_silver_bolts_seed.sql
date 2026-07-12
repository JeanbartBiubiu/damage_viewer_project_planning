-- =============================================================================
-- LoL Vayne Silver Bolts (W) generic listener / effect-graph seed
-- =============================================================================
--
-- 目标：在 Batch-B 普攻闭环之上，幂等挂载薇恩 W 圣银弩箭被动：
--       普攻伤害后显式 emit event/basic_attack_hit；
--       独立 passive provider 以 ALL matcher 监听
--       event/basic_attack_hit + event/source_owner，
--       再按 provider_target 计数 / 条件真实伤害 / 重置。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进 current_revision。
-- 3. 必需 game / reserved_type / hero_vayne / Batch-B 普攻图 / hp attribute_definitions 缺失则抛异常回滚。
-- 4. 只追加 Vayne 普攻序列的 emit_event 步骤；不改动既有伤害步骤语义。
-- 5. 不自动 publish；不做 DELETE；不写凭据。
--
-- 前置：reserved_types_seed.sql；lol_batch_b_adc_entities_seed.sql（或等价 Batch-B 普攻图已存在）。

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
        20158, -- operation/emit_event
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20181, -- match_mode/all
        20211, -- event/basic_attack_hit
        20212, -- event/source_owner
        20213, -- event/source_opponent
        20222, -- damage/true
        20252  -- state_scope/provider_target
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_vayne_silver_bolts_seed: game_id=% missing in public.games',
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
            'lol_vayne_silver_bolts_seed: failed to lock game_data_state for %',
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
            'lol_vayne_silver_bolts_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'hp'
    ) THEN
        RAISE EXCEPTION
            'lol_vayne_silver_bolts_seed: missing attribute_definitions for game_id=% attr_key=hp',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_vayne'
    ) THEN
        RAISE EXCEPTION
            'lol_vayne_silver_bolts_seed: missing game_entities hero_vayne for game_id=%',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_hero_vayne_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_vayne_silver_bolts_seed: missing provider_hero_vayne_basic_attack (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.ability_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.ability_id = 'ability_hero_vayne_basic_attack'
           AND ad.provider_id = 'provider_hero_vayne_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_vayne_silver_bolts_seed: missing ability_hero_vayne_basic_attack (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.ability_phases ap
         WHERE ap.game_id = v_game_id
           AND ap.phase_id = 'phase_hero_vayne_basic_attack_impact'
           AND ap.ability_id = 'ability_hero_vayne_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_vayne_silver_bolts_seed: missing phase_hero_vayne_basic_attack_impact (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_sequences es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_hero_vayne_basic_attack_damage'
           AND es.provider_id = 'provider_hero_vayne_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_vayne_silver_bolts_seed: missing sequence_hero_vayne_basic_attack_damage (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_steps st
         WHERE st.game_id = v_game_id
           AND st.step_id = 'step_hero_vayne_basic_attack_damage'
           AND st.sequence_id = 'sequence_hero_vayne_basic_attack_damage'
           AND st.step_order = 0
    ) THEN
        RAISE EXCEPTION
            'lol_vayne_silver_bolts_seed: missing step_hero_vayne_basic_attack_damage order=0 (Batch-B prerequisite)';
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

    -- Silver Bolts passive provider（与普攻 provider 并存）
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_vayne_silver_bolts',
        20120,
        '薇恩 W 圣银弩箭',
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
        'provider_hero_vayne_silver_bolts',
        'silver_bolts_hits',
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
            'provider_hero_vayne_silver_bolts',
            'silver_bolts_hit_add',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_vayne_silver_bolts',
            'silver_bolts_proc_condition',
            '{"op":"gte","args":[{"op":"read","path":"provider.target_state.silver_bolts_hits"},{"op":"const","value":3}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_vayne_silver_bolts',
            'silver_bolts_proc_damage',
            '{"op":"max","args":[{"op":"mul","args":[{"op":"read","path":"$opponent.attr.hp.max"},{"op":"const","value":0.06}]},{"op":"const","value":50}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_vayne_silver_bolts',
            'silver_bolts_hit_reset',
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
        'sequence_hero_vayne_silver_bolts',
        'provider_hero_vayne_silver_bolts',
        'silver_bolts_on_hit',
        '圣银弩箭命中结算',
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

    -- 三步：计数 → 条件真实伤害 → 条件重置
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_vayne_silver_bolts_hit_add',
            'sequence_hero_vayne_silver_bolts',
            0,
            20160,
            20110,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_vayne_silver_bolts_proc_damage',
            'sequence_hero_vayne_silver_bolts',
            1,
            20150,
            20111,
            'silver_bolts_proc_condition',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_vayne_silver_bolts_hit_reset',
            'sequence_hero_vayne_silver_bolts',
            2,
            20160,
            20110,
            'silver_bolts_proc_condition',
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
    ) VALUES
        (
            v_game_id,
            'step_hero_vayne_silver_bolts_hit_add',
            20252,
            'silver_bolts_hits',
            'silver_bolts_hit_add',
            20170,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_vayne_silver_bolts_hit_reset',
            20252,
            'silver_bolts_hits',
            'silver_bolts_hit_reset',
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
        'step_hero_vayne_silver_bolts_proc_damage',
        'silver_bolts_proc_damage',
        20222,
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
        'listener_hero_vayne_silver_bolts',
        'provider_hero_vayne_silver_bolts',
        'silver_bolts_on_basic_attack_hit',
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
        (v_game_id, 'listener_hero_vayne_silver_bolts', 20181, 20211, v_candidate, NOW()),
        (v_game_id, 'listener_hero_vayne_silver_bolts', 20181, 20212, v_candidate, NOW())
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
        'listener_hero_vayne_silver_bolts',
        'sequence_hero_vayne_silver_bolts',
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
        'hero_vayne',
        'provider_hero_vayne_silver_bolts',
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

    -- 追加普攻序列 emit_event（step_order=1，位于既有伤害步骤之后）
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_vayne_basic_attack_emit_hit',
        'sequence_hero_vayne_basic_attack_damage',
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
    ) VALUES (
        v_game_id,
        'step_hero_vayne_basic_attack_emit_hit',
        20211,
        'event_ref_hero_vayne_basic_attack_hit',
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
