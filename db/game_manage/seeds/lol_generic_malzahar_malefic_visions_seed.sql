-- =============================================================================
-- LoL generic Malzahar E Malefic Visions seed（恶咒降临 / anchored DoT Phase-A）
-- =============================================================================
--
-- 目标：自包含 ensure hero_malzahar，并挂载独立
--       provider_hero_malzahar_malefic_visions：
--       - active malefic_visions：rank5 mana100 / CD7000ms；impact 仅一步
--         state_change override=1 → provider_target.malefic_visions_active
--         （无施法直伤）
--       - provider_target 态 malefic_visions_active（max1 / 4000ms /
--         refresh_on_write 20190；不写 default_value，运行时缺省 0）
--       - lifecycle tick_interval_ms=250 / start_delay_ms=0，tick_anchor 成对
--         scope=state_scope/provider_target(20252) /
--         state_key=malefic_visions_active
--       - on-tick 单条魔法伤害 13.75 + 0.05 * $owner.attr.ap.resolved
--         （非暴击、不可复制；挂既有 damage_trait/dot）
--
-- 候选：hero_skill|hero_malzahar|E|恶咒降临
-- 本任务冻结边界：Phase-A rank-5 anchored DoT（FROZEN_PLAN_REV=
--   malzahar-e-anchored-dot-phase-a-v2）。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / reserved_type / attribute_definitions 缺失则 RAISE EXCEPTION。
-- 4. ensure hero_malzahar（ON CONFLICT DO NOTHING，不覆盖既有实体元数据）+
--    level-1 面板 + mana 资源；仅 mount provider_hero_malzahar_malefic_visions。
-- 5. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    skill_malzahar_e / status 表 / Batch-J JSON / schedule_tick。
--
-- Phase-A 合同（Wiki rank5）：
--   mana 100；cooldown 7000ms；16 magic ticks every 250ms through 4000ms
--   inclusive；per tick 13.75 + 0.05*AP；total 220 + 0.80*AP。
--   lifecycle 字段显式为 tick_interval_ms=250 / start_delay_ms=0。
--
-- 已完成边界（本脚本建模）：
--   施法写态 + anchored tick 魔法 DoT；cost/CD；独立 E provider mount。
--
-- 明确排除（仅注释；不建可执行行）：
--   Q/R 刷新；死亡扩散/弹跳/最近敌人/多目标/半径；2% 最大法力回复；
--   小兵斩杀/小兵/野怪；净化/可驱散性/免疫；indirect/spell-effect 标签；
--   ranks1-4；施法时间/射程/目标选择；持续期间中途 AP 快照变化；
--   live migration / publish / E2E / full fidelity。
--   Batch-J 历史 tick_damage+1.0AP / 1000ms / rank1 5.6 不得复制。
--
-- 数值权威（本地归档 League Wiki；非截图/OCR；E 机制不以 DDragon 为真理）：
--   request：Template:Data Malzahar/E
--   resolved：Template:Data Malzahar/Malefic Visions
--   wikiPageId 1308233 / revision 4015185 /
--   timestamp 2026-05-03T16:59:57Z
--   upstream LF bytes 2228 /
--   content SHA256 9098ee2fbe7dfb33d1ca375bbce0c68788fd60378780aa4ddab8afc46736ba84
--   数据参考/lol-wiki-extra-mechanisms/normalized/generic/malzahar-e.json
--
-- 英雄 level-1 面板（自包含 bootstrap；与 E Wiki 数值真理分离；
-- 不作 E 完成证据；不 invent / 不 claim Module content hash）：
--   hp580 mana375 ad55 ap0 AS0.625 armor18 MR30 hpregen6 manaregen8。
--
-- 前置：reserved_types_seed.sql；所需 attribute_definitions 已存在；
--       provider_lifecycles tick_anchor 列已就绪（schema 或
--       generic_tick_anchor_compatibility_migration.sql）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-malzahar-malefic-visions-v1-20260721

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
    v_conflict_types     text;
    v_conflict_provider  text;
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
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20190, -- refresh_policy/refresh_duration (refresh_on_write)
        20221, -- damage/magic
        20252, -- state_scope/provider_target
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY[
        'hp', 'mana', 'ad', 'ap', 'attack_speed', 'armor', 'magic_resist',
        'hp_regen', 'mana_regen'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_malzahar_malefic_visions_seed: game_id=% missing in public.games',
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
            'lol_generic_malzahar_malefic_visions_seed: failed to lock game_data_state for %',
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
            'lol_generic_malzahar_malefic_visions_seed: missing reserved_type id(s): %',
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
            'lol_generic_malzahar_malefic_visions_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    -- reserved → game-local types（身份冲突 fail-closed；正确既有绑定 DO NOTHING）
    SELECT string_agg(
               format(
                   'type_id=%s type_key=%s reserved_type_id=%s (expected type_key=%s reserved_type_id=%s)',
                   t.type_id,
                   t.type_key,
                   t.reserved_type_id,
                   rt.type_key,
                   rt.type_id
               ),
               '; ' ORDER BY t.type_id
           )
      INTO v_conflict_types
      FROM public.types t
      JOIN public.reserved_type rt
        ON rt.type_id = t.type_id
     WHERE t.game_id = v_game_id
       AND t.type_id = ANY (v_required_reserved)
       AND (
           t.type_key IS DISTINCT FROM rt.type_key
           OR t.reserved_type_id IS DISTINCT FROM rt.type_id
       );

    IF v_conflict_types IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_malzahar_malefic_visions_seed: conflicting types by type_id: %',
            v_conflict_types;
    END IF;

    SELECT string_agg(
               format(
                   'type_key=%s type_id=%s reserved_type_id=%s (expected type_id=%s reserved_type_id=%s)',
                   t.type_key,
                   t.type_id,
                   t.reserved_type_id,
                   rt.type_id,
                   rt.type_id
               ),
               '; ' ORDER BY t.type_key
           )
      INTO v_conflict_types
      FROM public.types t
      JOIN public.reserved_type rt
        ON rt.type_key = t.type_key
     WHERE t.game_id = v_game_id
       AND rt.type_id = ANY (v_required_reserved)
       AND (
           t.type_id IS DISTINCT FROM rt.type_id
           OR t.reserved_type_id IS DISTINCT FROM rt.type_id
       );

    IF v_conflict_types IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_malzahar_malefic_visions_seed: conflicting types by type_key: %',
            v_conflict_types;
    END IF;

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
    ON CONFLICT (game_id, type_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- game-local damage_trait/dot（既有规范；不 invent indirect/spell-effect）
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
            'lol_generic_malzahar_malefic_visions_seed: type_id=62004 already bound to type_key=% name=% reserved_type_id=% (expected damage_trait/dot, reserved_type_id=NULL)',
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
            'lol_generic_malzahar_malefic_visions_seed: type_key=damage_trait/dot already bound to type_id=% (expected 62004)',
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
        'Game-local damage trait tag for Malefic Visions tick damage.',
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

    -- fail-closed：稳定 ability_id 不得被其它 provider 占用
    SELECT ad.provider_id
      INTO v_conflict_provider
      FROM public.ability_definitions ad
     WHERE ad.game_id = v_game_id
       AND ad.ability_id = 'ability_hero_malzahar_e_malefic_visions'
       AND ad.provider_id IS DISTINCT FROM 'provider_hero_malzahar_malefic_visions'
     LIMIT 1;

    IF v_conflict_provider IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_malzahar_malefic_visions_seed: ability_id already bound to provider_id=% (expected provider_hero_malzahar_malefic_visions)',
            v_conflict_provider;
    END IF;

    -- =========================================================================
    -- 自包含 ensure：hero_malzahar 基线实体（已存在则不覆盖 display/description）
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_malzahar',
        '玛尔扎哈',
        '玛尔扎哈 / Malzahar（Malefic Visions seed 自包含基线）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- level-1 面板（bootstrap；与 E Wiki 真理分离）
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'hero_malzahar', 'hp', 580, v_candidate, NOW()),
        (v_game_id, 'hero_malzahar', 'mana', 375, v_candidate, NOW()),
        (v_game_id, 'hero_malzahar', 'ad', 55, v_candidate, NOW()),
        (v_game_id, 'hero_malzahar', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'hero_malzahar', 'attack_speed', 0.625, v_candidate, NOW()),
        (v_game_id, 'hero_malzahar', 'armor', 18, v_candidate, NOW()),
        (v_game_id, 'hero_malzahar', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_malzahar', 'hp_regen', 6, v_candidate, NOW()),
        (v_game_id, 'hero_malzahar', 'mana_regen', 8, v_candidate, NOW())
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
    -- hero_malzahar Malefic Visions（E rank-5 Phase-A）：provider + 态 + 主动 + tick
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_malzahar_malefic_visions',
        20120,
        '玛尔扎哈 E 恶咒降临 Malefic Visions（rank5 anchored DoT）',
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

    -- malefic_visions_active：number / max1 / 4000ms / refresh_on_write；
    -- 不写 default_value（运行时缺省 0）
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_malzahar_malefic_visions',
        'malefic_visions_active',
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

    -- lifecycle：250ms tick / start_delay 0；tick_anchor → provider_target.malefic_visions_active
    INSERT INTO public.provider_lifecycles (
        game_id, provider_id, duration_formula_key, max_stacks,
        refresh_policy_type_id, tick_interval_ms, start_delay_ms,
        tick_anchor_scope_type_id, tick_anchor_state_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_malzahar_malefic_visions',
        NULL,
        1,
        NULL,
        250,
        0,
        20252,
        'malefic_visions_active',
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
            'provider_hero_malzahar_malefic_visions',
            'e_mana_cost',
            '{"op":"const","value":100}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_malzahar_malefic_visions',
            'e_cooldown_ms',
            '{"op":"const","value":7000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_malzahar_malefic_visions',
            'malefic_visions_arm',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_malzahar_malefic_visions',
            'malefic_visions_tick_damage',
            '{"op":"add","args":[{"op":"const","value":13.75},{"op":"mul","args":[{"op":"const","value":0.05},{"op":"read","path":"$owner.attr.ap.resolved"}]}]}'::jsonb,
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
        'ability_hero_malzahar_e_malefic_visions',
        'provider_hero_malzahar_malefic_visions',
        'malefic_visions',
        20130,
        '恶咒降临（E）',
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


    INSERT INTO public.ability_cooldowns (
        game_id, cooldown_id, ability_id, duration_formula_key,
        starts_on_phase_id, group_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'cooldown_hero_malzahar_e_malefic_visions',
        'ability_hero_malzahar_e_malefic_visions',
        'e_cooldown_ms',
        NULL,
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, cooldown_id) DO UPDATE SET
        ability_id = EXCLUDED.ability_id,
        duration_formula_key = EXCLUDED.duration_formula_key,
        starts_on_phase_id = EXCLUDED.starts_on_phase_id,
        group_key = EXCLUDED.group_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_cooldowns.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.ability_cooldowns.duration_formula_key IS DISTINCT FROM EXCLUDED.duration_formula_key
       OR public.ability_cooldowns.starts_on_phase_id IS DISTINCT FROM EXCLUDED.starts_on_phase_id
       OR public.ability_cooldowns.group_key IS DISTINCT FROM EXCLUDED.group_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_malzahar_e_malefic_visions_impact',
        'ability_hero_malzahar_e_malefic_visions',
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

    -- cast impact：仅 state_change（无直伤）；deferred exactly-one-detail pairing
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_malzahar_e_malefic_visions_impact',
        'provider_hero_malzahar_malefic_visions',
        'malefic_visions_impact',
        '恶咒降临 impact（仅写态）',
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
        'step_hero_malzahar_e_malefic_visions_apply',
        'sequence_hero_malzahar_e_malefic_visions_impact',
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
        'step_hero_malzahar_e_malefic_visions_apply',
        20252,
        'malefic_visions_active',
        'malefic_visions_arm',
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
        'phase_hero_malzahar_e_malefic_visions_impact',
        20260,
        'sequence_hero_malzahar_e_malefic_visions_impact',
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

    -- on-tick：恰好一条魔法伤害
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_malzahar_malefic_visions_tick',
        'provider_hero_malzahar_malefic_visions',
        'malefic_visions_tick',
        '恶咒降临 tick 魔法伤害',
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
        'step_hero_malzahar_malefic_visions_tick_damage',
        'sequence_hero_malzahar_malefic_visions_tick',
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
        'step_hero_malzahar_malefic_visions_tick_damage',
        'malefic_visions_tick_damage',
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

    INSERT INTO public.type_relations (
        game_id, type_id, target_category, target_id, extend,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62004,
        'effect_step',
        'step_hero_malzahar_malefic_visions_tick_damage',
        '{"role":"damage_trait"}'::jsonb,
        v_candidate,
        NOW()
    )
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
        'provider_hero_malzahar_malefic_visions',
        'sequence_hero_malzahar_malefic_visions_tick',
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
        'hero_malzahar',
        'provider_hero_malzahar_malefic_visions',
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
