-- =============================================================================
-- LoL generic Corki R Missile Barrage normal primary-hit seed
-- （飞机 R 火箭轰击 Phase-A v1 普通导弹选定主冠军第一敌人物理命中）
-- =============================================================================
--
-- 目标：在外部既有 hero_corki / ad 数据已存在的前提下，挂载独立 R
--       provider/active ability Missile Barrage normal primary hit：2000ms CD，
--       impact 对 opponent（champion）恰好执行一条 damage step/detail =
--       250 + 0.85 * (source.attr.ad.resolved - source.attr.ad.base)。
--       AD 为 bonus AD：运行时 sub(resolved, base)；不得直接读 total AD 作为
--       bonus 比率，亦不得省略 ad.base 减法。不要求 AP。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → damage）。Immediate selected-primary-champion
--       first-enemy normal-missile physical hit 为 Phase-A scaffold，不是实际
--       direction / projectile travel / collision / explosion AOE /
--       multitarget / Big One / third-shot cycle / double damage / range /
--       radius / periodic stock recharge / respawn refill / basic-attack
--       on-hit recharge reduction / crit scaling / Malignance / Eclipse /
--       full-R fidelity。
--       伤害公式必须为嵌套二元算术树（每个算术节点恰好二元；每条 read path
--       恰好一次）：
--         add(const 250, mul(const 0.85, sub(read source.attr.ad.resolved,
--             read source.attr.ad.base)))。
--       cast condition 精确：
--         gte(read source.resource.missile_barrage_ammo.current, const 1)。
--       成功 cast 由既有 runtime 自动发出 ability_started；本脚本不写显式
--       event step；无 R-specific type。
--
-- 候选：hero_skill|hero_corki|R|火箭轰击
-- task key：wasm-generic-corki-missile-barrage-normal-primary-hit
-- FROZEN_PLAN_REV=corki-r-missile-barrage-normal-primary-hit-phase-a-v1
-- 已完成边界（completed / full boundary）：
--   rank3_normal_missile_selected_primary_champion_first_enemy_hit; immediate_impact_scaffold; physical_250_plus_0_85_bonus_ad; cooldown2000ms; no_direction_projectile_travel_collision_explosion_aoe_multitarget_big_one_third_shot_cycle_double_damage_range_radius_periodic_stock_recharge_respawn_refill_basic_attack_on_hit_recharge_reduction_crit_scaling_malignance_eclipse_interaction_other_ranks_or_full_fidelity
-- Ordered tags：
--   1. ability_cooldown
--   2. active_physical_damage
--   3. bonus_ad_ratio
--   4. immediate_impact_scaffold
--   （显式不含 salvage tags；亦不含 meta_or_non_target_dps）
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Check-only、fail-closed 前置（每一项在图写入前均有显式 EXISTS/missing 检查）：
--      - game lol 与所需 reserved types：
--        20111/20112/20120/20130/20142/20150/20170/20220/20260；
--      - game_entities(lol,hero_corki)；
--      - attribute_definitions(lol,ad)；
--      - entity_attribute_values(lol,hero_corki,ad)；
--    hero_corki / ad 是 external existing-data / check-only 依赖；
--    当前仓库没有任何 seed / materializer 物化 Corki 身份 / 面板 / ad EAV；
--    本脚本亦不物化身份/面板/ad。勿用 Batch-B 前置依赖、
--    sibling provider、ensure-entity legacy seeds 或“本 seed 创建这些行”一类
--    措辞描述该实体；勿以 ensure-entity legacy seeds 为理由物化前置。
--    本 R seed 不要求/突变/合成/复制 P/Q/W/E/basic；仅挂载独立 R，与既有/
--    未来 Corki Q Phosphorus Bomb 并存且不突变。
-- 4. 禁止写入：不对 attribute_definitions / game_entities /
--    entity_attribute_values 做 INSERT/UPDATE/MERGE/DELETE。
--    允许 ensure 的共享行：仅从既有 reserved 投影 game-local types。
--    仓库真相：physical damage type `20220`；add policy `20170`；
--    `20230=provider_action/apply` 不得进入可执行图或 required reserved
--    列表（本 seed 亦不投影 20230）。
--    reserved type comments/checks include
--    `20111/20112/20120/20130/20142/20150/20170/20220/20260`；
--    explicitly forbid true-damage / apply `20230`（本仓库 20230 为
--    provider_action/apply，不得误用作 true damage）。
-- 5. 仅创建/挂载 provider_hero_corki_r_missile_barrage_normal_primary_hit
--    （stable ID 族 hero_corki_r_missile_barrage_normal_primary_hit）及其隔离 R 图：
--    一个 provider、一个 active ability（ability_key=missile_barrage_normal_primary_hit；
--    cast_condition_formula_key；cast_origin='champion'）、一个 cooldown、一个
--    null-duration impact phase + on_enter link、一个 sequence、恰好一条
--    damage effect step 和一条 damage detail，另有
--    entity_provider_mounts。
--    零 Corki R provider state / modifiers / listeners / matchers / repeats /
--    control / secondary / projectile / movement / geometry / AOE /
--    multitarget / Big One / third-shot / recharge / refill 行；不创建/突变/
--    合成/复制 P/Q/W/E/basic 行。
-- 6. R 无 ability-specific game-local type，不得新增 R 专用 62xxx type，不写
--    type_relations；不得携带/合成 sibling ability-specific types。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；均为 completed-boundary exclusions，不得实现或描述为
-- 近似；canonical generic ABI 无 direction / projectile travel / collision /
-- explosion AOE / multitarget / Big One / third-shot cycle / double damage /
-- range / radius / periodic stock recharge / respawn refill / basic-attack
-- on-hit recharge reduction / crit scaling / Malignance / Eclipse 字段，故不
-- 编码这些表面，也不 claim 全保真）：
--   direction / projectile travel / collision / explosion AOE / multitarget；
--   Big One / third-shot cycle / double damage；
--   range / radius；
--   periodic stock recharge / respawn refill；
--   basic-attack on-hit recharge reduction；
--   crit scaling / Malignance / Eclipse interaction；
--   ranks 1–2；P / Q / W / E / basic / siblings / loadout / bootstrap；
--   identity / panel / ad bootstrap；
--   listener / state / event / modifier / repeat / control / secondary /
--   projectile / movement / geometry / AOE / sibling detail；
--   live migration；自动 publish；E2E；live / full fidelity。
--   One normal-missile selected-primary first-enemy physical hit, not full R.
--
-- 数值来源（League Wiki Template:Data Corki/R → resolved
-- Template:Data Corki/Missile Barrage；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Corki/R
--   resolved page Template:Data Corki/Missile Barrage
--   wiki pageId 1306946
--   revision id 4042863
--   revision timestamp 2026-07-14T19:35:26Z
--   canonical raw byte size 3065
--   canonical content SHA256
--     1c2da7a1ea6bd4904c498eeb823e75dbf0f1e354cf5fe22f72dee2bb09ac4845
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/corki-r.json
--     authoritative normalized bytes 3265 / SHA256
--     dcaa1352eba2fa1d6c2acfc1aba9320bccb200b5b9d00dba559373e0981adbe0
--   siblings：pages/corki-r.json（authoritative sidecar/pages in Wasm repo）
--     pages bytes 691 / SHA256
--     694cda4c4d4ee4e9606ac1ca82a7085f89b7898884b23653bf718e86bfcd5bc7
--   local raw materialization caveat（非源矛盾）：仓库 local raw
--     数据参考/lol-wiki-current-champions/raw/corki-r.wikitext 为
--     3063-byte materialization，SHA256
--     3764aafcecd5ef76f619472e443869c2ef43fd5b062894f6e111172f9a5cf91a。
--     同 size 不等于等价；canonical 身份以 sidecar/pages 为准；本脚本不断言
--     local raw 与 canonical 字节等价，亦不主张源矛盾（仅 materialization /
--     serialization caveat）。
--   rank-3 normal missile selected primary-champion first-enemy hit：
--     physical 250 + 85% bonus AD；cooldown 2000ms。
--     源 wording：physical damage / (+ 85% bonus AD)。
--
-- 确定性 runtime 校验夹具（注释记录；本脚本不连 live / 不执行；本 SQL 测试亦不
-- 执行 runtime）：
--   base60/resolved60/armor0 raw/final250；
--   base60/resolved160/armor0 raw/final335；
--   base60/resolved160/armor100 raw335/final167.5；
--   bonusAD counterproof base0/resolved100 vs base60/resolved160/armor0
--     both335（bonus-AD proof：equal bonus AD yields equal raw）；
--   standalone provider：preserve existing P/Q/W/E/basic without requiring,
--     mutating, synthesizing or copying them；coexist with Corki Q
--     Phosphorus Bomb primary-impact。
--
-- 前置：reserved_types_seed.sql；外部既有 hero_corki + ad 属性定义与实体值
--       （check-only / external existing-data；当前仓库无 materializer）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-corki-missile-barrage-normal-primary-hit-phase-a-v1-20260726

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
        20112, -- selector/source
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
            'lol_generic_corki_missile_barrage_normal_primary_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_corki_missile_barrage_normal_primary_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_corki_missile_barrage_normal_primary_hit_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：外部既有 hero_corki（external existing-data；非本仓库物化；
    -- 非 Batch-B bootstrap claim；当前仓库无 materializer；不以 ensure-entity
    -- legacy seeds 为理由物化前置）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_corki'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_corki_missile_barrage_normal_primary_hit_seed: missing game_entities hero_corki (external existing-data dependency; check-only; not materialized by a current repository seed)';
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
            'lol_generic_corki_missile_barrage_normal_primary_hit_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_corki'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_corki_missile_barrage_normal_primary_hit_seed: missing entity_attribute_values hero_corki/ad (external existing-data; check-only)';
    END IF;



    -- reserved → game-local types（同 ID / 同 type_key / reserved_type_id=type_id）
    -- 本 seed 允许 ensure 的共享行；不物化身份/面板/ad
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
    -- hero_corki Missile Barrage normal primary-hit（R rank-3）：独立 provider +
    -- active impact 单次物理伤害（bonus AD）；standalone；不触碰
    -- P/Q/W/E/basic
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_corki_r_missile_barrage_normal_primary_hit',
        20120,
        '飞机 R 火箭轰击 Missile Barrage normal primary-hit（Phase-A v1 rank3 普通导弹选定主冠军第一敌人物理命中）',
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
            'provider_hero_corki_r_missile_barrage_normal_primary_hit',
            'missile_barrage_cast_condition',
            '{"op":"gte","args":[{"op":"read","path":"source.resource.missile_barrage_ammo.current"},{"op":"const","value":1}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_corki_r_missile_barrage_normal_primary_hit',
            'r_mana_cost',
            '{"op":"const","value":35}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_corki_r_missile_barrage_normal_primary_hit',
            'r_cooldown_ms',
            '{"op":"const","value":2000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_corki_r_missile_barrage_normal_primary_hit',
            'missile_barrage_ammo_delta',
            '{"op":"const","value":-1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_corki_r_missile_barrage_normal_primary_hit',
            'missile_barrage_normal_primary_hit_damage',
            '{"op":"add","args":[{"op":"const","value":250},{"op":"mul","args":[{"op":"const","value":0.85},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}'::jsonb,
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
        display_name, cast_condition_formula_key, cast_origin,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_corki_r_missile_barrage_normal_primary_hit',
        'provider_hero_corki_r_missile_barrage_normal_primary_hit',
        'missile_barrage_normal_primary_hit',
        20130,
        '火箭轰击（R）',
        'missile_barrage_cast_condition',
        'champion',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, ability_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        ability_key = EXCLUDED.ability_key,
        ability_kind_type_id = EXCLUDED.ability_kind_type_id,
        display_name = EXCLUDED.display_name,
        cast_condition_formula_key = EXCLUDED.cast_condition_formula_key,
        cast_origin = EXCLUDED.cast_origin,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_definitions.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.ability_definitions.ability_key IS DISTINCT FROM EXCLUDED.ability_key
       OR public.ability_definitions.ability_kind_type_id IS DISTINCT FROM EXCLUDED.ability_kind_type_id
       OR public.ability_definitions.display_name IS DISTINCT FROM EXCLUDED.display_name
       OR public.ability_definitions.cast_condition_formula_key IS DISTINCT FROM EXCLUDED.cast_condition_formula_key
       OR public.ability_definitions.cast_origin IS DISTINCT FROM EXCLUDED.cast_origin;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;


    INSERT INTO public.ability_cooldowns (
        game_id, cooldown_id, ability_id, duration_formula_key,
        starts_on_phase_id, group_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'cooldown_hero_corki_r_missile_barrage_normal_primary_hit',
        'ability_hero_corki_r_missile_barrage_normal_primary_hit',
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

    -- null-duration impact phase：assembler 产出立即 operation（Phase-A scaffold）
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_corki_r_missile_barrage_normal_primary_hit_impact',
        'ability_hero_corki_r_missile_barrage_normal_primary_hit',
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
        'sequence_hero_corki_r_missile_barrage_normal_primary_hit_impact',
        'provider_hero_corki_r_missile_barrage_normal_primary_hit',
        'missile_barrage_normal_primary_hit_impact',
        '火箭轰击 impact（普通导弹选定主冠军第一敌人物理命中）',
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

    -- step1：direct-opponent noncritical/noncopyable physical damage
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_corki_r_missile_barrage_normal_primary_hit_damage',
        'sequence_hero_corki_r_missile_barrage_normal_primary_hit_impact',
        1,
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
        'step_hero_corki_r_missile_barrage_normal_primary_hit_damage',
        'missile_barrage_normal_primary_hit_damage',
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
        'phase_hero_corki_r_missile_barrage_normal_primary_hit_impact',
        20260,
        'sequence_hero_corki_r_missile_barrage_normal_primary_hit_impact',
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
        'hero_corki',
        'provider_hero_corki_r_missile_barrage_normal_primary_hit',
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
