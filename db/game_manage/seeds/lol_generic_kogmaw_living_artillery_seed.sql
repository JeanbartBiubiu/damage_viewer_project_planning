-- =============================================================================
-- LoL generic Kog'Maw R Living Artillery seed（克格莫 R 活体大炮 Phase-A v2）
-- =============================================================================
--
-- 目标：在 Batch-B 已提供 hero_kogmaw 身份/面板（含 hp/ad/ap/mana/magic_resist）
--       且 mana 资源定义/实体资源行已存在的前提下，挂载独立 R provider/active
--       ability Living Artillery：动态 mana 成本
--       40 * (1 + provider.state.living_artillery_stacks)、1000ms CD、impact 对
--       opponent 恰好一次 magic damage（base 180 + 0.75 bonus AD + 0.45 AP，乘以
--       missing-health exact multiplier），随后对 source provider state
--       living_artillery_stacks 做 add const1（max9 / 8000ms / refresh_on_write）。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 有序两步：damage → state_change）；零 listener 行；不依赖
--       event/ability_started 或 event/source_owner scaffold。
--
-- 候选：hero_skill|hero_kogmaw|R|活体大炮
-- task key：wasm-generic-kogmaw-living-artillery
-- FROZEN_PLAN_REV=kogmaw-r-living-artillery-phase-a-v2
-- 已完成边界（completed / full boundary）：
--   rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_magic_damage
--   3. bonus_ad_and_ap_ratio
--   4. missing_health_damage_multiplier
--   5. stack_escalating_mana_cost
--   6. timed_provider_state
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Hard prerequisites（fail-closed check-only）：reserved_types_seed.sql 与
--    仓库自有 lol_batch_b_adc_entities_seed.sql，以及既有 mana 资源行。缺失则
--    RAISE EXCEPTION 回滚：
--      - game lol；
--      - 所需 reserved types：
--        20100/20110/20111/20120/20130/20142/20150/20160/20170/20190/20221/
--        20250/20260；
--      - game_entities(lol,hero_kogmaw)；
--      - attribute_definitions(lol,{hp,ad,ap,mana,magic_resist})；
--      - entity_attribute_values(lol,hero_kogmaw,{hp,ad,ap,mana,magic_resist})；
--      - resource_definitions(lol,mana)；
--      - entity_resource_values(lol,hero_kogmaw,mana)。
--    Batch-B 提供稳定 Kog'Maw 面板基线，但 **不** 创建 resource 表。mana 资源
--    行可由既有 Caustic Spittle / Void Ooze 等 seed 提供；本脚本 check-only，
--    不 ensure / 不改写。Kog'Maw basic / Bio-Arcane Barrage / Caustic Spittle /
--    Void Ooze **不是** 硬前置；若其 provider 已存在则字节级/行级保留。
-- 4. 禁止写入：不对 games / game_entities / attribute_definitions /
--    entity_attribute_values / resource_definitions / entity_resource_values /
--    entity_attribute_progressions 做 INSERT/UPDATE/DELETE（不改写 Batch-B
--    Kog'Maw 身份/面板/成长行，亦不改写既有 mana 资源）。允许 ensure：
--      - reserved → game-local types 投影。
-- 5. 仅 create/挂载 provider_hero_kogmaw_r_living_artillery 及其隔离 R 图：
--    一个 provider、一个 timed provider state、一个 active ability、一个动态
--    cost、一个 cooldown、一个 null-duration impact phase + on_enter link、
--    一个 sequence、恰好两个有序 steps（damage → state_change add）、对应
--    damage_effect_details + state_effect_details。永不更新/删除/重建
--    provider_hero_kogmaw_basic_attack、provider_hero_kogmaw_bio_arcane_barrage、
--    provider_hero_kogmaw_caustic_spittle、
--    provider_hero_kogmaw_e_void_ooze_primary_hit 及其
--    mount/listener/state/ability/phase/sequence/step/detail。
-- 6. 本 R provider 创建零 provider_listeners / listener_match_types /
--    listener_effect_sequences 行；零 event/ability_started(20205) /
--    event/source_owner(20212) scaffold 依赖。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；canonical generic ABI 无 0.6s landing delay /
-- location / range / radius / projectile / arc / collision / travel / area /
-- multitarget / sight / reveal / stealth 字段，故不编码这些表面，也不 claim
-- 全保真；这些是 exclusions，不是 approximations 或 remaining blockers）：
--   0.6s landing delay；target-location / range / radius / projectile / arc /
--   collision / travel / area geometry；multi-target；sight / reveal / stealth；
--   ranks1–2；P/Q/W/E/basic/combos；equipment/runes/loadout；spell shield；
--   animation；ability_started / source_owner listener scaffold；
--   live migration / publish / browser E2E / full-game fidelity。
--
-- 数值来源（League Wiki Template:Data Kog'Maw/R → resolved
-- Template:Data Kog'Maw/Living Artillery；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon 数值溯源）：
--   request Template:Data Kog'Maw/R
--   resolved page Template:Data Kog'Maw/Living Artillery
--   wiki pageId 1307963
--   revision id 4007636
--   revision timestamp 2026-04-12T08:34:32Z
--   canonical raw byte size 2453
--   canonical content SHA256
--     32f8dd8d875aaf95cec2be9cfe4a5a5526881b956f2f23e06ab87dc331ca8641
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/kogmaw-r.json
--   siblings：pages/kogmaw-r.json
--   local raw materialization caveat（非源矛盾）：仓库 local raw 为非规范
--     2452-byte materialization，SHA256
--     11db6c16391dcbfa2c091e81399bff4b2a0abffcd468f71ea5e9d89759d5e447。
--     canonical 身份以 sidecar/pages 为准；本脚本不断言 local raw 等价，
--     亦不主张源矛盾。
--   rank-3：cooldown 1000ms；dynamic mana 40*(1+stacks)；stacks max9 / 8000ms /
--     refresh_on_write；base magic 180 + 0.75 bonus AD + 0.45 AP；
--     missing-health multiplier：hp_ratio=clamp(current/max(1,max),0,1)；
--     missing_ratio=max(0,1-hp_ratio)；
--     normal=1+min(0.5,(5/6)*missing_ratio)；
--     exact=lt(hp_ratio,0.4)*2 + gte(hp_ratio,0.4)*normal；
--     Exactly40% HP → 1.5；strictly below40% → 2。
--   provider.state.living_artillery_stacks：文档契约 explicit default0 / max9 /
--     duration8000ms / refresh_on_write（schema 无 default_value 列；运行时缺省 0）。
--
-- 前置：reserved_types_seed.sql；lol_batch_b_adc_entities_seed.sql（Batch-B
--       hero_kogmaw + hp/ad/ap/mana/magic_resist）；既有 mana 资源行
--       （check-only；可由 Caustic Spittle / Void Ooze 等提供）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-kogmaw-living-artillery-phase-a-v2-20260723

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
    v_missing_entity_attrs text;
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
        20190, -- refresh_policy/refresh_duration
        20221, -- damage/magic
        20250, -- state_scope/provider
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY[
        'hp', 'ad', 'ap', 'mana', 'magic_resist'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_kogmaw_living_artillery_seed: game_id=% missing in public.games',
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
            'lol_generic_kogmaw_living_artillery_seed: failed to lock game_data_state for %',
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
            'lol_generic_kogmaw_living_artillery_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：Batch-B 必须已提供 hero_kogmaw（本脚本不写 game_entities）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_kogmaw'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kogmaw_living_artillery_seed: missing game_entities hero_kogmaw (Batch-B prerequisite lol_batch_b_adc_entities_seed.sql; check-only)';
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
            'lol_generic_kogmaw_living_artillery_seed: missing attribute_definitions for game_id=% attr_key(s): % (Batch-B prerequisite; check-only)',
            v_game_id, v_missing_attrs;
    END IF;

    SELECT string_agg(req.attr_key, ', ' ORDER BY req.attr_key)
      INTO v_missing_entity_attrs
      FROM unnest(v_required_attrs) AS req(attr_key)
     WHERE NOT EXISTS (
               SELECT 1
                 FROM public.entity_attribute_values eav
                WHERE eav.game_id = v_game_id
                  AND eav.entity_id = 'hero_kogmaw'
                  AND eav.attr_key = req.attr_key
           );

    IF v_missing_entity_attrs IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_kogmaw_living_artillery_seed: missing entity_attribute_values hero_kogmaw/% (Batch-B prerequisite; check-only)',
            v_missing_entity_attrs;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.resource_definitions rd
         WHERE rd.game_id = v_game_id
           AND rd.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kogmaw_living_artillery_seed: missing resource_definitions mana (existing-data prerequisite; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_resource_values erv
         WHERE erv.game_id = v_game_id
           AND erv.entity_id = 'hero_kogmaw'
           AND erv.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kogmaw_living_artillery_seed: missing entity_resource_values hero_kogmaw/mana (existing-data prerequisite; check-only)';
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
    -- hero_kogmaw Living Artillery（R rank-3）：独立 provider + active impact
    -- 有序两步：magic damage → provider-state stack add；零 listener
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_kogmaw_r_living_artillery',
        20120,
        '克格莫 R 活体大炮 Living Artillery（Phase-A v2 rank3）',
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

    -- timed state：max9 / 8000ms / refresh_on_write；不写 default_value（文档契约 default0）
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_kogmaw_r_living_artillery',
        'living_artillery_stacks',
        20100,
        9,
        8000,
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
            'provider_hero_kogmaw_r_living_artillery',
            'r_mana_cost',
            '{"op":"mul","args":[{"op":"const","value":40},{"op":"add","args":[{"op":"const","value":1},{"op":"read","path":"provider.state.living_artillery_stacks"}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kogmaw_r_living_artillery',
            'r_cooldown_ms',
            '{"op":"const","value":1000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kogmaw_r_living_artillery',
            'living_artillery_stack_add',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kogmaw_r_living_artillery',
            'living_artillery_damage',
            '{"op":"mul","args":[{"op":"add","args":[{"op":"add","args":[{"op":"const","value":180},{"op":"mul","args":[{"op":"const","value":0.75},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]},{"op":"mul","args":[{"op":"const","value":0.45},{"op":"read","path":"source.attr.ap.resolved"}]}]},{"op":"add","args":[{"op":"mul","args":[{"op":"lt","args":[{"op":"clamp","expr":{"op":"div","args":[{"op":"read","path":"target.attr.hp.current"},{"op":"max","args":[{"op":"const","value":1},{"op":"read","path":"target.attr.hp.max"}]}]},"min":{"op":"const","value":0},"max":{"op":"const","value":1}},{"op":"const","value":0.4}]},{"op":"const","value":2}]},{"op":"mul","args":[{"op":"gte","args":[{"op":"clamp","expr":{"op":"div","args":[{"op":"read","path":"target.attr.hp.current"},{"op":"max","args":[{"op":"const","value":1},{"op":"read","path":"target.attr.hp.max"}]}]},"min":{"op":"const","value":0},"max":{"op":"const","value":1}},{"op":"const","value":0.4}]},{"op":"add","args":[{"op":"const","value":1},{"op":"min","args":[{"op":"const","value":0.5},{"op":"mul","args":[{"op":"div","args":[{"op":"const","value":5},{"op":"const","value":6}]},{"op":"max","args":[{"op":"const","value":0},{"op":"sub","args":[{"op":"const","value":1},{"op":"clamp","expr":{"op":"div","args":[{"op":"read","path":"target.attr.hp.current"},{"op":"max","args":[{"op":"const","value":1},{"op":"read","path":"target.attr.hp.max"}]}]},"min":{"op":"const","value":0},"max":{"op":"const","value":1}}]}]}]}]}]}]}]}]}'::jsonb,
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
        'ability_hero_kogmaw_r_living_artillery',
        'provider_hero_kogmaw_r_living_artillery',
        'living_artillery',
        20130,
        '活体大炮（R）',
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
        'cost_hero_kogmaw_r_living_artillery_mana',
        'ability_hero_kogmaw_r_living_artillery',
        NULL,
        'mana',
        'r_mana_cost',
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
        'cooldown_hero_kogmaw_r_living_artillery',
        'ability_hero_kogmaw_r_living_artillery',
        'r_cooldown_ms',
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

    -- null-duration impact phase：立即 scaffold（无 0.6s delay phase）
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_kogmaw_r_living_artillery_impact',
        'ability_hero_kogmaw_r_living_artillery',
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
        'sequence_hero_kogmaw_r_living_artillery_impact',
        'provider_hero_kogmaw_r_living_artillery',
        'living_artillery_impact',
        '活体大炮 impact（主目标魔法伤害 + stacks add）',
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

    -- deferred exactly-one-detail pairing：step0 damage → damage_effect_details；
    -- step1 state_change → state_effect_details
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_kogmaw_r_living_artillery_damage',
            'sequence_hero_kogmaw_r_living_artillery_impact',
            0,
            20150,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kogmaw_r_living_artillery_stack_add',
            'sequence_hero_kogmaw_r_living_artillery_impact',
            1,
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

    INSERT INTO public.damage_effect_details (
        game_id, step_id, amount_formula_key, damage_type_id, value_policy_type_id,
        copyable_on_hit, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_kogmaw_r_living_artillery_damage',
        'living_artillery_damage',
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
        'step_hero_kogmaw_r_living_artillery_stack_add',
        20250,
        'living_artillery_stacks',
        'living_artillery_stack_add',
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

    INSERT INTO public.ability_phase_effect_sequences (
        game_id, phase_id, trigger_type_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_kogmaw_r_living_artillery_impact',
        20260,
        'sequence_hero_kogmaw_r_living_artillery_impact',
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
        'hero_kogmaw',
        'provider_hero_kogmaw_r_living_artillery',
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
