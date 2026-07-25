-- =============================================================================
-- LoL generic Lucian R The Culling single-shot quantum seed（卢锡安 R 圣枪洗礼
-- Phase-A v2 单发物理 shot quantum）
-- =============================================================================
--
-- 目标：在外部既有 hero_lucian / ad / ap / mana 数据已存在的前提下，挂载独立 R
--       provider/active ability The Culling single-shot quantum：100 mana、
--       90000ms CD、impact 对 opponent（champion）恰好一次 physical damage
--       shot quantum = 45 + 0.25 * source.attr.ad.resolved
--                     + 0.15 * source.attr.ap.resolved。
--       AD 为 total AD：运行时直接读取 source.attr.ad.resolved，不得减 base AD，
--       亦不得称为 bonus AD；仓库治理禁止 governed tag `total_ad_ratio`，total AD
--       仅显式出现在 boundary / reason / formula。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）。Immediate primary-champion one-shot damage
--       为 Phase-A quantum scaffold，不是实际 channel / missile / acquisition /
--       total-shot / total-ultimate fidelity。
--       伤害公式必须为嵌套二元算术树：
--         add(add(const 45, mul(const 0.25, read source.attr.ad.resolved)),
--             mul(const 0.15, read source.attr.ap.resolved))。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step。
--
-- 候选：hero_skill|hero_lucian|R|圣枪洗礼
-- task key：wasm-generic-lucian-the-culling-single-shot-quantum
-- FROZEN_PLAN_REV=lucian-r-the-culling-single-shot-quantum-phase-a-v2
-- 已完成边界（completed / full boundary）：
--   rank3_primary_champion_first_enemy_single_physical_shot_quantum; immediate_impact_scaffold; physical_45_plus_0_25_total_ad_plus_0_15_ap; no_channel_duration_recast_shot_count_crit_scaling_fire_rate_direction_range_width_missile_offset_alternating_guns_travel_collision_multitarget_minion_double_move_ghost_facing_spell_shield_interrupts_ability_lockout_other_ranks_or_full_fidelity
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_physical_damage
--   3. ap_ratio
--   4. immediate_impact_scaffold
--   （显式不包含 total_ad_ratio；仓库治理禁止该 governed tag）
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20220/20260；
--      - game_entities(lol,hero_lucian)；
--      - attribute_definitions(lol,ad) 与 entity_attribute_values(lol,hero_lucian,ad)；
--      - attribute_definitions(lol,ap) 与 entity_attribute_values(lol,hero_lucian,ap)；
--      - resource_definitions(lol,mana)；
--      - entity_resource_values(lol,hero_lucian,mana)。
--    hero_lucian / ad / ap / mana 是 external existing-data / check-only 依赖；
--    当前仓库没有任何 seed / materializer 物化 Lucian 身份 / AD EAV / AP EAV /
--    mana 资源行；本脚本亦不物化身份/面板/属性定义/EAV/资源定义/实体资源值/
--    Wiki baseline。勿用 Batch-B 前置依赖、sibling provider 或“本 seed 创建这些行”
--    一类措辞描述该实体。
--    本 R seed 不要求 Lucian Q 或 W publication，但与既有/未来 Lucian P/Q/W/E/basic
--    行并存；不突变/删除/合成那些行（含既有 Piercing Light Q / Ardent Blaze W）。
-- 4. 禁止写入：不对 attribute_definitions / resource_definitions / game_entities /
--    entity_attribute_values / entity_resource_values 做 INSERT/UPDATE/MERGE/DELETE。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
--    仓库真相：physical damage type `20220`；add policy `20170`；`20230=provider_action/apply`
--    不得进入可执行图或 required reserved 列表（本 seed 亦不投影 20230）。
-- 5. 仅创建/挂载 provider_hero_lucian_r_the_culling_single_shot_quantum（stable ID 族
--    hero_lucian_r_the_culling_single_shot_quantum）及其隔离 R 图：一个 provider、一个
--    active ability（ability_key=the_culling_single_shot_quantum）、一个 cost、一个
--    cooldown、一个 null-duration impact phase + on_enter link、一个 sequence、恰好一个
--    direct-opponent champion noncritical/noncopyable physical damage step/detail、
--    一个 entity_provider_mounts。
--    零 Lucian R provider state / modifiers / listeners / matchers / repeats /
--    control / channel / projectile / geometry / multishot / crit / sibling 行；
--    不创建 P/Q/W/E/basic 行。
-- 6. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；canonical generic ABI 无 channel duration / recast / shot count /
-- crit-scaling fire-rate / direction / range / width / missile offset /
-- alternating guns / travel / collision / multitarget / minion double /
-- move / ghost / facing / spell shield / interrupts / ability lockout 字段，
-- 故不编码这些表面，也不 claim 全保真）：
--   3-second channel / channel state；
--   0.75-second / manual / automatic recast；
--   22 base shots / crit-chance additional-shot count / total channel damage /
--     cadence / fire-rate scaling；
--   direction / range / width；
--   missile offsets / alternating guns / travel / collision / first-enemy
--     geometry / multitarget；
--   minion double；
--   movement / ghosted / facing；
--   spell-shield handling；
--   interrupts / E usability / Q-W lockout / Thresh / Tahm interactions；
--   ranks 1–2；P / Q / W / E / basic / on-hit / loadout / crit coupling；
--   identity / panel / attribute definition-or-EAV / resource definition-or-value
--     / Wiki baseline bootstrap；
--   listener / state / event / modifier / repeat / control / channel /
--   projectile / geometry / multishot / crit / sibling detail；
--   live migration；自动 publish；E2E；full fidelity。
--
-- 数值来源（League Wiki Template:Data Lucian/R → resolved
-- Template:Data Lucian/The Culling；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Lucian/R
--   resolved page Template:Data Lucian/The Culling
--   wiki pageId 1308182
--   revision id 4007670
--   revision timestamp 2026-04-12T10:40:21Z
--   canonical raw byte size 4477
--   canonical content SHA256
--     7a4679542eebdebf25da391a1222f08df2f416c641f48473d528e62296b9a2f7
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/lucian-r.json
--   siblings：pages/lucian-r.json（authoritative sidecar/pages in Wasm repo）
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/lucian-r.wikitext 亦为
--     4477-byte materialization，SHA256
--     b63612287a8a965e7655829a2054aec7b019705225fd7e7b4736303a172bc74d。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾。
--   rank-3 raw variables（freeze）：r_d3=45；r_ad=25 percent total AD；
--     r_ap=15 percent AP；cost 100 mana；cooldown Rank3 90 seconds；
--     physical damage。
--   rank-3 champion first-enemy single physical shot quantum：
--     physical 45 + 25% total AD + 15% AP；mana 100；cooldown 90000ms。
--     源 wording：physical damage / (+ 25% AD) / (+ 15% AP)；AD = total AD。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime）：
--   baseAD0/resolvedAD0/AP0/armor0 raw/final45；
--   baseAD60/resolvedAD60/AP0/armor0 raw/final60；
--   baseAD60/resolvedAD160/AP0/armor0 raw/final85；
--   baseAD60/resolvedAD160/AP100/armor0 raw/final100；
--   baseAD60/resolvedAD160/AP100/armor100 raw100/final50；
--   baseAD60/resolvedAD260/AP200/armor100 raw140/final70；
--   baseAD0 versus baseAD60 with resolvedAD160 produces the same raw damage；
--     formula reads only source.attr.ad.resolved，never source.attr.ad.base；
--   mana300/baseAD60/resolvedAD160/AP100/HP1000/armor100 at t0/t89999/t90000：
--     success, cooldown skip, success；exactly two R shot-quantum damage items；
--     two automatic R ability_started；final mana100/HP900；
--   mana99 at t0 resource skip：unchanged mana/HP，no R damage/event。
--   standalone provider：no P/Q/W/E/basic synthesis or unrelated provider
--     mutation；不要求 Lucian Q 或 W publication；与既有/未来 Lucian P/Q/W/E/basic
--     并存且不突变。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_lucian + ad/ap 属性定义与实体值 +
--       mana 资源定义与实体资源值（check-only / external existing-data；当前仓库
--       无 materializer）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-lucian-the-culling-single-shot-quantum-phase-a-v2-20260725

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
        20111, -- selector/opponent
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20150, -- operation/damage
        20170, -- value_policy/add
        20220, -- damage/physical
        20260  -- phase_trigger/on_enter
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_lucian_the_culling_single_shot_quantum_seed: game_id=% missing in public.games',
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
            'lol_generic_lucian_the_culling_single_shot_quantum_seed: failed to lock game_data_state for %',
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
            'lol_generic_lucian_the_culling_single_shot_quantum_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_lucian（external existing-data；非本仓库物化；
    -- 非 Batch-B bootstrap claim；当前仓库无 materializer）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_lucian'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lucian_the_culling_single_shot_quantum_seed: missing game_entities hero_lucian (external existing-data dependency; check-only; not materialized by a current repository seed)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lucian_the_culling_single_shot_quantum_seed: missing attribute_definitions for game_id=% attr_key=ad (external existing-data; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_lucian'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lucian_the_culling_single_shot_quantum_seed: missing entity_attribute_values hero_lucian/ad (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lucian_the_culling_single_shot_quantum_seed: missing attribute_definitions for game_id=% attr_key=ap (external existing-data; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_lucian'
           AND eav.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lucian_the_culling_single_shot_quantum_seed: missing entity_attribute_values hero_lucian/ap (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.resource_definitions rd
         WHERE rd.game_id = v_game_id
           AND rd.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lucian_the_culling_single_shot_quantum_seed: missing resource_definitions mana (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_resource_values erv
         WHERE erv.game_id = v_game_id
           AND erv.entity_id = 'hero_lucian'
           AND erv.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_lucian_the_culling_single_shot_quantum_seed: missing entity_resource_values hero_lucian/mana (external existing-data; check-only)';
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
    -- hero_lucian The Culling single-shot quantum（R rank-3）：独立 provider +
    -- active impact 单发物理 shot quantum（total AD + AP）；standalone；
    -- 不触碰 P/Q/W/E/basic；不要求 Lucian Q 或 W publication；与既有 Lucian
    -- P/Q/W/E/basic 隔离
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_lucian_r_the_culling_single_shot_quantum',
        20120,
        '卢锡安 R 圣枪洗礼 The Culling single-shot quantum（Phase-A v2 rank3 主冠军首敌单发物理）',
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
            'provider_hero_lucian_r_the_culling_single_shot_quantum',
            'r_mana_cost',
            '{"op":"const","value":100}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_lucian_r_the_culling_single_shot_quantum',
            'r_cooldown_ms',
            '{"op":"const","value":90000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_lucian_r_the_culling_single_shot_quantum',
            'the_culling_single_shot_quantum_damage',
            '{"op":"add","args":[{"op":"add","args":[{"op":"const","value":45},{"op":"mul","args":[{"op":"const","value":0.25},{"op":"read","path":"source.attr.ad.resolved"}]}]},{"op":"mul","args":[{"op":"const","value":0.15},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
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
        'ability_hero_lucian_r_the_culling_single_shot_quantum',
        'provider_hero_lucian_r_the_culling_single_shot_quantum',
        'the_culling_single_shot_quantum',
        20130,
        '圣枪洗礼（R）',
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
        'cost_hero_lucian_r_the_culling_single_shot_quantum_mana',
        'ability_hero_lucian_r_the_culling_single_shot_quantum',
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
        'cooldown_hero_lucian_r_the_culling_single_shot_quantum',
        'ability_hero_lucian_r_the_culling_single_shot_quantum',
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

    -- null-duration impact phase：assembler 产出一次立即 operation（Phase-A scaffold）
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_lucian_r_the_culling_single_shot_quantum_impact',
        'ability_hero_lucian_r_the_culling_single_shot_quantum',
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
        'sequence_hero_lucian_r_the_culling_single_shot_quantum_impact',
        'provider_hero_lucian_r_the_culling_single_shot_quantum',
        'the_culling_single_shot_quantum_impact',
        '圣枪洗礼 impact（主冠军首敌单发物理 shot quantum）',
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
        'step_hero_lucian_r_the_culling_single_shot_quantum_damage',
        'sequence_hero_lucian_r_the_culling_single_shot_quantum_impact',
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
        'step_hero_lucian_r_the_culling_single_shot_quantum_damage',
        'the_culling_single_shot_quantum_damage',
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
        'phase_hero_lucian_r_the_culling_single_shot_quantum_impact',
        20260,
        'sequence_hero_lucian_r_the_culling_single_shot_quantum_impact',
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
        'hero_lucian',
        'provider_hero_lucian_r_the_culling_single_shot_quantum',
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
