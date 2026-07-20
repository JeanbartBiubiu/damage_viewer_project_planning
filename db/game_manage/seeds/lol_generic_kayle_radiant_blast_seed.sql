-- =============================================================================
-- LoL generic Kayle Q Radiant Blast seed（耀焰冲击 Phase-A rank-5 主目标边界）
-- =============================================================================
--
-- 目标：幂等自包含 ensure hero_kayle，并挂载独立 passive provider + active Q：
--       rank-5 魔法伤害 180 + 0.60*bonus AD + 0.50*AP；
--       命中后 provider_target 态 kayle_q_sundered=1（4000ms / refresh_on_write），
--       经 selector/target 20113 对目标 armor / magic_resist
--       percent_add = -0.15 * provider.target_state.kayle_q_sundered
--       （先伤害后写态；命中用 pre-shred MR）。
--
-- 候选：hero_skill|hero_kayle|Q|耀焰冲击
-- 本任务冻结的边界：Phase-A rank-5 主目标（completed / full boundary）。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / reserved_type / attribute_definitions(hp,mana,ad,ap,attack_speed,
--    armor,magic_resist,hp_regen,mana_regen) 缺失则 RAISE EXCEPTION 回滚。
-- 4. 自包含 ensure hero_kayle（不覆盖既有非空 display/description）+ level-1 面板 +
--    mana 资源（330/330）；仅 mount provider_hero_kayle_radiant_blast。
-- 5. 不写 listener / production probe；不自动 publish；不做 DELETE/DROP/CASCADE/DDL；
--    不写 legacy Bundle/Catalog。
--
-- 已完成边界（本脚本建模）：
--   rank-5 主目标魔法伤害；伤害后 15% armor/MR 削减 4000ms；100 mana；8000ms CD。
--
-- 明确排除（本脚本不建模）：
--   减速/控制；弹道/施法延迟；多目标/十字扩张；其它 rank；死亡后持续；
--   listener / probe ability；live migration；自动 publish。
--
-- Q 机制数值真理（仅本地 League Wiki；注释引用，无运行时外部依赖；
-- 无截图 / OCR 溯源；无 DDragon / champion-static 数值溯源）：
--   Template:Data Kayle/Radiant Blast
--   revision id 4005105
--   content SHA256 ded516de4861d88de21ba54de9a8723b654f424f1cc3f9dac30d06382ee1a87c
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/kayle-q.json
--   rank-5：magic 180 + 60% bonus AD + 50% AP；resistances reduction 15% / 4000ms；
--   mana 100；cooldown 8000ms。
--
-- 英雄 level-1 面板（自包含 bootstrap；与 Q Wiki 数值真理分离；
-- 溯源 Module:ChampionData/data revision 4042886；不 invent / 不 claim 本地 Module
-- content hash；面板数值不作 Q 完成证据）：
--   hp670 mana330 ad50 ap0 AS0.625 armor26 MR22 hpregen5 manaregen8。
--
-- 前置：reserved_types_seed.sql；所需 attribute_definitions 已存在。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-kayle-radiant-blast-v1-20260720

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
    v_conflict_types     text;
    v_conflict_provider  text;
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20111, -- selector/opponent
        20113, -- selector/target
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20150, -- operation/damage
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20173, -- value_policy/percent_add
        20190, -- refresh_policy/refresh_duration (refresh_on_write)
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
            'lol_generic_kayle_radiant_blast_seed: game_id=% missing in public.games',
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
            'lol_generic_kayle_radiant_blast_seed: failed to lock game_data_state for %',
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
            'lol_generic_kayle_radiant_blast_seed: missing reserved_type id(s): %',
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
            'lol_generic_kayle_radiant_blast_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    -- reserved → game-local types（同 ID / 同 type_key / reserved_type_id=type_id；
    -- 身份冲突 fail-closed；正确既有绑定 DO NOTHING，不改写 name/description/
    -- change_revision/updated_at 等元数据；仅新插入计入 v_changed）
    SELECT string_agg(
               format(
                   'type_id=%s type_key=%s reserved_type_id=%s (expected type_key=%s reserved_type_id=%s)',
                   t.type_id,
                   t.type_key,
                   t.reserved_type_id,
                   rt.type_key,
                   rt.type_id
               ),
               '; ' ORDER BY t.type_id
           )
      INTO v_conflict_types
      FROM public.types t
      JOIN public.reserved_type rt
        ON rt.type_id = t.type_id
     WHERE t.game_id = v_game_id
       AND t.type_id = ANY (v_required_reserved)
       AND (
           t.type_key IS DISTINCT FROM rt.type_key
           OR t.reserved_type_id IS DISTINCT FROM rt.type_id
       );

    IF v_conflict_types IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_kayle_radiant_blast_seed: conflicting types by type_id: %',
            v_conflict_types;
    END IF;

    SELECT string_agg(
               format(
                   'type_key=%s type_id=%s reserved_type_id=%s (expected type_id=%s reserved_type_id=%s)',
                   t.type_key,
                   t.type_id,
                   t.reserved_type_id,
                   rt.type_id,
                   rt.type_id
               ),
               '; ' ORDER BY t.type_key
           )
      INTO v_conflict_types
      FROM public.types t
      JOIN public.reserved_type rt
        ON rt.type_key = t.type_key
     WHERE t.game_id = v_game_id
       AND rt.type_id = ANY (v_required_reserved)
       AND (
           t.type_id IS DISTINCT FROM rt.type_id
           OR t.reserved_type_id IS DISTINCT FROM rt.type_id
       );

    IF v_conflict_types IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_kayle_radiant_blast_seed: conflicting types by type_key: %',
            v_conflict_types;
    END IF;

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
    ON CONFLICT (game_id, type_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- fail-closed：稳定 ID 不得被其它 provider 占用
    SELECT pm.provider_id
      INTO v_conflict_provider
      FROM public.provider_modifiers pm
     WHERE pm.game_id = v_game_id
       AND pm.modifier_id IN (
           'modifier_hero_kayle_radiant_blast_armor',
           'modifier_hero_kayle_radiant_blast_mr'
       )
       AND pm.provider_id IS DISTINCT FROM 'provider_hero_kayle_radiant_blast'
     LIMIT 1;

    IF v_conflict_provider IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_kayle_radiant_blast_seed: modifier_id already bound to provider_id=% (expected provider_hero_kayle_radiant_blast)',
            v_conflict_provider;
    END IF;

    SELECT ad.provider_id
      INTO v_conflict_provider
      FROM public.ability_definitions ad
     WHERE ad.game_id = v_game_id
       AND ad.ability_id = 'ability_hero_kayle_q_radiant_blast'
       AND ad.provider_id IS DISTINCT FROM 'provider_hero_kayle_radiant_blast'
     LIMIT 1;

    IF v_conflict_provider IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_kayle_radiant_blast_seed: ability_id already bound to provider_id=% (expected provider_hero_kayle_radiant_blast)',
            v_conflict_provider;
    END IF;

    -- =========================================================================
    -- 自包含 ensure：hero_kayle 基线实体（已存在则不覆盖 display/description）
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_kayle',
        '凯尔',
        '凯尔 / Kayle（Radiant Blast seed 自包含基线）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- level-1 面板（Module:ChampionData/data rev 4042886；与 Q Wiki 真理分离）
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'hero_kayle', 'hp', 670, v_candidate, NOW()),
        (v_game_id, 'hero_kayle', 'mana', 330, v_candidate, NOW()),
        (v_game_id, 'hero_kayle', 'ad', 50, v_candidate, NOW()),
        (v_game_id, 'hero_kayle', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'hero_kayle', 'attack_speed', 0.625, v_candidate, NOW()),
        (v_game_id, 'hero_kayle', 'armor', 26, v_candidate, NOW()),
        (v_game_id, 'hero_kayle', 'magic_resist', 22, v_candidate, NOW()),
        (v_game_id, 'hero_kayle', 'hp_regen', 5, v_candidate, NOW()),
        (v_game_id, 'hero_kayle', 'mana_regen', 8, v_candidate, NOW())
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
        'hero_kayle',
        'mana',
        330,
        330,
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
    -- hero_kayle Radiant Blast（Q rank-5 Phase-A）：provider + 击碎态 + 主动
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_kayle_radiant_blast',
        20120,
        '凯尔 Q 耀焰冲击 Radiant Blast（rank5 主目标伤害 + 击碎）',
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

    -- kayle_q_sundered：number / max 1 / 4000ms / refresh_on_write；
    -- 不写 default_value（运行时缺省 0）
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_kayle_radiant_blast',
        'kayle_q_sundered',
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
            'provider_hero_kayle_radiant_blast',
            'q_mana_cost',
            '{"op":"const","value":100}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kayle_radiant_blast',
            'q_cooldown_ms',
            '{"op":"const","value":8000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kayle_radiant_blast',
            'radiant_blast_damage',
            '{"op":"add","args":[{"op":"const","value":180},{"op":"mul","args":[{"op":"const","value":0.60},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]},{"op":"mul","args":[{"op":"const","value":0.50},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kayle_radiant_blast',
            'radiant_blast_armor_percent',
            '{"op":"mul","args":[{"op":"const","value":-0.15},{"op":"read","path":"provider.target_state.kayle_q_sundered"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kayle_radiant_blast',
            'radiant_blast_mr_percent',
            '{"op":"mul","args":[{"op":"const","value":-0.15},{"op":"read","path":"provider.target_state.kayle_q_sundered"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kayle_radiant_blast',
            'sundered_arm',
            '{"op":"const","value":1}'::jsonb,
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

    -- 目标 armor / MR 15% percent_add（分类字段保持 null）
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'modifier_hero_kayle_radiant_blast_armor',
            'provider_hero_kayle_radiant_blast',
            'radiant_blast_armor_percent',
            NULL,
            20113,
            'armor',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20173,
            'radiant_blast_armor_percent',
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'modifier_hero_kayle_radiant_blast_mr',
            'provider_hero_kayle_radiant_blast',
            'radiant_blast_mr_percent',
            NULL,
            20113,
            'magic_resist',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20173,
            'radiant_blast_mr_percent',
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

    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_kayle_q_radiant_blast',
        'provider_hero_kayle_radiant_blast',
        'radiant_blast',
        20130,
        '耀焰冲击（Q）',
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
        'cost_hero_kayle_q_radiant_blast_mana',
        'ability_hero_kayle_q_radiant_blast',
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
        'cooldown_hero_kayle_q_radiant_blast',
        'ability_hero_kayle_q_radiant_blast',
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

    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_kayle_q_radiant_blast_impact',
        'ability_hero_kayle_q_radiant_blast',
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
        'sequence_hero_kayle_q_radiant_blast_impact',
        'provider_hero_kayle_radiant_blast',
        'radiant_blast_impact',
        '耀焰冲击 impact（伤害后写击碎态）',
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

    -- step_order 0 damage → 1 state_change；deferred exactly-one-detail pairing
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_kayle_q_radiant_blast_damage',
            'sequence_hero_kayle_q_radiant_blast_impact',
            0,
            20150,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kayle_q_radiant_blast_sunder',
            'sequence_hero_kayle_q_radiant_blast_impact',
            1,
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

    INSERT INTO public.damage_effect_details (
        game_id, step_id, amount_formula_key, damage_type_id, value_policy_type_id,
        copyable_on_hit, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_kayle_q_radiant_blast_damage',
        'radiant_blast_damage',
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

    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_kayle_q_radiant_blast_sunder',
        20252,
        'kayle_q_sundered',
        'sundered_arm',
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

    INSERT INTO public.ability_phase_effect_sequences (
        game_id, phase_id, trigger_type_id, sequence_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_kayle_q_radiant_blast_impact',
        20260,
        'sequence_hero_kayle_q_radiant_blast_impact',
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
        'hero_kayle',
        'provider_hero_kayle_radiant_blast',
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
