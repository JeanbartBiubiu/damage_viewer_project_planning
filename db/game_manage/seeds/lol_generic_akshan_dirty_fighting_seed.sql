-- =============================================================================
-- LoL generic Akshan P Dirty Fighting seed（艾克尚 P 无所不用 / 可行动伤害核心）
-- =============================================================================
--
-- 目标：幂等自包含写入 hero_akshan + 通用普攻闭环，并在同一
--       provider_hero_akshan_basic_attack / sequence 上表达 Dirty Fighting 核心：
--       物理普攻 → +1 dirty_fighting_stacks →（满 3）魔法 proc →（满 3）重置 →
--       唯一 basic_attack_hit emit。不使用独立被动 listener/provider。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / reserved_type / attribute_definitions(hp,mana,ad,ap,attack_speed,
--    armor,magic_resist,hp_regen,mana_regen) 缺失则 RAISE EXCEPTION 回滚。
-- 4. 自包含 hero_akshan 实体 + level-1 面板 + champion_level（scalar 1..18）+
--    通用普攻图；挂载 game-local ability/basic_attack（62003）及其 ability relation。
-- 5. dirty_fighting_stacks：number / max3 / 5000ms / refresh_duration(20190)；
--    不写 default_value（运行时缺省 0）；state_scope/provider_target(20252)。
-- 6. Collision-safe：若 owned step 当前 order 与最终目标不同，先按序列
--    MAX(step_order) 派生临时基址停车，再条件 upsert 到最终 0..4；对本序列
--    出现非 owned foreign step 则 fail-closed。
-- 7. type_id=62003 与 type_key=ability/basic_attack 双唯一冲突时明确异常，不覆盖错行。
-- 8. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog。
--
-- 已完成边界（本脚本建模）：
--   普攻物理伤害（owner AD）；命中后每目标 +1 Dirty Fighting 层；
--   第三层观察 stacks=3 后打出 Wiki 魔法 raw 一次并重置为 0；
--   下一发普攻从 0 再叠；ability/basic_attack 类型关系；唯一 event/basic_attack_hit。
--
-- 明确排除 / 剩余边界（本脚本不建模）：
--   被动第二发（Wiki 仅写 after a delay；精确毫秒未知）；
--   技能命中叠层（通用 ability-hit 事件连接不在本 Backend-only 核心）；
--   英雄护盾；第二发取消移速；换目标；小兵倍率；多目标；非伤害分支；
--   live migration；自动 publish。
--
-- 数值权威（本地归档 League Wiki；非截图/OCR）：
--   Template:Data Akshan/Dirty Fighting revision 4038197
--   content SHA256 22ba762382dedced4b63a451c4513cb3129e3b16a137236e5b637eea7510b534
--   reviewed-contracts.json id=akshan-p
--   raw/akshan-p.wikitext
--
-- level-1 面板权威（Module:ChampionData/data）：
--   revision 4042886
--   content SHA256 98094d20a267a437b0ef667db6c67143a0e15c8f8dd27186262b0ed9f621c8a3
--   hp610 mana350 ad52 ap0 AS0.638 armor26 MR30 hpregen3.75 manaregen8.2
--
-- Wiki 合同（可行动伤害核心）：
--   Dirty Fighting：普攻 on-hit +1；持续 5000ms；再施加刷新；上限 3。
--   第三层消耗全部层数，追加魔法 raw：
--     15 + 25*gte(level,6) + 40*gte(level,11) + 70*gte(level,16) + 0.60*AP
--     （等价 Wiki pp 15;40;80;150 @ 1;6;11;16）。
--
-- 前置：reserved_types_seed.sql；所需 attribute_definitions 已存在。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-akshan-dirty-fighting-v1-20260717

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_temp_order_base    integer;
    v_missing_reserved   text;
    v_missing_attrs      text;
    v_foreign_steps      text;
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
        20190, -- refresh_policy/refresh_duration
        20211, -- event/basic_attack_hit
        20220, -- damage/physical
        20221, -- damage/magic
        20252, -- state_scope/provider_target
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
            'lol_generic_akshan_dirty_fighting_seed: game_id=% missing in public.games',
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
            'lol_generic_akshan_dirty_fighting_seed: failed to lock game_data_state for %',
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
            'lol_generic_akshan_dirty_fighting_seed: missing reserved_type id(s): %',
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
            'lol_generic_akshan_dirty_fighting_seed: missing attribute_definitions for game_id=% attr_key(s): %',
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
    -- =========================================================================
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62003
       AND t.type_key IS DISTINCT FROM 'ability/basic_attack';

    IF v_conflict_type_key IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_akshan_dirty_fighting_seed: type_id=62003 already bound to type_key=% name=% reserved_type_id=% (expected ability/basic_attack)',
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
            'lol_generic_akshan_dirty_fighting_seed: type_key=ability/basic_attack already bound to type_id=% (expected 62003)',
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
        'Game-local tag for independent basic attack abilities used by Dirty Fighting and related matchers.',
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
    -- 自包含：hero_akshan 基线实体 + level-1 面板
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_akshan',
        '艾克尚',
        '艾克尚 / Akshan（Dirty Fighting seed 自包含基线）',
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
        (v_game_id, 'hero_akshan', 'hp', 610, v_candidate, NOW()),
        (v_game_id, 'hero_akshan', 'mana', 350, v_candidate, NOW()),
        (v_game_id, 'hero_akshan', 'ad', 52, v_candidate, NOW()),
        (v_game_id, 'hero_akshan', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'hero_akshan', 'attack_speed', 0.638, v_candidate, NOW()),
        (v_game_id, 'hero_akshan', 'armor', 26, v_candidate, NOW()),
        (v_game_id, 'hero_akshan', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_akshan', 'hp_regen', 3.75, v_candidate, NOW()),
        (v_game_id, 'hero_akshan', 'mana_regen', 8.2, v_candidate, NOW())
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
    -- champion_level：数据输入标量（非新 ABI 字段）；min1/max18
    -- =========================================================================
    INSERT INTO public.attribute_definitions (
        game_id, attr_key, sort_order, attr_name, attr_type, default_value,
        value_kind, rate_target_attr_key, min_value, max_value,
        change_revision, updated_at
    ) VALUES (
        v_game_id, 'champion_level', 920, '英雄等级', 'number', 1,
        'scalar', NULL, 1, 18, v_candidate, NOW()
    )
    ON CONFLICT (game_id, attr_key) DO UPDATE SET
        sort_order = EXCLUDED.sort_order,
        attr_name = EXCLUDED.attr_name,
        attr_type = EXCLUDED.attr_type,
        default_value = EXCLUDED.default_value,
        value_kind = EXCLUDED.value_kind,
        rate_target_attr_key = EXCLUDED.rate_target_attr_key,
        min_value = EXCLUDED.min_value,
        max_value = EXCLUDED.max_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.attribute_definitions.sort_order IS DISTINCT FROM EXCLUDED.sort_order
       OR public.attribute_definitions.attr_name IS DISTINCT FROM EXCLUDED.attr_name
       OR public.attribute_definitions.attr_type IS DISTINCT FROM EXCLUDED.attr_type
       OR public.attribute_definitions.default_value IS DISTINCT FROM EXCLUDED.default_value
       OR public.attribute_definitions.value_kind IS DISTINCT FROM EXCLUDED.value_kind
       OR public.attribute_definitions.rate_target_attr_key IS DISTINCT FROM EXCLUDED.rate_target_attr_key
       OR public.attribute_definitions.min_value IS DISTINCT FROM EXCLUDED.min_value
       OR public.attribute_definitions.max_value IS DISTINCT FROM EXCLUDED.max_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES (
        v_game_id, 'hero_akshan', 'champion_level', 1, v_candidate, NOW()
    )
    ON CONFLICT (game_id, entity_id, attr_key) DO UPDATE SET
        base_value = EXCLUDED.base_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_attribute_values.base_value IS DISTINCT FROM EXCLUDED.base_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    INSERT INTO public.entity_attribute_stage_values (
        game_id, entity_id, attr_key, stage, value, change_revision, updated_at
    )
    SELECT
        v_game_id,
        'hero_akshan',
        'champion_level',
        s.stage,
        s.stage::numeric,
        v_candidate,
        NOW()
      FROM generate_series(1, 18) AS s(stage)
    ON CONFLICT (game_id, entity_id, attr_key, stage) DO UPDATE SET
        value = EXCLUDED.value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_attribute_stage_values.value IS DISTINCT FROM EXCLUDED.value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- =========================================================================
    -- 自包含：通用 basic attack graph + Dirty Fighting 叠层/proc + emit
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_akshan_basic_attack',
        20120,
        '艾克尚通用普攻',
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

    -- dirty_fighting_stacks（max3 / 5000ms / refresh_duration）；不写 default_value
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_akshan_basic_attack',
        'dirty_fighting_stacks',
        20100,
        3,
        5000,
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

    -- formulas：BA AD / +1 / 第三层条件 / Wiki magic proc / reset 0
    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_hero_akshan_basic_attack',
            'basic_attack_damage',
            '{"op":"read","path":"$owner.attr.ad"}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_akshan_basic_attack',
            'dirty_fighting_stacks_add',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_akshan_basic_attack',
            'dirty_fighting_third_stack_condition',
            '{"op":"gte","args":[{"op":"read","path":"provider.target_state.dirty_fighting_stacks"},{"op":"const","value":3}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_akshan_basic_attack',
            'dirty_fighting_proc_damage',
            '{"op":"add","args":[{"op":"add","args":[{"op":"add","args":[{"op":"add","args":[{"op":"const","value":15},{"op":"mul","args":[{"op":"const","value":25},{"op":"gte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":6}]}]}]},{"op":"mul","args":[{"op":"const","value":40},{"op":"gte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":11}]}]}]},{"op":"mul","args":[{"op":"const","value":70},{"op":"gte","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":16}]}]}]},{"op":"mul","args":[{"op":"const","value":0.60},{"op":"read","path":"$owner.attr.ap"}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_akshan_basic_attack',
            'dirty_fighting_stacks_reset',
            '{"op":"const","value":0}'::jsonb,
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
        'ability_hero_akshan_basic_attack',
        'provider_hero_akshan_basic_attack',
        'basic_attack',
        20130,
        '普攻',
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

    INSERT INTO public.type_relations (
        game_id, type_id, target_category, target_id, extend,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62003,
        'ability',
        'ability_hero_akshan_basic_attack',
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
        'phase_hero_akshan_basic_attack_impact',
        'ability_hero_akshan_basic_attack',
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
        'sequence_hero_akshan_basic_attack_damage',
        'provider_hero_akshan_basic_attack',
        'basic_attack_damage',
        '普攻伤害',
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

    -- 本序列仅允许 5 个 owned step；出现其它 step 则 fail-closed（不 DELETE）
    SELECT string_agg(es.step_id, ', ' ORDER BY es.step_id)
      INTO v_foreign_steps
      FROM public.effect_steps es
     WHERE es.game_id = v_game_id
       AND es.sequence_id = 'sequence_hero_akshan_basic_attack_damage'
       AND es.step_id NOT IN (
            'step_hero_akshan_basic_attack_damage',
            'step_hero_akshan_dirty_fighting_stacks_add',
            'step_hero_akshan_dirty_fighting_proc_damage',
            'step_hero_akshan_dirty_fighting_stacks_reset',
            'step_hero_akshan_basic_attack_emit_hit'
       );

    IF v_foreign_steps IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_akshan_dirty_fighting_seed: unexpected foreign step(s) in sequence_hero_akshan_basic_attack_damage: %',
            v_foreign_steps;
    END IF;

    -- =========================================================================
    -- sequence：order0 物理普攻 → 1 +1 stacks → 2 magic proc → 3 reset →
    --   4 emit basic_attack_hit
    --
    -- Collision-safe reorder (uq_effect_steps_order): only when an existing
    -- owned step already sits on a non-final order. Temporary orders are
    -- derived from the current sequence MAX(step_order); final upsert below
    -- still owns material-change / v_changed detection via IS DISTINCT FROM.
    -- Temporary parking only; do not set v_changed here (rerun idempotent).
    -- =========================================================================
    IF EXISTS (
        SELECT 1
          FROM public.effect_steps es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_hero_akshan_basic_attack_damage'
           AND (
                (es.step_id = 'step_hero_akshan_basic_attack_damage'
                    AND es.step_order IS DISTINCT FROM 0)
             OR (es.step_id = 'step_hero_akshan_dirty_fighting_stacks_add'
                    AND es.step_order IS DISTINCT FROM 1)
             OR (es.step_id = 'step_hero_akshan_dirty_fighting_proc_damage'
                    AND es.step_order IS DISTINCT FROM 2)
             OR (es.step_id = 'step_hero_akshan_dirty_fighting_stacks_reset'
                    AND es.step_order IS DISTINCT FROM 3)
             OR (es.step_id = 'step_hero_akshan_basic_attack_emit_hit'
                    AND es.step_order IS DISTINCT FROM 4)
           )
    ) THEN
        SELECT COALESCE(MAX(es.step_order), 0)
          INTO v_temp_order_base
          FROM public.effect_steps es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_hero_akshan_basic_attack_damage';

        WITH owned AS (
            SELECT es.step_id,
                   ROW_NUMBER() OVER (ORDER BY es.step_id) AS rn
              FROM public.effect_steps es
             WHERE es.game_id = v_game_id
               AND es.sequence_id = 'sequence_hero_akshan_basic_attack_damage'
               AND es.step_id IN (
                    'step_hero_akshan_basic_attack_damage',
                    'step_hero_akshan_dirty_fighting_stacks_add',
                    'step_hero_akshan_dirty_fighting_proc_damage',
                    'step_hero_akshan_dirty_fighting_stacks_reset',
                    'step_hero_akshan_basic_attack_emit_hit'
               )
        )
        UPDATE public.effect_steps es
           SET step_order = v_temp_order_base + owned.rn,
               updated_at = NOW()
          FROM owned
         WHERE es.game_id = v_game_id
           AND es.step_id = owned.step_id;
        -- Temporary parking only; do not set v_changed here. Final upsert below
        -- remains conditional on actual contract differences (rerun idempotent).
    END IF;

    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_akshan_basic_attack_damage',
            'sequence_hero_akshan_basic_attack_damage',
            0,
            20150,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_akshan_dirty_fighting_stacks_add',
            'sequence_hero_akshan_basic_attack_damage',
            1,
            20160,
            20110,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_akshan_dirty_fighting_proc_damage',
            'sequence_hero_akshan_basic_attack_damage',
            2,
            20150,
            20111,
            'dirty_fighting_third_stack_condition',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_akshan_dirty_fighting_stacks_reset',
            'sequence_hero_akshan_basic_attack_damage',
            3,
            20160,
            20110,
            'dirty_fighting_third_stack_condition',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_akshan_basic_attack_emit_hit',
            'sequence_hero_akshan_basic_attack_damage',
            4,
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

    -- detail 与 effect_steps 同事务，满足 deferred exactly-one-detail
    INSERT INTO public.damage_effect_details (
        game_id, step_id, amount_formula_key, damage_type_id, value_policy_type_id,
        change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_akshan_basic_attack_damage',
            'basic_attack_damage',
            20220,
            20170,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_akshan_dirty_fighting_proc_damage',
            'dirty_fighting_proc_damage',
            20221,
            20170,
            v_candidate,
            NOW()
        )
    ON CONFLICT (game_id, step_id) DO UPDATE SET
        amount_formula_key = EXCLUDED.amount_formula_key,
        damage_type_id = EXCLUDED.damage_type_id,
        value_policy_type_id = EXCLUDED.value_policy_type_id,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.damage_effect_details.amount_formula_key IS DISTINCT FROM EXCLUDED.amount_formula_key
       OR public.damage_effect_details.damage_type_id IS DISTINCT FROM EXCLUDED.damage_type_id
       OR public.damage_effect_details.value_policy_type_id IS DISTINCT FROM EXCLUDED.value_policy_type_id;
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
            'step_hero_akshan_dirty_fighting_stacks_add',
            20252,
            'dirty_fighting_stacks',
            'dirty_fighting_stacks_add',
            20170,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_akshan_dirty_fighting_stacks_reset',
            20252,
            'dirty_fighting_stacks',
            'dirty_fighting_stacks_reset',
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
        game_id, step_id, event_type_id, event_ref, payload,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_akshan_basic_attack_emit_hit',
        20211,
        'event_ref_hero_akshan_basic_attack_hit',
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
        'phase_hero_akshan_basic_attack_impact',
        20260,
        'sequence_hero_akshan_basic_attack_damage',
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
        'hero_akshan',
        'provider_hero_akshan_basic_attack',
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
