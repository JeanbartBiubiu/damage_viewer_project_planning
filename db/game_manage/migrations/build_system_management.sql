-- 构筑系统破坏式迁移。
-- 调用方必须先开启事务并在核对通过后自行提交。本脚本不 BEGIN、不 COMMIT、不 ROLLBACK，也不连接数据库。
-- 23 个位置键是一次性显式对照，按下表原分组键、原下标、位置名称和类别核对；不从中文名称、数组下标或排序计算。
-- 五个符文系的相同选择含义共用 keystone、minor_1、minor_2、minor_3。
-- 碎片组三个位置分别对应已保存名称：进攻=offense，灵活=flex，防御=defense。
-- 槽位容量写为 0 到 1，使同一分组日后可作为主系或副系使用不同位置规则。不写入尚未冻结的主副系数量。
-- 选择规则保持空对象。不双写旧表。

DO $$
BEGIN
    IF to_regclass('public.runes') IS NULL
        OR to_regclass('public.rune_paths') IS NULL
        OR to_regclass('public.rune_skill_relations') IS NULL
        OR to_regclass('public.image_relations') IS NULL THEN
        RAISE EXCEPTION 'rune source tables are missing';
    END IF;
    IF to_regclass('public.build_systems') IS NOT NULL
        OR to_regclass('public.build_options') IS NOT NULL
        OR to_regclass('public.build_groups') IS NOT NULL
        OR to_regclass('public.build_option_skill_relations') IS NOT NULL THEN
        RAISE EXCEPTION 'build tables already exist';
    END IF;
END $$;

LOCK TABLE public.games, public.skills, public.runes, public.rune_paths, public.rune_skill_relations, public.image_relations
    IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE build_slot_key_map (
    path_key text NOT NULL,
    source_index integer NOT NULL,
    slot_name text NOT NULL,
    category text NOT NULL,
    slot_key text NOT NULL,
    PRIMARY KEY (path_key, source_index)
) ON COMMIT DROP;

INSERT INTO build_slot_key_map (path_key, source_index, slot_name, category, slot_key) VALUES
    ('rune_path_8100', 0, '基石', 'KEYSTONE', 'keystone'),
    ('rune_path_8100', 1, '预谋', 'MINOR', 'minor_1'),
    ('rune_path_8100', 2, '追踪', 'MINOR', 'minor_2'),
    ('rune_path_8100', 3, '狩猎', 'MINOR', 'minor_3'),
    ('rune_path_8300', 0, '基石', 'KEYSTONE', 'keystone'),
    ('rune_path_8300', 1, '巧具', 'MINOR', 'minor_1'),
    ('rune_path_8300', 2, '未来', 'MINOR', 'minor_2'),
    ('rune_path_8300', 3, '超越', 'MINOR', 'minor_3'),
    ('rune_path_8000', 0, '基石', 'KEYSTONE', 'keystone'),
    ('rune_path_8000', 1, '英武', 'MINOR', 'minor_1'),
    ('rune_path_8000', 2, '传说', 'MINOR', 'minor_2'),
    ('rune_path_8000', 3, '战斗', 'MINOR', 'minor_3'),
    ('rune_path_8400', 0, '基石', 'KEYSTONE', 'keystone'),
    ('rune_path_8400', 1, '蛮力', 'MINOR', 'minor_1'),
    ('rune_path_8400', 2, '抵抗', 'MINOR', 'minor_2'),
    ('rune_path_8400', 3, '生机', 'MINOR', 'minor_3'),
    ('rune_path_8200', 0, '基石', 'KEYSTONE', 'keystone'),
    ('rune_path_8200', 1, '宝物', 'MINOR', 'minor_1'),
    ('rune_path_8200', 2, '卓越', 'MINOR', 'minor_2'),
    ('rune_path_8200', 3, '威能', 'MINOR', 'minor_3'),
    ('rune_shards', 0, '进攻', 'SHARD', 'offense'),
    ('rune_shards', 1, '灵活', 'SHARD', 'flex'),
    ('rune_shards', 2, '防御', 'SHARD', 'defense');

