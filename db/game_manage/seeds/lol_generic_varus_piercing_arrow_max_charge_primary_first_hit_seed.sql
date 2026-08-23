-- =============================================================================
-- LoL generic Varus Q Piercing Arrow max-charge primary-first-hit seed
-- （韦鲁斯 Q 穿刺之箭 Phase-A v1 最大蓄力/最大射程第一敌人选定主目标物理命中）
-- =============================================================================
--
-- 目标：在外部既有 hero_varus / ad / mana 数据已存在的前提下，挂载独立 Q
--       provider/active ability Piercing Arrow max-charge primary first-hit：
--       70 mana、12000ms listed cooldown scaffold、impact 对 opponent
--       （first-enemy selected-primary champion）恰好一次 physical damage =
--       360 + 1.20 * (source.attr.ad.resolved - source.attr.ad.base)。
--       AD 为 bonus AD：运行时 sub(resolved, base)。
--       `source.attr.ad.resolved` / `source.attr.ad.base` 是单一
--       attribute_definitions(ad) + entity_attribute_values(hero_varus,ad)
--       上的 generic runtime 路径，不是独立 attr_key。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）。Immediate selected-primary /
--       first-enemy physical hit 为 Phase-A scaffold，不是真实蓄力/引导/
--       弹道几何/穿刺衰减/Blight/完整 Q 保真。
--       伤害公式必须为二元算术树（每个算术节点恰好二元；每条 AD path
--       恰好一次；无 AP/crit reads）：
--         add(const 360, mul(const 1.20, sub(read source.attr.ad.resolved,
--             read source.attr.ad.base)))。
--       crit_eligible=false；copyable_on_hit=false；不写显式 event op 或
--       Q-specific type。成功 cast 由既有 runtime 自动发出 ability_started；
--       本脚本不写显式 event step。
--
-- 候选：hero_skill|hero_varus|Q|穿刺之箭
-- task key：wasm-generic-varus-piercing-arrow-max-charge-primary-first-hit
-- FROZEN_PLAN_REV=varus-q-piercing-arrow-max-charge-primary-first-hit-phase-a-v1
-- 已完成边界（completed / full boundary）：
--   rank5_max_charge_max_range_selected_primary_first_enemy_physical_hit; immediate_impact_scaffold; physical_360_plus_1_20_bonus_ad; mana70_listed_cooldown12000ms_scaffold; no_real_charge_channel_post_effect_cooldown_start_charge_duration_cooldown_reduction_pierce_falloff_projectile_geometry_blight_or_full_fidelity
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_physical_damage
--   3. bonus_ad_ratio
--   4. immediate_impact_scaffold
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进
--    （newest material-change-only seed shape）。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20220/20260
--        （显式含 20220=damage/physical 与 20170=value_policy/add；不含 20230）；
--      - game_entities(lol,hero_varus)；
--      - attribute_definitions(lol,ad)；
--      - entity_attribute_values(lol,hero_varus,ad)；
--    hero_varus / ad / mana 是 external existing-data / check-only 依赖；本脚本
--    不物化身份/面板/资源定义或实体值，亦不物化 ad.base/ad.resolved 伪键。
--    Mana ERV 可能已由既有 Varus E Hail of Arrows / R Chain of Corruption seed
--    物化；本脚本将其视为 external existing-data / check-only，并不断言
--    repository materializer 缺席（不得用“无 materializer”口径描述前置）。
--    勿用 Batch-B 前置依赖、sibling provider 或“本 seed 创建这些行”一类措辞
--    描述该实体；不以 ensure-entity legacy seeds 为理由物化前置。
--    本 Q seed 不要求/突变/复制/合成 basic / W / E / R；下列既有 provider 必须
--    保持 untouched / distinct（仅注释守卫，不写其行）：
--      provider_hero_varus_basic_attack、
--      provider_hero_varus_w_blighted_quiver_phase_a、
--      provider_hero_varus_e_hail_of_arrows_primary_hit、
--      provider_hero_varus_r_chain_of_corruption_primary_hit。
--    亦不依赖或 enrich W-scoped key blighted_quiver_q_max_charge_carrier /
--    ability_hero_varus_w_piercing_arrow_max_charge_carrier（必须保持 untouched
--    且与本独立 Q 图 distinct）。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
--    仓库真相：physical damage type `20220`；add policy `20170`；`20230=provider_action/apply`
--    不得进入可执行图或 required reserved 列表（本 seed 亦不投影 20230）。
-- 5. 仅创建/挂载 provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit
--    （stable ID 族 hero_varus_q_piercing_arrow_max_charge_primary_first_hit）及其隔离 Q 图：
--    一个 provider、一个 active ability（ability_key=piercing_arrow_max_charge_primary_first_hit）、
--    一个 cost70、一个 cooldown12000ms、一个 null-duration impact phase + on_enter link、一个
--    sequence、恰好一个 direct-opponent champion physical damage step/detail、一个
--    entity_provider_mounts。
--    零 provider state / modifiers / listeners / matchers / repeats / tick /
--    control / scheduler / explicit event 行；不创建/突变/合成/复制
--    basic/W/E/R 行；不触碰 W Q-carrier。
-- 6. Q 无 ability-specific game-local type，不得新增 Q 专用 62xxx type，不写
--    type_relations；不得携带/合成 sibling ability-specific types。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似）：
--   real charge / channel timing；
--   cooldown reduction by charge duration；
--   cancel / refund / recast；
--   movement slow / cast restrictions；
--   projectile / travel / direction / collision / range geometry；
--   pierce falloff / enemy count / multi-target；
--   W active / passive / Blight / missing-health / detonation / reset /
--   cooldown refund；
--   cosmetic or actual crit；
--   other ranks / siblings / items / loadout / full fidelity；
--   post-effect cooldown start / charge-duration CD start scaffolding beyond
--   listed 12000ms cooldown row；
--   identity / panel / resource definition-or-value bootstrap；
--   listener / state / event / modifier / repeat / tick / control /
--   scheduler / projectile / geometry / sibling detail；
--   live migration；自动 publish；E2E；full fidelity。
--   One selected-primary / first-enemy max-charge max-range physical hit,
--   not full Q。
--
-- 数值来源（League Wiki Template:Data Varus/Q → resolved
-- Template:Data Varus/Piercing Arrow；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Varus/Q
--   resolved page Template:Data Varus/Piercing Arrow
--   wiki pageId 1309981
--   revision id 4026469
--   revision timestamp 2026-06-09T22:00:25Z
--   canonical raw byte size 3888
--   canonical content SHA256
--     bdbbe064008b969e153800f7d5cdb305f84eca1ef043d8e6f8ce41c5db2659dd
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/varus-q.json
--     normalized sidecar bytes 4131 / SHA256
--     bb5af7baaf053d1266a3702664c2df09e89f67c6125e8cf6da15f28f5b0c1f8e
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/varus-q.wikitext 为
--     3888-byte materialization，SHA256
--     5a350cecb53d37bd2640f7de3398c1be0a798a75f88c42eb327933920d487962。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾（仅 materialization /
--     serialization caveat）。
--   rank-5 maximum-charge / maximum-range first-enemy selected-primary：
--     physical 360 + 120% bonus AD；mana 70；listed cooldown 12000ms scaffold；
--     crit_eligible=false；copyable_on_hit=false。
--     源 wording：physical damage / (+ 120% bonus AD)。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime）：
--   base60/resolved60/armor0 raw/final360；armor100 final180；
--   base60/resolved160/armor0 raw/final480；armor100 final240；
--   base60/resolved260/armor100 raw600/final300；
--   bonus-AD proof base0/resolved100 vs base60/resolved160 at armor0 both480；
--   mana210/base60/resolved160/HP1000/armor100 at t0/t11999/t12000：
--     success, cooldown skip, success；two Q damage items；
--     two automatic Q ability_started；final mana70/HP520；
--   mana69 resource skip：unchanged mana/HP，no Q damage/event evidence。
--   standalone provider：no basic/W/E/R synthesis；no W carrier mutation /
--   dependency / ID collision with blighted_quiver_q_max_charge_carrier。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_varus + ad 属性定义与实体值 +
--       mana 资源定义与实体资源值（check-only / external existing-data；本 seed
--       不物化；Mana ERV 可能已由既有 Varus E/R seeds 物化，不断言
--       repository materializer 缺席）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-varus-piercing-arrow-max-charge-primary-first-hit-phase-a-v1-20260726

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
            'lol_generic_varus_piercing_arrow_max_charge_primary_first_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_varus_piercing_arrow_max_charge_primary_first_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_varus_piercing_arrow_max_charge_primary_first_hit_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_varus（external existing-data；本 seed 不物化）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_varus'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_piercing_arrow_max_charge_primary_first_hit_seed: missing game_entities hero_varus (external existing-data dependency; check-only; not materialized by this seed)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_piercing_arrow_max_charge_primary_first_hit_seed: missing attribute_definitions for game_id=% attr_key=ad (external existing-data; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_varus'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_piercing_arrow_max_charge_primary_first_hit_seed: missing entity_attribute_values hero_varus/ad (external existing-data; check-only)';
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
    -- hero_varus Piercing Arrow max-charge primary-first-hit（Q rank-5）：
    -- 独立 provider + active impact 单次物理伤害（bonus AD）；standalone；
    -- 不触碰 basic / W / E / R / W Q-carrier
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit',
        20120,
        '韦鲁斯 Q 穿刺之箭 Piercing Arrow max-charge primary-first-hit（Phase-A v1 rank5 最大蓄力第一敌人）',
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
            'provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit',
            'q_mana_cost',
            '{"op":"const","value":70}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit',
            'q_cooldown_ms',
            '{"op":"const","value":12000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit',
            'piercing_arrow_max_charge_primary_first_hit_damage',
            '{"op":"add","args":[{"op":"const","value":360},{"op":"mul","args":[{"op":"const","value":1.20},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}'::jsonb,
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
        'ability_hero_varus_q_piercing_arrow_max_charge_primary_first_hit',
        'provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit',
        'piercing_arrow_max_charge_primary_first_hit',
        20130,
        '穿刺之箭（Q）',
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
        'cooldown_hero_varus_q_piercing_arrow_max_charge_primary_first_hit',
        'ability_hero_varus_q_piercing_arrow_max_charge_primary_first_hit',
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
        'phase_hero_varus_q_piercing_arrow_max_charge_primary_first_hit_impact',
        'ability_hero_varus_q_piercing_arrow_max_charge_primary_first_hit',
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
        'sequence_hero_varus_q_piercing_arrow_max_charge_primary_first_hit_impact',
        'provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit',
        'piercing_arrow_max_charge_primary_first_hit_impact',
        '穿刺之箭 impact（最大蓄力第一敌人选定主目标单次物理伤害）',
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
        'step_hero_varus_q_piercing_arrow_max_charge_primary_first_hit_damage',
        'sequence_hero_varus_q_piercing_arrow_max_charge_primary_first_hit_impact',
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
        'step_hero_varus_q_piercing_arrow_max_charge_primary_first_hit_damage',
        'piercing_arrow_max_charge_primary_first_hit_damage',
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
        'phase_hero_varus_q_piercing_arrow_max_charge_primary_first_hit_impact',
        20260,
        'sequence_hero_varus_q_piercing_arrow_max_charge_primary_first_hit_impact',
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
        'provider_hero_varus_q_piercing_arrow_max_charge_primary_first_hit',
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
