-- =============================================================================
-- LoL Batch-C ADC completed items (generic combat-data)
-- =============================================================================
--
-- 目标：将 V2-Batch-C 的 53 个 ADC 相关成品装备迁入 generic combat-data；
--       每件装备写为 game_entities + 非零 statModifiers 属性行，并用
--       game-local tag type_id=62002 (tag/adc_completed_item) 挂到 entity。
-- 数值来源：最小验证/V2-Batch-C-adc-items.seed.json
--
-- 契约要点：
-- 1. 单事务；固定 game_id='lol'；先 ensure_game_partitions，再锁定 game_data_state。
-- 2. 候选 revision = locked current_revision + 1；仅业务数据实际插入/变化时推进 current_revision。
-- 3. 必需 16 个 attribute_definitions 缺失则抛异常回滚；不伪造 reserved types。
-- 4. entity_id = item_<sourceItemId>；最终 type_relations 使用 target_category='entity'。
-- 5. type_key 使用 tag/adc_completed_item（非 entity/* 域）；reserved_type_id=NULL。
-- 6. 兼容：允许唯一已知 placeholder（type_id=62002, type_key=type/62002,
--       reserved_type_id IS NULL, name IN (adc_completed_item, ADC completed item)）
--       经正常 types upsert 升级到最终 key；写入最终 entity 关系前，仅删除
--       game_id=lol / type_id=62002 / target_category=equipment / 精确 53 个源数字 target_id
--       的 legacy 关系行；删除计为 material change。其他 type 冲突仍拒绝；不做 broad DELETE。
-- 7. 本脚本不自动 publish；不写入 legacy heroes/items/skills 表。
--
-- 前置：public.games 已存在 game_id='lol'；所需 16 个 attribute_definitions 已存在；
--       建议先执行 lol_generic_combat_bootstrap_seed.sql（或等价基线已存在）。
-- 计数：53 game_entities / 151 entity_attribute_values / 53 type_relations。

BEGIN;

DO $$
DECLARE
    v_game_id            varchar(64) := 'lol';
    v_locked_current     bigint;
    v_candidate          bigint;
    v_changed            boolean := false;
    v_rowcount           integer;
    v_missing_attrs      text;
    v_conflict_type_id   int;
    v_conflict_type_key  varchar(128);
    v_existing_name      varchar(128);
    v_existing_reserved  int;
    v_required_attrs     text[] := ARRAY[
        'ad',
        'ap',
        'hp',
        'mana',
        'armor',
        'magic_resist',
        'ability_haste',
        'attack_speed',
        'crit_chance',
        'crit_damage',
        'life_steal',
        'omnivamp',
        'armor_pen_flat',
        'armor_pen_percent',
        'ms_pct',
        'tenacity'
    ];
BEGIN
    PERFORM public.ensure_game_partitions(v_game_id);

    IF NOT EXISTS (SELECT 1 FROM public.games g WHERE g.game_id = v_game_id) THEN
        RAISE EXCEPTION
            'lol_batch_c_adc_items_seed: game_id=% missing in public.games',
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
            'lol_batch_c_adc_items_seed: failed to lock game_data_state for %',
            v_game_id;
    END IF;

    v_candidate := v_locked_current + 1;

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
            'lol_batch_c_adc_items_seed: missing attribute_definitions for game_id=% attr_key(s): %',
            v_game_id, v_missing_attrs;
    END IF;

    -- collision: type_id=62002 must be absent, already final, or the one known placeholder
    SELECT t.type_key, t.name, t.reserved_type_id
      INTO v_conflict_type_key, v_existing_name, v_existing_reserved
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_id = 62002
       AND t.type_key IS DISTINCT FROM 'tag/adc_completed_item'
       AND NOT (
               t.type_key = 'type/62002'
           AND t.reserved_type_id IS NULL
           AND t.name IN ('adc_completed_item', 'ADC completed item')
           );

    IF v_conflict_type_key IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_batch_c_adc_items_seed: type_id=62002 already bound to type_key=% name=% reserved_type_id=% (expected tag/adc_completed_item or known placeholder type/62002)',
            v_conflict_type_key, v_existing_name, v_existing_reserved;
    END IF;

    -- collision: type_key=tag/adc_completed_item must not already exist with another type_id
    SELECT t.type_id
      INTO v_conflict_type_id
      FROM public.types t
     WHERE t.game_id = v_game_id
       AND t.type_key = 'tag/adc_completed_item'
       AND t.type_id IS DISTINCT FROM 62002;

    IF v_conflict_type_id IS NOT NULL THEN
        RAISE EXCEPTION
            'lol_batch_c_adc_items_seed: type_key=tag/adc_completed_item already bound to type_id=% (expected 62002)',
            v_conflict_type_id;
    END IF;

    -- game-local tag type（非 reserved matcher；reserved_type_id=NULL）
    INSERT INTO public.types (
        game_id, type_id, type_key, name, description, reserved_type_id,
        change_revision, updated_at
    ) VALUES (
        v_game_id,
        62002,
        'tag/adc_completed_item',
        'ADC completed item',
        'V2 Batch C ADC-related completed item pool; excludes components, boots, arena and special copied items.',
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

    -- game_entities：53 ADC completed items
    INSERT INTO public.game_entities (
        game_id, entity_id, display_name, description, change_revision, updated_at
    ) VALUES
        (v_game_id, 'item_2501', '霸王血铠', NULL, v_candidate, NOW()),
        (v_game_id, 'item_2510', '黄昏与黎明', NULL, v_candidate, NOW()),
        (v_game_id, 'item_2512', '猎魔人弩箭', NULL, v_candidate, NOW()),
        (v_game_id, 'item_2517', '无穷饥渴', NULL, v_candidate, NOW()),
        (v_game_id, 'item_2520', '破垒者', NULL, v_candidate, NOW()),
        (v_game_id, 'item_2523', '海克斯镜片 C44', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3004', '魔宗', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3026', '守护天使', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3031', '无尽之刃', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3032', '育恩塔尔荒野箭', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3033', '凡性的提醒', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3036', '多米尼克领主的致意', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3046', '幻影之舞', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3071', '黑色切割者', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3072', '饮血剑', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3073', '海克斯注力刚壁', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3074', '贪欲九头蛇', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3078', '三相之力', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3085', '卢安娜的飓风', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3087', '斯塔缇克电刃', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3091', '智慧末刃', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3094', '疾射火炮', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3097', '岚切', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3100', '巫妖之祸', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3115', '纳什之牙', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3124', '鬼索的狂暴之刃', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3139', '水银弯刀', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3142', '幽梦之灵', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3146', '海克斯科技枪刃', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3153', '破败王者之刃', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3156', '玛莫提乌斯之噬', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3161', '朔极之矛', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3179', '黯影阔剑', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3181', '破舰者', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3302', '界弓', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3508', '夺萃之镰', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3748', '巨型九头蛇', NULL, v_candidate, NOW()),
        (v_game_id, 'item_3814', '夜之锋刃', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6333', '死亡之舞', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6609', '炼金朋克链锯剑', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6610', '焚天', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6631', '挺进破坏者', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6672', '海妖杀手', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6673', '不朽盾弓', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6675', '纳沃利烁刃', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6676', '收集者', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6692', '星蚀', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6694', '赛瑞尔达的怨恨', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6695', '巨蛇之牙', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6696', '公理圆弧', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6697', '狂妄', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6698', '亵渎九头蛇', NULL, v_candidate, NOW()),
        (v_game_id, 'item_6699', '电震涡流剑', NULL, v_candidate, NOW())
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

    -- entity_attribute_values：仅源 statModifiers 非零行（151）
    INSERT INTO public.entity_attribute_values (
        game_id, entity_id, attr_key, base_value, change_revision, updated_at
    ) VALUES
        (v_game_id, 'item_2501', 'ad', 30, v_candidate, NOW()),
        (v_game_id, 'item_2501', 'hp', 550, v_candidate, NOW()),
        (v_game_id, 'item_2510', 'ability_haste', 20, v_candidate, NOW()),
        (v_game_id, 'item_2510', 'ap', 60, v_candidate, NOW()),
        (v_game_id, 'item_2510', 'attack_speed', 0.2, v_candidate, NOW()),
        (v_game_id, 'item_2510', 'hp', 300, v_candidate, NOW()),
        (v_game_id, 'item_2512', 'attack_speed', 0.45, v_candidate, NOW()),
        (v_game_id, 'item_2512', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_2512', 'ms_pct', 0.04, v_candidate, NOW()),
        (v_game_id, 'item_2517', 'ad', 65, v_candidate, NOW()),
        (v_game_id, 'item_2517', 'omnivamp', 0.05, v_candidate, NOW()),
        (v_game_id, 'item_2517', 'tenacity', 0.2, v_candidate, NOW()),
        (v_game_id, 'item_2520', 'ability_haste', 15, v_candidate, NOW()),
        (v_game_id, 'item_2520', 'ad', 55, v_candidate, NOW()),
        (v_game_id, 'item_2520', 'armor_pen_flat', 22, v_candidate, NOW()),
        (v_game_id, 'item_2523', 'ad', 55, v_candidate, NOW()),
        (v_game_id, 'item_2523', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_3004', 'ability_haste', 15, v_candidate, NOW()),
        (v_game_id, 'item_3004', 'ad', 35, v_candidate, NOW()),
        (v_game_id, 'item_3004', 'mana', 500, v_candidate, NOW()),
        (v_game_id, 'item_3026', 'ad', 55, v_candidate, NOW()),
        (v_game_id, 'item_3026', 'armor', 45, v_candidate, NOW()),
        (v_game_id, 'item_3031', 'ad', 75, v_candidate, NOW()),
        (v_game_id, 'item_3031', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_3031', 'crit_damage', 0.3, v_candidate, NOW()),
        (v_game_id, 'item_3032', 'ad', 50, v_candidate, NOW()),
        (v_game_id, 'item_3032', 'attack_speed', 0.4, v_candidate, NOW()),
        (v_game_id, 'item_3033', 'ad', 35, v_candidate, NOW()),
        (v_game_id, 'item_3033', 'armor_pen_percent', 0.3, v_candidate, NOW()),
        (v_game_id, 'item_3033', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_3036', 'ad', 35, v_candidate, NOW()),
        (v_game_id, 'item_3036', 'armor_pen_percent', 0.35, v_candidate, NOW()),
        (v_game_id, 'item_3036', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_3046', 'attack_speed', 0.65, v_candidate, NOW()),
        (v_game_id, 'item_3046', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_3046', 'ms_pct', 0.1, v_candidate, NOW()),
        (v_game_id, 'item_3071', 'ability_haste', 20, v_candidate, NOW()),
        (v_game_id, 'item_3071', 'ad', 40, v_candidate, NOW()),
        (v_game_id, 'item_3071', 'hp', 400, v_candidate, NOW()),
        (v_game_id, 'item_3072', 'ad', 80, v_candidate, NOW()),
        (v_game_id, 'item_3072', 'life_steal', 0.15, v_candidate, NOW()),
        (v_game_id, 'item_3073', 'ad', 40, v_candidate, NOW()),
        (v_game_id, 'item_3073', 'attack_speed', 0.2, v_candidate, NOW()),
        (v_game_id, 'item_3073', 'hp', 450, v_candidate, NOW()),
        (v_game_id, 'item_3074', 'ability_haste', 15, v_candidate, NOW()),
        (v_game_id, 'item_3074', 'ad', 65, v_candidate, NOW()),
        (v_game_id, 'item_3074', 'life_steal', 0.12, v_candidate, NOW()),
        (v_game_id, 'item_3078', 'ability_haste', 15, v_candidate, NOW()),
        (v_game_id, 'item_3078', 'ad', 36, v_candidate, NOW()),
        (v_game_id, 'item_3078', 'attack_speed', 0.3, v_candidate, NOW()),
        (v_game_id, 'item_3078', 'hp', 333, v_candidate, NOW()),
        (v_game_id, 'item_3085', 'attack_speed', 0.4, v_candidate, NOW()),
        (v_game_id, 'item_3085', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_3085', 'ms_pct', 0.04, v_candidate, NOW()),
        (v_game_id, 'item_3087', 'ad', 40, v_candidate, NOW()),
        (v_game_id, 'item_3087', 'ap', 45, v_candidate, NOW()),
        (v_game_id, 'item_3087', 'attack_speed', 0.3, v_candidate, NOW()),
        (v_game_id, 'item_3087', 'ms_pct', 0.04, v_candidate, NOW()),
        (v_game_id, 'item_3091', 'attack_speed', 0.5, v_candidate, NOW()),
        (v_game_id, 'item_3091', 'magic_resist', 45, v_candidate, NOW()),
        (v_game_id, 'item_3091', 'tenacity', 0.2, v_candidate, NOW()),
        (v_game_id, 'item_3094', 'attack_speed', 0.35, v_candidate, NOW()),
        (v_game_id, 'item_3094', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_3094', 'ms_pct', 0.04, v_candidate, NOW()),
        (v_game_id, 'item_3097', 'ad', 50, v_candidate, NOW()),
        (v_game_id, 'item_3097', 'attack_speed', 0.2, v_candidate, NOW()),
        (v_game_id, 'item_3097', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_3100', 'ability_haste', 10, v_candidate, NOW()),
        (v_game_id, 'item_3100', 'ap', 100, v_candidate, NOW()),
        (v_game_id, 'item_3100', 'ms_pct', 0.04, v_candidate, NOW()),
        (v_game_id, 'item_3115', 'ability_haste', 15, v_candidate, NOW()),
        (v_game_id, 'item_3115', 'ap', 80, v_candidate, NOW()),
        (v_game_id, 'item_3115', 'attack_speed', 0.5, v_candidate, NOW()),
        (v_game_id, 'item_3124', 'ad', 30, v_candidate, NOW()),
        (v_game_id, 'item_3124', 'ap', 30, v_candidate, NOW()),
        (v_game_id, 'item_3124', 'attack_speed', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_3139', 'ad', 50, v_candidate, NOW()),
        (v_game_id, 'item_3139', 'life_steal', 0.1, v_candidate, NOW()),
        (v_game_id, 'item_3139', 'magic_resist', 35, v_candidate, NOW()),
        (v_game_id, 'item_3142', 'ad', 55, v_candidate, NOW()),
        (v_game_id, 'item_3142', 'armor_pen_flat', 18, v_candidate, NOW()),
        (v_game_id, 'item_3142', 'ms_pct', 0.04, v_candidate, NOW()),
        (v_game_id, 'item_3146', 'ad', 40, v_candidate, NOW()),
        (v_game_id, 'item_3146', 'ap', 80, v_candidate, NOW()),
        (v_game_id, 'item_3146', 'omnivamp', 0.1, v_candidate, NOW()),
        (v_game_id, 'item_3153', 'ad', 40, v_candidate, NOW()),
        (v_game_id, 'item_3153', 'attack_speed', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_3153', 'life_steal', 0.1, v_candidate, NOW()),
        (v_game_id, 'item_3156', 'ability_haste', 15, v_candidate, NOW()),
        (v_game_id, 'item_3156', 'ad', 60, v_candidate, NOW()),
        (v_game_id, 'item_3156', 'magic_resist', 40, v_candidate, NOW()),
        (v_game_id, 'item_3161', 'ad', 45, v_candidate, NOW()),
        (v_game_id, 'item_3161', 'hp', 450, v_candidate, NOW()),
        (v_game_id, 'item_3179', 'ability_haste', 15, v_candidate, NOW()),
        (v_game_id, 'item_3179', 'ad', 60, v_candidate, NOW()),
        (v_game_id, 'item_3179', 'armor_pen_flat', 18, v_candidate, NOW()),
        (v_game_id, 'item_3181', 'ad', 40, v_candidate, NOW()),
        (v_game_id, 'item_3181', 'hp', 500, v_candidate, NOW()),
        (v_game_id, 'item_3181', 'ms_pct', 0.04, v_candidate, NOW()),
        (v_game_id, 'item_3302', 'ad', 30, v_candidate, NOW()),
        (v_game_id, 'item_3302', 'attack_speed', 0.35, v_candidate, NOW()),
        (v_game_id, 'item_3508', 'ability_haste', 20, v_candidate, NOW()),
        (v_game_id, 'item_3508', 'ad', 50, v_candidate, NOW()),
        (v_game_id, 'item_3508', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_3748', 'ad', 40, v_candidate, NOW()),
        (v_game_id, 'item_3748', 'hp', 600, v_candidate, NOW()),
        (v_game_id, 'item_3814', 'ad', 50, v_candidate, NOW()),
        (v_game_id, 'item_3814', 'armor_pen_flat', 15, v_candidate, NOW()),
        (v_game_id, 'item_3814', 'hp', 250, v_candidate, NOW()),
        (v_game_id, 'item_6333', 'ability_haste', 15, v_candidate, NOW()),
        (v_game_id, 'item_6333', 'ad', 60, v_candidate, NOW()),
        (v_game_id, 'item_6333', 'armor', 50, v_candidate, NOW()),
        (v_game_id, 'item_6609', 'ability_haste', 15, v_candidate, NOW()),
        (v_game_id, 'item_6609', 'ad', 45, v_candidate, NOW()),
        (v_game_id, 'item_6609', 'hp', 450, v_candidate, NOW()),
        (v_game_id, 'item_6610', 'ability_haste', 10, v_candidate, NOW()),
        (v_game_id, 'item_6610', 'ad', 45, v_candidate, NOW()),
        (v_game_id, 'item_6610', 'hp', 400, v_candidate, NOW()),
        (v_game_id, 'item_6631', 'ad', 40, v_candidate, NOW()),
        (v_game_id, 'item_6631', 'attack_speed', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_6631', 'hp', 450, v_candidate, NOW()),
        (v_game_id, 'item_6672', 'ad', 45, v_candidate, NOW()),
        (v_game_id, 'item_6672', 'attack_speed', 0.4, v_candidate, NOW()),
        (v_game_id, 'item_6672', 'ms_pct', 0.04, v_candidate, NOW()),
        (v_game_id, 'item_6673', 'ad', 55, v_candidate, NOW()),
        (v_game_id, 'item_6673', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_6675', 'attack_speed', 0.4, v_candidate, NOW()),
        (v_game_id, 'item_6675', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_6675', 'ms_pct', 0.04, v_candidate, NOW()),
        (v_game_id, 'item_6676', 'ad', 50, v_candidate, NOW()),
        (v_game_id, 'item_6676', 'armor_pen_flat', 10, v_candidate, NOW()),
        (v_game_id, 'item_6676', 'crit_chance', 0.25, v_candidate, NOW()),
        (v_game_id, 'item_6692', 'ability_haste', 15, v_candidate, NOW()),
        (v_game_id, 'item_6692', 'ad', 60, v_candidate, NOW()),
        (v_game_id, 'item_6694', 'ability_haste', 15, v_candidate, NOW()),
        (v_game_id, 'item_6694', 'ad', 45, v_candidate, NOW()),
        (v_game_id, 'item_6694', 'armor_pen_percent', 0.35, v_candidate, NOW()),
        (v_game_id, 'item_6695', 'ad', 55, v_candidate, NOW()),
        (v_game_id, 'item_6695', 'armor_pen_flat', 15, v_candidate, NOW()),
        (v_game_id, 'item_6696', 'ability_haste', 20, v_candidate, NOW()),
        (v_game_id, 'item_6696', 'ad', 55, v_candidate, NOW()),
        (v_game_id, 'item_6696', 'armor_pen_flat', 18, v_candidate, NOW()),
        (v_game_id, 'item_6697', 'ability_haste', 10, v_candidate, NOW()),
        (v_game_id, 'item_6697', 'ad', 55, v_candidate, NOW()),
        (v_game_id, 'item_6697', 'armor_pen_flat', 18, v_candidate, NOW()),
        (v_game_id, 'item_6698', 'ability_haste', 10, v_candidate, NOW()),
        (v_game_id, 'item_6698', 'ad', 55, v_candidate, NOW()),
        (v_game_id, 'item_6698', 'armor_pen_flat', 18, v_candidate, NOW()),
        (v_game_id, 'item_6699', 'ability_haste', 10, v_candidate, NOW()),
        (v_game_id, 'item_6699', 'ad', 55, v_candidate, NOW()),
        (v_game_id, 'item_6699', 'armor_pen_flat', 10, v_candidate, NOW())
    ON CONFLICT (game_id, entity_id, attr_key) DO UPDATE SET
        base_value = EXCLUDED.base_value,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.entity_attribute_values.base_value IS DISTINCT FROM EXCLUDED.base_value;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- 精确 cleanup：卸下 legacy Batch-C equipment 关系（仅 53 个源数字 item id）
    DELETE FROM public.type_relations
     WHERE game_id = v_game_id
       AND type_id = 62002
       AND target_category = 'equipment'
       AND target_id IN (
           '2501', '2510', '2512', '2517', '2520', '2523', '3004', '3026',
           '3031', '3032', '3033', '3036', '3046', '3071', '3072', '3073',
           '3074', '3078', '3085', '3087', '3091', '3094', '3097', '3100',
           '3115', '3124', '3139', '3142', '3146', '3153', '3156', '3161',
           '3179', '3181', '3302', '3508', '3748', '3814', '6333', '6609',
           '6610', '6631', '6672', '6673', '6675', '6676', '6692', '6694',
           '6695', '6696', '6697', '6698', '6699'
       );
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
        v_changed := true;
    END IF;

    -- type_relations：tag/adc_completed_item → entity/item_N（53）
    INSERT INTO public.type_relations (
        game_id, type_id, target_category, target_id, extend, change_revision, updated_at
    ) VALUES
        (v_game_id, 62002, 'entity', 'item_2501', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"2501","sourceTags":["Health","Damage"],"goldCost":3300,"iconUrl":"item_2501","statKeys":["ad","hp"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_2510', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"2510","sourceTags":["Health","AttackSpeed","SpellDamage","OnHit","AbilityHaste"],"goldCost":3100,"iconUrl":"item_2510","statKeys":["ability_haste","ap","attack_speed","hp"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_2512', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"2512","sourceTags":["CriticalStrike","AttackSpeed","NonbootsMovement","AbilityHaste"],"goldCost":2650,"iconUrl":"item_2512","statKeys":["attack_speed","crit_chance","ms_pct"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_2517', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"2517","sourceTags":["Damage","LifeSteal","SpellVamp","Tenacity","AbilityHaste"],"goldCost":3100,"iconUrl":"item_2517","statKeys":["ad","omnivamp","tenacity"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_2520', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"2520","sourceTags":["Damage","ArmorPenetration","AbilityHaste"],"goldCost":3200,"iconUrl":"item_2520","statKeys":["ability_haste","ad","armor_pen_flat"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_2523', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"2523","sourceTags":["Damage","CriticalStrike"],"goldCost":2800,"iconUrl":"item_2523","statKeys":["ad","crit_chance"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3004', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3004","sourceTags":["Damage","Mana","CooldownReduction","OnHit","AbilityHaste"],"goldCost":2900,"iconUrl":"item_3004","statKeys":["ability_haste","ad","mana"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3026', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3026","sourceTags":["Armor","Damage"],"goldCost":3200,"iconUrl":"item_3026","statKeys":["ad","armor"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3031', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3031","sourceTags":["CriticalStrike","Damage"],"goldCost":3500,"iconUrl":"item_3031","statKeys":["ad","crit_chance","crit_damage"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3032', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3032","sourceTags":["Damage","CriticalStrike","AttackSpeed"],"goldCost":3100,"iconUrl":"item_3032","statKeys":["ad","attack_speed"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3033', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3033","sourceTags":["Damage","CriticalStrike","ArmorPenetration"],"goldCost":3000,"iconUrl":"item_3033","statKeys":["ad","armor_pen_percent","crit_chance"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3036', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3036","sourceTags":["Damage","CriticalStrike","ArmorPenetration"],"goldCost":3300,"iconUrl":"item_3036","statKeys":["ad","armor_pen_percent","crit_chance"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3046', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3046","sourceTags":["CriticalStrike","AttackSpeed","NonbootsMovement"],"goldCost":2650,"iconUrl":"item_3046","statKeys":["attack_speed","crit_chance","ms_pct"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3071', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3071","sourceTags":["Health","Damage","CooldownReduction","OnHit","NonbootsMovement","ArmorPenetration","AbilityHaste"],"goldCost":3000,"iconUrl":"item_3071","statKeys":["ability_haste","ad","hp"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3072', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3072","sourceTags":["Damage","LifeSteal"],"goldCost":3400,"iconUrl":"item_3072","statKeys":["ad","life_steal"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3073', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3073","sourceTags":["Health","Damage","AttackSpeed","CooldownReduction","NonbootsMovement","AbilityHaste"],"goldCost":3000,"iconUrl":"item_3073","statKeys":["ad","attack_speed","hp"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3074', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3074","sourceTags":["Damage","LifeSteal","CooldownReduction","OnHit","AbilityHaste"],"goldCost":3300,"iconUrl":"item_3074","statKeys":["ability_haste","ad","life_steal"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3078', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3078","sourceTags":["Health","Damage","AttackSpeed","CooldownReduction","OnHit","NonbootsMovement","AbilityHaste"],"goldCost":3333,"iconUrl":"item_3078","statKeys":["ability_haste","ad","attack_speed","hp"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3085', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3085","sourceTags":["CriticalStrike","AttackSpeed","OnHit","NonbootsMovement"],"goldCost":2650,"iconUrl":"item_3085","statKeys":["attack_speed","crit_chance","ms_pct"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3087', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3087","sourceTags":["Damage","AttackSpeed","SpellDamage","OnHit","NonbootsMovement"],"goldCost":3000,"iconUrl":"item_3087","statKeys":["ad","ap","attack_speed","ms_pct"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3091', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3091","sourceTags":["SpellBlock","AttackSpeed","OnHit","Tenacity"],"goldCost":2800,"iconUrl":"item_3091","statKeys":["attack_speed","magic_resist","tenacity"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3094', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3094","sourceTags":["CriticalStrike","AttackSpeed","NonbootsMovement"],"goldCost":2650,"iconUrl":"item_3094","statKeys":["attack_speed","crit_chance","ms_pct"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3097', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3097","sourceTags":["Damage","CriticalStrike","AttackSpeed","NonbootsMovement"],"goldCost":3200,"iconUrl":"item_3097","statKeys":["ad","attack_speed","crit_chance"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3100', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3100","sourceTags":["SpellDamage","OnHit","NonbootsMovement","AbilityHaste"],"goldCost":2900,"iconUrl":"item_3100","statKeys":["ability_haste","ap","ms_pct"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3115', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3115","sourceTags":["AttackSpeed","SpellDamage","OnHit","AbilityHaste"],"goldCost":2900,"iconUrl":"item_3115","statKeys":["ability_haste","ap","attack_speed"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3124', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3124","sourceTags":["Damage","AttackSpeed","SpellDamage","OnHit"],"goldCost":3000,"iconUrl":"item_3124","statKeys":["ad","ap","attack_speed"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3139', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3139","sourceTags":["SpellBlock","Damage","LifeSteal","Active","NonbootsMovement","Tenacity"],"goldCost":3200,"iconUrl":"item_3139","statKeys":["ad","life_steal","magic_resist"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3142', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3142","sourceTags":["Damage","Active","NonbootsMovement","ArmorPenetration"],"goldCost":2800,"iconUrl":"item_3142","statKeys":["ad","armor_pen_flat","ms_pct"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3146', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3146","sourceTags":["Damage","LifeSteal","SpellDamage","Active","SpellVamp"],"goldCost":3000,"iconUrl":"item_3146","statKeys":["ad","ap","omnivamp"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3153', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3153","sourceTags":["Damage","AttackSpeed","LifeSteal","Slow","OnHit"],"goldCost":3200,"iconUrl":"item_3153","statKeys":["ad","attack_speed","life_steal"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3156', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3156","sourceTags":["SpellBlock","Damage","LifeSteal","SpellVamp","AbilityHaste"],"goldCost":3100,"iconUrl":"item_3156","statKeys":["ability_haste","ad","magic_resist"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3161', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3161","sourceTags":["Health","Damage","AbilityHaste"],"goldCost":3100,"iconUrl":"item_3161","statKeys":["ad","hp"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3179', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3179","sourceTags":["Damage","Vision","CooldownReduction","ArmorPenetration","AbilityHaste"],"goldCost":2800,"iconUrl":"item_3179","statKeys":["ability_haste","ad","armor_pen_flat"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3181', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3181","sourceTags":["Health","Damage","NonbootsMovement"],"goldCost":3000,"iconUrl":"item_3181","statKeys":["ad","hp","ms_pct"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3302', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3302","sourceTags":["Damage","AttackSpeed","OnHit","MagicPenetration","ArmorPenetration"],"goldCost":3000,"iconUrl":"item_3302","statKeys":["ad","attack_speed"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3508', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3508","sourceTags":["Damage","CriticalStrike","ManaRegen","CooldownReduction","OnHit","AbilityHaste"],"goldCost":3050,"iconUrl":"item_3508","statKeys":["ability_haste","ad","crit_chance"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3748', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3748","sourceTags":["Health","HealthRegen","Damage","OnHit"],"goldCost":3300,"iconUrl":"item_3748","statKeys":["ad","hp"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_3814', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"3814","sourceTags":["Health","Damage","ArmorPenetration"],"goldCost":3000,"iconUrl":"item_3814","statKeys":["ad","armor_pen_flat","hp"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6333', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6333","sourceTags":["Armor","Damage","AbilityHaste"],"goldCost":3300,"iconUrl":"item_6333","statKeys":["ability_haste","ad","armor"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6609', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6609","sourceTags":["Health","Damage","CooldownReduction","AbilityHaste"],"goldCost":3000,"iconUrl":"item_6609","statKeys":["ability_haste","ad","hp"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6610', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6610","sourceTags":["Health","Damage","CooldownReduction","AbilityHaste"],"goldCost":3100,"iconUrl":"item_6610","statKeys":["ability_haste","ad","hp"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6631', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6631","sourceTags":["Health","Damage","AttackSpeed","Slow"],"goldCost":3300,"iconUrl":"item_6631","statKeys":["ad","attack_speed","hp"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6672', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6672","sourceTags":["Damage","AttackSpeed","OnHit","NonbootsMovement"],"goldCost":3000,"iconUrl":"item_6672","statKeys":["ad","attack_speed","ms_pct"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6673', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6673","sourceTags":["Damage","CriticalStrike"],"goldCost":3000,"iconUrl":"item_6673","statKeys":["ad","crit_chance"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6675', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6675","sourceTags":["CriticalStrike","AttackSpeed","NonbootsMovement"],"goldCost":2650,"iconUrl":"item_6675","statKeys":["attack_speed","crit_chance","ms_pct"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6676', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6676","sourceTags":["Damage","CriticalStrike","ArmorPenetration"],"goldCost":3000,"iconUrl":"item_6676","statKeys":["ad","armor_pen_flat","crit_chance"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6692', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6692","sourceTags":["Damage","CooldownReduction","AbilityHaste"],"goldCost":2900,"iconUrl":"item_6692","statKeys":["ability_haste","ad"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6694', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6694","sourceTags":["Damage","CooldownReduction","ArmorPenetration","AbilityHaste"],"goldCost":3000,"iconUrl":"item_6694","statKeys":["ability_haste","ad","armor_pen_percent"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6695', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6695","sourceTags":["Damage","ArmorPenetration"],"goldCost":2500,"iconUrl":"item_6695","statKeys":["ad","armor_pen_flat"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6696', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6696","sourceTags":["Damage","ArmorPenetration","AbilityHaste"],"goldCost":2750,"iconUrl":"item_6696","statKeys":["ability_haste","ad","armor_pen_flat"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6697', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6697","sourceTags":["Damage","Active","CooldownReduction","ArmorPenetration","AbilityHaste"],"goldCost":2800,"iconUrl":"item_6697","statKeys":["ability_haste","ad","armor_pen_flat"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6698', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6698","sourceTags":["Damage","Active","CooldownReduction","ArmorPenetration","AbilityHaste"],"goldCost":2850,"iconUrl":"item_6698","statKeys":["ability_haste","ad","armor_pen_flat"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW()),
        (v_game_id, 62002, 'entity', 'item_6699', '{"batch":"V2-Batch-C","role":"adc_completed_item","source":"数据参考/item.json","sourceVersion":"16.9.1","sourceItemId":"6699","sourceTags":["Damage","Active","CooldownReduction","ArmorPenetration","AbilityHaste"],"goldCost":2900,"iconUrl":"item_6699","statKeys":["ability_haste","ad","armor_pen_flat"],"selectionRule":"sr_purchasable_completed_non_boot_normal_id_with_dps_relevant_direct_stats"}'::jsonb, v_candidate, NOW())
    ON CONFLICT (game_id, type_id, target_category, target_id) DO UPDATE SET
        extend = EXCLUDED.extend,
        change_revision = EXCLUDED.change_revision,
        updated_at = NOW()
    WHERE public.type_relations.extend IS DISTINCT FROM EXCLUDED.extend
       OR public.type_relations.change_revision > v_locked_current;
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
