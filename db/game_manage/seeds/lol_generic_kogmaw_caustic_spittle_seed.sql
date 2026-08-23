-- =============================================================================
-- LoL generic Kog'Maw Q Caustic Spittle seed（腐蚀唾液 rank-5 被动 AS + 主动）
-- =============================================================================
--
-- 目标：幂等写入 hero_kogmaw 专用 passive provider，表达 Q rank-5：
--       常驻 attack_speed percent_add 0.25（+25% AS）；
--       active：40 mana / 7000ms CD / impact 魔法伤害 260 + 0.90*AP；
--       命中后 provider_target 态 kogmaw_q_resist_reduction=1（4000ms /
--       refresh_on_write），经 selector/target 20113 对目标 armor / magic_resist
--       percent_add = -0.32 * provider.target_state（先伤害后写态，命中用 pre-shred MR）。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / hero_kogmaw / attribute_definitions(attack_speed,armor,
--    magic_resist,ap,mana) / reserved_type 缺失则 RAISE EXCEPTION 回滚。
-- 4. 仅 mount 到 hero_kogmaw；复用 provider_hero_kogmaw_caustic_spittle；
--    basic attack，不触碰 W Bio-Arcane Barrage
--    （provider_hero_kogmaw_bio_arcane_barrage）。
-- 5. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog。
--
-- 明确排除（本脚本不建模）：
--   弹道飞行 / 目标选取几何；多目标；rank1–4 数值表；其它技能；
--   live migration；自动 publish。
--
-- 数值来源（League Wiki Template:Data Kog'Maw/Caustic Spittle；注释引用，
-- 无运行时外部依赖；无截图 / OCR 溯源；无 DDragon / champion-static 数值溯源）：
--   revision id 3960434
--   content SHA256 f651035612e1deeda77df641f5a0e21226ec74aeb4633e0f211780efc3f39a7d
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/kogmaw-q.json
--     数据参考/lol-wiki-current-champions/raw/kogmaw-q.wikitext
--   rank-5：magic 260 + 90% AP；resistances reduction 32% / 4000ms；
--   mana 40；cooldown 7000ms；passive Bonus Attack Speed 25%。
--
-- 前置：reserved_types_seed.sql；Batch-B hero_kogmaw；所需 attribute_definitions。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-kogmaw-caustic-spittle-v2-20260719

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
        'attack_speed', 'armor', 'magic_resist', 'ap', 'mana'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_kogmaw_caustic_spittle_seed: game_id=% missing in public.games',
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
            'lol_generic_kogmaw_caustic_spittle_seed: failed to lock game_data_state for %',
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
            'lol_generic_kogmaw_caustic_spittle_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_kogmaw'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kogmaw_caustic_spittle_seed: missing game_entities hero_kogmaw (Batch-B prerequisite)';
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
            'lol_generic_kogmaw_caustic_spittle_seed: missing attribute_definitions for game_id=% attr_key(s): %',
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
    -- hero_kogmaw Caustic Spittle（Q rank-5）：被动 AS + 主动伤害/击碎
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_kogmaw_caustic_spittle',
        20120,
        '克格莫 Q 腐蚀唾液 Caustic Spittle（rank5 被动攻速 + 主动）',
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

    -- kogmaw_q_resist_reduction：number / max 1 / 4000ms / refresh_on_write；
    -- 不写 default_value（运行时缺省 0）
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_kogmaw_caustic_spittle',
        'kogmaw_q_resist_reduction',
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
            'provider_hero_kogmaw_caustic_spittle',
            'caustic_spittle_attack_speed',
            '{"op":"const","value":0.25}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kogmaw_caustic_spittle',
            'q_mana_cost',
            '{"op":"const","value":40}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kogmaw_caustic_spittle',
            'q_cooldown_ms',
            '{"op":"const","value":7000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kogmaw_caustic_spittle',
            'caustic_spittle_damage',
            '{"op":"add","args":[{"op":"const","value":260},{"op":"mul","args":[{"op":"const","value":0.90},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kogmaw_caustic_spittle',
            'caustic_spittle_armor_percent',
            '{"op":"mul","args":[{"op":"const","value":-0.32},{"op":"read","path":"provider.target_state.kogmaw_q_resist_reduction"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kogmaw_caustic_spittle',
            'caustic_spittle_mr_percent',
            '{"op":"mul","args":[{"op":"const","value":-0.32},{"op":"read","path":"provider.target_state.kogmaw_q_resist_reduction"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kogmaw_caustic_spittle',
            'resist_reduction_arm',
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

    -- 常驻 attack_speed percent_add 0.25（分类字段保持 null）
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'modifier_hero_kogmaw_caustic_spittle_attack_speed',
            'provider_hero_kogmaw_caustic_spittle',
            'caustic_spittle_attack_speed',
            NULL,
            20110,
            'attack_speed',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20173,
            'caustic_spittle_attack_speed',
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'modifier_hero_kogmaw_caustic_spittle_armor',
            'provider_hero_kogmaw_caustic_spittle',
            'caustic_spittle_armor_percent',
            NULL,
            20113,
            'armor',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20173,
            'caustic_spittle_armor_percent',
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'modifier_hero_kogmaw_caustic_spittle_mr',
            'provider_hero_kogmaw_caustic_spittle',
            'caustic_spittle_mr_percent',
            NULL,
            20113,
            'magic_resist',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20173,
            'caustic_spittle_mr_percent',
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
        'ability_hero_kogmaw_q_caustic_spittle',
        'provider_hero_kogmaw_caustic_spittle',
        'caustic_spittle',
        20130,
        '腐蚀唾液（Q）',
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
        'cooldown_hero_kogmaw_q_caustic_spittle',
        'ability_hero_kogmaw_q_caustic_spittle',
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
        'phase_hero_kogmaw_q_caustic_spittle_impact',
        'ability_hero_kogmaw_q_caustic_spittle',
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
        'sequence_hero_kogmaw_q_caustic_spittle_impact',
        'provider_hero_kogmaw_caustic_spittle',
        'caustic_spittle_impact',
        '腐蚀唾液 impact（伤害后写击碎态）',
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
            'step_hero_kogmaw_q_caustic_spittle_damage',
            'sequence_hero_kogmaw_q_caustic_spittle_impact',
            0,
            20150,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kogmaw_q_caustic_spittle_resist_arm',
            'sequence_hero_kogmaw_q_caustic_spittle_impact',
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
        'step_hero_kogmaw_q_caustic_spittle_damage',
        'caustic_spittle_damage',
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
        'step_hero_kogmaw_q_caustic_spittle_resist_arm',
        20252,
        'kogmaw_q_resist_reduction',
        'resist_reduction_arm',
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
        'phase_hero_kogmaw_q_caustic_spittle_impact',
        20260,
        'sequence_hero_kogmaw_q_caustic_spittle_impact',
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
        'hero_kogmaw',
        'provider_hero_kogmaw_caustic_spittle',
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
