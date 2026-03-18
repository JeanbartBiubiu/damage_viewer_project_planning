-- =============================================================================
-- League of Legends Status Action Control Rules Seed (Template)
-- =============================================================================
--
-- 依赖：
-- 1. `db/game_manage/lol_status_types_seed.sql` 中的状态 type 已插入。
-- 2. 下列动作/阶段/标签 type 已存在于 public.types.name：
--    - action: basic_attack / cast_skill / cast_item / move
--    - exec_phase: cast / channel / basic_attack_windup / dash
--    - skill_tag: dash / blink
--
-- 说明：
-- 1. 本文件只写得进 `status_action_control_rules` 这张极简表能表达的内容：
--    - forbid：禁止发起动作
--    - interrupt：终止执行中的动作
-- 2. 下列 LoL 状态不适合放进这张表，因此未生成规则：
--    - blind：更像“普攻可执行但 miss”
--    - cripple：更像属性削弱
--    - drowsy：更像过渡状态
--    - slow：更像属性削弱
--    - nearsight：更像视野限制
-- 3. `berserk / charm / fear_flee / taunt` 这类强制行为状态，
--    这里只保留“不能自由执行哪些动作”和“会打断什么”，
--    不表达“被迫做什么”。

WITH seed_params AS (
    SELECT
        'lol'::varchar(64) AS game_id,
        0::bigint AS start_version_id,  -- TODO: 替换为有效 version_id
        0::bigint AS end_version_id     -- TODO: 替换为有效 version_id
),
rule_seed AS (
    SELECT *
    FROM (
        VALUES
            ('airborne_forbid',      'airborne',    'forbid',    ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],               ARRAY[]::text[],                                  100, '击飞期间无法自由行动'),
            ('airborne_interrupt',   'airborne',    'interrupt', ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],               ARRAY['cast','channel','basic_attack_windup','dash']::text[], 100, '击飞会打断施法、引导、普攻前摇和位移'),

            ('disarm_forbid',        'disarm',      'forbid',    ARRAY['basic_attack']::text[],                              ARRAY[]::text[],               ARRAY[]::text[],                                  80,  '缴械期间无法普攻'),
            ('disarm_interrupt',     'disarm',      'interrupt', ARRAY['basic_attack']::text[],                              ARRAY[]::text[],               ARRAY['basic_attack_windup']::text[],              80,  '缴械会终止普攻前摇'),

            ('disrupt_interrupt',    'disrupt',     'interrupt', ARRAY['cast_skill','cast_item']::text[],                    ARRAY[]::text[],               ARRAY['cast','channel']::text[],                   90,  '打断会瞬时终止施法或引导'),

            ('berserk_forbid',       'berserk',     'forbid',    ARRAY['cast_skill','cast_item','move']::text[],             ARRAY[]::text[],               ARRAY[]::text[],                                  70,  '狂暴期间不能自由施法、使用物品或移动'),
            ('berserk_interrupt',    'berserk',     'interrupt', ARRAY['cast_skill','cast_item']::text[],                    ARRAY[]::text[],               ARRAY['cast','channel']::text[],                   70,  '狂暴会打断施法与引导'),

            ('charm_forbid',         'charm',       'forbid',    ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY[]::text[],                                  85,  '魅惑期间不能自由行动'),
            ('charm_interrupt',      'charm',       'interrupt', ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY['cast','channel','basic_attack_windup']::text[], 85, '魅惑会打断施法、引导和普攻前摇'),

            ('fear_flee_forbid',     'fear_flee',   'forbid',    ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY[]::text[],                                  85,  '恐惧期间不能自由行动'),
            ('fear_flee_interrupt',  'fear_flee',   'interrupt', ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY['cast','channel','basic_attack_windup']::text[], 85, '恐惧会打断施法、引导和普攻前摇'),

            ('taunt_forbid',         'taunt',       'forbid',    ARRAY['cast_skill','cast_item','move']::text[],             ARRAY[]::text[],               ARRAY[]::text[],                                  85,  '嘲讽期间不能自由施法、用物品或移动'),
            ('taunt_interrupt',      'taunt',       'interrupt', ARRAY['cast_skill','cast_item']::text[],                    ARRAY[]::text[],               ARRAY['cast','channel']::text[],                   85,  '嘲讽会打断施法与引导'),

            ('ground_forbid',        'ground',      'forbid',    ARRAY['cast_skill']::text[],                                ARRAY['dash','blink']::text[], ARRAY[]::text[],                                  60,  '缚地禁止位移类技能'),
            ('ground_interrupt',     'ground',      'interrupt', ARRAY['cast_skill']::text[],                                ARRAY['dash']::text[],         ARRAY['dash']::text[],                             60,  '缚地会中止正在进行中的冲刺位移'),

            ('knockdown_interrupt',  'knockdown',   'interrupt', ARRAY['cast_skill']::text[],                                ARRAY['dash']::text[],         ARRAY['dash']::text[],                             75,  '击落会中止冲刺位移'),

            ('silence_forbid',       'silence',     'forbid',    ARRAY['cast_skill','cast_item']::text[],                    ARRAY[]::text[],               ARRAY[]::text[],                                  80,  '沉默期间无法施法或使用主动物品'),
            ('silence_interrupt',    'silence',     'interrupt', ARRAY['cast_skill','cast_item']::text[],                    ARRAY[]::text[],               ARRAY['cast','channel']::text[],                   80,  '沉默会打断施法与引导'),

            ('polymorph_forbid',     'polymorph',   'forbid',    ARRAY['basic_attack','cast_skill','cast_item']::text[],     ARRAY[]::text[],               ARRAY[]::text[],                                  90,  '变形期间无法普攻、施法和使用主动物品'),
            ('polymorph_interrupt',  'polymorph',   'interrupt', ARRAY['basic_attack','cast_skill','cast_item']::text[],     ARRAY[]::text[],               ARRAY['cast','channel','basic_attack_windup']::text[], 90, '变形会打断施法、引导和普攻前摇'),

            ('sleep_forbid',         'sleep',       'forbid',    ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY[]::text[],                                  90,  '睡眠期间无法自由行动'),
            ('sleep_interrupt',      'sleep',       'interrupt', ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY['cast','channel','basic_attack_windup','dash']::text[], 90, '睡眠会打断施法、引导、普攻前摇和位移'),

            ('snare_root_forbid',    'snare_root',  'forbid',    ARRAY['move']::text[],                                      ARRAY[]::text[],               ARRAY[]::text[],                                  70,  '定身期间无法移动'),

            ('stasis_forbid',        'stasis',      'forbid',    ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY[]::text[],                                  95,  '凝滞期间无法行动'),
            ('stasis_interrupt',     'stasis',      'interrupt', ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY['cast','channel','basic_attack_windup','dash']::text[], 95, '凝滞会终止当前动作'),

            ('stun_forbid',          'stun',        'forbid',    ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY[]::text[],                                  100, '眩晕期间无法行动'),
            ('stun_interrupt',       'stun',        'interrupt', ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY['cast','channel','basic_attack_windup','dash']::text[], 100, '眩晕会终止当前动作'),

            ('suspension_forbid',    'suspension',  'forbid',    ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY[]::text[],                                  100, '悬空期间无法行动'),
            ('suspension_interrupt', 'suspension',  'interrupt', ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY['cast','channel','basic_attack_windup','dash']::text[], 100, '悬空会终止当前动作'),

            ('suppression_forbid',   'suppression', 'forbid',    ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY[]::text[],                                  110, '压制期间无法行动'),
            ('suppression_interrupt','suppression', 'interrupt', ARRAY['basic_attack','cast_skill','cast_item','move']::text[], ARRAY[]::text[],             ARRAY['cast','channel','basic_attack_windup','dash']::text[], 110, '压制会终止当前动作')
    ) AS t(rule_id, status_name, rule_kind, action_names, action_match_names, phase_names, priority, description)
)
INSERT INTO public.status_action_control_rules (
    game_id,
    rule_id,
    start_version_id,
    end_version_id,
    status_type_id,
    rule_kind,
    action_type_ids,
    action_match_type_ids,
    interrupt_phase_type_ids,
    priority,
    description,
    extend,
    updated_at
)
SELECT
    p.game_id,
    r.rule_id,
    p.start_version_id,
    p.end_version_id,
    (
        SELECT t.type_id
        FROM public.types t
        WHERE t.game_id = p.game_id
          AND t.name = r.status_name
        LIMIT 1
    ) AS status_type_id,
    r.rule_kind,
    COALESCE((
        SELECT array_agg(t.type_id ORDER BY u.ord)
        FROM unnest(r.action_names) WITH ORDINALITY AS u(name, ord)
        JOIN public.types t
          ON t.game_id = p.game_id
         AND t.name = u.name
    ), '{}'::int[]) AS action_type_ids,
    COALESCE((
        SELECT array_agg(t.type_id ORDER BY u.ord)
        FROM unnest(r.action_match_names) WITH ORDINALITY AS u(name, ord)
        JOIN public.types t
          ON t.game_id = p.game_id
         AND t.name = u.name
    ), '{}'::int[]) AS action_match_type_ids,
    COALESCE((
        SELECT array_agg(t.type_id ORDER BY u.ord)
        FROM unnest(r.phase_names) WITH ORDINALITY AS u(name, ord)
        JOIN public.types t
          ON t.game_id = p.game_id
         AND t.name = u.name
    ), '{}'::int[]) AS interrupt_phase_type_ids,
    r.priority,
    r.description,
    '{}'::jsonb,
    NOW()
FROM seed_params p
CROSS JOIN rule_seed r
ORDER BY r.rule_id;