CREATE TEMP TABLE build_migration_games ON COMMIT DROP AS
SELECT DISTINCT game_id
FROM (
    SELECT game_id FROM public.runes
    UNION
    SELECT game_id FROM public.rune_paths
    UNION
    SELECT game_id FROM public.rune_skill_relations
    UNION
    SELECT game_id FROM public.image_relations WHERE source_type IN ('RUNE', 'RUNE_PATH')
) sources;

CREATE TEMP TABLE build_slot_actual ON COMMIT DROP AS
SELECT p.game_id,
       p.path_key,
       (elem.ordinality - 1)::integer AS source_index,
       elem.slot->>'name' AS slot_name,
       elem.slot->>'category' AS category,
       elem.slot->'runeKeys' AS option_keys
FROM public.rune_paths p
CROSS JOIN LATERAL jsonb_array_elements(p.slots) WITH ORDINALITY AS elem(slot, ordinality);

CREATE TEMP TABLE build_image_expected ON COMMIT DROP AS
SELECT game_id,
       CASE source_type WHEN 'RUNE' THEN 'BUILD_OPTION' ELSE 'BUILD_GROUP' END AS source_type,
       'runes'::text AS source_parent_key,
       source_key,
       image_key
FROM public.image_relations
WHERE source_type IN ('RUNE', 'RUNE_PATH');

CREATE TEMP TABLE build_image_kept ON COMMIT DROP AS
SELECT game_id, source_type, source_parent_key, source_key, image_key
FROM public.image_relations
WHERE source_type NOT IN ('RUNE', 'RUNE_PATH');

DO $$
DECLARE
    mismatch text;
BEGIN
    IF (SELECT count(*) FROM build_slot_key_map) <> 23 THEN
        RAISE EXCEPTION 'explicit slot map must contain 23 rows';
    END IF;
    IF EXISTS (
        SELECT 1 FROM build_slot_key_map
        GROUP BY path_key, slot_key
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'explicit slot map repeats a slot key inside one group';
    END IF;
    IF (SELECT count(*) FROM build_migration_games) = 0 THEN
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.image_relations
        WHERE source_type IN ('RUNE', 'RUNE_PATH') AND source_parent_key <> ''
    ) THEN
        RAISE EXCEPTION 'rune image parent key is not empty';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.image_relations r
        WHERE r.source_type = 'RUNE'
          AND NOT EXISTS (
              SELECT 1 FROM public.runes u
              WHERE u.game_id = r.game_id AND u.rune_key = r.source_key
          )
    ) OR EXISTS (
        SELECT 1 FROM public.image_relations r
        WHERE r.source_type = 'RUNE_PATH'
          AND NOT EXISTS (
              SELECT 1 FROM public.rune_paths p
              WHERE p.game_id = r.game_id AND p.path_key = r.source_key
          )
    ) THEN
        RAISE EXCEPTION 'dangling rune image relation';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.rune_skill_relations r
        LEFT JOIN public.skills s ON s.game_id = r.game_id AND s.skill_key = r.skill_key
        WHERE s.skill_key IS NULL OR s.max_level < 1
    ) THEN
        RAISE EXCEPTION 'rune skill grant cannot keep fixed skill level 1';
    END IF;
    IF EXISTS (
        SELECT 1 FROM build_slot_actual WHERE jsonb_typeof(option_keys) IS DISTINCT FROM 'array'
    ) THEN
        RAISE EXCEPTION 'stored rune slot options are not an array';
    END IF;

    SELECT string_agg(item, ', ' ORDER BY item) INTO mismatch
    FROM (
        SELECT format('%s/%s[%s]/%s', a.game_id, a.path_key, a.source_index, coalesce(a.slot_name, '')) AS item
        FROM build_slot_actual a
        LEFT JOIN build_slot_key_map m
          ON m.path_key = a.path_key
         AND m.source_index = a.source_index
         AND m.slot_name = a.slot_name
         AND m.category = a.category
        WHERE m.slot_key IS NULL
        UNION ALL
        SELECT format('%s/%s[%s]/%s missing', g.game_id, m.path_key, m.source_index, m.slot_name) AS item
        FROM build_migration_games g
        CROSS JOIN build_slot_key_map m
        LEFT JOIN build_slot_actual a
          ON a.game_id = g.game_id
         AND a.path_key = m.path_key
         AND a.source_index = m.source_index
         AND a.slot_name = m.slot_name
         AND a.category = m.category
        WHERE a.path_key IS NULL
    ) bad;
    IF mismatch IS NOT NULL THEN
        RAISE EXCEPTION 'rune slot map mismatch: %', mismatch;
    END IF;
