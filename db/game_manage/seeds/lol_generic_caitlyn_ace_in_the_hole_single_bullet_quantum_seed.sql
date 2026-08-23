-- =============================================================================
-- LoL generic Caitlyn R Ace in the Hole single-bullet quantum seed
-- （凯特琳 R 让子弹飞 Phase-A v1 单发物理子弹量子）
-- =============================================================================
--
-- 目标：在外部既有 hero_caitlyn / ad / mana 数据已存在的前提下，挂载独立 R
--       provider/active ability Ace in the Hole single-bullet quantum：100 mana、
--       90000ms CD、impact 对 opponent（champion）恰好一次 physical damage =
--       650 + 1.00 * (source.attr.ad.resolved - source.attr.ad.base)。
--       AD 为 bonus AD：运行时 sub(resolved, base)；不得直接读 total AD 作为比率，
--       亦不得省略 ad.base 减法。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）。Immediate primary-champion one-bullet
--       damage 为 Phase-A quantum scaffold，不是实际 channel / reveal / homing /
--       travel / interception / crit / corpse / full-R fidelity。
--       伤害公式必须为二元算术树：
--         add(const 650, mul(const 1.00, sub(read source.attr.ad.resolved,
--             read source.attr.ad.base)))。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step。
--
-- 候选：hero_skill|hero_caitlyn|R|让子弹飞
-- task key：wasm-generic-caitlyn-ace-in-the-hole-single-bullet-quantum
-- FROZEN_PLAN_REV=caitlyn-r-ace-in-the-hole-single-bullet-quantum-phase-a-v1
-- 已完成边界（completed / full boundary）：
--   rank3_selected_primary_champion_single_physical_bullet_quantum; immediate_impact_scaffold; physical_650_plus_1_00_bonus_ad; no_channel_lock_reveal_self_reveal_cancel_refund_short_cooldown_homing_projectile_travel_interception_first_enemy_geometry_crit_scaling_untargetable_resurrection_target_death_corpse_hit_sight_radius_unit_target_cancel_conditions_ability_lockout_other_ranks_or_full_fidelity
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_physical_damage
--   3. bonus_ad_ratio
--   4. immediate_impact_scaffold
--   （显式不包含暴击比率标签）
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20220/20260；
--      - game_entities(lol,hero_caitlyn)；
--      - attribute_definitions(lol,ad)；
--      - entity_attribute_values(lol,hero_caitlyn,ad)；
--    hero_caitlyn / ad / mana 是 external existing-data / check-only 依赖；当前仓库
--    没有任何 seed / materializer 物化 Caitlyn 身份 / 面板 / ad EAV / 资源行；本脚本
--    亦不物化身份/面板/资源值。勿用 Batch-B 前置依赖、sibling provider 或“本 seed
--    创建这些行”一类措辞描述该实体。
--    本 R seed 不要求 Caitlyn Q 或 E publication，但与既有/未来 Caitlyn P/Q/W/E/basic
--    行并存；不突变/删除/合成那些行（含既有 Piltover Peacemaker Q /
--    90 Caliber Net E）。不依赖 Q/E。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
--    仓库真相：physical damage type `20220`；add policy `20170`；`20230=provider_action/apply`
--    不得进入可执行图或 required reserved 列表（本 seed 亦不投影 20230）。
-- 5. 仅创建/挂载 provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum
--    （stable ID 族 hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum）及其隔离 R 图：
--    一个 provider、一个 active ability（ability_key=ace_in_the_hole_single_bullet_quantum）、
--    一个 cost、一个 cooldown、一个 null-duration impact phase + on_enter link、一个
--    sequence、恰好一个 direct-opponent champion noncritical/noncopyable physical
--    damage step/detail、一个 entity_provider_mounts。
--    零 Caitlyn R provider state / modifiers / listeners / matchers / repeats /
--    control / channel / projectile / geometry / interception / crit 行；
--    不创建 P/Q/W/E/basic 行。
-- 6. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；canonical generic ABI 无 channel / lock / reveal / cancel / refund /
-- short canceled cooldown / homing / travel / interception / first-enemy
-- geometry / crit scaling / untargetable / resurrection / target death /
-- corpse hit / sight radius / unit-target cancel / ability lockout 字段，
-- 故不编码这些表面，也不 claim 全保真）：
--   1s channel / channel locks；
--   target / self reveal / true sight / 4s buff；
--   cancel / interrupt / death / untargetable / mana refund /
--     5s canceled cooldown / resurrection；
--   homing / travel / destruction / interception / first-enemy geometry / range；
--   crit chance 0–30% / crit scaling；
--   target death / corpse continuation；
--   sight 1500；
--   unit-target cancel conditions / ability lockout；
--   ranks 1–2；P / Q / W / E / basic / siblings / loadout / on-hit；
--   identity / panel / resource definition-or-value bootstrap；
--   listener / state / event / modifier / repeat / control / channel /
--   projectile / geometry / interception / crit / sibling detail；
--   live migration；自动 publish；E2E；live / full fidelity。
--   One quantum, not full R.
--
-- 数值来源（League Wiki Template:Data Caitlyn/R → resolved
-- Template:Data Caitlyn/Ace in the Hole；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Caitlyn/R
--   resolved page Template:Data Caitlyn/Ace in the Hole
--   wiki pageId 1306918
--   revision id 3982561
--   revision timestamp 2026-01-09T09:02:59Z
--   canonical raw byte size 3119
--   canonical content SHA256
--     08b488c97fc694d9a3de711ffd4ea0b95fc1746c3a11b9c44b878844e586e8a8
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/caitlyn-r.json
--   siblings：pages/caitlyn-r.json（authoritative sidecar/pages in Wasm repo）
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/caitlyn-r.wikitext 亦为
--     3119-byte materialization，SHA256
--     015c1dbe8f02dd5ac354e6a6da6def878f1acccf788b1f599ee4bfd589e05003。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾。
--   rank-3 selected primary-champion single physical bullet quantum：
--     physical 650 + 100% bonus AD；mana 100；cooldown 90000ms。
--     源 wording：physical damage / (+ 100% bonus AD)。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime）：
--   base0/resolved0/A0=650；
--   base60/resolved60/A0=650；
--   base60/resolved160/A0=750；
--   base60/resolved160/A100 raw750/final375；
--   base60/resolved260/A100 raw850/final425；
--   base0/resolved100 vs base60/resolved160/A0 both750（bonus-AD proof：
--     equal bonus AD yields equal raw）；
--   mana300/base60/resolved160/HP1000/A100 at t0/t89999/t90000：
--     success, cooldown skip, success；two R damage items；
--     two automatic R ability_started；final mana100/HP250；
--   mana99 resource skip：unchanged mana/HP，no R damage/event evidence。
--   standalone provider：no P/Q/W/E/basic synthesis or unrelated provider
--     mutation；不要求 Caitlyn Q 或 E publication；与既有/未来 Caitlyn P/Q/W/E/basic
--     （含 Piltover Peacemaker Q / 90 Caliber Net E）并存且不突变。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_caitlyn + ad 属性定义与实体值 +
--       mana 资源定义与实体资源值（check-only / external existing-data；当前仓库
--       无 materializer）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-caitlyn-ace-in-the-hole-single-bullet-quantum-phase-a-v1-20260725

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
            'lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed: game_id=% missing in public.games',
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
            'lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed: failed to lock game_data_state for %',
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
            'lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_caitlyn（external existing-data；非本仓库物化；
    -- 非 Batch-B bootstrap claim；当前仓库无 materializer）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_caitlyn'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed: missing game_entities hero_caitlyn (external existing-data dependency; check-only; not materialized by a current repository seed)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed: missing attribute_definitions for game_id=% attr_key=ad (external existing-data; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_caitlyn'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_caitlyn_ace_in_the_hole_single_bullet_quantum_seed: missing entity_attribute_values hero_caitlyn/ad (external existing-data; check-only)';
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
    -- hero_caitlyn Ace in the Hole single-bullet-quantum（R rank-3）：独立
    -- provider + active impact 单次物理伤害（bonus AD）；standalone；不触碰
    -- P/Q/W/E/basic；与既有 Caitlyn Q/E 隔离
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum',
        20120,
        '凯特琳 R 让子弹飞 Ace in the Hole single-bullet-quantum（Phase-A v1 rank3 选定主冠军单发物理子弹量子）',
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
            'provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum',
            'r_mana_cost',
            '{"op":"const","value":100}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum',
            'r_cooldown_ms',
            '{"op":"const","value":90000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum',
            'ace_in_the_hole_single_bullet_quantum_damage',
            '{"op":"add","args":[{"op":"const","value":650},{"op":"mul","args":[{"op":"const","value":1.00},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}'::jsonb,
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
        'ability_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum',
        'provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum',
        'ace_in_the_hole_single_bullet_quantum',
        20130,
        '让子弹飞（R）',
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
        'cooldown_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum',
        'ability_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum',
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
        'phase_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_impact',
        'ability_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum',
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
        'sequence_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_impact',
        'provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum',
        'ace_in_the_hole_single_bullet_quantum_impact',
        '让子弹飞 impact（选定主冠军单发物理子弹量子）',
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
        'step_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_damage',
        'sequence_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_impact',
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
        'step_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_damage',
        'ace_in_the_hole_single_bullet_quantum_damage',
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
        'phase_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_impact',
        20260,
        'sequence_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum_impact',
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
        'hero_caitlyn',
        'provider_hero_caitlyn_r_ace_in_the_hole_single_bullet_quantum',
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
