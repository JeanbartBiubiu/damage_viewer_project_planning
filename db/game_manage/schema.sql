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

CREATE TABLE public.statuses (
    game_id varchar(64) NOT NULL,
    status_key varchar(64) NOT NULL,
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
    CONSTRAINT ck_statuses_status CHECK (status IN ('ENABLED', 'DISABLED')),
    CONSTRAINT ck_statuses_sort_order CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX uq_statuses_name
    ON public.statuses (game_id, lower(btrim(name)));

COMMENT ON TABLE public.statuses IS '状态';

CREATE TABLE public.skill_effects (
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

CREATE TABLE public.skill_effect_results (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    result_type varchar(24) NOT NULL,
    target varchar(16) NOT NULL,
    description varchar(2000),
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_skill_effect_results
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_results_effect
        FOREIGN KEY (game_id, skill_key, effect_key)
        REFERENCES public.skill_effects (game_id, skill_key, effect_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_skill_effect_results_key
        CHECK (result_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_effect_results_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_effect_results_type
        CHECK (result_type IN (
            'DAMAGE', 'DIRECT_HEAL', 'NORMAL_SHIELD', 'ATTRIBUTE_CHANGE',
            'RESOURCE_CHANGE', 'COOLDOWN_CHANGE', 'STATUS_OPERATION',
            'LIFECYCLE_OPERATION'
        )),
    CONSTRAINT ck_skill_effect_results_target
        CHECK (target IN ('SOURCE', 'TARGET')),
    CONSTRAINT ck_skill_effect_results_sort_order
        CHECK (sort_order >= 0)
);

CREATE INDEX ix_skill_effect_results_list
    ON public.skill_effect_results
    (game_id, skill_key, effect_key, sort_order, result_key);

COMMENT ON TABLE public.skill_effect_results IS '技能效果结果';

CREATE TABLE public.skill_effect_result_values (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    formula_key varchar(64) NOT NULL,
    fixed_multiplier numeric NOT NULL DEFAULT 1,
    fixed_min_value numeric,
    fixed_max_value numeric,
    CONSTRAINT pk_skill_effect_result_values
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_result_values_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_result_values_formula
        FOREIGN KEY (game_id, skill_key, formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT ck_skill_effect_result_values_multiplier
        CHECK (fixed_multiplier >= 0),
    CONSTRAINT ck_skill_effect_result_values_bounds
        CHECK (
            fixed_min_value IS NULL
            OR fixed_max_value IS NULL
            OR fixed_min_value <= fixed_max_value
        )
);

CREATE INDEX ix_skill_effect_result_values_formula
    ON public.skill_effect_result_values
    (game_id, skill_key, formula_key, effect_key, result_key);

COMMENT ON TABLE public.skill_effect_result_values IS '技能效果结果数值规则';

CREATE TABLE public.skill_effect_damage_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    damage_type_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_effect_damage_details
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_damage_details_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_damage_details_damage_type
        FOREIGN KEY (game_id, damage_type_key)
        REFERENCES public.damage_types (game_id, damage_type_key)
);

CREATE INDEX ix_skill_effect_damage_details_type
    ON public.skill_effect_damage_details
    (game_id, damage_type_key, skill_key, effect_key, result_key);

COMMENT ON TABLE public.skill_effect_damage_details IS '伤害结果明细';

CREATE TABLE public.skill_effect_attribute_change_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    attribute_key varchar(64) NOT NULL,
    operation varchar(16) NOT NULL,
    CONSTRAINT pk_skill_effect_attribute_change_details
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_attribute_change_details_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_attribute_change_details_attribute
        FOREIGN KEY (game_id, attribute_key)
        REFERENCES public.attributes (game_id, attribute_key),
    CONSTRAINT ck_skill_effect_attribute_change_details_operation
        CHECK (operation IN ('INCREASE', 'DECREASE', 'SET'))
);

CREATE INDEX ix_skill_effect_attribute_change_details_attribute
    ON public.skill_effect_attribute_change_details
    (game_id, attribute_key, skill_key, effect_key, result_key);

COMMENT ON TABLE public.skill_effect_attribute_change_details IS '属性变化结果明细';

CREATE TABLE public.skill_effect_resource_change_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    attribute_key varchar(64) NOT NULL,
    operation varchar(16) NOT NULL,
    CONSTRAINT pk_skill_effect_resource_change_details
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_resource_change_details_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_resource_change_details_attribute
        FOREIGN KEY (game_id, attribute_key)
        REFERENCES public.attributes (game_id, attribute_key),
    CONSTRAINT ck_skill_effect_resource_change_details_operation
        CHECK (operation IN ('RESTORE', 'CONSUME', 'REFUND'))
);

CREATE INDEX ix_skill_effect_resource_change_details_attribute
    ON public.skill_effect_resource_change_details
    (game_id, attribute_key, skill_key, effect_key, result_key);

COMMENT ON TABLE public.skill_effect_resource_change_details IS '资源变化结果明细';

CREATE TABLE public.skill_effect_cooldown_change_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    affected_skill_key varchar(64) NOT NULL,
    operation varchar(16) NOT NULL,
    CONSTRAINT pk_skill_effect_cooldown_change_details
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_cooldown_change_details_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_cooldown_change_details_skill
        FOREIGN KEY (game_id, affected_skill_key)
        REFERENCES public.skills (game_id, skill_key),
    CONSTRAINT ck_skill_effect_cooldown_change_details_operation
        CHECK (operation IN ('REDUCE', 'INCREASE', 'RESET'))
);

CREATE INDEX ix_skill_effect_cooldown_change_details_skill
    ON public.skill_effect_cooldown_change_details
    (game_id, affected_skill_key, skill_key, effect_key, result_key);

COMMENT ON TABLE public.skill_effect_cooldown_change_details IS '冷却变化结果明细';

CREATE TABLE public.skill_effect_status_operation_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    status_key varchar(64) NOT NULL,
    operation varchar(16) NOT NULL,
    CONSTRAINT pk_skill_effect_status_operation_details
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_status_operation_details_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_status_operation_details_status
        FOREIGN KEY (game_id, status_key)
        REFERENCES public.statuses (game_id, status_key),
    CONSTRAINT ck_skill_effect_status_operation_details_operation
        CHECK (operation IN ('APPLY', 'REMOVE'))
);

