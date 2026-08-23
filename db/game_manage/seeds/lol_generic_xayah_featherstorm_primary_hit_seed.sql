-- =============================================================================
-- LoL generic Xayah R Featherstorm primary-hit seed（逆羽 R 暴风羽刃 Phase-A v2）
-- =============================================================================
--
-- 目标：在外部既有 hero_xayah / ad / mana 数据（由校正后的 Deadly Plumage W seed
--       等既有行提供）已存在的前提下，挂载独立 R provider/active ability
--       Featherstorm primary champion one physical damage quantum：100 mana、
--       100000ms CD、impact 对 opponent（champion）恰好一次物理伤害量子 =
--       400 + 1.00 * (source.attr.ad.resolved - source.attr.ad.base)。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）。Immediate impact 为 Phase-A scaffold。
--       Phase-A 将该 leveling-labeled 数值恰好一次施加到所选主冠军，作为有界
--       damage quantum；不证明完整 Featherstorm 仅有一次总命中；不建模五次
--       damage ops；明确排除同目标多羽叠加/基数与五个投射物身份。
--       成功 cast 由既有 runtime 自动发出恰好一次 ability_started；本脚本不写
--       显式 event step。伤害公式必须为二元算术树。
--
-- 候选：hero_skill|hero_xayah|R|暴风羽刃
-- task key：wasm-generic-xayah-featherstorm-primary-hit
-- FROZEN_PLAN_REV=xayah-r-featherstorm-primary-hit-phase-a-v2
-- 已完成边界（completed / full boundary）：
--   rank3_primary_champion_one_physical_damage_quantum; immediate_impact_scaffold; quantum_amount_400_plus_1_00_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation_and_double_daggers_isolation; no_claim_of_whole_r_single_total_hit_or_wiki_proven_once_only; no_multi_feather_same_target_stacking_leap_ghosted_untargetable_one_second_delay_attack_or_cast_lockout_direction_cone_range_projectile_multitarget_feather_generation_ground_state_e_dependency_other_ranks_or_full_fidelity
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_physical_damage
--   3. bonus_ad_ratio
--   4. immediate_impact_scaffold
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20220/20260；
--      - game_entities(lol,hero_xayah)；
--      - attribute_definitions(lol,ad) 与 entity_attribute_values(lol,hero_xayah,ad)；
--      - 校正后的 W isolation 行：types(62012, ability/xayah_deadly_plumage,
--        reserved_type_id=NULL)；type_relations → ability_hero_xayah_w_deadly_plumage；
--        W listener ability_id IS NULL；ALL match 恰好含 20205/20212/62012。
--    hero_xayah / ad / mana 是与校正后 Deadly Plumage W seed 共享的外部既有
--    数据依赖；本脚本不复制其身份 bootstrap，亦不物化身份/面板/资源值。
-- 4. Xayah Q（Double Daggers）是可选独立 sibling。Never require、insert、update、
--    delete 或 rebuild Q rows。Never mutate W rows。
--    禁止从本 R seed 突变 W 图（不写 W provider/ability/listener/type_relations）。
--    禁止从本 R seed 突变 Q 图。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
-- 6. 仅创建/挂载 provider_hero_xayah_r_featherstorm_primary_hit 及其隔离 R 图：
--    一个 provider、一个 active ability（stable key featherstorm_primary_hit）、
--    一个 cost、一个 cooldown、一个 null-duration impact phase + on_enter link、
--    一个 sequence、恰好一个 direct-opponent physical damage step/detail（chosen
--    damage quantum）、一个 entity_provider_mounts。
--    零 R provider state / modifiers / listeners / matchers / explicit events /
--    repeats / control / projectile / AOE / feather-ground / movement /
--    untargetable 行。
-- 7. 保留且永不更新/删除/重建 provider_hero_xayah_w_deadly_plumage 及其
--    ability-type listener isolation（62012）；保留且永不突变 Q Double Daggers；
--    不创建/突变 P/E/basic。
-- 8. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog；
--    不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模）：
--   multi-feather same-target stacking / cardinality；five projectile identities /
--   five damage ops；claim of whole-R single total hit or Wiki-proven once-only；
--   leap / ghosted / untargetable；one-second delay；attack or cast lockout；
--   direction / cone / range / geometry；
--   projectile / travel / collision / multitarget；
--   feather generation / ground state / E dependency；
--   other ranks；P / W / Q / E / basic graph expansion；
--   equipment / runes / loadout / crit / on-hit；
--   identity bootstrap；live migration；自动 publish；E2E；full fidelity。
--
-- 数值来源（League Wiki Template:Data Xayah/R → resolved
-- Template:Data Xayah/Featherstorm；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Xayah/R
--   resolved page Template:Data Xayah/Featherstorm
--   wiki pageId 1324544
--   revision id 4008617
--   revision timestamp 2026-04-15T00:26:44Z
--   canonical raw byte size 1761
--   canonical content SHA256
--     cb5c8ba5486a55027e7c2252589fa8e5d821d346cc44afa99243de71ce5b3077
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/xayah-r.json
--   siblings：pages/xayah-r.json
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/xayah-r.wikitext 为
--     1761-byte materialization，SHA256
--     debf23b0213a4d9669a29f6c415a6f67d582b7093d25059b7765745bed43ace1。
--     canonical 身份以 sidecar/pages 为准；本脚本不断言 local raw 与 canonical
--     字节等价，亦不主张源矛盾。
--   rank-3 champion primary one physical damage quantum：physical
--     400 + 100% bonus AD；mana 100；cooldown 100000ms。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime）：
--   baseAD60/resolvedAD60：raw400；armor0=400；armor100=200。
--   baseAD60/resolvedAD110：raw450；armor0=450；armor100=225。
--   mana300/HP1000/baseAD60/resolvedAD110/armor100 at t0/t99999/t100000：
--     success, cooldown skip, success；two total R damage-quantum items；
--     final mana100/HP550；two automatic R ability_started events。
--   mana99 resource skip：unchanged mana/HP，no R damage/event，no W arm。
--   W/Q/R isolation：W listener isolation 与 Q Double Daggers 图保持不变；
--     R 不 cross-arm W；Q 为 optional sibling（不要求 Q 已安装）。
--
-- 前置：reserved_types_seed.sql；校正后的
--       lol_generic_xayah_deadly_plumage_seed.sql（或等价既有行）已提供
--       hero_xayah + ad + mana + W ability-type listener isolation。
--       Q seed 可选、独立；非本 R seed 前置。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-xayah-featherstorm-primary-hit-phase-a-v2-20260725

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_missing_reserved   text;
    v_w_match_count      integer;
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
            'lol_generic_xayah_featherstorm_primary_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_xayah_featherstorm_primary_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_xayah_featherstorm_primary_hit_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_xayah（与校正后 Deadly Plumage W seed 共享；
    -- 非本脚本 bootstrap / 不物化身份面板资源）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_xayah'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_xayah_featherstorm_primary_hit_seed: missing game_entities hero_xayah (external existing-data dependency; check-only; provided by corrected W seed rows)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_xayah_featherstorm_primary_hit_seed: missing attribute_definitions for game_id=% attr_key=ad',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_xayah'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_xayah_featherstorm_primary_hit_seed: missing entity_attribute_values hero_xayah/ad (external existing-data; check-only)';
    END IF;

    -- check-only：校正后的 W ability-type listener isolation（本 R seed 不突变 W）
    IF NOT EXISTS (
        SELECT 1
          FROM public.types t
         WHERE t.game_id = v_game_id
           AND t.type_id = 62012
           AND t.type_key = 'ability/xayah_deadly_plumage'
           AND t.reserved_type_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'lol_generic_xayah_featherstorm_primary_hit_seed: missing corrected W isolation type 62012 ability/xayah_deadly_plumage reserved_type_id=NULL (run corrected deadly plumage seed first)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.type_relations tr
         WHERE tr.game_id = v_game_id
           AND tr.type_id = 62012
           AND tr.target_category = 'ability'
           AND tr.target_id = 'ability_hero_xayah_w_deadly_plumage'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_xayah_featherstorm_primary_hit_seed: missing type_relations 62012→ability_hero_xayah_w_deadly_plumage (corrected W isolation prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_listeners pl
         WHERE pl.game_id = v_game_id
           AND pl.listener_id = 'listener_hero_xayah_w_deadly_plumage_ability_started'
           AND pl.ability_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'lol_generic_xayah_featherstorm_primary_hit_seed: W listener ability_id must be NULL (AbilityRef is not an event filter; corrected W isolation prerequisite)';
    END IF;

    SELECT COUNT(*)::integer
      INTO v_w_match_count
      FROM public.listener_match_types lmt
     WHERE lmt.game_id = v_game_id
       AND lmt.listener_id = 'listener_hero_xayah_w_deadly_plumage_ability_started'
       AND lmt.match_mode_type_id = 20181
       AND lmt.type_id IN (20205, 20212, 62012);

    IF v_w_match_count IS DISTINCT FROM 3 THEN
        RAISE EXCEPTION
            'lol_generic_xayah_featherstorm_primary_hit_seed: W listener must ALL-match exactly {20205,20212,62012} (found matching count=%)',
            v_w_match_count;
    END IF;

    SELECT COUNT(*)::integer
      INTO v_w_match_count
      FROM public.listener_match_types lmt
     WHERE lmt.game_id = v_game_id
       AND lmt.listener_id = 'listener_hero_xayah_w_deadly_plumage_ability_started'
       AND lmt.match_mode_type_id = 20181;

    IF v_w_match_count IS DISTINCT FROM 3 THEN
        RAISE EXCEPTION
            'lol_generic_xayah_featherstorm_primary_hit_seed: W listener ALL match set must contain exactly three types {20205,20212,62012} (found total ALL count=%)',
            v_w_match_count;
    END IF;

    -- reserved → game-local types（同 ID / 同 type_key / reserved_type_id=type_id）
    -- 本 seed 唯一允许 ensure 的共享行；不物化身份/面板/资源值；不写 W/Q 图
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
    -- hero_xayah Featherstorm primary-hit（R rank-3）：独立 provider + impact
    -- 一次物理 damage quantum；不触碰 Deadly Plumage / Double Daggers / P / E / basic
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_xayah_r_featherstorm_primary_hit',
        20120,
        '逆羽 R 暴风羽刃 Featherstorm primary-hit（Phase-A v2 rank3 主冠军 damage quantum）',
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
            'provider_hero_xayah_r_featherstorm_primary_hit',
            'r_mana_cost',
            '{"op":"const","value":100}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_xayah_r_featherstorm_primary_hit',
            'r_cooldown_ms',
            '{"op":"const","value":100000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_xayah_r_featherstorm_primary_hit',
            'featherstorm_primary_hit_damage',
            '{"op":"add","args":[{"op":"const","value":400},{"op":"mul","args":[{"op":"const","value":1.00},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}'::jsonb,
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
        'ability_hero_xayah_r_featherstorm_primary_hit',
        'provider_hero_xayah_r_featherstorm_primary_hit',
        'featherstorm_primary_hit',
        20130,
        '暴风羽刃（R）',
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
        'cooldown_hero_xayah_r_featherstorm_primary_hit',
        'ability_hero_xayah_r_featherstorm_primary_hit',
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

    -- null-duration impact phase：assembler 产出一次立即 damage quantum（Phase-A scaffold）
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_xayah_r_featherstorm_primary_hit_impact',
        'ability_hero_xayah_r_featherstorm_primary_hit',
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
        'sequence_hero_xayah_r_featherstorm_primary_hit_impact',
        'provider_hero_xayah_r_featherstorm_primary_hit',
        'featherstorm_primary_hit_impact',
        '暴风羽刃 impact（主冠军目标一次物理 damage quantum）',
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

    -- deferred exactly-one-detail：单一 damage step 配一 damage_effect_details
    -- （chosen damage quantum；非 five-hit / 非 whole-R once-only 证明）
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_xayah_r_featherstorm_primary_hit_damage',
        'sequence_hero_xayah_r_featherstorm_primary_hit_impact',
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
        'step_hero_xayah_r_featherstorm_primary_hit_damage',
        'featherstorm_primary_hit_damage',
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
        'phase_hero_xayah_r_featherstorm_primary_hit_impact',
        20260,
        'sequence_hero_xayah_r_featherstorm_primary_hit_impact',
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
        'hero_xayah',
        'provider_hero_xayah_r_featherstorm_primary_hit',
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
