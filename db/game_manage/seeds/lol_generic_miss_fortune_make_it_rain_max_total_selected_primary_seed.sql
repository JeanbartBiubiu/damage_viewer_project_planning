-- =============================================================================
-- LoL generic Miss Fortune E Make It Rain max-duration total selected-primary
-- （厄运小姐 E 枪林弹雨 Phase-A v2 最大时长选定主冠军总魔法伤害聚合）
-- =============================================================================
--
-- 目标：在外部既有 hero_missfortune / ap / mana 数据已存在的前提下，挂载独立 E
--       provider/active ability Make It Rain max-duration total selected-primary：
--       80 mana、14000ms CD、impact 对 opponent（champion）恰好一次立即聚合的
--       noncrit/noncopyable magic damage 量子 =
--       190 + 1.20 * source.attr.ap.resolved。
--       AP 为 source.attr.ap.resolved 直接读取，不得发明其它 AP 语义；
--       无关 AD / crit 变化不得改变 E 伤害（公式不读 AD / crit）。
--       规范投影为立即聚合时长总额 scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作；CD 挂在 ability 级）。Immediate aggregated
--       duration-total selected-primary-champion magic damage scaffold 为
--       Phase-A，不是实际两秒时长 / 八 ticks / 0.25s tick schedule / location /
--       area / geometry / multitarget / sight / slow / dynamic slow refresh /
--       full-E fidelity。无 tick schedule。
--       伤害公式必须为嵌套二元算术树（每个算术节点恰好二元；AP read 恰好一次）：
--         add(const 190, mul(const 1.20, read source.attr.ap.resolved))。
--       CritEligible=false；CopyableOnHit=false。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step。
--
-- 候选：hero_skill|hero_missfortune|E|枪林弹雨
-- task key：wasm-generic-miss-fortune-make-it-rain-max-total-selected-primary
-- FROZEN_PLAN_REV=miss-fortune-e-make-it-rain-max-total-selected-primary-phase-a-v2
-- 已完成边界（completed / full boundary）：
--   rank5_selected_primary_champion_max_duration_total_magic_damage; immediate_aggregated_duration_total_scaffold; magic_190_plus_1_20_ap; mana80_cooldown14000ms; exactly_one_aggregated_damage_quantum; no_two_second_duration_eight_ticks_quarter_second_tick_schedule_location_area_geometry_multitarget_sight_slow_dynamic_slow_refresh_or_full_fidelity
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_magic_damage
--   3. ap_ratio
--   4. immediate_aggregated_duration_total_scaffold
--   （显式不包含 immediate_impact_scaffold；本 Phase-A 使用聚合时长总额 scaffold）
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进
--    （newest material-change-only seed shape）。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20221/20260
--        （显式含 20221=damage/magic 与 20170=value_policy/add；不含 20230）；
--      - game_entities(lol,hero_missfortune)；
--      - attribute_definitions(lol,ap)；
--      - entity_attribute_values(lol,hero_missfortune,ap)；
--      - resource_definitions(lol,mana)；
--      - entity_resource_values(lol,hero_missfortune,mana)。
--    hero_missfortune / ap / mana 是 external existing-data / check-only 依赖；
--    当前仓库没有任何 seed / materializer 物化 Miss Fortune 身份 / 面板 / 资源行；
--    本脚本亦不物化身份/面板/资源值。勿用 Batch-B 前置依赖、sibling provider 或
--    “本 seed 创建这些行”一类措辞描述该实体。勿暗示 Miss Fortune materializer
--    存在。本 E seed 与既有独立 R Bullet Time 并存且不突变/不复制；不创建/突变/
--    合成/复制 P/Q/W/R/basic。
-- 4. 禁止写入：不对 attribute_definitions / resource_definitions / game_entities /
--    entity_attribute_values / entity_resource_values 做 INSERT/UPDATE/MERGE/DELETE。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
--    仓库真相：magic damage type `20221`；add policy `20170`；`20230=provider_action/apply`
--    不得进入可执行图或 required reserved 列表（本 seed 亦不投影 20230）。
-- 5. 仅创建/挂载 provider_hero_missfortune_e_make_it_rain_max_total_selected_primary
--    （stable ID 族 hero_missfortune_e_make_it_rain_max_total_selected_primary）及其
--    隔离 E 图：一个 provider、一个 active ability
--    （ability_key=make_it_rain_max_total_selected_primary）、一个 cost、一个 cooldown、
--    一个 null-duration impact phase + on_enter link、一个 sequence、恰好一个
--    direct-opponent champion noncrit/noncopyable magic damage step/detail、
--    一个 entity_provider_mounts。
--    零 Miss Fortune E provider state / modifiers / listeners / matchers / repeats /
--    tick / control / scheduler / explicit event / E-specific type 行；不创建
--    P/Q/W/R/basic 行；不突变/复制既有独立 R provider。
-- 6. E 无 ability-specific game-local type，不得新增 E 专用 62xxx type，不写
--    type_relations；不得携带/合成 sibling ability-specific types。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog；
--    不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；canonical generic ABI 无 two-second duration / eight ticks /
-- quarter-second tick schedule / location / area / radius / acquisition /
-- geometry / multitarget / sight / slow / AP-scaled slow / refresh / cleanse /
-- spell-effects / persistent-area / interruption / animation 字段，故不编码这些
-- 表面，也不 claim 全保真）：
--   actual two seconds / eight ticks / 0.25s schedule / tick snapshot / rounding；
--   location / area / radius / acquisition / geometry / multi-target / sight；
--   slow / AP-scaled slow / refresh / cleanse；
--   spell-effects / persistent-area / interruption / animation；
--   ranks 1–4；P / Q / W / R / basic / loadout / full fidelity；
--   identity / panel / resource definition-or-value bootstrap；
--   listener / state / event / modifier / repeat / tick / control / scheduler /
--   sibling detail；
--   live migration；自动 publish；E2E；live / full fidelity。
--   One immediate aggregated max-duration total magic quantum, not full E.
--
-- 数值来源（League Wiki Template:Data Miss Fortune/E → resolved
-- Template:Data Miss Fortune/Make It Rain；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源；不以 legacy champion JSON 为真相）：
--   request Template:Data Miss Fortune/E
--   resolved page Template:Data Miss Fortune/Make It Rain
--   wiki pageId 1308255
--   revision id 3936384
--   revision timestamp 2025-07-24T15:45:56Z
--   canonical raw byte size 1210
--   canonical content SHA256
--     a38b513373be3b0491f7c967af8827dbdc9196452e5feb25614af3b78ab286f7
--   reviewed contract path（Wasm authority sidecar）：
--     数据参考/lol-wiki-current-champions/normalized/generic/missfortune-e.json
--     authoritative normalized bytes 1972 / SHA256
--     d53466f5d4e7e046620820cfd492133bcfac646e2d81d348dfcf544fe8174596
--   siblings：pages/missfortune-e.json（authoritative sidecar/pages in Wasm repo）
--     pages bytes 747 / SHA256
--     ac8ffb762ccb1667b7c3f955a60e418cb36553b1c653ebb6a70b613c4bf0a0dc
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/missfortune-e.wikitext 为
--     1210-byte materialization，SHA256
--     5a8800d1ca721f1583bb3d2c5581977a2e4942d399266ca3c745cd11e6503b7f。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾（仅 materialization /
--     serialization caveat）。
--   rank-5 selected-primary champion max-duration total magic：
--     Wiki total magic damage 190 + 120% AP，源可推导为 eight ticks
--     190/8 + (120/8)% AP over two seconds；本 Phase-A **仅**实现立即聚合总额
--     190 + 1.20*AP，无 tick schedule；mana 80；cooldown 14000ms；exactly one
--     aggregated damage quantum。
--     源 wording：magic damage / (+ 120% AP)。
--
-- 确定性代数夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不执行
-- runtime；JUnit 以静态 counterproof 复算）：
--   AP0 -> raw190；MR100 -> final95。
--   AP100 -> raw310；MR100 -> final155。
--   unrelated AD / crit inputs absent from formula；changing unrelated AD/crit
--     must not change E damage。
--   standalone E：coexist with but never mutate/duplicate existing standalone R；
--     no P/Q/W/R/basic synthesis。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_missfortune + ap 属性定义与实体值 +
--       mana 资源定义与实体资源值（check-only / external existing-data；当前仓库
--       无 Miss Fortune identity/panel/resource materializer）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-miss-fortune-make-it-rain-max-total-selected-primary-phase-a-v2-20260726

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
            'lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed: game_id=% missing in public.games',
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
            'lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed: failed to lock game_data_state for %',
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
            'lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_missfortune（external existing-data；非本仓库物化；
    -- 当前仓库无 Miss Fortune materializer）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_missfortune'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed: missing game_entities hero_missfortune (external existing-data dependency; check-only; not materialized by a current repository seed)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed: missing attribute_definitions for game_id=% attr_key=ap (external existing-data; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_missfortune'
           AND eav.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed: missing entity_attribute_values hero_missfortune/ap (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.resource_definitions rd
         WHERE rd.game_id = v_game_id
           AND rd.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed: missing resource_definitions mana (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_resource_values erv
         WHERE erv.game_id = v_game_id
           AND erv.entity_id = 'hero_missfortune'
           AND erv.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed: missing entity_resource_values hero_missfortune/mana (external existing-data; check-only)';
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
    -- hero_missfortune Make It Rain max-total selected-primary（E rank-5）：
    -- 独立 provider + active impact；单次立即聚合魔法伤害（AP resolved）；
    -- standalone；与既有 R 并存且不突变；不触碰 P/Q/W/R/basic
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_missfortune_e_make_it_rain_max_total_selected_primary',
        20120,
        '厄运小姐 E 枪林弹雨 Make It Rain max-duration total selected-primary（Phase-A v2 rank5）',
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
            'provider_hero_missfortune_e_make_it_rain_max_total_selected_primary',
            'e_mana_cost',
            '{"op":"const","value":80}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_missfortune_e_make_it_rain_max_total_selected_primary',
            'e_cooldown_ms',
            '{"op":"const","value":14000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_missfortune_e_make_it_rain_max_total_selected_primary',
            'make_it_rain_max_total_selected_primary_damage',
            '{"op":"add","args":[{"op":"const","value":190},{"op":"mul","args":[{"op":"const","value":1.20},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
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
        'ability_hero_missfortune_e_make_it_rain_max_total_selected_primary',
        'provider_hero_missfortune_e_make_it_rain_max_total_selected_primary',
        'make_it_rain_max_total_selected_primary',
        20130,
        '枪林弹雨（E）',
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
        'cost_hero_missfortune_e_make_it_rain_max_total_selected_primary_mana',
        'ability_hero_missfortune_e_make_it_rain_max_total_selected_primary',
        NULL,
        'mana',
        'e_mana_cost',
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
        'cooldown_hero_missfortune_e_make_it_rain_max_total_selected_primary',
        'ability_hero_missfortune_e_make_it_rain_max_total_selected_primary',
        'e_cooldown_ms',
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
        'phase_hero_missfortune_e_make_it_rain_max_total_selected_primary_impact',
        'ability_hero_missfortune_e_make_it_rain_max_total_selected_primary',
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
        'sequence_hero_missfortune_e_make_it_rain_max_total_selected_primary_impact',
        'provider_hero_missfortune_e_make_it_rain_max_total_selected_primary',
        'make_it_rain_max_total_selected_primary_impact',
        '枪林弹雨 impact（选定主冠军最大时长总魔法伤害聚合量子）',
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
        'step_hero_missfortune_e_make_it_rain_max_total_selected_primary_damage',
        'sequence_hero_missfortune_e_make_it_rain_max_total_selected_primary_impact',
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
        'step_hero_missfortune_e_make_it_rain_max_total_selected_primary_damage',
        'make_it_rain_max_total_selected_primary_damage',
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
        'phase_hero_missfortune_e_make_it_rain_max_total_selected_primary_impact',
        20260,
        'sequence_hero_missfortune_e_make_it_rain_max_total_selected_primary_impact',
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
        'provider_hero_missfortune_e_make_it_rain_max_total_selected_primary',
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
