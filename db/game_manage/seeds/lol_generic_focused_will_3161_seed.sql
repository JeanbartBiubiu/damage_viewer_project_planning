-- =============================================================================
-- LoL generic Focused Will seed（朔极之矛 item_3161 / 专注意志）
-- =============================================================================
--
-- Goal: idempotent Wiki-only Focused Will provider graph for item_3161:
--       state focused_will_stacks + two grant listeners (champion|pet cast origin)
--       + outgoing_pre_mitigation pipeline multiply 1+0.03*stacks.
--
-- Wiki 真源（League Wiki item manifest only；不使用 DDragon）：
--   current-items.raw.lua lines 7449-7452
--   revid 4030984
--   SHA256 e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
--   Focused Will：ability|pet damage from non-innate cast instance → stack 6s
--   max4；each stack +3% ability|pet|proc damage from non-item cast instance
--   (max +12%)；each cast instance grants at most one stack per second.
--
-- Contract:
-- 1. Single transaction; fixed game_id='lol'; ensure_game_partitions then
--    lock game_data_state.
-- 2. Candidate revision = locked current_revision + 1; advance only when
--    business rows are actually inserted/changed.
-- 3. Missing required game / reserved_type => RAISE EXCEPTION and roll back.
-- 4. Reuse item_3161 entity/stats if present; otherwise ensure minimal entity
--    only (no unrelated overwrite / no Dragonforce haste).
-- 5. State focused_will_stacks：default0（schema 无 default 列；运行时缺省 0）、
--    max4、duration_ms=6000、refresh_policy/refresh_duration（20190 /
--    refresh_on_write aggregate）。
-- 6. Two listeners（matcher 含一个 Any 组）：
--      champion：All event/damage_instance + event/source_owner +
--               cast_origin/champion；Any damage_trait/ability|pet；
--               None ability/basic_attack + cast_origin/item|innate；
--               per_cast_throttle_ms=1000；add+1 stack。
--      pet：identical with All cast_origin/pet。
--    Proc damage does not grant（Any 不含 damage_trait/proc）。
-- 7. Pipeline outgoing_pre_mitigation multiply 1+0.03*focused_will_stacks，
--    conditioned on ability|pet|proc traits、champion|pet cast origin、
--    damage.ability_type.basic_attack==0。
-- 8. Project cast_origin/champion|item|pet|innate reserved → game-local types；
--    ensure game-local ability/basic_attack + damage_trait/ability|pet|proc。
-- 9. No auto-publish; no DELETE/DROP/CASCADE; no legacy Bundle/Catalog writes；
--    no Dragonforce haste；does not execute DB migrations against a live database。
--
-- Prerequisites: reserved_types_seed.sql（含 10031 / 20273-20276 cast_origin）。
-- Suggested publish version (this script does not publish):
--   lol-generic-focused-will-3161-v1-20260719

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_missing_reserved   text;
    v_conflict_type_key  text;
    v_conflict_type_id   int;
    v_existing_name      text;
    v_existing_reserved  int;
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20120, -- provider_kind/passive
        20160, -- operation/state_change
        20170, -- value_policy/add
        20171, -- value_policy/multiply
        20180, -- match_mode/any
        20181, -- match_mode/all
        20182, -- match_mode/none
        20190, -- refresh_policy/refresh_duration (refresh_on_write)
        20212, -- event/source_owner
        20217, -- event/damage_instance
        20250, -- state_scope/provider
        20264, -- modifier_kind/pipeline
        20265, -- command/damage
        20267, -- stage/outgoing_pre_mitigation
        20269, -- bucket/all_instances
        20272, -- channel/all_damage
        20273, -- cast_origin/champion
        20274, -- cast_origin/item
        20275, -- cast_origin/pet
        20276  -- cast_origin/innate
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_focused_will_3161_seed: game_id=% missing in public.games',
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
            'lol_generic_focused_will_3161_seed: failed to lock game_data_state for %',
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
            'lol_generic_focused_will_3161_seed: missing reserved_type id(s): %',
            v_missing_reserved;
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
    --   62003 ability/basic_attack
    --   62005 damage_trait/ability
    --   62008 damage_trait/pet
    --   62009 damage_trait/proc
    -- =========================================================================

    -- 62003 ability/basic_attack
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62003
       AND t.type_key IS DISTINCT FROM 'ability/basic_attack';

    IF v_conflict_type_key IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_focused_will_3161_seed: type_id=62003 already bound to type_key=% name=% reserved_type_id=% (expected ability/basic_attack)',
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
            'lol_generic_focused_will_3161_seed: type_key=ability/basic_attack already bound to type_id=% (expected 62003)',
            v_conflict_type_id;
    END IF;

    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62003,
        'ability/basic_attack',
        'Basic attack ability type',
        'Game-local ability type; Focused Will None-matcher / amp condition exclude basic_attack.',
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

    -- 62005 damage_trait/ability
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62005
       AND t.type_key IS DISTINCT FROM 'damage_trait/ability';

    IF v_conflict_type_key IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_focused_will_3161_seed: type_id=62005 already bound to type_key=% name=% reserved_type_id=% (expected damage_trait/ability)',
            v_conflict_type_key, v_existing_name, v_existing_reserved;
    END IF;

    SELECT t.type_id
      INTO v_conflict_type_id
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_key = 'damage_trait/ability'
       AND t.type_id IS DISTINCT FROM 62005;

    IF v_conflict_type_id IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_focused_will_3161_seed: type_key=damage_trait/ability already bound to type_id=% (expected 62005)',
            v_conflict_type_id;
    END IF;

    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62005,
        'damage_trait/ability',
        'Ability damage trait',
        'Game-local damage trait; Focused Will grant Any + amp condition.',
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

    -- 62008 damage_trait/pet
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62008
       AND t.type_key IS DISTINCT FROM 'damage_trait/pet';

    IF v_conflict_type_key IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_focused_will_3161_seed: type_id=62008 already bound to type_key=% name=% reserved_type_id=% (expected damage_trait/pet)',
            v_conflict_type_key, v_existing_name, v_existing_reserved;
    END IF;

    SELECT t.type_id
      INTO v_conflict_type_id
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_key = 'damage_trait/pet'
       AND t.type_id IS DISTINCT FROM 62008;

    IF v_conflict_type_id IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_focused_will_3161_seed: type_key=damage_trait/pet already bound to type_id=% (expected 62008)',
            v_conflict_type_id;
    END IF;

    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62008,
        'damage_trait/pet',
        'Pet damage trait',
        'Game-local damage trait; Focused Will grant Any + amp condition.',
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

    -- 62009 damage_trait/proc
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62009
       AND t.type_key IS DISTINCT FROM 'damage_trait/proc';

    IF v_conflict_type_key IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_focused_will_3161_seed: type_id=62009 already bound to type_key=% name=% reserved_type_id=% (expected damage_trait/proc)',
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
            'lol_generic_focused_will_3161_seed: type_key=damage_trait/proc already bound to type_id=% (expected 62009)',
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
        'Game-local damage trait; Focused Will amp includes proc; grant listeners exclude proc.',
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
    -- item_3161 entity：reuse if present；else minimal ensure（不覆写无关字段/属性）
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'item_3161',
        '朔极之矛',
        'Spear of Shojin（source item id 3161；Focused Will only；no Dragonforce）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- =========================================================================
    -- provider_item_3161_focused_will
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_3161_focused_will',
        20120,
        '朔极之矛 专注意志 Focused Will',
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

    -- focused_will_stacks：number / max4 / 6000ms / refresh_on_write；
    -- 不写 default_value（schema 无该列）；文档契约 default0。
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_3161_focused_will',
        'focused_will_stacks',
        20100,
        4,
        6000,
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
            'provider_item_3161_focused_will',
            'focused_will_stack_add',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3161_focused_will',
            'focused_will_amp_value',
            '{"op":"add","args":[{"op":"const","value":1},{"op":"mul","args":[{"op":"const","value":0.03},{"op":"read","path":"provider.state.focused_will_stacks"}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3161_focused_will',
            'focused_will_amp_condition',
            -- max/min nest 3-way OR/AND（与 Wasm generic_focused_will_3161_test 对齐）
            '{"op":"min","args":[{"op":"min","args":[{"op":"max","args":[{"op":"max","args":[{"op":"read","path":"damage.trait.ability"},{"op":"read","path":"damage.trait.pet"}]},{"op":"read","path":"damage.trait.proc"}]},{"op":"max","args":[{"op":"read","path":"damage.cast_origin.champion"},{"op":"read","path":"damage.cast_origin.pet"}]}]},{"op":"eq","args":[{"op":"read","path":"damage.ability_type.basic_attack"},{"op":"const","value":0}]}]}'::jsonb,
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

    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'modifier_item_3161_focused_will_amp',
        'provider_item_3161_focused_will',
        'focused_will_amp',
        20264,
        20110,
        'hp',
        20265,
        20272,
        20269,
        20267,
        0,
        20171,
        'focused_will_amp_value',
        'focused_will_amp_condition',
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

    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_item_3161_focused_will_grant',
        'provider_item_3161_focused_will',
        'focused_will_grant',
        'Focused Will stack grant',
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
        'step_item_3161_focused_will_stack_add',
        'sequence_item_3161_focused_will_grant',
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
        'step_item_3161_focused_will_stack_add',
        20250,
        'focused_will_stacks',
        'focused_will_stack_add',
        20170,
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

    -- two grant listeners：champion / pet cast_origin；per_cast_throttle_ms=1000
    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, per_cast_throttle_ms,
        change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'listener_item_3161_focused_will_champion',
            'provider_item_3161_focused_will',
            'focused_will_grant_champion',
            20217,
            NULL,
            NULL,
            NULL,
            1000,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'listener_item_3161_focused_will_pet',
            'provider_item_3161_focused_will',
            'focused_will_grant_pet',
            20217,
            NULL,
            NULL,
            NULL,
            1000,
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
        per_cast_throttle_ms = EXCLUDED.per_cast_throttle_ms,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.provider_listeners.provider_id IS DISTINCT FROM EXCLUDED.provider_id
       OR public.provider_listeners.listener_key IS DISTINCT FROM EXCLUDED.listener_key
       OR public.provider_listeners.event_type_id IS DISTINCT FROM EXCLUDED.event_type_id
       OR public.provider_listeners.ability_id IS DISTINCT FROM EXCLUDED.ability_id
       OR public.provider_listeners.max_triggers_per_event IS DISTINCT FROM EXCLUDED.max_triggers_per_event
       OR public.provider_listeners.chain_limit_key IS DISTINCT FROM EXCLUDED.chain_limit_key
       OR public.provider_listeners.per_cast_throttle_ms IS DISTINCT FROM EXCLUDED.per_cast_throttle_ms;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- champion listener matchers
    -- All: damage_instance / source_owner / cast_origin/champion
    -- Any: damage_trait/ability / damage_trait/pet
    -- None: ability/basic_attack / cast_origin/item / cast_origin/innate
    INSERT INTO public.listener_match_types (
        game_id, listener_id, match_mode_type_id, type_id, change_revision, updated_at
    ) VALUES
        (v_game_id, 'listener_item_3161_focused_will_champion', 20181, 20217, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_champion', 20181, 20212, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_champion', 20181, 20273, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_champion', 20180, 62005, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_champion', 20180, 62008, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_champion', 20182, 62003, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_champion', 20182, 20274, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_champion', 20182, 20276, v_candidate, NOW()),
        -- pet listener：All cast_origin/pet；其余相同
        (v_game_id, 'listener_item_3161_focused_will_pet', 20181, 20217, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_pet', 20181, 20212, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_pet', 20181, 20275, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_pet', 20180, 62005, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_pet', 20180, 62008, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_pet', 20182, 62003, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_pet', 20182, 20274, v_candidate, NOW()),
        (v_game_id, 'listener_item_3161_focused_will_pet', 20182, 20276, v_candidate, NOW())
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
    ) VALUES
        (
            v_game_id,
            'listener_item_3161_focused_will_champion',
            'sequence_item_3161_focused_will_grant',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'listener_item_3161_focused_will_pet',
            'sequence_item_3161_focused_will_grant',
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
        'item_3161',
        'provider_item_3161_focused_will',
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
