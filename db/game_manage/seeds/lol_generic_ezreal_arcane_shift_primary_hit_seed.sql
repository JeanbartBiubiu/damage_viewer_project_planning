-- =============================================================================
-- LoL generic Ezreal E Arcane Shift primary-hit seed（探险家 E 奥术跃迁 Phase-A v3）
-- =============================================================================
--
-- 目标：在外部既有 hero_ezreal / ad / ap / mana 数据已存在的前提下，挂载独立 E
--       provider/active ability Arcane Shift primary champion hit：70 mana、
--       14000ms CD、impact 对 opponent（champion）恰好一次 magic damage =
--       280 + 0.60 * (source.attr.ad.resolved - source.attr.ad.base)
--         + 0.75 * source.attr.ap.resolved。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）。Immediate impact 为 Phase-A scaffold。
--       伤害公式必须为嵌套二元 add（外层 add(内层 add(base, bonusAD), AP)），
--       永不复制历史 Ezreal R 三元 add。
--
-- 候选：hero_skill|hero_ezreal|E|奥术跃迁
-- task key：wasm-generic-ezreal-arcane-shift-primary-hit
-- FROZEN_PLAN_REV=ezreal-e-arcane-shift-primary-hit-phase-a-v3
-- 已完成边界（completed / full boundary）：
--   rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_magic_damage
--   3. bonus_ad_ratio
--   4. ap_ratio
--   5. immediate_impact_scaffold
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20221/20260；
--      - game_entities(lol,hero_ezreal)；
--      - attribute_definitions(lol,ad) 与 (lol,ap)；
--      - entity_attribute_values(lol,hero_ezreal,ad) 与 (lol,hero_ezreal,ap)；
--    hero_ezreal 是与较旧 Rising Spell Force / Trueshot Barrage seeds 共享的外部
--    既有数据依赖；当前仓库没有任何 seed 物化 Ezreal 身份 / ad / ap / mana 行；
--    本脚本亦不物化身份/面板/资源值。勿用 Batch-B 前置依赖一类措辞描述该实体。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
-- 5. 仅创建/挂载 provider_hero_ezreal_e_arcane_shift_primary_hit 及其隔离 E 图：
--    一个 provider、一个 active ability、一个 cost、一个 cooldown、一个 null-duration
--    impact phase + on_enter link、一个 sequence/step、一个 magic damage detail、
--    一个 entity_provider_mounts。零 provider state / modifiers / listeners /
--    matchers / event-effect / repeat / control / projectile / AOE / blink /
--    movement 行。
-- 6. 保留且永不更新/删除/重建 provider_hero_ezreal_rising_spell_force 与
--    provider_hero_ezreal_r_trueshot_barrage_primary_hit；不创建/突变 Q/W。
--    成功非普攻 E cast 可参与既有自动 ability_started 表面（Rising Spell Force
--    叠一层），本 E 图不添加 listener 行。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog；
--    不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；canonical generic ABI 无 blink / displacement /
-- location / range / cast-time / terrain / geometry / direction / homing /
-- visibility / Essence Flux / projectile / travel / reveal 字段，故不编码这些
-- 表面，也不 claim 全保真）：
--   blink / displacement / location / range / cast time / terrain / geometry /
--   direction；
--   homing / nearest-enemy / visibility / unseen / Essence Flux priority or
--   detonation；
--   projectile / travel / collision / interception / spell shield / reveal；
--   miss / cancel / death；multitarget / minions / monsters；ranks 1–4；
--   P cap / expiry / refresh beyond coexistence；Q / W / R / basic；
--   equipment / runes / loadout / crit / on-hit；
--   identity / base-stat bootstrap；listener / state / event / modifier /
--   repeat / control / projectile / AOE / movement detail；
--   live migration；自动 publish；E2E；full fidelity。
--
-- 数值来源（League Wiki Template:Data Ezreal/E → resolved
-- Template:Data Ezreal/Arcane Shift；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Ezreal/E
--   resolved page Template:Data Ezreal/Arcane Shift
--   wiki pageId 1307111
--   revision id 3989862
--   revision timestamp 2026-02-03T23:19:20Z
--   canonical raw byte size 1661
--   canonical content SHA256
--     7ac83f7eaa237641c478f2e3ffa1a2714f7da0644c8a488ab6a6f47b67e27347
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/ezreal-e.json
--   siblings：pages/ezreal-e.json
--   local raw materialization caveat（非源矛盾）：仓库 local raw 为
--     1661-byte materialization，SHA256
--     f48a32706234b0c1ef1abab4b7f90e4ee88944623827fb22a41e23bdfac01792。
--     canonical 身份以 sidecar/pages 为准；本脚本不断言 local raw 等价，
--     亦不主张源矛盾。
--   rank-5 champion primary hit：magic 280 + 60% bonus AD + 75% AP；
--     mana 70；cooldown 14000ms。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_ezreal + ad/ap 属性定义与实体值 +
--       mana 资源定义与实体资源值（check-only）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-ezreal-arcane-shift-primary-hit-phase-a-v3-20260724

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
        20111, -- selector/opponent
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20150, -- operation/damage
        20170, -- value_policy/add
        20221, -- damage/magic
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY['ad', 'ap'];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_ezreal_arcane_shift_primary_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_ezreal_arcane_shift_primary_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_ezreal_arcane_shift_primary_hit_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_ezreal（与 Rising Spell Force / Trueshot Barrage
    -- seeds 共享；非本仓库物化；非 Batch-B bootstrap claim）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_ezreal'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_ezreal_arcane_shift_primary_hit_seed: missing game_entities hero_ezreal (external existing-data dependency; not materialized by a current repository seed)';
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
            'lol_generic_ezreal_arcane_shift_primary_hit_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_ezreal'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_ezreal_arcane_shift_primary_hit_seed: missing entity_attribute_values hero_ezreal/ad (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_ezreal'
           AND eav.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_ezreal_arcane_shift_primary_hit_seed: missing entity_attribute_values hero_ezreal/ap (external existing-data; check-only)';
    END IF;



    -- reserved → game-local types（同 ID / 同 type_key / reserved_type_id=type_id）
    -- 本 seed 唯一允许 ensure 的共享行；不物化身份/面板/资源值
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
    -- hero_ezreal Arcane Shift primary-hit（E rank-5）：独立 provider + active impact
    -- 单次魔法伤害；不触碰 Rising Spell Force / Trueshot Barrage / Q / W
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_ezreal_e_arcane_shift_primary_hit',
        20120,
        '探险家 E 奥术跃迁 Arcane Shift primary-hit（Phase-A v3 rank5 主冠军目标）',
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
    ) VALUES
        (
            v_game_id,
            'provider_hero_ezreal_e_arcane_shift_primary_hit',
            'e_mana_cost',
            '{"op":"const","value":70}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ezreal_e_arcane_shift_primary_hit',
            'e_cooldown_ms',
            '{"op":"const","value":14000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ezreal_e_arcane_shift_primary_hit',
            'arcane_shift_damage',
            '{"op":"add","args":[{"op":"add","args":[{"op":"const","value":280},{"op":"mul","args":[{"op":"const","value":0.60},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]},{"op":"mul","args":[{"op":"const","value":0.75},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
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
        'ability_hero_ezreal_e_arcane_shift_primary_hit',
        'provider_hero_ezreal_e_arcane_shift_primary_hit',
        'arcane_shift_primary_hit',
        20130,
        '奥术跃迁（E）',
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
        'cooldown_hero_ezreal_e_arcane_shift_primary_hit',
        'ability_hero_ezreal_e_arcane_shift_primary_hit',
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

    -- null-duration impact phase：assembler 产出一次立即 operation（Phase-A scaffold）
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_ezreal_e_arcane_shift_primary_hit_impact',
        'ability_hero_ezreal_e_arcane_shift_primary_hit',
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
        'sequence_hero_ezreal_e_arcane_shift_primary_hit_impact',
        'provider_hero_ezreal_e_arcane_shift_primary_hit',
        'arcane_shift_impact',
        '奥术跃迁 impact（主冠军目标单次魔法伤害）',
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
        'step_hero_ezreal_e_arcane_shift_primary_hit_damage',
        'sequence_hero_ezreal_e_arcane_shift_primary_hit_impact',
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
        copyable_on_hit, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_ezreal_e_arcane_shift_primary_hit_damage',
        'arcane_shift_damage',
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

    INSERT INTO public.ability_phase_effect_sequences (
        game_id, phase_id, trigger_type_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_ezreal_e_arcane_shift_primary_hit_impact',
        20260,
        'sequence_hero_ezreal_e_arcane_shift_primary_hit_impact',
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
        'hero_ezreal',
        'provider_hero_ezreal_e_arcane_shift_primary_hit',
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
