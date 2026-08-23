-- =============================================================================
-- LoL generic Graves Q End of the Line first outbound-pass seed
-- （格雷福斯 Q 穷途末路 Phase-A v2 选定主冠军首段出站单次物理命中）
-- =============================================================================
--
-- 目标：在外部既有 hero_graves / ad / mana 数据已存在的前提下，挂载独立 Q
--       provider/active ability End of the Line first outbound pass：80 mana、
--       6000ms CD、impact 对 opponent（champion）恰好一次 physical damage =
--       150 + 0.65 * (source.attr.ad.resolved - source.attr.ad.base)。
--       AD 为 bonus AD：运行时 sub(resolved, base)；不得直接读 total AD 作为
--       bonus 比率，亦不得省略 ad.base 减法。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）。Immediate selected-primary-champion
--       first-outbound-pass physical hit 为 Phase-A scaffold，不是实际 cast
--       time / direction / range / width / line geometry / projectile travel /
--       pass-through / multitarget / powder trail / delayed 2s or terrain 0.2s
--       detonation / perpendicular area / reverse wave / second pass /
--       once-per-pass / full-Q fidelity。
--       伤害公式必须为嵌套二元算术树（每个算术节点恰好二元；每条 read path
--       恰好一次）：
--         add(const 150, mul(const 0.65, sub(read source.attr.ad.resolved,
--             read source.attr.ad.base)))。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step。
--
-- 候选：hero_skill|hero_graves|Q|穷途末路
-- task key：wasm-generic-graves-end-of-the-line-first-outbound-pass
-- FROZEN_PLAN_REV=graves-q-end-of-the-line-first-outbound-pass-phase-a-v2
-- 已完成边界（completed / full boundary）：
--   rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_scaffold; physical_150_plus_0_65_bonus_ad; no_cast_time_direction_range_width_line_geometry_projectile_travel_pass_through_multitarget_powder_trail_delayed_2s_or_terrain_0_2s_detonation_perpendicular_area_reverse_wave_second_pass_total_damage_once_per_pass_spellshield_windwall_terrain_interaction_other_ranks_or_full_fidelity
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
--      - game_entities(lol,hero_graves)；
--      - attribute_definitions(lol,ad)；
--      - entity_attribute_values(lol,hero_graves,ad)；
--    hero_graves / ad / mana 是 external existing-data / check-only 依赖；本脚本
--    不物化身份/面板/资源定义或实体值。既有 Graves P New Destiny / E Quickdraw /
--    W Smoke Screen / R Collateral Damage / basic 等 sibling seed 若已写入这些行，
--    仅作 ambient 供给，**不是**硬前置，不得被本 seed require / mutate /
--    synthesize / copy。勿用 Batch-B 前置依赖、sibling provider、ensure-entity
--    legacy seeds 或“本 seed 创建这些行”一类措辞描述该实体；勿以 ensure-entity
--    legacy seeds 为理由物化前置。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
--    仓库真相：physical damage type `20220`；add policy `20170`；`20230=provider_action/apply`
--    不得进入可执行图或 required reserved 列表（本 seed 亦不投影 20230）。
-- 5. 仅创建/挂载 provider_hero_graves_q_end_of_the_line_first_outbound_pass
--    （stable ID 族 hero_graves_q_end_of_the_line_first_outbound_pass）及其隔离 Q 图：
--    一个 provider、一个 active ability（ability_key=end_of_the_line_first_outbound_pass）、
--    一个 cost、一个 cooldown、一个 null-duration impact phase + on_enter link、一个
--    sequence、恰好一个 direct-opponent champion noncritical/noncopyable physical
--    damage step/detail、一个 entity_provider_mounts。
--    零 Graves Q provider state / modifiers / listeners / matchers / repeats /
--    control / secondary targeting / channel / projectile / geometry / movement /
--    powder trail / detonation 行；不创建/突变 P/E/W/R/basic 行；本 seed 不得
--    含任何 E True Grit rows/modifiers（true_grit_stacks / bonus_armor /
--    bonus_magic_resist）。
-- 6. Q 无 ability-specific game-local type，不得新增 Q 专用 62xxx type，不写
--    type_relations；不得携带/合成 sibling ability-specific types。
--    Q/E isolation：test-only composition of independent graphs；
--    Q does not alter True Grit；E produces no Q damage。
--    Do not copy E into this seed。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；canonical generic ABI 无 cast time / direction / range / width / line /
-- projectile / travel / pass-through / multitarget / powder trail / delayed
-- detonation / perpendicular area / reverse wave / second pass / once-per-pass /
-- spellshield / Wind Wall / Braum terrain 字段，故不编码这些表面，也不 claim
-- 全保真）：
--   cast time / direction / range / width / line geometry；
--   projectile speed / travel / pass-through / multiple targets；
--   powder trail persistence and terrain/collision model；
--   delayed 2s or terrain 0.2s detonation / perpendicular area / reverse wave /
--     second-pass / total damage；
--   once-per-pass gate / spellshield / Wind Wall / Braum terrain interactions；
--   ranks 1–4；P / E / W / R / basic / loadout coupling；
--   identity / panel / resource definition-or-value bootstrap；
--   crit / on-hit；listener / state / event / modifier / repeat / control /
--   secondary / movement / geometry / trail / detonation / sibling detail；
--   live migration；自动 publish；E2E；live / full fidelity。
--   One selected-target first-outbound-pass physical hit, not full Q.
--
-- 数值来源（League Wiki Template:Data Graves/Q → resolved
-- Template:Data Graves/End of the Line；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Graves/Q
--   resolved page Template:Data Graves/End of the Line
--   wiki pageId 1307367
--   revision id 4007501
--   revision timestamp 2026-04-11T22:23:57Z
--   canonical raw byte size 2266
--   canonical content SHA256
--     c18840004febd305484392c882680939efe9fc609d4f733f81824439741345c5
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/graves-q.json
--   siblings：pages/graves-q.json（authoritative sidecar/pages in Wasm repo）
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/graves-q.wikitext 为
--     2265-byte materialization，SHA256
--     cd2744fb1f28e54bd3b5e25b96cb1d21babc0583bfd8e854d55c15ed83df0377。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾（仅 materialization /
--     serialization caveat）。
--   rank-5 selected primary-champion first outbound-pass single physical hit：
--     physical 150 + 65% bonus AD；mana 80；cooldown 6000ms。
--     源 wording：physical damage / (+ 65% bonus AD)。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime）：
--   base0/resolved0/armor0 raw/final150；
--   base60/resolved60/armor0 raw/final150；
--   base60/resolved160/armor0 raw/final215；
--   same armor100 raw215/final107.5；
--   base60/resolved260/armor100 raw280/final140；
--   base0/resolved100 vs base60/resolved160 at armor0 both raw/final215
--     （bonusAD counterproof：equal bonus AD yields equal raw/final）；
--   mana240/baseAD60/resolvedAD160/targetHP1000/armor100 attempts
--     t0/t5999/t6000 -> success/cooldown skip/success；exactly two Q hits and
--     automatic starts；readyAt6000；final mana80/HP785；
--   mana79 t0 -> resource skip, unchanged mana/HP, no Q damage/start；
--   Q/E isolation：test-only composition of independent graphs；
--     Q does not alter True Grit and E produces no Q damage.
--     Do not copy E into this seed。
--   standalone provider：preserve existing P/E/W/R/basic graphs without
--     requiring, mutating, synthesizing or copying them。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_graves + ad 属性定义与实体值 +
--       mana 资源定义与实体资源值（check-only / external existing-data；本 seed
--       不物化；sibling Graves seeds 可 ambient 供给但非硬前置）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-graves-end-of-the-line-first-outbound-pass-phase-a-v2-20260726

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
        20220, -- damage/physical
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY['ad'];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_graves_end_of_the_line_first_outbound_pass_seed: game_id=% missing in public.games',
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
            'lol_generic_graves_end_of_the_line_first_outbound_pass_seed: failed to lock game_data_state for %',
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
            'lol_generic_graves_end_of_the_line_first_outbound_pass_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_graves（external existing-data；本 seed 不物化；
    -- 非 Batch-B bootstrap claim；不以 ensure-entity legacy seeds 为理由物化前置；
    -- sibling P/E/W/R/basic 可 ambient 供给但非硬前置）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_graves'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_graves_end_of_the_line_first_outbound_pass_seed: missing game_entities hero_graves (external existing-data dependency; check-only; not materialized by this seed)';
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
            'lol_generic_graves_end_of_the_line_first_outbound_pass_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_graves'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_graves_end_of_the_line_first_outbound_pass_seed: missing entity_attribute_values hero_graves/ad (external existing-data; check-only)';
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
    -- hero_graves End of the Line first outbound-pass（Q rank-5）：独立 provider +
    -- active impact 单次物理伤害（bonus AD）；standalone；不触碰 P/E/W/R/basic；
    -- 不含 True Grit / bonus_armor / bonus_magic_resist；无 Q 专用 game-local type
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_graves_q_end_of_the_line_first_outbound_pass',
        20120,
        '格雷福斯 Q 穷途末路 End of the Line first outbound-pass（Phase-A v2 rank5 选定主冠军首段出站单次物理命中）',
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
            'provider_hero_graves_q_end_of_the_line_first_outbound_pass',
            'q_mana_cost',
            '{"op":"const","value":80}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_graves_q_end_of_the_line_first_outbound_pass',
            'q_cooldown_ms',
            '{"op":"const","value":6000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_graves_q_end_of_the_line_first_outbound_pass',
            'end_of_the_line_first_outbound_pass_damage',
            '{"op":"add","args":[{"op":"const","value":150},{"op":"mul","args":[{"op":"const","value":0.65},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}'::jsonb,
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
        'ability_hero_graves_q_end_of_the_line_first_outbound_pass',
        'provider_hero_graves_q_end_of_the_line_first_outbound_pass',
        'end_of_the_line_first_outbound_pass',
        20130,
        '穷途末路（Q）',
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
        'cooldown_hero_graves_q_end_of_the_line_first_outbound_pass',
        'ability_hero_graves_q_end_of_the_line_first_outbound_pass',
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
        'phase_hero_graves_q_end_of_the_line_first_outbound_pass_impact',
        'ability_hero_graves_q_end_of_the_line_first_outbound_pass',
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
        'sequence_hero_graves_q_end_of_the_line_first_outbound_pass_impact',
        'provider_hero_graves_q_end_of_the_line_first_outbound_pass',
        'end_of_the_line_first_outbound_pass_impact',
        '穷途末路 impact（选定主冠军首段出站单次物理命中）',
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
        'step_hero_graves_q_end_of_the_line_first_outbound_pass_damage',
        'sequence_hero_graves_q_end_of_the_line_first_outbound_pass_impact',
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
        'step_hero_graves_q_end_of_the_line_first_outbound_pass_damage',
        'end_of_the_line_first_outbound_pass_damage',
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
        'phase_hero_graves_q_end_of_the_line_first_outbound_pass_impact',
        20260,
        'sequence_hero_graves_q_end_of_the_line_first_outbound_pass_impact',
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
        'hero_graves',
        'provider_hero_graves_q_end_of_the_line_first_outbound_pass',
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
