-- =============================================================================
-- LoL generic Kai'Sa P Second Skin seed（卡莎 P 体表活肤 / 可行动 1v1 普攻分支）
-- =============================================================================
--
-- 目标：在既有 Batch-B hero_kaisa 普攻闭环上幂等升级
--       sequence_hero_kaisa_basic_attack_damage，使同一
--       provider_hero_kaisa_basic_attack 拥有 Plasma 状态并表达精确操作序：
--       Caustic → +1 Plasma →（满 5）破裂 missing-HP →（满 5）重置 → 物理普攻 →
--       唯一 basic_attack_hit emit。不使用 listener。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. 必需 game / Batch-B Kai'Sa 实体与普攻图 / emit_hit / reserved_type /
--    attribute_definitions(ap,hp,ad) 缺失则 RAISE EXCEPTION 回滚。
-- 4. 安全 ensure attribute_definitions.champion_level（scalar / min1 / max18）及
--    hero_kaisa base=1 与 stage 1..18（value=stage）；不改共享 Batch-B seed。
-- 5. plasma_stacks：number / max5 / 4000ms / refresh_duration(20190)；不写
--    default_value（运行时缺省 0）；state_scope/provider_target(20252)。
-- 6. Collision-safe：若 owned step 当前 order 与最终目标不同，先按序列
--    MAX(step_order) 派生临时基址停车，再条件 upsert 到最终 0..5；对本序列
--    出现非 owned foreign step 则 fail-closed。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog。
--
-- 明确排除（本脚本不建模）：
--   W 叠 2/3 层 / overflow 再施加；友军控制施加 Plasma；野怪 400 上限；
--   法术护盾；Guinsoo phantom-copy / buff-slot 排序；多目标；
--   独立被动 listener/provider；live migration；自动 publish。
--
-- 数值权威（本地归档 League Wiki；非截图/OCR）：
--   Kai'Sa P / Template:Data Kai'Sa/Second Skin revision 4038390
--   content SHA256 f7adc35c58f47d28f8bd098a1303cf5cfef5a414783cde389ecf07240e95515f
--   Template:Passive progression level revision 4036514
--   Module:Ability progression revision 4039181
--   reviewed-contracts.json id=kaisa-p
--   raw/kaisa-p.wikitext
--
-- Wiki 合同（runtime 用精确线性式，without artificial intermediate rounding；
--   Wiki module 默认两位小数仅为 tooltip presentation，不突变伤害）：
--   Plasma：普攻 +1；持续 4000ms；再施加刷新；上限 5。
--   Caustic 使用施加前层数 S=provider.target_state.plasma_stacks；
--     base(level)=4+(24-4)/17*(level-1)；
--     perStack(level)=1+(6-1)/17*(level-1)；
--     raw magic = base + S*perStack + AP*(0.12 + 0.03*S)。
--   第五层消耗全部层数，追加 missing-health * (0.15 + 0.0006*AP) 魔法伤害；
--   Wiki note：missing-health damage is evaluated after initial Caustic Wounds,
--   but before the triggering basic attack damage.
--
-- 前置：reserved_types_seed.sql；Batch-B hero_kaisa 普攻图；
--       lol_adc_item_on_hit_passives_seed（或等价）已写入 emit_hit。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-kaisa-second-skin-v1-20260717

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
    v_required_reserved  int[] := ARRAY[
        20100, -- value_type/number
        20110, -- selector/self
        20111, -- selector/opponent
        20150, -- operation/damage
        20158, -- operation/emit_event
        20160, -- operation/state_change
        20170, -- value_policy/add
        20172, -- value_policy/override
        20190, -- refresh_policy/refresh_duration
        20211, -- event/basic_attack_hit
        20220, -- damage/physical
        20221, -- damage/magic
        20252  -- state_scope/provider_target
    ];
    v_required_attrs     text[] := ARRAY['ad', 'ap', 'hp'];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_kaisa_second_skin_seed: game_id=% missing in public.games',
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
            'lol_generic_kaisa_second_skin_seed: failed to lock game_data_state for %',
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
            'lol_generic_kaisa_second_skin_seed: missing reserved_type id(s): %',
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
            'lol_generic_kaisa_second_skin_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_kaisa'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kaisa_second_skin_seed: missing game_entities hero_kaisa (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_hero_kaisa_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kaisa_second_skin_seed: missing provider_hero_kaisa_basic_attack (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.ability_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.ability_id = 'ability_hero_kaisa_basic_attack'
           AND ad.provider_id = 'provider_hero_kaisa_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kaisa_second_skin_seed: missing ability_hero_kaisa_basic_attack (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.ability_phases ap
         WHERE ap.game_id = v_game_id
           AND ap.phase_id = 'phase_hero_kaisa_basic_attack_impact'
           AND ap.ability_id = 'ability_hero_kaisa_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kaisa_second_skin_seed: missing phase_hero_kaisa_basic_attack_impact (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_sequences es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_hero_kaisa_basic_attack_damage'
           AND es.provider_id = 'provider_hero_kaisa_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kaisa_second_skin_seed: missing sequence_hero_kaisa_basic_attack_damage (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_steps es
         WHERE es.game_id = v_game_id
           AND es.step_id = 'step_hero_kaisa_basic_attack_damage'
           AND es.sequence_id = 'sequence_hero_kaisa_basic_attack_damage'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kaisa_second_skin_seed: missing step_hero_kaisa_basic_attack_damage (Batch-B prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_steps es
         WHERE es.game_id = v_game_id
           AND es.step_id = 'step_hero_kaisa_basic_attack_emit_hit'
           AND es.sequence_id = 'sequence_hero_kaisa_basic_attack_damage'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kaisa_second_skin_seed: missing step_hero_kaisa_basic_attack_emit_hit (basic_attack_hit prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.event_effect_details eed
         WHERE eed.game_id = v_game_id
           AND eed.step_id = 'step_hero_kaisa_basic_attack_emit_hit'
           AND eed.event_type_id = 20211
           AND eed.event_ref = 'event_ref_hero_kaisa_basic_attack_hit'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kaisa_second_skin_seed: missing event_effect_details event_ref_hero_kaisa_basic_attack_hit';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_provider_mounts epm
         WHERE epm.game_id = v_game_id
           AND epm.entity_id = 'hero_kaisa'
           AND epm.provider_id = 'provider_hero_kaisa_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_kaisa_second_skin_seed: missing entity_provider_mounts hero_kaisa → provider_hero_kaisa_basic_attack';
    END IF;

    -- 本序列仅允许 6 个 owned step；出现其它 step 则 fail-closed（不 DELETE）
    SELECT string_agg(es.step_id, ', ' ORDER BY es.step_id)
      INTO v_foreign_steps
      FROM public.effect_steps es
     WHERE es.game_id = v_game_id
       AND es.sequence_id = 'sequence_hero_kaisa_basic_attack_damage'
       AND es.step_id NOT IN (
            'step_hero_kaisa_caustic_wounds_damage',
            'step_hero_kaisa_plasma_stacks_add',
            'step_hero_kaisa_plasma_rupture_damage',
            'step_hero_kaisa_plasma_stacks_reset',
            'step_hero_kaisa_basic_attack_damage',
            'step_hero_kaisa_basic_attack_emit_hit'
       );

    IF v_foreign_steps IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_kaisa_second_skin_seed: unexpected foreign step(s) in sequence_hero_kaisa_basic_attack_damage: %',
            v_foreign_steps;
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
        v_game_id, 'hero_kaisa', 'champion_level', 1, v_candidate, NOW()
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
        'hero_kaisa',
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
    -- plasma_stacks on basic-attack provider（max5 / 4000ms / refresh_duration）
    -- =========================================================================
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_kaisa_basic_attack',
        'plasma_stacks',
        20100,
        5,
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

    -- formulas：Caustic / +1 / 第五层条件 / rupture missing-HP / reset 0
    -- exact linear：4+(24-4)/17*(level-1)；1+(6-1)/17*(level-1)；无中间人为取整
    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    ) VALUES
        (
            v_game_id,
            'provider_hero_kaisa_basic_attack',
            'caustic_wounds_damage',
            '{"op":"add","args":[{"op":"add","args":[{"op":"add","args":[{"op":"const","value":4},{"op":"mul","args":[{"op":"div","args":[{"op":"sub","args":[{"op":"const","value":24},{"op":"const","value":4}]},{"op":"const","value":17}]},{"op":"sub","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":1}]}]}]},{"op":"mul","args":[{"op":"read","path":"provider.target_state.plasma_stacks"},{"op":"add","args":[{"op":"const","value":1},{"op":"mul","args":[{"op":"div","args":[{"op":"sub","args":[{"op":"const","value":6},{"op":"const","value":1}]},{"op":"const","value":17}]},{"op":"sub","args":[{"op":"read","path":"$owner.attr.champion_level"},{"op":"const","value":1}]}]}]}]}]},{"op":"mul","args":[{"op":"read","path":"$owner.attr.ap"},{"op":"add","args":[{"op":"const","value":0.12},{"op":"mul","args":[{"op":"const","value":0.03},{"op":"read","path":"provider.target_state.plasma_stacks"}]}]}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kaisa_basic_attack',
            'plasma_stacks_add',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kaisa_basic_attack',
            'plasma_fifth_stack_condition',
            '{"op":"gte","args":[{"op":"read","path":"provider.target_state.plasma_stacks"},{"op":"const","value":5}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kaisa_basic_attack',
            'plasma_rupture_missing_health',
            '{"op":"mul","args":[{"op":"sub","args":[{"op":"read","path":"$opponent.attr.hp.max"},{"op":"read","path":"$opponent.attr.hp.current"}]},{"op":"add","args":[{"op":"const","value":0.15},{"op":"mul","args":[{"op":"const","value":0.0006},{"op":"read","path":"$owner.attr.ap"}]}]}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_kaisa_basic_attack',
            'plasma_stacks_reset',
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
    -- sequence 升级：order0 Caustic → 1 +1 Plasma → 2 rupture → 3 reset →
    --   4 物理普攻 → 5 emit basic_attack_hit
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
           AND es.sequence_id = 'sequence_hero_kaisa_basic_attack_damage'
           AND (
                (es.step_id = 'step_hero_kaisa_caustic_wounds_damage'
                    AND es.step_order IS DISTINCT FROM 0)
             OR (es.step_id = 'step_hero_kaisa_plasma_stacks_add'
                    AND es.step_order IS DISTINCT FROM 1)
             OR (es.step_id = 'step_hero_kaisa_plasma_rupture_damage'
                    AND es.step_order IS DISTINCT FROM 2)
             OR (es.step_id = 'step_hero_kaisa_plasma_stacks_reset'
                    AND es.step_order IS DISTINCT FROM 3)
             OR (es.step_id = 'step_hero_kaisa_basic_attack_damage'
                    AND es.step_order IS DISTINCT FROM 4)
             OR (es.step_id = 'step_hero_kaisa_basic_attack_emit_hit'
                    AND es.step_order IS DISTINCT FROM 5)
           )
    ) THEN
        SELECT COALESCE(MAX(es.step_order), 0)
          INTO v_temp_order_base
          FROM public.effect_steps es
         WHERE es.game_id = v_game_id
           AND es.sequence_id = 'sequence_hero_kaisa_basic_attack_damage';

        WITH owned AS (
            SELECT es.step_id,
                   ROW_NUMBER() OVER (ORDER BY es.step_id) AS rn
              FROM public.effect_steps es
             WHERE es.game_id = v_game_id
               AND es.sequence_id = 'sequence_hero_kaisa_basic_attack_damage'
               AND es.step_id IN (
                    'step_hero_kaisa_caustic_wounds_damage',
                    'step_hero_kaisa_plasma_stacks_add',
                    'step_hero_kaisa_plasma_rupture_damage',
                    'step_hero_kaisa_plasma_stacks_reset',
                    'step_hero_kaisa_basic_attack_damage',
                    'step_hero_kaisa_basic_attack_emit_hit'
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
            'step_hero_kaisa_caustic_wounds_damage',
            'sequence_hero_kaisa_basic_attack_damage',
            0,
            20150,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kaisa_plasma_stacks_add',
            'sequence_hero_kaisa_basic_attack_damage',
            1,
            20160,
            20110,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kaisa_plasma_rupture_damage',
            'sequence_hero_kaisa_basic_attack_damage',
            2,
            20150,
            20111,
            'plasma_fifth_stack_condition',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kaisa_plasma_stacks_reset',
            'sequence_hero_kaisa_basic_attack_damage',
            3,
            20160,
            20110,
            'plasma_fifth_stack_condition',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kaisa_basic_attack_damage',
            'sequence_hero_kaisa_basic_attack_damage',
            4,
            20150,
            20111,
            NULL,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kaisa_basic_attack_emit_hit',
            'sequence_hero_kaisa_basic_attack_damage',
            5,
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
            'step_hero_kaisa_caustic_wounds_damage',
            'caustic_wounds_damage',
            20221,
            20170,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kaisa_plasma_rupture_damage',
            'plasma_rupture_missing_health',
            20221,
            20170,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kaisa_basic_attack_damage',
            'basic_attack_damage',
            20220,
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
            'step_hero_kaisa_plasma_stacks_add',
            20252,
            'plasma_stacks',
            'plasma_stacks_add',
            20170,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_kaisa_plasma_stacks_reset',
            20252,
            'plasma_stacks',
            'plasma_stacks_reset',
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
        'step_hero_kaisa_basic_attack_emit_hit',
        20211,
        'event_ref_hero_kaisa_basic_attack_hit',
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

    -- 保持既有 mount；仅在 change_revision 越界时归一（幂等）
    INSERT INTO public.entity_provider_mounts (
        game_id, entity_id, provider_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'hero_kaisa',
        'provider_hero_kaisa_basic_attack',
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
