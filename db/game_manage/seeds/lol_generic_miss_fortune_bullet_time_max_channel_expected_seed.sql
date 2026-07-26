-- =============================================================================
-- LoL generic Miss Fortune R Bullet Time max-channel expected seed
-- （厄运小姐 R 弹幕时间 Phase-A v3 最大全通道选定主冠军期望总物理伤害）
-- =============================================================================
--
-- 目标：在外部既有 hero_missfortune / ad / ap / crit_chance / mana 数据已存在的
--       前提下，挂载独立 R provider/active ability Bullet Time max-channel
--       expected：100 mana、100000ms CD、impact 对 opponent（champion）恰好一次
--       physical damage 聚合量子 =
--         18 * (40 + 0.60 * totalAD + 0.25 * AP)
--           * (1.00 + 0.30 * clamp01(crit_chance.resolved))。
--       AD 为 total AD：运行时直接读取 source.attr.ad.resolved，不得减 base AD，
--       亦不得称为 bonus AD；仓库治理禁止 governed tag `total_ad_ratio`，total AD
--       仅显式出现在 boundary / reason / formula。AP 为 source.attr.ap.resolved
--       直接读取。crit_chance 为 source.attr.crit_chance.resolved 直接读取，
--       并在公式内以 binary min(1.00, max(0.00, …)) 做 0..1 clamp（formula-
--       local clamp；不检视/不断言 attribute_definitions 的 DB min/max 元数据）。
--       Wiki `{{critical damage|130|30}}` 表示 base wave crit 130% 外加 Infinity
--       Edge ratio；本 Phase-A **仅**实现 base130 expected crit（factor =
--       1 + 0.30 * clamped crit_chance），并 **显式排除** Wiki IE ratio 30；
--       绝不主张 Wiki 省略 IE。Wiki Maximum Total Physical Damage 为 noncrit
--       对照，不是本期望公式。
--       规范投影为立即聚合通道总额 scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作；CD 挂在 ability 级）。Immediate
--       max-full-channel selected-primary-champion expected total physical
--       damage scaffold 为 Phase-A，不是实际 channel timing / tick schedule /
--       interruption / cancel / direction / cone / six projectiles per wave /
--       collision / geometry / multitarget / wave-by-wave snapshot / dynamic
--       stats / sight / reveal / spellshield / RNG-on-crit / basic attack /
--       other ranks / full-R fidelity。
--       伤害公式必须为嵌套二元算术树（每个算术/min/max 节点恰好二元；每条
--       read path 恰好一次）：
--         mul(const 18, mul(add(add(const 40, mul(const 0.60,
--             read source.attr.ad.resolved)), mul(const 0.25,
--             read source.attr.ap.resolved)),
--             add(const 1.00, mul(const 0.30, min(const 1.00,
--             max(const 0.00, read source.attr.crit_chance.resolved))))))。
--       本伤害为 noncritical ability damage，其金额随 crit_chance 确定性缩放；
--       不写 crit pipeline 字段 / crit_damage / random crit / crit_eligible；
--       crit_eligible=false；copyable_on_hit=false。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step。
--
-- 候选：hero_skill|hero_missfortune|R|弹幕时间
-- task key：wasm-generic-miss-fortune-bullet-time-max-channel-expected
-- FROZEN_PLAN_REV=miss-fortune-r-bullet-time-max-channel-expected-phase-a-v3
-- 已完成边界（completed / full boundary）：
--   rank3_max_full_channel_selected_primary_champion_expected_total_physical_damage; immediate_aggregated_channel_total_scaffold; eighteen_waves; per_wave_40_plus_0_60_total_ad_plus_0_25_ap; base_wave_crit_multiplier_1_30; expected_factor_one_plus_0_30_times_formula_clamped_crit_chance; mana100_cooldown100000ms; exactly_one_aggregated_damage_quantum; phase_a_excludes_wiki_ie_crit_ratio_30; no_channel_timing_tick_schedule_interruption_cancel_direction_cone_six_projectiles_per_wave_collision_geometry_multitarget_wave_by_wave_snapshot_dynamic_stats_sight_reveal_spellshield_rng_on_crit_basic_attack_other_ranks_or_full_fidelity
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_physical_damage
--   3. ap_ratio
--   4. crit_scaling
--   5. immediate_aggregated_channel_total_scaffold
--   （显式不包含 total_ad_ratio；仓库治理禁止该 governed tag）
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进
--    （newest material-change-only seed shape）。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20220/20260
--        （显式含 20220=damage/physical 与 20170=value_policy/add；不含 20230）；
--      - game_entities(lol,hero_missfortune)；
--      - attribute_definitions(lol,ad|ap|crit_chance)；
--      - entity_attribute_values(lol,hero_missfortune,ad|ap|crit_chance)；
--      - resource_definitions(lol,mana)；
--      - entity_resource_values(lol,hero_missfortune,mana)。
--    hero_missfortune / ad / ap / crit_chance / mana 是 external existing-data /
--    check-only 依赖；本脚本不物化身份/面板/资源定义或实体值。当前仓库没有任何
--    seed / materializer 物化 Miss Fortune 身份 / 面板 / ad/ap/crit_chance EAV /
--    资源行；本脚本亦不物化。勿用 Batch-B 前置依赖、sibling provider、ensure-entity
--    legacy seeds 或“本 seed 创建这些行”一类措辞描述该实体；勿以 ensure-entity
--    legacy seeds 为理由物化前置。Backend prerequisite checks 是 publication
--    guard；generic runtime 对缺失 attr 读为 0，本脚本不断言该读路径 fail-closed。
--    不检视/不断言 crit_chance 的 DB min/max 元数据；clamp 仅在公式 AST 内。
--    本 R seed 不要求/突变/复制/合成 P/Q/W/E/basic；仅挂载独立 R，与既有/未来
--    Miss Fortune P/Q/W/E/basic 并存且不突变。
--    勿以 `数据参考/champion/MissFortune.json`（legacy DDragon）为当前真相。
-- 4. 禁止写入：不对 attribute_definitions / resource_definitions / game_entities /
--    entity_attribute_values / entity_resource_values 做 INSERT/UPDATE/MERGE/DELETE。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
--    仓库真相：physical damage type `20220`；add policy `20170`；`20230=provider_action/apply`
--    不得进入可执行图或 required reserved 列表（本 seed 亦不投影 20230）。
-- 5. 仅创建/挂载 provider_hero_missfortune_r_bullet_time_max_channel_expected
--    （stable ID 族 hero_missfortune_r_bullet_time_max_channel_expected）及其隔离 R 图：
--    一个 provider、一个 active ability（ability_key=bullet_time_max_channel_expected）、
--    一个 cost、一个 cooldown、一个 null-duration impact phase + on_enter link、一个
--    sequence、恰好一个 direct-opponent champion noncritical/noncopyable physical
--    damage step/detail、一个 entity_provider_mounts。
--    零 Miss Fortune R provider state / modifiers / listeners / matchers / repeats /
--    control / tick / channel timing / projectile / geometry / multitarget /
--    wave-by-wave / sibling 行；不创建/突变/合成/复制 P/Q/W/E/basic 行；
--    standalone isolation：仅 mount 本独立 R，不合成任何 P/Q/W/E/basic provider /
--    state / modifier / listener / control / secondary-target 结构（standalone
--    sibling absence）。
-- 6. R 无 ability-specific game-local type，不得新增 R 专用 62xxx type，不写
--    type_relations；不得携带/合成 sibling ability-specific types。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；canonical generic ABI 无 channel timing / tick schedule / interruption /
-- cancel / direction / cone / six projectiles per wave / collision / geometry /
-- multitarget / wave-by-wave snapshot / dynamic stats / sight / reveal /
-- spellshield / RNG-on-crit 字段，故不编码这些表面，也不 claim 全保真）：
--   channel timing / tick schedule / interruption / cancel；
--   direction / cone / six projectiles per wave / collision / geometry；
--   multitarget / wave-by-wave snapshot / dynamic stats；
--   sight / reveal / spellshield；
--   RNG-on-crit / crit pipeline / crit_damage / random crit；
--   Wiki IE crit ratio 30（Infinity Edge；本 Phase-A 显式排除；Wiki 含该 ratio）；
--   ranks 1–2；P / Q / W / E / basic / loadout / on-hit；
--   identity / panel / resource definition-or-value bootstrap；
--   listener / state / event / modifier / repeat / tick / control / projectile /
--   geometry / multitarget / sibling detail；
--   live migration；自动 publish；E2E；live / full fidelity。
--   One aggregated max-full-channel expected quantum, not full R.
--
-- 数值来源（League Wiki Template:Data Miss Fortune/R → resolved
-- Template:Data Miss Fortune/Bullet Time；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源；不以 legacy champion JSON 为真相）：
--   request Template:Data Miss Fortune/R
--   resolved page Template:Data Miss Fortune/Bullet Time
--   wiki pageId 1308257
--   revision id 3987215
--   revision timestamp 2026-01-25T03:47:11Z
--   canonical raw byte size 3021
--   canonical content SHA256
--     354cac88f79defa26369f485743f697bf61b50a814b008a8aa6c308b7e394d8a
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/missfortune-r.json
--     authoritative normalized bytes 3550 / SHA256
--     b275bcc7fb13855cf3fb5a7a8ca0cddce4964ed5713dc521eceb573e69b78c49
--   siblings：pages/missfortune-r.json（authoritative sidecar/pages in Wasm repo）
--     pages bytes 743 / SHA256
--     43bb41feafeaa7a8416bd91b81f51f4be73d3bf30ff78ccb2190fc317f3084d6
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/missfortune-r.wikitext 为
--     3021-byte materialization，SHA256
--     19ba845fd99a0da526b34e55c833f9902c0ce9feb55ad486a1d18c12b55a1049。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾（仅 materialization /
--     serialization caveat）。
--   rank-3 max full-channel selected primary-champion expected total physical：
--     18 waves；per-wave physical 40 + 60% total AD + 25% AP；base wave crit
--     130% → expected factor 1 + 0.30 * formula-clamped crit_chance；mana 100；
--     cooldown 100000ms；exactly one aggregated damage quantum。
--     源 wording：physical damage / (+ 60% AD) / (+ 25% AP) /
--     {{critical damage|130|30}}（Wiki 含 IE ratio；本 Phase-A 排除 IE）；
--     Wiki Maximum Total Physical Damage 为 noncrit 对照。
--
-- 确定性代数夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不执行
-- runtime；JUnit 以静态 counterproof 复算）：
--   totalAD100/AP0/crit0 => raw1800；
--   totalAD100/AP0/crit0.5 => raw2070；
--   totalAD100/AP0/crit1 => raw2340；
--   totalAD100/AP0/crit0.5/armor100 => final1035；
--   totalAD100/AP100/crit0.5 => raw2587.5；
--   crit-0.25 clamps0 => raw1800；
--   crit1.25 clamps1 => raw2340；
--   totalAD 读 ad.resolved 一次，不读 ad.base（total-AD counterproof：
--     base0/resolved100 vs base60/resolved100 both1800 at AP0/crit0）；
--   standalone isolation mounts only this R and synthesizes no P/Q/W/E/basic
--     provider, state, modifier, listener, control, or secondary-target
--     structure（standalone sibling absence）。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_missfortune + ad/ap/crit_chance
--       属性定义与实体值 + mana 资源定义与实体资源值（check-only / external
--       existing-data；本 seed 不物化；当前仓库无 Miss Fortune identity/panel/
--       resource materializer）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-miss-fortune-bullet-time-max-channel-expected-phase-a-v3-20260726

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
            'lol_generic_miss_fortune_bullet_time_max_channel_expected_seed: game_id=% missing in public.games',
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
            'lol_generic_miss_fortune_bullet_time_max_channel_expected_seed: failed to lock game_data_state for %',
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
            'lol_generic_miss_fortune_bullet_time_max_channel_expected_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_missfortune（external existing-data；本 seed 不物化；
    -- 非 Batch-B bootstrap claim；不以 ensure-entity legacy seeds 为理由物化前置；
    -- 当前仓库无 Miss Fortune identity/panel/resource materializer；standalone
    -- sibling absence for P/Q/W/E/basic；不以 MissFortune.json legacy DDragon 为真相）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_missfortune'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_miss_fortune_bullet_time_max_channel_expected_seed: missing game_entities hero_missfortune (external existing-data dependency; check-only; not materialized by this seed)';
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
            'lol_generic_miss_fortune_bullet_time_max_channel_expected_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_missfortune'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_miss_fortune_bullet_time_max_channel_expected_seed: missing entity_attribute_values hero_missfortune/ad (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_missfortune'
           AND eav.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_miss_fortune_bullet_time_max_channel_expected_seed: missing entity_attribute_values hero_missfortune/ap (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_missfortune'
           AND eav.attr_key = 'crit_chance'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_miss_fortune_bullet_time_max_channel_expected_seed: missing entity_attribute_values hero_missfortune/crit_chance (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.resource_definitions rd
         WHERE rd.game_id = v_game_id
           AND rd.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_miss_fortune_bullet_time_max_channel_expected_seed: missing resource_definitions mana (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_resource_values erv
         WHERE erv.game_id = v_game_id
           AND erv.entity_id = 'hero_missfortune'
           AND erv.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_miss_fortune_bullet_time_max_channel_expected_seed: missing entity_resource_values hero_missfortune/mana (external existing-data; check-only)';
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
    -- hero_missfortune Bullet Time max-channel expected（R rank-3）：独立
    -- provider + active impact 单次聚合物理期望伤害（total AD + AP +
    -- formula-local crit_chance clamp；Phase-A 排除 Wiki IE ratio 30）；
    -- standalone；不触碰/合成 P/Q/W/E/basic；无 R 专用 game-local type
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_missfortune_r_bullet_time_max_channel_expected',
        20120,
        '厄运小姐 R 弹幕时间 Bullet Time max-channel expected（Phase-A v3 rank3 最大全通道选定主冠军期望总物理伤害）',
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
            'provider_hero_missfortune_r_bullet_time_max_channel_expected',
            'r_mana_cost',
            '{"op":"const","value":100}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_missfortune_r_bullet_time_max_channel_expected',
            'r_cooldown_ms',
            '{"op":"const","value":100000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_missfortune_r_bullet_time_max_channel_expected',
            'bullet_time_max_channel_expected_damage',
            '{"op":"mul","args":[{"op":"const","value":18},{"op":"mul","args":[{"op":"add","args":[{"op":"add","args":[{"op":"const","value":40},{"op":"mul","args":[{"op":"const","value":0.60},{"op":"read","path":"source.attr.ad.resolved"}]}]},{"op":"mul","args":[{"op":"const","value":0.25},{"op":"read","path":"source.attr.ap.resolved"}]}]},{"op":"add","args":[{"op":"const","value":1.00},{"op":"mul","args":[{"op":"const","value":0.30},{"op":"min","args":[{"op":"const","value":1.00},{"op":"max","args":[{"op":"const","value":0.00},{"op":"read","path":"source.attr.crit_chance.resolved"}]}]}]}]}]}]}'::jsonb,
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
        'ability_hero_missfortune_r_bullet_time_max_channel_expected',
        'provider_hero_missfortune_r_bullet_time_max_channel_expected',
        'bullet_time_max_channel_expected',
        20130,
        '弹幕时间（R）',
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
        'cost_hero_missfortune_r_bullet_time_max_channel_expected_mana',
        'ability_hero_missfortune_r_bullet_time_max_channel_expected',
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
        'cooldown_hero_missfortune_r_bullet_time_max_channel_expected',
        'ability_hero_missfortune_r_bullet_time_max_channel_expected',
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

    -- null-duration impact phase：assembler 产出一次立即聚合 operation（Phase-A scaffold）
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_missfortune_r_bullet_time_max_channel_expected_impact',
        'ability_hero_missfortune_r_bullet_time_max_channel_expected',
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
        'sequence_hero_missfortune_r_bullet_time_max_channel_expected_impact',
        'provider_hero_missfortune_r_bullet_time_max_channel_expected',
        'bullet_time_max_channel_expected_impact',
        '弹幕时间 impact（最大全通道选定主冠军期望总物理伤害）',
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
        'step_hero_missfortune_r_bullet_time_max_channel_expected_damage',
        'sequence_hero_missfortune_r_bullet_time_max_channel_expected_impact',
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
        'step_hero_missfortune_r_bullet_time_max_channel_expected_damage',
        'bullet_time_max_channel_expected_damage',
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
        'phase_hero_missfortune_r_bullet_time_max_channel_expected_impact',
        20260,
        'sequence_hero_missfortune_r_bullet_time_max_channel_expected_impact',
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
        'hero_missfortune',
        'provider_hero_missfortune_r_bullet_time_max_channel_expected',
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
