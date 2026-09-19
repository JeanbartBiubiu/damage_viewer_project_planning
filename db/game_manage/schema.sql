-- 当前管理数据：27 张业务逻辑表；结构化内容由服务聚合校验。

CREATE TABLE public.games (
    game_id varchar(64) PRIMARY KEY,
    game_name varchar(100) NOT NULL,
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
    expression jsonb NOT NULL,
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

CREATE TABLE public.modifier_zones (
    game_id varchar(64) NOT NULL,
    modifier_zone_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    domain varchar(16) NOT NULL,
    calculation_mode varchar(16) NOT NULL,
    application_stage varchar(32) NOT NULL,
    description text,
    status varchar(16) NOT NULL DEFAULT 'ENABLED',
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_modifier_zones PRIMARY KEY (game_id, modifier_zone_key),
    CONSTRAINT fk_modifier_zones_game
        FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_modifier_zones_key
        CHECK (modifier_zone_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_modifier_zones_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_modifier_zones_domain
        CHECK (domain IN ('ATTRIBUTE', 'DAMAGE', 'HEALING')),
    CONSTRAINT ck_modifier_zones_calculation_mode
        CHECK (calculation_mode IN ('FLAT_ADD', 'RATIO_ADD')),
    CONSTRAINT ck_modifier_zones_application_stage
        CHECK (application_stage IN (
            'ATTRIBUTE_FLAT', 'ATTRIBUTE_PERCENT',
            'DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE', 'HEALING_RESULT'
        )),
    CONSTRAINT ck_modifier_zones_combination
        CHECK (
            (domain = 'ATTRIBUTE' AND calculation_mode = 'FLAT_ADD'
                AND application_stage = 'ATTRIBUTE_FLAT')
            OR (domain = 'ATTRIBUTE' AND calculation_mode = 'RATIO_ADD'
                AND application_stage = 'ATTRIBUTE_PERCENT')
            OR (domain = 'DAMAGE' AND calculation_mode = 'RATIO_ADD'
                AND application_stage IN ('DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE'))
            OR (domain = 'HEALING' AND calculation_mode = 'RATIO_ADD'
                AND application_stage = 'HEALING_RESULT')
        ),
    CONSTRAINT ck_modifier_zones_status
        CHECK (status IN ('ENABLED', 'DISABLED')),
    CONSTRAINT ck_modifier_zones_sort_order
        CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX uq_modifier_zones_name
    ON public.modifier_zones (game_id, lower(btrim(name)));

COMMENT ON TABLE public.modifier_zones IS '属性、伤害与治疗修正乘区';

CREATE TABLE public.statuses (
    game_id varchar(64) NOT NULL,
    status_key varchar(64) NOT NULL,
    status_kind varchar(32) NOT NULL,
    name varchar(100) NOT NULL,
    description varchar(2000),
    status varchar(16) NOT NULL DEFAULT 'ENABLED',
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_statuses PRIMARY KEY (game_id, status_key),
    CONSTRAINT fk_statuses_game FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_statuses_key CHECK (status_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_statuses_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_statuses_kind CHECK (status_kind IN ('STUN', 'MOVEMENT_SLOW', 'ROOT')),
    CONSTRAINT ck_statuses_status CHECK (status IN ('ENABLED', 'DISABLED')),
    CONSTRAINT ck_statuses_sort_order CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX uq_statuses_name
    ON public.statuses (game_id, lower(btrim(name)));

COMMENT ON TABLE public.statuses IS '状态';
COMMENT ON COLUMN public.statuses.status_kind IS '状态行为身份：眩晕、普通移动减速或禁锢；创建后不可改';

CREATE TABLE public.skill_effects (
    results jsonb NOT NULL DEFAULT '[]'::jsonb,
    lifecycle jsonb,
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description varchar(2000),
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skill_effects
        PRIMARY KEY (game_id, skill_key, effect_key),
    CONSTRAINT fk_skill_effects_skill
        FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key),
    CONSTRAINT ck_skill_effects_key
        CHECK (effect_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_effects_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_effects_sort_order
        CHECK (sort_order >= 0)
);

CREATE INDEX ix_skill_effects_list
    ON public.skill_effects (game_id, skill_key, sort_order, effect_key);

COMMENT ON TABLE public.skill_effects IS '技能效果';

CREATE TABLE public.skill_internal_states (
    detail jsonb NOT NULL,
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    state_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    state_type varchar(24) NOT NULL,
    scope varchar(16) NOT NULL,
    description varchar(2000),
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skill_internal_states
        PRIMARY KEY (game_id, skill_key, state_key),
    CONSTRAINT fk_skill_internal_states_skill
        FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key),
    CONSTRAINT ck_skill_internal_states_key
        CHECK (state_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_internal_states_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_internal_states_type
        CHECK (state_type IN (
            'COUNTER', 'AMMO', 'MODE', 'FLAG', 'INTERNAL_COOLDOWN'
        )),
    CONSTRAINT ck_skill_internal_states_scope
        CHECK (scope IN ('SKILL', 'TARGET')),
    CONSTRAINT ck_skill_internal_states_scope_type
        CHECK (state_type = 'COUNTER' OR scope = 'SKILL'),
    CONSTRAINT ck_skill_internal_states_sort_order
        CHECK (sort_order >= 0)
);

CREATE INDEX ix_skill_internal_states_list
    ON public.skill_internal_states (game_id, skill_key, sort_order, state_key);

COMMENT ON TABLE public.skill_internal_states IS '技能内部状态';

CREATE TABLE public.skill_processes (
    steps jsonb NOT NULL DEFAULT '[]'::jsonb,
    cooldown jsonb,
    effect_bindings jsonb NOT NULL DEFAULT '[]'::jsonb,
    state_operations jsonb NOT NULL DEFAULT '[]'::jsonb,
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    activation_type varchar(16) NOT NULL,
    description varchar(2000),
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skill_processes
        PRIMARY KEY (game_id, skill_key, process_key),
    CONSTRAINT fk_skill_processes_skill
        FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key),
    CONSTRAINT ck_skill_processes_key
        CHECK (process_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_processes_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_processes_activation
        CHECK (activation_type IN ('ACTIVE', 'PASSIVE', 'CONSUMABLE')),
    CONSTRAINT ck_skill_processes_sort_order
        CHECK (sort_order >= 0)
);

CREATE INDEX ix_skill_processes_list
    ON public.skill_processes (game_id, skill_key, sort_order, process_key);

COMMENT ON TABLE public.skill_processes IS '技能过程';

CREATE TABLE public.skill_trigger_rules (
    event_source jsonb NOT NULL,
    condition_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
    actions jsonb NOT NULL DEFAULT '[]'::jsonb,
    limits jsonb NOT NULL DEFAULT '{}'::jsonb,
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description varchar(1000),
    sort_order integer NOT NULL DEFAULT 0,
    event_type varchar(32) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_skill_trigger_rules
        PRIMARY KEY (game_id, skill_key, rule_key),
    CONSTRAINT fk_skill_trigger_rules_skill
        FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key),
    CONSTRAINT ck_skill_trigger_rules_key
        CHECK (rule_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_trigger_rules_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_trigger_rules_sort_order
        CHECK (sort_order >= 0 AND sort_order <= 999999),
    CONSTRAINT ck_skill_trigger_rules_event_type
        CHECK (event_type IN (
            'SOURCE_INITIALIZED', 'SKILL_USED', 'BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'SKILL_HIT',
            'PROCESS_MOMENT', 'RESULT_AVAILABLE', 'LIFECYCLE_MOMENT',
            'DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN', 'STATUS_CHANGED',
            'HEALTH_THRESHOLD_CROSSED', 'INTERNAL_STATE_CHANGED',
            'CONTROL_RECEIVED', 'ENTITY_DIED', 'ENTITY_UNTARGETABLE',
            'KILL', 'PROCESS_CANCEL_REQUESTED', 'SPELL_SHIELD_BLOCKED',
            'HIT_LINK_APPLIED', 'ATTACK_LINK_APPLIED'
        ))
);

CREATE INDEX ix_skill_trigger_rules_list
    ON public.skill_trigger_rules (game_id, skill_key, sort_order, rule_key);

CREATE INDEX ix_skill_trigger_rules_event_type
    ON public.skill_trigger_rules (game_id, skill_key, event_type, rule_key);

COMMENT ON TABLE public.skill_trigger_rules IS '技能触发规则';

CREATE TABLE public.images (
    game_id varchar(64) NOT NULL,
    image_key varchar(128) NOT NULL,
    name varchar(100) NOT NULL,
    description varchar(2000),
    image_base64 text NOT NULL,
    mime_type varchar(32) NOT NULL,
    byte_size integer NOT NULL,
    width smallint NOT NULL,
    height smallint NOT NULL,
    enabled boolean NOT NULL DEFAULT TRUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_images PRIMARY KEY (game_id, image_key),
    CONSTRAINT fk_images_game FOREIGN KEY (game_id) REFERENCES public.games(game_id),
    CONSTRAINT ck_images_key CHECK (
        image_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    ),
    CONSTRAINT ck_images_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_images_mime_type CHECK (mime_type IN ('image/png', 'image/jpeg')),
    CONSTRAINT ck_images_byte_size CHECK (byte_size BETWEEN 1 AND 262144),
    CONSTRAINT ck_images_width CHECK (width BETWEEN 1 AND 64),
    CONSTRAINT ck_images_height CHECK (height BETWEEN 1 AND 64)
) PARTITION BY LIST (game_id);

CREATE UNIQUE INDEX uq_images_name
    ON public.images (game_id, lower(btrim(name)));

COMMENT ON TABLE public.images IS '图片资源表（保存最大64x64的Base64图片，不纳入版本管理）';
COMMENT ON COLUMN public.images.image_key IS '同一游戏内稳定且不可修改的图片标识';
COMMENT ON COLUMN public.images.name IS '同一游戏内忽略大小写唯一的图片名称';
COMMENT ON COLUMN public.images.image_base64 IS '已由客户端处理且通过后端校验的PNG或JPEG数据地址';
COMMENT ON COLUMN public.images.mime_type IS '后端从图片内容识别的真实媒体类型';
COMMENT ON COLUMN public.images.byte_size IS 'Base64解码后的文件字节数';

-- 阶段 9：角色、装备的技能挂载和七类代表图片。
CREATE TABLE public.character_skill_relations (
    game_id varchar(64) NOT NULL,
    character_key varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_character_skill_relations PRIMARY KEY (game_id, character_key, skill_key),
    CONSTRAINT fk_character_skill_relations_character FOREIGN KEY (game_id, character_key)
        REFERENCES public.characters (game_id, character_key) ON DELETE CASCADE,
    CONSTRAINT fk_character_skill_relations_skill FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key) ON DELETE RESTRICT,
    CONSTRAINT ck_character_skill_relations_sort_order CHECK (sort_order >= 0)
);
CREATE INDEX ix_character_skill_relations_skill
    ON public.character_skill_relations (skill_key, game_id, character_key);
COMMENT ON TABLE public.character_skill_relations IS '角色挂载技能';

CREATE TABLE public.equipment_skill_relations (
    game_id varchar(64) NOT NULL,
    equipment_key varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_equipment_skill_relations PRIMARY KEY (game_id, equipment_key, skill_key),
    CONSTRAINT fk_equipment_skill_relations_equipment FOREIGN KEY (game_id, equipment_key)
        REFERENCES public.equipment (game_id, equipment_key) ON DELETE CASCADE,
    CONSTRAINT fk_equipment_skill_relations_skill FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key) ON DELETE RESTRICT,
    CONSTRAINT ck_equipment_skill_relations_sort_order CHECK (sort_order >= 0)
);
CREATE INDEX ix_equipment_skill_relations_skill
    ON public.equipment_skill_relations (skill_key, game_id, equipment_key);
COMMENT ON TABLE public.equipment_skill_relations IS '装备挂载技能';

CREATE TABLE public.image_relations (
    game_id varchar(64) NOT NULL,
    source_type varchar(16) NOT NULL,
    source_parent_key varchar(64) NOT NULL,
    source_key varchar(64) NOT NULL,
    image_key varchar(128) NOT NULL,
    CONSTRAINT pk_image_relations PRIMARY KEY (game_id, source_type, source_parent_key, source_key),
    CONSTRAINT ck_image_relations_source_type
        CHECK (source_type IN ('GAME', 'CHARACTER', 'ATTRIBUTE', 'EQUIPMENT', 'SKILL', 'SKILL_EFFECT', 'STATUS', 'RUNE', 'RUNE_PATH')),
    CONSTRAINT ck_image_relations_parent
        CHECK ((source_type = 'SKILL_EFFECT' AND btrim(source_parent_key) <> '')
            OR (source_type <> 'SKILL_EFFECT' AND source_parent_key = '')),
    CONSTRAINT ck_image_relations_source_key CHECK (btrim(source_key) <> ''),
    CONSTRAINT ck_image_relations_game CHECK (source_type <> 'GAME' OR source_key = game_id),
    CONSTRAINT ck_image_relations_image_key CHECK (btrim(image_key) <> '')
);
CREATE INDEX ix_image_relations_image ON public.image_relations (game_id, image_key, source_type);
COMMENT ON TABLE public.image_relations IS '代表图片关联；无外键，由后端校验存在性并在来源删除时清理';

ALTER TABLE public.skill_formulas ADD CONSTRAINT ck_skill_formulas_expression CHECK (jsonb_typeof(expression) = 'object');
ALTER TABLE public.skill_effects ADD CONSTRAINT ck_skill_effects_results_array CHECK (jsonb_typeof(results) = 'array');
ALTER TABLE public.skill_effects ADD CONSTRAINT ck_skill_effects_lifecycle_object CHECK (lifecycle IS NULL OR jsonb_typeof(lifecycle) = 'object');
ALTER TABLE public.skill_internal_states ADD CONSTRAINT ck_skill_internal_states_detail_object
    CHECK (jsonb_typeof(detail) = 'object');
ALTER TABLE public.skill_processes ADD CONSTRAINT ck_skill_processes_steps_array CHECK (jsonb_typeof(steps) = 'array');
ALTER TABLE public.skill_processes ADD CONSTRAINT ck_skill_processes_cooldown_object CHECK (cooldown IS NULL OR jsonb_typeof(cooldown) = 'object');
ALTER TABLE public.skill_processes ADD CONSTRAINT ck_skill_processes_bindings_array CHECK (jsonb_typeof(effect_bindings) = 'array');
ALTER TABLE public.skill_processes ADD CONSTRAINT ck_skill_processes_operations_array CHECK (jsonb_typeof(state_operations) = 'array');
ALTER TABLE public.skill_trigger_rules ADD CONSTRAINT ck_skill_trigger_rules_event_source_object CHECK (jsonb_typeof(event_source) = 'object');
ALTER TABLE public.skill_trigger_rules ADD CONSTRAINT ck_skill_trigger_rules_condition_groups_array CHECK (jsonb_typeof(condition_groups) = 'array');
ALTER TABLE public.skill_trigger_rules ADD CONSTRAINT ck_skill_trigger_rules_actions_array CHECK (jsonb_typeof(actions) = 'array');
ALTER TABLE public.skill_trigger_rules ADD CONSTRAINT ck_skill_trigger_rules_limits_object CHECK (jsonb_typeof(limits) = 'object');

-- 系统派生的引用明细，没有独立业务编辑入口；由游戏配置写事务整体重建。
CREATE TABLE public.skill_object_references (
    game_id varchar(64) NOT NULL,
    source_skill_key varchar(64) NOT NULL,
    source_type varchar(16) NOT NULL,
    source_key varchar(64) NOT NULL,
    field_path text NOT NULL,
    target_type varchar(16) NOT NULL,
    target_skill_key varchar(64) NOT NULL,
    target_key varchar(64) NOT NULL,
    target_sub_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_object_references PRIMARY KEY (
        game_id, source_skill_key, source_type, source_key, field_path,
        target_type, target_skill_key, target_key, target_sub_key
    ),
    CONSTRAINT fk_skill_object_references_game FOREIGN KEY (game_id)
        REFERENCES public.games (game_id) ON DELETE CASCADE,
    CONSTRAINT fk_skill_object_references_skill FOREIGN KEY (game_id, source_skill_key)
        REFERENCES public.skills (game_id, skill_key) ON DELETE CASCADE,
    CONSTRAINT ck_skill_object_references_source_type CHECK (
        source_type IN ('FORMULA', 'EFFECT', 'STATE', 'PROCESS', 'TRIGGER')
    ),
    CONSTRAINT ck_skill_object_references_target_type CHECK (
        target_type IN ('ATTRIBUTE', 'PARAMETER', 'FORMULA', 'SKILL', 'CATEGORY', 'DAMAGE_TYPE',
            'MODIFIER_ZONE', 'STATUS', 'EFFECT', 'RESULT', 'LIFECYCLE', 'STATE', 'OPTION',
            'PROCESS', 'STEP', 'ACTION')
    ),
    CONSTRAINT ck_skill_object_references_path CHECK (btrim(field_path) <> ''),
    CONSTRAINT ck_skill_object_references_target CHECK (btrim(target_key) <> '')
);

CREATE INDEX ix_skill_object_references_target ON public.skill_object_references
    (game_id, target_type, target_skill_key, target_key, target_sub_key);

COMMENT ON TABLE public.skill_object_references IS '从技能组成提取的系统引用明细';

CREATE TABLE public.runes (
    game_id varchar(64) NOT NULL,
    rune_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    category varchar(16) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_runes PRIMARY KEY (game_id, rune_key),
    CONSTRAINT fk_runes_game FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_runes_key CHECK (rune_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_runes_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_runes_description CHECK (description IS NULL OR length(description) <= 2000),
    CONSTRAINT ck_runes_category CHECK (category IN ('KEYSTONE', 'MINOR', 'SHARD'))
);
CREATE UNIQUE INDEX uq_runes_name ON public.runes (game_id, lower(btrim(name)));
COMMENT ON TABLE public.runes IS '符文及属性碎片身份；不保存玩家选择';

CREATE TABLE public.rune_paths (
    game_id varchar(64) NOT NULL,
    path_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    description text,
    kind varchar(16) NOT NULL,
    sort_order integer NOT NULL,
    slots jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_rune_paths PRIMARY KEY (game_id, path_key),
    CONSTRAINT fk_rune_paths_game FOREIGN KEY (game_id) REFERENCES public.games (game_id),
    CONSTRAINT ck_rune_paths_key CHECK (path_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_rune_paths_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_rune_paths_description CHECK (description IS NULL OR length(description) <= 2000),
    CONSTRAINT ck_rune_paths_kind CHECK (kind IN ('RUNE_PATH', 'SHARD_GROUP')),
    CONSTRAINT ck_rune_paths_sort_order CHECK (sort_order >= 0),
    CONSTRAINT ck_rune_paths_slots CHECK (jsonb_typeof(slots) = 'array')
);
CREATE UNIQUE INDEX uq_rune_paths_name ON public.rune_paths (game_id, lower(btrim(name)));
COMMENT ON TABLE public.rune_paths IS '符文系或碎片组；slots 为有序槽位与选项的唯一来源';

CREATE TABLE public.rune_skill_relations (
    game_id varchar(64) NOT NULL,
    rune_key varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_rune_skill_relations PRIMARY KEY (game_id, rune_key, skill_key),
    CONSTRAINT fk_rune_skill_relations_rune FOREIGN KEY (game_id, rune_key)
        REFERENCES public.runes (game_id, rune_key) ON DELETE CASCADE,
    CONSTRAINT fk_rune_skill_relations_skill FOREIGN KEY (game_id, skill_key)
        REFERENCES public.skills (game_id, skill_key) ON DELETE RESTRICT,
    CONSTRAINT ck_rune_skill_relations_sort_order CHECK (sort_order >= 0)
);
CREATE INDEX ix_rune_skill_relations_skill
    ON public.rune_skill_relations (game_id, skill_key, rune_key);
COMMENT ON TABLE public.rune_skill_relations IS '符文挂载技能；删除符文只清挂载，保留共享技能';