END $$;

CREATE TABLE public.build_systems (
    game_id varchar(64) NOT NULL,
    system_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    configuration_mode varchar(16) NOT NULL,
    sort_order integer NOT NULL,
    selection_rules jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_build_systems PRIMARY KEY (game_id, system_key),
    CONSTRAINT fk_build_systems_game FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_build_systems_key CHECK (system_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_build_systems_name CHECK (char_length(name) <= 100 AND btrim(name) <> ''),
    CONSTRAINT ck_build_systems_description CHECK (description IS NULL OR char_length(description) <= 2000),
    CONSTRAINT ck_build_systems_mode CHECK (configuration_mode IN ('SLOT_SELECTION', 'POINT_ALLOCATION')),
    CONSTRAINT ck_build_systems_sort_order CHECK (sort_order >= 0),
    CONSTRAINT ck_build_systems_selection_rules CHECK (jsonb_typeof(selection_rules) = 'object')
);
CREATE UNIQUE INDEX uq_build_systems_name ON public.build_systems (game_id, lower(btrim(name)));
COMMENT ON TABLE public.build_systems IS '构筑系统；选择规则只保存有限结构，不保存玩家方案';
COMMENT ON COLUMN public.build_systems.selection_rules IS '选择规则对象；数据库只检查顶层为对象，字段语义由服务校验';

CREATE TABLE public.build_options (
    game_id varchar(64) NOT NULL,
    system_key varchar(64) NOT NULL,
    option_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    max_rank integer NOT NULL,
    rank_costs jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_build_options PRIMARY KEY (game_id, system_key, option_key),
    CONSTRAINT fk_build_options_system FOREIGN KEY (game_id, system_key)
        REFERENCES public.build_systems (game_id, system_key) ON DELETE CASCADE,
    CONSTRAINT ck_build_options_key CHECK (option_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_build_options_name CHECK (char_length(name) <= 100 AND btrim(name) <> ''),
    CONSTRAINT ck_build_options_description CHECK (description IS NULL OR char_length(description) <= 2000),
    CONSTRAINT ck_build_options_max_rank CHECK (max_rank >= 1),
    CONSTRAINT ck_build_options_rank_costs CHECK (jsonb_typeof(rank_costs) = 'array')
);
CREATE UNIQUE INDEX uq_build_options_name
    ON public.build_options (game_id, system_key, lower(btrim(name)));
COMMENT ON TABLE public.build_options IS '构筑可选项；删除系统时级联删除，不删除共享技能';
COMMENT ON COLUMN public.build_options.rank_costs IS '从第 1 级到最大等级的成本数组；数据库只检查顶层为数组';

CREATE TABLE public.build_groups (
    game_id varchar(64) NOT NULL,
    system_key varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    sort_order integer NOT NULL,
    slots jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_build_groups PRIMARY KEY (game_id, system_key, group_key),
    CONSTRAINT fk_build_groups_system FOREIGN KEY (game_id, system_key)
        REFERENCES public.build_systems (game_id, system_key) ON DELETE CASCADE,
    CONSTRAINT ck_build_groups_key CHECK (group_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_build_groups_name CHECK (char_length(name) <= 100 AND btrim(name) <> ''),
    CONSTRAINT ck_build_groups_description CHECK (description IS NULL OR char_length(description) <= 2000),
    CONSTRAINT ck_build_groups_sort_order CHECK (sort_order >= 0),
    CONSTRAINT ck_build_groups_slots CHECK (jsonb_typeof(slots) = 'array')
);
CREATE UNIQUE INDEX uq_build_groups_name
    ON public.build_groups (game_id, system_key, lower(btrim(name)));
COMMENT ON TABLE public.build_groups IS '构筑分组；slots 为有序位置数组，数组顺序是唯一显示顺序';
COMMENT ON COLUMN public.build_groups.slots IS '位置数组；数据库只检查顶层为数组，位置字段由服务校验';

CREATE TABLE public.build_option_skill_relations (
    game_id varchar(64) NOT NULL,
    system_key varchar(64) NOT NULL,
    option_key varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    activation_rank integer NOT NULL,
    skill_level_mode varchar(16) NOT NULL,
    fixed_skill_level integer,
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_build_option_skill_relations PRIMARY KEY (game_id, system_key, option_key, skill_key),
    CONSTRAINT fk_build_option_skill_relations_option FOREIGN KEY (game_id, system_key, option_key)
        REFERENCES public.build_options (game_id, system_key, option_key) ON DELETE CASCADE,
    CONSTRAINT fk_build_option_skill_relations_skill FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key) ON DELETE RESTRICT,
    CONSTRAINT ck_build_option_skill_relations_activation_rank CHECK (activation_rank >= 1),
    CONSTRAINT ck_build_option_skill_relations_sort_order CHECK (sort_order >= 0),
    CONSTRAINT ck_build_option_skill_relations_level_mode CHECK (
        (skill_level_mode = 'FIXED' AND fixed_skill_level IS NOT NULL AND fixed_skill_level >= 1)
        OR (skill_level_mode = 'SAME_AS_OPTION' AND fixed_skill_level IS NULL)
    )
);
CREATE INDEX ix_build_option_skill_relations_skill
    ON public.build_option_skill_relations (game_id, skill_key, system_key, option_key);
COMMENT ON TABLE public.build_option_skill_relations IS '构筑可选项授予技能；删除可选项只清授予，删除技能受保护';

INSERT INTO public.build_systems (game_id, system_key, name, description, configuration_mode, sort_order, selection_rules)
SELECT game_id, 'runes', '符文', NULL, 'SLOT_SELECTION', 0,
       '{"groupRoles":[],"budget":null,"prerequisites":[],"exclusions":[]}'::jsonb
FROM build_migration_games;

INSERT INTO public.build_options (
    game_id, system_key, option_key, name, description, max_rank, rank_costs, created_at, updated_at
)
SELECT game_id, 'runes', rune_key, name, description, 1, '[0]'::jsonb, created_at, updated_at
FROM public.runes;

INSERT INTO public.build_groups (
    game_id, system_key, group_key, name, description, sort_order, slots, created_at, updated_at
)
SELECT p.game_id, 'runes', p.path_key, p.name, p.description, p.sort_order,
       (
           SELECT jsonb_agg(
               jsonb_build_object(
                   'slotKey', m.slot_key,
                   'name', elem.slot->>'name',
                   'minimumSelections', 0,
                   'maximumSelections', 1,
                   'optionKeys', elem.slot->'runeKeys'
               )
               ORDER BY elem.ordinality
           )
           FROM jsonb_array_elements(p.slots) WITH ORDINALITY AS elem(slot, ordinality)
           JOIN build_slot_key_map m
             ON m.path_key = p.path_key
            AND m.source_index = (elem.ordinality - 1)::integer
            AND m.slot_name = elem.slot->>'name'
            AND m.category = elem.slot->>'category'
       ),
       p.created_at, p.updated_at
FROM public.rune_paths p;

INSERT INTO public.build_option_skill_relations (
    game_id, system_key, option_key, skill_key, activation_rank, skill_level_mode, fixed_skill_level, sort_order
)
SELECT game_id, 'runes', rune_key, skill_key, 1, 'FIXED', 1, sort_order
FROM public.rune_skill_relations;

DO $$
BEGIN
    IF EXISTS (
        SELECT game_id, rune_key, name, description FROM public.runes
        EXCEPT
        SELECT game_id, option_key, name, description
        FROM public.build_options WHERE system_key = 'runes'
    ) OR EXISTS (
        SELECT game_id, option_key, name, description
        FROM public.build_options
        EXCEPT
        SELECT game_id, rune_key, name, description FROM public.runes
    ) OR EXISTS (
        SELECT 1 FROM public.build_options
        WHERE system_key <> 'runes' OR max_rank <> 1 OR rank_costs <> '[0]'::jsonb
    ) THEN
        RAISE EXCEPTION 'build option set mismatch';
    END IF;
    IF EXISTS (
        SELECT game_id, path_key, name, description, sort_order FROM public.rune_paths
        EXCEPT
        SELECT game_id, group_key, name, description, sort_order
        FROM public.build_groups WHERE system_key = 'runes'
    ) OR EXISTS (
        SELECT game_id, group_key, name, description, sort_order FROM public.build_groups
        EXCEPT
        SELECT game_id, path_key, name, description, sort_order FROM public.rune_paths
    ) THEN
        RAISE EXCEPTION 'build group set mismatch';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.rune_paths p
        CROSS JOIN LATERAL jsonb_array_elements(p.slots) WITH ORDINALITY AS old_slot(slot, ordinality)
        JOIN public.build_groups g
          ON g.game_id = p.game_id AND g.system_key = 'runes' AND g.group_key = p.path_key
        CROSS JOIN LATERAL jsonb_array_elements(g.slots) WITH ORDINALITY AS new_slot(slot, ordinality)
        WHERE old_slot.ordinality = new_slot.ordinality
          AND (
              old_slot.slot->'runeKeys' IS DISTINCT FROM new_slot.slot->'optionKeys'
              OR old_slot.slot->>'name' IS DISTINCT FROM new_slot.slot->>'name'
              OR coalesce((new_slot.slot->>'minimumSelections')::integer, -1) <> 0
              OR coalesce((new_slot.slot->>'maximumSelections')::integer, -1) <> 1
          )
    ) OR EXISTS (
        SELECT 1
        FROM public.build_groups g
        CROSS JOIN LATERAL jsonb_array_elements(g.slots) WITH ORDINALITY AS elem(slot, ordinality)
        JOIN build_slot_key_map m
          ON m.path_key = g.group_key
         AND m.source_index = (elem.ordinality - 1)::integer
        WHERE elem.slot->>'slotKey' IS DISTINCT FROM m.slot_key
    ) OR EXISTS (
        SELECT 1
        FROM public.rune_paths p
        JOIN public.build_groups g
          ON g.game_id = p.game_id AND g.system_key = 'runes' AND g.group_key = p.path_key
        WHERE jsonb_array_length(p.slots) IS DISTINCT FROM jsonb_array_length(g.slots)
    ) OR (
        SELECT coalesce(sum(jsonb_array_length(slot->'runeKeys')), 0)
        FROM public.rune_paths p
        CROSS JOIN LATERAL jsonb_array_elements(p.slots) AS slot
    ) IS DISTINCT FROM (
        SELECT coalesce(sum(jsonb_array_length(slot->'optionKeys')), 0)
        FROM public.build_groups g
        CROSS JOIN LATERAL jsonb_array_elements(g.slots) AS slot
    ) THEN
        RAISE EXCEPTION 'build slot payload mismatch';
    END IF;
    IF EXISTS (
        SELECT game_id, rune_key, skill_key, sort_order FROM public.rune_skill_relations
        EXCEPT
        SELECT game_id, option_key, skill_key, sort_order
        FROM public.build_option_skill_relations WHERE system_key = 'runes'
    ) OR EXISTS (
        SELECT game_id, option_key, skill_key, sort_order FROM public.build_option_skill_relations
        EXCEPT
        SELECT game_id, rune_key, skill_key, sort_order FROM public.rune_skill_relations
    ) OR EXISTS (
        SELECT 1 FROM public.build_option_skill_relations
        WHERE system_key <> 'runes' OR activation_rank <> 1
           OR skill_level_mode <> 'FIXED' OR fixed_skill_level <> 1
    ) THEN
        RAISE EXCEPTION 'build skill relation set mismatch';
    END IF;
END $$;

ALTER TABLE public.image_relations DROP CONSTRAINT ck_image_relations_source_type;
ALTER TABLE public.image_relations DROP CONSTRAINT ck_image_relations_parent;

UPDATE public.image_relations
SET source_type = 'BUILD_OPTION', source_parent_key = 'runes'
WHERE source_type = 'RUNE';

UPDATE public.image_relations
SET source_type = 'BUILD_GROUP', source_parent_key = 'runes'
WHERE source_type = 'RUNE_PATH';

ALTER TABLE public.image_relations ADD CONSTRAINT ck_image_relations_source_type
    CHECK (source_type IN ('GAME', 'CHARACTER', 'ATTRIBUTE', 'EQUIPMENT', 'SKILL', 'SKILL_EFFECT', 'STATUS', 'BUILD_OPTION', 'BUILD_GROUP'));
ALTER TABLE public.image_relations ADD CONSTRAINT ck_image_relations_parent
    CHECK ((source_type IN ('SKILL_EFFECT', 'BUILD_OPTION', 'BUILD_GROUP') AND btrim(source_parent_key) <> '')
        OR (source_type NOT IN ('SKILL_EFFECT', 'BUILD_OPTION', 'BUILD_GROUP') AND source_parent_key = ''));

DO $$
BEGIN
    IF EXISTS (
        SELECT game_id, source_type, source_parent_key, source_key, image_key FROM build_image_expected
        EXCEPT
        SELECT game_id, source_type, source_parent_key, source_key, image_key
        FROM public.image_relations
        WHERE source_type IN ('BUILD_OPTION', 'BUILD_GROUP')
    ) OR EXISTS (
        SELECT game_id, source_type, source_parent_key, source_key, image_key
        FROM public.image_relations
        WHERE source_type IN ('BUILD_OPTION', 'BUILD_GROUP')
        EXCEPT
        SELECT game_id, source_type, source_parent_key, source_key, image_key FROM build_image_expected
    ) OR EXISTS (
        SELECT game_id, source_type, source_parent_key, source_key, image_key FROM build_image_kept
        EXCEPT
        SELECT game_id, source_type, source_parent_key, source_key, image_key
        FROM public.image_relations
        WHERE source_type NOT IN ('BUILD_OPTION', 'BUILD_GROUP')
    ) OR EXISTS (
        SELECT 1 FROM public.image_relations WHERE source_type IN ('RUNE', 'RUNE_PATH')
    ) THEN
        RAISE EXCEPTION 'build image relation set mismatch';
    END IF;
END $$;

DROP TABLE public.rune_skill_relations;
DROP TABLE public.rune_paths;
DROP TABLE public.runes;

DO $$
BEGIN
    IF to_regclass('public.runes') IS NOT NULL
        OR to_regclass('public.rune_paths') IS NOT NULL
        OR to_regclass('public.rune_skill_relations') IS NOT NULL
        OR to_regclass('public.build_systems') IS NULL
        OR to_regclass('public.build_options') IS NULL
        OR to_regclass('public.build_groups') IS NULL
        OR to_regclass('public.build_option_skill_relations') IS NULL THEN
        RAISE EXCEPTION 'build table replacement did not finish';
    END IF;
END $$;
