-- =============================================================================
-- LoL generic Graves P New Destiny seed（格雷福斯 P 新命运 / Phase-A point-blank）
-- =============================================================================
--
-- Goal: close candidate hero_skill|hero_graves|P|新命运 as generic runtime Phase-A.
--       Self-contained ensure hero_graves + Wiki level-1 panel + mana resource,
--       mount only provider_hero_graves_new_destiny owning ability_hero_graves_basic_attack:
--       one merged physical point-blank damage AD * F(x) * (1 + 3*s),
--       crit_eligible=true, copyable_on_hit=false; source-owned basic_damage
--       crit natural/forced pipeline overrides; exactly one following
--       event/basic_attack_hit emit.
--
-- Candidate: hero_skill|hero_graves|P|新命运
-- Frozen boundary: Phase-A point-blank maximum pellets only (completed / full boundary).
--
-- Contract:
-- 1. Single transaction; fixed game_id='lol'; ensure_game_partitions then
--    lock game_data_state.
-- 2. Candidate revision = locked current_revision + 1; advance only on material change.
-- 3. Missing game / reserved_type / attribute_definitions => RAISE EXCEPTION rollback.
-- 4. Project required reserved -> types idempotently (DO NOTHING after fail-closed
--    identity checks; do not overwrite correct metadata).
-- 5. Ensure game-local type_id=62003 type_key=ability/basic_attack (fail-closed on
--    mismatch); bind via type_relations to ability_hero_graves_basic_attack.
-- 6. Ensure hero_graves ON CONFLICT DO NOTHING (preserve existing metadata);
--    Wiki-only level-1 panel + mana 325/325 with material-change guards;
--    champion_level scalar min1/max18 + entity base=1 + stages 1..18;
--    runtime EAV crit_chance=0 / crit_damage=2.0 (not Graves P numeric truth).
-- 7. Fail-closed on wrong stable provider/ability/modifier/step identity and
--    foreign owned steps/relations.
-- 8. No auto-publish; no DELETE/DROP/CASCADE/DDL; no legacy Bundle/Catalog.
--
-- Phase-A formula (Wiki point-blank merge; nested binary AST):
--   x = source.attr.champion_level.resolved
--   AD = source.attr.ad.resolved
--   s = 0.33302
--   F(x) = 0.6895 + 0.01765*x*(0.595 + 0.0225*(x-1))
--   damage = AD * F(x) * (1 + 3*s)
--   crit override (stages 20280 + 20279, value_policy/override 20172):
--     ((1 + 5*s) / (1 + 3*s)) * (1 + 0.5*(source.attr.crit_damage.resolved - 1))
--
-- Completed boundary (modeled):
--   Point-blank merged physical basic attack; natural + forced crit multiplier
--   overrides on channel/basic_damage; ability/basic_attack type relation;
--   unique event/basic_attack_hit emit after damage.
--
-- Explicit exclusions (not modeled):
--   reload / cadence; pellet instances; projectile / distance; multi-target;
--   on-hit replay; structures / wards; life steal; knockback; RNG;
--   hero-specific runtime code; live migration; auto publish.
--
-- Mechanism numeric truth (League Wiki only; no DDragon / Meraki / OCR):
--   Template:Data Graves/New Destiny revision 4038342
--   content SHA256 553bda222e9e85f0eff6d4cba3b8723979a58b68fba9097d2dfa1bd373117aa8
--   数据参考/lol-wiki-current-champions/normalized/generic/graves-p.json
--   reviewed-contracts.json#graves-p
--
-- Hero panel bootstrap only (Module:ChampionData/data; separate from P mechanism):
--   revision 4042886 pageid 1401029 timestamp 2026-07-14T19:39:51Z
--   full-module SHA256 98094d20a267a437b0ef667db6c67143a0e15c8f8dd27186262b0ed9f621c8a3
--   hp625 mana325 armor33 MR30 hp_regen8 mana_regen8 AD66 attack_speed0.475
--
-- Prerequisites: reserved_types_seed.sql; required attribute_definitions exist.
-- Suggested publish version (this script does not publish):
--   lol-generic-graves-new-destiny-v1-20260720

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
    v_conflict_types     text;
    v_foreign_steps      text;
    v_conflict_provider  text;
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
        20170, -- value_policy/add
        20172, -- value_policy/override
        20211, -- event/basic_attack_hit
        20220, -- damage/physical
        20252, -- state_scope/provider_target (vocabulary; graph unused)
        20260, -- phase_trigger/on_enter
        20264, -- modifier_kind/pipeline
        20265, -- command/damage (vocabulary; crit path uses 20277)
        20266, -- channel/basic_damage
        20269, -- bucket/all_instances
        20277, -- command/crit
        20279, -- stage/crit_multiplier_forced_branch
        20280  -- stage/crit_multiplier_natural_branch
    ];
    -- champion_level is ensured below (create-or-fix scalar 1..18), not preflighted.
    v_required_attrs     text[] := ARRAY[
        'hp', 'mana', 'ad', 'attack_speed', 'armor', 'magic_resist',
        'hp_regen', 'mana_regen', 'crit_chance', 'crit_damage'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_graves_new_destiny_seed: game_id=% missing in public.games',
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
            'lol_generic_graves_new_destiny_seed: failed to lock game_data_state for %',
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
            'lol_generic_graves_new_destiny_seed: missing reserved_type id(s): %',
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
            'lol_generic_graves_new_destiny_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    -- Fail-closed: existing types must match reserved identity (by type_id / type_key)
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
            'lol_generic_graves_new_destiny_seed: conflicting types by type_id: %',
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
            'lol_generic_graves_new_destiny_seed: conflicting types by type_key: %',
            v_conflict_types;
    END IF;

    -- reserved -> game-local types（idempotent; do not overwrite correct metadata）
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

    -- =========================================================================
    -- game-local type 62003 / ability/basic_attack（reserved_type_id=NULL）
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
            'lol_generic_graves_new_destiny_seed: type_id=62003 already bound to type_key=% name=% reserved_type_id=% (expected ability/basic_attack, reserved_type_id=NULL)',
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
            'lol_generic_graves_new_destiny_seed: type_key=ability/basic_attack already bound to type_id=% (expected 62003)',
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
        'Game-local tag for independent basic attack abilities used by New Destiny Phase-A.',
        NULL,
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, type_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- Fail-closed: stable IDs must not be owned by a foreign provider
    SELECT pm.provider_id
      INTO v_conflict_provider
      FROM public.provider_modifiers pm
     WHERE pm.game_id = v_game_id
       AND pm.modifier_id IN (
           'modifier_hero_graves_new_destiny_crit_natural',
           'modifier_hero_graves_new_destiny_crit_forced'
       )
       AND pm.provider_id IS DISTINCT FROM 'provider_hero_graves_new_destiny'
     LIMIT 1;

    IF v_conflict_provider IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_graves_new_destiny_seed: modifier_id already bound to provider_id=% (expected provider_hero_graves_new_destiny)',
            v_conflict_provider;
    END IF;

    SELECT ad.provider_id
      INTO v_conflict_provider
      FROM public.ability_definitions ad
     WHERE ad.game_id = v_game_id
       AND ad.ability_id = 'ability_hero_graves_basic_attack'
       AND ad.provider_id IS DISTINCT FROM 'provider_hero_graves_new_destiny'
     LIMIT 1;

    IF v_conflict_provider IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_graves_new_destiny_seed: ability_id already bound to provider_id=% (expected provider_hero_graves_new_destiny)',
            v_conflict_provider;
    END IF;

    -- =========================================================================
    -- Ensure hero_graves (preserve existing metadata)
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_graves',
        '格雷福斯',
        '格雷福斯 / Graves（New Destiny Phase-A seed bootstrap）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- Wiki Module:ChampionData/data level-1 panel（bootstrap only; not P mechanism truth）
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'hero_graves', 'hp', 625, v_candidate, NOW()),
        (v_game_id, 'hero_graves', 'mana', 325, v_candidate, NOW()),
        (v_game_id, 'hero_graves', 'ad', 66, v_candidate, NOW()),
        (v_game_id, 'hero_graves', 'attack_speed', 0.475, v_candidate, NOW()),
        (v_game_id, 'hero_graves', 'armor', 33, v_candidate, NOW()),
        (v_game_id, 'hero_graves', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_graves', 'hp_regen', 8, v_candidate, NOW()),
        (v_game_id, 'hero_graves', 'mana_regen', 8, v_candidate, NOW())
    ON CONFLICT (game_id, entity_id, attr_key) DO UPDATE SET
        base_value = EXCLUDED.base_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_attribute_values.base_value IS DISTINCT FROM EXCLUDED.base_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- Runtime crit prerequisites（not Graves P numeric truth）
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'hero_graves', 'crit_chance', 0, v_candidate, NOW()),
        (v_game_id, 'hero_graves', 'crit_damage', 2.0, v_candidate, NOW())
    ON CONFLICT (game_id, entity_id, attr_key) DO UPDATE SET
        base_value = EXCLUDED.base_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_attribute_values.base_value IS DISTINCT FROM EXCLUDED.base_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- mana resource 325/325


    -- champion_level：scalar min1/max18（ensure material fields only）
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
        v_game_id, 'hero_graves', 'champion_level', 1, v_candidate, NOW()
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
        'hero_graves',
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
    -- provider_hero_graves_new_destiny + ability_hero_graves_basic_attack
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_graves_new_destiny',
        20120,
        '新命运',
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

    -- Formulas: merged point-blank damage + shared crit multiplier override
    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_hero_graves_new_destiny',
            'basic_attack_damage',
            -- AD * F(x) * (1 + 3*s); F(x)=0.6895+0.01765*x*(0.595+0.0225*(x-1)); s=0.33302
            '{"op":"mul","args":[{"op":"mul","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"add","args":[{"op":"const","value":0.6895},{"op":"mul","args":[{"op":"const","value":0.01765},{"op":"mul","args":[{"op":"read","path":"source.attr.champion_level.resolved"},{"op":"add","args":[{"op":"const","value":0.595},{"op":"mul","args":[{"op":"const","value":0.0225},{"op":"sub","args":[{"op":"read","path":"source.attr.champion_level.resolved"},{"op":"const","value":1}]}]}]}]}]}]}]},{"op":"add","args":[{"op":"const","value":1},{"op":"mul","args":[{"op":"const","value":3},{"op":"const","value":0.33302}]}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_graves_new_destiny',
            'crit_multiplier_override',
            -- ((1+5*s)/(1+3*s)) * (1 + 0.5*(crit_damage.resolved - 1)); s=0.33302
            '{"op":"mul","args":[{"op":"div","args":[{"op":"add","args":[{"op":"const","value":1},{"op":"mul","args":[{"op":"const","value":5},{"op":"const","value":0.33302}]}]},{"op":"add","args":[{"op":"const","value":1},{"op":"mul","args":[{"op":"const","value":3},{"op":"const","value":0.33302}]}]}]},{"op":"add","args":[{"op":"const","value":1},{"op":"mul","args":[{"op":"const","value":0.5},{"op":"sub","args":[{"op":"read","path":"source.attr.crit_damage.resolved"},{"op":"const","value":1}]}]}]}]}'::jsonb,
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

    -- Natural branch crit multiplier override (stage 20280)
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'modifier_hero_graves_new_destiny_crit_natural',
        'provider_hero_graves_new_destiny',
        'crit_multiplier_natural_branch',
        20264,
        20110,
        'hp',
        20277,
        20266,
        20269,
        20280,
        0,
        20172,
        'crit_multiplier_override',
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

    -- Forced branch crit multiplier override (stage 20279)
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'modifier_hero_graves_new_destiny_crit_forced',
        'provider_hero_graves_new_destiny',
        'crit_multiplier_forced_branch',
        20264,
        20110,
        'hp',
        20277,
        20266,
        20269,
        20279,
        0,
        20172,
        'crit_multiplier_override',
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
        'ability_hero_graves_basic_attack',
        'provider_hero_graves_new_destiny',
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
        'ability_hero_graves_basic_attack',
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
        'phase_hero_graves_basic_attack_impact',
        'ability_hero_graves_basic_attack',
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
        'sequence_hero_graves_basic_attack_damage',
        'provider_hero_graves_new_destiny',
        'basic_attack_damage',
        '新命运点空白普攻伤害',
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

    -- Sequence may only contain the two owned steps; foreign steps => fail-closed
    SELECT string_agg(es.step_id, ', ' ORDER BY es.step_id)
      INTO v_foreign_steps
      FROM public.effect_steps es
     WHERE es.game_id = v_game_id
       AND es.sequence_id = 'sequence_hero_graves_basic_attack_damage'
       AND es.step_id NOT IN (
            'step_hero_graves_basic_attack_damage',
            'step_hero_graves_basic_attack_emit_hit'
       );

    IF v_foreign_steps IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_graves_new_destiny_seed: unexpected foreign step(s) in sequence_hero_graves_basic_attack_damage: %',
            v_foreign_steps;
    END IF;

    -- Collision-safe reorder when owned steps sit on non-final orders
    IF EXISTS (
        SELECT 1
          FROM public.effect_steps es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_hero_graves_basic_attack_damage'
           AND (
                (es.step_id = 'step_hero_graves_basic_attack_damage'
                    AND es.step_order IS DISTINCT FROM 0)
             OR (es.step_id = 'step_hero_graves_basic_attack_emit_hit'
                    AND es.step_order IS DISTINCT FROM 1)
           )
    ) THEN
        SELECT COALESCE(MAX(es.step_order), 0)
          INTO v_temp_order_base
          FROM public.effect_steps es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_hero_graves_basic_attack_damage';

        WITH owned AS (
            SELECT es.step_id,
                   ROW_NUMBER() OVER (ORDER BY es.step_id) AS rn
              FROM public.effect_steps es
             WHERE es.game_id = v_game_id
               AND es.sequence_id = 'sequence_hero_graves_basic_attack_damage'
               AND es.step_id IN (
                    'step_hero_graves_basic_attack_damage',
                    'step_hero_graves_basic_attack_emit_hit'
               )
        )
        UPDATE public.effect_steps es
           SET step_order = v_temp_order_base + owned.rn,
               updated_at = NOW()
          FROM owned
         WHERE es.game_id = v_game_id
           AND es.step_id = owned.step_id;
        -- Temporary parking only; do not set v_changed here.
    END IF;

    -- order 0 damage -> order 1 emit (deferred exactly-one-detail pairing below)
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_graves_basic_attack_damage',
            'sequence_hero_graves_basic_attack_damage',
            0,
            20150,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_graves_basic_attack_emit_hit',
            'sequence_hero_graves_basic_attack_damage',
            1,
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

    -- deferred exactly-one-detail: damage step + emit step
    INSERT INTO public.damage_effect_details (
        game_id, step_id, amount_formula_key, damage_type_id, value_policy_type_id,
        copyable_on_hit, crit_eligible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_graves_basic_attack_damage',
        'basic_attack_damage',
        20220,
        20170,
        false,
        true,
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

    INSERT INTO public.event_effect_details (
        game_id, step_id, event_type_id, event_ref, payload,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_graves_basic_attack_emit_hit',
        20211,
        'event_ref_hero_graves_basic_attack_hit',
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
        'phase_hero_graves_basic_attack_impact',
        20260,
        'sequence_hero_graves_basic_attack_damage',
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
        'hero_graves',
        'provider_hero_graves_new_destiny',
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