CREATE INDEX ix_skill_effect_status_operation_details_status
    ON public.skill_effect_status_operation_details
    (game_id, status_key, skill_key, effect_key, result_key);

COMMENT ON TABLE public.skill_effect_status_operation_details IS '状态操作结果明细';

CREATE TABLE public.skill_effect_lifecycles (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    duration_formula_key varchar(64),
    max_stacks_formula_key varchar(64) NOT NULL,
    application_stacks_formula_key varchar(64) NOT NULL,
    instance_scope varchar(24) NOT NULL,
    reapplication_stack_mode varchar(24) NOT NULL,
    reapplication_duration_mode varchar(24),
    expiry_mode varchar(24) NOT NULL,
    periodic_interval_formula_key varchar(64),
    first_periodic_execution varchar(24),
    CONSTRAINT pk_skill_effect_lifecycles
        PRIMARY KEY (game_id, skill_key, effect_key),
    CONSTRAINT fk_skill_effect_lifecycles_effect
        FOREIGN KEY (game_id, skill_key, effect_key)
        REFERENCES public.skill_effects (game_id, skill_key, effect_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_lifecycles_duration_formula
        FOREIGN KEY (game_id, skill_key, duration_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_effect_lifecycles_max_stacks_formula
        FOREIGN KEY (game_id, skill_key, max_stacks_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_effect_lifecycles_application_stacks_formula
        FOREIGN KEY (game_id, skill_key, application_stacks_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_effect_lifecycles_periodic_interval_formula
        FOREIGN KEY (game_id, skill_key, periodic_interval_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT ck_skill_effect_lifecycles_instance_scope
        CHECK (instance_scope IN ('SKILL', 'SOURCE', 'TARGET', 'SOURCE_TARGET')),
    CONSTRAINT ck_skill_effect_lifecycles_reapplication_stack_mode
        CHECK (reapplication_stack_mode IN ('KEEP', 'INCREASE', 'REPLACE')),
    CONSTRAINT ck_skill_effect_lifecycles_reapplication_duration_mode
        CHECK (
            reapplication_duration_mode IS NULL
            OR reapplication_duration_mode IN ('REFRESH_ALL', 'KEEP_REMAINING', 'INDEPENDENT')
        ),
    CONSTRAINT ck_skill_effect_lifecycles_expiry_mode
        CHECK (expiry_mode IN ('ALL_AT_ONCE', 'ONE_BY_ONE', 'INDEPENDENT', 'EXPLICIT_ONLY')),
    CONSTRAINT ck_skill_effect_lifecycles_first_periodic_execution
        CHECK (
            first_periodic_execution IS NULL
            OR first_periodic_execution IN ('IMMEDIATE', 'AFTER_INTERVAL')
        ),
    CONSTRAINT ck_skill_effect_lifecycles_duration_expiry
        CHECK (
            (
                duration_formula_key IS NULL
                AND expiry_mode = 'EXPLICIT_ONLY'
                AND reapplication_duration_mode IS NULL
            )
            OR (
                duration_formula_key IS NOT NULL
                AND expiry_mode <> 'EXPLICIT_ONLY'
                AND reapplication_duration_mode IS NOT NULL
            )
        ),
    CONSTRAINT ck_skill_effect_lifecycles_independent_pair
        CHECK (
            (reapplication_duration_mode = 'INDEPENDENT')
            = (expiry_mode = 'INDEPENDENT')
        ),
    CONSTRAINT ck_skill_effect_lifecycles_one_by_one
        CHECK (
            expiry_mode <> 'ONE_BY_ONE'
            OR reapplication_duration_mode IN ('REFRESH_ALL', 'KEEP_REMAINING')
        ),
    CONSTRAINT ck_skill_effect_lifecycles_periodic_pair
        CHECK (
            (periodic_interval_formula_key IS NULL)
            = (first_periodic_execution IS NULL)
        )
);

CREATE INDEX ix_skill_effect_lifecycles_duration_formula
    ON public.skill_effect_lifecycles
    (game_id, skill_key, duration_formula_key, effect_key);

CREATE INDEX ix_skill_effect_lifecycles_max_stacks_formula
    ON public.skill_effect_lifecycles
    (game_id, skill_key, max_stacks_formula_key, effect_key);

CREATE INDEX ix_skill_effect_lifecycles_application_stacks_formula
    ON public.skill_effect_lifecycles
    (game_id, skill_key, application_stacks_formula_key, effect_key);

CREATE INDEX ix_skill_effect_lifecycles_periodic_interval_formula
    ON public.skill_effect_lifecycles
    (game_id, skill_key, periodic_interval_formula_key, effect_key);

COMMENT ON TABLE public.skill_effect_lifecycles IS '技能效果生命周期';

CREATE TABLE public.skill_effect_result_lifecycle_behaviors (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    moment varchar(24) NOT NULL,
    value_read_mode varchar(24),
    stack_value_mode varchar(24),
    reapplication_value_mode varchar(24),
    periodic_execution_mode varchar(24),
    CONSTRAINT pk_skill_effect_result_lifecycle_behaviors
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_result_lifecycle_behaviors_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_skill_effect_result_lifecycle_behaviors_moment
        CHECK (moment IN (
            'APPLICATION', 'PERSISTENT', 'FULL_STACKS',
            'PERIODIC', 'NATURAL_END', 'EARLY_REMOVE'
        )),
    CONSTRAINT ck_skill_effect_result_lifecycle_behaviors_value_read_mode
        CHECK (
            value_read_mode IS NULL
            OR value_read_mode IN ('APPLICATION_SNAPSHOT', 'MOMENT_EVALUATION')
        ),
    CONSTRAINT ck_skill_effect_result_lifecycle_behaviors_stack_value_mode
        CHECK (
            stack_value_mode IS NULL
            OR stack_value_mode IN ('SHARED', 'PER_STACK')
        ),
    CONSTRAINT ck_skill_effect_result_lifecycle_behaviors_reapplication_value_mode
        CHECK (
            reapplication_value_mode IS NULL
            OR reapplication_value_mode IN ('KEEP', 'REPLACE', 'ADD')
        ),
    CONSTRAINT ck_skill_effect_result_lifecycle_behaviors_periodic_execution_mode
        CHECK (
            periodic_execution_mode IS NULL
            OR periodic_execution_mode IN ('ONCE_PER_INSTANCE', 'ONCE_PER_ACTIVE_STACK')
        )
);

COMMENT ON TABLE public.skill_effect_result_lifecycle_behaviors IS '技能效果结果生命周期行为';

CREATE TABLE public.skill_effect_lifecycle_operation_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    result_key varchar(64) NOT NULL,
    target_effect_key varchar(64) NOT NULL,
    operation varchar(24) NOT NULL,
    CONSTRAINT pk_skill_effect_lifecycle_operation_details
        PRIMARY KEY (game_id, skill_key, effect_key, result_key),
    CONSTRAINT fk_skill_effect_lifecycle_operation_details_result
        FOREIGN KEY (game_id, skill_key, effect_key, result_key)
        REFERENCES public.skill_effect_results
            (game_id, skill_key, effect_key, result_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_effect_lifecycle_operations_target
        FOREIGN KEY (game_id, skill_key, target_effect_key)
        REFERENCES public.skill_effect_lifecycles (game_id, skill_key, effect_key),
    CONSTRAINT ck_skill_effect_lifecycle_operation_details_operation
        CHECK (operation IN (
            'INCREASE', 'DECREASE', 'SET', 'REFRESH', 'CONSUME', 'REMOVE'
        )),
    CONSTRAINT ck_skill_effect_lifecycle_operation_details_not_self
        CHECK (target_effect_key <> effect_key)
);

CREATE INDEX ix_skill_effect_lifecycle_operations_target
    ON public.skill_effect_lifecycle_operation_details
    (game_id, skill_key, target_effect_key, effect_key, result_key);

COMMENT ON TABLE public.skill_effect_lifecycle_operation_details IS '生命周期操作结果明细';

CREATE TABLE public.skill_internal_states (
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

CREATE TABLE public.skill_internal_state_counter_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    state_key varchar(64) NOT NULL,
    initial_value_formula_key varchar(64) NOT NULL,
    max_value_formula_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_internal_state_counter_details
        PRIMARY KEY (game_id, skill_key, state_key),
    CONSTRAINT fk_skill_internal_state_counter_details_state
        FOREIGN KEY (game_id, skill_key, state_key)
        REFERENCES public.skill_internal_states (game_id, skill_key, state_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_internal_counter_initial_formula
        FOREIGN KEY (game_id, skill_key, initial_value_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_internal_counter_max_formula
        FOREIGN KEY (game_id, skill_key, max_value_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
);

CREATE INDEX ix_skill_internal_counter_initial_formula
    ON public.skill_internal_state_counter_details
    (game_id, skill_key, initial_value_formula_key, state_key);

CREATE INDEX ix_skill_internal_counter_max_formula
    ON public.skill_internal_state_counter_details
    (game_id, skill_key, max_value_formula_key, state_key);

COMMENT ON TABLE public.skill_internal_state_counter_details IS '技能内部计数状态明细';

CREATE TABLE public.skill_internal_state_ammo_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    state_key varchar(64) NOT NULL,
    initial_value_formula_key varchar(64) NOT NULL,
    max_value_formula_key varchar(64) NOT NULL,
    recovery_interval_formula_key varchar(64) NOT NULL,
    recovery_mode varchar(16) NOT NULL,
    CONSTRAINT pk_skill_internal_state_ammo_details
        PRIMARY KEY (game_id, skill_key, state_key),
    CONSTRAINT fk_skill_internal_state_ammo_details_state
        FOREIGN KEY (game_id, skill_key, state_key)
        REFERENCES public.skill_internal_states (game_id, skill_key, state_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_internal_ammo_initial_formula
        FOREIGN KEY (game_id, skill_key, initial_value_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_internal_ammo_max_formula
        FOREIGN KEY (game_id, skill_key, max_value_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_internal_ammo_recovery_formula
        FOREIGN KEY (game_id, skill_key, recovery_interval_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT ck_skill_internal_state_ammo_recovery_mode
        CHECK (recovery_mode IN ('ONE_BY_ONE', 'ALL_AT_ONCE'))
);

CREATE INDEX ix_skill_internal_ammo_initial_formula
    ON public.skill_internal_state_ammo_details
    (game_id, skill_key, initial_value_formula_key, state_key);

CREATE INDEX ix_skill_internal_ammo_max_formula
    ON public.skill_internal_state_ammo_details
    (game_id, skill_key, max_value_formula_key, state_key);

CREATE INDEX ix_skill_internal_ammo_recovery_formula
    ON public.skill_internal_state_ammo_details
    (game_id, skill_key, recovery_interval_formula_key, state_key);

COMMENT ON TABLE public.skill_internal_state_ammo_details IS '技能内部弹药状态明细';

CREATE TABLE public.skill_internal_state_flag_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    state_key varchar(64) NOT NULL,
    initial_enabled boolean NOT NULL,
    CONSTRAINT pk_skill_internal_state_flag_details
        PRIMARY KEY (game_id, skill_key, state_key),
    CONSTRAINT fk_skill_internal_state_flag_details_state
        FOREIGN KEY (game_id, skill_key, state_key)
        REFERENCES public.skill_internal_states (game_id, skill_key, state_key)
        ON DELETE CASCADE
);

COMMENT ON TABLE public.skill_internal_state_flag_details IS '技能内部准备标记明细';

CREATE TABLE public.skill_internal_state_cooldown_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    state_key varchar(64) NOT NULL,
    duration_formula_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_internal_state_cooldown_details
        PRIMARY KEY (game_id, skill_key, state_key),
    CONSTRAINT fk_skill_internal_state_cooldown_details_state
        FOREIGN KEY (game_id, skill_key, state_key)
        REFERENCES public.skill_internal_states (game_id, skill_key, state_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_internal_cooldown_duration_formula
        FOREIGN KEY (game_id, skill_key, duration_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
);

CREATE INDEX ix_skill_internal_cooldown_duration_formula
    ON public.skill_internal_state_cooldown_details
    (game_id, skill_key, duration_formula_key, state_key);

COMMENT ON TABLE public.skill_internal_state_cooldown_details IS '技能内部冷却明细';

CREATE TABLE public.skill_internal_state_mode_options (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    state_key varchar(64) NOT NULL,
    option_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    initial boolean NOT NULL,
    CONSTRAINT pk_skill_internal_state_mode_options
        PRIMARY KEY (game_id, skill_key, state_key, option_key),
    CONSTRAINT fk_skill_internal_state_mode_options_state
        FOREIGN KEY (game_id, skill_key, state_key)
        REFERENCES public.skill_internal_states (game_id, skill_key, state_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_skill_internal_state_mode_options_key
        CHECK (option_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_internal_state_mode_options_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_internal_state_mode_options_sort_order
        CHECK (sort_order >= 0)
);

CREATE INDEX ix_skill_internal_state_mode_options_list
    ON public.skill_internal_state_mode_options
    (game_id, skill_key, state_key, sort_order, option_key);

COMMENT ON TABLE public.skill_internal_state_mode_options IS '技能内部模式选项';

CREATE TABLE public.skill_processes (
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

CREATE TABLE public.skill_process_steps (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    step_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    step_type varchar(32) NOT NULL,
    description varchar(2000),
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_skill_process_steps
        PRIMARY KEY (game_id, skill_key, process_key, step_key),
    CONSTRAINT fk_skill_process_steps_process
        FOREIGN KEY (game_id, skill_key, process_key)
        REFERENCES public.skill_processes (game_id, skill_key, process_key)
        ON DELETE CASCADE,
    CONSTRAINT ck_skill_process_steps_key
        CHECK (step_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_process_steps_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_process_steps_type
        CHECK (step_type IN (
            'IMMEDIATE', 'DELAY', 'MULTI_HIT', 'PERIODIC',
            'CHANNEL', 'CHARGE', 'RECAST', 'EMPOWERED_BASIC_ATTACK'
        )),
    CONSTRAINT ck_skill_process_steps_sort_order
        CHECK (sort_order >= 0)
);

CREATE INDEX ix_skill_process_steps_list
    ON public.skill_process_steps
    (game_id, skill_key, process_key, sort_order, step_key);

COMMENT ON TABLE public.skill_process_steps IS '技能过程步骤';

CREATE TABLE public.skill_process_delay_step_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    step_key varchar(64) NOT NULL,
    delay_formula_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_process_delay_step_details
        PRIMARY KEY (game_id, skill_key, process_key, step_key),
    CONSTRAINT fk_skill_process_delay_step_details_step
        FOREIGN KEY (game_id, skill_key, process_key, step_key)
        REFERENCES public.skill_process_steps
            (game_id, skill_key, process_key, step_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_process_delay_formula
        FOREIGN KEY (game_id, skill_key, delay_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
);

CREATE INDEX ix_skill_process_delay_formula
    ON public.skill_process_delay_step_details
    (game_id, skill_key, delay_formula_key, process_key, step_key);

COMMENT ON TABLE public.skill_process_delay_step_details IS '延迟步骤明细';

CREATE TABLE public.skill_process_multi_hit_step_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    step_key varchar(64) NOT NULL,
    repeat_count_formula_key varchar(64) NOT NULL,
    interval_formula_key varchar(64),
    CONSTRAINT pk_skill_process_multi_hit_step_details
        PRIMARY KEY (game_id, skill_key, process_key, step_key),
    CONSTRAINT fk_skill_process_multi_hit_step_details_step
        FOREIGN KEY (game_id, skill_key, process_key, step_key)
        REFERENCES public.skill_process_steps
            (game_id, skill_key, process_key, step_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_process_multi_count_formula
        FOREIGN KEY (game_id, skill_key, repeat_count_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_process_multi_interval_formula
        FOREIGN KEY (game_id, skill_key, interval_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
        MATCH SIMPLE
);

CREATE INDEX ix_skill_process_multi_count_formula
    ON public.skill_process_multi_hit_step_details
    (game_id, skill_key, repeat_count_formula_key, process_key, step_key);

CREATE INDEX ix_skill_process_multi_interval_formula
    ON public.skill_process_multi_hit_step_details
    (game_id, skill_key, interval_formula_key, process_key, step_key);

COMMENT ON TABLE public.skill_process_multi_hit_step_details IS '多段步骤明细';

CREATE TABLE public.skill_process_periodic_step_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    step_key varchar(64) NOT NULL,
    repeat_count_formula_key varchar(64) NOT NULL,
    interval_formula_key varchar(64) NOT NULL,
    first_execution varchar(16) NOT NULL,
    CONSTRAINT pk_skill_process_periodic_step_details
        PRIMARY KEY (game_id, skill_key, process_key, step_key),
    CONSTRAINT fk_skill_process_periodic_step_details_step
        FOREIGN KEY (game_id, skill_key, process_key, step_key)
        REFERENCES public.skill_process_steps
            (game_id, skill_key, process_key, step_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_process_periodic_count_formula
        FOREIGN KEY (game_id, skill_key, repeat_count_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_process_periodic_interval_formula
        FOREIGN KEY (game_id, skill_key, interval_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT ck_skill_process_periodic_first_execution
        CHECK (first_execution IN ('IMMEDIATE', 'AFTER_INTERVAL'))
);

CREATE INDEX ix_skill_process_periodic_count_formula
    ON public.skill_process_periodic_step_details
    (game_id, skill_key, repeat_count_formula_key, process_key, step_key);

CREATE INDEX ix_skill_process_periodic_interval_formula
    ON public.skill_process_periodic_step_details
    (game_id, skill_key, interval_formula_key, process_key, step_key);

COMMENT ON TABLE public.skill_process_periodic_step_details IS '周期步骤明细';

CREATE TABLE public.skill_process_channel_step_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    step_key varchar(64) NOT NULL,
    duration_formula_key varchar(64) NOT NULL,
    execution_count_formula_key varchar(64) NOT NULL,
    first_execution varchar(16) NOT NULL,
    CONSTRAINT pk_skill_process_channel_step_details
        PRIMARY KEY (game_id, skill_key, process_key, step_key),
    CONSTRAINT fk_skill_process_channel_step_details_step
        FOREIGN KEY (game_id, skill_key, process_key, step_key)
        REFERENCES public.skill_process_steps
            (game_id, skill_key, process_key, step_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_process_channel_duration_formula
        FOREIGN KEY (game_id, skill_key, duration_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_process_channel_count_formula
        FOREIGN KEY (game_id, skill_key, execution_count_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT ck_skill_process_channel_first_execution
        CHECK (first_execution IN ('IMMEDIATE', 'AFTER_INTERVAL'))
);

CREATE INDEX ix_skill_process_channel_duration_formula
    ON public.skill_process_channel_step_details
    (game_id, skill_key, duration_formula_key, process_key, step_key);

CREATE INDEX ix_skill_process_channel_count_formula
    ON public.skill_process_channel_step_details
    (game_id, skill_key, execution_count_formula_key, process_key, step_key);

COMMENT ON TABLE public.skill_process_channel_step_details IS '引导步骤明细';

CREATE TABLE public.skill_process_charge_step_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    step_key varchar(64) NOT NULL,
    minimum_charge_formula_key varchar(64) NOT NULL,
    maximum_charge_formula_key varchar(64) NOT NULL,
    release_at_maximum boolean NOT NULL,
    CONSTRAINT pk_skill_process_charge_step_details
        PRIMARY KEY (game_id, skill_key, process_key, step_key),
    CONSTRAINT fk_skill_process_charge_step_details_step
        FOREIGN KEY (game_id, skill_key, process_key, step_key)
        REFERENCES public.skill_process_steps
            (game_id, skill_key, process_key, step_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_process_charge_min_formula
        FOREIGN KEY (game_id, skill_key, minimum_charge_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_process_charge_max_formula
        FOREIGN KEY (game_id, skill_key, maximum_charge_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
);

CREATE INDEX ix_skill_process_charge_min_formula
    ON public.skill_process_charge_step_details
    (game_id, skill_key, minimum_charge_formula_key, process_key, step_key);

CREATE INDEX ix_skill_process_charge_max_formula
    ON public.skill_process_charge_step_details
    (game_id, skill_key, maximum_charge_formula_key, process_key, step_key);

COMMENT ON TABLE public.skill_process_charge_step_details IS '蓄力步骤明细';

CREATE TABLE public.skill_process_recast_step_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    step_key varchar(64) NOT NULL,
    window_formula_key varchar(64) NOT NULL,
    maximum_recast_count_formula_key varchar(64) NOT NULL,
    CONSTRAINT pk_skill_process_recast_step_details
        PRIMARY KEY (game_id, skill_key, process_key, step_key),
    CONSTRAINT fk_skill_process_recast_step_details_step
        FOREIGN KEY (game_id, skill_key, process_key, step_key)
        REFERENCES public.skill_process_steps
            (game_id, skill_key, process_key, step_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_process_recast_window_formula
        FOREIGN KEY (game_id, skill_key, window_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_process_recast_count_formula
        FOREIGN KEY (game_id, skill_key, maximum_recast_count_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
);

CREATE INDEX ix_skill_process_recast_window_formula
    ON public.skill_process_recast_step_details
    (game_id, skill_key, window_formula_key, process_key, step_key);

CREATE INDEX ix_skill_process_recast_count_formula
    ON public.skill_process_recast_step_details
    (game_id, skill_key, maximum_recast_count_formula_key, process_key, step_key);

COMMENT ON TABLE public.skill_process_recast_step_details IS '重施步骤明细';

CREATE TABLE public.skill_process_empowered_attack_step_details (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    step_key varchar(64) NOT NULL,
    window_formula_key varchar(64) NOT NULL,
    consume_moment varchar(16) NOT NULL,
    CONSTRAINT pk_skill_process_empowered_attack_step_details
        PRIMARY KEY (game_id, skill_key, process_key, step_key),
    CONSTRAINT fk_skill_process_empowered_attack_step_details_step
        FOREIGN KEY (game_id, skill_key, process_key, step_key)
        REFERENCES public.skill_process_steps
            (game_id, skill_key, process_key, step_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_process_empowered_window_formula
        FOREIGN KEY (game_id, skill_key, window_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT ck_skill_process_empowered_consume_moment
        CHECK (consume_moment IN ('ATTACK_START', 'ATTACK_HIT'))
);

CREATE INDEX ix_skill_process_empowered_window_formula
    ON public.skill_process_empowered_attack_step_details
    (game_id, skill_key, window_formula_key, process_key, step_key);

COMMENT ON TABLE public.skill_process_empowered_attack_step_details IS '强化下一次普通攻击步骤明细';

CREATE TABLE public.skill_process_cooldowns (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    duration_formula_key varchar(64) NOT NULL,
    moment_type varchar(24) NOT NULL,
    step_key varchar(64),
    CONSTRAINT pk_skill_process_cooldowns
        PRIMARY KEY (game_id, skill_key, process_key),
    CONSTRAINT fk_skill_process_cooldowns_process
        FOREIGN KEY (game_id, skill_key, process_key)
        REFERENCES public.skill_processes (game_id, skill_key, process_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_process_cooldown_duration_formula
        FOREIGN KEY (game_id, skill_key, duration_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key),
    CONSTRAINT fk_skill_process_cooldowns_step
        FOREIGN KEY (game_id, skill_key, process_key, step_key)
        REFERENCES public.skill_process_steps
            (game_id, skill_key, process_key, step_key)
        MATCH SIMPLE,
    CONSTRAINT ck_skill_process_cooldowns_moment
        CHECK (
            (
                moment_type IN ('PROCESS_START', 'PROCESS_COMPLETE', 'PROCESS_FAILURE')
                AND step_key IS NULL
            )
            OR (
                moment_type IN (
                    'STEP_START', 'STEP_EXECUTION', 'STEP_COMPLETE', 'STEP_TIMEOUT'
                )
                AND step_key IS NOT NULL
            )
        )
);

CREATE INDEX ix_skill_process_cooldown_duration_formula
    ON public.skill_process_cooldowns
    (game_id, skill_key, duration_formula_key, process_key);

CREATE INDEX ix_skill_process_cooldown_step
    ON public.skill_process_cooldowns
    (game_id, skill_key, process_key, step_key);

COMMENT ON TABLE public.skill_process_cooldowns IS '技能过程普通冷却';

CREATE TABLE public.skill_process_effect_bindings (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    binding_key varchar(64) NOT NULL,
    effect_key varchar(64) NOT NULL,
    moment_type varchar(24) NOT NULL,
    step_key varchar(64),
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_skill_process_effect_bindings
        PRIMARY KEY (game_id, skill_key, process_key, binding_key),
    CONSTRAINT fk_skill_process_effect_bindings_process
        FOREIGN KEY (game_id, skill_key, process_key)
        REFERENCES public.skill_processes (game_id, skill_key, process_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_process_effect_bindings_effect
        FOREIGN KEY (game_id, skill_key, effect_key)
        REFERENCES public.skill_effects (game_id, skill_key, effect_key),
    CONSTRAINT fk_skill_process_effect_bindings_step
        FOREIGN KEY (game_id, skill_key, process_key, step_key)
        REFERENCES public.skill_process_steps
            (game_id, skill_key, process_key, step_key)
        MATCH SIMPLE,
    CONSTRAINT ck_skill_process_effect_bindings_key
        CHECK (binding_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_process_effect_bindings_moment
        CHECK (
            (
                moment_type IN ('PROCESS_START', 'PROCESS_COMPLETE', 'PROCESS_FAILURE')
                AND step_key IS NULL
            )
            OR (
                moment_type IN (
                    'STEP_START', 'STEP_EXECUTION', 'STEP_COMPLETE', 'STEP_TIMEOUT'
                )
                AND step_key IS NOT NULL
            )
        ),
    CONSTRAINT ck_skill_process_effect_bindings_sort_order
        CHECK (sort_order >= 0)
);

CREATE INDEX ix_skill_process_effect_bindings_list
    ON public.skill_process_effect_bindings
    (game_id, skill_key, process_key, sort_order, binding_key);

CREATE INDEX ix_skill_process_effect_bindings_effect
    ON public.skill_process_effect_bindings
    (game_id, skill_key, effect_key, process_key, binding_key);

CREATE INDEX ix_skill_process_effect_bindings_step
    ON public.skill_process_effect_bindings
    (game_id, skill_key, process_key, step_key, binding_key);

CREATE INDEX ix_skill_process_effect_bindings_moment
    ON public.skill_process_effect_bindings
    (game_id, skill_key, process_key, moment_type, step_key, binding_key);

COMMENT ON TABLE public.skill_process_effect_bindings IS '技能过程效果挂接';

CREATE TABLE public.skill_process_state_operations (
    game_id varchar(64) NOT NULL,
    skill_key varchar(64) NOT NULL,
    process_key varchar(64) NOT NULL,
    operation_key varchar(64) NOT NULL,
    name varchar(100) NOT NULL,
    state_key varchar(64) NOT NULL,
    operation varchar(16) NOT NULL,
    value_formula_key varchar(64),
    option_key varchar(64),
    moment_type varchar(24) NOT NULL,
    step_key varchar(64),
    sort_order integer NOT NULL DEFAULT 0,
    CONSTRAINT pk_skill_process_state_operations
        PRIMARY KEY (game_id, skill_key, process_key, operation_key),
    CONSTRAINT fk_skill_process_state_operations_process
        FOREIGN KEY (game_id, skill_key, process_key)
        REFERENCES public.skill_processes (game_id, skill_key, process_key)
        ON DELETE CASCADE,
    CONSTRAINT fk_skill_process_state_operations_state
        FOREIGN KEY (game_id, skill_key, state_key)
        REFERENCES public.skill_internal_states (game_id, skill_key, state_key),
    CONSTRAINT fk_skill_process_state_operation_value_formula
        FOREIGN KEY (game_id, skill_key, value_formula_key)
        REFERENCES public.skill_formulas (game_id, skill_key, formula_key)
        MATCH SIMPLE,
    CONSTRAINT fk_skill_process_state_operations_option
        FOREIGN KEY (game_id, skill_key, state_key, option_key)
        REFERENCES public.skill_internal_state_mode_options
            (game_id, skill_key, state_key, option_key)
        MATCH SIMPLE,
    CONSTRAINT fk_skill_process_state_operations_step
        FOREIGN KEY (game_id, skill_key, process_key, step_key)
        REFERENCES public.skill_process_steps
            (game_id, skill_key, process_key, step_key)
        MATCH SIMPLE,
    CONSTRAINT ck_skill_process_state_operations_key
        CHECK (operation_key ~ '^[a-z][a-z0-9_]{0,63}$'),
    CONSTRAINT ck_skill_process_state_operations_name
        CHECK (btrim(name) <> ''),
    CONSTRAINT ck_skill_process_state_operations_operation
        CHECK (operation IN (
            'INCREASE', 'DECREASE', 'CONSUME', 'SET', 'RESET',
            'SELECT', 'ENABLE', 'DISABLE', 'TOGGLE', 'START'
        )),
    CONSTRAINT ck_skill_process_state_operations_moment
        CHECK (
            (
                moment_type IN ('PROCESS_START', 'PROCESS_COMPLETE', 'PROCESS_FAILURE')
                AND step_key IS NULL
            )
            OR (
                moment_type IN (
                    'STEP_START', 'STEP_EXECUTION', 'STEP_COMPLETE', 'STEP_TIMEOUT'
                )
                AND step_key IS NOT NULL
            )
        ),
    CONSTRAINT ck_skill_process_state_operations_sort_order
        CHECK (sort_order >= 0)
);

CREATE INDEX ix_skill_process_state_operations_list
    ON public.skill_process_state_operations
    (game_id, skill_key, process_key, sort_order, operation_key);

CREATE INDEX ix_skill_process_state_operations_state
    ON public.skill_process_state_operations
    (game_id, skill_key, state_key, process_key, operation_key);

CREATE INDEX ix_skill_process_state_operations_option
    ON public.skill_process_state_operations
    (game_id, skill_key, state_key, option_key, process_key, operation_key);

CREATE INDEX ix_skill_process_state_operation_value_formula
    ON public.skill_process_state_operations
    (game_id, skill_key, value_formula_key, process_key, operation_key);

CREATE INDEX ix_skill_process_state_operations_step
    ON public.skill_process_state_operations
    (game_id, skill_key, process_key, step_key, operation_key);

CREATE INDEX ix_skill_process_state_operations_moment
    ON public.skill_process_state_operations
    (game_id, skill_key, process_key, moment_type, step_key, operation_key);

COMMENT ON TABLE public.skill_process_state_operations IS '技能过程内部状态操作';

-- -----------------------------------------------------------------------------
-- 图片资源（按 game_id 列表分区；子分区由 ensure_game_partitions 幂等创建）
-- -----------------------------------------------------------------------------

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
