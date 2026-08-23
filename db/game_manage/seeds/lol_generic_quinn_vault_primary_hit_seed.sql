-- =============================================================================
-- LoL generic Quinn E Vault primary-hit seed（奎因 E 旋翔掠杀 Phase-A v1）
-- =============================================================================
--
-- 目标：在仓库既有 lol_generic_quinn_heightened_senses_seed.sql 已提供
--       hero_quinn / ad 面板 / 通用普攻 provider / W Heightened Senses
--       provider，且 lol_generic_quinn_blinding_assault_primary_hit_seed.sql
--       provider/active ability Vault primary champion hit：50 mana、8000ms CD、
--       impact 对 opponent 恰好一次 physical damage =
--         140 + 0.20 * (source.attr.ad.resolved - source.attr.ad.base)。
--       规范投影为立即主目标 impact scaffold（null-duration phase + on_enter
--       sequence → 单一 damage 操作）。
--
-- 候选：hero_skill|hero_quinn|E|旋翔掠杀
-- task key：wasm-generic-quinn-vault-primary-hit
-- FROZEN_PLAN_REV=quinn-e-vault-phase-a-v1
-- 已完成边界（completed / full boundary）：
--   rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_140_plus_0_20_bonus_ad; no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. active_physical_damage
--   3. bonus_ad_ratio
--   4. immediate_impact_scaffold
--
-- Accepted review note NB-MANA-RESOURCE-SEED-ORDER：mana 资源行为 check-only；
-- 仓库注册顺序为 W → Q(resource) → E，即
--   lol_generic_quinn_heightened_senses_seed.sql
--   → lol_generic_quinn_blinding_assault_primary_hit_seed.sql（中性 mana 资源）
--   → 本 E seed。
-- 断言 resource 行存在，不断言 Q provider；Q provider 不是功能硬前置。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Hard prerequisites（fail-closed check-only，图写入前）：
--      - game lol 与所需 reserved types：20111/20120/20130/20142/20150/20170/20220/20260；
--      - attribute_definitions(lol,ad)；
--      - game_entities(lol,hero_quinn)；
--      - entity_attribute_values(lol,hero_quinn,ad)；
--      - provider_definitions provider_hero_quinn_basic_attack；
--      - provider_definitions provider_hero_quinn_heightened_senses。
--    显式前置 seed 顺序（W → Q(resource) → E）：
--      lol_generic_quinn_heightened_senses_seed.sql（hero_quinn、ad EAV、
--      basic provider、W provider）；
--      lol_generic_quinn_blinding_assault_primary_hit_seed.sql（中性 mana 资源；
--      Q provider 本身非硬前置）。
-- 4. 禁止写入：不对 games / game_entities / attribute_definitions /
--    entity_attribute_progressions 做 INSERT/UPDATE/DELETE；不改写 Quinn 身份/
--    面板/AP/资源/成长/普攻·W·Q 图。若已存在则保留：
--    provider_hero_quinn_basic_attack、provider_hero_quinn_heightened_senses、
--    provider_hero_quinn_q_blinding_assault_primary_hit（Q 若在则字节级/行级保留；
--    非硬前置）。允许 ensure 的共享行：reserved → game-local types 投影。
-- 5. 仅 create/挂载 provider_hero_quinn_e_vault_primary_hit 及其隔离 E 图：
--    一个 provider、一个 active ability、一个 cost、一个 cooldown、一个 null-duration
--    impact phase + on_enter link、一个 sequence/step、一个 physical damage detail、
--    一个 entity_provider_mounts。零 provider state / modifiers / listeners /
--    matchers / event-effect / repeat / control / emit_event 行。
-- 6. Accepted review note NB-ZERO-EMITTED-EVENTS-SCOPE：本 seeded E provider 图无
--    emit_event 操作，故不能 emit basic_attack_hit；不试图压制运行时既有合成
--    ability_started 语义，亦不添加 listener/event workaround。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog /
--    single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模；canonical generic ABI 无 dash / tracking / bounce /
-- range / speed / wall / geometry / grounded / knockdown / knockback / airborne /
-- slow / facing / windup / Harrier / basic-attack-reset / auto-attack 字段，故不
-- 编码这些表面，也不 claim 全保真）：
--   dash / tracking / bounce / range / speed / wall / geometry / grounded /
--   knockdown；knockback / airborne / slow / control / facing / windup；
--   Harrier mark / P / W interaction；basic-attack reset / fuzzy delay /
--   autoattack；failed-too-far；spellshield / callforhelp；
--   ranks 1–4；P / Q / W / R / basic 行为；loadout / crit / on-hit；
--   live migration / publish / E2E / full fidelity。
--
-- 数值来源（League Wiki Template:Data Quinn/E → resolved
-- Template:Data Quinn/Vault；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Quinn/E
--   resolved page Template:Data Quinn/Vault
--   wiki pageId 1308957
--   revision id 4024768
--   revision timestamp 2026-06-03T00:51:11Z
--   canonical raw byte size 2649
--   canonical content SHA256
--     9f6baba1d062b473d41586cd8323f31bd7c1c4d865db134a783c19ae998e7714
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/quinn-e.json
--   siblings：pages/quinn-e.json
--   local raw materialization caveat（非源矛盾）：仓库 local raw 为
--     2649-byte materialization，SHA256
--     317ac3ccf31e53ba17255dbb15c856ba5499d9257fbe0c9faa91b43f8438e24b。
--     canonical 身份以 sidecar/pages 为准；本脚本不断言 local raw 等价，
--     亦不主张源矛盾。
--   rank-5 champion primary hit：physical 140 + 20% bonus AD；
--     mana 50；cooldown 8000ms。
--
-- 前置：reserved_types_seed.sql；lol_generic_quinn_heightened_senses_seed.sql；
--       lol_generic_quinn_blinding_assault_primary_hit_seed.sql（中性 mana 资源；
--       W → Q(resource) → E）；既有 mana 资源行 check-only。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-quinn-vault-primary-hit-phase-a-v1-20260724

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
        20220, -- damage/physical
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY['ad'];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_vault_primary_hit_seed: game_id=% missing in public.games',
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
            'lol_generic_quinn_vault_primary_hit_seed: failed to lock game_data_state for %',
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
            'lol_generic_quinn_vault_primary_hit_seed: missing reserved_type id(s): %',
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
            'lol_generic_quinn_vault_primary_hit_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    -- W seed 显式前置：hero_quinn 身份（check-only）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_quinn'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_vault_primary_hit_seed: missing game_entities hero_quinn (prerequisite lol_generic_quinn_heightened_senses_seed.sql; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_quinn'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_vault_primary_hit_seed: missing entity_attribute_values hero_quinn/ad (prerequisite lol_generic_quinn_heightened_senses_seed.sql; check-only)';
    END IF;

    -- NB-MANA-RESOURCE-SEED-ORDER：mana 资源行由 Q seed 中性写入提供；本 seed check-only


    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_hero_quinn_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_vault_primary_hit_seed: missing provider_hero_quinn_basic_attack (prerequisite lol_generic_quinn_heightened_senses_seed.sql; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_hero_quinn_heightened_senses'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_vault_primary_hit_seed: missing provider_hero_quinn_heightened_senses (prerequisite lol_generic_quinn_heightened_senses_seed.sql; check-only)';
    END IF;

    -- reserved → game-local types（同 ID / 同 type_key / reserved_type_id=type_id）
    -- 本 seed 唯一允许 ensure 的共享行；不物化身份/面板/资源值
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
    -- hero_quinn Vault primary-hit（E rank-5）：独立 provider + active
    -- 单次物理伤害；不触碰 basic / Heightened Senses / Blinding Assault provider
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_quinn_e_vault_primary_hit',
        20120,
        '奎因 E 旋翔掠杀 Vault primary-hit（Phase-A v1 rank5 主冠军目标）',
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

    -- nested binary add：compileGenericNode 仅接线 args[0]/args[1]
    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_hero_quinn_e_vault_primary_hit',
            'e_mana_cost',
            '{"op":"const","value":50}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_quinn_e_vault_primary_hit',
            'e_cooldown_ms',
            '{"op":"const","value":8000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_quinn_e_vault_primary_hit',
            'vault_damage',
            '{"op":"add","args":[{"op":"const","value":140},{"op":"mul","args":[{"op":"const","value":0.20},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}'::jsonb,
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
        'ability_hero_quinn_e_vault_primary_hit',
        'provider_hero_quinn_e_vault_primary_hit',
        'vault_primary_hit',
        20130,
        '旋翔掠杀（E）',
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
        'cooldown_hero_quinn_e_vault_primary_hit',
        'ability_hero_quinn_e_vault_primary_hit',
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

    -- null-duration impact phase：assembler 产出一次立即 operation（Phase-A scaffold）
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_quinn_e_vault_primary_hit_impact',
        'ability_hero_quinn_e_vault_primary_hit',
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
        'sequence_hero_quinn_e_vault_primary_hit_impact',
        'provider_hero_quinn_e_vault_primary_hit',
        'vault_impact',
        '旋翔掠杀 impact（主冠军目标单次物理伤害）',
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
        'step_hero_quinn_e_vault_primary_hit_damage',
        'sequence_hero_quinn_e_vault_primary_hit_impact',
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
        'step_hero_quinn_e_vault_primary_hit_damage',
        'vault_damage',
        20220,
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
        'phase_hero_quinn_e_vault_primary_hit_impact',
        20260,
        'sequence_hero_quinn_e_vault_primary_hit_impact',
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
        'hero_quinn',
        'provider_hero_quinn_e_vault_primary_hit',
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
