-- =============================================================================
-- LoL Batch-B ADC entities + level stage attributes + basic_attack providers
-- =============================================================================
--
-- 目标：将 V2-Batch-B 的 6 个 ADC、3 个假人迁入 generic combat-data；
--       为每个 ADC 建立可运行的独立通用普攻闭环；假人只写基础属性。
-- 数值来源：最小验证/V2-Batch-B-hero-passives.seed.json
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进 current_revision。
-- 3. 必需 reserved_type / attribute_definitions 缺失则抛异常回滚；不伪造。
-- 4. 成长属性 stage 绝对值 = baseStats[attr] + statsByLevel[attr][level-1]；stage 1 = base。
-- 5. 不迁移攻速成长字段；不对攻速做二次成长叠加。
-- 6. 不写入 entity 域 type_relations；不引用旧表或发布产物面。
-- 7. 本脚本不自动 publish；不做 DELETE；不清理越界 revision（由首批 seed 负责）。
--
-- 前置：public.games 已存在 game_id='lol'；reserved_types_seed.sql 已执行；
--       所需 16 个 attribute_definitions（ADC 13 + 假人并集 ability_haste/
--       physical_pen/magic_pen）已存在；建议先执行
--       lol_generic_combat_bootstrap_seed.sql（或等价基线已存在）。

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
        20120, -- provider_kind/passive
        20130, -- ability_kind/active
        20142, -- ability_phase/impact
        20150, -- operation/damage
        20170, -- value_policy/add
        20220, -- damage/physical
        20260  -- phase_trigger/on_enter
    ];
    v_required_attrs     text[] := ARRAY[
        'hp', 'ad', 'ap', 'attack_speed', 'attack_range', 'armor', 'magic_resist',
        'mana', 'mana_regen', 'hp_regen', 'move_speed', 'crit_chance', 'crit_damage',
        'ability_haste', 'physical_pen', 'magic_pen'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_batch_b_adc_entities_seed: game_id=% missing in public.games',
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
            'lol_batch_b_adc_entities_seed: failed to lock game_data_state for %',
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
            'lol_batch_b_adc_entities_seed: missing reserved_type id(s): %',
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
            'lol_batch_b_adc_entities_seed: missing attribute_definitions for game_id=% attr_key(s): %',
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

    -- game_entities：6 ADC + 3 dummy
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES
        (v_game_id, 'hero_vayne', '薇恩', '暗夜猎手', v_candidate, NOW()),
        (v_game_id, 'hero_teemo', '提莫', '迅捷斥候', v_candidate, NOW()),
        (v_game_id, 'hero_varus', '韦鲁斯', '惩戒之箭', v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', '卡莎', '虚空之女', v_candidate, NOW()),
        (v_game_id, 'hero_twitch', '图奇', '瘟疫之源', v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', '克格莫', '深渊巨口', v_candidate, NOW()),
        (v_game_id, 'target_dummy_squishy', 'Target Dummy Squishy', '2000 HP / 50 armor / 50 magic resist', v_candidate, NOW()),
        (v_game_id, 'target_dummy_fighter', 'Target Dummy Fighter', '3000 HP / 100 armor / 80 magic resist', v_candidate, NOW()),
        (v_game_id, 'target_dummy_tank', 'Target Dummy Tank', '5000 HP / 200 armor / 150 magic resist', v_candidate, NOW())
    ON CONFLICT (game_id, entity_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.game_entities.display_name IS DISTINCT FROM EXCLUDED.display_name
       OR public.game_entities.description IS DISTINCT FROM EXCLUDED.description;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- entity_attribute_values：ADC 13 基础属性 + 假人 10 项源 baseStats（合计 108）
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'hero_vayne', 'hp', 550, v_candidate, NOW()),
        (v_game_id, 'hero_vayne', 'ad', 60, v_candidate, NOW()),
        (v_game_id, 'hero_vayne', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'hero_vayne', 'attack_speed', 0.658, v_candidate, NOW()),
        (v_game_id, 'hero_vayne', 'attack_range', 550, v_candidate, NOW()),
        (v_game_id, 'hero_vayne', 'armor', 23, v_candidate, NOW()),
        (v_game_id, 'hero_vayne', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_vayne', 'mana', 232, v_candidate, NOW()),
        (v_game_id, 'hero_vayne', 'mana_regen', 1.4, v_candidate, NOW()),
        (v_game_id, 'hero_vayne', 'hp_regen', 0.7, v_candidate, NOW()),
        (v_game_id, 'hero_vayne', 'move_speed', 330, v_candidate, NOW()),
        (v_game_id, 'hero_vayne', 'crit_chance', 0, v_candidate, NOW()),
        (v_game_id, 'hero_vayne', 'crit_damage', 2, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'hp', 615, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'ad', 54, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'attack_speed', 0.69, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'attack_range', 500, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'armor', 24, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'mana', 334, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'mana_regen', 1.92, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'hp_regen', 1.1, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'move_speed', 330, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'crit_chance', 0, v_candidate, NOW()),
        (v_game_id, 'hero_teemo', 'crit_damage', 2, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'hp', 600, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'ad', 59, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'attack_speed', 0.658, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'attack_range', 575, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'armor', 24, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'mana', 320, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'mana_regen', 1.6, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'hp_regen', 0.7, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'move_speed', 330, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'crit_chance', 0, v_candidate, NOW()),
        (v_game_id, 'hero_varus', 'crit_damage', 2, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'hp', 640, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'ad', 59, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'attack_speed', 0.644, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'attack_range', 525, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'armor', 25, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'mana', 345, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'mana_regen', 1.64, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'hp_regen', 0.8, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'move_speed', 335, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'crit_chance', 0, v_candidate, NOW()),
        (v_game_id, 'hero_kaisa', 'crit_damage', 2, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'hp', 630, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'ad', 59, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'attack_speed', 0.679, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'attack_range', 550, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'armor', 27, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'mana', 300, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'mana_regen', 1.45, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'hp_regen', 0.75, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'move_speed', 330, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'crit_chance', 0, v_candidate, NOW()),
        (v_game_id, 'hero_twitch', 'crit_damage', 2, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'hp', 635, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'ad', 61, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'attack_speed', 0.665, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'attack_range', 500, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'armor', 24, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'magic_resist', 30, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'mana', 325, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'mana_regen', 1.75, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'hp_regen', 0.75, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'move_speed', 330, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'crit_chance', 0, v_candidate, NOW()),
        (v_game_id, 'hero_kogmaw', 'crit_damage', 2, v_candidate, NOW()),
        (v_game_id, 'target_dummy_squishy', 'hp', 2000, v_candidate, NOW()),
        (v_game_id, 'target_dummy_squishy', 'ad', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_squishy', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_squishy', 'attack_speed', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_squishy', 'armor', 50, v_candidate, NOW()),
        (v_game_id, 'target_dummy_squishy', 'magic_resist', 50, v_candidate, NOW()),
        (v_game_id, 'target_dummy_squishy', 'ability_haste', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_squishy', 'physical_pen', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_squishy', 'magic_pen', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_squishy', 'hp_regen', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_fighter', 'hp', 3000, v_candidate, NOW()),
        (v_game_id, 'target_dummy_fighter', 'ad', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_fighter', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_fighter', 'attack_speed', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_fighter', 'armor', 100, v_candidate, NOW()),
        (v_game_id, 'target_dummy_fighter', 'magic_resist', 80, v_candidate, NOW()),
        (v_game_id, 'target_dummy_fighter', 'ability_haste', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_fighter', 'physical_pen', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_fighter', 'magic_pen', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_fighter', 'hp_regen', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_tank', 'hp', 5000, v_candidate, NOW()),
        (v_game_id, 'target_dummy_tank', 'ad', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_tank', 'ap', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_tank', 'attack_speed', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_tank', 'armor', 200, v_candidate, NOW()),
        (v_game_id, 'target_dummy_tank', 'magic_resist', 150, v_candidate, NOW()),
        (v_game_id, 'target_dummy_tank', 'ability_haste', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_tank', 'physical_pen', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_tank', 'magic_pen', 0, v_candidate, NOW()),
        (v_game_id, 'target_dummy_tank', 'hp_regen', 0, v_candidate, NOW())
    ON CONFLICT (game_id, entity_id, attr_key) DO UPDATE SET
        base_value = EXCLUDED.base_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_attribute_values.base_value IS DISTINCT FROM EXCLUDED.base_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- entity_attribute_stage_values：6 ADC × 8 成长属性 × stage 1..18 绝对值
    INSERT INTO public.entity_attribute_stage_values (
        game_id, entity_id, attr_key, stage, value, change_revision, updated_at
    )
    SELECT
        v_game_id,
        v.entity_id,
        v.attr_key,
        v.stage,
        v.value,
        v_candidate,
        NOW()
      FROM (VALUES
        ('hero_vayne', 'hp', 1, 550),
        ('hero_vayne', 'hp', 2, 624.16),
        ('hero_vayne', 'hp', 3, 701.925),
        ('hero_vayne', 'hp', 4, 783.295),
        ('hero_vayne', 'hp', 5, 868.27),
        ('hero_vayne', 'hp', 6, 956.85),
        ('hero_vayne', 'hp', 7, 1049.035),
        ('hero_vayne', 'hp', 8, 1144.825),
        ('hero_vayne', 'hp', 9, 1244.22),
        ('hero_vayne', 'hp', 10, 1347.22),
        ('hero_vayne', 'hp', 11, 1453.825),
        ('hero_vayne', 'hp', 12, 1564.035),
        ('hero_vayne', 'hp', 13, 1677.85),
        ('hero_vayne', 'hp', 14, 1795.27),
        ('hero_vayne', 'hp', 15, 1916.295),
        ('hero_vayne', 'hp', 16, 2040.925),
        ('hero_vayne', 'hp', 17, 2169.16),
        ('hero_vayne', 'hp', 18, 2301),
        ('hero_vayne', 'mana', 1, 232),
        ('hero_vayne', 'mana', 2, 257.2),
        ('hero_vayne', 'mana', 3, 283.625),
        ('hero_vayne', 'mana', 4, 311.275),
        ('hero_vayne', 'mana', 5, 340.15),
        ('hero_vayne', 'mana', 6, 370.25),
        ('hero_vayne', 'mana', 7, 401.575),
        ('hero_vayne', 'mana', 8, 434.125),
        ('hero_vayne', 'mana', 9, 467.9),
        ('hero_vayne', 'mana', 10, 502.9),
        ('hero_vayne', 'mana', 11, 539.125),
        ('hero_vayne', 'mana', 12, 576.575),
        ('hero_vayne', 'mana', 13, 615.25),
        ('hero_vayne', 'mana', 14, 655.15),
        ('hero_vayne', 'mana', 15, 696.275),
        ('hero_vayne', 'mana', 16, 738.625),
        ('hero_vayne', 'mana', 17, 782.2),
        ('hero_vayne', 'mana', 18, 827),
        ('hero_vayne', 'ad', 1, 60),
        ('hero_vayne', 'ad', 2, 61.692),
        ('hero_vayne', 'ad', 3, 63.466),
        ('hero_vayne', 'ad', 4, 65.323),
        ('hero_vayne', 'ad', 5, 67.261),
        ('hero_vayne', 'ad', 6, 69.282),
        ('hero_vayne', 'ad', 7, 71.386),
        ('hero_vayne', 'ad', 8, 73.571),
        ('hero_vayne', 'ad', 9, 75.839),
        ('hero_vayne', 'ad', 10, 78.189),
        ('hero_vayne', 'ad', 11, 80.621),
        ('hero_vayne', 'ad', 12, 83.136),
        ('hero_vayne', 'ad', 13, 85.732),
        ('hero_vayne', 'ad', 14, 88.411),
        ('hero_vayne', 'ad', 15, 91.173),
        ('hero_vayne', 'ad', 16, 94.016),
        ('hero_vayne', 'ad', 17, 96.942),
        ('hero_vayne', 'ad', 18, 99.95),
        ('hero_vayne', 'armor', 1, 23),
        ('hero_vayne', 'armor', 2, 26.312),
        ('hero_vayne', 'armor', 3, 29.785),
        ('hero_vayne', 'armor', 4, 33.419),
        ('hero_vayne', 'armor', 5, 37.214),
        ('hero_vayne', 'armor', 6, 41.17),
        ('hero_vayne', 'armor', 7, 45.287),
        ('hero_vayne', 'armor', 8, 49.565),
        ('hero_vayne', 'armor', 9, 54.004),
        ('hero_vayne', 'armor', 10, 58.604),
        ('hero_vayne', 'armor', 11, 63.365),
        ('hero_vayne', 'armor', 12, 68.287),
        ('hero_vayne', 'armor', 13, 73.37),
        ('hero_vayne', 'armor', 14, 78.614),
        ('hero_vayne', 'armor', 15, 84.019),
        ('hero_vayne', 'armor', 16, 89.585),
        ('hero_vayne', 'armor', 17, 95.312),
        ('hero_vayne', 'armor', 18, 101.2),
        ('hero_vayne', 'magic_resist', 1, 30),
        ('hero_vayne', 'magic_resist', 2, 30.936),
        ('hero_vayne', 'magic_resist', 3, 31.917),
        ('hero_vayne', 'magic_resist', 4, 32.944),
        ('hero_vayne', 'magic_resist', 5, 34.017),
        ('hero_vayne', 'magic_resist', 6, 35.135),
        ('hero_vayne', 'magic_resist', 7, 36.298),
        ('hero_vayne', 'magic_resist', 8, 37.507),
        ('hero_vayne', 'magic_resist', 9, 38.762),
        ('hero_vayne', 'magic_resist', 10, 40.062),
        ('hero_vayne', 'magic_resist', 11, 41.407),
        ('hero_vayne', 'magic_resist', 12, 42.798),
        ('hero_vayne', 'magic_resist', 13, 44.235),
        ('hero_vayne', 'magic_resist', 14, 45.717),
        ('hero_vayne', 'magic_resist', 15, 47.244),
        ('hero_vayne', 'magic_resist', 16, 48.817),
        ('hero_vayne', 'magic_resist', 17, 50.436),
        ('hero_vayne', 'magic_resist', 18, 52.1),
        ('hero_vayne', 'hp_regen', 1, 0.7),
        ('hero_vayne', 'hp_regen', 2, 0.7792),
        ('hero_vayne', 'hp_regen', 3, 0.8622),
        ('hero_vayne', 'hp_regen', 4, 0.9491),
        ('hero_vayne', 'hp_regen', 5, 1.0399),
        ('hero_vayne', 'hp_regen', 6, 1.1345),
        ('hero_vayne', 'hp_regen', 7, 1.2329),
        ('hero_vayne', 'hp_regen', 8, 1.3352),
        ('hero_vayne', 'hp_regen', 9, 1.4414),
        ('hero_vayne', 'hp_regen', 10, 1.5514),
        ('hero_vayne', 'hp_regen', 11, 1.6652),
        ('hero_vayne', 'hp_regen', 12, 1.7829),
        ('hero_vayne', 'hp_regen', 13, 1.9045),
        ('hero_vayne', 'hp_regen', 14, 2.0299),
        ('hero_vayne', 'hp_regen', 15, 2.1591),
        ('hero_vayne', 'hp_regen', 16, 2.2922),
        ('hero_vayne', 'hp_regen', 17, 2.4292),
        ('hero_vayne', 'hp_regen', 18, 2.57),
        ('hero_vayne', 'mana_regen', 1, 1.4),
        ('hero_vayne', 'mana_regen', 2, 1.4576),
        ('hero_vayne', 'mana_regen', 3, 1.518),
        ('hero_vayne', 'mana_regen', 4, 1.5812),
        ('hero_vayne', 'mana_regen', 5, 1.6472),
        ('hero_vayne', 'mana_regen', 6, 1.716),
        ('hero_vayne', 'mana_regen', 7, 1.7876),
        ('hero_vayne', 'mana_regen', 8, 1.862),
        ('hero_vayne', 'mana_regen', 9, 1.9392),
        ('hero_vayne', 'mana_regen', 10, 2.0192),
        ('hero_vayne', 'mana_regen', 11, 2.102),
        ('hero_vayne', 'mana_regen', 12, 2.1876),
        ('hero_vayne', 'mana_regen', 13, 2.276),
        ('hero_vayne', 'mana_regen', 14, 2.3672),
        ('hero_vayne', 'mana_regen', 15, 2.4612),
        ('hero_vayne', 'mana_regen', 16, 2.558),
        ('hero_vayne', 'mana_regen', 17, 2.6576),
        ('hero_vayne', 'mana_regen', 18, 2.76),
        ('hero_vayne', 'attack_speed', 1, 0.658),
        ('hero_vayne', 'attack_speed', 2, 0.673634),
        ('hero_vayne', 'attack_speed', 3, 0.690028),
        ('hero_vayne', 'attack_speed', 4, 0.707182),
        ('hero_vayne', 'attack_speed', 5, 0.725096),
        ('hero_vayne', 'attack_speed', 6, 0.74377),
        ('hero_vayne', 'attack_speed', 7, 0.763204),
        ('hero_vayne', 'attack_speed', 8, 0.783398),
        ('hero_vayne', 'attack_speed', 9, 0.804352),
        ('hero_vayne', 'attack_speed', 10, 0.826066),
        ('hero_vayne', 'attack_speed', 11, 0.84854),
        ('hero_vayne', 'attack_speed', 12, 0.871774),
        ('hero_vayne', 'attack_speed', 13, 0.895768),
        ('hero_vayne', 'attack_speed', 14, 0.920522),
        ('hero_vayne', 'attack_speed', 15, 0.946036),
        ('hero_vayne', 'attack_speed', 16, 0.97231),
        ('hero_vayne', 'attack_speed', 17, 0.999344),
        ('hero_vayne', 'attack_speed', 18, 1.027138),
        ('hero_teemo', 'hp', 1, 615),
        ('hero_teemo', 'hp', 2, 689.88),
        ('hero_teemo', 'hp', 3, 768.4),
        ('hero_teemo', 'hp', 4, 850.56),
        ('hero_teemo', 'hp', 5, 936.36),
        ('hero_teemo', 'hp', 6, 1025.8),
        ('hero_teemo', 'hp', 7, 1118.88),
        ('hero_teemo', 'hp', 8, 1215.6),
        ('hero_teemo', 'hp', 9, 1315.96),
        ('hero_teemo', 'hp', 10, 1419.96),
        ('hero_teemo', 'hp', 11, 1527.6),
        ('hero_teemo', 'hp', 12, 1638.88),
        ('hero_teemo', 'hp', 13, 1753.8),
        ('hero_teemo', 'hp', 14, 1872.36),
        ('hero_teemo', 'hp', 15, 1994.56),
        ('hero_teemo', 'hp', 16, 2120.4),
        ('hero_teemo', 'hp', 17, 2249.88),
        ('hero_teemo', 'hp', 18, 2383),
        ('hero_teemo', 'mana', 1, 334),
        ('hero_teemo', 'mana', 2, 352),
        ('hero_teemo', 'mana', 3, 370.875),
        ('hero_teemo', 'mana', 4, 390.625),
        ('hero_teemo', 'mana', 5, 411.25),
        ('hero_teemo', 'mana', 6, 432.75),
        ('hero_teemo', 'mana', 7, 455.125),
        ('hero_teemo', 'mana', 8, 478.375),
        ('hero_teemo', 'mana', 9, 502.5),
        ('hero_teemo', 'mana', 10, 527.5),
        ('hero_teemo', 'mana', 11, 553.375),
        ('hero_teemo', 'mana', 12, 580.125),
        ('hero_teemo', 'mana', 13, 607.75),
        ('hero_teemo', 'mana', 14, 636.25),
        ('hero_teemo', 'mana', 15, 665.625),
        ('hero_teemo', 'mana', 16, 695.875),
        ('hero_teemo', 'mana', 17, 727),
        ('hero_teemo', 'mana', 18, 759),
        ('hero_teemo', 'ad', 1, 54),
        ('hero_teemo', 'ad', 2, 56.16),
        ('hero_teemo', 'ad', 3, 58.425),
        ('hero_teemo', 'ad', 4, 60.795),
        ('hero_teemo', 'ad', 5, 63.27),
        ('hero_teemo', 'ad', 6, 65.85),
        ('hero_teemo', 'ad', 7, 68.535),
        ('hero_teemo', 'ad', 8, 71.325),
        ('hero_teemo', 'ad', 9, 74.22),
        ('hero_teemo', 'ad', 10, 77.22),
        ('hero_teemo', 'ad', 11, 80.325),
        ('hero_teemo', 'ad', 12, 83.535),
        ('hero_teemo', 'ad', 13, 86.85),
        ('hero_teemo', 'ad', 14, 90.27),
        ('hero_teemo', 'ad', 15, 93.795),
        ('hero_teemo', 'ad', 16, 97.425),
        ('hero_teemo', 'ad', 17, 101.16),
        ('hero_teemo', 'ad', 18, 105),
        ('hero_teemo', 'armor', 1, 24),
        ('hero_teemo', 'armor', 2, 27.564),
        ('hero_teemo', 'armor', 3, 31.301),
        ('hero_teemo', 'armor', 4, 35.212),
        ('hero_teemo', 'armor', 5, 39.295),
        ('hero_teemo', 'armor', 6, 43.552),
        ('hero_teemo', 'armor', 7, 47.983),
        ('hero_teemo', 'armor', 8, 52.586),
        ('hero_teemo', 'armor', 9, 57.363),
        ('hero_teemo', 'armor', 10, 62.313),
        ('hero_teemo', 'armor', 11, 67.436),
        ('hero_teemo', 'armor', 12, 72.733),
        ('hero_teemo', 'armor', 13, 78.202),
        ('hero_teemo', 'armor', 14, 83.845),
        ('hero_teemo', 'armor', 15, 89.662),
        ('hero_teemo', 'armor', 16, 95.651),
        ('hero_teemo', 'armor', 17, 101.814),
        ('hero_teemo', 'armor', 18, 108.15),
        ('hero_teemo', 'magic_resist', 1, 30),
        ('hero_teemo', 'magic_resist', 2, 30.936),
        ('hero_teemo', 'magic_resist', 3, 31.917),
        ('hero_teemo', 'magic_resist', 4, 32.944),
        ('hero_teemo', 'magic_resist', 5, 34.017),
        ('hero_teemo', 'magic_resist', 6, 35.135),
        ('hero_teemo', 'magic_resist', 7, 36.298),
        ('hero_teemo', 'magic_resist', 8, 37.507),
        ('hero_teemo', 'magic_resist', 9, 38.762),
        ('hero_teemo', 'magic_resist', 10, 40.062),
        ('hero_teemo', 'magic_resist', 11, 41.407),
        ('hero_teemo', 'magic_resist', 12, 42.798),
        ('hero_teemo', 'magic_resist', 13, 44.235),
        ('hero_teemo', 'magic_resist', 14, 45.717),
        ('hero_teemo', 'magic_resist', 15, 47.244),
        ('hero_teemo', 'magic_resist', 16, 48.817),
        ('hero_teemo', 'magic_resist', 17, 50.436),
        ('hero_teemo', 'magic_resist', 18, 52.1),
        ('hero_teemo', 'hp_regen', 1, 1.1),
        ('hero_teemo', 'hp_regen', 2, 1.1936),
        ('hero_teemo', 'hp_regen', 3, 1.2917),
        ('hero_teemo', 'hp_regen', 4, 1.3944),
        ('hero_teemo', 'hp_regen', 5, 1.5017),
        ('hero_teemo', 'hp_regen', 6, 1.6135),
        ('hero_teemo', 'hp_regen', 7, 1.7298),
        ('hero_teemo', 'hp_regen', 8, 1.8507),
        ('hero_teemo', 'hp_regen', 9, 1.9762),
        ('hero_teemo', 'hp_regen', 10, 2.1062),
        ('hero_teemo', 'hp_regen', 11, 2.2407),
        ('hero_teemo', 'hp_regen', 12, 2.3798),
        ('hero_teemo', 'hp_regen', 13, 2.5235),
        ('hero_teemo', 'hp_regen', 14, 2.6717),
        ('hero_teemo', 'hp_regen', 15, 2.8244),
        ('hero_teemo', 'hp_regen', 16, 2.9817),
        ('hero_teemo', 'hp_regen', 17, 3.1436),
        ('hero_teemo', 'hp_regen', 18, 3.31),
        ('hero_teemo', 'mana_regen', 1, 1.92),
        ('hero_teemo', 'mana_regen', 2, 1.9848),
        ('hero_teemo', 'mana_regen', 3, 2.0528),
        ('hero_teemo', 'mana_regen', 4, 2.1239),
        ('hero_teemo', 'mana_regen', 5, 2.1981),
        ('hero_teemo', 'mana_regen', 6, 2.2755),
        ('hero_teemo', 'mana_regen', 7, 2.3561),
        ('hero_teemo', 'mana_regen', 8, 2.4398),
        ('hero_teemo', 'mana_regen', 9, 2.5266),
        ('hero_teemo', 'mana_regen', 10, 2.6166),
        ('hero_teemo', 'mana_regen', 11, 2.7098),
        ('hero_teemo', 'mana_regen', 12, 2.8061),
        ('hero_teemo', 'mana_regen', 13, 2.9055),
        ('hero_teemo', 'mana_regen', 14, 3.0081),
        ('hero_teemo', 'mana_regen', 15, 3.1139),
        ('hero_teemo', 'mana_regen', 16, 3.2228),
        ('hero_teemo', 'mana_regen', 17, 3.3348),
        ('hero_teemo', 'mana_regen', 18, 3.45),
        ('hero_teemo', 'attack_speed', 1, 0.69),
        ('hero_teemo', 'attack_speed', 2, 0.706792),
        ('hero_teemo', 'attack_speed', 3, 0.7244),
        ('hero_teemo', 'attack_speed', 4, 0.742824),
        ('hero_teemo', 'attack_speed', 5, 0.762065),
        ('hero_teemo', 'attack_speed', 6, 0.782122),
        ('hero_teemo', 'attack_speed', 7, 0.802995),
        ('hero_teemo', 'attack_speed', 8, 0.824685),
        ('hero_teemo', 'attack_speed', 9, 0.84719),
        ('hero_teemo', 'attack_speed', 10, 0.870512),
        ('hero_teemo', 'attack_speed', 11, 0.894651),
        ('hero_teemo', 'attack_speed', 12, 0.919605),
        ('hero_teemo', 'attack_speed', 13, 0.945376),
        ('hero_teemo', 'attack_speed', 14, 0.971963),
        ('hero_teemo', 'attack_speed', 15, 0.999366),
        ('hero_teemo', 'attack_speed', 16, 1.027586),
        ('hero_teemo', 'attack_speed', 17, 1.056622),
        ('hero_teemo', 'attack_speed', 18, 1.086474),
        ('hero_varus', 'hp', 1, 600),
        ('hero_varus', 'hp', 2, 675.6),
        ('hero_varus', 'hp', 3, 754.875),
        ('hero_varus', 'hp', 4, 837.825),
        ('hero_varus', 'hp', 5, 924.45),
        ('hero_varus', 'hp', 6, 1014.75),
        ('hero_varus', 'hp', 7, 1108.725),
        ('hero_varus', 'hp', 8, 1206.375),
        ('hero_varus', 'hp', 9, 1307.7),
        ('hero_varus', 'hp', 10, 1412.7),
        ('hero_varus', 'hp', 11, 1521.375),
        ('hero_varus', 'hp', 12, 1633.725),
        ('hero_varus', 'hp', 13, 1749.75),
        ('hero_varus', 'hp', 14, 1869.45),
        ('hero_varus', 'hp', 15, 1992.825),
        ('hero_varus', 'hp', 16, 2119.875),
        ('hero_varus', 'hp', 17, 2250.6),
        ('hero_varus', 'hp', 18, 2385),
        ('hero_varus', 'mana', 1, 320),
        ('hero_varus', 'mana', 2, 348.8),
        ('hero_varus', 'mana', 3, 379),
        ('hero_varus', 'mana', 4, 410.6),
        ('hero_varus', 'mana', 5, 443.6),
        ('hero_varus', 'mana', 6, 478),
        ('hero_varus', 'mana', 7, 513.8),
        ('hero_varus', 'mana', 8, 551),
        ('hero_varus', 'mana', 9, 589.6),
        ('hero_varus', 'mana', 10, 629.6),
        ('hero_varus', 'mana', 11, 671),
        ('hero_varus', 'mana', 12, 713.8),
        ('hero_varus', 'mana', 13, 758),
        ('hero_varus', 'mana', 14, 803.6),
        ('hero_varus', 'mana', 15, 850.6),
        ('hero_varus', 'mana', 16, 899),
        ('hero_varus', 'mana', 17, 948.8),
        ('hero_varus', 'mana', 18, 1000),
        ('hero_varus', 'ad', 1, 59),
        ('hero_varus', 'ad', 2, 61.448),
        ('hero_varus', 'ad', 3, 64.015),
        ('hero_varus', 'ad', 4, 66.701),
        ('hero_varus', 'ad', 5, 69.506),
        ('hero_varus', 'ad', 6, 72.43),
        ('hero_varus', 'ad', 7, 75.473),
        ('hero_varus', 'ad', 8, 78.635),
        ('hero_varus', 'ad', 9, 81.916),
        ('hero_varus', 'ad', 10, 85.316),
        ('hero_varus', 'ad', 11, 88.835),
        ('hero_varus', 'ad', 12, 92.473),
        ('hero_varus', 'ad', 13, 96.23),
        ('hero_varus', 'ad', 14, 100.106),
        ('hero_varus', 'ad', 15, 104.101),
        ('hero_varus', 'ad', 16, 108.215),
        ('hero_varus', 'ad', 17, 112.448),
        ('hero_varus', 'ad', 18, 116.8),
        ('hero_varus', 'armor', 1, 24),
        ('hero_varus', 'armor', 2, 26.88),
        ('hero_varus', 'armor', 3, 29.9),
        ('hero_varus', 'armor', 4, 33.06),
        ('hero_varus', 'armor', 5, 36.36),
        ('hero_varus', 'armor', 6, 39.8),
        ('hero_varus', 'armor', 7, 43.38),
        ('hero_varus', 'armor', 8, 47.1),
        ('hero_varus', 'armor', 9, 50.96),
        ('hero_varus', 'armor', 10, 54.96),
        ('hero_varus', 'armor', 11, 59.1),
        ('hero_varus', 'armor', 12, 63.38),
        ('hero_varus', 'armor', 13, 67.8),
        ('hero_varus', 'armor', 14, 72.36),
        ('hero_varus', 'armor', 15, 77.06),
        ('hero_varus', 'armor', 16, 81.9),
        ('hero_varus', 'armor', 17, 86.88),
        ('hero_varus', 'armor', 18, 92),
        ('hero_varus', 'magic_resist', 1, 30),
        ('hero_varus', 'magic_resist', 2, 30.936),
        ('hero_varus', 'magic_resist', 3, 31.917),
        ('hero_varus', 'magic_resist', 4, 32.944),
        ('hero_varus', 'magic_resist', 5, 34.017),
        ('hero_varus', 'magic_resist', 6, 35.135),
        ('hero_varus', 'magic_resist', 7, 36.298),
        ('hero_varus', 'magic_resist', 8, 37.507),
        ('hero_varus', 'magic_resist', 9, 38.762),
        ('hero_varus', 'magic_resist', 10, 40.062),
        ('hero_varus', 'magic_resist', 11, 41.407),
        ('hero_varus', 'magic_resist', 12, 42.798),
        ('hero_varus', 'magic_resist', 13, 44.235),
        ('hero_varus', 'magic_resist', 14, 45.717),
        ('hero_varus', 'magic_resist', 15, 47.244),
        ('hero_varus', 'magic_resist', 16, 48.817),
        ('hero_varus', 'magic_resist', 17, 50.436),
        ('hero_varus', 'magic_resist', 18, 52.1),
        ('hero_varus', 'hp_regen', 1, 0.7),
        ('hero_varus', 'hp_regen', 2, 0.7792),
        ('hero_varus', 'hp_regen', 3, 0.8622),
        ('hero_varus', 'hp_regen', 4, 0.9491),
        ('hero_varus', 'hp_regen', 5, 1.0399),
        ('hero_varus', 'hp_regen', 6, 1.1345),
        ('hero_varus', 'hp_regen', 7, 1.2329),
        ('hero_varus', 'hp_regen', 8, 1.3352),
        ('hero_varus', 'hp_regen', 9, 1.4414),
        ('hero_varus', 'hp_regen', 10, 1.5514),
        ('hero_varus', 'hp_regen', 11, 1.6652),
        ('hero_varus', 'hp_regen', 12, 1.7829),
        ('hero_varus', 'hp_regen', 13, 1.9045),
        ('hero_varus', 'hp_regen', 14, 2.0299),
        ('hero_varus', 'hp_regen', 15, 2.1591),
        ('hero_varus', 'hp_regen', 16, 2.2922),
        ('hero_varus', 'hp_regen', 17, 2.4292),
        ('hero_varus', 'hp_regen', 18, 2.57),
        ('hero_varus', 'mana_regen', 1, 1.6),
        ('hero_varus', 'mana_regen', 2, 1.7152),
        ('hero_varus', 'mana_regen', 3, 1.836),
        ('hero_varus', 'mana_regen', 4, 1.9624),
        ('hero_varus', 'mana_regen', 5, 2.0944),
        ('hero_varus', 'mana_regen', 6, 2.232),
        ('hero_varus', 'mana_regen', 7, 2.3752),
        ('hero_varus', 'mana_regen', 8, 2.524),
        ('hero_varus', 'mana_regen', 9, 2.6784),
        ('hero_varus', 'mana_regen', 10, 2.8384),
        ('hero_varus', 'mana_regen', 11, 3.004),
        ('hero_varus', 'mana_regen', 12, 3.1752),
        ('hero_varus', 'mana_regen', 13, 3.352),
        ('hero_varus', 'mana_regen', 14, 3.5344),
        ('hero_varus', 'mana_regen', 15, 3.7224),
        ('hero_varus', 'mana_regen', 16, 3.916),
        ('hero_varus', 'mana_regen', 17, 4.1152),
        ('hero_varus', 'mana_regen', 18, 4.32),
        ('hero_varus', 'attack_speed', 1, 0.658),
        ('hero_varus', 'attack_speed', 2, 0.674582),
        ('hero_varus', 'attack_speed', 3, 0.691969),
        ('hero_varus', 'attack_speed', 4, 0.710163),
        ('hero_varus', 'attack_speed', 5, 0.729163),
        ('hero_varus', 'attack_speed', 6, 0.748968),
        ('hero_varus', 'attack_speed', 7, 0.76958),
        ('hero_varus', 'attack_speed', 8, 0.790998),
        ('hero_varus', 'attack_speed', 9, 0.813222),
        ('hero_varus', 'attack_speed', 10, 0.836252),
        ('hero_varus', 'attack_speed', 11, 0.860088),
        ('hero_varus', 'attack_speed', 12, 0.88473),
        ('hero_varus', 'attack_speed', 13, 0.910178),
        ('hero_varus', 'attack_speed', 14, 0.936433),
        ('hero_varus', 'attack_speed', 15, 0.963493),
        ('hero_varus', 'attack_speed', 16, 0.991359),
        ('hero_varus', 'attack_speed', 17, 1.020032),
        ('hero_varus', 'attack_speed', 18, 1.04951),
        ('hero_kaisa', 'hp', 1, 640),
        ('hero_kaisa', 'hp', 2, 713.44),
        ('hero_kaisa', 'hp', 3, 790.45),
        ('hero_kaisa', 'hp', 4, 871.03),
        ('hero_kaisa', 'hp', 5, 955.18),
        ('hero_kaisa', 'hp', 6, 1042.9),
        ('hero_kaisa', 'hp', 7, 1134.19),
        ('hero_kaisa', 'hp', 8, 1229.05),
        ('hero_kaisa', 'hp', 9, 1327.48),
        ('hero_kaisa', 'hp', 10, 1429.48),
        ('hero_kaisa', 'hp', 11, 1535.05),
        ('hero_kaisa', 'hp', 12, 1644.19),
        ('hero_kaisa', 'hp', 13, 1756.9),
        ('hero_kaisa', 'hp', 14, 1873.18),
        ('hero_kaisa', 'hp', 15, 1993.03),
        ('hero_kaisa', 'hp', 16, 2116.45),
        ('hero_kaisa', 'hp', 17, 2243.44),
        ('hero_kaisa', 'hp', 18, 2374),
        ('hero_kaisa', 'mana', 1, 345),
        ('hero_kaisa', 'mana', 2, 373.8),
        ('hero_kaisa', 'mana', 3, 404),
        ('hero_kaisa', 'mana', 4, 435.6),
        ('hero_kaisa', 'mana', 5, 468.6),
        ('hero_kaisa', 'mana', 6, 503),
        ('hero_kaisa', 'mana', 7, 538.8),
        ('hero_kaisa', 'mana', 8, 576),
        ('hero_kaisa', 'mana', 9, 614.6),
        ('hero_kaisa', 'mana', 10, 654.6),
        ('hero_kaisa', 'mana', 11, 696),
        ('hero_kaisa', 'mana', 12, 738.8),
        ('hero_kaisa', 'mana', 13, 783),
        ('hero_kaisa', 'mana', 14, 828.6),
        ('hero_kaisa', 'mana', 15, 875.6),
        ('hero_kaisa', 'mana', 16, 924),
        ('hero_kaisa', 'mana', 17, 973.8),
        ('hero_kaisa', 'mana', 18, 1025),
        ('hero_kaisa', 'ad', 1, 59),
        ('hero_kaisa', 'ad', 2, 60.872),
        ('hero_kaisa', 'ad', 3, 62.835),
        ('hero_kaisa', 'ad', 4, 64.889),
        ('hero_kaisa', 'ad', 5, 67.034),
        ('hero_kaisa', 'ad', 6, 69.27),
        ('hero_kaisa', 'ad', 7, 71.597),
        ('hero_kaisa', 'ad', 8, 74.015),
        ('hero_kaisa', 'ad', 9, 76.524),
        ('hero_kaisa', 'ad', 10, 79.124),
        ('hero_kaisa', 'ad', 11, 81.815),
        ('hero_kaisa', 'ad', 12, 84.597),
        ('hero_kaisa', 'ad', 13, 87.47),
        ('hero_kaisa', 'ad', 14, 90.434),
        ('hero_kaisa', 'ad', 15, 93.489),
        ('hero_kaisa', 'ad', 16, 96.635),
        ('hero_kaisa', 'ad', 17, 99.872),
        ('hero_kaisa', 'ad', 18, 103.2),
        ('hero_kaisa', 'armor', 1, 25),
        ('hero_kaisa', 'armor', 2, 28.024),
        ('hero_kaisa', 'armor', 3, 31.195),
        ('hero_kaisa', 'armor', 4, 34.513),
        ('hero_kaisa', 'armor', 5, 37.978),
        ('hero_kaisa', 'armor', 6, 41.59),
        ('hero_kaisa', 'armor', 7, 45.349),
        ('hero_kaisa', 'armor', 8, 49.255),
        ('hero_kaisa', 'armor', 9, 53.308),
        ('hero_kaisa', 'armor', 10, 57.508),
        ('hero_kaisa', 'armor', 11, 61.855),
        ('hero_kaisa', 'armor', 12, 66.349),
        ('hero_kaisa', 'armor', 13, 70.99),
        ('hero_kaisa', 'armor', 14, 75.778),
        ('hero_kaisa', 'armor', 15, 80.713),
        ('hero_kaisa', 'armor', 16, 85.795),
        ('hero_kaisa', 'armor', 17, 91.024),
        ('hero_kaisa', 'armor', 18, 96.4),
        ('hero_kaisa', 'magic_resist', 1, 30),
        ('hero_kaisa', 'magic_resist', 2, 30.936),
        ('hero_kaisa', 'magic_resist', 3, 31.917),
        ('hero_kaisa', 'magic_resist', 4, 32.944),
        ('hero_kaisa', 'magic_resist', 5, 34.017),
        ('hero_kaisa', 'magic_resist', 6, 35.135),
        ('hero_kaisa', 'magic_resist', 7, 36.298),
        ('hero_kaisa', 'magic_resist', 8, 37.507),
        ('hero_kaisa', 'magic_resist', 9, 38.762),
        ('hero_kaisa', 'magic_resist', 10, 40.062),
        ('hero_kaisa', 'magic_resist', 11, 41.407),
        ('hero_kaisa', 'magic_resist', 12, 42.798),
        ('hero_kaisa', 'magic_resist', 13, 44.235),
        ('hero_kaisa', 'magic_resist', 14, 45.717),
        ('hero_kaisa', 'magic_resist', 15, 47.244),
        ('hero_kaisa', 'magic_resist', 16, 48.817),
        ('hero_kaisa', 'magic_resist', 17, 50.436),
        ('hero_kaisa', 'magic_resist', 18, 52.1),
        ('hero_kaisa', 'hp_regen', 1, 0.8),
        ('hero_kaisa', 'hp_regen', 2, 0.8792),
        ('hero_kaisa', 'hp_regen', 3, 0.9622),
        ('hero_kaisa', 'hp_regen', 4, 1.0491),
        ('hero_kaisa', 'hp_regen', 5, 1.1399),
        ('hero_kaisa', 'hp_regen', 6, 1.2345),
        ('hero_kaisa', 'hp_regen', 7, 1.3329),
        ('hero_kaisa', 'hp_regen', 8, 1.4352),
        ('hero_kaisa', 'hp_regen', 9, 1.5414),
        ('hero_kaisa', 'hp_regen', 10, 1.6514),
        ('hero_kaisa', 'hp_regen', 11, 1.7652),
        ('hero_kaisa', 'hp_regen', 12, 1.8829),
        ('hero_kaisa', 'hp_regen', 13, 2.0045),
        ('hero_kaisa', 'hp_regen', 14, 2.1299),
        ('hero_kaisa', 'hp_regen', 15, 2.2591),
        ('hero_kaisa', 'hp_regen', 16, 2.3922),
        ('hero_kaisa', 'hp_regen', 17, 2.5292),
        ('hero_kaisa', 'hp_regen', 18, 2.67),
        ('hero_kaisa', 'mana_regen', 1, 1.64),
        ('hero_kaisa', 'mana_regen', 2, 1.7408),
        ('hero_kaisa', 'mana_regen', 3, 1.8465),
        ('hero_kaisa', 'mana_regen', 4, 1.9571),
        ('hero_kaisa', 'mana_regen', 5, 2.0726),
        ('hero_kaisa', 'mana_regen', 6, 2.193),
        ('hero_kaisa', 'mana_regen', 7, 2.3183),
        ('hero_kaisa', 'mana_regen', 8, 2.4485),
        ('hero_kaisa', 'mana_regen', 9, 2.5836),
        ('hero_kaisa', 'mana_regen', 10, 2.7236),
        ('hero_kaisa', 'mana_regen', 11, 2.8685),
        ('hero_kaisa', 'mana_regen', 12, 3.0183),
        ('hero_kaisa', 'mana_regen', 13, 3.173),
        ('hero_kaisa', 'mana_regen', 14, 3.3326),
        ('hero_kaisa', 'mana_regen', 15, 3.4971),
        ('hero_kaisa', 'mana_regen', 16, 3.6665),
        ('hero_kaisa', 'mana_regen', 17, 3.8408),
        ('hero_kaisa', 'mana_regen', 18, 4.02),
        ('hero_kaisa', 'attack_speed', 1, 0.644),
        ('hero_kaisa', 'attack_speed', 2, 0.652346),
        ('hero_kaisa', 'attack_speed', 3, 0.661098),
        ('hero_kaisa', 'attack_speed', 4, 0.670256),
        ('hero_kaisa', 'attack_speed', 5, 0.679819),
        ('hero_kaisa', 'attack_speed', 6, 0.689788),
        ('hero_kaisa', 'attack_speed', 7, 0.700163),
        ('hero_kaisa', 'attack_speed', 8, 0.710944),
        ('hero_kaisa', 'attack_speed', 9, 0.72213),
        ('hero_kaisa', 'attack_speed', 10, 0.733722),
        ('hero_kaisa', 'attack_speed', 11, 0.74572),
        ('hero_kaisa', 'attack_speed', 12, 0.758123),
        ('hero_kaisa', 'attack_speed', 13, 0.770932),
        ('hero_kaisa', 'attack_speed', 14, 0.784147),
        ('hero_kaisa', 'attack_speed', 15, 0.797768),
        ('hero_kaisa', 'attack_speed', 16, 0.811794),
        ('hero_kaisa', 'attack_speed', 17, 0.826226),
        ('hero_kaisa', 'attack_speed', 18, 0.841064),
        ('hero_twitch', 'hp', 1, 630),
        ('hero_twitch', 'hp', 2, 700.56),
        ('hero_twitch', 'hp', 3, 774.55),
        ('hero_twitch', 'hp', 4, 851.97),
        ('hero_twitch', 'hp', 5, 932.82),
        ('hero_twitch', 'hp', 6, 1017.1),
        ('hero_twitch', 'hp', 7, 1104.81),
        ('hero_twitch', 'hp', 8, 1195.95),
        ('hero_twitch', 'hp', 9, 1290.52),
        ('hero_twitch', 'hp', 10, 1388.52),
        ('hero_twitch', 'hp', 11, 1489.95),
        ('hero_twitch', 'hp', 12, 1594.81),
        ('hero_twitch', 'hp', 13, 1703.1),
        ('hero_twitch', 'hp', 14, 1814.82),
        ('hero_twitch', 'hp', 15, 1929.97),
        ('hero_twitch', 'hp', 16, 2048.55),
        ('hero_twitch', 'hp', 17, 2170.56),
        ('hero_twitch', 'hp', 18, 2296),
        ('hero_twitch', 'mana', 1, 300),
        ('hero_twitch', 'mana', 2, 328.8),
        ('hero_twitch', 'mana', 3, 359),
        ('hero_twitch', 'mana', 4, 390.6),
        ('hero_twitch', 'mana', 5, 423.6),
        ('hero_twitch', 'mana', 6, 458),
        ('hero_twitch', 'mana', 7, 493.8),
        ('hero_twitch', 'mana', 8, 531),
        ('hero_twitch', 'mana', 9, 569.6),
        ('hero_twitch', 'mana', 10, 609.6),
        ('hero_twitch', 'mana', 11, 651),
        ('hero_twitch', 'mana', 12, 693.8),
        ('hero_twitch', 'mana', 13, 738),
        ('hero_twitch', 'mana', 14, 783.6),
        ('hero_twitch', 'mana', 15, 830.6),
        ('hero_twitch', 'mana', 16, 879),
        ('hero_twitch', 'mana', 17, 928.8),
        ('hero_twitch', 'mana', 18, 980),
        ('hero_twitch', 'ad', 1, 59),
        ('hero_twitch', 'ad', 2, 61.16),
        ('hero_twitch', 'ad', 3, 63.425),
        ('hero_twitch', 'ad', 4, 65.795),
        ('hero_twitch', 'ad', 5, 68.27),
        ('hero_twitch', 'ad', 6, 70.85),
        ('hero_twitch', 'ad', 7, 73.535),
        ('hero_twitch', 'ad', 8, 76.325),
        ('hero_twitch', 'ad', 9, 79.22),
        ('hero_twitch', 'ad', 10, 82.22),
        ('hero_twitch', 'ad', 11, 85.325),
        ('hero_twitch', 'ad', 12, 88.535),
        ('hero_twitch', 'ad', 13, 91.85),
        ('hero_twitch', 'ad', 14, 95.27),
        ('hero_twitch', 'ad', 15, 98.795),
        ('hero_twitch', 'ad', 16, 102.425),
        ('hero_twitch', 'ad', 17, 106.16),
        ('hero_twitch', 'ad', 18, 110),
        ('hero_twitch', 'armor', 1, 27),
        ('hero_twitch', 'armor', 2, 29.88),
        ('hero_twitch', 'armor', 3, 32.9),
        ('hero_twitch', 'armor', 4, 36.06),
        ('hero_twitch', 'armor', 5, 39.36),
        ('hero_twitch', 'armor', 6, 42.8),
        ('hero_twitch', 'armor', 7, 46.38),
        ('hero_twitch', 'armor', 8, 50.1),
        ('hero_twitch', 'armor', 9, 53.96),
        ('hero_twitch', 'armor', 10, 57.96),
        ('hero_twitch', 'armor', 11, 62.1),
        ('hero_twitch', 'armor', 12, 66.38),
        ('hero_twitch', 'armor', 13, 70.8),
        ('hero_twitch', 'armor', 14, 75.36),
        ('hero_twitch', 'armor', 15, 80.06),
        ('hero_twitch', 'armor', 16, 84.9),
        ('hero_twitch', 'armor', 17, 89.88),
        ('hero_twitch', 'armor', 18, 95),
        ('hero_twitch', 'magic_resist', 1, 30),
        ('hero_twitch', 'magic_resist', 2, 30.936),
        ('hero_twitch', 'magic_resist', 3, 31.917),
        ('hero_twitch', 'magic_resist', 4, 32.944),
        ('hero_twitch', 'magic_resist', 5, 34.017),
        ('hero_twitch', 'magic_resist', 6, 35.135),
        ('hero_twitch', 'magic_resist', 7, 36.298),
        ('hero_twitch', 'magic_resist', 8, 37.507),
        ('hero_twitch', 'magic_resist', 9, 38.762),
        ('hero_twitch', 'magic_resist', 10, 40.062),
        ('hero_twitch', 'magic_resist', 11, 41.407),
        ('hero_twitch', 'magic_resist', 12, 42.798),
        ('hero_twitch', 'magic_resist', 13, 44.235),
        ('hero_twitch', 'magic_resist', 14, 45.717),
        ('hero_twitch', 'magic_resist', 15, 47.244),
        ('hero_twitch', 'magic_resist', 16, 48.817),
        ('hero_twitch', 'magic_resist', 17, 50.436),
        ('hero_twitch', 'magic_resist', 18, 52.1),
        ('hero_twitch', 'hp_regen', 1, 0.75),
        ('hero_twitch', 'hp_regen', 2, 0.8364),
        ('hero_twitch', 'hp_regen', 3, 0.927),
        ('hero_twitch', 'hp_regen', 4, 1.0218),
        ('hero_twitch', 'hp_regen', 5, 1.1208),
        ('hero_twitch', 'hp_regen', 6, 1.224),
        ('hero_twitch', 'hp_regen', 7, 1.3314),
        ('hero_twitch', 'hp_regen', 8, 1.443),
        ('hero_twitch', 'hp_regen', 9, 1.5588),
        ('hero_twitch', 'hp_regen', 10, 1.6788),
        ('hero_twitch', 'hp_regen', 11, 1.803),
        ('hero_twitch', 'hp_regen', 12, 1.9314),
        ('hero_twitch', 'hp_regen', 13, 2.064),
        ('hero_twitch', 'hp_regen', 14, 2.2008),
        ('hero_twitch', 'hp_regen', 15, 2.3418),
        ('hero_twitch', 'hp_regen', 16, 2.487),
        ('hero_twitch', 'hp_regen', 17, 2.6364),
        ('hero_twitch', 'hp_regen', 18, 2.79),
        ('hero_twitch', 'mana_regen', 1, 1.45),
        ('hero_twitch', 'mana_regen', 2, 1.5508),
        ('hero_twitch', 'mana_regen', 3, 1.6565),
        ('hero_twitch', 'mana_regen', 4, 1.7671),
        ('hero_twitch', 'mana_regen', 5, 1.8826),
        ('hero_twitch', 'mana_regen', 6, 2.003),
        ('hero_twitch', 'mana_regen', 7, 2.1283),
        ('hero_twitch', 'mana_regen', 8, 2.2585),
        ('hero_twitch', 'mana_regen', 9, 2.3936),
        ('hero_twitch', 'mana_regen', 10, 2.5336),
        ('hero_twitch', 'mana_regen', 11, 2.6785),
        ('hero_twitch', 'mana_regen', 12, 2.8283),
        ('hero_twitch', 'mana_regen', 13, 2.983),
        ('hero_twitch', 'mana_regen', 14, 3.1426),
        ('hero_twitch', 'mana_regen', 15, 3.3071),
        ('hero_twitch', 'mana_regen', 16, 3.4765),
        ('hero_twitch', 'mana_regen', 17, 3.6508),
        ('hero_twitch', 'mana_regen', 18, 3.83),
        ('hero_twitch', 'attack_speed', 1, 0.679),
        ('hero_twitch', 'attack_speed', 2, 0.693666),
        ('hero_twitch', 'attack_speed', 3, 0.709046),
        ('hero_twitch', 'attack_speed', 4, 0.725138),
        ('hero_twitch', 'attack_speed', 5, 0.741943),
        ('hero_twitch', 'attack_speed', 6, 0.759462),
        ('hero_twitch', 'attack_speed', 7, 0.777693),
        ('hero_twitch', 'attack_speed', 8, 0.796637),
        ('hero_twitch', 'attack_speed', 9, 0.816294),
        ('hero_twitch', 'attack_speed', 10, 0.836664),
        ('hero_twitch', 'attack_speed', 11, 0.857747),
        ('hero_twitch', 'attack_speed', 12, 0.879543),
        ('hero_twitch', 'attack_speed', 13, 0.902052),
        ('hero_twitch', 'attack_speed', 14, 0.925273),
        ('hero_twitch', 'attack_speed', 15, 0.949208),
        ('hero_twitch', 'attack_speed', 16, 0.973856),
        ('hero_twitch', 'attack_speed', 17, 0.999216),
        ('hero_twitch', 'attack_speed', 18, 1.02529),
        ('hero_kogmaw', 'hp', 1, 635),
        ('hero_kogmaw', 'hp', 2, 706.28),
        ('hero_kogmaw', 'hp', 3, 781.025),
        ('hero_kogmaw', 'hp', 4, 859.235),
        ('hero_kogmaw', 'hp', 5, 940.91),
        ('hero_kogmaw', 'hp', 6, 1026.05),
        ('hero_kogmaw', 'hp', 7, 1114.655),
        ('hero_kogmaw', 'hp', 8, 1206.725),
        ('hero_kogmaw', 'hp', 9, 1302.26),
        ('hero_kogmaw', 'hp', 10, 1401.26),
        ('hero_kogmaw', 'hp', 11, 1503.725),
        ('hero_kogmaw', 'hp', 12, 1609.655),
        ('hero_kogmaw', 'hp', 13, 1719.05),
        ('hero_kogmaw', 'hp', 14, 1831.91),
        ('hero_kogmaw', 'hp', 15, 1948.235),
        ('hero_kogmaw', 'hp', 16, 2068.025),
        ('hero_kogmaw', 'hp', 17, 2191.28),
        ('hero_kogmaw', 'hp', 18, 2318),
        ('hero_kogmaw', 'mana', 1, 325),
        ('hero_kogmaw', 'mana', 2, 353.8),
        ('hero_kogmaw', 'mana', 3, 384),
        ('hero_kogmaw', 'mana', 4, 415.6),
        ('hero_kogmaw', 'mana', 5, 448.6),
        ('hero_kogmaw', 'mana', 6, 483),
        ('hero_kogmaw', 'mana', 7, 518.8),
        ('hero_kogmaw', 'mana', 8, 556),
        ('hero_kogmaw', 'mana', 9, 594.6),
        ('hero_kogmaw', 'mana', 10, 634.6),
        ('hero_kogmaw', 'mana', 11, 676),
        ('hero_kogmaw', 'mana', 12, 718.8),
        ('hero_kogmaw', 'mana', 13, 763),
        ('hero_kogmaw', 'mana', 14, 808.6),
        ('hero_kogmaw', 'mana', 15, 855.6),
        ('hero_kogmaw', 'mana', 16, 904),
        ('hero_kogmaw', 'mana', 17, 953.8),
        ('hero_kogmaw', 'mana', 18, 1005),
        ('hero_kogmaw', 'ad', 1, 61),
        ('hero_kogmaw', 'ad', 2, 63.232),
        ('hero_kogmaw', 'ad', 3, 65.572),
        ('hero_kogmaw', 'ad', 4, 68.021),
        ('hero_kogmaw', 'ad', 5, 70.579),
        ('hero_kogmaw', 'ad', 6, 73.245),
        ('hero_kogmaw', 'ad', 7, 76.019),
        ('hero_kogmaw', 'ad', 8, 78.902),
        ('hero_kogmaw', 'ad', 9, 81.894),
        ('hero_kogmaw', 'ad', 10, 84.994),
        ('hero_kogmaw', 'ad', 11, 88.202),
        ('hero_kogmaw', 'ad', 12, 91.519),
        ('hero_kogmaw', 'ad', 13, 94.945),
        ('hero_kogmaw', 'ad', 14, 98.479),
        ('hero_kogmaw', 'ad', 15, 102.121),
        ('hero_kogmaw', 'ad', 16, 105.872),
        ('hero_kogmaw', 'ad', 17, 109.732),
        ('hero_kogmaw', 'ad', 18, 113.7),
        ('hero_kogmaw', 'armor', 1, 24),
        ('hero_kogmaw', 'armor', 2, 27.204),
        ('hero_kogmaw', 'armor', 3, 30.564),
        ('hero_kogmaw', 'armor', 4, 34.079),
        ('hero_kogmaw', 'armor', 5, 37.75),
        ('hero_kogmaw', 'armor', 6, 41.577),
        ('hero_kogmaw', 'armor', 7, 45.56),
        ('hero_kogmaw', 'armor', 8, 49.699),
        ('hero_kogmaw', 'armor', 9, 53.993),
        ('hero_kogmaw', 'armor', 10, 58.443),
        ('hero_kogmaw', 'armor', 11, 63.049),
        ('hero_kogmaw', 'armor', 12, 67.81),
        ('hero_kogmaw', 'armor', 13, 72.727),
        ('hero_kogmaw', 'armor', 14, 77.8),
        ('hero_kogmaw', 'armor', 15, 83.029),
        ('hero_kogmaw', 'armor', 16, 88.414),
        ('hero_kogmaw', 'armor', 17, 93.954),
        ('hero_kogmaw', 'armor', 18, 99.65),
        ('hero_kogmaw', 'magic_resist', 1, 30),
        ('hero_kogmaw', 'magic_resist', 2, 30.936),
        ('hero_kogmaw', 'magic_resist', 3, 31.917),
        ('hero_kogmaw', 'magic_resist', 4, 32.944),
        ('hero_kogmaw', 'magic_resist', 5, 34.017),
        ('hero_kogmaw', 'magic_resist', 6, 35.135),
        ('hero_kogmaw', 'magic_resist', 7, 36.298),
        ('hero_kogmaw', 'magic_resist', 8, 37.507),
        ('hero_kogmaw', 'magic_resist', 9, 38.762),
        ('hero_kogmaw', 'magic_resist', 10, 40.062),
        ('hero_kogmaw', 'magic_resist', 11, 41.407),
        ('hero_kogmaw', 'magic_resist', 12, 42.798),
        ('hero_kogmaw', 'magic_resist', 13, 44.235),
        ('hero_kogmaw', 'magic_resist', 14, 45.717),
        ('hero_kogmaw', 'magic_resist', 15, 47.244),
        ('hero_kogmaw', 'magic_resist', 16, 48.817),
        ('hero_kogmaw', 'magic_resist', 17, 50.436),
        ('hero_kogmaw', 'magic_resist', 18, 52.1),
        ('hero_kogmaw', 'hp_regen', 1, 0.75),
        ('hero_kogmaw', 'hp_regen', 2, 0.8292),
        ('hero_kogmaw', 'hp_regen', 3, 0.9122),
        ('hero_kogmaw', 'hp_regen', 4, 0.9991),
        ('hero_kogmaw', 'hp_regen', 5, 1.0899),
        ('hero_kogmaw', 'hp_regen', 6, 1.1845),
        ('hero_kogmaw', 'hp_regen', 7, 1.2829),
        ('hero_kogmaw', 'hp_regen', 8, 1.3852),
        ('hero_kogmaw', 'hp_regen', 9, 1.4914),
        ('hero_kogmaw', 'hp_regen', 10, 1.6014),
        ('hero_kogmaw', 'hp_regen', 11, 1.7152),
        ('hero_kogmaw', 'hp_regen', 12, 1.8329),
        ('hero_kogmaw', 'hp_regen', 13, 1.9545),
        ('hero_kogmaw', 'hp_regen', 14, 2.0799),
        ('hero_kogmaw', 'hp_regen', 15, 2.2091),
        ('hero_kogmaw', 'hp_regen', 16, 2.3422),
        ('hero_kogmaw', 'hp_regen', 17, 2.4792),
        ('hero_kogmaw', 'hp_regen', 18, 2.62),
        ('hero_kogmaw', 'mana_regen', 1, 1.75),
        ('hero_kogmaw', 'mana_regen', 2, 1.8508),
        ('hero_kogmaw', 'mana_regen', 3, 1.9565),
        ('hero_kogmaw', 'mana_regen', 4, 2.0671),
        ('hero_kogmaw', 'mana_regen', 5, 2.1826),
        ('hero_kogmaw', 'mana_regen', 6, 2.303),
        ('hero_kogmaw', 'mana_regen', 7, 2.4283),
        ('hero_kogmaw', 'mana_regen', 8, 2.5585),
        ('hero_kogmaw', 'mana_regen', 9, 2.6936),
        ('hero_kogmaw', 'mana_regen', 10, 2.8336),
        ('hero_kogmaw', 'mana_regen', 11, 2.9785),
        ('hero_kogmaw', 'mana_regen', 12, 3.1283),
        ('hero_kogmaw', 'mana_regen', 13, 3.283),
        ('hero_kogmaw', 'mana_regen', 14, 3.4426),
        ('hero_kogmaw', 'mana_regen', 15, 3.6071),
        ('hero_kogmaw', 'mana_regen', 16, 3.7765),
        ('hero_kogmaw', 'mana_regen', 17, 3.9508),
        ('hero_kogmaw', 'mana_regen', 18, 4.13),
        ('hero_kogmaw', 'attack_speed', 1, 0.665),
        ('hero_kogmaw', 'attack_speed', 2, 0.677688),
        ('hero_kogmaw', 'attack_speed', 3, 0.690993),
        ('hero_kogmaw', 'attack_speed', 4, 0.704915),
        ('hero_kogmaw', 'attack_speed', 5, 0.719454),
        ('hero_kogmaw', 'attack_speed', 6, 0.734609),
        ('hero_kogmaw', 'attack_speed', 7, 0.750381),
        ('hero_kogmaw', 'attack_speed', 8, 0.76677),
        ('hero_kogmaw', 'attack_speed', 9, 0.783776),
        ('hero_kogmaw', 'attack_speed', 10, 0.801398),
        ('hero_kogmaw', 'attack_speed', 11, 0.819637),
        ('hero_kogmaw', 'attack_speed', 12, 0.838494),
        ('hero_kogmaw', 'attack_speed', 13, 0.857966),
        ('hero_kogmaw', 'attack_speed', 14, 0.878056),
        ('hero_kogmaw', 'attack_speed', 15, 0.898762),
        ('hero_kogmaw', 'attack_speed', 16, 0.920086),
        ('hero_kogmaw', 'attack_speed', 17, 0.942026),
        ('hero_kogmaw', 'attack_speed', 18, 0.964583)
      ) AS v(entity_id, attr_key, stage, value)
    ON CONFLICT (game_id, entity_id, attr_key, stage) DO UPDATE SET
        value = EXCLUDED.value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_attribute_stage_values.value IS DISTINCT FROM EXCLUDED.value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- 6 ADC 独立通用普攻闭环（稳定 ID 规则同首批 bootstrap；ID 字面量便于审查）
    INSERT INTO public.provider_definitions (
        game_id, provider_id, provider_kind_type_id, display_name,
        change_revision, updated_at
    )
    SELECT
        v_game_id,
        a.provider_id,
        20120,
        a.provider_name,
        v_candidate,
        NOW()
      FROM (VALUES
        ('hero_vayne', 'provider_hero_vayne_basic_attack', '薇恩通用普攻'),
        ('hero_teemo', 'provider_hero_teemo_basic_attack', '提莫通用普攻'),
        ('hero_varus', 'provider_hero_varus_basic_attack', '韦鲁斯通用普攻'),
        ('hero_kaisa', 'provider_hero_kaisa_basic_attack', '卡莎通用普攻'),
        ('hero_twitch', 'provider_hero_twitch_basic_attack', '图奇通用普攻'),
        ('hero_kogmaw', 'provider_hero_kogmaw_basic_attack', '克格莫通用普攻')
      ) AS a(entity_id, provider_id, provider_name)
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

    INSERT INTO public.provider_formulas (
        game_id, provider_id, formula_key, expression, change_revision, updated_at
    )
    SELECT
        v_game_id,
        a.provider_id,
        'basic_attack_damage',
        '{"op":"read","path":"$owner.attr.ad"}'::jsonb,
        v_candidate,
        NOW()
      FROM (VALUES
        ('provider_hero_vayne_basic_attack'),
        ('provider_hero_teemo_basic_attack'),
        ('provider_hero_varus_basic_attack'),
        ('provider_hero_kaisa_basic_attack'),
        ('provider_hero_twitch_basic_attack'),
        ('provider_hero_kogmaw_basic_attack')
      ) AS a(provider_id)
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
    )
    SELECT
        v_game_id,
        a.ability_id,
        a.provider_id,
        'basic_attack',
        20130,
        '普攻',
        v_candidate,
        NOW()
      FROM (VALUES
        ('ability_hero_vayne_basic_attack', 'provider_hero_vayne_basic_attack'),
        ('ability_hero_teemo_basic_attack', 'provider_hero_teemo_basic_attack'),
        ('ability_hero_varus_basic_attack', 'provider_hero_varus_basic_attack'),
        ('ability_hero_kaisa_basic_attack', 'provider_hero_kaisa_basic_attack'),
        ('ability_hero_twitch_basic_attack', 'provider_hero_twitch_basic_attack'),
        ('ability_hero_kogmaw_basic_attack', 'provider_hero_kogmaw_basic_attack')
      ) AS a(ability_id, provider_id)
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
    )
    SELECT
        v_game_id,
        a.phase_id,
        a.ability_id,
        0,
        20142,
        NULL,
        false,
        v_candidate,
        NOW()
      FROM (VALUES
        ('phase_hero_vayne_basic_attack_impact', 'ability_hero_vayne_basic_attack'),
        ('phase_hero_teemo_basic_attack_impact', 'ability_hero_teemo_basic_attack'),
        ('phase_hero_varus_basic_attack_impact', 'ability_hero_varus_basic_attack'),
        ('phase_hero_kaisa_basic_attack_impact', 'ability_hero_kaisa_basic_attack'),
        ('phase_hero_twitch_basic_attack_impact', 'ability_hero_twitch_basic_attack'),
        ('phase_hero_kogmaw_basic_attack_impact', 'ability_hero_kogmaw_basic_attack')
      ) AS a(phase_id, ability_id)
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
    )
    SELECT
        v_game_id,
        a.sequence_id,
        a.provider_id,
        'basic_attack_damage',
        '普攻伤害',
        v_candidate,
        NOW()
      FROM (VALUES
        ('sequence_hero_vayne_basic_attack_damage', 'provider_hero_vayne_basic_attack'),
        ('sequence_hero_teemo_basic_attack_damage', 'provider_hero_teemo_basic_attack'),
        ('sequence_hero_varus_basic_attack_damage', 'provider_hero_varus_basic_attack'),
        ('sequence_hero_kaisa_basic_attack_damage', 'provider_hero_kaisa_basic_attack'),
        ('sequence_hero_twitch_basic_attack_damage', 'provider_hero_twitch_basic_attack'),
        ('sequence_hero_kogmaw_basic_attack_damage', 'provider_hero_kogmaw_basic_attack')
      ) AS a(sequence_id, provider_id)
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
    )
    SELECT
        v_game_id,
        a.step_id,
        a.sequence_id,
        0,
        20150,
        20111,
        NULL,
        v_candidate,
        NOW()
      FROM (VALUES
        ('step_hero_vayne_basic_attack_damage', 'sequence_hero_vayne_basic_attack_damage'),
        ('step_hero_teemo_basic_attack_damage', 'sequence_hero_teemo_basic_attack_damage'),
        ('step_hero_varus_basic_attack_damage', 'sequence_hero_varus_basic_attack_damage'),
        ('step_hero_kaisa_basic_attack_damage', 'sequence_hero_kaisa_basic_attack_damage'),
        ('step_hero_twitch_basic_attack_damage', 'sequence_hero_twitch_basic_attack_damage'),
        ('step_hero_kogmaw_basic_attack_damage', 'sequence_hero_kogmaw_basic_attack_damage')
      ) AS a(step_id, sequence_id)
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

    -- damage detail 与 effect_steps 同事务，满足 deferred exactly-one-detail
    INSERT INTO public.damage_effect_details (
        game_id, step_id, amount_formula_key, damage_type_id, value_policy_type_id,
        change_revision, updated_at
    )
    SELECT
        v_game_id,
        a.step_id,
        'basic_attack_damage',
        20220,
        20170,
        v_candidate,
        NOW()
      FROM (VALUES
        ('step_hero_vayne_basic_attack_damage'),
        ('step_hero_teemo_basic_attack_damage'),
        ('step_hero_varus_basic_attack_damage'),
        ('step_hero_kaisa_basic_attack_damage'),
        ('step_hero_twitch_basic_attack_damage'),
        ('step_hero_kogmaw_basic_attack_damage')
      ) AS a(step_id)
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

    INSERT INTO public.ability_phase_effect_sequences (
        game_id, phase_id, trigger_type_id, sequence_id, change_revision, updated_at
    )
    SELECT
        v_game_id,
        a.phase_id,
        20260,
        a.sequence_id,
        v_candidate,
        NOW()
      FROM (VALUES
        ('phase_hero_vayne_basic_attack_impact', 'sequence_hero_vayne_basic_attack_damage'),
        ('phase_hero_teemo_basic_attack_impact', 'sequence_hero_teemo_basic_attack_damage'),
        ('phase_hero_varus_basic_attack_impact', 'sequence_hero_varus_basic_attack_damage'),
        ('phase_hero_kaisa_basic_attack_impact', 'sequence_hero_kaisa_basic_attack_damage'),
        ('phase_hero_twitch_basic_attack_impact', 'sequence_hero_twitch_basic_attack_damage'),
        ('phase_hero_kogmaw_basic_attack_impact', 'sequence_hero_kogmaw_basic_attack_damage')
      ) AS a(phase_id, sequence_id)
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
    )
    SELECT
        v_game_id,
        a.entity_id,
        a.provider_id,
        v_candidate,
        NOW()
      FROM (VALUES
        ('hero_vayne', 'provider_hero_vayne_basic_attack'),
        ('hero_teemo', 'provider_hero_teemo_basic_attack'),
        ('hero_varus', 'provider_hero_varus_basic_attack'),
        ('hero_kaisa', 'provider_hero_kaisa_basic_attack'),
        ('hero_twitch', 'provider_hero_twitch_basic_attack'),
        ('hero_kogmaw', 'provider_hero_kogmaw_basic_attack')
      ) AS a(entity_id, provider_id)
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
