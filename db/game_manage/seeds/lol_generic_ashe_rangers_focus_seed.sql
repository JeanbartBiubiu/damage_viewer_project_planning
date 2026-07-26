-- =============================================================================
-- LoL generic Ashe shared P/Q seed（寒冰射手 P 冰霜射击 expectation-only Phase-A
-- + Q 射手的专注 Ranger's Focus rank-5 部分 ABI；共享普攻图）
-- =============================================================================
--
-- 目标：幂等写入 hero_ashe 及其共享 provider 上的通用普攻图 + Q 主动 Ranger's Focus：
--       Focus 四槽（focus_1..focus_4，max1 / 4000/5000/6000/7000ms /
--       refresh_duration）仅在 Flurry 未激活时由普攻武装；Q 仅在 Focus 合计 >= 4
--       时可施放（cast_condition_formula_key）；消耗 30 mana；清 Focus 并武装
--       flurry_active(6000ms) + flurry_first；rank-5 AS percent_add =
--       0.75 * provider.state.flurry_active（不用 modifier.condition_formula_key）；
--       Flurry 首发普攻 6×0.28 total AD、后续 5×0.28；每次普攻末尾恰好一次
--       emit_event(event/basic_attack_hit)。
--
-- P Phase-A（expectation-only；FROZEN_PLAN_REV=
-- ashe-p-frost-shot-expected-basic-attack-phase-a-v3）：
--   normal_basic_attack_expected_physical_damage;
--   separate_ability_basic_attack;
--   total_ad_times_one_plus_clamped_crit_chance_times_total_crit_multiplier_minus_one;
--   generic_expected_crit_settlement;
--   q_flurry_inactive_normal_attack_branch_only;
--   exactly_one_basic_attack_hit_event;
--   no_rng_crit_sequence_on_crit_event_frost_slow_critical_slow_duration_decay_
--   randuins_specific_acceptance_runaans_cheap_shot_q_flurry_damage_integration_
--   projectile_travel_attack_cadence_other_abilities_or_full_fidelity
--
--   普通分支 step_hero_ashe_ba_normal_damage：crit_eligible=true，公式仍为
--   basic_attack_damage = $owner.attr.ad；runtime EAV crit_chance=0 /
--   crit_damage=2.0（Patch 26.1 总暴击倍率基线；Infinity Edge +0.3 不在本 seed）。
--   全部 6 首发 + 5 后续 Flurry 箭矢行：crit_eligible=false。
--   fail-closed ensure game-local type_id=62003 type_key=ability/basic_attack
--   （reserved_type_id=NULL）并 type_relations 绑定 ability_hero_ashe_basic_attack。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / reserved_type / attribute_definitions(hp,mana,ad,attack_speed,
--    armor,magic_resist,hp_regen,mana_regen,crit_chance,crit_damage) 缺失则
--    RAISE EXCEPTION 回滚。不创建/新建 attribute_definitions。
-- 4. 本 seed 自包含 hero_ashe 基线 + 共享 provider 普攻/Q；幂等投影
--    resource_definitions.mana 与 entity_resource_values（280/280）；不依赖 Batch-B。
-- 5. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog。
-- 6. 不新建 P provider/ability；Q/Focus/Flurry/resource/sibling 共存语义不变。
--
-- 明确排除（本脚本不建模；P 仅 expectation-only，非 Frost Shot 完整保真）：
--   通用攻击计时器重置调度；箭矢飞行；Frost Shot / Critical Slow 减速与持续衰减；
--   RNG 暴击序列 / on-crit 事件；生命偷取；建筑物/多目标；技能轮转/节奏；
--   Randuin's / Runaan's / Cheap Shot；Q-Flurry 与 P 伤害集成；其它能力或
--   full-fidelity；其它 rank 数值表；live migration；自动 publish。
--   （共享 seed 不扩大 Q 已完成边界对 Frost Shot 保真的排除声明。）
--
-- Wiki 身份（P / Frost Shot；注释引用，无运行时外部依赖）：
--   request Template:Data Ashe/I → Template:Data Ashe/Frost Shot
--   page1306803 / rev4038216 / timestamp2026-06-30T07:27:41Z
--   canonical bytes1880 / SHA256
--     def2547f895e1533754e9265fd36f995a30258f11ca947cd737a70ea17df51da
--   normalized bytes2485 / SHA256
--     575de3e4c99f9a92d3edd4076d33586d4f96b4e4a8511ff5925617e526ff2e2a
--   pages bytes672 / SHA256
--     a8e2f81d77f85ad8d7a346ba9a3a3a354e675aa8cc9953765d5c6495f8bbd7ce
--   local raw bytes1880 / SHA256
--     5da5112e02a1c3aed266df1a424a33e8c4806c15d94991ec14c3bbaed2ca8378
--   （local raw 不断言与 canonical 等价。）
--
-- Q 数值来源（注释引用，无运行时外部依赖；2026-07-14 Meraki/Riot latest）：
--   https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions/Ashe.json
--   rank-5 Ranger's Focus：AS +75%（percent_add 0.75 * flurry_active）；
--   箭矢 0.28 * total AD；Flurry 6000ms；Q cost 30 mana；无普通 CD。
--   英雄 level-1 面板：hp610 mana280 ad59 AS0.658 armor26 MR30
--   hpregen3.5 manaregen7。
--
-- 前置：reserved_types_seed.sql；所需 attribute_definitions 已存在；
--       ability_definitions.cast_condition_formula_key 列已存在
--       （schema 或 generic_ability_cast_condition_compatibility_migration.sql）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-ashe-rangers-focus-v1-20260714

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
    v_conflict_type_key  text;
    v_conflict_type_id   integer;
    v_existing_name      text;
    v_existing_reserved  integer;
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20111, -- selector/opponent
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20150, -- operation/damage
        20158, -- operation/emit_event
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20173, -- value_policy/percent_add
        20181, -- match_mode/all
        20190, -- refresh_policy/refresh_duration
        20205, -- event/ability_started
        20211, -- event/basic_attack_hit
        20212, -- event/source_owner
        20220, -- damage/physical
        20250, -- state_scope/provider
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY[
        'hp', 'mana', 'ad', 'attack_speed', 'armor', 'magic_resist',
        'hp_regen', 'mana_regen', 'crit_chance', 'crit_damage'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_ashe_rangers_focus_seed: game_id=% missing in public.games',
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
            'lol_generic_ashe_rangers_focus_seed: failed to lock game_data_state for %',
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
            'lol_generic_ashe_rangers_focus_seed: missing reserved_type id(s): %',
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
            'lol_generic_ashe_rangers_focus_seed: missing attribute_definitions for game_id=% attr_key(s): %',
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
    -- game-local type 62003 / ability/basic_attack（reserved_type_id=NULL）
    -- Web 可选取独立特殊普攻；generic runtime 抑制普通 ability_started。
    -- =========================================================================
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62003
       AND (
           t.type_key IS DISTINCT FROM 'ability/basic_attack'
           OR t.reserved_type_id IS NOT NULL
       );

    IF FOUND THEN
        RAISE EXCEPTION
            'lol_generic_ashe_rangers_focus_seed: type_id=62003 already bound to type_key=% name=% reserved_type_id=% (expected ability/basic_attack, reserved_type_id=NULL)',
            v_conflict_type_key, v_existing_name, v_existing_reserved;
    END IF;

    SELECT t.type_id
      INTO v_conflict_type_id
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_key = 'ability/basic_attack'
       AND t.type_id IS DISTINCT FROM 62003;

    IF v_conflict_type_id IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_ashe_rangers_focus_seed: type_key=ability/basic_attack already bound to type_id=% (expected 62003)',
            v_conflict_type_id;
    END IF;

    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62003,
        'ability/basic_attack',
        'Basic attack ability',
        'Game-local tag for independent basic attack abilities used by Ashe P/Q shared graph.',
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, type_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- =========================================================================
    -- 自包含：hero_ashe 基线实体 + level-1 面板 + mana 资源投影
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_ashe',
        '艾希',
        '艾希 / Ashe（Ranger''s Focus seed 自包含基线）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.game_entities.display_name IS DISTINCT FROM EXCLUDED.display_name
       OR public.game_entities.description IS DISTINCT FROM EXCLUDED.description;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'hero_ashe', 'hp', 610, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'mana', 280, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'ad', 59, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'attack_speed', 0.658, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'armor', 26, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'hp_regen', 3.5, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'mana_regen', 7, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'crit_chance', 0, v_candidate, NOW()),
        (v_game_id, 'hero_ashe', 'crit_damage', 2.0, v_candidate, NOW())
    ON CONFLICT (game_id, entity_id, attr_key) DO UPDATE SET
        base_value = EXCLUDED.base_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_attribute_values.base_value IS DISTINCT FROM EXCLUDED.base_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- 幂等投影 mana 资源定义（其它 seed 仅写 attribute mana；Q cost 走 resource gate）
    INSERT INTO public.resource_definitions (
        game_id, resource_key, display_name,
        default_initial_value, default_max_value,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'mana',
        '法力',
        0,
        0,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, resource_key) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        default_initial_value = EXCLUDED.default_initial_value,
        default_max_value = EXCLUDED.default_max_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.resource_definitions.display_name IS DISTINCT FROM EXCLUDED.display_name
       OR public.resource_definitions.default_initial_value IS DISTINCT FROM EXCLUDED.default_initial_value
       OR public.resource_definitions.default_max_value IS DISTINCT FROM EXCLUDED.default_max_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_resource_values (
        game_id, entity_id, resource_key, initial_value, max_value,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_ashe',
        'mana',
        280,
        280,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id, resource_key) DO UPDATE SET
        initial_value = EXCLUDED.initial_value,
        max_value = EXCLUDED.max_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_resource_values.initial_value IS DISTINCT FROM EXCLUDED.initial_value
       OR public.entity_resource_values.max_value IS DISTINCT FROM EXCLUDED.max_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- =========================================================================
    -- 共享 provider：Q + 普攻共用 Focus/Flurry 状态
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_ashe_rangers_focus',
        20120,
        '艾希 Q 射手的专注 Ranger''s Focus',
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

    -- timed Focus slots + Flurry；focus_snapshot / flurry_first 无 duration（不写 default_value）
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES
        (v_game_id, 'provider_hero_ashe_rangers_focus', 'focus_1', 20100, 1, 4000, 20190, v_candidate, NOW()),
        (v_game_id, 'provider_hero_ashe_rangers_focus', 'focus_2', 20100, 1, 5000, 20190, v_candidate, NOW()),
        (v_game_id, 'provider_hero_ashe_rangers_focus', 'focus_3', 20100, 1, 6000, 20190, v_candidate, NOW()),
        (v_game_id, 'provider_hero_ashe_rangers_focus', 'focus_4', 20100, 1, 7000, 20190, v_candidate, NOW()),
        (v_game_id, 'provider_hero_ashe_rangers_focus', 'focus_snapshot', 20100, 4, NULL, NULL, v_candidate, NOW()),
        (v_game_id, 'provider_hero_ashe_rangers_focus', 'flurry_active', 20100, 1, 6000, 20190, v_candidate, NOW()),
        (v_game_id, 'provider_hero_ashe_rangers_focus', 'flurry_first', 20100, 1, NULL, NULL, v_candidate, NOW())
    ON CONFLICT (game_id, provider_id, state_key) DO UPDATE SET
        value_type_id = EXCLUDED.value_type_id,
        max_value = EXCLUDED.max_value,
        duration_ms = EXCLUDED.duration_ms,
        refresh_policy_type_id = EXCLUDED.refresh_policy_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_state_fields.value_type_id IS DISTINCT FROM EXCLUDED.value_type_id
       OR public.provider_state_fields.max_value IS DISTINCT FROM EXCLUDED.max_value
       OR public.provider_state_fields.duration_ms IS DISTINCT FROM EXCLUDED.duration_ms
       OR public.provider_state_fields.refresh_policy_type_id IS DISTINCT FROM EXCLUDED.refresh_policy_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'basic_attack_damage',
            '{"op":"read","path":"$owner.attr.ad"}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'focus_total_sum',
            '{"op":"add","args":[{"op":"add","args":[{"op":"read","path":"provider.state.focus_1"},{"op":"read","path":"provider.state.focus_2"}]},{"op":"add","args":[{"op":"read","path":"provider.state.focus_3"},{"op":"read","path":"provider.state.focus_4"}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'rangers_focus_cast_condition',
            '{"op":"gte","args":[{"op":"add","args":[{"op":"add","args":[{"op":"read","path":"provider.state.focus_1"},{"op":"read","path":"provider.state.focus_2"}]},{"op":"add","args":[{"op":"read","path":"provider.state.focus_3"},{"op":"read","path":"provider.state.focus_4"}]}]},{"op":"const","value":4}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'flurry_inactive',
            '{"op":"eq","args":[{"op":"read","path":"provider.state.flurry_active"},{"op":"const","value":0}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'flurry_first_branch',
            '{"op":"mul","args":[{"op":"gte","args":[{"op":"read","path":"provider.state.flurry_active"},{"op":"const","value":1}]},{"op":"gte","args":[{"op":"read","path":"provider.state.flurry_first"},{"op":"const","value":1}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'flurry_next_branch',
            '{"op":"mul","args":[{"op":"gte","args":[{"op":"read","path":"provider.state.flurry_active"},{"op":"const","value":1}]},{"op":"eq","args":[{"op":"read","path":"provider.state.flurry_first"},{"op":"const","value":0}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'focus_snap_eq_0',
            '{"op":"mul","args":[{"op":"eq","args":[{"op":"read","path":"provider.state.flurry_active"},{"op":"const","value":0}]},{"op":"eq","args":[{"op":"read","path":"provider.state.focus_snapshot"},{"op":"const","value":0}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'focus_snap_eq_1',
            '{"op":"mul","args":[{"op":"eq","args":[{"op":"read","path":"provider.state.flurry_active"},{"op":"const","value":0}]},{"op":"eq","args":[{"op":"read","path":"provider.state.focus_snapshot"},{"op":"const","value":1}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'focus_snap_eq_2',
            '{"op":"mul","args":[{"op":"eq","args":[{"op":"read","path":"provider.state.flurry_active"},{"op":"const","value":0}]},{"op":"eq","args":[{"op":"read","path":"provider.state.focus_snapshot"},{"op":"const","value":2}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'focus_snap_gte_3',
            '{"op":"mul","args":[{"op":"eq","args":[{"op":"read","path":"provider.state.flurry_active"},{"op":"const","value":0}]},{"op":"gte","args":[{"op":"read","path":"provider.state.focus_snapshot"},{"op":"const","value":3}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'focus_slot_one',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'focus_slot_zero',
            '{"op":"const","value":0}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'flurry_arrow_damage',
            '{"op":"mul","args":[{"op":"const","value":0.28},{"op":"read","path":"source.attr.ad.resolved"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'rangers_focus_attack_speed',
            '{"op":"mul","args":[{"op":"const","value":0.75},{"op":"read","path":"provider.state.flurry_active"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_ashe_rangers_focus',
            'q_mana_cost',
            '{"op":"const","value":30}'::jsonb,
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

    -- provider-bound attack_speed percent_add（可用性由公式内 flurry_active 表达；condition NULL）
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'modifier_hero_ashe_rangers_focus_attack_speed',
        'provider_hero_ashe_rangers_focus',
        'rangers_focus_attack_speed',
        NULL,
        20110,
        'attack_speed',
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        20173,
        'rangers_focus_attack_speed',
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, modifier_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        modifier_key = EXCLUDED.modifier_key,
        modifier_type_id = EXCLUDED.modifier_type_id,
        target_selector_type_id = EXCLUDED.target_selector_type_id,
        target_attr_key = EXCLUDED.target_attr_key,
        command_type_id = EXCLUDED.command_type_id,
        channel_type_id = EXCLUDED.channel_type_id,
        bucket_type_id = EXCLUDED.bucket_type_id,
        stage_type_id = EXCLUDED.stage_type_id,
        priority = EXCLUDED.priority,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        value_formula_key = EXCLUDED.value_formula_key,
        condition_formula_key = EXCLUDED.condition_formula_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_modifiers.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.provider_modifiers.modifier_key IS DISTINCT FROM EXCLUDED.modifier_key
       OR public.provider_modifiers.modifier_type_id IS DISTINCT FROM EXCLUDED.modifier_type_id
       OR public.provider_modifiers.target_selector_type_id IS DISTINCT FROM EXCLUDED.target_selector_type_id
       OR public.provider_modifiers.target_attr_key IS DISTINCT FROM EXCLUDED.target_attr_key
       OR public.provider_modifiers.command_type_id IS DISTINCT FROM EXCLUDED.command_type_id
       OR public.provider_modifiers.channel_type_id IS DISTINCT FROM EXCLUDED.channel_type_id
       OR public.provider_modifiers.bucket_type_id IS DISTINCT FROM EXCLUDED.bucket_type_id
       OR public.provider_modifiers.stage_type_id IS DISTINCT FROM EXCLUDED.stage_type_id
       OR public.provider_modifiers.priority IS DISTINCT FROM EXCLUDED.priority
       OR public.provider_modifiers.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id
       OR public.provider_modifiers.value_formula_key IS DISTINCT FROM EXCLUDED.value_formula_key
       OR public.provider_modifiers.condition_formula_key IS DISTINCT FROM EXCLUDED.condition_formula_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- =========================================================================
    -- 普攻 ability + impact phase + 单一 impact 序列（含 Focus / Flurry / emit）
    -- =========================================================================
    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, cast_condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_ashe_basic_attack',
        'provider_hero_ashe_rangers_focus',
        'basic_attack',
        20130,
        '普攻',
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, ability_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        ability_key = EXCLUDED.ability_key,
        ability_kind_type_id = EXCLUDED.ability_kind_type_id,
        display_name = EXCLUDED.display_name,
        cast_condition_formula_key = EXCLUDED.cast_condition_formula_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_definitions.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.ability_definitions.ability_key IS DISTINCT FROM EXCLUDED.ability_key
       OR public.ability_definitions.ability_kind_type_id IS DISTINCT FROM EXCLUDED.ability_kind_type_id
       OR public.ability_definitions.display_name IS DISTINCT FROM EXCLUDED.display_name
       OR public.ability_definitions.cast_condition_formula_key IS DISTINCT FROM EXCLUDED.cast_condition_formula_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.type_relations (
        game_id, type_id, target_category, target_id, extend,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62003,
        'ability',
        'ability_hero_ashe_basic_attack',
        '{"role":"basic_attack"}'::jsonb,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, type_id, target_category, target_id) DO UPDATE SET
        extend = EXCLUDED.extend,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.type_relations.extend IS DISTINCT FROM EXCLUDED.extend;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_ashe_basic_attack_impact',
        'ability_hero_ashe_basic_attack',
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
        'sequence_hero_ashe_basic_attack_impact',
        'provider_hero_ashe_rangers_focus',
        'basic_attack_impact',
        '艾希普攻结算（Focus / Flurry / emit）',
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

    -- deferred exactly-one-detail：damage / state_change / emit_event 各配一 detail
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_ashe_ba_normal_damage',
            'sequence_hero_ashe_basic_attack_impact',
            0,
            20150,
            20111,
            'flurry_inactive',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_snapshot',
            'sequence_hero_ashe_basic_attack_impact',
            1,
            20160,
            20110,
            'flurry_inactive',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b0_s1',
            'sequence_hero_ashe_basic_attack_impact',
            2,
            20160,
            20110,
            'focus_snap_eq_0',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b0_s2',
            'sequence_hero_ashe_basic_attack_impact',
            3,
            20160,
            20110,
            'focus_snap_eq_0',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b0_s3',
            'sequence_hero_ashe_basic_attack_impact',
            4,
            20160,
            20110,
            'focus_snap_eq_0',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b0_s4',
            'sequence_hero_ashe_basic_attack_impact',
            5,
            20160,
            20110,
            'focus_snap_eq_0',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b1_s1',
            'sequence_hero_ashe_basic_attack_impact',
            6,
            20160,
            20110,
            'focus_snap_eq_1',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b1_s2',
            'sequence_hero_ashe_basic_attack_impact',
            7,
            20160,
            20110,
            'focus_snap_eq_1',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b1_s3',
            'sequence_hero_ashe_basic_attack_impact',
            8,
            20160,
            20110,
            'focus_snap_eq_1',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b1_s4',
            'sequence_hero_ashe_basic_attack_impact',
            9,
            20160,
            20110,
            'focus_snap_eq_1',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b2_s1',
            'sequence_hero_ashe_basic_attack_impact',
            10,
            20160,
            20110,
            'focus_snap_eq_2',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b2_s2',
            'sequence_hero_ashe_basic_attack_impact',
            11,
            20160,
            20110,
            'focus_snap_eq_2',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b2_s3',
            'sequence_hero_ashe_basic_attack_impact',
            12,
            20160,
            20110,
            'focus_snap_eq_2',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b2_s4',
            'sequence_hero_ashe_basic_attack_impact',
            13,
            20160,
            20110,
            'focus_snap_eq_2',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b3_s1',
            'sequence_hero_ashe_basic_attack_impact',
            14,
            20160,
            20110,
            'focus_snap_gte_3',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b3_s2',
            'sequence_hero_ashe_basic_attack_impact',
            15,
            20160,
            20110,
            'focus_snap_gte_3',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b3_s3',
            'sequence_hero_ashe_basic_attack_impact',
            16,
            20160,
            20110,
            'focus_snap_gte_3',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b3_s4',
            'sequence_hero_ashe_basic_attack_impact',
            17,
            20160,
            20110,
            'focus_snap_gte_3',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_1',
            'sequence_hero_ashe_basic_attack_impact',
            18,
            20150,
            20111,
            'flurry_first_branch',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_2',
            'sequence_hero_ashe_basic_attack_impact',
            19,
            20150,
            20111,
            'flurry_first_branch',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_3',
            'sequence_hero_ashe_basic_attack_impact',
            20,
            20150,
            20111,
            'flurry_first_branch',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_4',
            'sequence_hero_ashe_basic_attack_impact',
            21,
            20150,
            20111,
            'flurry_first_branch',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_5',
            'sequence_hero_ashe_basic_attack_impact',
            22,
            20150,
            20111,
            'flurry_first_branch',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_6',
            'sequence_hero_ashe_basic_attack_impact',
            23,
            20150,
            20111,
            'flurry_first_branch',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_next_1',
            'sequence_hero_ashe_basic_attack_impact',
            24,
            20150,
            20111,
            'flurry_next_branch',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_next_2',
            'sequence_hero_ashe_basic_attack_impact',
            25,
            20150,
            20111,
            'flurry_next_branch',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_next_3',
            'sequence_hero_ashe_basic_attack_impact',
            26,
            20150,
            20111,
            'flurry_next_branch',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_next_4',
            'sequence_hero_ashe_basic_attack_impact',
            27,
            20150,
            20111,
            'flurry_next_branch',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_next_5',
            'sequence_hero_ashe_basic_attack_impact',
            28,
            20150,
            20111,
            'flurry_next_branch',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_clear',
            'sequence_hero_ashe_basic_attack_impact',
            29,
            20160,
            20110,
            'flurry_first_branch',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_emit_hit',
            'sequence_hero_ashe_basic_attack_impact',
            30,
            20158,
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
        copyable_on_hit, crit_eligible, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_ashe_ba_normal_damage',
            'basic_attack_damage',
            20220,
            20170,
            false,
            true,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_1',
            'flurry_arrow_damage',
            20220,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_2',
            'flurry_arrow_damage',
            20220,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_3',
            'flurry_arrow_damage',
            20220,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_4',
            'flurry_arrow_damage',
            20220,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_5',
            'flurry_arrow_damage',
            20220,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_6',
            'flurry_arrow_damage',
            20220,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_next_1',
            'flurry_arrow_damage',
            20220,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_next_2',
            'flurry_arrow_damage',
            20220,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_next_3',
            'flurry_arrow_damage',
            20220,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_next_4',
            'flurry_arrow_damage',
            20220,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_next_5',
            'flurry_arrow_damage',
            20220,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        amount_formula_key = EXCLUDED.amount_formula_key,
        damage_type_id = EXCLUDED.damage_type_id,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        copyable_on_hit = EXCLUDED.copyable_on_hit,
        crit_eligible = EXCLUDED.crit_eligible,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.damage_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.damage_effect_details.damage_type_id IS DISTINCT FROM EXCLUDED.damage_type_id
       OR public.damage_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id
       OR public.damage_effect_details.copyable_on_hit IS DISTINCT FROM EXCLUDED.copyable_on_hit
       OR public.damage_effect_details.crit_eligible IS DISTINCT FROM EXCLUDED.crit_eligible;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_ashe_ba_focus_snapshot',
            20250,
            'focus_snapshot',
            'focus_total_sum',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b0_s1',
            20250,
            'focus_1',
            'focus_slot_one',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b0_s2',
            20250,
            'focus_2',
            'focus_slot_zero',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b0_s3',
            20250,
            'focus_3',
            'focus_slot_zero',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b0_s4',
            20250,
            'focus_4',
            'focus_slot_zero',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b1_s1',
            20250,
            'focus_1',
            'focus_slot_one',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b1_s2',
            20250,
            'focus_2',
            'focus_slot_one',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b1_s3',
            20250,
            'focus_3',
            'focus_slot_zero',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b1_s4',
            20250,
            'focus_4',
            'focus_slot_zero',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b2_s1',
            20250,
            'focus_1',
            'focus_slot_one',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b2_s2',
            20250,
            'focus_2',
            'focus_slot_one',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b2_s3',
            20250,
            'focus_3',
            'focus_slot_one',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b2_s4',
            20250,
            'focus_4',
            'focus_slot_zero',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b3_s1',
            20250,
            'focus_1',
            'focus_slot_one',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b3_s2',
            20250,
            'focus_2',
            'focus_slot_one',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b3_s3',
            20250,
            'focus_3',
            'focus_slot_one',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_focus_b3_s4',
            20250,
            'focus_4',
            'focus_slot_one',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_ba_flurry_first_clear',
            20250,
            'flurry_first',
            'focus_slot_zero',
            20172,
            v_candidate,
            NOW()
        )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        state_scope_type_id = EXCLUDED.state_scope_type_id,
        state_key = EXCLUDED.state_key,
        amount_formula_key = EXCLUDED.amount_formula_key,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.state_effect_details.state_scope_type_id IS DISTINCT FROM EXCLUDED.state_scope_type_id
       OR public.state_effect_details.state_key IS DISTINCT FROM EXCLUDED.state_key
       OR public.state_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.state_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.event_effect_details (
        game_id, step_id, event_type_id, event_ref, payload, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_ashe_ba_emit_hit',
        20211,
        'event_ref_hero_ashe_basic_attack_hit',
        '{}'::jsonb,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        event_type_id = EXCLUDED.event_type_id,
        event_ref = EXCLUDED.event_ref,
        payload = EXCLUDED.payload,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.event_effect_details.event_type_id IS DISTINCT FROM EXCLUDED.event_type_id
       OR public.event_effect_details.event_ref IS DISTINCT FROM EXCLUDED.event_ref
       OR public.event_effect_details.payload IS DISTINCT FROM EXCLUDED.payload;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_phase_effect_sequences (
        game_id, phase_id, trigger_type_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_ashe_basic_attack_impact',
        20260,
        'sequence_hero_ashe_basic_attack_impact',
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

    -- =========================================================================
    -- Q active：cast_condition + 30 mana cost；ability_started listener 清 Focus / 武装 Flurry
    -- =========================================================================
    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, cast_condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_ashe_q_rangers_focus',
        'provider_hero_ashe_rangers_focus',
        'rangers_focus',
        20130,
        '射手的专注（Q）',
        'rangers_focus_cast_condition',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, ability_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        ability_key = EXCLUDED.ability_key,
        ability_kind_type_id = EXCLUDED.ability_kind_type_id,
        display_name = EXCLUDED.display_name,
        cast_condition_formula_key = EXCLUDED.cast_condition_formula_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.ability_definitions.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.ability_definitions.ability_key IS DISTINCT FROM EXCLUDED.ability_key
       OR public.ability_definitions.ability_kind_type_id IS DISTINCT FROM EXCLUDED.ability_kind_type_id
       OR public.ability_definitions.display_name IS DISTINCT FROM EXCLUDED.display_name
       OR public.ability_definitions.cast_condition_formula_key IS DISTINCT FROM EXCLUDED.cast_condition_formula_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.ability_costs (
        game_id, cost_id, ability_id, phase_id, resource_key,
        amount_formula_key, allow_partial, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'cost_hero_ashe_q_rangers_focus_mana',
        'ability_hero_ashe_q_rangers_focus',
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

    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_ashe_q_on_cast',
        'provider_hero_ashe_rangers_focus',
        'rangers_focus_on_cast',
        '射手的专注施放结算',
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

    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_ashe_q_clear_focus_1',
            'sequence_hero_ashe_q_on_cast',
            0,
            20160,
            20110,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_q_clear_focus_2',
            'sequence_hero_ashe_q_on_cast',
            1,
            20160,
            20110,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_q_clear_focus_3',
            'sequence_hero_ashe_q_on_cast',
            2,
            20160,
            20110,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_q_clear_focus_4',
            'sequence_hero_ashe_q_on_cast',
            3,
            20160,
            20110,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_q_clear_focus_snapshot',
            'sequence_hero_ashe_q_on_cast',
            4,
            20160,
            20110,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_q_arm_flurry_active',
            'sequence_hero_ashe_q_on_cast',
            5,
            20160,
            20110,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_q_arm_flurry_first',
            'sequence_hero_ashe_q_on_cast',
            6,
            20160,
            20110,
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

    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_ashe_q_clear_focus_1',
            20250,
            'focus_1',
            'focus_slot_zero',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_q_clear_focus_2',
            20250,
            'focus_2',
            'focus_slot_zero',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_q_clear_focus_3',
            20250,
            'focus_3',
            'focus_slot_zero',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_q_clear_focus_4',
            20250,
            'focus_4',
            'focus_slot_zero',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_q_clear_focus_snapshot',
            20250,
            'focus_snapshot',
            'focus_slot_zero',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_q_arm_flurry_active',
            20250,
            'flurry_active',
            'focus_slot_one',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_ashe_q_arm_flurry_first',
            20250,
            'flurry_first',
            'focus_slot_one',
            20172,
            v_candidate,
            NOW()
        )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        state_scope_type_id = EXCLUDED.state_scope_type_id,
        state_key = EXCLUDED.state_key,
        amount_formula_key = EXCLUDED.amount_formula_key,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.state_effect_details.state_scope_type_id IS DISTINCT FROM EXCLUDED.state_scope_type_id
       OR public.state_effect_details.state_key IS DISTINCT FROM EXCLUDED.state_key
       OR public.state_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.state_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_hero_ashe_q_ability_started',
        'provider_hero_ashe_rangers_focus',
        'rangers_focus_on_ability_started',
        20205,
        NULL,
        1,
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, listener_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        listener_key = EXCLUDED.listener_key,
        event_type_id = EXCLUDED.event_type_id,
        ability_id = EXCLUDED.ability_id,
        max_triggers_per_event = EXCLUDED.max_triggers_per_event,
        chain_limit_key = EXCLUDED.chain_limit_key,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_listeners.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.provider_listeners.listener_key IS DISTINCT FROM EXCLUDED.listener_key
       OR public.provider_listeners.event_type_id IS DISTINCT FROM EXCLUDED.event_type_id
       OR public.provider_listeners.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.provider_listeners.max_triggers_per_event IS DISTINCT FROM EXCLUDED.max_triggers_per_event
       OR public.provider_listeners.chain_limit_key IS DISTINCT FROM EXCLUDED.chain_limit_key;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.listener_match_types (
        game_id, listener_id, match_mode_type_id, type_id, change_revision, updated_at
    ) VALUES
        (v_game_id, 'listener_hero_ashe_q_ability_started', 20181, 20205, v_candidate, NOW()),
        (v_game_id, 'listener_hero_ashe_q_ability_started', 20181, 20212, v_candidate, NOW())
    ON CONFLICT (game_id, listener_id, match_mode_type_id, type_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.listener_match_types.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.listener_effect_sequences (
        game_id, listener_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_hero_ashe_q_ability_started',
        'sequence_hero_ashe_q_on_cast',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, listener_id, sequence_id) DO UPDATE SET
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.listener_effect_sequences.change_revision > v_locked_current;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_provider_mounts (
        game_id, entity_id, provider_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_ashe',
        'provider_hero_ashe_rangers_focus',
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
