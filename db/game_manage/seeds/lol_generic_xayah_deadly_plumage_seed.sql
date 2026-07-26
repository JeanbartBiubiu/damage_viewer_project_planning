-- =============================================================================
-- LoL generic Xayah W Deadly Plumage seed（逆羽 W 致死羽衣 Phase-A rank-5 1v1）
-- =============================================================================
--
-- 目标：幂等 ensure hero_xayah 最低必要基线，并挂载独立 W provider，表达
--       rank-5 Deadly Plumage Phase-A 1v1 可近似 ABI：40 mana、14000ms CD、
--       ability_started + source_owner + ability/xayah_deadly_plumage（62012）
--       ALL listener 武装 deadly_plumage_active=1（max1 / 4000ms /
--       refresh_duration）；listener.ability_id 必须为 NULL（Web 会把非空
--       ability_id 映射为 AbilityRef / castAbilityAt 子施法，不是事件过滤；
--       若绑定同一 ability 则 Q cast 的 ability_started 会误武装 W）。
--       AS percent_add = 0.55 * provider.state.deadly_plumage_active；
--       另加 source-owned basic_damage pipeline multiply
--       1 + 0.25 * provider.state.deadly_plumage_active（排除 on-hit / proc）。
--       这是合并后的普攻倍率（预期 crit 之后、抗性之前），不是第二发羽刃 /
--       独立 missile / 第二伤害实例。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / reserved_type / attribute_definitions(hp,mana,ad,attack_speed,
--    armor,magic_resist,hp_regen,mana_regen) 缺失则 RAISE EXCEPTION 回滚。
-- 4. 自包含 ensure hero_xayah 实体 + level-1 面板 + mana 资源（340/340）；
--    仅 mount 独立 provider_hero_xayah_w_deadly_plumage。与未来
--    provider_hero_xayah_basic_attack / feather / Q providers 并存：不重建/替换
--    普攻或羽刃图，不覆盖无关既有 Xayah provider 行。
-- 5. Fail-closed ensure game-local type_id=62012 type_key=ability/xayah_deadly_plumage
--    （reserved_type_id=NULL；双向 id↔key collision guards；同 Hexplate 62010
--    ability-specific type 模式）；type_relations(ability →
--    ability_hero_xayah_w_deadly_plumage) 在 listener matching 前物化，并参与
--    material-change-only revision。不得写入 ability_kind_type_id。
-- 6. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog。
--
-- 明确排除（本脚本不建模）：
--   移速；Rakan / 洛联动；多目标 / Runaan；projectile / in-flight / ward /
--   blind / dodge / block 细节；独立次级羽刃 missile / 第二伤害操作；其它 rank；
--   live migration；自动 publish；完整技能保真。
--
-- 数值来源（League Wiki Template:Data Xayah/Deadly Plumage；注释引用，
-- 无运行时外部依赖；无 Meraki / DDragon 作为 W 机制数值真理）：
--   revision id 4010669
--   content SHA256 09d5476533722311e85c4ca79813cd0bec2cf35d105be894b80dac14478845a7
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/xayah-w.json
--   rank-5 Deadly Plumage：AS +55%（percent_add 0.55 * deadly_plumage_active）；
--   持续 4s；cost 40 mana；CD 14s；额外羽刃 Wiki 25% of triggering attack damage
--   （Phase-A 1v1 近似为 source-owned basic_damage ×1.25 while active）。
--   英雄 level-1 面板（自包含 bootstrap；非 Wiki W 数值真理）：
--   hp630 mana340 ad60 AS0.658 armor25 MR30 hpregen3.25 manaregen8.25。
--
-- 前置：reserved_types_seed.sql；所需 attribute_definitions 已存在。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-xayah-deadly-plumage-v1-20260716

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
    v_existing_name      text;
    v_existing_reserved  int;
    v_conflict_type_id   int;
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20160, -- operation/state_change
        20171, -- value_policy/multiply
        20172, -- value_policy/override
        20173, -- value_policy/percent_add
        20181, -- match_mode/all
        20190, -- refresh_policy/refresh_duration
        20205, -- event/ability_started
        20212, -- event/source_owner
        20250, -- state_scope/provider
        20264, -- modifier_kind/pipeline
        20265, -- command/damage
        20266, -- channel/basic_damage
        20267, -- stage/outgoing_pre_mitigation
        20269  -- bucket/all_instances
    ];
    v_required_attrs     text[] := ARRAY[
        'hp', 'mana', 'ad', 'attack_speed', 'armor', 'magic_resist',
        'hp_regen', 'mana_regen'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_xayah_deadly_plumage_seed: game_id=% missing in public.games',
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
            'lol_generic_xayah_deadly_plumage_seed: failed to lock game_data_state for %',
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
            'lol_generic_xayah_deadly_plumage_seed: missing reserved_type id(s): %',
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
            'lol_generic_xayah_deadly_plumage_seed: missing attribute_definitions for game_id=% attr_key(s): %',
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
    -- game-local matcher traits（reserved_type_id=NULL）
    --   62006 damage_trait/on_hit
    --   62009 damage_trait/proc
    -- =========================================================================

    -- 62006 damage_trait/on_hit
    -- 要求精确绑定：type_key=damage_trait/on_hit 且 reserved_type_id=NULL；
    -- 错 key 或 reserved_type_id 非空均 fail-closed；正确既有行不改写元数据。
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62006
       AND (
           t.type_key IS DISTINCT FROM 'damage_trait/on_hit'
           OR t.reserved_type_id IS NOT NULL
       );

    IF FOUND THEN
        RAISE EXCEPTION
            'lol_generic_xayah_deadly_plumage_seed: type_id=62006 already bound to type_key=% name=% reserved_type_id=% (expected damage_trait/on_hit, reserved_type_id=NULL)',
            v_conflict_type_key, v_existing_name, v_existing_reserved;
    END IF;

    SELECT t.type_id
      INTO v_conflict_type_id
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_key = 'damage_trait/on_hit'
       AND t.type_id IS DISTINCT FROM 62006;

    IF v_conflict_type_id IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_xayah_deadly_plumage_seed: type_key=damage_trait/on_hit already bound to type_id=% (expected 62006)',
            v_conflict_type_id;
    END IF;

    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62006,
        'damage_trait/on_hit',
        'On-hit damage trait',
        'Game-local damage trait; Deadly Plumage basic-damage multiply excludes on-hit instances.',
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, type_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- 62009 damage_trait/proc
    -- 要求精确绑定：type_key=damage_trait/proc 且 reserved_type_id=NULL；
    -- 错 key 或 reserved_type_id 非空均 fail-closed；正确既有行不改写元数据。
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62009
       AND (
           t.type_key IS DISTINCT FROM 'damage_trait/proc'
           OR t.reserved_type_id IS NOT NULL
       );

    IF FOUND THEN
        RAISE EXCEPTION
            'lol_generic_xayah_deadly_plumage_seed: type_id=62009 already bound to type_key=% name=% reserved_type_id=% (expected damage_trait/proc, reserved_type_id=NULL)',
            v_conflict_type_key, v_existing_name, v_existing_reserved;
    END IF;

    SELECT t.type_id
      INTO v_conflict_type_id
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_key = 'damage_trait/proc'
       AND t.type_id IS DISTINCT FROM 62009;

    IF v_conflict_type_id IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_xayah_deadly_plumage_seed: type_key=damage_trait/proc already bound to type_id=% (expected 62009)',
            v_conflict_type_id;
    END IF;

    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62009,
        'damage_trait/proc',
        'Proc damage trait',
        'Game-local damage trait; Deadly Plumage basic-damage multiply excludes proc instances.',
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
    -- game-local ability-specific type（reserved_type_id=NULL；同 Hexplate 62010）
    --   62012 ability/xayah_deadly_plumage
    -- 仅作 type_relations ability tag + listener All-matcher；不得写入
    -- ability_kind_type_id；不得把 listener.ability_id 当作事件过滤。
    -- =========================================================================

    -- 62012 ability/xayah_deadly_plumage
    -- 要求精确绑定：type_key=ability/xayah_deadly_plumage 且 reserved_type_id=NULL；
    -- 错 key 或 reserved_type_id 非空均 fail-closed；正确既有行按 material-change
    -- 语义复用/校正描述。
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62012
       AND (
           t.type_key IS DISTINCT FROM 'ability/xayah_deadly_plumage'
           OR t.reserved_type_id IS NOT NULL
       );

    IF FOUND THEN
        RAISE EXCEPTION
            'lol_generic_xayah_deadly_plumage_seed: type_id=62012 already bound to type_key=% name=% reserved_type_id=% (expected ability/xayah_deadly_plumage, reserved_type_id=NULL)',
            v_conflict_type_key, v_existing_name, v_existing_reserved;
    END IF;

    SELECT t.type_id
      INTO v_conflict_type_id
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_key = 'ability/xayah_deadly_plumage'
       AND t.type_id IS DISTINCT FROM 62012;

    IF v_conflict_type_id IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_xayah_deadly_plumage_seed: type_key=ability/xayah_deadly_plumage already bound to type_id=% (expected 62012)',
            v_conflict_type_id;
    END IF;

    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62012,
        'ability/xayah_deadly_plumage',
        'Xayah Deadly Plumage ability type',
        'Game-local ability type tag; Deadly Plumage arm-listener All-matcher. Not ability_kind; not AbilityRef.',
        NULL,
        v_candidate,
        NOW()
    )
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
    -- 自包含 ensure：hero_xayah 基线实体（已存在则不覆盖 display/description）
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_xayah',
        '逆羽',
        '逆羽 / Xayah（Deadly Plumage seed 自包含基线）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- level-1 面板（自包含 bootstrap；非 Wiki W 数值真理；已存在且相同则无 material change）
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'hero_xayah', 'hp', 630, v_candidate, NOW()),
        (v_game_id, 'hero_xayah', 'mana', 340, v_candidate, NOW()),
        (v_game_id, 'hero_xayah', 'ad', 60, v_candidate, NOW()),
        (v_game_id, 'hero_xayah', 'attack_speed', 0.658, v_candidate, NOW()),
        (v_game_id, 'hero_xayah', 'armor', 25, v_candidate, NOW()),
        (v_game_id, 'hero_xayah', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_xayah', 'hp_regen', 3.25, v_candidate, NOW()),
        (v_game_id, 'hero_xayah', 'mana_regen', 8.25, v_candidate, NOW())
    ON CONFLICT (game_id, entity_id, attr_key) DO UPDATE SET
        base_value = EXCLUDED.base_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_attribute_values.base_value IS DISTINCT FROM EXCLUDED.base_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- 幂等投影 mana 资源定义（ability_costs FK）
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
        'hero_xayah',
        'mana',
        340,
        340,
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
    -- hero_xayah Deadly Plumage（W rank-5）：active + timed AS + basic_damage mul
    -- 独立 provider；不触碰未来 basic attack / feather providers
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_xayah_w_deadly_plumage',
        20120,
        '逆羽 W 致死羽衣 Deadly Plumage（Phase-A rank5 1v1）',
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

    -- timed state：max1 / 4000ms / refresh_duration；不写 default_value（运行时缺省 0）
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_xayah_w_deadly_plumage',
        'deadly_plumage_active',
        20100,
        1,
        4000,
        20190,
        v_candidate,
        NOW()
    )
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
            'provider_hero_xayah_w_deadly_plumage',
            'w_mana_cost',
            '{"op":"const","value":40}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_xayah_w_deadly_plumage',
            'w_cooldown_ms',
            '{"op":"const","value":14000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_xayah_w_deadly_plumage',
            'deadly_plumage_active_arm',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_xayah_w_deadly_plumage',
            'deadly_plumage_attack_speed',
            '{"op":"mul","args":[{"op":"const","value":0.55},{"op":"read","path":"provider.state.deadly_plumage_active"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_xayah_w_deadly_plumage',
            'deadly_plumage_basic_damage_mul',
            '{"op":"add","args":[{"op":"const","value":1},{"op":"mul","args":[{"op":"const","value":0.25},{"op":"read","path":"provider.state.deadly_plumage_active"}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_xayah_w_deadly_plumage',
            'deadly_plumage_basic_damage_condition',
            '{"op":"min","args":[{"op":"eq","args":[{"op":"read","path":"damage.trait.on_hit"},{"op":"const","value":0}]},{"op":"eq","args":[{"op":"read","path":"damage.trait.proc"},{"op":"const","value":0}]}]}'::jsonb,
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

    -- provider-bound attack_speed percent_add（可用性由公式内 deadly_plumage_active 表达；condition NULL）
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'modifier_hero_xayah_w_deadly_plumage_attack_speed',
        'provider_hero_xayah_w_deadly_plumage',
        'deadly_plumage_attack_speed',
        NULL,
        20110,
        'attack_speed',
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        20173,
        'deadly_plumage_attack_speed',
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

    -- pipeline basic_damage multiply：合并普攻倍率（crit 后、抗性前）；非第二伤害实例
    -- target_attr_key='hp' 仅为既有 Web 投影占位
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'modifier_hero_xayah_w_deadly_plumage_basic_damage',
        'provider_hero_xayah_w_deadly_plumage',
        'deadly_plumage_basic_damage',
        20264,
        20110,
        'hp',
        20265,
        20266,
        20269,
        20267,
        0,
        20171,
        'deadly_plumage_basic_damage_mul',
        'deadly_plumage_basic_damage_condition',
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

    -- active ability：成功 cast 由既有 runtime 发出 event/ability_started
    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_xayah_w_deadly_plumage',
        'provider_hero_xayah_w_deadly_plumage',
        'deadly_plumage',
        20130,
        '致死羽衣（W）',
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

    -- 62012 ability/xayah_deadly_plumage tag → W ability（勿写入 ability_kind_type_id）
    -- 必须在 listener matching 前物化；参与 material-change-only revision。
    INSERT INTO public.type_relations (
        game_id, type_id, target_category, target_id, extend,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62012,
        'ability',
        'ability_hero_xayah_w_deadly_plumage',
        '{"role":"deadly_plumage"}'::jsonb,
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

    INSERT INTO public.ability_costs (
        game_id, cost_id, ability_id, phase_id, resource_key,
        amount_formula_key, allow_partial, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'cost_hero_xayah_w_deadly_plumage_mana',
        'ability_hero_xayah_w_deadly_plumage',
        NULL,
        'mana',
        'w_mana_cost',
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
        'cooldown_hero_xayah_w_deadly_plumage',
        'ability_hero_xayah_w_deadly_plumage',
        'w_cooldown_ms',
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

    -- deferred exactly-one-detail：state_change 配一 state_effect_details
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_xayah_w_deadly_plumage_arm',
        'provider_hero_xayah_w_deadly_plumage',
        'deadly_plumage_arm',
        '致死羽衣武装（成功 cast）',
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
    ) VALUES (
        v_game_id,
        'step_hero_xayah_w_deadly_plumage_active_arm',
        'sequence_hero_xayah_w_deadly_plumage_arm',
        0,
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
    ) VALUES (
        v_game_id,
        'step_hero_xayah_w_deadly_plumage_active_arm',
        20250,
        'deadly_plumage_active',
        'deadly_plumage_active_arm',
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

    -- ability_started + source_owner + ability/xayah_deadly_plumage(62012)
    -- → arm deadly_plumage_active=1；ability_id 必须 NULL（非 AbilityRef / 非事件过滤）
    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_hero_xayah_w_deadly_plumage_ability_started',
        'provider_hero_xayah_w_deadly_plumage',
        'deadly_plumage_on_ability_started',
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

    -- Arm All: ability_started / ability/xayah_deadly_plumage / source_owner
    INSERT INTO public.listener_match_types (
        game_id, listener_id, match_mode_type_id, type_id, change_revision, updated_at
    ) VALUES
        (v_game_id, 'listener_hero_xayah_w_deadly_plumage_ability_started', 20181, 20205, v_candidate, NOW()),
        (v_game_id, 'listener_hero_xayah_w_deadly_plumage_ability_started', 20181, 20212, v_candidate, NOW()),
        (v_game_id, 'listener_hero_xayah_w_deadly_plumage_ability_started', 20181, 62012, v_candidate, NOW())
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
        'listener_hero_xayah_w_deadly_plumage_ability_started',
        'sequence_hero_xayah_w_deadly_plumage_arm',
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
        'hero_xayah',
        'provider_hero_xayah_w_deadly_plumage',
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
