-- =============================================================================
-- LoL generic Tristana W Rocket Jump primary landing-hit seed
-- （麦林炮手 W 火箭跳跃 Phase-A v2 选定主冠军单次魔法落地命中）
-- =============================================================================
--
-- 目标：在外部既有 hero_tristana / ad / ap / mana 数据已存在的前提下，挂载独立 W
--       provider/active ability Rocket Jump primary landing hit：50 mana、
--       14000ms CD、impact 对 opponent（champion）恰好一次 magic damage =
--       210 + 1.00 * (source.attr.ad.resolved - source.attr.ad.base)
--         + 0.50 * source.attr.ap.resolved。
--       AD 为 bonus AD：运行时 sub(resolved, base)；不得直接读 total AD 作为
--       bonus 比率，亦不得省略 ad.base 减法。AP 为 source.attr.ap.resolved
--       直接读取。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）。Immediate selected-primary-champion
--       magic landing hit 为 Phase-A scaffold，不是实际 dash / cast time /
--       air time / landing delay / movement / AOE / slow / full-W fidelity。
--       伤害公式必须为嵌套二元算术树（每个算术节点恰好二元；每条 read path
--       恰好一次）：
--         add(add(const 210, mul(const 1.00, sub(read source.attr.ad.resolved,
--             read source.attr.ad.base))), mul(const 0.50,
--             read source.attr.ap.resolved))。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step。
--
-- 候选：hero_skill|hero_tristana|W|火箭跳跃
-- task key：wasm-generic-tristana-rocket-jump-primary-landing-hit
-- FROZEN_PLAN_REV=tristana-w-rocket-jump-primary-landing-hit-phase-a-v2
-- 已完成边界（completed / full boundary）：
--   rank5_selected_primary_champion_single_magic_landing_hit; immediate_impact_scaffold; magic_210_plus_1_00_bonus_ad_plus_0_50_ap; no_dash_cast_time_air_time_landing_delay_movement_geometry_speed_terrain_collision_knockdown_grounded_slow_aoe_secondary_takedown_reset_explosive_charge_reset_cast_during_dash_other_ranks_or_full_fidelity
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
--      - game_entities(lol,hero_tristana)；
--      - attribute_definitions(lol,ad) 与 (lol,ap)；
--      - entity_attribute_values(lol,hero_tristana,ad) 与 (lol,hero_tristana,ap)；
--      - resource_definitions(lol,mana)；
--      - entity_resource_values(lol,hero_tristana,mana)。
--    hero_tristana / ad / ap / mana 是 external existing-data / check-only 依赖；
--    当前仓库没有任何 seed / materializer 物化 Tristana 身份 / 面板 / ad/ap EAV /
--    资源行；本脚本亦不物化身份/面板/资源值。勿用 Batch-B 前置依赖、sibling
--    provider、ensure-entity legacy seeds 或“本 seed 创建这些行”一类措辞描述该
--    实体；勿以 ensure-entity legacy seeds 为理由物化前置。
--    本 W seed 不要求 P/Q/E/basic/Explosive Charge/R publication，亦不合成那些
--    行；与既有/未来 Tristana Q（Rapid Fire）/ R（Buster Shot）/ P/E/basic
--    （含 Explosive Charge）并存且不突变、不依赖、不合成。
-- 4. 禁止写入：不对 attribute_definitions / resource_definitions / game_entities /
--    entity_attribute_values / entity_resource_values 做 INSERT/UPDATE/MERGE/DELETE。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
--    仓库真相：magic damage type `20221`；add policy `20170`；`20230=provider_action/apply`
--    不得进入可执行图或 required reserved 列表（本 seed 亦不投影 20230）。
-- 5. 仅创建/挂载 provider_hero_tristana_w_rocket_jump_primary_landing_hit
--    （stable ID 族 hero_tristana_w_rocket_jump_primary_landing_hit）及其隔离 W 图：
--    一个 provider、一个 active ability（ability_key=rocket_jump_primary_landing_hit）、
--    一个 cost、一个 cooldown、一个 null-duration impact phase + on_enter link、一个
--    sequence、恰好一个 direct-opponent champion noncritical/noncopyable magic
--    damage step/detail、一个 entity_provider_mounts。
--    零 Tristana W provider state / modifiers / listeners / matchers / repeats /
--    control / slow / secondary targeting / channel / projectile / geometry /
--    movement 行；不创建 P/Q/E/basic/Explosive Charge/R 行。
-- 6. W 无 ability-specific game-local type，不得携带
--    `ability/tristana_rapid_fire` / type `62013`；不新增 W type，不写
--    type_relations。Q listener isolation 依赖 W 缺少 Q type：W cast 不得武装 Q；
--    Q cast 不得造成 W damage（sibling independence / Q/W isolation）。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；canonical generic ABI 无 dash / cast time / air time / landing delay /
-- movement / destination / range / speed / terrain / collision / geometry /
-- landing AOE / effect radius / slow / knockdown / grounded / takedown reset /
-- Explosive Charge reset / cast-during-dash 字段，故不编码这些表面，也不 claim
-- 全保真）：
--   dash / cast time 0.25 / air time / landing delay；
--   movement / destination / range / speed / terrain / collision / geometry；
--   landing AOE / effect radius 350 / spellaoe / multiple or secondary targets；
--   40% slow 2s / knockdown / grounded / spellshield / other control；
--   takedown / clone / max-stack Explosive Charge reset and cooldown bypass/reset；
--   casting abilities / spells / items during dash；
--   ranks 1–4；P / Q / E / basic / Explosive Charge / R / loadout / crit / on-hit；
--   identity / panel / resource definition-or-value bootstrap；
--   listener / state / event / modifier / repeat / control / slow / secondary /
--   movement / geometry / sibling detail；
--   live migration；自动 publish；E2E；live / full fidelity。
--   One selected-target magic landing hit, not full W.
--
-- 数值来源（League Wiki Template:Data Tristana/W → resolved
-- Template:Data Tristana/Rocket Jump；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Tristana/W
--   resolved page Template:Data Tristana/Rocket Jump
--   wiki pageId 1308523
--   revision id 4007758
--   revision timestamp 2026-04-12T14:13:05Z
--   canonical raw byte size 2444
--   canonical content SHA256
--     cf0e3ae91310ab5e7cc04408941671520e3464f75bc61da683b100ea82e56eec
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/tristana-w.json
--   siblings：pages/tristana-w.json（authoritative sidecar/pages in Wasm repo）
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/tristana-w.wikitext 为
--     2443-byte materialization，SHA256
--     7283b2eb2020c20c6e48098e647ba4782b6dc134705c7c668d7e7279da1cabd9。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾（仅 materialization /
--     serialization caveat）。
--   rank-5 selected primary-champion single magic landing hit：
--     magic 210 + 100% bonus AD + 50% AP；mana 50；cooldown 14000ms。
--     源 wording：magic damage / (+ 100% bonus AD) / (+ 50% AP)。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime）：
--   baseAD0/resolvedAD0/AP0/MR0 raw/final210；
--   baseAD60/resolvedAD60/AP0/MR0 raw/final210；
--   baseAD60/resolvedAD160/AP0/MR0 raw/final310；
--   baseAD60/resolvedAD160/AP100/MR0 raw/final360；
--   baseAD60/resolvedAD160/AP100/MR100 raw360/final180；
--   baseAD60/resolvedAD260/AP200/MR100 raw510/final255；
--   baseAD0/resolvedAD100/AP100 vs baseAD60/resolvedAD160/AP100 at MR0 both360
--     （bonus-AD proof：equal bonus AD + equal AP yields equal raw）；
--   mana150/base60/resolved160/AP100/HP1000/MR100 at t0/t13999/t14000：
--     success, cooldown skip, success；exactly two W hits；
--     two automatic W ability_started；readyAt14000；final mana50/HP640；
--   mana49 resource skip：unchanged mana/HP，no W damage/start evidence。
--   Q/W isolation：W cast does not arm Q；Q cast causes no W damage。
--   standalone provider：no P/Q/E/basic/Explosive Charge/R synthesis or
--     unrelated provider mutation；不要求 sibling publication。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_tristana + ad/ap 属性定义与实体值 +
--       mana 资源定义与实体资源值（check-only / external existing-data；当前仓库
--       无 materializer）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-tristana-rocket-jump-primary-landing-hit-phase-a-v2-20260726

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
            'lol_generic_tristana_rocket_jump_primary_landing_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_tristana_rocket_jump_primary_landing_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_tristana_rocket_jump_primary_landing_hit_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_tristana（external existing-data；非本仓库物化；
    -- 非 Batch-B bootstrap claim；当前仓库无 materializer；不以 ensure-entity
    -- legacy seeds 为理由物化前置）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_tristana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rocket_jump_primary_landing_hit_seed: missing game_entities hero_tristana (external existing-data dependency; check-only; not materialized by a current repository seed)';
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
            'lol_generic_tristana_rocket_jump_primary_landing_hit_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_tristana'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rocket_jump_primary_landing_hit_seed: missing entity_attribute_values hero_tristana/ad (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_tristana'
           AND eav.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rocket_jump_primary_landing_hit_seed: missing entity_attribute_values hero_tristana/ap (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.resource_definitions rd
         WHERE rd.game_id = v_game_id
           AND rd.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rocket_jump_primary_landing_hit_seed: missing resource_definitions mana (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_resource_values erv
         WHERE erv.game_id = v_game_id
           AND erv.entity_id = 'hero_tristana'
           AND erv.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_tristana_rocket_jump_primary_landing_hit_seed: missing entity_resource_values hero_tristana/mana (external existing-data; check-only)';
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
    -- hero_tristana Rocket Jump primary landing-hit（W rank-5）：独立 provider +
    -- active impact 单次魔法伤害（bonus AD + AP）；standalone；不触碰
    -- P/Q/E/basic/Explosive Charge/R；不携带 62013 / ability/tristana_rapid_fire
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_tristana_w_rocket_jump_primary_landing_hit',
        20120,
        '麦林炮手 W 火箭跳跃 Rocket Jump primary landing-hit（Phase-A v2 rank5 选定主冠军单次魔法落地命中）',
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
            'provider_hero_tristana_w_rocket_jump_primary_landing_hit',
            'w_mana_cost',
            '{"op":"const","value":50}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_tristana_w_rocket_jump_primary_landing_hit',
            'w_cooldown_ms',
            '{"op":"const","value":14000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_tristana_w_rocket_jump_primary_landing_hit',
            'rocket_jump_primary_landing_hit_damage',
            '{"op":"add","args":[{"op":"add","args":[{"op":"const","value":210},{"op":"mul","args":[{"op":"const","value":1.00},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]},{"op":"mul","args":[{"op":"const","value":0.50},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
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
        'ability_hero_tristana_w_rocket_jump_primary_landing_hit',
        'provider_hero_tristana_w_rocket_jump_primary_landing_hit',
        'rocket_jump_primary_landing_hit',
        20130,
        '火箭跳跃（W）',
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
        'cost_hero_tristana_w_rocket_jump_primary_landing_hit_mana',
        'ability_hero_tristana_w_rocket_jump_primary_landing_hit',
        NULL,
        'mana',
        'w_mana_cost',
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
        'cooldown_hero_tristana_w_rocket_jump_primary_landing_hit',
        'ability_hero_tristana_w_rocket_jump_primary_landing_hit',
        'w_cooldown_ms',
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
        'phase_hero_tristana_w_rocket_jump_primary_landing_hit_impact',
        'ability_hero_tristana_w_rocket_jump_primary_landing_hit',
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
        'sequence_hero_tristana_w_rocket_jump_primary_landing_hit_impact',
        'provider_hero_tristana_w_rocket_jump_primary_landing_hit',
        'rocket_jump_primary_landing_hit_impact',
        '火箭跳跃 impact（选定主冠军单次魔法落地命中）',
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
        'step_hero_tristana_w_rocket_jump_primary_landing_hit_damage',
        'sequence_hero_tristana_w_rocket_jump_primary_landing_hit_impact',
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
        'step_hero_tristana_w_rocket_jump_primary_landing_hit_damage',
        'rocket_jump_primary_landing_hit_damage',
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
        'phase_hero_tristana_w_rocket_jump_primary_landing_hit_impact',
        20260,
        'sequence_hero_tristana_w_rocket_jump_primary_landing_hit_impact',
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
        'hero_tristana',
        'provider_hero_tristana_w_rocket_jump_primary_landing_hit',
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
