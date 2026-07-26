-- =============================================================================
-- LoL generic Jinx E Flame Chompers! selected-primary explosion-hit seed
-- （金克丝 E 嚼火者手雷！ Phase-A v1）
-- =============================================================================
--
-- 目标：在外部既有 hero_jinx / ap / mana 数据已存在的前提下，挂载独立 E
--       provider/active ability Flame Chompers! selected-primary champion
--       single magic explosion hit：90 mana、10000ms CD、impact 对 opponent
--       （champion）恰好一次 magic damage =
--       290 + 1.00 * source.attr.ap.resolved。
--       AP 为 source.attr.ap.resolved 直接读取，不得发明其它 AP 语义；
--       无关 AD 变化不得改变 E 伤害。
--       规范投影为立即主目标 impact + cooldown scaffold（null-duration phase
--       + on_enter sequence → 单一 damage 操作）。Immediate impact and cooldown
--       为 Phase-A scaffold，不是实际三枚 Chomper 布局 / 落地 / 武装 / 寿命 /
--       接触爆炸 timing。
--       伤害公式必须为二元算术树：
--         add(const 290, mul(const 1.00, read source.attr.ap.resolved))。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step。
--
-- 候选：hero_skill|hero_jinx|E|嚼火者手雷！
-- task key：wasm-generic-jinx-flame-chompers-primary-explosion-hit
-- FROZEN_PLAN_REV=jinx-e-flame-chompers-primary-explosion-hit-phase-a-v1
-- 已完成边界（completed / full boundary）：
--   rank5_selected_primary_champion_single_magic_explosion_hit; immediate_impact_and_cooldown_scaffold; magic_290_plus_1_00_ap; no_three_chomper_layout_landing_delay_arming_delay_five_second_lifetime_location_direction_range_geometry_area_multitarget_contact_acquisition_knockdown_root_one_chomper_per_champion_wind_wall_braum_spellshield_exception_vision_other_ranks_or_full_fidelity
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_magic_damage
--   3. ap_ratio
--   4. immediate_impact_scaffold
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20221/20260；
--      - game_entities(lol,hero_jinx)；
--      - attribute_definitions(lol,ap)；
--      - entity_attribute_values(lol,hero_jinx,ap)；
--      - resource_definitions(lol,mana)；
--      - entity_resource_values(lol,hero_jinx,mana)。
--    hero_jinx / ap / mana 是 external existing-data / check-only 依赖；当前仓库
--    没有任何 seed / materializer 物化 Jinx 身份 / 面板 / 资源行；本脚本亦不物化
--    身份/面板/资源值。勿用 Batch-B 前置依赖、sibling provider 或“本 seed 创建
--    这些行”一类措辞描述该实体。勿暗示 Jinx W Zap、Batch-B、sibling provider
--    或本 seed 创建这些行。本 E seed 不依赖/不突变既有 Jinx W Zap。
-- 4. 禁止写入：不对 attribute_definitions / resource_definitions / game_entities /
--    entity_attribute_values / entity_resource_values 做 INSERT/UPDATE/MERGE/DELETE。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
--    仓库真相：magic damage type `20221`；add policy `20170`；`20230=provider_action/apply`
--    不得进入可执行图或 required reserved 列表（本 seed 亦不投影 20230）。
-- 5. 仅创建/挂载 provider_hero_jinx_e_flame_chompers_primary_explosion_hit
--    （stable ID 族 hero_jinx_e_flame_chompers_primary_explosion_hit）及其隔离 E 图：
--    一个 provider、一个 active ability（ability_key=flame_chompers_primary_explosion_hit）、
--    一个 cost、一个 cooldown、一个 null-duration impact phase + on_enter link、
--    一个 sequence、恰好一个 direct-opponent magic damage step/detail、
--    一个 entity_provider_mounts。
--    零 Jinx E provider state / modifiers / listeners / matchers / repeats /
--    control / projectile / vision 行；不创建 P/Q/W/R/basic 行；不突变/依赖
--    既有 Jinx W Zap。
-- 6. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog；
--    不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；canonical generic ABI 无 three-Chomper layout/count/identity /
-- landing delay / arming delay / five-second lifetime / location / direction /
-- range / geometry / area / multitarget / contact / collision / acquisition /
-- knockdown / root / one-Chomper-per-champion / Wind Wall / Braum /
-- spell-shield exception / vision 字段，故不编码这些表面，也不 claim 全保真）：
--   three-Chomper layout / count / identity；
--   0.4s landing delay / 0.5s arming delay / 5s lifetime / delayed schedule；
--   target location / direction / range / geometry / radius / area / multitarget；
--   contact / collision / acquisition；
--   one-Chomper-per-champion；
--   knockdown / root / CC / control；
--   Wind Wall / Braum；
--   spell-shield exception；
--   vision；
--   ranks 1–4；P / Q / W / R / basic / loadout / bootstrap；
--   identity / panel / resource definition-or-value bootstrap；
--   listener / state / event / modifier / repeat / control / projectile /
--   vision / sibling detail；
--   live migration；自动 publish；E2E；full E / full-game fidelity。
--   本量子恰好是一次 selected-primary champion magic explosion-hit，不是主张
--   游戏内 E 只有一枚陷阱或一次总命中。
--
-- 数值来源（League Wiki Template:Data Jinx/E → resolved
-- Template:Data Jinx/Flame Chompers!；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Jinx/E
--   resolved page Template:Data Jinx/Flame Chompers!
--   wiki pageId 1307600
--   revision id 3993368
--   revision timestamp 2026-02-21T15:35:19Z
--   canonical raw byte size 1786
--   canonical content SHA256
--     64562ed4adb34c932810970fd9b9c016b46329d6f956541d334c60d2bc9d83ee
--   reviewed contract path（normalized authority）：
--     数据参考/lol-wiki-current-champions/normalized/generic/jinx-e.json
--     bytes2228 / SHA256
--     de7922f66deb96c8652dd1a0509105b49cdcf22278d1fd591bc366060987183a
--   siblings：pages/jinx-e.json
--     bytes694 / SHA256
--     f2822e5708dd024c582575a9298c12b6e6cd66b37e3365ea8749e8e1d49b360d
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/jinx-e.wikitext 为
--     1784-byte materialization，SHA256
--     aabb099fd172522682e40f0826e4971797c3a047787ef3c5af902bc4b673a551。
--     canonical 身份以 sidecar/pages 为准；本脚本不断言 local raw 与 canonical
--     字节等价，亦不主张源矛盾。
--   rank-5 selected-primary champion magic explosion hit：
--     magic 290 + 100% AP（AP = source.attr.ap.resolved）；
--     mana 90；cooldown 10000ms。源 wording：magic damage / (+ 100% AP)。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime）：
--   AP0 -> raw290；MR100 -> final145。
--   AP100 -> raw390；MR100 -> final195。
--   changing unrelated AD must not change E damage。
--   mana270/AP100/HP1000/MR100 at t0/t9999/t10000：
--     success, cooldown skip, success；two E damage items；
--     two automatic E ability_started；final mana90/HP610。
--   mana89 resource skip：unchanged mana/HP，no E damage/event。
--   standalone E：no P/Q/W/R/basic synthesis or unrelated provider mutation。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_jinx + ap 属性定义与实体值 +
--       mana 资源定义与实体资源值（check-only / external existing-data；当前仓库
--       无 materializer）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-jinx-flame-chompers-primary-explosion-hit-phase-a-v1-20260726

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
            'lol_generic_jinx_flame_chompers_primary_explosion_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_jinx_flame_chompers_primary_explosion_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_jinx_flame_chompers_primary_explosion_hit_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_jinx（external existing-data；非本仓库物化；
    -- 非 Batch-B bootstrap claim；当前仓库无 materializer）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_jinx'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_jinx_flame_chompers_primary_explosion_hit_seed: missing game_entities hero_jinx (external existing-data dependency; check-only; not materialized by a current repository seed)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_jinx_flame_chompers_primary_explosion_hit_seed: missing attribute_definitions for game_id=% attr_key=ap (external existing-data; check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_jinx'
           AND eav.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_jinx_flame_chompers_primary_explosion_hit_seed: missing entity_attribute_values hero_jinx/ap (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.resource_definitions rd
         WHERE rd.game_id = v_game_id
           AND rd.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_jinx_flame_chompers_primary_explosion_hit_seed: missing resource_definitions mana (external existing-data; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_resource_values erv
         WHERE erv.game_id = v_game_id
           AND erv.entity_id = 'hero_jinx'
           AND erv.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_jinx_flame_chompers_primary_explosion_hit_seed: missing entity_resource_values hero_jinx/mana (external existing-data; check-only)';
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
    -- hero_jinx Flame Chompers! primary explosion-hit（E rank-5）：独立 provider
    -- + active impact；单次魔法伤害（AP resolved）；standalone；不触碰 P/Q/W/R/basic
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_jinx_e_flame_chompers_primary_explosion_hit',
        20120,
        '金克丝 E 嚼火者手雷！ Flame Chompers! selected-primary explosion-hit（Phase-A v1 rank5）',
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
            'provider_hero_jinx_e_flame_chompers_primary_explosion_hit',
            'e_mana_cost',
            '{"op":"const","value":90}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_jinx_e_flame_chompers_primary_explosion_hit',
            'e_cooldown_ms',
            '{"op":"const","value":10000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_jinx_e_flame_chompers_primary_explosion_hit',
            'flame_chompers_primary_explosion_hit_damage',
            '{"op":"add","args":[{"op":"const","value":290},{"op":"mul","args":[{"op":"const","value":1.00},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
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
        'ability_hero_jinx_e_flame_chompers_primary_explosion_hit',
        'provider_hero_jinx_e_flame_chompers_primary_explosion_hit',
        'flame_chompers_primary_explosion_hit',
        20130,
        '嚼火者手雷！（E）',
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
        'cost_hero_jinx_e_flame_chompers_primary_explosion_hit_mana',
        'ability_hero_jinx_e_flame_chompers_primary_explosion_hit',
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
        'cooldown_hero_jinx_e_flame_chompers_primary_explosion_hit',
        'ability_hero_jinx_e_flame_chompers_primary_explosion_hit',
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

    -- null-duration impact phase：assembler 产出一次立即 operation（Phase-A scaffold）
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_jinx_e_flame_chompers_primary_explosion_hit_impact',
        'ability_hero_jinx_e_flame_chompers_primary_explosion_hit',
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
        'sequence_hero_jinx_e_flame_chompers_primary_explosion_hit_impact',
        'provider_hero_jinx_e_flame_chompers_primary_explosion_hit',
        'flame_chompers_primary_explosion_hit_impact',
        '嚼火者手雷！ impact（选定主冠军单次魔法爆炸命中）',
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
        'step_hero_jinx_e_flame_chompers_primary_explosion_hit_damage',
        'sequence_hero_jinx_e_flame_chompers_primary_explosion_hit_impact',
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
        'step_hero_jinx_e_flame_chompers_primary_explosion_hit_damage',
        'flame_chompers_primary_explosion_hit_damage',
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
        'phase_hero_jinx_e_flame_chompers_primary_explosion_hit_impact',
        20260,
        'sequence_hero_jinx_e_flame_chompers_primary_explosion_hit_impact',
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
        'hero_jinx',
        'provider_hero_jinx_e_flame_chompers_primary_explosion_hit',
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
