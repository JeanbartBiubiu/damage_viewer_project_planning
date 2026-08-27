-- =============================================================================
-- Damage Viewer System - Database Schema V2 (Tables)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 基础配置表 (Meta Data)
-- -----------------------------------------------------------------------------

CREATE TABLE public.games (
    game_id varchar(64) PRIMARY KEY,
    game_name varchar(100) NOT NULL,
    game_img_url text,
    created_at timestamp DEFAULT NOW(),
    CONSTRAINT ck_games_game_id_format CHECK (game_id ~ '^[a-z0-9_]+$')
);

COMMENT ON TABLE public.games IS '游戏信息表';
COMMENT ON COLUMN public.games.game_id IS '游戏唯一标识（小写字母/数字/下划线；用于分区表命名）';

CREATE TABLE public.attributes (
    game_id varchar(64) NOT NULL,
    attribute_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    value_type varchar(16) NOT NULL,
    min_value numeric,
    max_value numeric,
    description text,
    status varchar(16) NOT NULL DEFAULT 'ENABLED',
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_attributes
        PRIMARY KEY (game_id, attribute_key),
    CONSTRAINT fk_attributes_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_attributes_key
        CHECK (attribute_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_attributes_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_attributes_value_type
        CHECK (value_type IN ('DECIMAL', 'INTEGER')),
    CONSTRAINT ck_attributes_status
        CHECK (status IN ('ENABLED', 'DISABLED')),
    CONSTRAINT ck_attributes_bounds
        CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value),
    CONSTRAINT ck_attributes_sort_order
        CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX uq_attributes_name
    ON public.attributes (game_id, lower(btrim(name)));

COMMENT ON TABLE public.attributes IS '属性';

CREATE TABLE public.game_level_configs (
    game_id varchar(64) NOT NULL,
    min_level integer NOT NULL,
    max_level integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_game_level_configs PRIMARY KEY (game_id),
    CONSTRAINT fk_game_level_configs_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_game_level_configs_range
        CHECK (min_level >= 1 AND max_level >= min_level AND max_level <= 100)
);

COMMENT ON TABLE public.game_level_configs IS '游戏等级范围配置';

CREATE TABLE public.characters (
    game_id varchar(64) NOT NULL,
    character_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_characters PRIMARY KEY (game_id, character_key),
    CONSTRAINT fk_characters_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_characters_key
        CHECK (character_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_characters_name
        CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX uq_characters_name
    ON public.characters (game_id, lower(btrim(name)));

COMMENT ON TABLE public.characters IS '角色';

CREATE TABLE public.character_attributes (
    game_id varchar(64) NOT NULL,
    character_key varchar(64) NOT NULL,
    level_values jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_character_attributes PRIMARY KEY (game_id, character_key),
    CONSTRAINT fk_character_attributes_character
        FOREIGN KEY (game_id, character_key)
        REFERENCES public.characters (game_id, character_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_character_attributes_level_values
        CHECK (jsonb_typeof(level_values) = 'object')
);

COMMENT ON TABLE public.character_attributes IS '角色各等级属性';

CREATE TABLE public.equipment (
    game_id varchar(64) NOT NULL,
    equipment_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_equipment PRIMARY KEY (game_id, equipment_key),
    CONSTRAINT fk_equipment_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_equipment_key
        CHECK (equipment_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_equipment_name
        CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX uq_equipment_name
    ON public.equipment (game_id, lower(btrim(name)));

COMMENT ON TABLE public.equipment IS '装备';

CREATE TABLE public.equipment_attributes (
    game_id varchar(64) NOT NULL,
    equipment_key varchar(64) NOT NULL,
    attribute_values jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_equipment_attributes PRIMARY KEY (game_id, equipment_key),
    CONSTRAINT fk_equipment_attributes_equipment
        FOREIGN KEY (game_id, equipment_key)
        REFERENCES public.equipment (game_id, equipment_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_equipment_attributes_values
        CHECK (jsonb_typeof(attribute_values) = 'object')
);

COMMENT ON TABLE public.equipment_attributes IS '装备直接属性';

CREATE TABLE public.skill_categories (
    game_id varchar(64) NOT NULL,
    skill_category_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    status varchar(16) NOT NULL DEFAULT 'ENABLED',
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skill_categories PRIMARY KEY (game_id, skill_category_key),
    CONSTRAINT fk_skill_categories_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_skill_categories_key
        CHECK (skill_category_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_categories_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_categories_status
        CHECK (status IN ('ENABLED', 'DISABLED')),
    CONSTRAINT ck_skill_categories_sort_order
        CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX uq_skill_categories_name
    ON public.skill_categories (game_id, lower(btrim(name)));

COMMENT ON TABLE public.skill_categories IS '技能分类';

CREATE TABLE public.skills (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description varchar(2000),
    max_level integer NOT NULL,
    status varchar(16) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skills PRIMARY KEY (game_id, skill_key),
    CONSTRAINT fk_skills_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_skills_key
        CHECK (skill_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skills_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skills_max_level
        CHECK (max_level >= 1),
    CONSTRAINT ck_skills_status
        CHECK (status IN ('ENABLED', 'DISABLED')),
    CONSTRAINT ck_skills_sort_order
        CHECK (sort_order >= 0)
);

CREATE INDEX ix_skills_list
    ON public.skills (game_id, status, sort_order, name, skill_key);

COMMENT ON TABLE public.skills IS '技能';

CREATE TABLE public.skill_category_relations (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    skill_category_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_category_relations PRIMARY KEY (game_id, skill_key, skill_category_key),
    CONSTRAINT fk_skill_category_relations_skill
        FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_category_relations_category
        FOREIGN KEY (game_id, skill_category_key)
        REFERENCES public.skill_categories (game_id, skill_category_key)
        ON DELETE RESTRICT
);

CREATE INDEX ix_skill_category_relations_category
    ON public.skill_category_relations (game_id, skill_category_key, skill_key);

COMMENT ON TABLE public.skill_category_relations IS '技能与技能分类多对多关系';

CREATE TABLE public.skill_parameters (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    parameter_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    value_type varchar(16) NOT NULL,
    value_mode varchar(24) NOT NULL,
    fixed_value numeric,
    level_values jsonb,
    description varchar(2000),
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skill_parameters
        PRIMARY KEY (game_id, skill_key, parameter_key),
    CONSTRAINT fk_skill_parameters_skill
        FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key),
    CONSTRAINT ck_skill_parameters_key
        CHECK (parameter_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_parameters_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_parameters_value_type
        CHECK (value_type IN ('DECIMAL', 'INTEGER')),
    CONSTRAINT ck_skill_parameters_value_mode
        CHECK (value_mode IN (
            'FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT'
        )),
    CONSTRAINT ck_skill_parameters_value_shape
        CHECK (
            (value_mode = 'FIXED'
                AND fixed_value IS NOT NULL
                AND level_values IS NULL)
            OR
            (value_mode IN ('SKILL_LEVEL', 'CHARACTER_LEVEL')
                AND fixed_value IS NULL
                AND level_values IS NOT NULL
                AND jsonb_typeof(level_values) = 'object')
            OR
            (value_mode = 'RUNTIME_INPUT'
                AND fixed_value IS NULL
                AND level_values IS NULL)
        ),
    CONSTRAINT ck_skill_parameters_sort_order
        CHECK (sort_order >= 0)
);

CREATE INDEX ix_skill_parameters_list
    ON public.skill_parameters
    (game_id, skill_key, sort_order, name, parameter_key);

CREATE INDEX ix_skill_parameters_character_level
    ON public.skill_parameters
    (game_id, skill_key, parameter_key)
    WHERE value_mode = 'CHARACTER_LEVEL';

COMMENT ON TABLE public.skill_parameters IS '技能参数';

CREATE TABLE public.skill_formulas (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    formula_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description varchar(2000),
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skill_formulas
        PRIMARY KEY (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_formulas_skill
        FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key),
    CONSTRAINT ck_skill_formulas_key
        CHECK (formula_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_formulas_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_formulas_sort_order
        CHECK (sort_order >= 0)
);

CREATE INDEX ix_skill_formulas_list
    ON public.skill_formulas
    (game_id, skill_key, sort_order, name, formula_key);

COMMENT ON TABLE public.skill_formulas IS '技能公式';

CREATE TABLE public.skill_formula_nodes (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    formula_key varchar(64) NOT NULL,
    node_id uuid NOT NULL,
    parent_node_id uuid,
    child_order smallint NOT NULL,
    node_type varchar(16) NOT NULL,
    operation varchar(16),
    parameter_key varchar(64),
    attribute_owner varchar(16),
    attribute_key varchar(64),
    attribute_value_kind varchar(24),
    CONSTRAINT pk_skill_formula_nodes
        PRIMARY KEY (game_id, skill_key, formula_key, node_id),
    CONSTRAINT fk_skill_formula_nodes_formula
        FOREIGN KEY (game_id, skill_key, formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_formula_nodes_parent
        FOREIGN KEY (game_id, skill_key, formula_key, parent_node_id)
        REFERENCES public.skill_formula_nodes
            (game_id, skill_key, formula_key, node_id)
        ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT fk_skill_formula_nodes_parameter
        FOREIGN KEY (game_id, skill_key, parameter_key)
        REFERENCES public.skill_parameters
            (game_id, skill_key, parameter_key),
    CONSTRAINT fk_skill_formula_nodes_attribute
        FOREIGN KEY (game_id, attribute_key)
        REFERENCES public.attributes (game_id, attribute_key),
    CONSTRAINT uq_skill_formula_nodes_child
        UNIQUE (game_id, skill_key, formula_key, parent_node_id, child_order),
    CONSTRAINT ck_skill_formula_nodes_child_order
        CHECK (
            (parent_node_id IS NULL AND child_order = 0)
            OR
            (parent_node_id IS NOT NULL AND child_order IN (0, 1))
        ),
    CONSTRAINT ck_skill_formula_nodes_payload
        CHECK (
            (node_type = 'OPERATION'
                AND operation IS NOT NULL
                AND operation IN (
                    'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'
                )
                AND parameter_key IS NULL
                AND attribute_owner IS NULL
                AND attribute_key IS NULL
                AND attribute_value_kind IS NULL)
            OR
            (node_type = 'PARAMETER'
                AND operation IS NULL
                AND parameter_key IS NOT NULL
                AND attribute_owner IS NULL
                AND attribute_key IS NULL
                AND attribute_value_kind IS NULL)
            OR
            (node_type = 'ATTRIBUTE'
                AND operation IS NULL
                AND parameter_key IS NULL
                AND attribute_owner IS NOT NULL
                AND attribute_owner IN ('SOURCE', 'TARGET')
                AND attribute_key IS NOT NULL
                AND attribute_value_kind IS NOT NULL
                AND attribute_value_kind IN (
                    'BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING',
                    'CURRENT_RATIO', 'MISSING_RATIO'
                ))
        )
);

CREATE UNIQUE INDEX uq_skill_formula_nodes_root
    ON public.skill_formula_nodes (game_id, skill_key, formula_key)
    WHERE parent_node_id IS NULL;

CREATE INDEX ix_skill_formula_nodes_parameter_ref
    ON public.skill_formula_nodes (game_id, skill_key, parameter_key)
    WHERE parameter_key IS NOT NULL;

CREATE INDEX ix_skill_formula_nodes_attribute_ref
    ON public.skill_formula_nodes (game_id, attribute_key)
    WHERE attribute_key IS NOT NULL;

COMMENT ON TABLE public.skill_formula_nodes IS '技能公式节点';

CREATE TABLE public.damage_types (
    game_id varchar(64) NOT NULL,
    damage_type_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    status varchar(16) NOT NULL DEFAULT 'ENABLED',
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_damage_types PRIMARY KEY (game_id, damage_type_key),
    CONSTRAINT fk_damage_types_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_damage_types_key
        CHECK (damage_type_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_damage_types_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_damage_types_status
        CHECK (status IN ('ENABLED', 'DISABLED')),
    CONSTRAINT ck_damage_types_sort_order
        CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX uq_damage_types_name
    ON public.damage_types (game_id, lower(btrim(name)));

COMMENT ON TABLE public.damage_types IS '伤害类型';

CREATE TABLE public.game_data_state (
    game_id varchar(64) PRIMARY KEY REFERENCES public.games(game_id),
    current_revision bigint NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
    published_revision bigint NOT NULL DEFAULT 0 CHECK (published_revision >= 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CHECK (published_revision <= current_revision)
);

COMMENT ON TABLE public.game_data_state IS '每个游戏的战斗数据 revision 状态；Admin PUT 与 publish 通过锁定本行串行化';
COMMENT ON COLUMN public.game_data_state.current_revision IS '当前最新 change_revision；每次 Admin PUT 事务递增一次';
COMMENT ON COLUMN public.game_data_state.published_revision IS '最近一次发布冻结的 revision；始终 <= current_revision';

CREATE TABLE public.game_versions (
    version_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    game_id varchar(64) NOT NULL REFERENCES public.games(game_id),
    version_code varchar(64) NOT NULL,
    release_date date,
    is_current boolean DEFAULT false,
    change_revision bigint NOT NULL DEFAULT 0 CHECK (change_revision >= 0),
    created_at timestamp DEFAULT NOW(),
    published_at timestamp,
    CONSTRAINT uq_game_versions UNIQUE (game_id, version_code),
    CONSTRAINT uq_game_versions_game_version_id UNIQUE (game_id, version_id)
);

COMMENT ON TABLE public.game_versions IS '游戏版本表（用于版本发布、前端轮询、发布快照索引）';
COMMENT ON COLUMN public.game_versions.version_id IS '内部版本自增 ID（用于发布记录与快照索引）';
COMMENT ON COLUMN public.game_versions.version_code IS '对外展示版本号（如 14.1）';
COMMENT ON COLUMN public.game_versions.is_current IS '是否为当前版本（用于前端轮询接口）';
COMMENT ON COLUMN public.game_versions.change_revision IS '非 workspace 发布版本冻结的 change_revision；workspace 行可保持 0';

CREATE TABLE public.game_progression_schema (
    game_id varchar(64) PRIMARY KEY REFERENCES public.games(game_id),
    progression_kind varchar(16) NOT NULL CHECK (progression_kind IN ('LEVEL', 'STAR')),
    stage_min int NOT NULL CHECK (stage_min >= 1),
    stage_max int NOT NULL CHECK (stage_max >= stage_min AND stage_max <= 100),
    stage_label varchar(32) NOT NULL,
    require_all_stages boolean NOT NULL DEFAULT true,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.game_progression_schema IS '游戏成长阶段定义；影响战斗数值，纳入 revision/log';
COMMENT ON COLUMN public.game_progression_schema.change_revision IS '最近一次写入本行的 change_revision';

CREATE TABLE public.game_progression_schema_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    progression_kind varchar(16) NOT NULL CHECK (progression_kind IN ('LEVEL', 'STAR')),
    stage_min int NOT NULL CHECK (stage_min >= 1),
    stage_max int NOT NULL CHECK (stage_max >= stage_min AND stage_max <= 100),
    stage_label varchar(32) NOT NULL,
    require_all_stages boolean NOT NULL DEFAULT true,
    CONSTRAINT pk_game_progression_schema_log PRIMARY KEY (game_id, version_id),
    CONSTRAINT fk_game_progression_schema_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)
);

COMMENT ON TABLE public.game_progression_schema_log IS '成长阶段定义发布快照；按 version_id 记录发布时最新行';

CREATE TABLE public.images (
    game_id varchar(64) NOT NULL REFERENCES public.games(game_id),
    uri varchar(255) NOT NULL,
    image_base64 text NOT NULL,
    created_at timestamp DEFAULT NOW(),
    updated_at timestamp DEFAULT NOW(),
    CONSTRAINT pk_images PRIMARY KEY (game_id, uri)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.images IS '图片资源表（存 base64，小图标；不纳入版本管理）';
COMMENT ON COLUMN public.images.uri IS '资源标识（通常为前端引用路径或逻辑 key）';
COMMENT ON COLUMN public.images.image_base64 IS '图片 base64 内容（建议为 64x64 小图标）';

CREATE TABLE public.attribute_definitions (
    game_id varchar(64) NOT NULL,
    attr_key varchar(64) NOT NULL,
    sort_order int NOT NULL DEFAULT 0,
    attr_name varchar(100),
    attr_type varchar(32),
    default_value numeric DEFAULT 0,
    value_kind varchar(16) NOT NULL DEFAULT 'scalar'
        CHECK (value_kind IN ('scalar', 'ratio', 'rate', 'flag')),
    rate_target_attr_key varchar(64),
    min_value numeric,
    max_value numeric,
    image_uri varchar(255),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_attribute_definitions PRIMARY KEY (game_id, attr_key),
    CONSTRAINT ck_attribute_definitions_rate_target
        CHECK (
            (value_kind = 'rate' AND rate_target_attr_key IS NOT NULL)
            OR (value_kind <> 'rate' AND rate_target_attr_key IS NULL)
        ),
    CONSTRAINT ck_attribute_definitions_bounds
        CHECK (
            min_value IS NULL
            OR max_value IS NULL
            OR min_value <= max_value
        ),
    CONSTRAINT ck_attribute_definitions_sort_order
        CHECK (sort_order >= 0),
    CONSTRAINT fk_attribute_definitions_image FOREIGN KEY (game_id, image_uri)
        REFERENCES public.images (game_id, uri)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.attribute_definitions IS '属性定义（最新主表；按 change_revision 追踪变更）';
COMMENT ON COLUMN public.attribute_definitions.attr_key IS '属性 key（建议全局唯一且稳定，用于计算引擎与前端组装）';
COMMENT ON COLUMN public.attribute_definitions.sort_order IS '属性排序号（越小越靠前；同值按 attr_key 兜底）';
COMMENT ON COLUMN public.attribute_definitions.value_kind IS '属性值类别：scalar(普通数值)/ratio(比例)/rate(每秒速率)/flag(开关)';
COMMENT ON COLUMN public.attribute_definitions.rate_target_attr_key IS '仅 rate 生效：该速率作用到的目标属性 key（如 hp_regen -> hp）';
COMMENT ON COLUMN public.attribute_definitions.min_value IS '可选数值下界；与 default_value / max_value 一起在应用层校验';
COMMENT ON COLUMN public.attribute_definitions.max_value IS '可选数值上界；与 default_value / min_value 一起在应用层校验';
COMMENT ON COLUMN public.attribute_definitions.image_uri IS '可选同游戏 images.uri 引用；随 change_revision 版本化；图片字节本身不纳入版本';
COMMENT ON COLUMN public.attribute_definitions.change_revision IS '最近一次写入本行的 change_revision';

CREATE TABLE public.attribute_definitions_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    attr_key varchar(64) NOT NULL,
    sort_order int NOT NULL DEFAULT 0,
    attr_name varchar(100),
    attr_type varchar(32),
    default_value numeric DEFAULT 0,
    value_kind varchar(16) NOT NULL DEFAULT 'scalar'
        CHECK (value_kind IN ('scalar', 'ratio', 'rate', 'flag')),
    rate_target_attr_key varchar(64),
    min_value numeric,
    max_value numeric,
    image_uri varchar(255),
    CONSTRAINT pk_attribute_definitions_log PRIMARY KEY (game_id, attr_key, version_id),
    CONSTRAINT ck_attribute_definitions_log_rate_target
        CHECK (
            (value_kind = 'rate' AND rate_target_attr_key IS NOT NULL)
            OR (value_kind <> 'rate' AND rate_target_attr_key IS NULL)
        ),
    CONSTRAINT ck_attribute_definitions_log_bounds
        CHECK (
            min_value IS NULL
            OR max_value IS NULL
            OR min_value <= max_value
        ),
    CONSTRAINT ck_attribute_definitions_log_sort_order
        CHECK (sort_order >= 0),
    CONSTRAINT fk_attribute_definitions_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_attribute_definitions_log_image FOREIGN KEY (game_id, image_uri)
        REFERENCES public.images (game_id, uri)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.attribute_definitions_log IS '属性定义发布快照；按 version_id 记录发布时最新行';
COMMENT ON COLUMN public.attribute_definitions_log.min_value IS '可选数值下界快照';
COMMENT ON COLUMN public.attribute_definitions_log.max_value IS '可选数值上界快照';
COMMENT ON COLUMN public.attribute_definitions_log.image_uri IS '可选同游戏 images.uri 引用快照；仅存 URI，不含图片字节';

CREATE TABLE public.reserved_type (
    type_id int NOT NULL,
    name varchar(100) NOT NULL,
    type_key varchar(128) NOT NULL,
    CONSTRAINT pk_reserved_type PRIMARY KEY (type_id),
    CONSTRAINT uq_reserved_type_type_key UNIQUE (type_key)
);

CREATE TABLE public.reserved_type_relation (
    type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    parent_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_reserved_type_relation PRIMARY KEY (type_id, parent_type_id)
);

COMMENT ON TABLE public.reserved_type IS '系统保留 type（全局通用；不纳入版本管理）';
COMMENT ON COLUMN public.reserved_type.type_id IS '保留 type ID（全局稳定；仅作数据库引用）';
COMMENT ON COLUMN public.reserved_type.type_key IS '跨模块稳定语义真源（如 value_type/number、operation/damage）';
COMMENT ON TABLE public.reserved_type_relation IS '系统保留 type 的关系表（一般用于层级/分组）';

CREATE TABLE public.types (
    game_id varchar(64) NOT NULL,
    type_id int NOT NULL,
    type_key varchar(128) NOT NULL,
    name varchar(100),
    description varchar(255),
    reserved_type_id int REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_types PRIMARY KEY (game_id, type_id),
    CONSTRAINT uq_types_game_type_key UNIQUE (game_id, type_key)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.types IS '业务 type 定义（最新主表；按 change_revision 追踪变更）';
COMMENT ON COLUMN public.types.type_id IS 'type 唯一 ID（game 内唯一即可）';
COMMENT ON COLUMN public.types.type_key IS '游戏内稳定语义 key；跨模块解析优先于数字 ID';
COMMENT ON COLUMN public.types.reserved_type_id IS '可选：关联到系统保留 type，用于复用通用语义';
COMMENT ON COLUMN public.types.change_revision IS '最近一次写入本行的 change_revision';

CREATE TABLE public.types_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    type_id int NOT NULL,
    type_key varchar(128) NOT NULL,
    name varchar(100),
    description varchar(255),
    reserved_type_id int REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_types_log PRIMARY KEY (game_id, type_id, version_id),
    CONSTRAINT fk_types_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.types_log IS 'type 发布快照；按 version_id 记录发布时最新行';

CREATE TABLE public.type_relations (
    game_id varchar(64) NOT NULL,
    type_id int NOT NULL,
    target_category varchar(32) NOT NULL CHECK (target_category IN (
        'entity',
        'attribute',
        'resource',
        'provider',
        'ability',
        'ability_phase',
        'modifier',
        'listener',
        'effect_step',
        'type',
        -- 迁移期兼容旧值；后续最终切片删除
        'equipment',
        'skill',
        'character'
    )),
    target_id varchar(256) NOT NULL,
    extend jsonb,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_type_relations PRIMARY KEY (game_id, type_id, target_category, target_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.type_relations IS 'type 关系/挂载表（最新主表；type_id 可引用 reserved 或 game-local type，无 polymorphic FK）';
COMMENT ON COLUMN public.type_relations.target_category IS '目标类别：entity/attribute/resource/provider/ability/ability_phase/modifier/listener/effect_step/type（含迁移期旧值）';
COMMENT ON COLUMN public.type_relations.target_id IS '目标 ID：entity_id/attr_key/resource_key/provider_id/ability_id/phase_id/modifier_id/listener_id/step_id/type_id';
COMMENT ON COLUMN public.type_relations.extend IS '扩展字段（原设计 extend varchar，建议存结构化 JSON）';
COMMENT ON COLUMN public.type_relations.change_revision IS '最近一次写入本行的 change_revision';

CREATE TABLE public.type_relations_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    type_id int NOT NULL,
    target_category varchar(32) NOT NULL CHECK (target_category IN (
        'entity',
        'attribute',
        'resource',
        'provider',
        'ability',
        'ability_phase',
        'modifier',
        'listener',
        'effect_step',
        'type',
        'equipment',
        'skill',
        'character'
    )),
    target_id varchar(256) NOT NULL,
    extend jsonb,
    CONSTRAINT pk_type_relations_log PRIMARY KEY (game_id, type_id, target_category, target_id, version_id),
    CONSTRAINT fk_type_relations_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.type_relations_log IS 'type 关系发布快照；按 version_id 记录发布时最新行';

-- -----------------------------------------------------------------------------
-- 2. 实体数据表 (Entities)
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 4. 索引优化 (用于编辑器的查询)
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 5. Coefficient buckets (fresh-install baseline; not a separate/optional schema step)
--    Formerly coefficient_bucket_schema.sql — executable DDL preserved below.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 6. Status action control (fresh-install baseline; not a separate/optional schema step)
--    Formerly status_control_schema.sql — executable DDL preserved below.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 7. Status resources (fresh-install baseline; not a separate/optional schema step)
--    Formerly status_resource_schema.sql — executable DDL preserved below.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 8. (removed) Wasm Canonical Catalog — not part of the current baseline.
--    Publish freezes change_revision into game_versions and copies latest
--    combat-data rows into corresponding *_log tables; it does not build or
--    serve Bundle / Wasm Catalog snapshots. Generic combat-data DDL is §9.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 9. Generic 1v1 Combat Data Model (revision-based latest tables + publish logs)
-- -----------------------------------------------------------------------------

CREATE TABLE public.game_entities (
    game_id varchar(64) NOT NULL,
    entity_id varchar(256) NOT NULL,
    display_name varchar(100) NOT NULL,
    description text,
    image_uri varchar(255),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_game_entities PRIMARY KEY (game_id, entity_id),
    CONSTRAINT fk_game_entities_image FOREIGN KEY (game_id, image_uri)
        REFERENCES public.images (game_id, uri)
) PARTITION BY LIST (game_id);

CREATE TABLE public.game_entities_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    entity_id varchar(256) NOT NULL,
    display_name varchar(100) NOT NULL,
    description text,
    image_uri varchar(255),
    CONSTRAINT pk_game_entities_log PRIMARY KEY (game_id, entity_id, version_id),
    CONSTRAINT fk_game_entities_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_game_entities_log_image FOREIGN KEY (game_id, image_uri)
        REFERENCES public.images (game_id, uri)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.game_entities IS '战斗相关实体身份（角色/装备/符文等；类别走 type_relations）';
COMMENT ON COLUMN public.game_entities.image_uri IS '可选同游戏 images.uri 引用；随 change_revision 版本化；图片字节本身不纳入版本';
COMMENT ON COLUMN public.game_entities_log.image_uri IS '可选同游戏 images.uri 引用快照；仅存 URI，不含图片字节';

CREATE TABLE public.entity_attribute_values (
    game_id varchar(64) NOT NULL,
    entity_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    base_value numeric NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_entity_attribute_values PRIMARY KEY (game_id, entity_id, attr_key),
    CONSTRAINT fk_entity_attribute_values_entity FOREIGN KEY (game_id, entity_id)
        REFERENCES public.game_entities (game_id, entity_id),
    CONSTRAINT fk_entity_attribute_values_attr FOREIGN KEY (game_id, attr_key)
        REFERENCES public.attribute_definitions (game_id, attr_key)

) PARTITION BY LIST (game_id);

CREATE TABLE public.entity_attribute_values_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    entity_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    base_value numeric NOT NULL,
    CONSTRAINT pk_entity_attribute_values_log PRIMARY KEY (game_id, entity_id, attr_key, version_id),
    CONSTRAINT fk_entity_attribute_values_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.entity_attribute_values IS '实体属性基础值';

CREATE TABLE public.entity_attribute_stage_values (
    game_id varchar(64) NOT NULL,
    entity_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    stage int NOT NULL CHECK (stage >= 1),
    value numeric NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_entity_attribute_stage_values PRIMARY KEY (game_id, entity_id, attr_key, stage),
    CONSTRAINT fk_entity_attribute_stage_values_base FOREIGN KEY (game_id, entity_id, attr_key)
        REFERENCES public.entity_attribute_values (game_id, entity_id, attr_key)

) PARTITION BY LIST (game_id);

CREATE TABLE public.entity_attribute_stage_values_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    entity_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    stage int NOT NULL CHECK (stage >= 1),
    value numeric NOT NULL,
    CONSTRAINT pk_entity_attribute_stage_values_log PRIMARY KEY (game_id, entity_id, attr_key, stage, version_id),
    CONSTRAINT fk_entity_attribute_stage_values_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.entity_attribute_stage_values IS '实体属性 stage 绝对值';

CREATE TABLE public.provider_definitions (
    game_id varchar(64) NOT NULL,
    provider_id varchar(256) NOT NULL,
    provider_kind_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    display_name varchar(100) NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_definitions PRIMARY KEY (game_id, provider_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_definitions_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    provider_id varchar(256) NOT NULL,
    provider_kind_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    display_name varchar(100) NOT NULL,
    CONSTRAINT pk_provider_definitions_log PRIMARY KEY (game_id, provider_id, version_id),
    CONSTRAINT fk_provider_definitions_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.provider_definitions IS '被动/状态/装备效果等 provider 定义';

CREATE TABLE public.provider_formulas (
    game_id varchar(64) NOT NULL,
    provider_id varchar(256) NOT NULL,
    formula_key varchar(128) NOT NULL,
    expression jsonb NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_formulas PRIMARY KEY (game_id, provider_id, formula_key),
    CONSTRAINT fk_provider_formulas_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id),
    CONSTRAINT ck_provider_formulas_expression_object CHECK (jsonb_typeof(expression) = 'object')

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_formulas_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    provider_id varchar(256) NOT NULL,
    formula_key varchar(128) NOT NULL,
    expression jsonb NOT NULL,
    CONSTRAINT pk_provider_formulas_log PRIMARY KEY (game_id, provider_id, formula_key, version_id),
    CONSTRAINT fk_provider_formulas_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_provider_formulas_log_expression_object CHECK (jsonb_typeof(expression) = 'object')

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.provider_formulas IS 'provider 内共享公式；禁止跨 provider FK';

CREATE TABLE public.provider_lifecycles (
    game_id varchar(64) NOT NULL,
    provider_id varchar(256) NOT NULL,
    duration_formula_key varchar(128),
    max_stacks int NOT NULL DEFAULT 1 CHECK (max_stacks >= 1),
    refresh_policy_type_id int REFERENCES public.reserved_type(type_id),
    tick_interval_ms int CHECK (tick_interval_ms IS NULL OR tick_interval_ms >= 0),
    start_delay_ms int CHECK (start_delay_ms IS NULL OR start_delay_ms >= 0),
    tick_anchor_scope_type_id int REFERENCES public.reserved_type(type_id),
    tick_anchor_state_key varchar(128) CHECK (
        tick_anchor_state_key IS NULL OR tick_anchor_state_key <> ''
    ),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_lifecycles PRIMARY KEY (game_id, provider_id),
    CONSTRAINT fk_provider_lifecycles_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id),
    CONSTRAINT fk_provider_lifecycles_duration_formula FOREIGN KEY (game_id, provider_id, duration_formula_key)
        REFERENCES public.provider_formulas (game_id, provider_id, formula_key),
    CONSTRAINT ck_provider_lifecycles_tick_anchor_pair CHECK (
        (tick_anchor_scope_type_id IS NULL) = (tick_anchor_state_key IS NULL)
    )

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_lifecycles_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    provider_id varchar(256) NOT NULL,
    duration_formula_key varchar(128),
    max_stacks int NOT NULL DEFAULT 1 CHECK (max_stacks >= 1),
    refresh_policy_type_id int REFERENCES public.reserved_type(type_id),
    tick_interval_ms int CHECK (tick_interval_ms IS NULL OR tick_interval_ms >= 0),
    start_delay_ms int CHECK (start_delay_ms IS NULL OR start_delay_ms >= 0),
    tick_anchor_scope_type_id int REFERENCES public.reserved_type(type_id),
    tick_anchor_state_key varchar(128) CHECK (
        tick_anchor_state_key IS NULL OR tick_anchor_state_key <> ''
    ),
    CONSTRAINT pk_provider_lifecycles_log PRIMARY KEY (game_id, provider_id, version_id),
    CONSTRAINT fk_provider_lifecycles_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_provider_lifecycles_log_tick_anchor_pair CHECK (
        (tick_anchor_scope_type_id IS NULL) = (tick_anchor_state_key IS NULL)
    )

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.provider_lifecycles IS 'provider 生命周期；duration_formula 同 provider 复合 FK；tick_anchor 可选成对字段（scope+state_key）';
COMMENT ON COLUMN public.provider_lifecycles.tick_anchor_scope_type_id IS '可选 tick 锚定状态作用域；初始支持 state_scope/provider_target(20252)；须与 tick_anchor_state_key 成对';
COMMENT ON COLUMN public.provider_lifecycles.tick_anchor_state_key IS '可选 tick 锚定 provider 状态键；须与 tick_anchor_scope_type_id 成对';

CREATE TABLE public.entity_provider_mounts (
    game_id varchar(64) NOT NULL,
    entity_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_entity_provider_mounts PRIMARY KEY (game_id, entity_id, provider_id),
    CONSTRAINT fk_entity_provider_mounts_entity FOREIGN KEY (game_id, entity_id)
        REFERENCES public.game_entities (game_id, entity_id),
    CONSTRAINT fk_entity_provider_mounts_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.entity_provider_mounts_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    entity_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    CONSTRAINT pk_entity_provider_mounts_log PRIMARY KEY (game_id, entity_id, provider_id, version_id),
    CONSTRAINT fk_entity_provider_mounts_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_state_fields (
    game_id varchar(64) NOT NULL,
    provider_id varchar(256) NOT NULL,
    state_key varchar(128) NOT NULL,
    value_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    max_value numeric CHECK (max_value IS NULL OR max_value > 0),
    duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms > 0),
    refresh_policy_type_id int REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_state_fields PRIMARY KEY (game_id, provider_id, state_key),
    CONSTRAINT fk_provider_state_fields_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_state_fields_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    provider_id varchar(256) NOT NULL,
    state_key varchar(128) NOT NULL,
    value_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    max_value numeric CHECK (max_value IS NULL OR max_value > 0),
    duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms > 0),
    refresh_policy_type_id int REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_provider_state_fields_log PRIMARY KEY (game_id, provider_id, state_key, version_id),
    CONSTRAINT fk_provider_state_fields_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_definitions (
    game_id varchar(64) NOT NULL,
    ability_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    ability_key varchar(128) NOT NULL,
    ability_kind_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    display_name varchar(100) NOT NULL,
    cast_condition_formula_key varchar(128),
    cast_origin varchar(16) CHECK (
        cast_origin IS NULL OR cast_origin IN ('champion', 'item', 'pet', 'innate')
    ),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_definitions PRIMARY KEY (game_id, ability_id),
    CONSTRAINT uq_ability_definitions_provider_key UNIQUE (game_id, provider_id, ability_key),
    CONSTRAINT fk_ability_definitions_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_definitions_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    ability_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    ability_key varchar(128) NOT NULL,
    ability_kind_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    display_name varchar(100) NOT NULL,
    cast_condition_formula_key varchar(128),
    cast_origin varchar(16) CHECK (
        cast_origin IS NULL OR cast_origin IN ('champion', 'item', 'pet', 'innate')
    ),
    CONSTRAINT pk_ability_definitions_log PRIMARY KEY (game_id, ability_id, version_id),
    CONSTRAINT fk_ability_definitions_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_parameters (
    game_id varchar(64) NOT NULL,
    ability_id varchar(256) NOT NULL,
    param_key varchar(128) NOT NULL,
    numeric_value numeric NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_parameters PRIMARY KEY (game_id, ability_id, param_key),
    CONSTRAINT fk_ability_parameters_ability FOREIGN KEY (game_id, ability_id)
        REFERENCES public.ability_definitions (game_id, ability_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_parameters_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    ability_id varchar(256) NOT NULL,
    param_key varchar(128) NOT NULL,
    numeric_value numeric NOT NULL,
    CONSTRAINT pk_ability_parameters_log PRIMARY KEY (game_id, ability_id, param_key, version_id),
    CONSTRAINT fk_ability_parameters_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_state_fields (
    game_id varchar(64) NOT NULL,
    ability_id varchar(256) NOT NULL,
    state_key varchar(128) NOT NULL,
    value_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_state_fields PRIMARY KEY (game_id, ability_id, state_key),
    CONSTRAINT fk_ability_state_fields_ability FOREIGN KEY (game_id, ability_id)
        REFERENCES public.ability_definitions (game_id, ability_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_state_fields_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    ability_id varchar(256) NOT NULL,
    state_key varchar(128) NOT NULL,
    value_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_ability_state_fields_log PRIMARY KEY (game_id, ability_id, state_key, version_id),
    CONSTRAINT fk_ability_state_fields_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_phases (
    game_id varchar(64) NOT NULL,
    phase_id varchar(256) NOT NULL,
    ability_id varchar(256) NOT NULL,
    phase_order int NOT NULL CHECK (phase_order >= 0),
    phase_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    duration_formula_key varchar(128),
    interruptible boolean NOT NULL DEFAULT true,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_phases PRIMARY KEY (game_id, phase_id),
    CONSTRAINT uq_ability_phases_order UNIQUE (game_id, ability_id, phase_order),
    CONSTRAINT fk_ability_phases_ability FOREIGN KEY (game_id, ability_id)
        REFERENCES public.ability_definitions (game_id, ability_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_phases_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    phase_id varchar(256) NOT NULL,
    ability_id varchar(256) NOT NULL,
    phase_order int NOT NULL CHECK (phase_order >= 0),
    phase_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    duration_formula_key varchar(128),
    interruptible boolean NOT NULL DEFAULT true,
    CONSTRAINT pk_ability_phases_log PRIMARY KEY (game_id, phase_id, version_id),
    CONSTRAINT fk_ability_phases_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_cooldowns (
    game_id varchar(64) NOT NULL,
    cooldown_id varchar(256) NOT NULL,
    ability_id varchar(256) NOT NULL,
    duration_formula_key varchar(128) NOT NULL,
    starts_on_phase_id varchar(256),
    group_key varchar(128),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_cooldowns PRIMARY KEY (game_id, cooldown_id),
    CONSTRAINT fk_ability_cooldowns_ability FOREIGN KEY (game_id, ability_id)
        REFERENCES public.ability_definitions (game_id, ability_id),
    CONSTRAINT fk_ability_cooldowns_phase FOREIGN KEY (game_id, starts_on_phase_id)
        REFERENCES public.ability_phases (game_id, phase_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_cooldowns_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    cooldown_id varchar(256) NOT NULL,
    ability_id varchar(256) NOT NULL,
    duration_formula_key varchar(128) NOT NULL,
    starts_on_phase_id varchar(256),
    group_key varchar(128),
    CONSTRAINT pk_ability_cooldowns_log PRIMARY KEY (game_id, cooldown_id, version_id),
    CONSTRAINT fk_ability_cooldowns_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_modifiers (
    game_id varchar(64) NOT NULL,
    modifier_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    modifier_key varchar(128) NOT NULL,
    modifier_type_id int REFERENCES public.reserved_type(type_id),
    target_selector_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_attr_key varchar(64) NOT NULL,
    command_type_id int REFERENCES public.reserved_type(type_id),
    channel_type_id int REFERENCES public.reserved_type(type_id),
    bucket_type_id int REFERENCES public.reserved_type(type_id),
    stage_type_id int REFERENCES public.reserved_type(type_id),
    priority int NOT NULL DEFAULT 0,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    value_formula_key varchar(128) NOT NULL,
    condition_formula_key varchar(128),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_modifiers PRIMARY KEY (game_id, modifier_id),
    CONSTRAINT fk_provider_modifiers_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id),
    CONSTRAINT fk_provider_modifiers_attr FOREIGN KEY (game_id, target_attr_key)
        REFERENCES public.attribute_definitions (game_id, attr_key)

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_modifiers_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    modifier_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    modifier_key varchar(128) NOT NULL,
    modifier_type_id int REFERENCES public.reserved_type(type_id),
    target_selector_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_attr_key varchar(64) NOT NULL,
    command_type_id int REFERENCES public.reserved_type(type_id),
    channel_type_id int REFERENCES public.reserved_type(type_id),
    bucket_type_id int REFERENCES public.reserved_type(type_id),
    stage_type_id int REFERENCES public.reserved_type(type_id),
    priority int NOT NULL DEFAULT 0,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    value_formula_key varchar(128) NOT NULL,
    condition_formula_key varchar(128),
    CONSTRAINT pk_provider_modifiers_log PRIMARY KEY (game_id, modifier_id, version_id),
    CONSTRAINT fk_provider_modifiers_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_listeners (
    game_id varchar(64) NOT NULL,
    listener_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    listener_key varchar(128) NOT NULL,
    event_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    ability_id varchar(256),
    max_triggers_per_event int CHECK (max_triggers_per_event IS NULL OR max_triggers_per_event >= 0),
    chain_limit_key varchar(128),
    per_cast_throttle_ms int CHECK (per_cast_throttle_ms IS NULL OR per_cast_throttle_ms >= 0),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_listeners PRIMARY KEY (game_id, listener_id),
    CONSTRAINT fk_provider_listeners_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id),
    CONSTRAINT fk_provider_listeners_ability FOREIGN KEY (game_id, ability_id)
        REFERENCES public.ability_definitions (game_id, ability_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_listeners_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    listener_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    listener_key varchar(128) NOT NULL,
    event_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    ability_id varchar(256),
    max_triggers_per_event int CHECK (max_triggers_per_event IS NULL OR max_triggers_per_event >= 0),
    chain_limit_key varchar(128),
    per_cast_throttle_ms int CHECK (per_cast_throttle_ms IS NULL OR per_cast_throttle_ms >= 0),
    CONSTRAINT pk_provider_listeners_log PRIMARY KEY (game_id, listener_id, version_id),
    CONSTRAINT fk_provider_listeners_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.listener_match_types (
    game_id varchar(64) NOT NULL,
    listener_id varchar(256) NOT NULL,
    match_mode_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    type_id int NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_listener_match_types PRIMARY KEY (game_id, listener_id, match_mode_type_id, type_id),
    CONSTRAINT fk_listener_match_types_listener FOREIGN KEY (game_id, listener_id)
        REFERENCES public.provider_listeners (game_id, listener_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.listener_match_types_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    listener_id varchar(256) NOT NULL,
    match_mode_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    type_id int NOT NULL,
    CONSTRAINT pk_listener_match_types_log PRIMARY KEY (game_id, listener_id, match_mode_type_id, type_id, version_id),
    CONSTRAINT fk_listener_match_types_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.listener_match_types IS 'listener type matcher；type_id 解析 reserved/game-local，无 polymorphic FK';

CREATE TABLE public.effect_sequences (
    game_id varchar(64) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    sequence_key varchar(128) NOT NULL,
    display_name varchar(100),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_effect_sequences PRIMARY KEY (game_id, sequence_id),
    CONSTRAINT uq_effect_sequences_provider_key UNIQUE (game_id, provider_id, sequence_key),
    CONSTRAINT fk_effect_sequences_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.effect_sequences_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    sequence_id varchar(256) NOT NULL,
    provider_id varchar(256) NOT NULL,
    sequence_key varchar(128) NOT NULL,
    display_name varchar(100),
    CONSTRAINT pk_effect_sequences_log PRIMARY KEY (game_id, sequence_id, version_id),
    CONSTRAINT fk_effect_sequences_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.effect_steps (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    step_order int NOT NULL CHECK (step_order >= 0),
    operation_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_selector_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    condition_formula_key varchar(128),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_effect_steps PRIMARY KEY (game_id, step_id),
    CONSTRAINT uq_effect_steps_order UNIQUE (game_id, sequence_id, step_order),
    CONSTRAINT fk_effect_steps_sequence FOREIGN KEY (game_id, sequence_id)
        REFERENCES public.effect_sequences (game_id, sequence_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.effect_steps_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    step_order int NOT NULL CHECK (step_order >= 0),
    operation_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_selector_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    condition_formula_key varchar(128),
    CONSTRAINT pk_effect_steps_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_effect_steps_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.effect_steps IS 'effect sequence 步骤公共行；提交时必须恰好一种 detail';

CREATE TABLE public.ability_phase_effect_sequences (
    game_id varchar(64) NOT NULL,
    phase_id varchar(256) NOT NULL,
    trigger_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    sequence_id varchar(256) NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_phase_effect_sequences PRIMARY KEY (game_id, phase_id, trigger_type_id, sequence_id),
    CONSTRAINT fk_ability_phase_effect_sequences_phase FOREIGN KEY (game_id, phase_id)
        REFERENCES public.ability_phases (game_id, phase_id),
    CONSTRAINT fk_ability_phase_effect_sequences_sequence FOREIGN KEY (game_id, sequence_id)
        REFERENCES public.effect_sequences (game_id, sequence_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_phase_effect_sequences_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    phase_id varchar(256) NOT NULL,
    trigger_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    sequence_id varchar(256) NOT NULL,
    CONSTRAINT pk_ability_phase_effect_sequences_log PRIMARY KEY (game_id, phase_id, trigger_type_id, sequence_id, version_id),
    CONSTRAINT fk_ability_phase_effect_sequences_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.listener_effect_sequences (
    game_id varchar(64) NOT NULL,
    listener_id varchar(256) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_listener_effect_sequences PRIMARY KEY (game_id, listener_id, sequence_id),
    CONSTRAINT fk_listener_effect_sequences_listener FOREIGN KEY (game_id, listener_id)
        REFERENCES public.provider_listeners (game_id, listener_id),
    CONSTRAINT fk_listener_effect_sequences_sequence FOREIGN KEY (game_id, sequence_id)
        REFERENCES public.effect_sequences (game_id, sequence_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.listener_effect_sequences_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    listener_id varchar(256) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    CONSTRAINT pk_listener_effect_sequences_log PRIMARY KEY (game_id, listener_id, sequence_id, version_id),
    CONSTRAINT fk_listener_effect_sequences_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_tick_sequences (
    game_id varchar(64) NOT NULL,
    provider_id varchar(256) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_tick_sequences PRIMARY KEY (game_id, provider_id, sequence_id),
    CONSTRAINT fk_provider_tick_sequences_provider FOREIGN KEY (game_id, provider_id)
        REFERENCES public.provider_definitions (game_id, provider_id),
    CONSTRAINT fk_provider_tick_sequences_sequence FOREIGN KEY (game_id, sequence_id)
        REFERENCES public.effect_sequences (game_id, sequence_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_tick_sequences_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    provider_id varchar(256) NOT NULL,
    sequence_id varchar(256) NOT NULL,
    CONSTRAINT pk_provider_tick_sequences_log PRIMARY KEY (game_id, provider_id, sequence_id, version_id),
    CONSTRAINT fk_provider_tick_sequences_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.damage_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    damage_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    copyable_on_hit boolean NOT NULL DEFAULT false,
    crit_eligible boolean NOT NULL DEFAULT false,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_damage_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_damage_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.damage_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    damage_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    copyable_on_hit boolean NOT NULL DEFAULT false,
    crit_eligible boolean NOT NULL DEFAULT false,
    CONSTRAINT pk_damage_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_damage_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.heal_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_heal_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_heal_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.heal_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_heal_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_heal_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.attribute_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_attribute_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_attribute_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.attribute_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_attribute_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_attribute_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.shield_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    shield_ref varchar(256) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    duration_formula_key varchar(128),
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_shield_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_shield_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.shield_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    shield_ref varchar(256) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    duration_formula_key varchar(128),
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_shield_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_shield_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    action_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_provider_id varchar(256) NOT NULL,
    stacks_formula_key varchar(128),
    duration_formula_key varchar(128),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_provider_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_provider_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.provider_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    action_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_provider_id varchar(256) NOT NULL,
    stacks_formula_key varchar(128),
    duration_formula_key varchar(128),
    CONSTRAINT pk_provider_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_provider_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.event_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    event_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    event_ref varchar(256),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_event_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_event_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.event_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    event_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    event_ref varchar(256),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT pk_event_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_event_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_control_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    action_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_ability_id varchar(256) NOT NULL,
    amount_formula_key varchar(128),
    value_policy_type_id int REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_ability_control_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_ability_control_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.ability_control_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    action_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    target_ability_id varchar(256) NOT NULL,
    amount_formula_key varchar(128),
    value_policy_type_id int REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_ability_control_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_ability_control_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.state_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    state_scope_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    state_key varchar(128) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_state_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_state_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.state_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    state_scope_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    state_key varchar(128) NOT NULL,
    amount_formula_key varchar(128) NOT NULL,
    value_policy_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_state_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_state_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.repeat_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    repeat_scope_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    repeat_count int NOT NULL CHECK (repeat_count > 0),
    repeat_tag varchar(128) NOT NULL CHECK (repeat_tag <> ''),
    trigger_state_key varchar(128) NOT NULL CHECK (trigger_state_key <> ''),
    threshold numeric NOT NULL CHECK (threshold > 0),
    delay_ms int NOT NULL DEFAULT 0 CHECK (delay_ms >= 0),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_repeat_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_repeat_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.repeat_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    repeat_scope_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    repeat_count int NOT NULL CHECK (repeat_count > 0),
    repeat_tag varchar(128) NOT NULL CHECK (repeat_tag <> ''),
    trigger_state_key varchar(128) NOT NULL CHECK (trigger_state_key <> ''),
    threshold numeric NOT NULL CHECK (threshold > 0),
    delay_ms int NOT NULL DEFAULT 0 CHECK (delay_ms >= 0),
    CONSTRAINT pk_repeat_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_repeat_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.execute_effect_details (
    game_id varchar(64) NOT NULL,
    step_id varchar(256) NOT NULL,
    threshold numeric NOT NULL CHECK (threshold > 0 AND threshold <= 1),
    change_revision bigint NOT NULL CHECK (change_revision > 0),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_execute_effect_details PRIMARY KEY (game_id, step_id),
    CONSTRAINT fk_execute_effect_details_step FOREIGN KEY (game_id, step_id)
        REFERENCES public.effect_steps (game_id, step_id)

) PARTITION BY LIST (game_id);

CREATE TABLE public.execute_effect_details_log (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    change_revision bigint NOT NULL,
    step_id varchar(256) NOT NULL,
    threshold numeric NOT NULL CHECK (threshold > 0 AND threshold <= 1),
    CONSTRAINT pk_execute_effect_details_log PRIMARY KEY (game_id, step_id, version_id),
    CONSTRAINT fk_execute_effect_details_log_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)

) PARTITION BY LIST (game_id);
