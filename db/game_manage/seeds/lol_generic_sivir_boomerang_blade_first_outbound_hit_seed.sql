-- =============================================================================
-- LoL generic Sivir Q Boomerang Blade first-outbound-hit seed
-- （希维尔 Q 回旋之刃 Phase-A v3 选定主冠军首段出站单次物理命中）
-- =============================================================================
--
-- 目标：在外部既有 hero_sivir / ad / ap / crit_chance / mana 数据已存在的前提下，
--       挂载独立 Q provider/active ability Boomerang Blade first outbound hit：
--       75 mana、8000ms CD、impact 对 opponent（champion）恰好一次 physical
--       damage = (160 + 0.70 * bonusAD + 0.60 * AP)
--         * (1.00 + 0.40 * clamp01(crit_chance.resolved))。
--       AD 为 bonus AD：运行时 sub(resolved, base)；不得直接读 total AD 作为
--       bonus 比率，亦不得省略 ad.base 减法。AP 为 source.attr.ap.resolved
--       直接读取。crit_chance 为 source.attr.crit_chance.resolved 直接读取，
--       并在公式内以 binary min(1.00, max(0.00, …)) 做 0..1 clamp（formula-
--       local clamp；不检视/不断言 attribute_definitions 的 DB min/max 元数据）。
--       规范投影为立即主目标 impact + cooldown scaffold（null-duration phase +
--       on_enter sequence → 单一 damage 操作；CD 挂在 ability 级）。Immediate
--       selected-primary-champion first-outbound-hit physical damage/CD
--       scaffold 为 Phase-A，不是实际 cast time / bonus attack speed /
--       Effect at cast end / direction / range / width / geometry /
--       projectile travel / speeds / collision / nonchampion hit reduction /
--       return pass / damage modifier / direction-change reset /
--       once-per-pass state / spellshield / other ranks / full-Q fidelity。
--       伤害公式必须为嵌套二元算术树（每个算术/min/max 节点恰好二元；每条
--       read path 恰好一次）：
--         mul(add(add(const 160, mul(const 0.70, sub(read source.attr.ad.resolved,
--             read source.attr.ad.base))), mul(const 0.60,
--             read source.attr.ap.resolved)),
--             add(const 1.00, mul(const 0.40, min(const 1.00,
--             max(const 0.00, read source.attr.crit_chance.resolved)))))。
--       本伤害为 noncritical ability damage，其金额随 crit_chance 确定性缩放；
--       不写 crit pipeline 字段 / crit_damage / random crit / crit_eligible。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step。
--
-- 候选：hero_skill|hero_sivir|Q|回旋之刃
-- task key：wasm-generic-sivir-boomerang-blade-first-outbound-hit
-- FROZEN_PLAN_REV=sivir-q-boomerang-blade-first-outbound-hit-phase-a-v3
-- 已完成边界（completed / full boundary）：
--   rank5_selected_primary_champion_first_outbound_pass_single_physical_hit; immediate_impact_and_cooldown_scaffold; physical_base_160_plus_0_70_bonus_ad_plus_0_60_ap_scaled_by_0_to_0_40_formula_clamped_crit_chance; no_cast_time_bonus_attack_speed_direction_range_width_geometry_projectile_travel_speed_nonchampion_hit_reduction_return_pass_damage_modifier_reset_once_per_pass_spellshield_other_ranks_or_full_fidelity
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_physical_damage
--   3. bonus_ad_ratio
--   4. ap_ratio
--   5. crit_scaling
--   6. immediate_impact_scaffold
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进
--    （newest material-change-only seed shape）。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20220/20260
--        （显式含 20220=damage/physical 与 20170=value_policy/add；不含 20230）；
--      - game_entities(lol,hero_sivir)；
--      - attribute_definitions(lol,ad|ap|crit_chance)；
--      - entity_attribute_values(lol,hero_sivir,ad|ap|crit_chance)；
--      - resource_definitions(lol,mana)；
--      - entity_resource_values(lol,hero_sivir,mana)。
--    hero_sivir / ad / ap / crit_chance / mana 是 external existing-data /
--    check-only 依赖；本脚本不物化身份/面板/资源定义或实体值。当前仓库没有任何
--    seed / materializer 物化 Sivir 身份 / 面板 / ad/ap/crit_chance EAV / 资源行；
--    本脚本亦不物化。勿用 Batch-B 前置依赖、sibling provider、ensure-entity
--    legacy seeds 或“本 seed 创建这些行”一类措辞描述该实体；勿以 ensure-entity
--    legacy seeds 为理由物化前置。Backend prerequisite checks 是 publication
--    guard；generic runtime 对缺失 attr 读为 0，本脚本不断言该读路径 fail-closed。
--    不检视/不断言 crit_chance 的 DB min/max 元数据；clamp 仅在公式 AST 内。
--    本 Q seed 不要求/突变/复制/合成 P/W/E/R/basic。
-- 4. 禁止写入：不对 attribute_definitions / resource_definitions / game_entities /
--    entity_attribute_values / entity_resource_values 做 INSERT/UPDATE/MERGE/DELETE。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
--    仓库真相：physical damage type `20220`；add policy `20170`；`20230=provider_action/apply`
--    不得进入可执行图或 required reserved 列表（本 seed 亦不投影 20230）。
-- 5. 仅创建/挂载 provider_hero_sivir_q_boomerang_blade_first_outbound_hit
--    （stable ID 族 hero_sivir_q_boomerang_blade_first_outbound_hit）及其隔离 Q 图：
--    一个 provider、一个 active ability（ability_key=boomerang_blade_first_outbound_hit）、
--    一个 cost、一个 cooldown、一个 null-duration impact phase + on_enter link、一个
--    sequence、恰好一个 direct-opponent champion noncritical/noncopyable physical
--    damage step/detail、一个 entity_provider_mounts。
--    零 Sivir Q provider state / modifiers / listeners / matchers / repeats /
--    control / projectile / geometry / return / nonchampion / once-per-pass 行；
--    不创建/突变/合成/复制 P/W/E/R/basic 行；standalone isolation：仅 mount
--    本独立 Q，不合成任何 P/W/E/R/basic provider / state / modifier /
--    listener / control / secondary-target 结构（standalone sibling absence）。
-- 6. Q 无 ability-specific game-local type，不得新增 Q 专用 62xxx type，不写
--    type_relations；不得携带/合成 sibling ability-specific types。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；canonical generic ABI 无 cast time / bonus attack speed /
-- Effect at cast end / direction / range / width / geometry / projectile /
-- travel / speeds / collision / nonchampion hit reduction / return pass /
-- damage modifier / direction-change reset / once-per-pass / spellshield
-- 字段，故不编码这些表面，也不 claim 全保真）：
--   cast time / bonus attack speed / Effect at cast end；
--   direction / range / width / geometry；
--   projectile / travel / speeds / collision；
--   nonchampion hit reduction / cap；
--   direction-change reset；
--   return / equal second pass / total / return-after-death / homing /
--     once-per-pass state；
--   spellshield；
--   multi / secondary；
--   ranks 1–4；P / W / E / R / basic / loadout / on-hit；
--   identity / panel / resource definition-or-value bootstrap；
--   listener / state / event / modifier / repeat / control / projectile /
--   geometry / return / nonchampion / sibling detail；
--   crit pipeline / crit_damage / random crit / crit_eligible；
--   live migration；自动 publish；E2E；live / full fidelity。
--   One selected-primary first-outbound hit, not full Q.
--
-- 数值来源（League Wiki Template:Data Sivir/Q → resolved
-- Template:Data Sivir/Boomerang Blade；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Sivir/Q
--   resolved page Template:Data Sivir/Boomerang Blade
--   wiki pageId 1308837
--   revision id 4016378
--   revision timestamp 2026-05-11T05:05:57Z
--   canonical raw byte size 2745
--   canonical content SHA256
--     0adcf3916b63e8b0ae6c2c7ad74d1796e3362a3a22682c58ef92aaccfae43e5e
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/sivir-q.json
--     authoritative normalized bytes 3018 / SHA256
--     2320f7ada83cceee979c52cd314395c6b41e2f50c50e3114e9bca0d39386ff02
--   siblings：pages/sivir-q.json（authoritative sidecar/pages in Wasm repo）
--     pages bytes 691 / SHA256
--     adeab85889a4208b52f0b6cd3bcc3aef022a986dcad5168e1c817e3ab3323fa9
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/sivir-q.wikitext 为
--     2745-byte materialization，SHA256
--     b8d46412519f211b27f2575684693f407806cbbca337a80e775a1baf4c2396a4。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾（仅 materialization /
--     serialization caveat）。
--   rank-5 selected primary-champion first outbound-hit single physical hit：
--     physical 160 + 70% bonus AD + 60% AP，increased linearly 0–40% by crit
--     chance（critScaling=true；本 seed 以 formula-local clamp 实现确定性缩放，
--     非 random crit pipeline）；mana 75；cooldown 8000ms。
--     源 wording：physical damage / (+ 70% bonus AD) / (+ 60% AP) /
--     increased by 0–40% based on critical strike chance。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime）：
--   base60/resolved160/AP100/crit0/armor100 raw290/final145；
--   base60/resolved160/AP100/crit0.5/armor100 raw348/final174；
--   base60/resolved160/AP100/crit1/armor100 raw406/final203；
--   crit-0.25 clamps0 => raw290/final145；
--   crit1.25 clamps1 => raw406/final203；
--   base0/resolved100 vs base60/resolved160 at AP100/crit0 both290/145
--     （bonusAD counterproof：equal bonus AD yields equal raw/final）；
--   AP0 vs AP100 at bonusAD100/crit0 raw230 vs290（AP counterproof）；
--   mana225/base60/resolved160/AP100/crit0.5/HP1000/armor100 attempts
--     t0/t7999/t8000 -> success/cooldown skip/success；exactly two Q hits
--     and automatic starts；readyAt8000；final mana75/HP652；
--   mana74 t0 -> resource skip, unchanged mana/HP, no Q damage/start；
--   standalone isolation mounts only this Q and synthesizes no P/W/E/R/basic
--     provider, state, modifier, listener, control, or secondary-target
--     structure（standalone sibling absence）。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_sivir + ad/ap/crit_chance 属性定义
--       与实体值 + mana 资源定义与实体资源值（check-only / external existing-data；
--       本 seed 不物化；当前仓库无 Sivir identity/panel/resource materializer）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-sivir-boomerang-blade-first-outbound-hit-phase-a-v3-20260726

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
    v_required_attrs     text[] := ARRAY['ad', 'ap', 'crit_chance'];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_sivir_boomerang_blade_first_outbound_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_sivir_boomerang_blade_first_outbound_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_sivir_boomerang_blade_first_outbound_hit_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_sivir（external existing-data；本 seed 不物化；
    -- 非 Batch-B bootstrap claim；不以 ensure-entity legacy seeds 为理由物化前置；
    -- 当前仓库无 Sivir identity/panel/resource materializer；standalone sibling
    -- absence for P/W/E/R/basic）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_sivir'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_sivir_boomerang_blade_first_outbound_hit_seed: missing game_entities hero_sivir (external existing-data dependency; check-only; not materialized by this seed)';
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
            'lol_generic_sivir_boomerang_blade_first_outbound_hit_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_sivir'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_sivir_boomerang_blade_first_outbound_hit_seed: missing entity_attribute_values hero_sivir/ad (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_sivir'
           AND eav.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_sivir_boomerang_blade_first_outbound_hit_seed: missing entity_attribute_values hero_sivir/ap (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_sivir'
           AND eav.attr_key = 'crit_chance'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_sivir_boomerang_blade_first_outbound_hit_seed: missing entity_attribute_values hero_sivir/crit_chance (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.resource_definitions rd
         WHERE rd.game_id = v_game_id
           AND rd.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_sivir_boomerang_blade_first_outbound_hit_seed: missing resource_definitions mana (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_resource_values erv
         WHERE erv.game_id = v_game_id
           AND erv.entity_id = 'hero_sivir'
           AND erv.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_sivir_boomerang_blade_first_outbound_hit_seed: missing entity_resource_values hero_sivir/mana (external existing-data; check-only)';
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
    -- hero_sivir Boomerang Blade first outbound-hit（Q rank-5）：独立 provider +
    -- active impact 单次物理伤害（bonus AD + AP + formula-local crit_chance
    -- clamp scaling）；standalone；不触碰/合成 P/W/E/R/basic；无 Q 专用
    -- game-local type
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_sivir_q_boomerang_blade_first_outbound_hit',
        20120,
        '希维尔 Q 回旋之刃 Boomerang Blade first outbound-hit（Phase-A v3 rank5 选定主冠军首段出站单次物理命中）',
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
            'provider_hero_sivir_q_boomerang_blade_first_outbound_hit',
            'q_mana_cost',
            '{"op":"const","value":75}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_sivir_q_boomerang_blade_first_outbound_hit',
            'q_cooldown_ms',
            '{"op":"const","value":8000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_sivir_q_boomerang_blade_first_outbound_hit',
            'boomerang_blade_first_outbound_hit_damage',
            '{"op":"mul","args":[{"op":"add","args":[{"op":"add","args":[{"op":"const","value":160},{"op":"mul","args":[{"op":"const","value":0.70},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]},{"op":"mul","args":[{"op":"const","value":0.60},{"op":"read","path":"source.attr.ap.resolved"}]}]},{"op":"add","args":[{"op":"const","value":1.00},{"op":"mul","args":[{"op":"const","value":0.40},{"op":"min","args":[{"op":"const","value":1.00},{"op":"max","args":[{"op":"const","value":0.00},{"op":"read","path":"source.attr.crit_chance.resolved"}]}]}]}]}]}'::jsonb,
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
        'ability_hero_sivir_q_boomerang_blade_first_outbound_hit',
        'provider_hero_sivir_q_boomerang_blade_first_outbound_hit',
        'boomerang_blade_first_outbound_hit',
        20130,
        '回旋之刃（Q）',
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
        'cost_hero_sivir_q_boomerang_blade_first_outbound_hit_mana',
        'ability_hero_sivir_q_boomerang_blade_first_outbound_hit',
        NULL,
        'mana',
        'q_mana_cost',
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
        'cooldown_hero_sivir_q_boomerang_blade_first_outbound_hit',
        'ability_hero_sivir_q_boomerang_blade_first_outbound_hit',
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
        'phase_hero_sivir_q_boomerang_blade_first_outbound_hit_impact',
        'ability_hero_sivir_q_boomerang_blade_first_outbound_hit',
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
        'sequence_hero_sivir_q_boomerang_blade_first_outbound_hit_impact',
        'provider_hero_sivir_q_boomerang_blade_first_outbound_hit',
        'boomerang_blade_first_outbound_hit_impact',
        '回旋之刃 impact（选定主冠军首段出站单次物理命中）',
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
        'step_hero_sivir_q_boomerang_blade_first_outbound_hit_damage',
        'sequence_hero_sivir_q_boomerang_blade_first_outbound_hit_impact',
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
        'step_hero_sivir_q_boomerang_blade_first_outbound_hit_damage',
        'boomerang_blade_first_outbound_hit_damage',
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
        'phase_hero_sivir_q_boomerang_blade_first_outbound_hit_impact',
        20260,
        'sequence_hero_sivir_q_boomerang_blade_first_outbound_hit_impact',
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
        'hero_sivir',
        'provider_hero_sivir_q_boomerang_blade_first_outbound_hit',
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
