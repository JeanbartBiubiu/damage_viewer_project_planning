-- =============================================================================
-- LoL generic Varus W Blighted Quiver Phase-A v2 seed（韦鲁斯 W 枯萎箭袋）
-- =============================================================================
--
-- 目标：在既有 Batch-B hero_varus 普攻闭环与
--       lol_adc_item_on_hit_passives_seed 写入的
--       step_hero_varus_basic_attack_emit_hit /
--       event_ref_hero_varus_basic_attack_hit 之上，幂等挂载独立
--       provider_hero_varus_w_blighted_quiver_phase_a（不重建/替换普攻 provider）：
--       - Passive：basic_attack_hit + source_owner ALL listener（max once/event）
--         顺序：魔法 on-hit → provider_target blight_stacks += 1；
--       - Active：ability_hero_varus_w_blighted_quiver_active
--         （ability_key=blighted_quiver_phase_a_active；无 cost/CD 行）
--         impact 直接 override provider.state.blighted_quiver_active=1；
--       - W-scoped Q ordering carrier：
--         ability_hero_varus_w_piercing_arrow_max_charge_carrier
--         （ability_key=blighted_quiver_q_max_charge_carrier）
--         五步序：Q 物理 →（active）missing-HP 魔法 →（blight）引爆魔法
--         → reset blight → reset active。
--
-- 稳定边界字符串（comments/tests/docs）：
--   fixed_max_charge_primary_target; q_carrier_ordering_scaffold_only;
--   q_physical_then_w_active_post_q_pre_blight_then_blight_detonation;
--   rank5; no_equipment_interop
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / Batch-B Varus 实体与普攻图 / on-hit emit / reserved_type /
--    attribute_definitions(ad,ap,hp) 缺失则 RAISE EXCEPTION 回滚。
-- 4. 仅 mount 独立 W provider；不改写既有 mounts；不重建/重复 emit。
-- 5. 拓扑：Vayne/TF 式独立 source_owner listener；Kai'Sa Second Skin 式
--    provider_target 状态 / 条件消耗序（仅作参照，不改 Kai'Sa）。
-- 6. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog。
--
-- 明确排除（本脚本不建模）：
--   ranks1-4；可变 Q 蓄力；W cooldown/recast/death/CC；Q mana/CD/channel/
--   projectile/multi-target；Blight cooldown refund；其它技能消费者；
--   野怪上限；shields/blind/block/dodge；Spellblade/on-cast suppression；
--   Guinsoo phantom/repeat；装备/loadouts；live migration；自动 publish；
--   完整对局保真。不 claim 真实 Varus Q 完成。
--
-- 数值权威（本地归档 League Wiki；非截图/OCR；无 DDragon 作数值真理）：
--   Candidate：hero_skill|hero_varus|W|枯萎箭袋
--   Template:Data Varus/Blighted Quiver
--   wikiPageId 1309980 / revisionId 4026472 / timestamp 2026-06-09T22:00:43Z
--   content SHA256 16307174c4039d8ce71e639396328b2473f4a7e16247a7b2f8a183599b0901d2
--   repository normalized（read-only）：
--     数据参考/lol-wiki-current-champions/normalized/generic/varus-w.json
--
-- Wiki rank-5 Phase-A 公式（固定 max-charge 主目标 scaffold）：
--   Passive on-hit magic：40 + 0.15*max(0, bonusAD) + 0.25*AP
--   blight_stacks：number / max3 / 6000ms / refresh_on_write / provider_target
--   blighted_quiver_active：number / max1 / 5500ms / refresh_on_write / provider
--   Carrier step1 physical：360 + 1.20*max(0, bonusAD)
--   Carrier step2（active>=1）magic：0.21*(target.hp.max-target.hp.current)
--     （post-Q / pre-Blight）
--   Carrier step3（blight_stacks>0）magic：
--     target.hp.max * blight_stacks * (0.05 + 0.00013*AP) * 1.5
--   Carrier step4/5：条件 reset blight=0 / active=0
--   W 伤害：非暴击（crit_eligible=false）且 copyable_on_hit=false
--
-- 前置：reserved_types_seed.sql；lol_batch_b_adc_entities_seed.sql；
--       lol_adc_item_on_hit_passives_seed.sql（Varus emit_hit）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-varus-blighted-quiver-phase-a-v2-20260721

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
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20150, -- operation/damage
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20181, -- match_mode/all
        20190, -- refresh_policy/refresh_duration
        20211, -- event/basic_attack_hit
        20212, -- event/source_owner
        20220, -- damage/physical
        20221, -- damage/magic
        20250, -- state_scope/provider
        20252, -- state_scope/provider_target
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY['ad', 'ap', 'hp'];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_varus_blighted_quiver_seed: game_id=% missing in public.games',
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
            'lol_generic_varus_blighted_quiver_seed: failed to lock game_data_state for %',
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
            'lol_generic_varus_blighted_quiver_seed: missing reserved_type id(s): %',
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
            'lol_generic_varus_blighted_quiver_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    -- =========================================================================
    -- Fail-closed：Batch-B Varus 实体 / 普攻图 / mount
    -- =========================================================================
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_varus'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_blighted_quiver_seed: missing game_entities hero_varus (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_hero_varus_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_blighted_quiver_seed: missing provider_hero_varus_basic_attack (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.ability_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.ability_id = 'ability_hero_varus_basic_attack'
           AND ad.provider_id = 'provider_hero_varus_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_blighted_quiver_seed: missing ability_hero_varus_basic_attack (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.ability_phases ap
         WHERE ap.game_id = v_game_id
           AND ap.phase_id = 'phase_hero_varus_basic_attack_impact'
           AND ap.ability_id = 'ability_hero_varus_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_blighted_quiver_seed: missing phase_hero_varus_basic_attack_impact (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_sequences es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_hero_varus_basic_attack_damage'
           AND es.provider_id = 'provider_hero_varus_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_blighted_quiver_seed: missing sequence_hero_varus_basic_attack_damage (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_steps st
         WHERE st.game_id = v_game_id
           AND st.step_id = 'step_hero_varus_basic_attack_damage'
           AND st.sequence_id = 'sequence_hero_varus_basic_attack_damage'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_blighted_quiver_seed: missing step_hero_varus_basic_attack_damage (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.damage_effect_details d
         WHERE d.game_id = v_game_id
           AND d.step_id = 'step_hero_varus_basic_attack_damage'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_blighted_quiver_seed: missing damage_effect_details for step_hero_varus_basic_attack_damage (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_provider_mounts m
         WHERE m.game_id = v_game_id
           AND m.entity_id = 'hero_varus'
           AND m.provider_id = 'provider_hero_varus_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_blighted_quiver_seed: missing entity_provider_mounts hero_varus→provider_hero_varus_basic_attack (Batch-B prerequisite)';
    END IF;

    -- =========================================================================
    -- Fail-closed：on-hit emit（由 lol_adc_item_on_hit_passives_seed 创建；不重建）
    -- =========================================================================
    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_steps st
         WHERE st.game_id = v_game_id
           AND st.step_id = 'step_hero_varus_basic_attack_emit_hit'
           AND st.sequence_id = 'sequence_hero_varus_basic_attack_damage'
           AND st.operation_type_id = 20158
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_blighted_quiver_seed: missing step_hero_varus_basic_attack_emit_hit (lol_adc_item_on_hit_passives_seed prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.event_effect_details e
         WHERE e.game_id = v_game_id
           AND e.step_id = 'step_hero_varus_basic_attack_emit_hit'
           AND e.event_type_id = 20211
           AND e.event_ref = 'event_ref_hero_varus_basic_attack_hit'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_varus_blighted_quiver_seed: missing event_effect_details event_ref_hero_varus_basic_attack_hit (lol_adc_item_on_hit_passives_seed prerequisite)';
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
    -- 独立 W provider（与 provider_hero_varus_basic_attack 并存）
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_varus_w_blighted_quiver_phase_a',
        20120,
        '韦鲁斯 W 枯萎箭袋 Blighted Quiver（Phase-A v2 rank5）',
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

    -- blight_stacks：number / max3 / 6000ms / refresh_on_write；不写 default_value
    -- blighted_quiver_active：number / max1 / 5500ms / refresh_on_write
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_hero_varus_w_blighted_quiver_phase_a',
            'blight_stacks',
            20100,
            3,
            6000,
            20190,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_w_blighted_quiver_phase_a',
            'blighted_quiver_active',
            20100,
            1,
            5500,
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
            'provider_hero_varus_w_blighted_quiver_phase_a',
            'blighted_quiver_on_hit_magic',
            -- 40 + 0.15*max(0, bonusAD) + 0.25*AP
            '{"op":"add","args":[{"op":"add","args":[{"op":"const","value":40},{"op":"mul","args":[{"op":"const","value":0.15},{"op":"max","args":[{"op":"const","value":0},{"op":"sub","args":[{"op":"read","path":"event.entry_source.attr.ad.resolved"},{"op":"read","path":"event.entry_source.attr.ad.base"}]}]}]}]},{"op":"mul","args":[{"op":"const","value":0.25},{"op":"read","path":"event.entry_source.attr.ap.resolved"}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_w_blighted_quiver_phase_a',
            'blight_stacks_add',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_w_blighted_quiver_phase_a',
            'blighted_quiver_active_arm',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_w_blighted_quiver_phase_a',
            'q_carrier_physical_damage',
            -- 360 + 1.20*max(0, bonusAD)
            '{"op":"add","args":[{"op":"const","value":360},{"op":"mul","args":[{"op":"const","value":1.20},{"op":"max","args":[{"op":"const","value":0},{"op":"sub","args":[{"op":"read","path":"source.attr.ad.resolved"},{"op":"read","path":"source.attr.ad.base"}]}]}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_w_blighted_quiver_phase_a',
            'q_carrier_active_armed_condition',
            '{"op":"gte","args":[{"op":"read","path":"provider.state.blighted_quiver_active"},{"op":"const","value":1}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_w_blighted_quiver_phase_a',
            'q_carrier_active_missing_hp',
            -- 0.21*(target.hp.max-target.hp.current)；post-Q / pre-Blight
            '{"op":"mul","args":[{"op":"const","value":0.21},{"op":"sub","args":[{"op":"read","path":"target.attr.hp.max"},{"op":"read","path":"target.attr.hp.current"}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_w_blighted_quiver_phase_a',
            'q_carrier_blight_present_condition',
            '{"op":"gt","args":[{"op":"read","path":"provider.target_state.blight_stacks"},{"op":"const","value":0}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_w_blighted_quiver_phase_a',
            'q_carrier_blight_detonate',
            -- target.hp.max * blight_stacks * (0.05 + 0.00013*AP) * 1.5
            '{"op":"mul","args":[{"op":"mul","args":[{"op":"mul","args":[{"op":"read","path":"target.attr.hp.max"},{"op":"read","path":"provider.target_state.blight_stacks"}]},{"op":"add","args":[{"op":"const","value":0.05},{"op":"mul","args":[{"op":"const","value":0.00013},{"op":"read","path":"source.attr.ap.resolved"}]}]}]},{"op":"const","value":1.5}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_w_blighted_quiver_phase_a',
            'blight_stacks_reset',
            '{"op":"const","value":0}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_varus_w_blighted_quiver_phase_a',
            'blighted_quiver_active_reset',
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
    -- Passive listener 序列：magic on-hit → blight_stacks += 1
    -- =========================================================================
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_varus_w_blighted_quiver_on_hit',
        'provider_hero_varus_w_blighted_quiver_phase_a',
        'blighted_quiver_on_hit',
        '枯萎箭袋普攻命中结算',
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
            'step_hero_varus_w_blighted_quiver_on_hit_damage',
            'sequence_hero_varus_w_blighted_quiver_on_hit',
            0,
            20150,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_varus_w_blighted_quiver_blight_add',
            'sequence_hero_varus_w_blighted_quiver_on_hit',
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
        copyable_on_hit, crit_eligible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_varus_w_blighted_quiver_on_hit_damage',
        'blighted_quiver_on_hit_magic',
        20221,
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

    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_varus_w_blighted_quiver_blight_add',
        20252,
        'blight_stacks',
        'blight_stacks_add',
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

    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_hero_varus_w_blighted_quiver_basic_attack_hit',
        'provider_hero_varus_w_blighted_quiver_phase_a',
        'blighted_quiver_on_basic_attack_hit',
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
        (v_game_id, 'listener_hero_varus_w_blighted_quiver_basic_attack_hit', 20181, 20211, v_candidate, NOW()),
        (v_game_id, 'listener_hero_varus_w_blighted_quiver_basic_attack_hit', 20181, 20212, v_candidate, NOW())
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
        'listener_hero_varus_w_blighted_quiver_basic_attack_hit',
        'sequence_hero_varus_w_blighted_quiver_on_hit',
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

    -- =========================================================================
    -- W Active：无 cost/CD；impact 直接 override blighted_quiver_active=1
    -- =========================================================================
    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_varus_w_blighted_quiver_active',
        'provider_hero_varus_w_blighted_quiver_phase_a',
        'blighted_quiver_phase_a_active',
        20130,
        '枯萎箭袋（W Active / Phase-A）',
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

    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_varus_w_blighted_quiver_active_impact',
        'ability_hero_varus_w_blighted_quiver_active',
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
        'sequence_hero_varus_w_blighted_quiver_active_impact',
        'provider_hero_varus_w_blighted_quiver_phase_a',
        'blighted_quiver_active_arm',
        '枯萎箭袋主动武装',
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
        'step_hero_varus_w_blighted_quiver_active_arm',
        'sequence_hero_varus_w_blighted_quiver_active_impact',
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
        'step_hero_varus_w_blighted_quiver_active_arm',
        20250,
        'blighted_quiver_active',
        'blighted_quiver_active_arm',
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
        'phase_hero_varus_w_blighted_quiver_active_impact',
        20260,
        'sequence_hero_varus_w_blighted_quiver_active_impact',
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

    -- =========================================================================
    -- W-scoped Q max-charge ordering carrier（scaffold only；不 claim 真实 Q）
    -- 五步：physical → active missing-HP → blight detonate → blight reset → active reset
    -- =========================================================================
    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_varus_w_piercing_arrow_max_charge_carrier',
        'provider_hero_varus_w_blighted_quiver_phase_a',
        'blighted_quiver_q_max_charge_carrier',
        20130,
        '枯萎箭袋 Q max-charge ordering carrier（scaffold）',
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

    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_varus_w_piercing_arrow_max_charge_carrier_impact',
        'ability_hero_varus_w_piercing_arrow_max_charge_carrier',
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
        'sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact',
        'provider_hero_varus_w_blighted_quiver_phase_a',
        'blighted_quiver_q_max_charge_carrier',
        'Q max-charge ordering carrier impact',
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
            'step_hero_varus_w_q_carrier_physical_damage',
            'sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact',
            0,
            20150,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_varus_w_q_carrier_active_missing_hp',
            'sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact',
            1,
            20150,
            20111,
            'q_carrier_active_armed_condition',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_varus_w_q_carrier_blight_detonate',
            'sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact',
            2,
            20150,
            20111,
            'q_carrier_blight_present_condition',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_varus_w_q_carrier_blight_reset',
            'sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact',
            3,
            20160,
            20110,
            'q_carrier_blight_present_condition',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_varus_w_q_carrier_active_reset',
            'sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact',
            4,
            20160,
            20110,
            'q_carrier_active_armed_condition',
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
        copyable_on_hit, crit_eligible, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_varus_w_q_carrier_physical_damage',
            'q_carrier_physical_damage',
            20220,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_varus_w_q_carrier_active_missing_hp',
            'q_carrier_active_missing_hp',
            20221,
            20170,
            false,
            false,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_varus_w_q_carrier_blight_detonate',
            'q_carrier_blight_detonate',
            20221,
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

    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'step_hero_varus_w_q_carrier_blight_reset',
            20252,
            'blight_stacks',
            'blight_stacks_reset',
            20172,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_varus_w_q_carrier_active_reset',
            20250,
            'blighted_quiver_active',
            'blighted_quiver_active_reset',
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
        'phase_hero_varus_w_piercing_arrow_max_charge_carrier_impact',
        20260,
        'sequence_hero_varus_w_piercing_arrow_max_charge_carrier_impact',
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

    -- 仅 mount 独立 W provider；保留既有 mounts（不改写 basic_attack mount）
    INSERT INTO public.entity_provider_mounts (
        game_id, entity_id, provider_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_varus',
        'provider_hero_varus_w_blighted_quiver_phase_a',
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
