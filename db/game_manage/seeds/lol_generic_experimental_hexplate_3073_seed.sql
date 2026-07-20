-- =============================================================================
-- LoL generic Experimental Hexplate seed（海克斯注力刚壁 item_3073 / Overdrive 过载）
-- =============================================================================
--
-- Goal: idempotent Wiki-only ranged Overdrive provider graph for item_3073:
--       ultimate arm listener → overdrive_active + overdrive_cooldown；
--       AS percent_add gated by overdrive_active.
--
-- Wiki 真源（League Wiki Module:ItemData/data only；不使用 DDragon）：
--   数据参考/lol-wiki-current-items/manifest.json
--   revid 4030984
--   SHA256 e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
--     （current-items.raw.lua contentSha256；normalized.json 仅为本地派生索引）
--   Classic panel：ad=40 / attack_speed=0.20 / hp=450
--   Ranged Overdrive：成功大招武装 +0.50 bonus AS 于 [0,8000ms)；
--     冷却 [0,30000ms) 自大招起算。
--
-- State defaults（schema provider_state_fields 无 default/initial 列；运行时缺省 0）：
--   overdrive_active default0/max1/duration8000/refresh_policy20190
--   overdrive_cooldown default0/max1/duration30000/refresh_policy20190
--
-- Contract:
-- 1. Single transaction; fixed game_id='lol'; ensure_game_partitions then
--    lock game_data_state.
-- 2. Candidate revision = locked current_revision + 1; advance only when
--    business rows are actually inserted/changed.
-- 3. Missing required game / reserved_type / attribute_definitions =>
--    RAISE EXCEPTION and roll back.
-- 4. Ensure item_3073 without overwriting unrelated Batch-C metadata；upsert
--    Wiki static ad/attack_speed/hp.
-- 5. Game-local 62010 ability/ultimate（reserved_type_id NULL；双向 collision
--    guards）；62010 仅作 type_relations ability tag，不得写入 ability_kind_type_id。
-- 6. Ability ability_item_3073_overdrive_ultimate：kind 20130 active、
--    cast_origin='champion'、无 operation steps。
-- 7. No auto-publish; no DELETE/DROP/CASCADE; no legacy Bundle/Catalog writes。
--
-- 明确排除（本脚本不建模）：
--   Hexcharged 30 ultimate haste；+20% movement speed；melee 35%/14%；
--   Arena；multi-target / non-champion；live migration；publish；
--   Bundle/Catalog；legacy tables；DDragon / champion-static 数值溯源。
--
-- Prerequisites: reserved_types_seed.sql；Batch-C item_3073 optional（本脚本
--   ON CONFLICT DO NOTHING 复用既有实体）。
-- Suggested publish version (this script does not publish):
--   lol-generic-experimental-hexplate-3073-v1-20260720

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
        20172, -- value_policy/override
        20173, -- value_policy/percent_add
        20181, -- match_mode/all
        20190, -- refresh_policy/refresh_duration
        20205, -- event/ability_started
        20212, -- event/source_owner
        20250  -- state_scope/provider
    ];
    v_required_attrs     text[] := ARRAY[
        'hp', 'ad', 'attack_speed'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_experimental_hexplate_3073_seed: game_id=% missing in public.games',
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
            'lol_generic_experimental_hexplate_3073_seed: failed to lock game_data_state for %',
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
            'lol_generic_experimental_hexplate_3073_seed: missing reserved_type id(s): %',
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
            'lol_generic_experimental_hexplate_3073_seed: missing attribute_definitions for game_id=% attr_key(s): %',
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
    -- game-local ability tag（reserved_type_id=NULL）
    --   62010 ability/ultimate
    -- =========================================================================

    -- 62010 ability/ultimate
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62010
       AND t.type_key IS DISTINCT FROM 'ability/ultimate';

    IF v_conflict_type_key IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_experimental_hexplate_3073_seed: type_id=62010 already bound to type_key=% name=% reserved_type_id=% (expected ability/ultimate)',
            v_conflict_type_key, v_existing_name, v_existing_reserved;
    END IF;

    SELECT t.type_id
      INTO v_conflict_type_id
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_key = 'ability/ultimate'
       AND t.type_id IS DISTINCT FROM 62010;

    IF v_conflict_type_id IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_experimental_hexplate_3073_seed: type_key=ability/ultimate already bound to type_id=% (expected 62010)',
            v_conflict_type_id;
    END IF;

    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62010,
        'ability/ultimate',
        'Ultimate ability type',
        'Game-local ability type tag; Overdrive arm-listener All-matcher. Not ability_kind.',
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
    -- item_3073 entity：reuse if present；else minimal ensure（不覆写 Batch-C 元数据）
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'item_3073',
        '海克斯注力刚壁',
        'Experimental Hexplate（source item id 3073；ranged Overdrive only；no Hexcharged / melee / Arena）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- Wiki classic static panel（manifest/raw Lua；非 DDragon）
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'item_3073', 'ad', 40, v_candidate, NOW()),
        (v_game_id, 'item_3073', 'attack_speed', 0.20, v_candidate, NOW()),
        (v_game_id, 'item_3073', 'hp', 450, v_candidate, NOW())
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
    -- provider_item_3073_overdrive
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_item_3073_overdrive',
        20120,
        '海克斯注力刚壁 过载 Overdrive',
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

    -- overdrive_active：number / max1 / 8000ms / refresh_on_write；
    -- overdrive_cooldown：number / max1 / 30000ms / refresh_on_write；
    -- 不写 default_value（schema 无该列）；文档契约 default0。
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_item_3073_overdrive',
            'overdrive_active',
            20100,
            1,
            8000,
            20190,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3073_overdrive',
            'overdrive_cooldown',
            20100,
            1,
            30000,
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
            'provider_item_3073_overdrive',
            'cooldown_zero',
            '{"op":"eq","args":[{"op":"read","path":"provider.state.overdrive_cooldown"},{"op":"const","value":0}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3073_overdrive',
            'overdrive_arm_active',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3073_overdrive',
            'overdrive_arm_cooldown',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_item_3073_overdrive',
            'overdrive_attack_speed',
            '{"op":"mul","args":[{"op":"const","value":0.50},{"op":"read","path":"provider.state.overdrive_active"}]}'::jsonb,
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

    -- AS attribute percent_add（condition NULL；门控在公式内读 overdrive_active）
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'modifier_item_3073_overdrive_as',
        'provider_item_3073_overdrive',
        'overdrive_attack_speed',
        NULL,
        20110,
        'attack_speed',
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        20173,
        'overdrive_attack_speed',
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

    -- harness ultimate：kind active 20130；cast_origin champion；无 operation steps
    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, cast_condition_formula_key, cast_origin,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_item_3073_overdrive_ultimate',
        'provider_item_3073_overdrive',
        'overdrive_ultimate',
        20130,
        '过载大招锚点 Overdrive ultimate',
        NULL,
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

    -- 62010 ability/ultimate tag → ultimate ability（勿写入 ability_kind_type_id）
    -- Multiple 62010 relations are valid across items.
    INSERT INTO public.type_relations (
        game_id, type_id, target_category, target_id, extend,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62010,
        'ability',
        'ability_item_3073_overdrive_ultimate',
        '{"role":"ultimate"}'::jsonb,
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

    -- =========================================================================
    -- Arm sequence：active→1, cooldown→1；均 gated by cooldown_zero
    -- =========================================================================
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_item_3073_overdrive_arm',
        'provider_item_3073_overdrive',
        'overdrive_arm',
        'Overdrive arm on ultimate cast',
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
            'step_item_3073_overdrive_arm_active',
            'sequence_item_3073_overdrive_arm',
            0,
            20160,
            20110,
            'cooldown_zero',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_3073_overdrive_arm_cooldown',
            'sequence_item_3073_overdrive_arm',
            1,
            20160,
            20110,
            'cooldown_zero',
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
            'step_item_3073_overdrive_arm_active',
            20250,
            'overdrive_active',
            'overdrive_arm_active',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_item_3073_overdrive_arm_cooldown',
            20250,
            'overdrive_cooldown',
            'overdrive_arm_cooldown',
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

    -- =========================================================================
    -- Listener：ability_started All-matcher → arm sequence
    -- =========================================================================
    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, per_cast_throttle_ms,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_item_3073_overdrive_arm',
        'provider_item_3073_overdrive',
        'overdrive_arm',
        20205,
        NULL,
        NULL,
        NULL,
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

    -- Arm All: ability_started / ability/ultimate / source_owner
    INSERT INTO public.listener_match_types (
        game_id, listener_id, match_mode_type_id, type_id, change_revision, updated_at
    ) VALUES
        (v_game_id, 'listener_item_3073_overdrive_arm', 20181, 20205, v_candidate, NOW()),
        (v_game_id, 'listener_item_3073_overdrive_arm', 20181, 62010, v_candidate, NOW()),
        (v_game_id, 'listener_item_3073_overdrive_arm', 20181, 20212, v_candidate, NOW())
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
        'listener_item_3073_overdrive_arm',
        'sequence_item_3073_overdrive_arm',
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
        'item_3073',
        'provider_item_3073_overdrive',
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
