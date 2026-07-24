-- =============================================================================
-- LoL generic Quinn Q Blinding Assault primary-hit seed（奎因 Q 炫目攻势 Phase-A v1）
-- =============================================================================
--
-- 目标：在仓库既有 lol_generic_quinn_heightened_senses_seed.sql 已提供
--       hero_quinn / ad·mana 面板 / 通用普攻 provider / W Heightened Senses
--       provider 的前提下，挂载独立 Q provider/active ability Blinding Assault
--       primary champion hit：70 mana、9000ms CD、impact 对 opponent 恰好一次
--       physical damage =
--         205 + 1.00 * (source.attr.ad.resolved - source.attr.ad.base)
--           + 0.50 * source.attr.ap.resolved。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）。
--
-- 候选：hero_skill|hero_quinn|Q|炫目攻势
-- task key：wasm-generic-quinn-blinding-assault-primary-hit
-- FROZEN_PLAN_REV=quinn-q-blinding-assault-phase-a-v1
-- 已完成边界（completed / full boundary）：
--   rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_205_plus_1_00_bonus_ad_plus_0_50_ap; no_valor_projectile_travel_collision_geometry_aoe_monster_double_damage_harrier_mark_nearsight_disarm_or_other_ranks
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_physical_damage
--   3. ap_ratio
--   4. bonus_ad_ratio
--   5. immediate_impact_scaffold
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Hard prerequisites（fail-closed check-only，图写入前）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20220/20260；
--      - attribute_definitions(lol,{ad,mana,ap})——其中 ap 为 W seed 之外的 ambient 前置；
--      - game_entities(lol,hero_quinn)；
--      - entity_attribute_values(lol,hero_quinn,{ad,mana})；
--      - provider_definitions provider_hero_quinn_basic_attack；
--      - provider_definitions provider_hero_quinn_heightened_senses。
--    显式前置 seed：lol_generic_quinn_heightened_senses_seed.sql（hero_quinn、
--    ad/mana EAV、basic provider、W provider）。
-- 4. 最小中性写入（仅缺席时插入；永不 UPDATE 既有行）：
--      - entity_attribute_values(lol,hero_quinn,ap) base0，ON CONFLICT DO NOTHING；
--      - resource_definitions(lol,mana) 中性默认（法力 / 0/0），ON CONFLICT DO NOTHING；
--      - entity_resource_values(lol,hero_quinn,mana) 仅缺席时插入，initial/max 均从
--        同事务内既有 Quinn mana 属性 base_value 派生；ON CONFLICT DO NOTHING；
--        永不硬编码面板 mana 字面量。
--    允许 ensure 的共享行：reserved → game-local types 投影。
--    禁止改写：不对 games / game_entities / attribute_definitions /
--    entity_attribute_progressions 做 INSERT/UPDATE；不对既有 Quinn 身份/其它属性/
--    成长/普攻·W provider 图做 UPDATE/DELETE/重建。
-- 5. 仅 create/挂载 provider_hero_quinn_q_blinding_assault_primary_hit 及其隔离 Q 图：
--    一个 provider、一个 active ability、一个 cost、一个 cooldown、一个 null-duration
--    impact phase + on_enter link、一个 sequence/step、一个 physical damage detail、
--    一个 entity_provider_mounts。零 provider state / modifiers / listeners /
--    matchers / event-effect / repeat / control / emit_event 行。
-- 6. Accepted review note NB-ZERO-EMITTED-EVENTS-SCOPE：本 seeded Q provider 图无
--    emit_event 操作，故不能 emit basic_attack_hit；不试图压制运行时既有合成
--    ability_started 语义，亦不添加 listener/event workaround。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；canonical generic ABI 无 Valor / projectile / travel /
-- collision / geometry / AOE / monster-double / Harrier / nearsight / disarm 字段，
-- 故不编码这些表面，也不 claim 全保真）：
--   Valor 实体/AI；cast delay；direction / projectile / speed / travel /
--   collision / range / width / radius / geometry / AOE / multitarget；
--   monster double damage；Harrier mark / P / W interaction；
--   nearsight / disarm / sight / control / death persistence；
--   ranks 1–4；P / W / E / R / basic 行为；loadout / crit / on-hit；
--   live migration / publish / E2E / full fidelity。
--
-- 数值来源（League Wiki Template:Data Quinn/Q → resolved
-- Template:Data Quinn/Blinding Assault；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Quinn/Q
--   resolved page Template:Data Quinn/Blinding Assault
--   wiki pageId 1308954
--   revision id 4024766
--   revision timestamp 2026-06-03T00:49:42Z
--   canonical raw byte size 1742
--   canonical content SHA256
--     abce6abdc2eefd069beba2d4297a1c9da5b1a675a426edb747346d9679d8085d
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/quinn-q.json
--   siblings：pages/quinn-q.json
--   local raw materialization caveat（非源矛盾）：仓库 local raw 为
--     1742-byte materialization，SHA256
--     be8878560c7d6541440d952788e40aeba0bef25a49955379df26f45ec82737bd。
--     canonical 身份以 sidecar/pages 为准；本脚本不断言 local raw 等价，
--     亦不主张源矛盾。
--   rank-5 champion primary hit：physical 205 + 100% bonus AD + 50% AP；
--     mana 70；cooldown 9000ms。
--
-- 前置：reserved_types_seed.sql；lol_generic_quinn_heightened_senses_seed.sql；
--       ambient attribute_definitions(ap)。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-quinn-blinding-assault-primary-hit-phase-a-v1-20260724

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
    v_mana_attr          numeric;
    v_required_reserved  int[] := ARRAY[
        20111, -- selector/opponent
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20150, -- operation/damage
        20170, -- value_policy/add
        20220, -- damage/physical
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY['ad', 'mana', 'ap'];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_blinding_assault_primary_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_quinn_blinding_assault_primary_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_quinn_blinding_assault_primary_hit_seed: missing reserved_type id(s): %',
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
            'lol_generic_quinn_blinding_assault_primary_hit_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    -- W seed 显式前置：hero_quinn 身份
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_quinn'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_blinding_assault_primary_hit_seed: missing game_entities hero_quinn (prerequisite lol_generic_quinn_heightened_senses_seed.sql)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_quinn'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_blinding_assault_primary_hit_seed: missing entity_attribute_values hero_quinn/ad (prerequisite lol_generic_quinn_heightened_senses_seed.sql)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_quinn'
           AND eav.attr_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_blinding_assault_primary_hit_seed: missing entity_attribute_values hero_quinn/mana (prerequisite lol_generic_quinn_heightened_senses_seed.sql)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_hero_quinn_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_blinding_assault_primary_hit_seed: missing provider_hero_quinn_basic_attack (prerequisite lol_generic_quinn_heightened_senses_seed.sql)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_hero_quinn_heightened_senses'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_blinding_assault_primary_hit_seed: missing provider_hero_quinn_heightened_senses (prerequisite lol_generic_quinn_heightened_senses_seed.sql)';
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
    -- 最小中性写入：AP base0 / mana 资源定义 / mana 实体资源（派生自既有 mana 属性）
    -- 仅缺席插入；ON CONFLICT DO NOTHING；永不 UPDATE 既有 AP/resource 行
    -- =========================================================================
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_quinn',
        'ap',
        0,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id, attr_key) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.resource_definitions (
        game_id, resource_key, display_name,
        default_initial_value, default_max_value,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'mana',
        '法力',
        0,
        0,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, resource_key) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    SELECT eav.base_value
      INTO v_mana_attr
      FROM public.entity_attribute_values eav
     WHERE eav.game_id = v_game_id
       AND eav.entity_id = 'hero_quinn'
       AND eav.attr_key = 'mana';

    IF v_mana_attr IS NULL THEN
        RAISE EXCEPTION
            'lol_generic_quinn_blinding_assault_primary_hit_seed: hero_quinn/mana base_value unavailable for resource derivation';
    END IF;

    INSERT INTO public.entity_resource_values (
        game_id, entity_id, resource_key, initial_value, max_value,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_quinn',
        'mana',
        v_mana_attr,
        v_mana_attr,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id, resource_key) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- =========================================================================
    -- hero_quinn Blinding Assault primary-hit（Q rank-5）：独立 provider + active
    -- 单次物理伤害；不触碰 basic / Heightened Senses provider
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_quinn_q_blinding_assault_primary_hit',
        20120,
        '奎因 Q 炫目攻势 Blinding Assault primary-hit（Phase-A v1 rank5 主冠军目标）',
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

    -- nested binary add：compileGenericNode 仅接线 args[0]/args[1]，禁止三元 add
    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_hero_quinn_q_blinding_assault_primary_hit',
            'q_mana_cost',
            '{"op":"const","value":70}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_quinn_q_blinding_assault_primary_hit',
            'q_cooldown_ms',
            '{"op":"const","value":9000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_quinn_q_blinding_assault_primary_hit',
            'blinding_assault_damage',
            '{"op":"add","args":[{"op":"add","args":[{"op":"const","value":205},{"op":"mul","args":[{"op":"const","value":1.00},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]},{"op":"mul","args":[{"op":"const","value":0.50},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
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
        'ability_hero_quinn_q_blinding_assault_primary_hit',
        'provider_hero_quinn_q_blinding_assault_primary_hit',
        'blinding_assault_primary_hit',
        20130,
        '炫目攻势（Q）',
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

    INSERT INTO public.ability_costs (
        game_id, cost_id, ability_id, phase_id, resource_key,
        amount_formula_key, allow_partial, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'cost_hero_quinn_q_blinding_assault_primary_hit_mana',
        'ability_hero_quinn_q_blinding_assault_primary_hit',
        NULL,
        'mana',
        'q_mana_cost',
        false,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, cost_id) DO UPDATE SET
        ability_id = EXCLUDED.ability_id,
        phase_id = EXCLUDED.phase_id,
        resource_key = EXCLUDED.resource_key,
        amount_formula_key = EXCLUDED.amount_formula_key,
        allow_partial = EXCLUDED.allow_partial,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_costs.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.ability_costs.phase_id IS DISTINCT FROM EXCLUDED.phase_id
       OR public.ability_costs.resource_key IS DISTINCT FROM EXCLUDED.resource_key
       OR public.ability_costs.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.ability_costs.allow_partial IS DISTINCT FROM EXCLUDED.allow_partial;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_cooldowns (
        game_id, cooldown_id, ability_id, duration_formula_key,
        starts_on_phase_id, group_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'cooldown_hero_quinn_q_blinding_assault_primary_hit',
        'ability_hero_quinn_q_blinding_assault_primary_hit',
        'q_cooldown_ms',
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
        'phase_hero_quinn_q_blinding_assault_primary_hit_impact',
        'ability_hero_quinn_q_blinding_assault_primary_hit',
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
        'sequence_hero_quinn_q_blinding_assault_primary_hit_impact',
        'provider_hero_quinn_q_blinding_assault_primary_hit',
        'blinding_assault_impact',
        '炫目攻势 impact（主冠军目标单次物理伤害）',
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
        'step_hero_quinn_q_blinding_assault_primary_hit_damage',
        'sequence_hero_quinn_q_blinding_assault_primary_hit_impact',
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
        'step_hero_quinn_q_blinding_assault_primary_hit_damage',
        'blinding_assault_damage',
        20220,
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
        'phase_hero_quinn_q_blinding_assault_primary_hit_impact',
        20260,
        'sequence_hero_quinn_q_blinding_assault_primary_hit_impact',
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
        'hero_quinn',
        'provider_hero_quinn_q_blinding_assault_primary_hit',
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
