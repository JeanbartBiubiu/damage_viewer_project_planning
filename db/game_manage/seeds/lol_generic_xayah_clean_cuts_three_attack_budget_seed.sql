-- =============================================================================
-- LoL generic Xayah P Clean Cuts three-attack budget seed（逆羽 P 锐切 Phase-A v2）
-- =============================================================================
--
-- 目标：在外部既有 hero_xayah / ad / mana 数据与校正后 Deadly Plumage W isolation
--       （由 lol_generic_xayah_deadly_plumage_seed.sql 等既有行提供）已存在的前提下，
--       挂载独立 P provider，表达用户批准的 Phase-A **攻击次数预算**近似：
--       直接 post-cast arm → clean_cuts_attacks_remaining=3；
--       成功的 source-owned basic-attack damage_instance 每次消耗 1；
--       状态序列 arm+4BA：0→3→2→1→0→0。
--       Wiki on-attack 由成功 damage_instance 近似；miss/dodge 与全部羽刃行为排除。
--
-- 候选：hero_skill|hero_xayah|P|锐切
-- task key：wasm-generic-xayah-clean-cuts-three-attack-budget
-- FROZEN_PLAN_REV=xayah-p-clean-cuts-three-attack-budget-phase-a-v2
-- 已完成边界（completed / full boundary）：
--   attack_count_budget_only; direct_post_cast_arm_gives_3; successful_source_ba_damage_instance_consumes_1; state_sequence_arm_plus_4ba_0_3_2_1_0_0; preserve_wqr_and_w_ability_type_listener_isolation; no_true_qwer_wiring_add_refresh_max5_8s_timer_geometry_feathers_secondary_damage_secondary_crit_e_dependency_miss_dodge_cadence_projectile_rng_expected_crit_on_hit_proc_or_full_ba_clean_cuts_fidelity
-- Ordered tags：
--   1. attack_count_budget
--   2. direct_post_cast_arm_override_3
--   3. basic_attack_damage_instance_consume_1
--   4. untimed_max3_state_no_default_column
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：
--        20100/20110/20111/20120/20130/20142/20150/20160/20170/20172/20181/
--        20212/20217/20220/20250/20260；
--      - game_entities(lol,hero_xayah)；
--      - attribute_definitions(lol,ad) 与 entity_attribute_values(lol,hero_xayah,ad)；
--      - 校正后的 W isolation 行：types(62012, ability/xayah_deadly_plumage,
--        reserved_type_id=NULL)；type_relations → ability_hero_xayah_w_deadly_plumage；
--        W listener ability_id IS NULL；ALL match 恰好含 20205/20212/62012。
--    hero_xayah / ad / mana 是与校正后 Deadly Plumage W seed 共享的外部既有
--    数据依赖；本脚本不复制其身份 bootstrap，亦不物化身份/面板/资源值。
--    禁止从本 P seed 突变 W/Q/R 图（不写 W/Q/R provider/ability/listener/type_relations）。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types，以及
--    Graves 式 fail-closed ensure game-local 62003 ability/basic_attack
--    （reserved_type_id=NULL；双向 id↔key collision guards）。
-- 5. 仅创建/挂载 provider_hero_xayah_p_clean_cuts_three_attack_budget 及其隔离 P 图：
--    一个 provider；state clean_cuts_attacks_remaining（max3 / duration_ms NULL /
--    refresh NULL；schema 无 default 列，不发明 default；缺失状态 runtime=0 直至 arm）；
--    arm ability（无 cost/CD）override=3；BA ability（无 cost/CD）物理
--    read source.attr.ad.resolved、非暴击、copyable_on_hit=false，经 type_relations
--    关联 62003（不得写入 ability_kind_type_id）；listener ability_id IS NULL，
--    ALL 恰好 {20217,62003,20212}，max_triggers_per_event=1，guarded add -1。
--    不添加共享 Xayah 技能 type_relations（不写 62012→P abilities）。
-- 6. 保留且永不更新/删除/重建 provider_hero_xayah_w_deadly_plumage /
--    provider_hero_xayah_q_double_daggers_primary_two_hit /
--    provider_hero_xayah_r_featherstorm_primary_hit 及其 isolation；不突变既有 seed。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog；
--    不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模）：
--   true Q/W/E/R wiring（arm 仅为已成功施法结果的 Phase-A 控制面）；
--   add/refresh/max5 叠层；8s timer；geometry / feathers / secondary damage /
--   secondary crit / E dependency；miss / dodge；cadence / projectile；
--   RNG / expected crit / on-hit / proc；full BA / Clean Cuts fidelity；
--   identity bootstrap；live migration；自动 publish；E2E。
--
-- 数值来源（League Wiki Template:Data Xayah/Clean Cuts；注释引用，无运行时
-- 外部依赖；无 DDragon / Meraki 作为 P 机制数值真理）：
--   resolved page Template:Data Xayah/Clean Cuts
--   wiki pageId 1324540
--   revision id 3967343
--   revision timestamp 2025-11-18T20:49:46Z
--   canonical raw byte size 4068
--   canonical content SHA256
--     5cfe6e5e30cdc8e6fde07791288f5a85e5ef01f543670ce2248323ccb6ead171
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/xayah-p.json
--   siblings：pages/xayah-p.json
--   Phase-A 用户批准范围：仅攻击次数预算（direct post-cast arm=3；
--     成功 source BA damage_instance 消耗 1；arm+4BA 序列 0→3→2→1→0→0）。
--
-- 前置：reserved_types_seed.sql；校正后的
--       lol_generic_xayah_deadly_plumage_seed.sql（或等价既有行）已提供
--       hero_xayah + ad + mana + W ability-type listener isolation。
--       （可选）Q/R sibling seeds 可并存；非本 P 前置，本脚本不 require/mutate。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-xayah-clean-cuts-three-attack-budget-phase-a-v2-20260726

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
    v_conflict_type_key  text;
    v_existing_name      text;
    v_existing_reserved  int;
    v_conflict_type_id   int;
    v_conflict_provider  text;
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
        20181, -- match_mode/all
        20212, -- event/source_owner
        20217, -- event/damage_instance
        20220, -- damage/physical
        20250, -- state_scope/provider
        20260  -- phase_trigger/on_enter
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: game_id=% missing in public.games',
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
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: failed to lock game_data_state for %',
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
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: missing reserved_type id(s): %',
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
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: missing game_entities hero_xayah (external existing-data dependency; check-only; provided by corrected W seed rows)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: missing attribute_definitions for game_id=% attr_key=ad',
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
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: missing entity_attribute_values hero_xayah/ad (external existing-data; check-only)';
    END IF;

    -- check-only：校正后的 W ability-type listener isolation（本 P seed 不突变 W）
    IF NOT EXISTS (
        SELECT 1
          FROM public.types t
         WHERE t.game_id = v_game_id
           AND t.type_id = 62012
           AND t.type_key = 'ability/xayah_deadly_plumage'
           AND t.reserved_type_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: missing corrected W isolation type 62012 ability/xayah_deadly_plumage reserved_type_id=NULL (run corrected deadly plumage seed first)';
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
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: missing type_relations 62012→ability_hero_xayah_w_deadly_plumage (corrected W isolation prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_listeners pl
         WHERE pl.game_id = v_game_id
           AND pl.listener_id = 'listener_hero_xayah_w_deadly_plumage_ability_started'
           AND pl.ability_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: W listener ability_id must be NULL (AbilityRef is not an event filter; corrected W isolation prerequisite)';
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
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: W listener must ALL-match exactly {20205,20212,62012} (found matching count=%)',
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
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: W listener ALL match set must contain exactly three types {20205,20212,62012} (found total ALL count=%)',
            v_w_match_count;
    END IF;

    -- reserved → game-local types（同 ID / 同 type_key / reserved_type_id=type_id）
    -- 本 seed 允许 ensure 的共享行之一；不物化身份/面板/资源值；不写 W/Q/R 图
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
    -- game-local type 62003 / ability/basic_attack（reserved_type_id=NULL）
    -- Graves 式 fail-closed 双向 id↔key ensure；不得写入 ability_kind_type_id
    -- =========================================================================
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62003
       AND (
           t.type_key IS DISTINCT FROM 'ability/basic_attack'
           OR t.reserved_type_id IS NOT NULL
       );

    IF FOUND THEN
        RAISE EXCEPTION
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: type_id=62003 already bound to type_key=% name=% reserved_type_id=% (expected ability/basic_attack, reserved_type_id=NULL)',
            v_conflict_type_key, v_existing_name, v_existing_reserved;
    END IF;

    SELECT t.type_id
      INTO v_conflict_type_id
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_key = 'ability/basic_attack'
       AND t.type_id IS DISTINCT FROM 62003;

    IF v_conflict_type_id IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: type_key=ability/basic_attack already bound to type_id=% (expected 62003)',
            v_conflict_type_id;
    END IF;

    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62003,
        'ability/basic_attack',
        'Basic attack ability',
        'Game-local tag for independent basic attack abilities used by Clean Cuts Phase-A budget BA.',
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, type_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- Fail-closed: stable ability IDs must not be owned by a foreign provider
    SELECT ad.provider_id
      INTO v_conflict_provider
      FROM public.ability_definitions ad
     WHERE ad.game_id = v_game_id
       AND ad.ability_id IN (
           'ability_hero_xayah_p_clean_cuts_direct_post_cast_arm',
           'ability_hero_xayah_p_clean_cuts_basic_attack'
       )
       AND ad.provider_id IS DISTINCT FROM 'provider_hero_xayah_p_clean_cuts_three_attack_budget'
     LIMIT 1;

    IF v_conflict_provider IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: ability_id already bound to provider_id=% (expected provider_hero_xayah_p_clean_cuts_three_attack_budget)',
            v_conflict_provider;
    END IF;

    -- Fail-closed: no pre-existing foreign Xayah basic-attack ability under 62003
    SELECT tr.target_id
      INTO v_conflict_provider
      FROM public.type_relations tr
     WHERE tr.game_id = v_game_id
       AND tr.type_id = 62003
       AND tr.target_category = 'ability'
       AND tr.target_id LIKE '%xayah%basic_attack%'
       AND tr.target_id IS DISTINCT FROM 'ability_hero_xayah_p_clean_cuts_basic_attack'
     LIMIT 1;

    IF v_conflict_provider IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_xayah_clean_cuts_three_attack_budget_seed: conflicting existing Xayah basic_attack type_relations target_id=% (expected only ability_hero_xayah_p_clean_cuts_basic_attack)',
            v_conflict_provider;
    END IF;

    -- =========================================================================
    -- hero_xayah Clean Cuts three-attack budget（P）：独立 provider + arm + BA + listener
    -- 不触碰 Deadly Plumage / Q / R / 共享技能 type_relations
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_xayah_p_clean_cuts_three_attack_budget',
        20120,
        '逆羽 P 锐切 Clean Cuts three-attack budget（Phase-A v2）',
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

    -- clean_cuts_attacks_remaining：numeric max=3；untimed（duration_ms NULL /
    -- refresh NULL；schema forbids duration_ms=0; NULL is the repository untimed
    -- equivalent）；不写 default_value（schema 无该列）；缺失状态 runtime=0 直至 arm
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_xayah_p_clean_cuts_three_attack_budget',
        'clean_cuts_attacks_remaining',
        20100,
        3,
        NULL,
        NULL,
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
            'provider_hero_xayah_p_clean_cuts_three_attack_budget',
            'clean_cuts_arm_amount',
            '{"op":"const","value":3}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_xayah_p_clean_cuts_three_attack_budget',
            'clean_cuts_basic_attack_damage',
            '{"op":"read","path":"source.attr.ad.resolved"}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_xayah_p_clean_cuts_three_attack_budget',
            'clean_cuts_has_attacks',
            '{"op":"gt","args":[{"op":"read","path":"provider.state.clean_cuts_attacks_remaining"},{"op":"const","value":0}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_xayah_p_clean_cuts_three_attack_budget',
            'clean_cuts_consume_delta',
            '{"op":"const","value":-1}'::jsonb,
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

    -- -------------------------------------------------------------------------
    -- Arm ability：无 cost/CD；Phase-A 控制面，代表一次已成功 Xayah 技能的直接结果
    -- -------------------------------------------------------------------------
    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_xayah_p_clean_cuts_direct_post_cast_arm',
        'provider_hero_xayah_p_clean_cuts_three_attack_budget',
        'clean_cuts_direct_post_cast_arm',
        20130,
        '锐切直接武装（P Phase-A 控制面）',
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
        'phase_hero_xayah_p_clean_cuts_direct_post_cast_arm_impact',
        'ability_hero_xayah_p_clean_cuts_direct_post_cast_arm',
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
        'sequence_hero_xayah_p_clean_cuts_direct_post_cast_arm',
        'provider_hero_xayah_p_clean_cuts_three_attack_budget',
        'clean_cuts_direct_post_cast_arm',
        '锐切直接武装 override=3',
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

    -- deferred exactly-one-detail：state_change 配一 state_effect_details
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_xayah_p_clean_cuts_direct_post_cast_arm',
        'sequence_hero_xayah_p_clean_cuts_direct_post_cast_arm',
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
        'step_hero_xayah_p_clean_cuts_direct_post_cast_arm',
        20250,
        'clean_cuts_attacks_remaining',
        'clean_cuts_arm_amount',
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
        'phase_hero_xayah_p_clean_cuts_direct_post_cast_arm_impact',
        20260,
        'sequence_hero_xayah_p_clean_cuts_direct_post_cast_arm',
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

    -- -------------------------------------------------------------------------
    -- BA ability：无 cost/CD；物理 read AD.resolved；非暴击；关联 62003（非 kind）
    -- -------------------------------------------------------------------------
    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_xayah_p_clean_cuts_basic_attack',
        'provider_hero_xayah_p_clean_cuts_three_attack_budget',
        'clean_cuts_basic_attack',
        20130,
        '锐切预算普攻（P Phase-A）',
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

    INSERT INTO public.type_relations (
        game_id, type_id, target_category, target_id, extend,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62003,
        'ability',
        'ability_hero_xayah_p_clean_cuts_basic_attack',
        '{"role":"basic_attack"}'::jsonb,
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

    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_xayah_p_clean_cuts_basic_attack_impact',
        'ability_hero_xayah_p_clean_cuts_basic_attack',
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
        'sequence_hero_xayah_p_clean_cuts_basic_attack_damage',
        'provider_hero_xayah_p_clean_cuts_three_attack_budget',
        'clean_cuts_basic_attack_damage',
        '锐切预算普攻物理伤害',
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

    -- deferred exactly-one-detail：damage step 配一 damage_effect_details
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_xayah_p_clean_cuts_basic_attack_damage',
        'sequence_hero_xayah_p_clean_cuts_basic_attack_damage',
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
        'step_hero_xayah_p_clean_cuts_basic_attack_damage',
        'clean_cuts_basic_attack_damage',
        20220,
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

    INSERT INTO public.ability_phase_effect_sequences (
        game_id, phase_id, trigger_type_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_xayah_p_clean_cuts_basic_attack_impact',
        20260,
        'sequence_hero_xayah_p_clean_cuts_basic_attack_damage',
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

    -- -------------------------------------------------------------------------
    -- P listener：damage_instance + ability/basic_attack + source_owner → consume -1
    -- ability_id IS NULL；max_triggers_per_event=1；P provider owner context
    -- -------------------------------------------------------------------------
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_xayah_p_clean_cuts_consume_attack',
        'provider_hero_xayah_p_clean_cuts_three_attack_budget',
        'clean_cuts_consume_attack',
        '锐切预算消耗（成功 BA damage_instance）',
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

    -- deferred exactly-one-detail：state_change 配一 state_effect_details（add -1）
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_xayah_p_clean_cuts_consume_attack',
        'sequence_hero_xayah_p_clean_cuts_consume_attack',
        0,
        20160,
        20110,
        'clean_cuts_has_attacks',
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
        'step_hero_xayah_p_clean_cuts_consume_attack',
        20250,
        'clean_cuts_attacks_remaining',
        'clean_cuts_consume_delta',
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
        'listener_hero_xayah_p_clean_cuts_basic_attack_damage',
        'provider_hero_xayah_p_clean_cuts_three_attack_budget',
        'clean_cuts_on_basic_attack_damage',
        20217,
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

    -- All: damage_instance / ability/basic_attack / source_owner
    INSERT INTO public.listener_match_types (
        game_id, listener_id, match_mode_type_id, type_id, change_revision, updated_at
    ) VALUES
        (v_game_id, 'listener_hero_xayah_p_clean_cuts_basic_attack_damage', 20181, 20217, v_candidate, NOW()),
        (v_game_id, 'listener_hero_xayah_p_clean_cuts_basic_attack_damage', 20181, 62003, v_candidate, NOW()),
        (v_game_id, 'listener_hero_xayah_p_clean_cuts_basic_attack_damage', 20181, 20212, v_candidate, NOW())
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
        'listener_hero_xayah_p_clean_cuts_basic_attack_damage',
        'sequence_hero_xayah_p_clean_cuts_consume_attack',
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
        'hero_xayah',
        'provider_hero_xayah_p_clean_cuts_three_attack_budget',
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
