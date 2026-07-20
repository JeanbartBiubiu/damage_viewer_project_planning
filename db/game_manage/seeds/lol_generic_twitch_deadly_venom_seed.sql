-- =============================================================================
-- LoL generic Twitch P Deadly Venom seed（图奇 P 死亡毒液 / anchored tick）
-- =============================================================================
--
-- 目标：自包含 ensure hero_twitch 最低实体 + 通用普攻图（恰好一次
--       event/basic_attack_hit emit），并挂载独立被动
--       provider_hero_twitch_deadly_venom：
--       - provider_target 态 deadly_venom_stacks（max6 / 6000ms / refresh_on_write）
--       - source-owner basic_attack_hit listener（max_triggers_per_event=1）叠层 +1
--       - lifecycle tick_interval_ms=1000 / start_delay_ms=0，tick_anchor 成对字段
--         scope=state_scope/provider_target(20252) / state_key=deadly_venom_stacks
--       - on-tick 五条互斥等级段真实伤害（flat1..5 + 0.03*AP.resolved）* stacks
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / reserved_type / attribute_definitions(ad,ap) 缺失则 RAISE EXCEPTION。
-- 4. ensure hero_twitch / champion_level base+stages 1..18：若已存在则不覆盖权威值
--    （ON CONFLICT DO NOTHING）；普攻与被动 provider 并存/幂等复用稳定行。
-- 5. deadly_venom_stacks：number / max6 / 6000ms / refresh_duration(20190)；
--    不写 default_value（运行时缺省 0）；满层 add 仍刷新时长（既有 state-field 合同）。
-- 6. tick_anchor 成对：tick_anchor_scope_type_id=20252 且
--    tick_anchor_state_key='deadly_venom_stacks'（依赖 tick_anchor DDL 合同）。
-- 7. 伤害：true / copyable_on_hit=false / crit_eligible=false；game-local
--    damage_trait/dot(62004) + damage_trait/proc(62009) 挂到 tick damage steps。
--    不 invent poison/persistent reserved types。
-- 8. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不改 legacy DPS / Expunge /
--    Runaan / 多目标 / 建筑 / 隐身交互 / 英雄专用 runtime。
--
-- 数值权威（本地归档 League Wiki；非截图/OCR/DDragon）：
--   Twitch P / Template:Data Twitch/Deadly Venom revision 4013286
--   content SHA256 1567c0efec7f9e9021f6dc02410f92262dfa30128acc457c531199dbc9121b44
--
-- Wiki 合同（本脚本建模）：
--   普攻命中施加/刷新死亡毒液；上限 6；持续 6000ms；refresh_on_write。
--   每秒真实伤害：(flat(level) + 0.03 * source AP resolved) * stacks；
--   flat：1-4→1 / 5-8→2 / 9-12→3 / 13-16→4 / 17-18→5。
--
-- 前置：reserved_types_seed.sql；所需 attribute_definitions(ad,ap) 已存在；
--       provider_lifecycles tick_anchor 列已就绪（schema 或
--       generic_tick_anchor_compatibility_migration.sql）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-twitch-deadly-venom-v1-20260721

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
    v_conflict_type_key  text;
    v_existing_name      text;
    v_existing_reserved  integer;
    v_conflict_type_id   integer;
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20111, -- selector/opponent
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20150, -- operation/damage
        20158, -- operation/emit_event
        20160, -- operation/state_change
        20170, -- value_policy/add
        20181, -- match_mode/all
        20190, -- refresh_policy/refresh_duration
        20211, -- event/basic_attack_hit
        20212, -- event/source_owner
        20220, -- damage/physical
        20222, -- damage/true
        20252, -- state_scope/provider_target
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY['ad', 'ap'];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_twitch_deadly_venom_seed: game_id=% missing in public.games',
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
            'lol_generic_twitch_deadly_venom_seed: failed to lock game_data_state for %',
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
            'lol_generic_twitch_deadly_venom_seed: missing reserved_type id(s): %',
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
            'lol_generic_twitch_deadly_venom_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    -- reserved → game-local types
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
    -- game-local damage traits（dot / proc；不 invent poison/persistent）
    -- =========================================================================
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62004
       AND (
           t.type_key IS DISTINCT FROM 'damage_trait/dot'
           OR t.reserved_type_id IS DISTINCT FROM NULL
       );

    IF v_conflict_type_key IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_twitch_deadly_venom_seed: type_id=62004 already bound to type_key=% name=% reserved_type_id=% (expected damage_trait/dot, reserved_type_id=NULL)',
            v_conflict_type_key, v_existing_name, v_existing_reserved;
    END IF;

    SELECT t.type_id
      INTO v_conflict_type_id
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_key = 'damage_trait/dot'
       AND t.type_id IS DISTINCT FROM 62004;

    IF v_conflict_type_id IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_twitch_deadly_venom_seed: type_key=damage_trait/dot already bound to type_id=% (expected 62004)',
            v_conflict_type_id;
    END IF;

    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62004,
        'damage_trait/dot',
        'Damage over time trait',
        'Game-local damage trait tag for Deadly Venom tick damage.',
        NULL,
        v_candidate,
        NOW()
    )
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

    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62009
       AND (
           t.type_key IS DISTINCT FROM 'damage_trait/proc'
           OR t.reserved_type_id IS DISTINCT FROM NULL
       );

    IF v_conflict_type_key IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_twitch_deadly_venom_seed: type_id=62009 already bound to type_key=% name=% reserved_type_id=% (expected damage_trait/proc, reserved_type_id=NULL)',
            v_conflict_type_key, v_existing_name, v_existing_reserved;
    END IF;

    SELECT t.type_id
      INTO v_conflict_type_id
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_key = 'damage_trait/proc'
       AND t.type_id IS DISTINCT FROM 62009;

    IF v_conflict_type_id IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_twitch_deadly_venom_seed: type_key=damage_trait/proc already bound to type_id=% (expected 62009)',
            v_conflict_type_id;
    END IF;

    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62009,
        'damage_trait/proc',
        'Proc damage trait',
        'Game-local damage trait tag for Deadly Venom tick damage.',
        NULL,
        v_candidate,
        NOW()
    )
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
    -- ensure hero_twitch（不覆盖既有实体元数据）
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_twitch',
        '图奇',
        '瘟疫之源',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- 最低面板：仅缺失时写入，不覆盖权威既有值
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'hero_twitch', 'ad', 59, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'ap', 0, v_candidate, NOW())
    ON CONFLICT (game_id, entity_id, attr_key) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- champion_level：若缺则 ensure；已存在不覆盖权威值
    INSERT INTO public.attribute_definitions (
        game_id, attr_key, sort_order, attr_name, attr_type, default_value,
        value_kind, rate_target_attr_key, min_value, max_value,
        change_revision, updated_at
    ) VALUES (
        v_game_id, 'champion_level', 920, '英雄等级', 'number', 1,
        'scalar', NULL, 1, 18, v_candidate, NOW()
    )
    ON CONFLICT (game_id, attr_key) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES (
        v_game_id, 'hero_twitch', 'champion_level', 1, v_candidate, NOW()
    )
    ON CONFLICT (game_id, entity_id, attr_key) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_attribute_stage_values (
        game_id, entity_id, attr_key, stage, value, change_revision, updated_at
    )
    SELECT
        v_game_id,
        'hero_twitch',
        'champion_level',
        s.stage,
        s.stage::numeric,
        v_candidate,
        NOW()
      FROM generate_series(1, 18) AS s(stage)
    ON CONFLICT (game_id, entity_id, attr_key, stage) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- =========================================================================
    -- 自包含：通用 basic attack graph + 恰好一次 basic_attack_hit emit
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_twitch_basic_attack',
        20120,
        '图奇通用普攻',
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
        'provider_hero_twitch_basic_attack',
        'basic_attack_damage',
        '{"op":"read","path":"$owner.attr.ad"}'::jsonb,
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

    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_twitch_basic_attack',
        'provider_hero_twitch_basic_attack',
        'basic_attack',
        20130,
        '普攻',
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
        'phase_hero_twitch_basic_attack_impact',
        'ability_hero_twitch_basic_attack',
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
        'sequence_hero_twitch_basic_attack_damage',
        'provider_hero_twitch_basic_attack',
        'basic_attack_damage',
        '图奇普攻伤害',
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
        'step_hero_twitch_basic_attack_damage',
        'sequence_hero_twitch_basic_attack_damage',
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

    -- deferred exactly-one-detail pairing：damage detail 与 effect_steps 同事务
    INSERT INTO public.damage_effect_details (
        game_id, step_id, amount_formula_key, damage_type_id, value_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_twitch_basic_attack_damage',
        'basic_attack_damage',
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

    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_twitch_basic_attack_emit_hit',
        'sequence_hero_twitch_basic_attack_damage',
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
        'step_hero_twitch_basic_attack_emit_hit',
        20211,
        'event_ref_hero_twitch_basic_attack_hit',
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

    INSERT INTO public.ability_phase_effect_sequences (
        game_id, phase_id, trigger_type_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_twitch_basic_attack_impact',
        20260,
        'sequence_hero_twitch_basic_attack_damage',
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
        'hero_twitch',
        'provider_hero_twitch_basic_attack',
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
    -- Deadly Venom passive provider
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_twitch_deadly_venom',
        20120,
        '死亡毒液',
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

    -- deadly_venom_stacks：number / max6 / 6000ms / refresh_on_write(20190)；runtime 默认 0
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_twitch_deadly_venom',
        'deadly_venom_stacks',
        20100,
        6,
        6000,
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

    -- lifecycle：1000ms tick / start_delay 0；tick_anchor → provider_target.deadly_venom_stacks
    INSERT INTO public.provider_lifecycles (
        game_id, provider_id, duration_formula_key, max_stacks,
        refresh_policy_type_id, tick_interval_ms, start_delay_ms,
        tick_anchor_scope_type_id, tick_anchor_state_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_twitch_deadly_venom',
        NULL,
        1,
        NULL,
        1000,
        0,
        20252,
        'deadly_venom_stacks',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, provider_id) DO UPDATE SET
        duration_formula_key = EXCLUDED.duration_formula_key,
        max_stacks = EXCLUDED.max_stacks,
        refresh_policy_type_id = EXCLUDED.refresh_policy_type_id,
        tick_interval_ms = EXCLUDED.tick_interval_ms,
        start_delay_ms = EXCLUDED.start_delay_ms,
        tick_anchor_scope_type_id = EXCLUDED.tick_anchor_scope_type_id,
        tick_anchor_state_key = EXCLUDED.tick_anchor_state_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_lifecycles.duration_formula_key IS DISTINCT FROM EXCLUDED.duration_formula_key
       OR public.provider_lifecycles.max_stacks IS DISTINCT FROM EXCLUDED.max_stacks
       OR public.provider_lifecycles.refresh_policy_type_id IS DISTINCT FROM EXCLUDED.refresh_policy_type_id
       OR public.provider_lifecycles.tick_interval_ms IS DISTINCT FROM EXCLUDED.tick_interval_ms
       OR public.provider_lifecycles.start_delay_ms IS DISTINCT FROM EXCLUDED.start_delay_ms
       OR public.provider_lifecycles.tick_anchor_scope_type_id IS DISTINCT FROM EXCLUDED.tick_anchor_scope_type_id
       OR public.provider_lifecycles.tick_anchor_state_key IS DISTINCT FROM EXCLUDED.tick_anchor_state_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_hero_twitch_deadly_venom',
            'deadly_venom_stacks_add',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_twitch_deadly_venom',
            'deadly_venom_level_band_1_4',
            '{"op":"min","args":[{"op":"gte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":1}]},{"op":"lte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":4}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_twitch_deadly_venom',
            'deadly_venom_level_band_5_8',
            '{"op":"min","args":[{"op":"gte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":5}]},{"op":"lte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":8}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_twitch_deadly_venom',
            'deadly_venom_level_band_9_12',
            '{"op":"min","args":[{"op":"gte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":9}]},{"op":"lte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":12}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_twitch_deadly_venom',
            'deadly_venom_level_band_13_16',
            '{"op":"min","args":[{"op":"gte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":13}]},{"op":"lte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":16}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_twitch_deadly_venom',
            'deadly_venom_level_band_17_18',
            '{"op":"min","args":[{"op":"gte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":17}]},{"op":"lte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":18}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_twitch_deadly_venom',
            'deadly_venom_tick_damage_flat1',
            '{"op":"mul","args":[{"op":"add","args":[{"op":"const","value":1},{"op":"mul","args":[{"op":"const","value":0.03},{"op":"read","path":"$owner.attr.ap.resolved"}]}]},{"op":"read","path":"provider.target_state.deadly_venom_stacks"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_twitch_deadly_venom',
            'deadly_venom_tick_damage_flat2',
            '{"op":"mul","args":[{"op":"add","args":[{"op":"const","value":2},{"op":"mul","args":[{"op":"const","value":0.03},{"op":"read","path":"$owner.attr.ap.resolved"}]}]},{"op":"read","path":"provider.target_state.deadly_venom_stacks"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_twitch_deadly_venom',
            'deadly_venom_tick_damage_flat3',
            '{"op":"mul","args":[{"op":"add","args":[{"op":"const","value":3},{"op":"mul","args":[{"op":"const","value":0.03},{"op":"read","path":"$owner.attr.ap.resolved"}]}]},{"op":"read","path":"provider.target_state.deadly_venom_stacks"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_twitch_deadly_venom',
            'deadly_venom_tick_damage_flat4',
            '{"op":"mul","args":[{"op":"add","args":[{"op":"const","value":4},{"op":"mul","args":[{"op":"const","value":0.03},{"op":"read","path":"$owner.attr.ap.resolved"}]}]},{"op":"read","path":"provider.target_state.deadly_venom_stacks"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_twitch_deadly_venom',
            'deadly_venom_tick_damage_flat5',
            '{"op":"mul","args":[{"op":"add","args":[{"op":"const","value":5},{"op":"mul","args":[{"op":"const","value":0.03},{"op":"read","path":"$owner.attr.ap.resolved"}]}]},{"op":"read","path":"provider.target_state.deadly_venom_stacks"}]}'::jsonb,
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

    -- on-hit：叠层 +1（满层仍 refresh duration）
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_twitch_deadly_venom_on_hit',
        'provider_hero_twitch_deadly_venom',
        'deadly_venom_on_hit',
        '死亡毒液普攻叠层',
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
        'step_hero_twitch_deadly_venom_stacks_add',
        'sequence_hero_twitch_deadly_venom_on_hit',
        0,
        20160,
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

    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_twitch_deadly_venom_stacks_add',
        20252,
        'deadly_venom_stacks',
        'deadly_venom_stacks_add',
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

    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_hero_twitch_deadly_venom',
        'provider_hero_twitch_deadly_venom',
        'deadly_venom_on_basic_attack_hit',
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
        (v_game_id, 'listener_hero_twitch_deadly_venom', 20181, 20211, v_candidate, NOW()),
        (v_game_id, 'listener_hero_twitch_deadly_venom', 20181, 20212, v_candidate, NOW())
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
        'listener_hero_twitch_deadly_venom',
        'sequence_hero_twitch_deadly_venom_on_hit',
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

    -- on-tick：五条互斥等级段真实伤害
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_twitch_deadly_venom_tick',
        'provider_hero_twitch_deadly_venom',
        'deadly_venom_tick',
        '死亡毒液 tick 伤害',
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
            'step_hero_twitch_deadly_venom_tick_l1_4',
            'sequence_hero_twitch_deadly_venom_tick',
            0,
            20150,
            20111,
            'deadly_venom_level_band_1_4',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_twitch_deadly_venom_tick_l5_8',
            'sequence_hero_twitch_deadly_venom_tick',
            1,
            20150,
            20111,
            'deadly_venom_level_band_5_8',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_twitch_deadly_venom_tick_l9_12',
            'sequence_hero_twitch_deadly_venom_tick',
            2,
            20150,
            20111,
            'deadly_venom_level_band_9_12',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_twitch_deadly_venom_tick_l13_16',
            'sequence_hero_twitch_deadly_venom_tick',
            3,
            20150,
            20111,
            'deadly_venom_level_band_13_16',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_twitch_deadly_venom_tick_l17_18',
            'sequence_hero_twitch_deadly_venom_tick',
            4,
            20150,
            20111,
            'deadly_venom_level_band_17_18',
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
    ) VALUES
        (
            v_game_id,
            'step_hero_twitch_deadly_venom_tick_l1_4',
            'deadly_venom_tick_damage_flat1',
            20222,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_twitch_deadly_venom_tick_l5_8',
            'deadly_venom_tick_damage_flat2',
            20222,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_twitch_deadly_venom_tick_l9_12',
            'deadly_venom_tick_damage_flat3',
            20222,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_twitch_deadly_venom_tick_l13_16',
            'deadly_venom_tick_damage_flat4',
            20222,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_twitch_deadly_venom_tick_l17_18',
            'deadly_venom_tick_damage_flat5',
            20222,
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

    -- attach damage_trait/dot + damage_trait/proc to tick damage steps
    INSERT INTO public.type_relations (
        game_id, type_id, target_category, target_id, extend,
        change_revision, updated_at
    ) VALUES
        (v_game_id, 62004, 'effect_step', 'step_hero_twitch_deadly_venom_tick_l1_4',
         '{"role":"damage_trait"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62009, 'effect_step', 'step_hero_twitch_deadly_venom_tick_l1_4',
         '{"role":"damage_trait"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62004, 'effect_step', 'step_hero_twitch_deadly_venom_tick_l5_8',
         '{"role":"damage_trait"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62009, 'effect_step', 'step_hero_twitch_deadly_venom_tick_l5_8',
         '{"role":"damage_trait"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62004, 'effect_step', 'step_hero_twitch_deadly_venom_tick_l9_12',
         '{"role":"damage_trait"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62009, 'effect_step', 'step_hero_twitch_deadly_venom_tick_l9_12',
         '{"role":"damage_trait"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62004, 'effect_step', 'step_hero_twitch_deadly_venom_tick_l13_16',
         '{"role":"damage_trait"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62009, 'effect_step', 'step_hero_twitch_deadly_venom_tick_l13_16',
         '{"role":"damage_trait"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62004, 'effect_step', 'step_hero_twitch_deadly_venom_tick_l17_18',
         '{"role":"damage_trait"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62009, 'effect_step', 'step_hero_twitch_deadly_venom_tick_l17_18',
         '{"role":"damage_trait"}'::jsonb, v_candidate, NOW())
    ON CONFLICT (game_id, type_id, target_category, target_id) DO UPDATE SET
        extend = EXCLUDED.extend,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.type_relations.extend IS DISTINCT FROM EXCLUDED.extend;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.provider_tick_sequences (
        game_id, provider_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_twitch_deadly_venom',
        'sequence_hero_twitch_deadly_venom_tick',
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
        'hero_twitch',
        'provider_hero_twitch_deadly_venom',
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
