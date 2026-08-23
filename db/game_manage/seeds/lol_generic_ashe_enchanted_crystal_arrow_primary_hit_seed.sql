-- =============================================================================
-- LoL generic Ashe R Enchanted Crystal Arrow primary-hit seed（寒冰射手 R 魔法水晶箭 Phase-A）
-- =============================================================================
--
-- 目标：幂等 ensure hero_ashe 最低必要基线，并挂载独立 R provider/active ability
--       Enchanted Crystal Arrow primary-hit：100 mana、60000ms CD、impact 对
--       opponent 恰好一次 magic damage = 600 + 1.20 * source.attr.ap.resolved。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）；不建模 Wiki cast time / Effect at cast
--       time start / 弹道 / 击晕 / 周围 AOE / Frost Shot / 视野。
--
-- 候选：hero_skill|hero_ashe|R|魔法水晶箭
-- FROZEN_PLAN_REV=ashe-r-enchanted-crystal-arrow-primary-hit-phase-a-v1
-- 已完成边界（completed / full boundary）：
--   rank3_primary_target_single_hit; immediate_impact_scaffold; magic_600_plus_1_20_ap; no_cast_delay_projectile_travel_collision_geometry_distance_stun_aoe_frost_or_sight
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / reserved_type / attribute_definitions(hp,mana,ad,ap,attack_speed,
--    armor,magic_resist,hp_regen,mana_regen) 缺失则 RAISE EXCEPTION 回滚。
--    恰好九键属性（含 AP）；seed 基线 AP=0。AP200 仅属测试夹具，本脚本不写入。
-- 4. 自包含 ensure hero_ashe 实体 + level-1 面板 + mana 资源（280/280）；
--    仅 mount 独立 provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit。与既有
--    provider_hero_ashe_rangers_focus（Q / 普攻 Focus-Flurry）与
--    provider_hero_ashe_w_volley（W Volley）并存：不 DELETE、不 UPDATE、不覆盖、
--    不重建、不挂载、不监听、不要求其事先发布。不触碰无关属性
--    （如 attack_range / move_speed / crit_*）。
-- 5. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog。
--
-- 明确排除（本脚本不建模；canonical generic ABI 无 cast-delay / projectile /
-- travel / collision / geometry / distance-stun / AOE / Frost / sight 字段，故
-- 不编码这些表面，也不 claim 全保真）：
--   Wiki cast time = 0.25 / Effect at cast time start（立即 scaffold 明确排除
--   而非近似）；projectile / travel / speed / collision / first-champion
--   acquisition / range / geometry / interception / spellshield；
--   distance-traveled stun / crowd-control / tenacity；
--   surrounding-enemy same-damage AOE；Frost Shot / slow；sight / reveal；
--   ranks 1–2；Q / W / P / basic Focus-Flurry / on-hit / equipment / loadout；
--   listener / state / event / modifier / repeat / control；
--   live migration；自动 publish；full fidelity。
--
-- 数值来源（League Wiki Template:Data Ashe/R → resolved
-- Template:Data Ashe/Enchanted Crystal Arrow；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Ashe/R
--   resolved page Template:Data Ashe/Enchanted Crystal Arrow
--   wiki pageId 1306811
--   revision id 4026934
--   revision timestamp 2026-06-10T19:09:50Z
--   canonical raw byte size 2394
--   canonical content SHA256
--     1d9ccefa98a41e57a088e76aaca16f7a78141e7373616520e2d6ba13f450664f
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/ashe-r.json
--   siblings：pages/ashe-r.json；raw/ashe-r.wikitext
--   local raw materialization caveat（非源矛盾）：仓库 local raw 为非规范
--     2393-byte materialization，SHA256
--     2bce161be04aa2cbe770a7402651929cfb3a7781d7a7ca828b93d1de68d4bb28；
--     既不裁剪其末端 LF、也不插入 CR 能复现 canonical。canonical 身份以
--     sidecar/pages 为准，本脚本不断言 local raw 等价，亦不主张源矛盾。
--   rank-3：magic 600 + 120% AP；mana 100；cooldown 60000ms。
--   夹具交叉核对（注释 only；非 seed 写入）：AP200 => raw840；target MR100 =>
--     mitigated420；t0 success / t59999 cooldown skip / t60000 success；
--     mana280->80；target HP1000->160。
--   英雄 level-1 面板（fixture/entity bootstrap；非 Wiki ability 真理；硬编码，
--     不在运行时读取 frozen JSON）：
--     hp610 mana280 ad59 ap0 AS0.658 armor26 MR30 hpregen3.5 manaregen7。
--     既有八键与 Ashe Q/W seed 字节一致；本脚本仅新增 AP=0。
--
-- 前置：reserved_types_seed.sql；所需 attribute_definitions 已存在。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-ashe-enchanted-crystal-arrow-primary-hit-phase-a-v1-20260723

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
        20221, -- damage/magic
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY[
        'hp', 'mana', 'ad', 'ap', 'attack_speed', 'armor', 'magic_resist',
        'hp_regen', 'mana_regen'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_ashe_enchanted_crystal_arrow_primary_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_ashe_enchanted_crystal_arrow_primary_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_ashe_enchanted_crystal_arrow_primary_hit_seed: missing reserved_type id(s): %',
            v_missing_reserved;
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
            'lol_generic_ashe_enchanted_crystal_arrow_primary_hit_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
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
    -- 自包含 ensure：hero_ashe 基线实体（已存在则不覆盖 display/description）
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_ashe',
        '艾希',
        '艾希 / Ashe（Enchanted Crystal Arrow primary-hit seed 自包含基线）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- level-1 面板（与 Ashe Q/W 八键字节一致；仅新增 AP=0；非 R 机制真理）
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'hero_ashe', 'hp', 610, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'mana', 280, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'ad', 59, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'attack_speed', 0.658, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'armor', 26, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'hp_regen', 3.5, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'mana_regen', 7, v_candidate, NOW())
    ON CONFLICT (game_id, entity_id, attr_key) DO UPDATE SET
        base_value = EXCLUDED.base_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_attribute_values.base_value IS DISTINCT FROM EXCLUDED.base_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;



    -- =========================================================================
    -- hero_ashe Enchanted Crystal Arrow primary-hit（R rank-3）：独立 provider +
    -- active impact 单次魔法伤害；不触碰 Rangers Focus / Volley provider
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit',
        20120,
        '艾希 R 魔法水晶箭 Enchanted Crystal Arrow primary-hit（Phase-A rank3 主目标）',
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
            'provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit',
            'r_mana_cost',
            '{"op":"const","value":100}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit',
            'r_cooldown_ms',
            '{"op":"const","value":60000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit',
            'enchanted_crystal_arrow_damage',
            '{"op":"add","args":[{"op":"const","value":600},{"op":"mul","args":[{"op":"const","value":1.20},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
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
        'ability_hero_ashe_r_enchanted_crystal_arrow_primary_hit',
        'provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit',
        'enchanted_crystal_arrow',
        20130,
        '魔法水晶箭（R）',
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
        'cooldown_hero_ashe_r_enchanted_crystal_arrow_primary_hit',
        'ability_hero_ashe_r_enchanted_crystal_arrow_primary_hit',
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

    -- null-duration impact phase：assembler 产出一次立即 operation
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact',
        'ability_hero_ashe_r_enchanted_crystal_arrow_primary_hit',
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
        'sequence_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact',
        'provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit',
        'enchanted_crystal_arrow_impact',
        '魔法水晶箭 impact（主目标单次魔法伤害）',
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
        'step_hero_ashe_r_enchanted_crystal_arrow_primary_hit_damage',
        'sequence_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact',
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
        'step_hero_ashe_r_enchanted_crystal_arrow_primary_hit_damage',
        'enchanted_crystal_arrow_damage',
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
        'phase_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact',
        20260,
        'sequence_hero_ashe_r_enchanted_crystal_arrow_primary_hit_impact',
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
        'hero_ashe',
        'provider_hero_ashe_r_enchanted_crystal_arrow_primary_hit',
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
