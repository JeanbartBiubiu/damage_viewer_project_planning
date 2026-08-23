-- =============================================================================
-- LoL generic Jhin Q Dancing Grenade primary-first-hit seed
-- （戏命师 Q 曼舞手雷 Phase-A v1 选定主冠军首发手雷单次物理命中）
-- =============================================================================
--
-- 目标：在外部既有 hero_jhin / ad / ap / mana 数据已存在的前提下，挂载独立 Q
--       provider/active ability Dancing Grenade primary first hit：60 mana、
--       5000ms CD、impact 对 opponent（champion）恰好一次 physical damage =
--       144 + 0.74 * source.attr.ad.resolved
--         + 0.60 * source.attr.ap.resolved。
--       AD 为 total AD：运行时直接读取 source.attr.ad.resolved，不得减 base AD，
--       亦不得称为 bonus AD；仓库治理禁止 governed tag `total_ad_ratio`，total AD
--       仅显式出现在 boundary / reason / formula。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）。Immediate selected-primary-champion
--       first-grenade physical hit 为 Phase-A scaffold，不是实际 cast time /
--       unit-targeted cancel conditions / projectile travel / first-target
--       acquisition / bounce to up to three additional targets / nearest-unhit
--       priority / target-death +35% later-bounce amplification / maximum final
--       bounce / spellshield bounce-persistence / full-Q fidelity。
--       伤害公式必须为嵌套二元算术树（每个算术节点恰好二元；每条 read path
--       恰好一次）：
--         add(add(const 144, mul(const 0.74, read source.attr.ad.resolved)),
--             mul(const 0.60, read source.attr.ap.resolved))。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step；无 Q-specific type。
--
-- 候选：hero_skill|hero_jhin|Q|曼舞手雷
-- task key：wasm-generic-jhin-dancing-grenade-primary-first-hit
-- FROZEN_PLAN_REV=jhin-q-dancing-grenade-primary-first-hit-phase-a-v1
-- 已完成边界（completed / full boundary）：
--   rank5_selected_primary_champion_first_grenade_single_physical_hit; immediate_impact_scaffold; physical_144_plus_0_74_total_ad_plus_0_60_ap; no_cast_time_unit_targeted_cancel_conditions_projectile_travel_first_target_acquisition_bounce_to_up_to_three_additional_targets_nearest_unhit_priority_target_death_35_percent_damage_increase_later_bounce_scaling_maximum_final_bounce_spellshield_bounce_persistence_other_ranks_or_full_fidelity
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_physical_damage
--   3. ap_ratio
--   4. immediate_impact_scaffold
--   （显式不包含 total_ad_ratio；仓库治理禁止该 governed tag；亦不含 salvage tags）
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20220/20260；
--      - game_entities(lol,hero_jhin)；
--      - attribute_definitions(lol,ad) 与 entity_attribute_values(lol,hero_jhin,ad)；
--      - attribute_definitions(lol,ap) 与 entity_attribute_values(lol,hero_jhin,ap)；
--    hero_jhin / ad / ap / mana 是 external existing-data / check-only 依赖；
--    当前仓库没有任何 seed / materializer 物化 Jhin 身份 / AD EAV / AP EAV /
--    mana 资源行；本脚本亦不物化身份/面板/属性定义/EAV/资源定义/实体资源值。
--    勿用 Batch-B 前置依赖、sibling provider 或“本 seed 创建这些行”一类措辞。
--    本 Q seed 保留既有 W（Deadly Flourish）但不要求/突变/合成/复制 W；
--    亦不要求/突变/合成/复制 P/E/R/basic。Q seed 不含任何 W rows。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
--    仓库真相：physical damage type `20220`；add policy `20170`；`20230=provider_action/apply`
--    不得进入可执行图或 required reserved 列表（本 seed 亦不投影 20230）。
-- 5. 仅创建/挂载 provider_hero_jhin_q_dancing_grenade_primary_first_hit
--    （stable ID 族 hero_jhin_q_dancing_grenade_primary_first_hit）及其隔离 Q 图：
--    一个 provider、一个 active ability（ability_key=dancing_grenade_primary_first_hit）、
--    一个 cost、一个 cooldown、一个 null-duration impact phase + on_enter link、一个
--    sequence、恰好一个 direct-opponent champion noncritical/noncopyable physical
--    damage step/detail、一个 entity_provider_mounts。
--    零 Jhin Q provider state / modifiers / listeners / matchers / repeats /
--    control / secondary / projectile / movement / geometry / bounce /
--    death-amplification 行；不创建/突变/合成/复制 P/W/E/R/basic 行。
-- 6. Q 无 ability-specific game-local type，不得新增 Q 专用 62xxx type，不写
--    type_relations；不得携带/合成 sibling ability-specific types。
--    Q/W isolation：test-only composition of independent graphs；Q seed contains
--    no W rows；preserve existing W without requiring/mutating/synthesizing/copying。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；canonical generic ABI 无 cast time / unit-targeted cancel /
-- projectile travel / first-target acquisition / bounce / nearest-unhit /
-- target-death amplification / maximum final bounce / spellshield
-- bounce-persistence 字段，故不编码这些表面，也不 claim 全保真）：
--   cast time / unit-targeted cancel conditions；
--   projectile travel / impact timing / first-target acquisition；
--   bounce to up to three additional enemies / nearest-unhit priority /
--     multiple targets；
--   target-death observation / +35% later-bounce amplification /
--     maximum final bounce；
--   all primary-hit spellshield absorption and bounce-persistence semantics；
--   ranks 1–4；P / W / E / R / basic / loadout / crit / on-hit；
--   identity / panel / resource definition-or-value bootstrap；
--   listener / state / event / modifier / repeat / control / secondary /
--   projectile / movement / geometry / bounce / death-amplification / sibling；
--   live migration；自动 publish；E2E；live / full fidelity。
--   One selected-primary-champion first-grenade single physical hit, not full Q.
--
-- 数值来源（League Wiki Template:Data Jhin/Q → resolved
-- Template:Data Jhin/Dancing Grenade；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Jhin/Q
--   resolved page Template:Data Jhin/Dancing Grenade
--   wiki pageId 1307579
--   revision id 4007611
--   revision timestamp 2026-04-12T07:23:12Z
--   canonical raw byte size 1913
--   canonical content SHA256
--     522c4b918067b4b035b6744eb3dc83ce64ba5d47f677ed8517fcb246111685f1
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/jhin-q.json
--     authoritative normalized bytes 2388 / SHA256
--     6f5c6dcc9771140136705f8e6554cb999f7ec5a1272515d5cbd03b910bdd20b1
--   siblings：pages/jhin-q.json（authoritative sidecar/pages in Wasm repo）
--     pages bytes 682 / SHA256
--     642d7c88a064cd3107a4cf9f51a75be2ca91bb2e904afd6cfa8cf3ead92b7897
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/jhin-q.wikitext 为
--     1911-byte materialization，SHA256
--     17deceae0abe42034f805a166ae5a16932ffcb19925654e6aa39625f026dd0cb。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾（仅 materialization /
--     serialization caveat）。
--   rank-5 selected primary-champion first-grenade single physical hit：
--     physical 144 + 74% total AD + 60% AP；mana 60；cooldown 5000ms。
--     源 wording：physical damage / (+ 74% AD) / (+ 60% AP)；AD = total AD。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime）：
--   AD0/AP0/armor0 raw/final144；
--   AD100/AP0 218；
--   AD0/AP100 204；
--   AD100/AP100 278；
--   same armor100 raw278/final139；
--   AD200/AP100/armor100 raw352/final176；
--   totalAD counterproof base0/resolved100 vs base60/resolved100/AP0/armor0
--     both218（公式只读 source.attr.ad.resolved，从不读 source.attr.ad.base）；
--   Mana180/base60/resolved100/AP100/HP1000/armor100 at t0/t4999/t5000 ->
--     success/skip/success；two Q hits/automatic starts；readyAt5000；
--     final mana60/HP722；
--   Mana59 skips unchanged/no damage/start；
--   Q/W isolation：test-only composition of independent graphs；
--     Q seed contains no W rows；preserve existing W；
--   standalone provider：preserve existing W and do not require/mutate/
--     synthesize/copy P/W/E/R/basic。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_jhin + ad/ap 属性定义与实体值 +
--       mana 资源定义与实体资源值（check-only / external existing-data；当前仓库
--       无 materializer）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-jhin-dancing-grenade-primary-first-hit-phase-a-v1-20260726

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
            'lol_generic_jhin_dancing_grenade_primary_first_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_jhin_dancing_grenade_primary_first_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_jhin_dancing_grenade_primary_first_hit_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_jhin（external existing-data；非本仓库物化；
    -- 非 Batch-B bootstrap claim；当前仓库无 materializer）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_jhin'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_jhin_dancing_grenade_primary_first_hit_seed: missing game_entities hero_jhin (external existing-data dependency; check-only; not materialized by a current repository seed)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_jhin_dancing_grenade_primary_first_hit_seed: missing attribute_definitions for game_id=% attr_key=ad (external existing-data; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_jhin'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_jhin_dancing_grenade_primary_first_hit_seed: missing entity_attribute_values hero_jhin/ad (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_jhin_dancing_grenade_primary_first_hit_seed: missing attribute_definitions for game_id=% attr_key=ap (external existing-data; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_jhin'
           AND eav.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_jhin_dancing_grenade_primary_first_hit_seed: missing entity_attribute_values hero_jhin/ap (external existing-data; check-only)';
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
    -- hero_jhin Dancing Grenade primary-first-hit（Q rank-5）：独立 provider +
    -- active impact 单次物理伤害（total AD + AP）；standalone；保留既有 W；
    -- 不触碰 P/W/E/R/basic；Q seed 不含 W rows
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_jhin_q_dancing_grenade_primary_first_hit',
        20120,
        '戏命师 Q 曼舞手雷 Dancing Grenade primary-first-hit（Phase-A v1 rank5 选定主冠军首发手雷）',
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
            'provider_hero_jhin_q_dancing_grenade_primary_first_hit',
            'q_mana_cost',
            '{"op":"const","value":60}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_jhin_q_dancing_grenade_primary_first_hit',
            'q_cooldown_ms',
            '{"op":"const","value":5000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_jhin_q_dancing_grenade_primary_first_hit',
            'dancing_grenade_primary_first_hit_damage',
            '{"op":"add","args":[{"op":"add","args":[{"op":"const","value":144},{"op":"mul","args":[{"op":"const","value":0.74},{"op":"read","path":"source.attr.ad.resolved"}]}]},{"op":"mul","args":[{"op":"const","value":0.60},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
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
        'ability_hero_jhin_q_dancing_grenade_primary_first_hit',
        'provider_hero_jhin_q_dancing_grenade_primary_first_hit',
        'dancing_grenade_primary_first_hit',
        20130,
        '曼舞手雷（Q）',
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
        'cooldown_hero_jhin_q_dancing_grenade_primary_first_hit',
        'ability_hero_jhin_q_dancing_grenade_primary_first_hit',
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
        'phase_hero_jhin_q_dancing_grenade_primary_first_hit_impact',
        'ability_hero_jhin_q_dancing_grenade_primary_first_hit',
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
        'sequence_hero_jhin_q_dancing_grenade_primary_first_hit_impact',
        'provider_hero_jhin_q_dancing_grenade_primary_first_hit',
        'dancing_grenade_primary_first_hit_impact',
        '曼舞手雷 impact（选定主冠军首发手雷单次物理伤害）',
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
        'step_hero_jhin_q_dancing_grenade_primary_first_hit_damage',
        'sequence_hero_jhin_q_dancing_grenade_primary_first_hit_impact',
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
        'step_hero_jhin_q_dancing_grenade_primary_first_hit_damage',
        'dancing_grenade_primary_first_hit_damage',
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
        'phase_hero_jhin_q_dancing_grenade_primary_first_hit_impact',
        20260,
        'sequence_hero_jhin_q_dancing_grenade_primary_first_hit_impact',
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
        'hero_jhin',
        'provider_hero_jhin_q_dancing_grenade_primary_first_hit',
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
