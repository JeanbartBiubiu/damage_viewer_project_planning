-- =============================================================================
-- LoL generic Vayne Q Tumble next-basic-attack bonus seed
-- （薇恩 Q 闪避突袭 Phase-A v2 下次普攻加成物理伤害）
-- =============================================================================
--
-- 目标：在外部既有 hero_vayne / ad·ap·mana 面板与资源、Batch-B 普攻图与
--       basic_attack_hit emit 基线、以及 Spellblade 最小
--       provider_hero_vayne_tumble / ability_hero_vayne_tumble（ability_key=tumble）
--       已存在的前提下，**enrich** 既有 Tumble 身份（不新建竞争 Q ID）：
--       mana30、CD2000ms、impact 对 source 直写 provider-scope
--       tumble_empowered_attack_ready=1（3000ms / refresh_on_write）；
--       Q cast 本身不造成伤害，由 runtime 自然发出一次 ability_started；
--       listener（ability_id NULL）ALL 匹配 event/basic_attack_hit(20211) +
--       event/source_owner(20212)（**不得**匹配 ability/basic_attack 62003），
--       在 ready≥1 时对 opponent 造成一次 physical bonus
--       add(mul(1.15, source.attr.ad.resolved), mul(0.50, source.attr.ap.resolved))
--       （crit_eligible=false；copyable_on_hit=false），再 override ready=0。
--       无 emit_event 步骤。
--
-- 候选：hero_skill|hero_vayne|Q|闪避突袭
-- FROZEN_PLAN_REV=vayne-q-tumble-next-basic-attack-bonus-phase-a-v2
-- 已完成边界（completed / full boundary）：
--   rank5_next_basic_attack_bonus; cast_arm_provider_state; physical_1_15_ad_plus_0_50_ap; mana30_cooldown2000ms; no_dash_ba_reset_invisibility_lifesteal_crit_rng_or_full_tumble
-- Ordered tags：
--   1. ability_cost_cooldown
--   2. cast_triggered_next_ba_arm
--   3. basic_attack_hit_bonus_damage
--   4. provider_state_consume
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进。
-- 3. Hard prerequisites（fail-closed / check-only；缺失即回滚；不物化）：
--      - game lol；
--      - 所需 reserved types：
--        20100/20110/20111/20120/20130/20142/20150/20160/20170/20172/20181/
--        20190/20211/20212/20220/20250/20260；
--      - game_entities(lol,hero_vayne)；
--      - attribute_definitions(lol,ad|ap|mana)；
--      - entity_attribute_values(lol,hero_vayne,ad|ap|mana)；
--      - resource_definitions(lol,mana)；
--      - entity_resource_values(lol,hero_vayne,mana)；
--      - Batch-B 普攻图：provider_hero_vayne_basic_attack /
--        ability_hero_vayne_basic_attack；
--      - hit-event 基线：step_hero_vayne_basic_attack_emit_hit +
--        event_ref_hero_vayne_basic_attack_hit（20211）；
--      - 精确 Tumble 身份：provider_hero_vayne_tumble（kind 20120）、
--        ability_hero_vayne_tumble（ability_key=tumble / kind 20130 /
--        provider=provider_hero_vayne_tumble）、
--        entity_provider_mounts(hero_vayne, provider_hero_vayne_tumble)。
-- 4. 禁止写入：不对 games / game_entities / attribute_definitions /
--    entity_attribute_values / resource_definitions / entity_resource_values /
--    普攻 provider·ability·emit 行做 INSERT/UPDATE/DELETE。允许：
--      - reserved → game-local types 投影；
--      - 对既有 tumble provider/ability 做 display_name 散文 enrich
--        （稳定 ID / ability_key=tumble / kind 必须存活；display 非兼容不变量）；
--      - 向既有 tumble provider/ability 追加 state / formulas / cost / CD /
--        impact arm / listener proc 图。
--    永不创建竞争 Q ID（如 ability_hero_vayne_q_* / 非 tumble ability_key）。
-- 5. Listener：ability_id NULL；max_triggers_per_event=1；matcher 恰好
--    20181+20211 与 20181+20212；MUST NOT 写入 62003。
-- 6. 旧 Spellblade seed（provider_item_3078_spellblade）可先/后运行且仅改
--    display 散文；稳定 ID/key/type 与本 seed 的 cost/CD/state/graph 行必须
--    存活。保留且不改写：
--      provider_hero_vayne_basic_attack / ability_hero_vayne_basic_attack /
--      step_hero_vayne_basic_attack_emit_hit；
--      provider_hero_vayne_silver_bolts；
--      provider_hero_vayne_e_condemn_primary_hit；
--      provider_hero_vayne_r_final_hour_timed_bonus_ad；
--      provider_item_3078_spellblade。
-- 7. 不自动 publish；不做 DELETE/DROP/CASCADE/DDL；不写 legacy Bundle/Catalog；
--    不连 live DB 执行本脚本作为实现步骤。
--
-- 明确排除（completed-boundary exclusions；不建模、不 claim 全保真）：
--   dash / movement / direction / distance / terrain / collision；
--   BA reset / windup / cadence；
--   invisibility / R integration；
--   lifesteal / healing；
--   crit / RNG / miss / dodge / full on-hit fidelity；
--   multi-target / structures；
--   other ranks / full Tumble；
--   emit_event；ability_started listener scaffold（cast 自然发出一次）；
--   live migration / publish / E2E。
--
-- 数值来源（League Wiki Template:Data Vayne/Q → resolved
-- Template:Data Vayne/Tumble；注释引用，无运行时外部依赖；无截图 /
-- OCR 溯源；无 DDragon 数值溯源）：
--   request Template:Data Vayne/Q
--   resolved page Template:Data Vayne/Tumble
--   wiki pageId 1309988
--   revision id 4015566
--   revision timestamp 2026-05-05T15:55:50Z
--   canonical raw byte size 1735
--   canonical content SHA256
--     5ae387c07aa6c510a9da57df976b6e6ba9d3b52490fa91ce59e1221813fe9dad
--   reviewed contract path：
--     数据参考/lol-wiki-current-champions/normalized/generic/vayne-q.json
--   rank-5：next BA within 3000ms bonus physical
--     add(mul(1.15, read source.attr.ad.resolved),
--         mul(0.50, read source.attr.ap.resolved))；
--     mana 30；cooldown 2000ms。
--   provider.state.tumble_empowered_attack_ready：文档契约 explicit default0 /
--     max1 / duration3000ms / refresh_on_write（schema 无 default_value 列；
--     运行时缺省 0）；state_scope/provider 20250 用于 state_effect_details。
--
-- 前置：reserved_types_seed.sql；lol_batch_b_adc_entities_seed.sql；
--       basic_attack_hit emit 基线（lol_vayne_silver_bolts_seed.sql 或等价）；
--       lol_generic_spellblade_seed.sql（最小 tumble）；mana 资源行已由其它
--       seed ensure（本脚本 check-only，不写 resource）。
-- 建议发布版本（本脚本不负责 publish）：
--   lol-generic-vayne-tumble-next-basic-attack-bonus-phase-a-v2-20260726

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_missing_reserved   text;
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
        20250, -- state_scope/provider
        20260  -- phase_trigger/on_enter
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: game_id=% missing in public.games',
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
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: failed to lock game_data_state for %',
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
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing reserved_type id(s): %',
            v_missing_reserved;
    END IF;

    -- check-only：hero_vayne（不写 game_entities）
    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'hero_vayne'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing game_entities hero_vayne (Batch-B prerequisite; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing attribute_definitions for game_id=% attr_key=ad (check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing attribute_definitions for game_id=% attr_key=ap (check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.attribute_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.attr_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing attribute_definitions for game_id=% attr_key=mana (check-only)',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_vayne'
           AND eav.attr_key = 'ad'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing entity_attribute_values hero_vayne/ad (check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_vayne'
           AND eav.attr_key = 'ap'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing entity_attribute_values hero_vayne/ap (check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'hero_vayne'
           AND eav.attr_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing entity_attribute_values hero_vayne/mana (check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.resource_definitions rd
         WHERE rd.game_id = v_game_id
           AND rd.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing resource_definitions mana (check-only; never write resource rows)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_resource_values erv
         WHERE erv.game_id = v_game_id
           AND erv.entity_id = 'hero_vayne'
           AND erv.resource_key = 'mana'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing entity_resource_values hero_vayne/mana (check-only; never write resource rows)';
    END IF;

    -- check-only：Batch-B 普攻 provider/ability（不写 basic 行）
    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_hero_vayne_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing provider_hero_vayne_basic_attack (Batch-B prerequisite; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.ability_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.ability_id = 'ability_hero_vayne_basic_attack'
           AND ad.provider_id = 'provider_hero_vayne_basic_attack'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing ability_hero_vayne_basic_attack (Batch-B prerequisite; check-only)';
    END IF;

    -- check-only：basic_attack_hit emit 基线（不写 emit_event）
    IF NOT EXISTS (
        SELECT 1
          FROM public.effect_steps st
         WHERE st.game_id = v_game_id
           AND st.step_id = 'step_hero_vayne_basic_attack_emit_hit'
           AND st.sequence_id = 'sequence_hero_vayne_basic_attack_damage'
           AND st.operation_type_id = 20158
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing step_hero_vayne_basic_attack_emit_hit (basic_attack_hit emit baseline; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.event_effect_details e
         WHERE e.game_id = v_game_id
           AND e.step_id = 'step_hero_vayne_basic_attack_emit_hit'
           AND e.event_type_id = 20211
           AND e.event_ref = 'event_ref_hero_vayne_basic_attack_hit'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing event_ref_hero_vayne_basic_attack_hit (basic_attack_hit emit baseline; check-only)';
    END IF;

    -- check-only：精确既有 Tumble 身份（永不创建竞争 Q ID）
    IF NOT EXISTS (
        SELECT 1
          FROM public.provider_definitions pd
         WHERE pd.game_id = v_game_id
           AND pd.provider_id = 'provider_hero_vayne_tumble'
           AND pd.provider_kind_type_id = 20120
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing provider_hero_vayne_tumble kind=20120 (Spellblade tumble prerequisite; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.ability_definitions ad
         WHERE ad.game_id = v_game_id
           AND ad.ability_id = 'ability_hero_vayne_tumble'
           AND ad.provider_id = 'provider_hero_vayne_tumble'
           AND ad.ability_key = 'tumble'
           AND ad.ability_kind_type_id = 20130
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing ability_hero_vayne_tumble key=tumble kind=20130 (Spellblade tumble prerequisite; check-only)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_provider_mounts epm
         WHERE epm.game_id = v_game_id
           AND epm.entity_id = 'hero_vayne'
           AND epm.provider_id = 'provider_hero_vayne_tumble'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_vayne_tumble_next_basic_attack_bonus_seed: missing entity_provider_mounts hero_vayne/provider_hero_vayne_tumble (check-only)';
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
    -- Enrich 既有 Tumble 身份（稳定 ID/key/type；display 散文可改，非兼容不变量）
    -- =========================================================================
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_vayne_tumble',
        20120,
        '薇恩 Q 闪避突袭 Tumble next-BA bonus（Phase-A v2 rank5）',
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

    INSERT INTO public.ability_definitions (
        game_id, ability_id, provider_id, ability_key, ability_kind_type_id,
        display_name, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'ability_hero_vayne_tumble',
        'provider_hero_vayne_tumble',
        'tumble',
        20130,
        '闪避突袭（Q）',
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

    -- timed state：max1 / 3000ms / refresh_on_write；不写 default_value（文档契约 default0）
    INSERT INTO public.provider_state_fields (
        game_id, provider_id, state_key, value_type_id,
        max_value, duration_ms, refresh_policy_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'provider_hero_vayne_tumble',
        'tumble_empowered_attack_ready',
        20100,
        1,
        3000,
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
            'provider_hero_vayne_tumble',
            'q_mana_cost',
            '{"op":"const","value":30}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_vayne_tumble',
            'q_cooldown_ms',
            '{"op":"const","value":2000}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_vayne_tumble',
            'tumble_empowered_attack_ready_arm',
            '{"op":"const","value":1}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_vayne_tumble',
            'tumble_empowered_attack_ready_armed',
            '{"op":"gte","args":[{"op":"read","path":"provider.state.tumble_empowered_attack_ready"},{"op":"const","value":1}]}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_vayne_tumble',
            'tumble_empowered_attack_ready_consume',
            '{"op":"const","value":0}'::jsonb,
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'provider_hero_vayne_tumble',
            'tumble_bonus_damage',
            '{"op":"add","args":[{"op":"mul","args":[{"op":"const","value":1.15},{"op":"read","path":"source.attr.ad.resolved"}]},{"op":"mul","args":[{"op":"const","value":0.50},{"op":"read","path":"source.attr.ap.resolved"}]}]}'::jsonb,
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

    INSERT INTO public.ability_costs (
        game_id, cost_id, ability_id, phase_id, resource_key,
        amount_formula_key, allow_partial, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'cost_hero_vayne_tumble_mana',
        'ability_hero_vayne_tumble',
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
        'cooldown_hero_vayne_tumble',
        'ability_hero_vayne_tumble',
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

    -- null-duration impact：cast 进入即武装 ready（Q cast 无伤害；自然 ability_started）
    INSERT INTO public.ability_phases (
        game_id, phase_id, ability_id, phase_order, phase_type_id,
        duration_formula_key, interruptible, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'phase_hero_vayne_tumble_impact',
        'ability_hero_vayne_tumble',
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
        'sequence_hero_vayne_tumble_impact',
        'provider_hero_vayne_tumble',
        'tumble_impact_arm',
        '闪避突袭 impact（武装下次普攻加成）',
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

    -- deferred exactly-one-detail：state_change 配一 state_effect_details
    INSERT INTO public.effect_steps (
        game_id, step_id, sequence_id, step_order, operation_type_id,
        target_selector_type_id, condition_formula_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_vayne_tumble_empowered_arm',
        'sequence_hero_vayne_tumble_impact',
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
        'step_hero_vayne_tumble_empowered_arm',
        20250,
        'tumble_empowered_attack_ready',
        'tumble_empowered_attack_ready_arm',
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
        'phase_hero_vayne_tumble_impact',
        20260,
        'sequence_hero_vayne_tumble_impact',
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

    -- Listener：basic_attack_hit + source_owner → bonus damage then consume ready
    INSERT INTO public.effect_sequences (
        game_id, sequence_id, provider_id, sequence_key, display_name,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        'sequence_hero_vayne_tumble_empowered_proc',
        'provider_hero_vayne_tumble',
        'tumble_empowered_proc',
        '闪避突袭 下次普攻加成触发',
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
            'step_hero_vayne_tumble_empowered_damage',
            'sequence_hero_vayne_tumble_empowered_proc',
            0,
            20150,
            20111,
            'tumble_empowered_attack_ready_armed',
            v_candidate,
            NOW()
        ),
        (
            v_game_id,
            'step_hero_vayne_tumble_empowered_consume',
            'sequence_hero_vayne_tumble_empowered_proc',
            1,
            20160,
            20110,
            'tumble_empowered_attack_ready_armed',
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
        'step_hero_vayne_tumble_empowered_damage',
        'tumble_bonus_damage',
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

    INSERT INTO public.state_effect_details (
        game_id, step_id, state_scope_type_id, state_key, amount_formula_key,
        value_policy_type_id, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'step_hero_vayne_tumble_empowered_consume',
        20250,
        'tumble_empowered_attack_ready',
        'tumble_empowered_attack_ready_consume',
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

    INSERT INTO public.provider_listeners (
        game_id, listener_id, provider_id, listener_key, event_type_id,
        ability_id, max_triggers_per_event, chain_limit_key, change_revision, updated_at
    ) VALUES (
        v_game_id,
        'listener_hero_vayne_tumble_basic_attack_hit',
        'provider_hero_vayne_tumble',
        'tumble_on_basic_attack_hit',
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

    -- matcher 恰好 20211 + 20212；MUST NOT 写入 ability/basic_attack 62003
    INSERT INTO public.listener_match_types (
        game_id, listener_id, match_mode_type_id, type_id, change_revision, updated_at
    ) VALUES
        (v_game_id, 'listener_hero_vayne_tumble_basic_attack_hit', 20181, 20211, v_candidate, NOW()),
        (v_game_id, 'listener_hero_vayne_tumble_basic_attack_hit', 20181, 20212, v_candidate, NOW())
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
        'listener_hero_vayne_tumble_basic_attack_hit',
        'sequence_hero_vayne_tumble_empowered_proc',
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

    -- 不写 entity_provider_mounts（mount 已由 Spellblade 前置 check-only 证明存在）
    -- 不写 emit_event / ability_started listener / 62003 matcher

    IF v_changed THEN
        UPDATE public.game_data_state
           SET current_revision = v_candidate,
               updated_at = NOW()
         WHERE game_id = v_game_id;
    END IF;
END $$;

COMMIT;
