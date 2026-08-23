-- =============================================================================
-- LoL generic Varus R Chain of Corruption primary-hit seed（韦鲁斯 R 腐败锁链 Phase-A）
-- =============================================================================
--
-- 目标：在 Batch-B 已提供 hero_varus 身份/面板（含 mana 属性 320 与 ap）的前提下，
--       幂等 ensure mana 资源投影 320/320，并挂载独立 R provider/active ability
--       Chain of Corruption primary-hit：100 mana、60000ms CD、impact 对
--       opponent（primary enemy champion）恰好一次 magic damage =
--       350 + 1.00 * source.attr.ap.resolved。
--       规范投影为立即主冠军命中 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）；不建模 Wiki cast delay / Effect at cast
--       time end / 弹道 / root / reveal / Blight / tendril / 传播 / 多目标。
--
-- 候选：hero_skill|hero_varus|R|腐败锁链
-- task key：wasm-generic-varus-chain-of-corruption-primary-hit
-- FROZEN_PLAN_REV=varus-r-chain-of-corruption-primary-hit-phase-a-v1
-- 已完成边界（completed / full boundary）：
--   rank3_primary_champion_single_hit; immediate_impact_scaffold; magic_350_plus_1_00_ap; no_cast_delay_projectile_travel_collision_geometry_direction_root_reveal_blight_stack_schedule_tendril_seek_spread_or_multitarget
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Hard prerequisites（fail-closed）：reserved_types_seed.sql 与仓库自有
--    lol_batch_b_adc_entities_seed.sql。缺失则 RAISE EXCEPTION 回滚：
--      - game lol；
--      - 所需 reserved types：20111/20120/20130/20142/20150/20170/20221/20260；
--      - game_entities(lol,hero_varus)；
--      - attribute_definitions(lol,ap)；
--      - entity_attribute_values(lol,hero_varus,ap)。
--    Batch-B 提供稳定 Varus 面板基线（含 mana 属性 320），但 **不** 创建
--    resource 表。Varus E / W seed **不是** 前置；若其 provider 已存在则
--    字节级/行级保留，若缺失则本隔离 R seed 在 Batch-B 之后仍可独立运行。
-- 4. 禁止写入：不对 games / game_entities / attribute_definitions /
--    entity_attribute_values 做 INSERT/UPDATE/DELETE（不改写 Batch-B Varus
--    身份/面板行）。允许 ensure：
--      - reserved → game-local types 投影；
--        为 320/320（从 Batch-B 面板 mana=320 基线做 ensure 投影，**不是**
--        对 Batch-B resource 行的 check-only；遵循 Varus E active-seed 惯例）。
-- 5. 仅创建/挂载 provider_hero_varus_r_chain_of_corruption_primary_hit
--   （stable id hero_varus_r_chain_of_corruption_primary_hit）及其隔离 R 图：
--    一个 provider、一个 active ability、一个 cost、一个 cooldown、一个
--    null-duration impact phase + on_enter link、一个 sequence/step、一个
--    magic damage detail。永不更新/删除/重建 provider_hero_varus_basic_attack、
--    provider_hero_varus_w_blighted_quiver_phase_a、
--    provider_hero_varus_e_hail_of_arrows_primary_hit 及其
--    mount/listener/state/ability/phase/sequence/step/detail，或 P/Q 图。
-- 6. 本 R provider 无 listener / state definition / state change / control/root/
--    reveal / event / repeat / projectile / AOE / spread detail。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog；
--    不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；canonical generic ABI 无 cast-delay / projectile /
-- travel / collision / geometry / direction / root / reveal / Blight schedule /
-- tendril / spread / multitarget 字段，故不编码这些表面，也不 claim 全保真；
-- 这些是 exclusions，不是 approximations 或 remaining blockers）：
--   unspecified cast delay 与 Wiki Effect at cast time end；
--   projectile / travel / speed / collision / global geometry / direction /
--   facing / interception / spell-shield / untargetable；
--   root / reveal / tenacity / cleanse / CC immunity；
--   Blight stack creation 与 0.65/1.2/1.75s schedule、rank-0 fallback、
--   W coupling / detonation / state mutation；
--   tendril ground anchor、0.25s seeking、range/area、secondary infection /
--   repeat spread / multitarget ordering；
--   ranks 1–2；Varus P/Q/W/E/basic/on-hit/equipment/runes/loadout；
--   live migration / publish / E2E / full fidelity。
--
-- 数值来源（League Wiki Template:Data Varus/R → resolved
-- Template:Data Varus/Chain of Corruption；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon 数值溯源）：
--   request Template:Data Varus/R
--   resolved page Template:Data Varus/Chain of Corruption
--   wiki pageId 1309977
--   revision id 4008213
--   revision timestamp 2026-04-14T05:44:24Z
--   canonical raw byte size 5223
--   canonical content SHA256
--     62b397cc7133a767427e00a1a5b435fcb3fd94b4ec5021be4a7869837683e4ed
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/varus-r.json
--   local raw materialization caveat（非源矛盾）：仓库 local raw 为非规范
--     5222-byte materialization，SHA256
--     aa50685e07a4a974baa7f4a3bf43689f930dd20ac144fa03b72886daf8242207；
--     trim 末端 LF → 5221 /
--     a5b638836ce4976afc3e79852655826b82ecb357f2c54d36a0c885202129b585。
--     canonical 身份以 sidecar/pages 为准；本脚本不断言 local raw 等价，
--     亦不主张源矛盾。
--   rank-3 primary enemy champion only：magic 350 + 100% AP；
--     mana 100；cooldown 60000ms。
--   夹具交叉核对（注释 only；非 seed 写入）：
--     AP200 => raw550；target MR100 => mitigated275；
--     t0 success / t59999 cooldown skip / t60000 success（两次成功、一次 CD skip）；
--     两次成功后 terminal：mana300->100、target HP1000->450。
--
-- 前置：reserved_types_seed.sql；lol_batch_b_adc_entities_seed.sql（Batch-B
--       hero_varus + ap；E/W 非前置）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-varus-chain-of-corruption-primary-hit-phase-a-v1-20260723

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
        20221, -- damage/magic
        20260  -- phase_trigger/on_enter
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_varus_chain_of_corruption_primary_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_varus_chain_of_corruption_primary_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_varus_chain_of_corruption_primary_hit_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：Batch-B 必须已提供 hero_varus（本脚本不写 game_entities）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_varus'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_chain_of_corruption_primary_hit_seed: missing game_entities hero_varus (Batch-B prerequisite lol_batch_b_adc_entities_seed.sql; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_chain_of_corruption_primary_hit_seed: missing attribute_definitions for game_id=% attr_key=ap (Batch-B prerequisite; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_varus'
           AND eav.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_chain_of_corruption_primary_hit_seed: missing entity_attribute_values hero_varus/ap (Batch-B prerequisite; check-only)';
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
    -- ensure mana 资源投影（Batch-B 仅有面板 mana 属性 320，无 resource 表行）
    -- 从 Batch-B 基线 ensure 320/320；非 check-only Batch-B resource 行
    -- =========================================================================
    -- =========================================================================
    -- hero_varus Chain of Corruption primary-hit（R rank-3）：独立 provider + active
    -- 单次魔法伤害；不触碰 basic / W Blighted Quiver / E Hail of Arrows / P/Q
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_varus_r_chain_of_corruption_primary_hit',
        20120,
        '韦鲁斯 R 腐败锁链 Chain of Corruption primary-hit（Phase-A v1 rank3 主冠军目标）',
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
            'provider_hero_varus_r_chain_of_corruption_primary_hit',
            'r_mana_cost',
            '{"op":"const","value":100}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_r_chain_of_corruption_primary_hit',
            'r_cooldown_ms',
            '{"op":"const","value":60000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_r_chain_of_corruption_primary_hit',
            'chain_of_corruption_damage',
            '{"op":"add","args":[{"op":"const","value":350},{"op":"mul","args":[{"op":"const","value":1.00},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
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
        'ability_hero_varus_r_chain_of_corruption_primary_hit',
        'provider_hero_varus_r_chain_of_corruption_primary_hit',
        'chain_of_corruption',
        20130,
        '腐败锁链（R）',
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
        'cooldown_hero_varus_r_chain_of_corruption_primary_hit',
        'ability_hero_varus_r_chain_of_corruption_primary_hit',
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
        'phase_hero_varus_r_chain_of_corruption_primary_hit_impact',
        'ability_hero_varus_r_chain_of_corruption_primary_hit',
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
        'sequence_hero_varus_r_chain_of_corruption_primary_hit_impact',
        'provider_hero_varus_r_chain_of_corruption_primary_hit',
        'chain_of_corruption_impact',
        '腐败锁链 impact（主冠军目标单次魔法伤害）',
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
        'step_hero_varus_r_chain_of_corruption_primary_hit_damage',
        'sequence_hero_varus_r_chain_of_corruption_primary_hit_impact',
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
        'step_hero_varus_r_chain_of_corruption_primary_hit_damage',
        'chain_of_corruption_damage',
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
        'phase_hero_varus_r_chain_of_corruption_primary_hit_impact',
        20260,
        'sequence_hero_varus_r_chain_of_corruption_primary_hit_impact',
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
        'hero_varus',
        'provider_hero_varus_r_chain_of_corruption_primary_hit',
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
