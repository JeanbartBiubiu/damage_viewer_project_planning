-- =============================================================================
-- LoL generic Vayne R Final Hour timed bonus-AD seed（薇恩 R 终极时刻 Phase-A）
-- =============================================================================
--
-- 目标：在 Batch-B 已提供 hero_vayne 身份/面板（含 ad / mana 属性）的前提下，
--       幂等 ensure mana 资源投影 232/232，并挂载独立 R provider/active ability
--       Final Hour timed bonus AD：80 mana、70000ms CD、impact 对 source 恰好一次
--       direct provider-scope state_change override final_hour_active=1，
--       持续 12000ms / refresh_on_write；owner/source ad add =
--       65 * provider.state.final_hour_active。
--       规范投影为 cast 触发的 timed provider-state self-buff（null-duration
--       impact phase + on_enter sequence → 单一 state_change）；零 listener 行；
--       不依赖 event/ability_started 或 event/source_owner scaffold。
--
-- 候选：hero_skill|hero_vayne|R|终极时刻
-- FROZEN_PLAN_REV=vayne-r-final-hour-timed-bonus-ad-phase-a-v2
-- 已完成边界（completed / full boundary）：
--   rank3_timed_bonus_ad_self_buff; direct_provider_state_change; flat_ad_plus_65_for_12000ms; no_night_hunter_move_speed_tumble_cooldown_invisibility_takedown_extension_stealth_or_movement
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. cast_triggered_timed_bonus_ad
--   3. flat_ad_add
--   4. timed_provider_state
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Hard prerequisites（fail-closed）：reserved_types_seed.sql 与仓库自有
--    lol_batch_b_adc_entities_seed.sql。缺失则 RAISE EXCEPTION 回滚：
--      - game lol；
--      - 所需 reserved types：
--        20100/20110/20120/20130/20142/20160/20170/20172/20190/20250/20260；
--      - game_entities(lol,hero_vayne)；
--      - attribute_definitions(lol,ad) 与 attribute_definitions(lol,mana)；
--      - entity_attribute_values(lol,hero_vayne,ad) 与
--        entity_attribute_values(lol,hero_vayne,mana)。
--    Batch-B 提供稳定 Vayne 面板基线（含 mana 属性 232 与 ad），但 **不** 创建
--    resource 表。Vayne basic / Tumble / Silver Bolts / Condemn seed **不是** 前置；
--    若其 provider 已存在则字节级/行级保留，若缺失则本隔离 R seed 在 Batch-B
--    之后仍可独立运行。
-- 4. 禁止写入：不对 games / game_entities / attribute_definitions /
--    entity_attribute_values 做 INSERT/UPDATE/DELETE（不改写 Batch-B Vayne
--    身份/AD·mana 面板行）。允许 ensure：
--      - reserved → game-local types 投影；
--      - resource_definitions(lol,mana) 与 entity_resource_values(lol,hero_vayne,mana)
--        为 232/232（从 Batch-B 面板 mana=232 基线做 ensure 投影；冲突既有值
--        fail-closed RAISE，不改写无关 resource）。
-- 5. 仅 create/挂载 provider_hero_vayne_r_final_hour_timed_bonus_ad
--   （stable id hero_vayne_r_final_hour_timed_bonus_ad）及其隔离 R 图：
--    一个 provider、一个 active ability、一个 cost、一个 cooldown、一个 timed
--    provider state、一个 AD add modifier、一个 null-duration impact phase +
--    on_enter link、一个 sequence/step、一个 state_effect_details（override
--    const1 / state_scope/provider）。永不更新/删除/重建
--    provider_hero_vayne_basic_attack、provider_hero_vayne_silver_bolts、
--    provider_hero_vayne_tumble、provider_hero_vayne_e_condemn_primary_hit 及其
--    mount/listener/state/ability/phase/sequence/step/detail。
-- 6. 本 R provider 创建零 provider_listeners / listener_match_types /
--    listener_effect_sequences 行；零 event/ability_started(20205) /
--    event/source_owner(20212) scaffold 依赖。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog；
--    不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；canonical generic ABI 无 Night Hunter 移速 /
-- Tumble CD / 隐身 / takedown 延长 / stealth / movement 字段，故不编码这些
-- 表面，也不 claim 全保真；这些是 exclusions，不是 approximations 或
-- remaining blockers）：
--   Night Hunter 移速；Tumble 冷却缩减；invisibility / stealth；
--   takedown / extension；movement / dash / projectile；
--   R damage / control / multitarget / geometry；
--   cooldown-change（除 ability_cooldowns 行本身）；
--   ability_started / source_owner listener scaffold；
--   ranks1–2；Vayne P/Q/W/E/basic/on-hit/equipment/runes/loadout；
--   live migration / publish / E2E / full fidelity。
--
-- 数值来源（League Wiki Template:Data Vayne/R → resolved
-- Template:Data Vayne/Final Hour；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon 数值溯源）：
--   request Template:Data Vayne/R
--   resolved page Template:Data Vayne/Final Hour
--   wiki pageId 1309991
--   revision id 3807995
--   revision timestamp 2024-11-05T22:07:10Z
--   canonical raw byte size 2015
--   canonical content SHA256
--     e417f1cfc5e8253fdfe8140c4659e8fe63441c38ca3aa1e37d69aa31e25d682d
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/vayne-r.json
--   local raw materialization caveat（非源矛盾）：仓库 local raw 为非规范
--     2012-byte materialization，SHA256
--     343d19e30f0edf70359f122abb2c6c8e7d2d16d5e4c6db46416428d72e7c7642。
--     canonical 身份以 sidecar/pages 为准；本脚本不断言 local raw 等价，
--     亦不主张源矛盾。
--   rank-3：duration 12000ms；bonus AD 65；cooldown 70000ms；cost 80 mana。
--   provider.state.final_hour_active：文档契约 explicit default0 / max1 /
--     duration12000ms / refresh_on_write（schema 无 default_value 列；运行时缺省 0）。
--   Fixture mana300 仅属未来 Wasm 夹具；Backend seed 保持 232/232，不混用。
--
-- 前置：reserved_types_seed.sql；lol_batch_b_adc_entities_seed.sql（Batch-B
--       hero_vayne + ad/mana；basic/Tumble/Silver Bolts/Condemn 非前置）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-vayne-final-hour-timed-bonus-ad-phase-a-v2-20260723

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
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20190, -- refresh_policy/refresh_duration
        20250, -- state_scope/provider
        20260  -- phase_trigger/on_enter
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_final_hour_timed_bonus_ad_seed: game_id=% missing in public.games',
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
            'lol_generic_vayne_final_hour_timed_bonus_ad_seed: failed to lock game_data_state for %',
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
            'lol_generic_vayne_final_hour_timed_bonus_ad_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：Batch-B 必须已提供 hero_vayne（本脚本不写 game_entities）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_vayne'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_final_hour_timed_bonus_ad_seed: missing game_entities hero_vayne (Batch-B prerequisite lol_batch_b_adc_entities_seed.sql; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_final_hour_timed_bonus_ad_seed: missing attribute_definitions for game_id=% attr_key=ad (Batch-B prerequisite; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_final_hour_timed_bonus_ad_seed: missing attribute_definitions for game_id=% attr_key=mana (Batch-B prerequisite; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_vayne'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_final_hour_timed_bonus_ad_seed: missing entity_attribute_values hero_vayne/ad (Batch-B prerequisite; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_vayne'
           AND eav.attr_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_final_hour_timed_bonus_ad_seed: missing entity_attribute_values hero_vayne/mana (Batch-B prerequisite; check-only)';
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
    -- ensure mana 资源投影（Batch-B 仅有面板 mana 属性 232，无 resource 表行）
    -- 从 Batch-B 基线 ensure 232/232；冲突既有值 fail-closed；不改写无关 resource
    -- =========================================================================
    IF EXISTS (
        SELECT 1
          FROM public.resource_definitions rd
         WHERE rd.game_id = v_game_id
           AND rd.resource_key = 'mana'
           AND (
                   rd.display_name IS DISTINCT FROM '法力'
                OR rd.default_initial_value IS DISTINCT FROM 0
                OR rd.default_max_value IS DISTINCT FROM 0
               )
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_final_hour_timed_bonus_ad_seed: conflicting resource_definitions.mana (expected display_name=法力 / defaults 0/0; fail-closed)';
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

    IF EXISTS (
        SELECT 1
          FROM public.entity_resource_values erv
         WHERE erv.game_id = v_game_id
           AND erv.entity_id = 'hero_vayne'
           AND erv.resource_key = 'mana'
           AND (
                   erv.initial_value IS DISTINCT FROM 232
                OR erv.max_value IS DISTINCT FROM 232
               )
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_final_hour_timed_bonus_ad_seed: conflicting entity_resource_values hero_vayne/mana (expected 232/232; fail-closed)';
    END IF;

    INSERT INTO public.entity_resource_values (
        game_id, entity_id, resource_key, initial_value, max_value,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_vayne',
        'mana',
        232,
        232,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id, resource_key) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- =========================================================================
    -- hero_vayne Final Hour timed bonus AD（R rank-3）：独立 provider + active
    -- impact 直写 timed provider state；AD add；零 listener
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_vayne_r_final_hour_timed_bonus_ad',
        20120,
        '薇恩 R 终极时刻 Final Hour timed bonus AD（Phase-A v2 rank3）',
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

    -- timed state：max1 / 12000ms / refresh_on_write；不写 default_value（文档契约 default0）
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_vayne_r_final_hour_timed_bonus_ad',
        'final_hour_active',
        20100,
        1,
        12000,
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
            'provider_hero_vayne_r_final_hour_timed_bonus_ad',
            'r_mana_cost',
            '{"op":"const","value":80}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_vayne_r_final_hour_timed_bonus_ad',
            'r_cooldown_ms',
            '{"op":"const","value":70000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_vayne_r_final_hour_timed_bonus_ad',
            'final_hour_active_arm',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_vayne_r_final_hour_timed_bonus_ad',
            'final_hour_bonus_ad',
            '{"op":"mul","args":[{"op":"const","value":65},{"op":"read","path":"provider.state.final_hour_active"}]}'::jsonb,
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

    -- provider-bound ad add（可用性由公式内 final_hour_active 表达；condition NULL）
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'modifier_hero_vayne_r_final_hour_timed_bonus_ad',
        'provider_hero_vayne_r_final_hour_timed_bonus_ad',
        'final_hour_bonus_ad',
        NULL,
        20110,
        'ad',
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        20170,
        'final_hour_bonus_ad',
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

    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_vayne_r_final_hour_timed_bonus_ad',
        'provider_hero_vayne_r_final_hour_timed_bonus_ad',
        'final_hour',
        20130,
        '终极时刻（R）',
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
        'cost_hero_vayne_r_final_hour_timed_bonus_ad_mana',
        'ability_hero_vayne_r_final_hour_timed_bonus_ad',
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
        'cooldown_hero_vayne_r_final_hour_timed_bonus_ad',
        'ability_hero_vayne_r_final_hour_timed_bonus_ad',
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

    -- null-duration impact phase：cast 进入即直写 provider.state（无 ability_started listener）
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_vayne_r_final_hour_timed_bonus_ad_impact',
        'ability_hero_vayne_r_final_hour_timed_bonus_ad',
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

    -- deferred exactly-one-detail：state_change 配一 state_effect_details
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_vayne_r_final_hour_timed_bonus_ad_impact',
        'provider_hero_vayne_r_final_hour_timed_bonus_ad',
        'final_hour_active_arm',
        '终极时刻武装',
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
        'step_hero_vayne_r_final_hour_timed_bonus_ad_active_arm',
        'sequence_hero_vayne_r_final_hour_timed_bonus_ad_impact',
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
        'step_hero_vayne_r_final_hour_timed_bonus_ad_active_arm',
        20250,
        'final_hour_active',
        'final_hour_active_arm',
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
        'phase_hero_vayne_r_final_hour_timed_bonus_ad_impact',
        20260,
        'sequence_hero_vayne_r_final_hour_timed_bonus_ad_impact',
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
        'hero_vayne',
        'provider_hero_vayne_r_final_hour_timed_bonus_ad',
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
