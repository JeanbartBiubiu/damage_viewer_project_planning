-- =============================================================================
-- LoL generic Quinn P Harrier pre-marked consume seed（奎因 P 侵扰 Phase-A v2）
-- =============================================================================
--
-- 目标：在仓库既有 lol_generic_quinn_heightened_senses_seed.sql 已提供
--       hero_quinn / ad EAV / 通用普攻 provider（含 basic_attack_hit emit）/
--       provider_hero_quinn_heightened_senses（含 harrier_vulnerable /
--       heightened_senses_active 状态、W arm 条件/武装公式、W AS modifier、
--       W basic_attack_hit listener）的前提下，仅向既有 W provider 追加
--       P-owned 公式 / listener / sequence / 三步序：对预先存在
--       harrier_vulnerable≥1 的目标 basic_attack_hit 时，
--       （1）武装 heightened_senses_active=1、（2）level-18 bonus physical
--       120 + 0.40*bonusAD、（3）以 provider_target 语义清零 harrier_vulnerable。
--       不新建 provider / mount；不改写 W 既有图。
--
-- 候选：hero_skill|hero_quinn|P|侵扰
-- task key：wasm-generic-quinn-harrier-premarked-consume
-- FROZEN_PLAN_REV=quinn-p-harrier-premarked-consume-phase-a-v2
-- 已完成边界（completed / full boundary）：
--   level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels
-- Ordered tags：
--   1. on_hit
--   2. formula_on_hit
--   3. bonus_ad_ratio
--   4. copyable_on_hit_false
--   5. provider_target_state_consume
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Hard prerequisites（fail-closed check-only，图写入前；显式顺序 W → P）：
--      - game lol 与所需 reserved types；
--      - attribute_definitions(lol,ad)；
--      - game_entities(lol,hero_quinn)；
--      - entity_attribute_values(lol,hero_quinn,ad)；
--      - provider_definitions provider_hero_quinn_basic_attack；
--      - basic provider owner basic_attack_hit emit 路径
--        （step_hero_quinn_basic_attack_emit_hit + event_ref）；
--      - provider_definitions provider_hero_quinn_heightened_senses；
--      - provider_state_fields harrier_vulnerable（契约 provider_target / max1 /
--        untimed）与 heightened_senses_active（provider / max1 / 2000ms /
--        refresh_duration）；
--      - provider_formulas heightened_senses_arm_condition /
--        heightened_senses_active_arm（check-only，不改写）；
--      - provider_modifiers modifier_hero_quinn_heightened_senses_attack_speed；
--      - provider_listeners listener_hero_quinn_heightened_senses_basic_attack_hit。
--    显式前置 seed：lol_generic_quinn_heightened_senses_seed.sql。
--    Q / E / mana 资源 **不是** 前置；本 seed 不断言/依赖 Q·E provider。
-- 4. 禁止写入：不对 provider_definitions / entity_provider_mounts /
--    game_entities / entity_attribute_values / resource_* /
--    entity_attribute_progressions / provider_state_fields /
--    provider_modifiers / W 既有 formulas·listener·sequence·steps 做
--    INSERT/UPDATE/DELETE。允许 ensure：reserved → game-local types 投影；
--    以及向既有 W provider 追加 P-owned formulas / listener / sequence /
--    steps / damage·state details。
-- 5. P 图：恰好一个 listener（listener_hero_quinn_p_harrier_premarked_consume）
--    挂在既有 provider_hero_quinn_heightened_senses；match
--    event/basic_attack_hit + event/source_owner ALL；max_triggers=1；
--    ability_id NULL。恰好一个 sequence，三步均条件
--    heightened_senses_arm_condition：
--      step0 state_change selector/self(20110) scope provider(20250)
--        override heightened_senses_active ← heightened_senses_active_arm；
--      step1 damage selector/opponent(20111) physical(20220)
--        harrier_p_level18_bonus_damage；non-crit；copyable_on_hit=false；
--      step2 state_change selector/self(20110)（禁止 opponent 20111）
--        scope provider_target(20252) override harrier_vulnerable ←
--        harrier_p_mark_clear(=0)。
--    运行时说明：provider_target 状态按帧战斗目标（frame combat target）键存；
--    故 mark consume 用 selector/self + scope 20252，而非 selector/opponent。
-- 6. 既有 W listener 可先于或后于 P 触发；P step0 再次武装 active=1，
--    保证顺序无关。不改写 / 不重述 W AS magnitude。
-- 7. 无 emit_event、无 active ability/cost/cooldown、无 mark 生成、无新
--    provider/mount、无额外 listener、无 repeat/control/modifier/lifecycle。
-- 8. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/
--    Catalog / single_attacker_dps；不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（本脚本不建模）：
--   mark 生成 / ability / ability duration / reveal；Valor targeting；
--   monster bonus；R disable；parry；其它等级（非 level-18）；
--   ability 主动施放 / cost / cooldown；Q / E / R 行为；
--   live migration / publish / E2E / full fidelity。
--
-- 数值来源（League Wiki Template:Data Quinn/I → resolved
-- Template:Data Quinn/Harrier；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon / Meraki 数值溯源）：
--   request Template:Data Quinn/I
--   resolved page Template:Data Quinn/Harrier
--   wiki pageId 1308953
--   revision id 4024765
--   revision timestamp 2026-06-03T00:49:03Z
--   canonical raw byte size 2390
--   canonical content SHA256
--     740debfb3b72dd7f926337f7eb4adbe3a65c88caec227ca16e00dff6634f798c
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/quinn-p.json
--   siblings：pages/quinn-p.json
--   local raw materialization caveat（非源矛盾）：仓库 local raw 为
--     2390-byte materialization，SHA256
--     08853c2c25ada7769e25908123dbb56f7b14dc0c1479a8a5842693874849a731。
--     canonical 身份以 sidecar/pages 为准；本脚本不断言 local raw 等价，
--     亦不主张源矛盾。
--   level-18 pre-marked single basic-attack consume：
--     bonus physical 120 + 0.40 * bonusAD。
--
-- 前置：reserved_types_seed.sql；lol_generic_quinn_heightened_senses_seed.sql
--       （W → P；Q/E 非前置）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-quinn-p-harrier-premarked-consume-phase-a-v2-20260724

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
        20110, -- selector/self
        20111, -- selector/opponent
        20150, -- operation/damage
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20181, -- match_mode/all
        20211, -- event/basic_attack_hit
        20212, -- event/source_owner
        20220, -- damage/physical
        20250, -- state_scope/provider
        20252  -- state_scope/provider_target
    ];
    v_required_attrs     text[] := ARRAY['ad'];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: game_id=% missing in public.games',
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
            'lol_generic_quinn_p_harrier_premarked_consume_seed: failed to lock game_data_state for %',
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
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing reserved_type id(s): %',
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
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    -- =========================================================================
    -- Fail-closed：W seed 显式前置（W → P；Q/E 非前置；check-only）
    -- =========================================================================
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_quinn'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing game_entities hero_quinn (prerequisite lol_generic_quinn_heightened_senses_seed.sql; W -> P; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_quinn'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing entity_attribute_values hero_quinn/ad (prerequisite lol_generic_quinn_heightened_senses_seed.sql; W -> P; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_hero_quinn_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing provider_hero_quinn_basic_attack (prerequisite lol_generic_quinn_heightened_senses_seed.sql; W -> P; check-only)';
    END IF;

    -- basic provider owner basic_attack_hit event path（供 P/W listener 消费）
    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_steps st
         WHERE st.game_id = v_game_id
           AND st.step_id = 'step_hero_quinn_basic_attack_emit_hit'
           AND st.sequence_id = 'sequence_hero_quinn_basic_attack_damage'
           AND st.operation_type_id = 20158
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing step_hero_quinn_basic_attack_emit_hit (prerequisite lol_generic_quinn_heightened_senses_seed.sql basic_attack_hit path; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.event_effect_details e
         WHERE e.game_id = v_game_id
           AND e.step_id = 'step_hero_quinn_basic_attack_emit_hit'
           AND e.event_type_id = 20211
           AND e.event_ref = 'event_ref_hero_quinn_basic_attack_hit'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing event_effect_details event_ref_hero_quinn_basic_attack_hit (prerequisite lol_generic_quinn_heightened_senses_seed.sql; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_hero_quinn_heightened_senses'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing provider_hero_quinn_heightened_senses (prerequisite lol_generic_quinn_heightened_senses_seed.sql; W -> P; check-only)';
    END IF;

    -- W provider_target 契约态 harrier_vulnerable：max1 / untimed（缺省 0）
    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_state_fields psf
         WHERE psf.game_id = v_game_id
           AND psf.provider_id = 'provider_hero_quinn_heightened_senses'
           AND psf.state_key = 'harrier_vulnerable'
           AND psf.value_type_id = 20100
           AND psf.max_value = 1
           AND psf.duration_ms IS NULL
           AND psf.refresh_policy_type_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing/invalid provider_state_fields harrier_vulnerable (provider_target/max1/untimed; prerequisite W seed; check-only)';
    END IF;

    -- W provider timed heightened_senses_active：max1 / 2000ms / refresh_duration
    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_state_fields psf
         WHERE psf.game_id = v_game_id
           AND psf.provider_id = 'provider_hero_quinn_heightened_senses'
           AND psf.state_key = 'heightened_senses_active'
           AND psf.value_type_id = 20100
           AND psf.max_value = 1
           AND psf.duration_ms = 2000
           AND psf.refresh_policy_type_id = 20190
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing/invalid provider_state_fields heightened_senses_active (provider/max1/2000ms/refresh_duration; prerequisite W seed; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_formulas pf
         WHERE pf.game_id = v_game_id
           AND pf.provider_id = 'provider_hero_quinn_heightened_senses'
           AND pf.formula_key = 'heightened_senses_arm_condition'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing provider_formulas heightened_senses_arm_condition (prerequisite W seed; check-only; do not rewrite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_formulas pf
         WHERE pf.game_id = v_game_id
           AND pf.provider_id = 'provider_hero_quinn_heightened_senses'
           AND pf.formula_key = 'heightened_senses_active_arm'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing provider_formulas heightened_senses_active_arm (prerequisite W seed; check-only; do not rewrite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_modifiers pm
         WHERE pm.game_id = v_game_id
           AND pm.modifier_id = 'modifier_hero_quinn_heightened_senses_attack_speed'
           AND pm.provider_id = 'provider_hero_quinn_heightened_senses'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing modifier_hero_quinn_heightened_senses_attack_speed (prerequisite W seed; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_listeners pl
         WHERE pl.game_id = v_game_id
           AND pl.listener_id = 'listener_hero_quinn_heightened_senses_basic_attack_hit'
           AND pl.provider_id = 'provider_hero_quinn_heightened_senses'
           AND pl.event_type_id = 20211
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing listener_hero_quinn_heightened_senses_basic_attack_hit (prerequisite W seed; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_sequences es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_hero_quinn_heightened_senses_arm'
           AND es.provider_id = 'provider_hero_quinn_heightened_senses'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing sequence_hero_quinn_heightened_senses_arm (prerequisite W seed; check-only; do not rewrite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_steps st
         WHERE st.game_id = v_game_id
           AND st.step_id = 'step_hero_quinn_heightened_senses_active_arm'
           AND st.sequence_id = 'sequence_hero_quinn_heightened_senses_arm'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_quinn_p_harrier_premarked_consume_seed: missing step_hero_quinn_heightened_senses_active_arm (prerequisite W seed; check-only; do not rewrite)';
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
    -- P-owned formulas（挂在既有 W provider；不改写 W arm 条件/武装公式）
    -- nested binary add：compileGenericNode 仅接线 args[0]/args[1]
    -- =========================================================================
    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_hero_quinn_heightened_senses',
            'harrier_p_level18_bonus_damage',
            '{"op":"add","args":[{"op":"const","value":120},{"op":"mul","args":[{"op":"const","value":0.40},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_quinn_heightened_senses',
            'harrier_p_mark_clear',
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

    -- =========================================================================
    -- P sequence：arm active → bonus physical → provider_target mark clear
    -- 三步均条件 heightened_senses_arm_condition（reuse W；不改写）
    -- =========================================================================
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_quinn_p_harrier_premarked_consume',
        'provider_hero_quinn_heightened_senses',
        'harrier_premarked_consume',
        '奎因 P 侵扰预标记消耗（level18）',
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
            'step_hero_quinn_p_harrier_premarked_consume_active_arm',
            'sequence_hero_quinn_p_harrier_premarked_consume',
            0,
            20160,
            20110,
            'heightened_senses_arm_condition',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_quinn_p_harrier_premarked_consume_bonus_damage',
            'sequence_hero_quinn_p_harrier_premarked_consume',
            1,
            20150,
            20111,
            'heightened_senses_arm_condition',
            v_candidate,
            NOW()
        ),
        (
            -- mark consume：selector/self(20110) + provider_target(20252)；
            -- 禁止 selector/opponent(20111)；运行时按帧战斗目标键存 provider_target
            v_game_id,
            'step_hero_quinn_p_harrier_premarked_consume_mark_clear',
            'sequence_hero_quinn_p_harrier_premarked_consume',
            2,
            20160,
            20110,
            'heightened_senses_arm_condition',
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

    -- deferred exactly-one-detail：state_change 配 state_effect_details
    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_quinn_p_harrier_premarked_consume_active_arm',
            20250,
            'heightened_senses_active',
            'heightened_senses_active_arm',
            20172,
            v_candidate,
            NOW()
        ),
        (
            -- semantic attack-target mark consume：self selector + provider_target scope
            v_game_id,
            'step_hero_quinn_p_harrier_premarked_consume_mark_clear',
            20252,
            'harrier_vulnerable',
            'harrier_p_mark_clear',
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

    INSERT INTO public.damage_effect_details (
        game_id, step_id, amount_formula_key, damage_type_id, value_policy_type_id,
        copyable_on_hit, crit_eligible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_quinn_p_harrier_premarked_consume_bonus_damage',
        'harrier_p_level18_bonus_damage',
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

    -- 恰好一个 P listener（与既有 W listener 并存；不改写 W listener）
    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_hero_quinn_p_harrier_premarked_consume',
        'provider_hero_quinn_heightened_senses',
        'harrier_premarked_consume_on_basic_attack_hit',
        20211,
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
        (v_game_id, 'listener_hero_quinn_p_harrier_premarked_consume', 20181, 20211, v_candidate, NOW()),
        (v_game_id, 'listener_hero_quinn_p_harrier_premarked_consume', 20181, 20212, v_candidate, NOW())
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
        'listener_hero_quinn_p_harrier_premarked_consume',
        'sequence_hero_quinn_p_harrier_premarked_consume',
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

    IF v_changed THEN
        UPDATE public.game_data_state
           SET current_revision = v_candidate,
               updated_at = NOW()
         WHERE game_id = v_game_id;
    END IF;
END $$;

COMMIT;
