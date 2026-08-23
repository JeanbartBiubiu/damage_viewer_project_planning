-- =============================================================================
-- LoL generic Graves E Quickdraw seed（格雷福斯 E 快速拔枪 / Phase-A max-stack）
-- =============================================================================
--
-- Goal: close candidate hero_skill|hero_graves|E|快速拔枪 as generic runtime
--       Phase-A under the user-approved rank-5 maximum True Grit approximation.
--       Self-contained ensure hero_graves + Wiki level-1 panel + mana resource,
--       ensure bonus_armor / bonus_magic_resist definitions + hero EAV base=0,
--       mount only provider_hero_graves_quickdraw_max_stack owning
--       ability_hero_graves_quickdraw: impact override true_grit_stacks=8
--       (max8 / untimed), and four source-owned/self flat-add modifiers
--       19 * stacks (armor + bonus_armor) / 9.5 * stacks (MR + bonus_MR).
--
-- Candidate: hero_skill|hero_graves|E|快速拔枪
-- Frozen boundary: Phase-A rank-5 maximum True Grit stack approximation only.
--
-- Contract:
-- 1. Single transaction; fixed game_id='lol'; ensure_game_partitions then
--    lock game_data_state.
-- 2. Candidate revision = locked current_revision + 1; advance only on material change.
-- 3. Missing game / reserved_type / panel attribute_definitions => RAISE EXCEPTION rollback.
-- 4. Project required reserved -> types idempotently (DO NOTHING after fail-closed
--    identity checks; do not overwrite correct metadata).
-- 5. Ensure hero_graves ON CONFLICT DO NOTHING (preserve existing metadata);
--    Wiki-only level-1 panel + mana 325/325 with material-change guards;
--    do not overwrite the existing Graves P graph / unrelated mounts.
-- 6. Idempotently ensure bonus_armor / bonus_magic_resist (Jak'Sho/wiki-ready
--    pattern) and hero_graves base EAV=0 for both.
-- 7. Fail-closed on wrong stable provider/ability/modifier/step/state identity.
-- 8. No auto-publish; no DELETE/DROP/CASCADE/DDL; no legacy Bundle/Catalog.
--
-- Phase-A approximation (Wiki rank-5 max True Grit; nested binary AST):
--   cast impact: provider.state.true_grit_stacks := 8 (value_policy/override)
--   armor / bonus_armor           = 19 * provider.state.true_grit_stacks
--   magic_resist / bonus_magic_resist = 9.5 * provider.state.true_grit_stacks
--   at max stacks: armor/bonus_armor +152; magic_resist/bonus_magic_resist +76
--   mana cost 40; cooldown 12000ms; state untimed (duration_ms NULL / no refresh)
--
-- Completed boundary (modeled):
--   Direct cast write of max True Grit stacks; four resolved flat-add resistances;
--   active ability cost/cooldown; independent E provider mount.
--
-- Explicit exclusions (not modeled):
--   damage; reload / shell; attack-reset; pellet cooldown reduction; dash geometry;
--   direction checks; targeting; collision; multi-target; timed refresh/expiry;
--   intermediate stack operations; DDragon / Meraki / screenshot / OCR truth;
--   hero-specific runtime code; live migration; auto publish.
--
-- Mechanism numeric truth (League Wiki only; no DDragon / Meraki / OCR):
--   Template:Data Graves/Quickdraw revision 4007744
--   content SHA256 ff4c65c5ce2a0ac1ae757271fbb924b35bf4eca1af0f4d07a69d865db901a4e1
--   数据参考/lol-wiki-current-champions/normalized/generic/graves-e.json
--
-- Hero panel bootstrap only (Module:ChampionData/data; separate from E mechanism):
--   revision 4042886 pageid 1401029 timestamp 2026-07-14T19:39:51Z
--   full-module SHA256 98094d20a267a437b0ef667db6c67143a0e15c8f8dd27186262b0ed9f621c8a3
--   hp625 mana325 armor33 MR30 hp_regen8 mana_regen8 AD66 attack_speed0.475
--   (matches Graves P seed panel exactly; not E mechanism truth)
--
-- Preservation: provider_hero_graves_new_destiny / ability_hero_graves_basic_attack
--   and unrelated P rows are not written or remounted by this seed.
--
-- Prerequisites: reserved_types_seed.sql; required panel attribute_definitions exist.
-- Suggested publish version (this script does not publish):
--   lol-generic-graves-quickdraw-max-stack-v1-20260720

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
    v_foreign_steps      text;
    v_conflict_provider  text;
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20250, -- state_scope/provider
        20260  -- phase_trigger/on_enter
    ];
    -- bonus_armor / bonus_magic_resist are ensured below (Jak'Sho pattern).
    v_required_attrs     text[] := ARRAY[
        'hp', 'mana', 'ad', 'attack_speed', 'armor', 'magic_resist',
        'hp_regen', 'mana_regen'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_graves_quickdraw_max_stack_seed: game_id=% missing in public.games',
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
            'lol_generic_graves_quickdraw_max_stack_seed: failed to lock game_data_state for %',
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
            'lol_generic_graves_quickdraw_max_stack_seed: missing reserved_type id(s): %',
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
            'lol_generic_graves_quickdraw_max_stack_seed: missing attribute_definitions for game_id=% attr_key(s): %',
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
            'lol_generic_graves_quickdraw_max_stack_seed: conflicting types by type_id: %',
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
            'lol_generic_graves_quickdraw_max_stack_seed: conflicting types by type_key: %',
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

    -- Fail-closed: stable IDs must not be owned by a foreign provider
    SELECT pm.provider_id
      INTO v_conflict_provider
      FROM public.provider_modifiers pm
     WHERE pm.game_id = v_game_id
       AND pm.modifier_id IN (
           'modifier_hero_graves_quickdraw_armor',
           'modifier_hero_graves_quickdraw_bonus_armor',
           'modifier_hero_graves_quickdraw_magic_resist',
           'modifier_hero_graves_quickdraw_bonus_magic_resist'
       )
       AND pm.provider_id IS DISTINCT FROM 'provider_hero_graves_quickdraw_max_stack'
     LIMIT 1;

    IF v_conflict_provider IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_graves_quickdraw_max_stack_seed: modifier_id already bound to provider_id=% (expected provider_hero_graves_quickdraw_max_stack)',
            v_conflict_provider;
    END IF;

    SELECT ad.provider_id
      INTO v_conflict_provider
      FROM public.ability_definitions ad
     WHERE ad.game_id = v_game_id
       AND ad.ability_id = 'ability_hero_graves_quickdraw'
       AND ad.provider_id IS DISTINCT FROM 'provider_hero_graves_quickdraw_max_stack'
     LIMIT 1;

    IF v_conflict_provider IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_graves_quickdraw_max_stack_seed: ability_id already bound to provider_id=% (expected provider_hero_graves_quickdraw_max_stack)',
            v_conflict_provider;
    END IF;

    SELECT psf.provider_id
      INTO v_conflict_provider
      FROM public.provider_state_fields psf
     WHERE psf.game_id = v_game_id
       AND psf.state_key = 'true_grit_stacks'
       AND psf.provider_id IS DISTINCT FROM 'provider_hero_graves_quickdraw_max_stack'
     LIMIT 1;

    IF v_conflict_provider IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_graves_quickdraw_max_stack_seed: state_key=true_grit_stacks already bound to provider_id=% (expected provider_hero_graves_quickdraw_max_stack)',
            v_conflict_provider;
    END IF;

    -- =========================================================================
    -- Ensure hero_graves (preserve existing metadata; do not overwrite P graph)
    -- =========================================================================
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_graves',
        '格雷福斯',
        '格雷福斯 / Graves（Quickdraw Phase-A max-stack seed bootstrap）',
        v_candidate,
        NOW()
    )
    ON CONFLICT (game_id, entity_id) DO NOTHING;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- Wiki Module:ChampionData/data level-1 panel（bootstrap only; not E mechanism truth）
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



    -- Jak'Sho/wiki-ready：idempotent ensure bonus_armor / bonus_magic_resist
    INSERT INTO public.attribute_definitions (
        game_id, attr_key, sort_order, attr_name, attr_type, default_value,
        value_kind, rate_target_attr_key, min_value, max_value,
        change_revision, updated_at
    ) VALUES
        (v_game_id, 'bonus_armor', 910, '额外护甲', 'number', 0,
         'scalar', NULL, NULL, NULL, v_candidate, NOW()),
        (v_game_id, 'bonus_magic_resist', 911, '额外魔抗', 'number', 0,
         'scalar', NULL, NULL, NULL, v_candidate, NOW())
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

    -- hero_graves base EAV=0 so generic resolution can apply modifiers
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'hero_graves', 'bonus_armor', 0, v_candidate, NOW()),
        (v_game_id, 'hero_graves', 'bonus_magic_resist', 0, v_candidate, NOW())
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
    -- provider_hero_graves_quickdraw_max_stack + ability_hero_graves_quickdraw
    -- (independent of provider_hero_graves_new_destiny / P graph)
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_graves_quickdraw_max_stack',
        20120,
        '快速拔枪（E max-stack True Grit）',
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

    -- true_grit_stacks：numeric max=8；untimed（duration_ms NULL / refresh NULL；
    -- schema forbids duration_ms=0; NULL is the repository untimed equivalent）
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_graves_quickdraw_max_stack',
        'true_grit_stacks',
        20100,
        8,
        NULL,
        NULL,
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
            'provider_hero_graves_quickdraw_max_stack',
            'e_mana_cost',
            '{"op":"const","value":40}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_graves_quickdraw_max_stack',
            'e_cooldown_ms',
            '{"op":"const","value":12000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_graves_quickdraw_max_stack',
            'true_grit_stacks_max',
            '{"op":"const","value":8}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_graves_quickdraw_max_stack',
            'true_grit_armor',
            '{"op":"mul","args":[{"op":"const","value":19},{"op":"read","path":"provider.state.true_grit_stacks"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_graves_quickdraw_max_stack',
            'true_grit_bonus_armor',
            '{"op":"mul","args":[{"op":"const","value":19},{"op":"read","path":"provider.state.true_grit_stacks"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_graves_quickdraw_max_stack',
            'true_grit_magic_resist',
            '{"op":"mul","args":[{"op":"mul","args":[{"op":"const","value":19},{"op":"const","value":0.5}]},{"op":"read","path":"provider.state.true_grit_stacks"}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_graves_quickdraw_max_stack',
            'true_grit_bonus_magic_resist',
            '{"op":"mul","args":[{"op":"mul","args":[{"op":"const","value":19},{"op":"const","value":0.5}]},{"op":"read","path":"provider.state.true_grit_stacks"}]}'::jsonb,
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

    -- Four source-owned/self flat-add provider modifiers
    INSERT INTO public.provider_modifiers (
        game_id, modifier_id, provider_id, modifier_key,
        modifier_type_id, target_selector_type_id, target_attr_key,
        command_type_id, channel_type_id, bucket_type_id, stage_type_id,
        priority, value_policy_type_id, value_formula_key, condition_formula_key,
        change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'modifier_hero_graves_quickdraw_armor',
            'provider_hero_graves_quickdraw_max_stack',
            'true_grit_armor',
            NULL,
            20110,
            'armor',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20170,
            'true_grit_armor',
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'modifier_hero_graves_quickdraw_bonus_armor',
            'provider_hero_graves_quickdraw_max_stack',
            'true_grit_bonus_armor',
            NULL,
            20110,
            'bonus_armor',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20170,
            'true_grit_bonus_armor',
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'modifier_hero_graves_quickdraw_magic_resist',
            'provider_hero_graves_quickdraw_max_stack',
            'true_grit_magic_resist',
            NULL,
            20110,
            'magic_resist',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20170,
            'true_grit_magic_resist',
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'modifier_hero_graves_quickdraw_bonus_magic_resist',
            'provider_hero_graves_quickdraw_max_stack',
            'true_grit_bonus_magic_resist',
            NULL,
            20110,
            'bonus_magic_resist',
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            20170,
            'true_grit_bonus_magic_resist',
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
        'ability_hero_graves_quickdraw',
        'provider_hero_graves_quickdraw_max_stack',
        'quickdraw',
        20130,
        '快速拔枪（E）',
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
        'cooldown_hero_graves_quickdraw',
        'ability_hero_graves_quickdraw',
        'e_cooldown_ms',
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
        'phase_hero_graves_quickdraw_impact',
        'ability_hero_graves_quickdraw',
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
        'sequence_hero_graves_quickdraw_max_stack',
        'provider_hero_graves_quickdraw_max_stack',
        'true_grit_max_stack',
        '快速拔枪直接满层 True Grit',
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

    -- Sequence may only contain the one owned max-stack step; foreign steps => fail-closed
    SELECT string_agg(es.step_id, ', ' ORDER BY es.step_id)
      INTO v_foreign_steps
      FROM public.effect_steps es
     WHERE es.game_id = v_game_id
       AND es.sequence_id = 'sequence_hero_graves_quickdraw_max_stack'
       AND es.step_id NOT IN (
            'step_hero_graves_quickdraw_true_grit_max'
       );

    IF v_foreign_steps IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_graves_quickdraw_max_stack_seed: unexpected foreign step(s) in sequence_hero_graves_quickdraw_max_stack: %',
            v_foreign_steps;
    END IF;

    -- deferred exactly-one-detail：state_change 配一 state_effect_details
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_graves_quickdraw_true_grit_max',
        'sequence_hero_graves_quickdraw_max_stack',
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

    -- override true_grit_stacks=8（Do not use add；直接满层近似）
    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_graves_quickdraw_true_grit_max',
        20250,
        'true_grit_stacks',
        'true_grit_stacks_max',
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
        'phase_hero_graves_quickdraw_impact',
        20260,
        'sequence_hero_graves_quickdraw_max_stack',
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
        'provider_hero_graves_quickdraw_max_stack',
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
