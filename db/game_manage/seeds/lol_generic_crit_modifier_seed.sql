-- =============================================================================
-- LoL generic crit / Infinity Edge eligibility seed (crit_eligible)
-- =============================================================================
--
-- 目标：在既有 damage_effect_details 合同上，幂等将恰好六个 ADC 基础普攻
--       damage detail 标为 crit_eligible=true；复用 item_3031 静态属性，
--       不写 Infinity Edge provider / provider_modifiers。
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际变化时推进。
-- 3. 前置：game / game_data_state、item_3031 及其静态 ad/crit_chance/crit_damage、
--    六个基础普攻 damage step；缺失则 RAISE EXCEPTION 回滚。
-- 4. 仅 UPDATE 上述六个 step；保留其余列；不触碰 on-hit / listener / linked / repeat。
-- 5. 不自动 publish；不做 DELETE / DROP / CASCADE；不硬编码 revision 数字。
--
-- 前置：generic_crit_eligible_compatibility_migration（或 schema 已含列）；
--       Batch-B 六个 ADC 基础普攻 damage 行；Batch-C item_3031 静态属性。

BEGIN;

DO $$
DECLARE
    v_game_id          varchar(64) := 'lol';
    v_locked_current   bigint;
    v_candidate        bigint;
    v_changed          boolean := false;
    v_rowcount         integer;
    v_missing_steps    text;
    v_required_steps   text[] := ARRAY[
        'step_hero_vayne_basic_attack_damage',
        'step_hero_teemo_basic_attack_damage',
        'step_hero_varus_basic_attack_damage',
        'step_hero_kaisa_basic_attack_damage',
        'step_hero_twitch_basic_attack_damage',
        'step_hero_kogmaw_basic_attack_damage'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_generic_crit_modifier_seed: game_id=% missing in public.games',
            v_game_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.game_data_state gds
         WHERE gds.game_id = v_game_id
    ) THEN
        RAISE EXCEPTION
            'lol_generic_crit_modifier_seed: game_data_state missing for %',
            v_game_id;
    END IF;

    SELECT gds.current_revision
      INTO v_locked_current
      FROM public.game_data_state gds
     WHERE gds.game_id = v_game_id
     FOR UPDATE;

    IF v_locked_current IS NULL THEN
        RAISE EXCEPTION
            'lol_generic_crit_modifier_seed: failed to lock game_data_state for %',
            v_game_id;
    END IF;

    v_candidate := v_locked_current + 1;

    IF NOT EXISTS (
        SELECT 1
          FROM public.game_entities ge
         WHERE ge.game_id = v_game_id
           AND ge.entity_id = 'item_3031'
    ) THEN
        RAISE EXCEPTION
            'lol_generic_crit_modifier_seed: missing game_entities item_3031 (Batch-C prerequisite)';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'item_3031'
           AND eav.attr_key = 'ad'
           AND eav.base_value = 75
    ) THEN
        RAISE EXCEPTION
            'lol_generic_crit_modifier_seed: item_3031 missing static ad=75';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'item_3031'
           AND eav.attr_key = 'crit_chance'
           AND eav.base_value = 0.25
    ) THEN
        RAISE EXCEPTION
            'lol_generic_crit_modifier_seed: item_3031 missing static crit_chance=0.25';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.entity_attribute_values eav
         WHERE eav.game_id = v_game_id
           AND eav.entity_id = 'item_3031'
           AND eav.attr_key = 'crit_damage'
           AND eav.base_value = 0.3
    ) THEN
        RAISE EXCEPTION
            'lol_generic_crit_modifier_seed: item_3031 missing static crit_damage=0.3';
    END IF;

    SELECT string_agg(req.step_id, ', ' ORDER BY req.step_id)
      INTO v_missing_steps
      FROM unnest(v_required_steps) AS req(step_id)
     WHERE NOT EXISTS (
               SELECT 1
                 FROM public.damage_effect_details d
                WHERE d.game_id = v_game_id
                  AND d.step_id = req.step_id
           );

    IF v_missing_steps IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_generic_crit_modifier_seed: missing base basic-attack damage detail step_id(s): %',
            v_missing_steps;
    END IF;

    -- 仅打开六个 ADC 基础普攻 damage；保留其余列；绝不触碰其它 damage 行
    UPDATE public.damage_effect_details d
       SET crit_eligible = true,
           change_revision = v_candidate,
           updated_at = NOW()
     WHERE d.game_id = v_game_id
       AND d.step_id IN (
            'step_hero_vayne_basic_attack_damage',
            'step_hero_teemo_basic_attack_damage',
            'step_hero_varus_basic_attack_damage',
            'step_hero_kaisa_basic_attack_damage',
            'step_hero_twitch_basic_attack_damage',
            'step_hero_kogmaw_basic_attack_damage'
       )
       AND d.crit_eligible IS DISTINCT FROM true;
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
