-- =============================================================================
-- League of Legends Crowd Control Status Seed (Template)
-- =============================================================================
--
-- 来源：
-- - wasm/Types of Crowd Control _ League of Legends Wiki.mhtml
-- - wasm/概要设计-控制与打断状态机制.md
--
-- 说明：
-- 1. 这里只整理“具体状态”，不包含 Summary / Notes / Forced action / Kinematics 这类分组标题。
-- 2. `start_version_id` / `end_version_id` / `base_type_id` 先用占位值，执行前请改成你自己的值。
-- 3. `name` 这里优先保留英文规范 key，`description` 放中文说明，方便后续继续做 type_relations。
-- 4. 这份模板按 wiki 目录项整理；像 Fear/Flee、Snare/Root 这类合并标题，先保留为合并 key。

WITH seed_params AS (
    SELECT
        'lol'::varchar(64) AS game_id,
        0::bigint AS start_version_id,  -- TODO: 替换为有效 version_id
        0::bigint AS end_version_id,    -- TODO: 替换为有效 version_id
        50000::int AS base_type_id      -- TODO: 替换为你的状态 type 起始 ID
),
status_seed AS (
    SELECT *
    FROM (
        VALUES
            (1,  'airborne',    '击飞/击退/拉拽等浮空位移控制（Airborne）'),
            (2,  'blind',       '致盲；普攻可发起但会 miss'),
            (3,  'cripple',     '致残；削弱移速和部分机动能力'),
            (4,  'disarm',      '缴械；无法进行普攻'),
            (5,  'disrupt',     '打断；瞬时终止施法或引导'),
            (6,  'berserk',     '狂暴；被迫攻击最近单位'),
            (7,  'charm',       '魅惑；被迫走向来源'),
            (8,  'fear_flee',   '恐惧/逃跑；被迫远离来源'),
            (9,  'taunt',       '嘲讽；被迫尝试对来源进行普攻'),
            (10, 'ground',      '缚地；禁止位移类技能'),
            (11, 'knockdown',   '击落；终止部分位移并阻止继续位移'),
            (12, 'nearsight',   '致盲视野/近视；大幅限制可视范围'),
            (13, 'silence',     '沉默；无法施放技能'),
            (14, 'polymorph',   '变形；通常伴随沉默与缴械'),
            (15, 'drowsy',      '昏昏欲睡；后续会转入睡眠'),
            (16, 'sleep',       '睡眠；受伤通常会提前解除'),
            (17, 'slow',        '减速；降低移动速度'),
            (18, 'snare_root',  '禁锢/定身；无法移动但通常仍可施法'),
            (19, 'stasis',      '凝滞/金身；无法行动、不可选取且免伤'),
            (20, 'stun',        '眩晕；无法行动'),
            (21, 'suspension',  '悬空；兼具浮空与眩晕语义'),
            (22, 'suppression', '压制；最强硬控之一，通常不吃韧性')
    ) AS t(seq, name, description)
)
INSERT INTO public.types (
    game_id,
    type_id,
    start_version_id,
    end_version_id,
    name,
    description,
    reserved_type_id,
    updated_at
)
SELECT
    p.game_id,
    p.base_type_id + s.seq,
    p.start_version_id,
    p.end_version_id,
    s.name,
    s.description,
    NULL,
    NOW()
FROM seed_params p
CROSS JOIN status_seed s
ORDER BY s.seq;
