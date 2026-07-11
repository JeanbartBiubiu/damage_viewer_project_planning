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

CREATE TABLE public.game_versions (
    version_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    game_id varchar(64) NOT NULL REFERENCES public.games(game_id),
    version_code varchar(64) NOT NULL,
    release_date date,
    is_current boolean DEFAULT false,
    data_hash varchar(64),
    created_at timestamp DEFAULT NOW(),
    published_at timestamp,
    CONSTRAINT uq_game_versions UNIQUE (game_id, version_code),
    CONSTRAINT uq_game_versions_game_version_id UNIQUE (game_id, version_id)
);

COMMENT ON TABLE public.game_versions IS '游戏版本表（用于版本发布、前端轮询、发布快照索引）';
COMMENT ON COLUMN public.game_versions.version_id IS '内部版本自增 ID（用于发布记录与快照索引）';
COMMENT ON COLUMN public.game_versions.version_code IS '对外展示版本号（如 14.1）';
COMMENT ON COLUMN public.game_versions.is_current IS '是否为当前版本（用于前端轮询接口）';
COMMENT ON COLUMN public.game_versions.data_hash IS '历史遗留字段；当前发布快照链路不再对外暴露该 hash';

CREATE TABLE public.published_bundle_snapshots (
    game_id varchar(64) NOT NULL REFERENCES public.games(game_id),
    version_id bigint NOT NULL,
    version_code varchar(64) NOT NULL,
    bundle_json jsonb NOT NULL,
    created_at timestamp NOT NULL DEFAULT NOW(),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_published_bundle_snapshots PRIMARY KEY (game_id, version_code),
    CONSTRAINT uq_published_bundle_snapshots_version UNIQUE (game_id, version_id),
    CONSTRAINT fk_published_bundle_snapshots_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id)
);

COMMENT ON TABLE public.published_bundle_snapshots IS '已发布 bundle 快照表；Public 侧只读取这里的快照，不再从编辑工作区实时重建';
COMMENT ON COLUMN public.published_bundle_snapshots.version_code IS '对外版本号；Public 通过 gameId + versionCode 获取快照';
COMMENT ON COLUMN public.published_bundle_snapshots.bundle_json IS '发布时固化的完整 bundle JSON 快照';

CREATE TABLE public.game_progression_schema (
    game_id varchar(64) PRIMARY KEY REFERENCES public.games(game_id),
    progression_kind varchar(16) NOT NULL CHECK (progression_kind IN ('LEVEL', 'STAR')),
    stage_min int NOT NULL CHECK (stage_min >= 1),
    stage_max int NOT NULL CHECK (stage_max >= stage_min AND stage_max <= 100),
    stage_label varchar(32) NOT NULL,
    require_all_stages boolean NOT NULL DEFAULT true,
    updated_at timestamp NOT NULL DEFAULT NOW()
);

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
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
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
    CONSTRAINT fk_attribute_definitions_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_attribute_definitions_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.attribute_definitions IS '属性定义（原始表：1条记录覆盖一个版本区间，发布时更新 start/end）';
COMMENT ON COLUMN public.attribute_definitions.start_version_id IS '该记录覆盖区间的起始版本（含）';
COMMENT ON COLUMN public.attribute_definitions.end_version_id IS '该记录覆盖区间的结束版本（含）；有更新时发布版本区间为 [v,v]';
COMMENT ON COLUMN public.attribute_definitions.attr_key IS '属性 key（建议全局唯一且稳定，用于计算引擎与前端组装）';
COMMENT ON COLUMN public.attribute_definitions.sort_order IS '属性排序号（越小越靠前；同值按 attr_key 兜底）';
COMMENT ON COLUMN public.attribute_definitions.value_kind IS '属性值类别：scalar(普通数值)/ratio(比例)/rate(每秒速率)/flag(开关)';
COMMENT ON COLUMN public.attribute_definitions.rate_target_attr_key IS '仅 rate 生效：该速率作用到的目标属性 key（如 hp_regen -> hp）';
COMMENT ON COLUMN public.attribute_definitions.min_value IS '可选数值下界；与 default_value / max_value 一起在应用层校验';
COMMENT ON COLUMN public.attribute_definitions.max_value IS '可选数值上界；与 default_value / min_value 一起在应用层校验';

CREATE TABLE public.attribute_definitions_log (
    game_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
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
    CONSTRAINT pk_attribute_definitions_log PRIMARY KEY (game_id, attr_key, start_version_id),
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
    CONSTRAINT fk_attribute_definitions_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_attribute_definitions_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.attribute_definitions_log IS '属性定义日志表（用于多版本差异分析；按 id+start_version 唯一）';
COMMENT ON COLUMN public.attribute_definitions_log.min_value IS '可选数值下界快照';
COMMENT ON COLUMN public.attribute_definitions_log.max_value IS '可选数值上界快照';

CREATE TABLE public.reserved_type (
    type_id int NOT NULL,
    name varchar(100) NOT NULL,
    CONSTRAINT pk_reserved_type PRIMARY KEY (type_id)
);

CREATE TABLE public.reserved_type_relation (
    type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    parent_type_id int NOT NULL REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_reserved_type_relation PRIMARY KEY (type_id, parent_type_id)
);

COMMENT ON TABLE public.reserved_type IS '系统保留 type（全局通用；不纳入版本管理）';
COMMENT ON COLUMN public.reserved_type.type_id IS '保留 type ID（全局稳定）';
COMMENT ON TABLE public.reserved_type_relation IS '系统保留 type 的关系表（一般用于层级/分组）';

CREATE TABLE public.types (
    game_id varchar(64) NOT NULL,
    type_id int NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    name varchar(100),
    description varchar(255),
    reserved_type_id int REFERENCES public.reserved_type(type_id),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_types PRIMARY KEY (game_id, type_id),
    CONSTRAINT fk_types_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_types_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.types IS '业务 type 定义（原始表：1条记录覆盖一个版本区间，发布时更新 start/end）';
COMMENT ON COLUMN public.types.type_id IS 'type 唯一 ID（game 内唯一即可）';
COMMENT ON COLUMN public.types.reserved_type_id IS '可选：关联到系统保留 type，用于复用通用语义';
COMMENT ON COLUMN public.types.end_version_id IS '该记录覆盖区间的结束版本（含）；有更新时发布版本区间为 [v,v]';

CREATE TABLE public.types_log (
    game_id varchar(64) NOT NULL,
    type_id int NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    name varchar(100),
    description varchar(255),
    reserved_type_id int REFERENCES public.reserved_type(type_id),
    CONSTRAINT pk_types_log PRIMARY KEY (game_id, type_id, start_version_id),
    CONSTRAINT fk_types_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_types_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.types_log IS 'type 日志表（用于多版本差异分析；按 id+start_version 唯一）';

CREATE TABLE public.type_relations (
    game_id varchar(64) NOT NULL,
    type_id int NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    target_category varchar(32) NOT NULL CHECK (target_category IN ('equipment', 'attribute', 'skill', 'character', 'type')),
    target_id varchar(256) NOT NULL,
    extend jsonb,
    deleted boolean NOT NULL DEFAULT FALSE,
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_type_relations PRIMARY KEY (game_id, type_id, target_category, target_id),
    CONSTRAINT fk_type_relations_type FOREIGN KEY (game_id, type_id)
        REFERENCES public.types (game_id, type_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.type_relations IS 'type 关系/挂载表（原始表：1条记录覆盖一个版本区间，发布时更新 start/end）';
COMMENT ON COLUMN public.type_relations.target_category IS '目标类别：equipment/attribute/skill/character/type';
COMMENT ON COLUMN public.type_relations.target_id IS '目标 ID：item_id/attr_key/skill_id/hero_id/parent_type_id';
COMMENT ON COLUMN public.type_relations.extend IS '扩展字段（原设计 extend varchar，建议存结构化 JSON）';
COMMENT ON COLUMN public.type_relations.end_version_id IS '该记录覆盖区间的结束版本（含）；有更新时发布版本区间为 [v,v]';

CREATE TABLE public.type_relations_log (
    game_id varchar(64) NOT NULL,
    type_id int NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    target_category varchar(32) NOT NULL CHECK (target_category IN ('equipment', 'attribute', 'skill', 'character', 'type')),
    target_id varchar(256) NOT NULL,
    extend jsonb,
    deleted boolean NOT NULL DEFAULT FALSE,
    CONSTRAINT pk_type_relations_log PRIMARY KEY (game_id, type_id, target_category, target_id, start_version_id),
    CONSTRAINT fk_type_relations_log_type FOREIGN KEY (game_id, type_id)
        REFERENCES public.types (game_id, type_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.type_relations_log IS 'type 关系日志表（用于多版本差异分析；按复合 id+start_version 唯一）';

COMMENT ON COLUMN public.type_relations.deleted IS '软删除标记；TRUE 表示该关系已 tombstone，不参与读取与 bundle 构建，但保留用于发布差异记录';
COMMENT ON COLUMN public.type_relations_log.deleted IS '删除 tombstone 标记；TRUE 表示该版本点把当前关系移除';

CREATE TABLE public.owner_categories (
    game_id varchar(64) NOT NULL REFERENCES public.games(game_id),
    owner_type varchar(32) NOT NULL,
    name varchar(100),
    description varchar(255),
    created_at timestamp DEFAULT NOW(),
    updated_at timestamp DEFAULT NOW(),
    CONSTRAINT pk_owner_categories PRIMARY KEY (game_id, owner_type),
    CONSTRAINT ck_owner_categories_owner_type_format CHECK (owner_type ~ '^[a-z0-9_]+$')
);

COMMENT ON TABLE public.owner_categories IS '技能归属类型定义（不纳入版本管理；用于扩展 hero/item/rune/hex 等）';
COMMENT ON COLUMN public.owner_categories.owner_type IS '归属类型 key（小写字母/数字/下划线）';

CREATE TABLE public.formula_profiles (
    game_id varchar(64) NOT NULL,
    formula_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    formula_type varchar(32) NOT NULL CHECK (
        formula_type IN ('cooldown', 'regen', 'attribute', 'damage', 'resource_cost', 'other')
    ),
    formula_kind varchar(64) NOT NULL,
    params jsonb NOT NULL DEFAULT '{}',
    description varchar(255),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_formula_profiles PRIMARY KEY (game_id, formula_id),
    CONSTRAINT fk_formula_profiles_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_formula_profiles_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.formula_profiles IS '公式模板定义（原始表：1条记录覆盖一个版本区间，发布时更新 start/end）';
COMMENT ON COLUMN public.formula_profiles.formula_id IS '公式唯一 ID（game 内唯一，供 skill/hero/item 复用）';
COMMENT ON COLUMN public.formula_profiles.formula_type IS '公式类别：cooldown/regen/attribute/damage/resource_cost/other';
COMMENT ON COLUMN public.formula_profiles.formula_kind IS '公式实现标识（如 base_times_100_div_100_plus_haste）';
COMMENT ON COLUMN public.formula_profiles.params IS '公式参数 JSON（按 formula_kind 约定）';

CREATE TABLE public.formula_profiles_log (
    game_id varchar(64) NOT NULL,
    formula_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    formula_type varchar(32) NOT NULL CHECK (
        formula_type IN ('cooldown', 'regen', 'attribute', 'damage', 'resource_cost', 'other')
    ),
    formula_kind varchar(64) NOT NULL,
    params jsonb NOT NULL DEFAULT '{}',
    description varchar(255),
    CONSTRAINT pk_formula_profiles_log PRIMARY KEY (game_id, formula_id, start_version_id),
    CONSTRAINT fk_formula_profiles_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_formula_profiles_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.formula_profiles_log IS '公式模板日志表（用于多版本差异分析；按 id+start_version 唯一）';

CREATE TABLE public.formula_bindings (
    game_id varchar(64) NOT NULL,
    target_category varchar(32) NOT NULL CHECK (target_category IN ('skill', 'hero', 'item', 'global')),
    target_id varchar(256) NOT NULL,
    binding_key varchar(256) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    formula_id varchar(64) NOT NULL,
    override_params jsonb,
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_formula_bindings PRIMARY KEY (game_id, target_category, target_id, binding_key),
    CONSTRAINT fk_formula_bindings_formula FOREIGN KEY (game_id, formula_id)
        REFERENCES public.formula_profiles (game_id, formula_id),
    CONSTRAINT fk_formula_bindings_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_formula_bindings_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.formula_bindings IS '公式绑定关系（把公式绑定到 skill/hero/item/global 的某个计算点）';
COMMENT ON COLUMN public.formula_bindings.binding_key IS '绑定点 key（如 cooldown、hp_regen_tick、attack_speed_total）';
COMMENT ON COLUMN public.formula_bindings.override_params IS '可选覆盖参数（在公式默认 params 上叠加）';

CREATE TABLE public.formula_bindings_log (
    game_id varchar(64) NOT NULL,
    target_category varchar(32) NOT NULL CHECK (target_category IN ('skill', 'hero', 'item', 'global')),
    target_id varchar(256) NOT NULL,
    binding_key varchar(256) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    formula_id varchar(64) NOT NULL,
    override_params jsonb,
    CONSTRAINT pk_formula_bindings_log PRIMARY KEY (game_id, target_category, target_id, binding_key, start_version_id),
    CONSTRAINT fk_formula_bindings_log_formula FOREIGN KEY (game_id, formula_id)
        REFERENCES public.formula_profiles (game_id, formula_id),
    CONSTRAINT fk_formula_bindings_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_formula_bindings_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.formula_bindings_log IS '公式绑定日志表（用于多版本差异分析；按复合 id+start_version 唯一）';

-- -----------------------------------------------------------------------------
-- 2. 实体数据表 (Entities)
-- -----------------------------------------------------------------------------

CREATE TABLE public.heroes (
    game_id varchar(64) NOT NULL,
    hero_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    name varchar(100) NOT NULL,
    title varchar(100),
    avatar_url text,
    base_stats jsonb NOT NULL DEFAULT '{}',
    stats_by_level jsonb,
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_heroes PRIMARY KEY (game_id, hero_id),
    CONSTRAINT fk_heroes_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_heroes_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.heroes IS '英雄/角色定义（原始表：1条记录覆盖一个版本区间，发布时更新 start/end）';
COMMENT ON COLUMN public.heroes.end_version_id IS '该记录覆盖区间的结束版本（含）；有更新时发布版本区间为 [v,v]';
COMMENT ON COLUMN public.heroes.base_stats IS '基础属性与成长字段（建议以 attr_key 为 key）';
COMMENT ON COLUMN public.heroes.stats_by_level IS '可选：预计算每级属性快照（用于减少前端组装成本）';

CREATE TABLE public.heroes_log (
    game_id varchar(64) NOT NULL,
    hero_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    name varchar(100) NOT NULL,
    title varchar(100),
    avatar_url text,
    base_stats jsonb NOT NULL DEFAULT '{}',
    stats_by_level jsonb,
    CONSTRAINT pk_heroes_log PRIMARY KEY (game_id, hero_id, start_version_id),
    CONSTRAINT fk_heroes_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_heroes_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.heroes_log IS '英雄/角色日志表（用于多版本差异分析；按 id+start_version 唯一）';

CREATE TABLE public.skills (
    game_id varchar(64) NOT NULL,
    skill_id varchar(256) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    owner_id varchar(256),
    owner_type varchar(32),
    skill_key varchar(256),
    name varchar(100),
    description text,
    resource_costs jsonb,
    cooldowns jsonb,
    params jsonb,
    timing_profile jsonb,
    mechanics_config jsonb NOT NULL DEFAULT '{}',
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_skills PRIMARY KEY (game_id, skill_id),
    CONSTRAINT ck_skills_owner_pair
        CHECK (
            (owner_type IS NULL AND owner_id IS NULL)
            OR (owner_type IS NOT NULL AND owner_id IS NOT NULL)
        ),
    CONSTRAINT fk_skills_owner_type FOREIGN KEY (game_id, owner_type)
        REFERENCES public.owner_categories (game_id, owner_type),
    CONSTRAINT fk_skills_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_skills_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.skills IS '技能定义（原始表：1条记录覆盖一个版本区间，发布时更新 start/end）';
COMMENT ON COLUMN public.skills.end_version_id IS '该记录覆盖区间的结束版本（含）；有更新时发布版本区间为 [v,v]';
COMMENT ON COLUMN public.skills.owner_type IS '归属类型（由 owner_categories 定义）；NULL 表示 shared/template skill';
COMMENT ON COLUMN public.skills.owner_id IS '归属实体 ID（与 owner_type 组合确定归属）；NULL 表示 shared/template skill';
COMMENT ON COLUMN public.skills.params IS '技能静态参数（基础值/系数/段数/持续时间等，供公式与效果引用）';
COMMENT ON COLUMN public.skills.timing_profile IS '技能时序配置（前摇/后摇/读条/引导/tick 间隔/多段时点等）';
COMMENT ON COLUMN public.skills.mechanics_config IS '技能核心机制配置（推荐结构化 JSON，避免脚本字符串）';

CREATE TABLE public.skills_log (
    game_id varchar(64) NOT NULL,
    skill_id varchar(256) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    owner_id varchar(256),
    owner_type varchar(32),
    skill_key varchar(256),
    name varchar(100),
    description text,
    resource_costs jsonb,
    cooldowns jsonb,
    params jsonb,
    timing_profile jsonb,
    mechanics_config jsonb NOT NULL DEFAULT '{}',
    CONSTRAINT pk_skills_log PRIMARY KEY (game_id, skill_id, start_version_id),
    CONSTRAINT ck_skills_log_owner_pair
        CHECK (
            (owner_type IS NULL AND owner_id IS NULL)
            OR (owner_type IS NOT NULL AND owner_id IS NOT NULL)
        ),
    CONSTRAINT fk_skills_log_owner_type FOREIGN KEY (game_id, owner_type)
        REFERENCES public.owner_categories (game_id, owner_type),
    CONSTRAINT fk_skills_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_skills_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.skills_log IS '技能日志表（用于多版本差异分析；按 id+start_version 唯一）';

CREATE TABLE public.items (
    game_id varchar(64) NOT NULL,
    item_id varchar(256) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    name varchar(100),
    gold_cost int,
    icon_url text,
    skill_refs jsonb,
    recipe_ids jsonb,
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_items PRIMARY KEY (game_id, item_id),
    CONSTRAINT fk_items_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_items_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.items IS '装备/道具定义（原始表：1条记录覆盖一个版本区间，发布时更新 start/end）';
COMMENT ON COLUMN public.items.end_version_id IS '该记录覆盖区间的结束版本（含）；有更新时发布版本区间为 [v,v]';
COMMENT ON COLUMN public.items.skill_refs IS '装备关联技能引用（被动/主动 skill_id 列表等）';

CREATE TABLE public.items_log (
    game_id varchar(64) NOT NULL,
    item_id varchar(256) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    name varchar(100),
    gold_cost int,
    icon_url text,
    skill_refs jsonb,
    recipe_ids jsonb,
    CONSTRAINT pk_items_log PRIMARY KEY (game_id, item_id, start_version_id),
    CONSTRAINT fk_items_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_items_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.items_log IS '装备/道具日志表（用于多版本差异分析；按 id+start_version 唯一）';

CREATE TABLE public.item_stat_modifiers (
    game_id varchar(64) NOT NULL,
    item_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    value numeric NOT NULL,
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_item_stat_modifiers PRIMARY KEY (game_id, item_id, attr_key),
    CONSTRAINT fk_item_stat_modifiers_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_item_stat_modifiers_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_item_stat_modifiers_attr_key_format
        CHECK (attr_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_item_stat_modifiers_version_range
        CHECK (start_version_id <= end_version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.item_stat_modifiers IS '装备属性修饰行表：一条记录对应 item 的一个 attr_key 数值修饰。';
COMMENT ON COLUMN public.item_stat_modifiers.value IS '装备对 attr_key 的固定数值加成。';

CREATE TABLE public.item_stat_modifiers_log (
    game_id varchar(64) NOT NULL,
    item_id varchar(256) NOT NULL,
    attr_key varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    value numeric NOT NULL,
    CONSTRAINT pk_item_stat_modifiers_log PRIMARY KEY (game_id, item_id, attr_key, start_version_id),
    CONSTRAINT fk_item_stat_modifiers_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_item_stat_modifiers_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_item_stat_modifiers_log_attr_key_format
        CHECK (attr_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_item_stat_modifiers_log_version_range
        CHECK (start_version_id <= end_version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.item_stat_modifiers_log IS '装备属性修饰日志表（用于多版本差异分析；按 item+attr+start_version 唯一）';

CREATE TABLE public.skill_mounts (
    game_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    target_category varchar(32) NOT NULL,
    target_id varchar(256) NOT NULL,
    skill_id varchar(256) NOT NULL,
    enabled boolean NOT NULL DEFAULT TRUE,
    extend jsonb NOT NULL DEFAULT '{}',
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_skill_mounts PRIMARY KEY (game_id, target_category, target_id, skill_id),
    CONSTRAINT fk_skill_mounts_skill FOREIGN KEY (game_id, skill_id)
        REFERENCES public.skills (game_id, skill_id),
    CONSTRAINT fk_skill_mounts_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_skill_mounts_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.skill_mounts IS '技能挂载表（把 shared/hero/item 等 skill 挂到目标实体）';
COMMENT ON COLUMN public.skill_mounts.target_category IS '挂载目标类别：hero/item/global/skill/type 等';
COMMENT ON COLUMN public.skill_mounts.target_id IS '目标 ID；hero 时为 hero_id';
COMMENT ON COLUMN public.skill_mounts.skill_id IS '被挂载 skill_id';
COMMENT ON COLUMN public.skill_mounts.enabled IS '是否生效；缺省 true';

CREATE TABLE public.skill_mounts_log (
    game_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    target_category varchar(32) NOT NULL,
    target_id varchar(256) NOT NULL,
    skill_id varchar(256) NOT NULL,
    enabled boolean NOT NULL DEFAULT TRUE,
    extend jsonb NOT NULL DEFAULT '{}',
    CONSTRAINT pk_skill_mounts_log PRIMARY KEY (game_id, target_category, target_id, skill_id, start_version_id),
    CONSTRAINT fk_skill_mounts_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_skill_mounts_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.skill_mounts_log IS '技能挂载日志表（用于多版本差异分析；按自然键+start_version 唯一）';

-- -----------------------------------------------------------------------------
-- 4. 索引优化 (用于编辑器的查询)
-- -----------------------------------------------------------------------------

CREATE INDEX idx_game_versions_game_current ON public.game_versions (game_id, is_current);
CREATE INDEX idx_heroes_name ON public.heroes (game_id, name);
CREATE INDEX idx_items_name ON public.items (game_id, name);
CREATE INDEX idx_types_name ON public.types (game_id, name);
CREATE INDEX idx_formula_profiles_type ON public.formula_profiles (game_id, formula_type);
CREATE INDEX idx_formula_bindings_target ON public.formula_bindings (game_id, target_category, target_id);
CREATE INDEX idx_item_stat_modifiers_item ON public.item_stat_modifiers (game_id, item_id);
CREATE INDEX idx_item_stat_modifiers_attr ON public.item_stat_modifiers (game_id, attr_key);
CREATE INDEX idx_item_stat_modifiers_version ON public.item_stat_modifiers (game_id, start_version_id, end_version_id);
CREATE INDEX idx_item_stat_modifiers_log_version ON public.item_stat_modifiers_log (game_id, start_version_id, end_version_id);

CREATE INDEX idx_attribute_definitions_log_version ON public.attribute_definitions_log (game_id, start_version_id, end_version_id);
CREATE INDEX idx_heroes_log_version ON public.heroes_log (game_id, start_version_id, end_version_id);
CREATE INDEX idx_skills_log_version ON public.skills_log (game_id, start_version_id, end_version_id);
CREATE INDEX idx_items_log_version ON public.items_log (game_id, start_version_id, end_version_id);
CREATE INDEX idx_types_log_version ON public.types_log (game_id, start_version_id, end_version_id);
CREATE INDEX idx_type_relations_log_version ON public.type_relations_log (game_id, start_version_id, end_version_id);
CREATE INDEX idx_formula_profiles_log_version ON public.formula_profiles_log (game_id, start_version_id, end_version_id);
CREATE INDEX idx_formula_bindings_log_version ON public.formula_bindings_log (game_id, start_version_id, end_version_id);
CREATE INDEX idx_skill_mounts_target ON public.skill_mounts (game_id, target_category, target_id);
CREATE INDEX idx_skill_mounts_skill ON public.skill_mounts (game_id, skill_id);
CREATE INDEX idx_skill_mounts_log_version ON public.skill_mounts_log (game_id, start_version_id, end_version_id);

-- -----------------------------------------------------------------------------
-- 5. Coefficient buckets (fresh-install baseline; not a separate/optional schema step)
--    Formerly coefficient_bucket_schema.sql — executable DDL preserved below.
-- -----------------------------------------------------------------------------

CREATE TABLE public.coefficient_buckets (
    game_id varchar(64) NOT NULL,
    bucket_key varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    resolution_domain varchar(16) NOT NULL
        CHECK (resolution_domain IN ('attribute', 'hp_change')),
    stage_key varchar(64) NOT NULL,
    target_attr_key varchar(64),
    aggregation_mode varchar(16) NOT NULL
        CHECK (aggregation_mode IN ('add', 'multiply', 'pick_max', 'set_final')),
    provisional boolean NOT NULL DEFAULT false,
    name varchar(100),
    description varchar(255),
    editor_hint jsonb NOT NULL DEFAULT '{}',
    bucket_config jsonb NOT NULL DEFAULT '{}',
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_coefficient_buckets PRIMARY KEY (game_id, bucket_key),
    CONSTRAINT ck_coefficient_buckets_bucket_key_format
        CHECK (bucket_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_coefficient_buckets_target_attr_key
        CHECK (
            (resolution_domain = 'attribute' AND target_attr_key IS NOT NULL)
            OR
            (resolution_domain = 'hp_change' AND target_attr_key IS NULL)
        ),
    CONSTRAINT fk_coefficient_buckets_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_coefficient_buckets_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.coefficient_buckets IS '乘区桶注册表；定义同组相加、异组相乘时的桶语义，供 hp 与普通属性共用';
COMMENT ON COLUMN public.coefficient_buckets.bucket_key IS '桶唯一 key，例如 lol.hp.source.damage_amp / lol.move_speed.percent_bonus';
COMMENT ON COLUMN public.coefficient_buckets.resolution_domain IS '桶服务的结算域：attribute(普通属性) / hp_change(生命值变动)';
COMMENT ON COLUMN public.coefficient_buckets.stage_key IS '所属结算阶段；不同游戏可自行定义 stage 名';
COMMENT ON COLUMN public.coefficient_buckets.target_attr_key IS '仅 attribute 域使用；表示该桶服务哪个 attr_key';
COMMENT ON COLUMN public.coefficient_buckets.aggregation_mode IS '该桶在运行时如何聚合：add/multiply/pick_max/set_final；用于覆盖移动速度等特殊属性';
COMMENT ON COLUMN public.coefficient_buckets.provisional IS '是否为临时桶；用于先拆开记录、后续经实测再合并';
COMMENT ON COLUMN public.coefficient_buckets.editor_hint IS '给前端编辑器的提示信息，例如中文组名、说明、示例';
COMMENT ON COLUMN public.coefficient_buckets.bucket_config IS '桶扩展配置；预留未来承载更复杂规则';

CREATE TABLE public.coefficient_buckets_log (
    game_id varchar(64) NOT NULL,
    bucket_key varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    resolution_domain varchar(16) NOT NULL
        CHECK (resolution_domain IN ('attribute', 'hp_change')),
    stage_key varchar(64) NOT NULL,
    target_attr_key varchar(64),
    aggregation_mode varchar(16) NOT NULL
        CHECK (aggregation_mode IN ('add', 'multiply', 'pick_max', 'set_final')),
    provisional boolean NOT NULL DEFAULT false,
    name varchar(100),
    description varchar(255),
    editor_hint jsonb NOT NULL DEFAULT '{}',
    bucket_config jsonb NOT NULL DEFAULT '{}',
    CONSTRAINT pk_coefficient_buckets_log PRIMARY KEY (game_id, bucket_key, start_version_id),
    CONSTRAINT ck_coefficient_buckets_log_target_attr_key
        CHECK (
            (resolution_domain = 'attribute' AND target_attr_key IS NOT NULL)
            OR
            (resolution_domain = 'hp_change' AND target_attr_key IS NULL)
        ),
    CONSTRAINT fk_coefficient_buckets_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_coefficient_buckets_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.coefficient_buckets_log IS 'coefficient_buckets 日志表，用于多版本差异分析';

CREATE INDEX idx_coefficient_buckets_domain_stage
    ON public.coefficient_buckets (game_id, resolution_domain, stage_key);

CREATE INDEX idx_coefficient_buckets_attr
    ON public.coefficient_buckets (game_id, target_attr_key);

CREATE INDEX idx_coefficient_buckets_log_version
    ON public.coefficient_buckets_log (game_id, start_version_id, end_version_id);

-- -----------------------------------------------------------------------------
-- 6. Status action control (fresh-install baseline; not a separate/optional schema step)
--    Formerly status_control_schema.sql — executable DDL preserved below.
-- -----------------------------------------------------------------------------

CREATE TABLE public.status_action_control_rules (
    game_id varchar(64) NOT NULL,
    rule_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    status_type_id int NOT NULL,
    rule_kind varchar(16) NOT NULL
        CHECK (rule_kind IN ('forbid', 'interrupt')),
    action_type_ids int[] NOT NULL DEFAULT '{}',
    action_match_type_ids int[] NOT NULL DEFAULT '{}',
    interrupt_phase_type_ids int[] NOT NULL DEFAULT '{}',
    priority int NOT NULL DEFAULT 0,
    description varchar(255),
    extend jsonb NOT NULL DEFAULT '{}',
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_status_action_control_rules PRIMARY KEY (game_id, rule_id),
    CONSTRAINT ck_status_action_control_rules_rule_id_format
        CHECK (rule_id ~ '^[a-z0-9_]+$'),
    CONSTRAINT ck_status_action_control_rules_action_types
        CHECK (cardinality(action_type_ids) > 0),
    CONSTRAINT ck_status_action_control_rules_interrupt_phase
        CHECK (
            (rule_kind = 'forbid' AND cardinality(interrupt_phase_type_ids) = 0)
            OR
            (rule_kind = 'interrupt' AND cardinality(interrupt_phase_type_ids) > 0)
        )
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.status_action_control_rules IS '状态动作控制规则：某状态禁止哪些动作，或终止哪些执行中的动作';
COMMENT ON COLUMN public.status_action_control_rules.status_type_id IS '状态 type；具体状态与状态标签仍通过 types / type_relations 维护';
COMMENT ON COLUMN public.status_action_control_rules.rule_kind IS 'forbid=禁止发起动作；interrupt=终止已在执行中的动作';
COMMENT ON COLUMN public.status_action_control_rules.action_type_ids IS '动作大类 type 集合，例如 basic_attack / cast_skill';
COMMENT ON COLUMN public.status_action_control_rules.action_match_type_ids IS '可选：进一步匹配动作或技能上的 type 标签集合，例如 dash / blink / channel_skill';
COMMENT ON COLUMN public.status_action_control_rules.interrupt_phase_type_ids IS '仅 interrupt 时使用；表示会被终止的执行阶段集合，例如 cast / channel';
COMMENT ON COLUMN public.status_action_control_rules.extend IS '扩展字段；预留给少量例外配置，不再继续拆表';

CREATE TABLE public.status_action_control_rules_log (
    game_id varchar(64) NOT NULL,
    rule_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    status_type_id int NOT NULL,
    rule_kind varchar(16) NOT NULL
        CHECK (rule_kind IN ('forbid', 'interrupt')),
    action_type_ids int[] NOT NULL DEFAULT '{}',
    action_match_type_ids int[] NOT NULL DEFAULT '{}',
    interrupt_phase_type_ids int[] NOT NULL DEFAULT '{}',
    priority int NOT NULL DEFAULT 0,
    description varchar(255),
    extend jsonb NOT NULL DEFAULT '{}',
    CONSTRAINT pk_status_action_control_rules_log PRIMARY KEY (game_id, rule_id, start_version_id),
    CONSTRAINT ck_status_action_control_rules_log_action_types
        CHECK (cardinality(action_type_ids) > 0),
    CONSTRAINT ck_status_action_control_rules_log_interrupt_phase
        CHECK (
            (rule_kind = 'forbid' AND cardinality(interrupt_phase_type_ids) = 0)
            OR
            (rule_kind = 'interrupt' AND cardinality(interrupt_phase_type_ids) > 0)
        )
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.status_action_control_rules_log IS 'status_action_control_rules 日志表，用于多版本差异分析';

CREATE INDEX idx_status_action_control_rules_status_kind
    ON public.status_action_control_rules (game_id, status_type_id, rule_kind);

CREATE INDEX idx_status_action_control_rules_action_types
    ON public.status_action_control_rules USING GIN (action_type_ids);

CREATE INDEX idx_status_action_control_rules_action_match_types
    ON public.status_action_control_rules USING GIN (action_match_type_ids);

CREATE INDEX idx_status_action_control_rules_interrupt_phases
    ON public.status_action_control_rules USING GIN (interrupt_phase_type_ids);

CREATE INDEX idx_status_action_control_rules_log_version
    ON public.status_action_control_rules_log (game_id, start_version_id, end_version_id);

-- -----------------------------------------------------------------------------
-- 7. Status resources (fresh-install baseline; not a separate/optional schema step)
--    Formerly status_resource_schema.sql — executable DDL preserved below.
-- -----------------------------------------------------------------------------

CREATE TABLE public.status_definitions (
    game_id varchar(64) NOT NULL,
    status_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,

    name varchar(100) NOT NULL,
    description text,

    status_kind varchar(24) NOT NULL
        CHECK (status_kind IN ('buff', 'debuff', 'control', 'dot', 'hot', 'shield', 'special')),

    status_type_id int,
    control_profile_id varchar(64),

    stack_group_key varchar(64) NOT NULL,
    source_scope varchar(24) NOT NULL DEFAULT 'any_source'
        CHECK (source_scope IN ('any_source', 'same_source', 'same_target_source')),

    stack_mode varchar(24) NOT NULL DEFAULT 'refresh'
        CHECK (stack_mode IN (
            'refresh',
            'replace',
            'stack',
            'independent',
            'take_max_duration',
            'take_max_magnitude'
        )),

    max_stacks int NOT NULL DEFAULT 1
        CHECK (max_stacks >= 1),

    max_instances int
        CHECK (max_instances IS NULL OR max_instances >= 1),

    duration_mode varchar(16) NOT NULL DEFAULT 'timed'
        CHECK (duration_mode IN ('timed', 'permanent')),

    duration_ms int
        CHECK (duration_ms IS NULL OR duration_ms > 0),
    duration_formula_id varchar(64),

    default_magnitude_formula_id varchar(64),

    snapshot_policy varchar(16) NOT NULL DEFAULT 'on_apply'
        CHECK (snapshot_policy IN ('on_apply', 'dynamic')),

    is_dispellable boolean NOT NULL DEFAULT true,
    cleanse_priority int NOT NULL DEFAULT 0,

    extend jsonb NOT NULL DEFAULT '{}',
    updated_at timestamp NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_status_definitions PRIMARY KEY (game_id, status_id),
    CONSTRAINT ck_status_definitions_status_id_format
        CHECK (status_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_definitions_stack_group_key_format
        CHECK (stack_group_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_definitions_control_profile_id_format
        CHECK (control_profile_id IS NULL OR control_profile_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_definitions_status_type_id
        CHECK (status_type_id IS NULL OR status_type_id > 0),
    CONSTRAINT ck_status_definitions_version_range
        CHECK (start_version_id <= end_version_id),
    CONSTRAINT ck_status_definitions_duration
        CHECK (
            (duration_mode = 'permanent' AND duration_ms IS NULL AND duration_formula_id IS NULL)
            OR
            (duration_mode = 'timed' AND (duration_ms IS NOT NULL OR duration_formula_id IS NOT NULL))
        )
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.status_definitions IS '状态定义主表：描述状态本体、持续时间、叠层/刷新策略、控制语义引用；不再把这类长期语义塞进 skills.mechanics_config。';
COMMENT ON COLUMN public.status_definitions.game_id IS '游戏标识；按 game_id 做分区。';
COMMENT ON COLUMN public.status_definitions.status_id IS '状态唯一标识；建议稳定、可读、面向运行时和后台共用。';
COMMENT ON COLUMN public.status_definitions.start_version_id IS '该状态定义覆盖区间的起始版本（含）。';
COMMENT ON COLUMN public.status_definitions.end_version_id IS '该状态定义覆盖区间的结束版本（含）。';
COMMENT ON COLUMN public.status_definitions.name IS '状态显示名。';
COMMENT ON COLUMN public.status_definitions.description IS '状态说明；供后台和调试展示。';
COMMENT ON COLUMN public.status_definitions.status_kind IS '状态大类：buff/debuff/control/dot/hot/shield/special。';
COMMENT ON COLUMN public.status_definitions.status_type_id IS '可选：关联 types 中的状态分类标签 ID；DB 不做外键约束，但建议服务层校验其存在。';
COMMENT ON COLUMN public.status_definitions.control_profile_id IS '可选：引用 control_state_profiles.control_profile_id；控制类状态通过它决定行动状态流转。';
COMMENT ON COLUMN public.status_definitions.stack_group_key IS '叠层/冲突判定组 key；运行时按该 key 管理同组状态。';
COMMENT ON COLUMN public.status_definitions.source_scope IS '同组判定时是否区分来源：any_source/same_source/same_target_source。';
COMMENT ON COLUMN public.status_definitions.stack_mode IS '叠层策略：refresh/replace/stack/independent/take_max_duration/take_max_magnitude。';
COMMENT ON COLUMN public.status_definitions.max_stacks IS 'stack 模式下允许的最大层数。';
COMMENT ON COLUMN public.status_definitions.max_instances IS 'independent 模式下允许同时存在的最大实例数；NULL 表示不额外限制。';
COMMENT ON COLUMN public.status_definitions.duration_mode IS '持续时间模式：timed=有持续时间；permanent=永久直到显式移除。';
COMMENT ON COLUMN public.status_definitions.duration_ms IS '固定持续时间；若走公式则可为空。';
COMMENT ON COLUMN public.status_definitions.duration_formula_id IS '可选：时长公式 ID；由服务层校验其存在。';
COMMENT ON COLUMN public.status_definitions.default_magnitude_formula_id IS '可选：默认幅值公式；子 modifier 未显式指定公式时可复用。';
COMMENT ON COLUMN public.status_definitions.snapshot_policy IS '快照策略：on_apply=施加时快照；dynamic=运行时动态读取。';
COMMENT ON COLUMN public.status_definitions.is_dispellable IS '是否允许被驱散/净化。';
COMMENT ON COLUMN public.status_definitions.cleanse_priority IS '净化优先级；数值越高通常表示越应优先处理。';
COMMENT ON COLUMN public.status_definitions.extend IS '扩展字段；预留给少量临时配置，不继续拆表时使用。';
COMMENT ON COLUMN public.status_definitions.updated_at IS '最近更新时间。';

CREATE TABLE public.status_definitions_log (
    game_id varchar(64) NOT NULL,
    status_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,

    name varchar(100) NOT NULL,
    description text,

    status_kind varchar(24) NOT NULL
        CHECK (status_kind IN ('buff', 'debuff', 'control', 'dot', 'hot', 'shield', 'special')),

    status_type_id int,
    control_profile_id varchar(64),

    stack_group_key varchar(64) NOT NULL,
    source_scope varchar(24) NOT NULL,
    stack_mode varchar(24) NOT NULL,
    max_stacks int NOT NULL,
    max_instances int,

    duration_mode varchar(16) NOT NULL,
    duration_ms int,
    duration_formula_id varchar(64),

    default_magnitude_formula_id varchar(64),
    snapshot_policy varchar(16) NOT NULL,

    is_dispellable boolean NOT NULL,
    cleanse_priority int NOT NULL,

    extend jsonb NOT NULL DEFAULT '{}',

    CONSTRAINT pk_status_definitions_log PRIMARY KEY (game_id, status_id, start_version_id),
    CONSTRAINT ck_status_definitions_log_status_id_format
        CHECK (status_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_definitions_log_stack_group_key_format
        CHECK (stack_group_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_definitions_log_control_profile_id_format
        CHECK (control_profile_id IS NULL OR control_profile_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_definitions_log_status_type_id
        CHECK (status_type_id IS NULL OR status_type_id > 0),
    CONSTRAINT ck_status_definitions_log_source_scope
        CHECK (source_scope IN ('any_source', 'same_source', 'same_target_source')),
    CONSTRAINT ck_status_definitions_log_stack_mode
        CHECK (stack_mode IN (
            'refresh',
            'replace',
            'stack',
            'independent',
            'take_max_duration',
            'take_max_magnitude'
        )),
    CONSTRAINT ck_status_definitions_log_max_stacks
        CHECK (max_stacks >= 1),
    CONSTRAINT ck_status_definitions_log_max_instances
        CHECK (max_instances IS NULL OR max_instances >= 1),
    CONSTRAINT ck_status_definitions_log_duration_mode
        CHECK (duration_mode IN ('timed', 'permanent')),
    CONSTRAINT ck_status_definitions_log_duration_ms
        CHECK (duration_ms IS NULL OR duration_ms > 0),
    CONSTRAINT ck_status_definitions_log_snapshot_policy
        CHECK (snapshot_policy IN ('on_apply', 'dynamic')),
    CONSTRAINT ck_status_definitions_log_version_range
        CHECK (start_version_id <= end_version_id),
    CONSTRAINT ck_status_definitions_log_duration
        CHECK (
            (duration_mode = 'permanent' AND duration_ms IS NULL AND duration_formula_id IS NULL)
            OR
            (duration_mode = 'timed' AND (duration_ms IS NOT NULL OR duration_formula_id IS NOT NULL))
        )
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.status_definitions_log IS 'status_definitions 日志表，用于多版本差异分析。';

CREATE TABLE public.status_modifier_groups (
    game_id varchar(64) NOT NULL,
    status_id varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,

    group_name varchar(100),
    phase_key varchar(24) NOT NULL
        CHECK (phase_key IN ('while_active', 'on_apply', 'on_expire', 'on_interval')),

    snapshot_policy varchar(16) NOT NULL DEFAULT 'on_apply'
        CHECK (snapshot_policy IN ('on_apply', 'dynamic', 'per_tick')),

    interval_ms int
        CHECK (interval_ms IS NULL OR interval_ms > 0),
    max_ticks int
        CHECK (max_ticks IS NULL OR max_ticks >= 1),
    priority int NOT NULL DEFAULT 0,

    extend jsonb NOT NULL DEFAULT '{}',
    updated_at timestamp NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_status_modifier_groups PRIMARY KEY (game_id, status_id, group_key),
    CONSTRAINT ck_status_modifier_groups_status_id_format
        CHECK (status_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_modifier_groups_group_key_format
        CHECK (group_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_modifier_groups_version_range
        CHECK (start_version_id <= end_version_id),
    CONSTRAINT ck_status_modifier_groups_interval
        CHECK (
            (phase_key <> 'on_interval' AND interval_ms IS NULL AND max_ticks IS NULL)
            OR
            (phase_key = 'on_interval' AND interval_ms IS NOT NULL)
        )
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.status_modifier_groups IS '状态效果组：把一组效果作为同一个原子组管理；运行时建议整组实例化、整组移除。';
COMMENT ON COLUMN public.status_modifier_groups.game_id IS '游戏标识；按 game_id 做分区。';
COMMENT ON COLUMN public.status_modifier_groups.status_id IS '所属状态 ID；语义上引用 status_definitions.status_id，DB 不做外键。';
COMMENT ON COLUMN public.status_modifier_groups.group_key IS '状态内效果组 key；同一状态下唯一。';
COMMENT ON COLUMN public.status_modifier_groups.start_version_id IS '该效果组覆盖区间的起始版本（含）。';
COMMENT ON COLUMN public.status_modifier_groups.end_version_id IS '该效果组覆盖区间的结束版本（含）。';
COMMENT ON COLUMN public.status_modifier_groups.group_name IS '效果组名称；便于后台展示和调试。';
COMMENT ON COLUMN public.status_modifier_groups.phase_key IS '生效阶段：while_active/on_apply/on_expire/on_interval。';
COMMENT ON COLUMN public.status_modifier_groups.snapshot_policy IS '组级快照策略：on_apply=施加时快照；dynamic=持续动态读取；per_tick=每次 tick 重新快照。';
COMMENT ON COLUMN public.status_modifier_groups.interval_ms IS '仅 on_interval 使用：tick 间隔毫秒数。';
COMMENT ON COLUMN public.status_modifier_groups.max_ticks IS '仅 on_interval 使用：最多执行多少次 tick；NULL 表示跟随状态持续时间。';
COMMENT ON COLUMN public.status_modifier_groups.priority IS '组优先级；用于运行时排序和同阶段处理顺序。';
COMMENT ON COLUMN public.status_modifier_groups.extend IS '扩展字段；预留给少量特例配置。';
COMMENT ON COLUMN public.status_modifier_groups.updated_at IS '最近更新时间。';

CREATE TABLE public.status_modifier_groups_log (
    game_id varchar(64) NOT NULL,
    status_id varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,

    group_name varchar(100),
    phase_key varchar(24) NOT NULL,
    snapshot_policy varchar(16) NOT NULL,
    interval_ms int,
    max_ticks int,
    priority int NOT NULL,

    extend jsonb NOT NULL DEFAULT '{}',

    CONSTRAINT pk_status_modifier_groups_log PRIMARY KEY (game_id, status_id, group_key, start_version_id),
    CONSTRAINT ck_status_modifier_groups_log_status_id_format
        CHECK (status_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_modifier_groups_log_group_key_format
        CHECK (group_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_modifier_groups_log_phase_key
        CHECK (phase_key IN ('while_active', 'on_apply', 'on_expire', 'on_interval')),
    CONSTRAINT ck_status_modifier_groups_log_snapshot_policy
        CHECK (snapshot_policy IN ('on_apply', 'dynamic', 'per_tick')),
    CONSTRAINT ck_status_modifier_groups_log_interval_ms
        CHECK (interval_ms IS NULL OR interval_ms > 0),
    CONSTRAINT ck_status_modifier_groups_log_max_ticks
        CHECK (max_ticks IS NULL OR max_ticks >= 1),
    CONSTRAINT ck_status_modifier_groups_log_version_range
        CHECK (start_version_id <= end_version_id),
    CONSTRAINT ck_status_modifier_groups_log_interval
        CHECK (
            (phase_key <> 'on_interval' AND interval_ms IS NULL AND max_ticks IS NULL)
            OR
            (phase_key = 'on_interval' AND interval_ms IS NOT NULL)
        )
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.status_modifier_groups_log IS 'status_modifier_groups 日志表，用于多版本差异分析。';

CREATE TABLE public.status_attribute_modifiers (
    game_id varchar(64) NOT NULL,
    status_id varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    modifier_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,

    attr_key varchar(64) NOT NULL,

    modifier_mode varchar(24) NOT NULL
        CHECK (modifier_mode IN ('flat', 'percent', 'bucket_add', 'bucket_mul', 'set_final')),

    value numeric,
    formula_id varchar(64),

    bucket_key varchar(64),
    per_stack boolean NOT NULL DEFAULT false,
    priority int NOT NULL DEFAULT 0,

    extend jsonb NOT NULL DEFAULT '{}',
    updated_at timestamp NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_status_attribute_modifiers PRIMARY KEY (game_id, status_id, group_key, modifier_id),
    CONSTRAINT ck_status_attribute_modifiers_status_id_format
        CHECK (status_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_attribute_modifiers_group_key_format
        CHECK (group_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_attribute_modifiers_modifier_id_format
        CHECK (modifier_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_attribute_modifiers_attr_key_format
        CHECK (attr_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_attribute_modifiers_formula_id_format
        CHECK (formula_id IS NULL OR formula_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_attribute_modifiers_bucket_key_format
        CHECK (bucket_key IS NULL OR bucket_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_attribute_modifiers_version_range
        CHECK (start_version_id <= end_version_id),
    CONSTRAINT ck_status_attribute_modifiers_value_source
        CHECK (value IS NOT NULL OR formula_id IS NOT NULL),
    CONSTRAINT ck_status_attribute_modifiers_bucket_usage
        CHECK (
            (modifier_mode IN ('bucket_add', 'bucket_mul') AND bucket_key IS NOT NULL)
            OR
            (modifier_mode NOT IN ('bucket_add', 'bucket_mul'))
        )
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.status_attribute_modifiers IS '状态属性修饰明细：描述状态组内对属性的持续或瞬时修饰。';
COMMENT ON COLUMN public.status_attribute_modifiers.game_id IS '游戏标识；按 game_id 做分区。';
COMMENT ON COLUMN public.status_attribute_modifiers.status_id IS '所属状态 ID；语义上引用 status_definitions.status_id，DB 不做外键。';
COMMENT ON COLUMN public.status_attribute_modifiers.group_key IS '所属效果组 key；语义上引用 status_modifier_groups.group_key，DB 不做外键。';
COMMENT ON COLUMN public.status_attribute_modifiers.modifier_id IS 'modifier 明细 ID；同一状态组下唯一。';
COMMENT ON COLUMN public.status_attribute_modifiers.start_version_id IS '该 modifier 覆盖区间的起始版本（含）。';
COMMENT ON COLUMN public.status_attribute_modifiers.end_version_id IS '该 modifier 覆盖区间的结束版本（含）。';
COMMENT ON COLUMN public.status_attribute_modifiers.attr_key IS '目标属性 key；语义上引用 attribute_definitions.attr_key，DB 不做外键。';
COMMENT ON COLUMN public.status_attribute_modifiers.modifier_mode IS '修饰模式：flat/percent/bucket_add/bucket_mul/set_final。';
COMMENT ON COLUMN public.status_attribute_modifiers.value IS '固定数值；与 formula_id 至少提供一个。';
COMMENT ON COLUMN public.status_attribute_modifiers.formula_id IS '可选公式 ID；需要动态计算时使用。';
COMMENT ON COLUMN public.status_attribute_modifiers.bucket_key IS '可选桶 key；当 modifier_mode 为 bucket_add/bucket_mul 时必填。';
COMMENT ON COLUMN public.status_attribute_modifiers.per_stack IS 'true 表示该条数值按当前 stackCount 参与结算。';
COMMENT ON COLUMN public.status_attribute_modifiers.priority IS '同属性多条修饰时的处理优先级。';
COMMENT ON COLUMN public.status_attribute_modifiers.extend IS '扩展字段；预留少量例外配置。';
COMMENT ON COLUMN public.status_attribute_modifiers.updated_at IS '最近更新时间。';

CREATE TABLE public.status_attribute_modifiers_log (
    game_id varchar(64) NOT NULL,
    status_id varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    modifier_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,

    attr_key varchar(64) NOT NULL,
    modifier_mode varchar(24) NOT NULL,
    value numeric,
    formula_id varchar(64),
    bucket_key varchar(64),
    per_stack boolean NOT NULL,
    priority int NOT NULL,

    extend jsonb NOT NULL DEFAULT '{}',

    CONSTRAINT pk_status_attribute_modifiers_log PRIMARY KEY (game_id, status_id, group_key, modifier_id, start_version_id),
    CONSTRAINT ck_status_attribute_modifiers_log_status_id_format
        CHECK (status_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_attribute_modifiers_log_group_key_format
        CHECK (group_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_attribute_modifiers_log_modifier_id_format
        CHECK (modifier_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_attribute_modifiers_log_attr_key_format
        CHECK (attr_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_attribute_modifiers_log_formula_id_format
        CHECK (formula_id IS NULL OR formula_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_attribute_modifiers_log_bucket_key_format
        CHECK (bucket_key IS NULL OR bucket_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_attribute_modifiers_log_modifier_mode
        CHECK (modifier_mode IN ('flat', 'percent', 'bucket_add', 'bucket_mul', 'set_final')),
    CONSTRAINT ck_status_attribute_modifiers_log_version_range
        CHECK (start_version_id <= end_version_id),
    CONSTRAINT ck_status_attribute_modifiers_log_value_source
        CHECK (value IS NOT NULL OR formula_id IS NOT NULL),
    CONSTRAINT ck_status_attribute_modifiers_log_bucket_usage
        CHECK (
            (modifier_mode IN ('bucket_add', 'bucket_mul') AND bucket_key IS NOT NULL)
            OR
            (modifier_mode NOT IN ('bucket_add', 'bucket_mul'))
        )
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.status_attribute_modifiers_log IS 'status_attribute_modifiers 日志表，用于多版本差异分析。';

CREATE TABLE public.status_periodic_hp_effects (
    game_id varchar(64) NOT NULL,
    status_id varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    effect_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,

    effect_kind varchar(16) NOT NULL
        CHECK (effect_kind IN ('damage', 'heal')),

    tick_formula_id varchar(64) NOT NULL,

    damage_type varchar(16)
        CHECK (damage_type IS NULL OR damage_type IN ('physical', 'magic', 'true')),

    can_crit boolean NOT NULL DEFAULT false,
    crit_chance_source varchar(32) NOT NULL DEFAULT 'none'
        CHECK (crit_chance_source IN ('none', 'attacker_crit_chance', 'fixed')),
    crit_chance numeric(10, 6),
    crit_multiplier numeric(10, 6),
    affected_by_heal_modifier boolean,
    per_stack boolean NOT NULL DEFAULT false,

    extend jsonb NOT NULL DEFAULT '{}',
    updated_at timestamp NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_status_periodic_hp_effects PRIMARY KEY (game_id, status_id, group_key, effect_id),
    CONSTRAINT ck_status_periodic_hp_effects_status_id_format
        CHECK (status_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_periodic_hp_effects_group_key_format
        CHECK (group_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_periodic_hp_effects_effect_id_format
        CHECK (effect_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_periodic_hp_effects_tick_formula_id_format
        CHECK (tick_formula_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_periodic_hp_effects_version_range
        CHECK (start_version_id <= end_version_id),
    CONSTRAINT ck_status_periodic_hp_effects_damage_type_usage
        CHECK (
            (effect_kind = 'damage' AND damage_type IS NOT NULL AND affected_by_heal_modifier IS NULL)
            OR
            (effect_kind = 'heal' AND damage_type IS NULL AND affected_by_heal_modifier IS NOT NULL)
        ),
    CONSTRAINT ck_status_periodic_hp_effects_crit_usage
        CHECK (
            (NOT can_crit AND crit_chance_source = 'none' AND crit_chance IS NULL AND crit_multiplier IS NULL)
            OR
            (
                can_crit
                AND crit_multiplier IS NOT NULL
                AND crit_multiplier > 0
                AND (
                    (crit_chance_source = 'fixed' AND crit_chance IS NOT NULL AND crit_chance >= 0 AND crit_chance <= 1)
                    OR
                    (crit_chance_source = 'attacker_crit_chance' AND crit_chance IS NULL)
                )
            )
        )
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.status_periodic_hp_effects IS '状态拥有的周期生命变化效果：承载 DoT / HoT，不再继续塞回 skills.mechanics_config。';
COMMENT ON COLUMN public.status_periodic_hp_effects.game_id IS '游戏标识；按 game_id 做分区。';
COMMENT ON COLUMN public.status_periodic_hp_effects.status_id IS '所属状态 ID；语义上引用 status_definitions.status_id，DB 不做外键。';
COMMENT ON COLUMN public.status_periodic_hp_effects.group_key IS '所属效果组 key；语义上引用 status_modifier_groups.group_key，DB 不做外键。';
COMMENT ON COLUMN public.status_periodic_hp_effects.effect_id IS '周期效果 ID；同一状态组下唯一。';
COMMENT ON COLUMN public.status_periodic_hp_effects.start_version_id IS '该周期效果覆盖区间的起始版本（含）。';
COMMENT ON COLUMN public.status_periodic_hp_effects.end_version_id IS '该周期效果覆盖区间的结束版本（含）。';
COMMENT ON COLUMN public.status_periodic_hp_effects.effect_kind IS '效果类型：damage=持续伤害；heal=持续治疗。';
COMMENT ON COLUMN public.status_periodic_hp_effects.tick_formula_id IS 'tick 数值公式 ID；由服务层校验其存在。';
COMMENT ON COLUMN public.status_periodic_hp_effects.damage_type IS '仅 damage 使用：physical/magic/true。';
COMMENT ON COLUMN public.status_periodic_hp_effects.can_crit IS '通常用于 damage；若某些游戏治疗也支持暴击语义，可在 heal 侧按需开启。';
COMMENT ON COLUMN public.status_periodic_hp_effects.crit_chance_source IS '暴击概率来源：none / attacker_crit_chance / fixed。';
COMMENT ON COLUMN public.status_periodic_hp_effects.crit_chance IS '固定暴击概率；仅 crit_chance_source=fixed 时使用，范围 [0,1]。';
COMMENT ON COLUMN public.status_periodic_hp_effects.crit_multiplier IS '暴击倍率；仅 can_crit=true 时使用，且必须大于 0。';
COMMENT ON COLUMN public.status_periodic_hp_effects.affected_by_heal_modifier IS '仅 heal 使用：该周期治疗是否受治疗增减修正影响。';
COMMENT ON COLUMN public.status_periodic_hp_effects.per_stack IS 'true 表示该周期效果按当前 stackCount 参与结算。';
COMMENT ON COLUMN public.status_periodic_hp_effects.extend IS '扩展字段；预留少量特例配置。';
COMMENT ON COLUMN public.status_periodic_hp_effects.updated_at IS '最近更新时间。';

CREATE TABLE public.status_periodic_hp_effects_log (
    game_id varchar(64) NOT NULL,
    status_id varchar(64) NOT NULL,
    group_key varchar(64) NOT NULL,
    effect_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,

    effect_kind varchar(16) NOT NULL,
    tick_formula_id varchar(64) NOT NULL,
    damage_type varchar(16),
    can_crit boolean NOT NULL,
    crit_chance_source varchar(32) NOT NULL,
    crit_chance numeric(10, 6),
    crit_multiplier numeric(10, 6),
    affected_by_heal_modifier boolean,
    per_stack boolean NOT NULL,

    extend jsonb NOT NULL DEFAULT '{}',

    CONSTRAINT pk_status_periodic_hp_effects_log PRIMARY KEY (game_id, status_id, group_key, effect_id, start_version_id),
    CONSTRAINT ck_status_periodic_hp_effects_log_status_id_format
        CHECK (status_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_periodic_hp_effects_log_group_key_format
        CHECK (group_key ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_periodic_hp_effects_log_effect_id_format
        CHECK (effect_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_periodic_hp_effects_log_tick_formula_id_format
        CHECK (tick_formula_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_status_periodic_hp_effects_log_effect_kind
        CHECK (effect_kind IN ('damage', 'heal')),
    CONSTRAINT ck_status_periodic_hp_effects_log_damage_type
        CHECK (damage_type IS NULL OR damage_type IN ('physical', 'magic', 'true')),
    CONSTRAINT ck_status_periodic_hp_effects_log_crit_chance_source
        CHECK (crit_chance_source IN ('none', 'attacker_crit_chance', 'fixed')),
    CONSTRAINT ck_status_periodic_hp_effects_log_version_range
        CHECK (start_version_id <= end_version_id),
    CONSTRAINT ck_status_periodic_hp_effects_log_damage_type_usage
        CHECK (
            (effect_kind = 'damage' AND damage_type IS NOT NULL AND affected_by_heal_modifier IS NULL)
            OR
            (effect_kind = 'heal' AND damage_type IS NULL AND affected_by_heal_modifier IS NOT NULL)
        ),
    CONSTRAINT ck_status_periodic_hp_effects_log_crit_usage
        CHECK (
            (NOT can_crit AND crit_chance_source = 'none' AND crit_chance IS NULL AND crit_multiplier IS NULL)
            OR
            (
                can_crit
                AND crit_multiplier IS NOT NULL
                AND crit_multiplier > 0
                AND (
                    (crit_chance_source = 'fixed' AND crit_chance IS NOT NULL AND crit_chance >= 0 AND crit_chance <= 1)
                    OR
                    (crit_chance_source = 'attacker_crit_chance' AND crit_chance IS NULL)
                )
            )
        )
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.status_periodic_hp_effects_log IS 'status_periodic_hp_effects 日志表，用于多版本差异分析。';

CREATE TABLE public.control_state_profiles (
    game_id varchar(64) NOT NULL,
    control_profile_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,

    name varchar(100) NOT NULL,
    description text,

    control_kind varchar(24) NOT NULL
        CHECK (control_kind IN (
            'stun',
            'root',
            'silence',
            'disarm',
            'taunt',
            'fear',
            'charm',
            'airborne',
            'grounded',
            'knockback',
            'pull',
            'suppress',
            'special'
        )),

    movement_lock_mode varchar(24) NOT NULL DEFAULT 'none'
        CHECK (movement_lock_mode IN ('none', 'forbid_move', 'force_move', 'forbid_turn')),
    cast_lock_mode varchar(24) NOT NULL DEFAULT 'none'
        CHECK (cast_lock_mode IN ('none', 'forbid_cast', 'interrupt_cast', 'forbid_channel', 'interrupt_and_forbid')),
    attack_lock_mode varchar(24) NOT NULL DEFAULT 'none'
        CHECK (attack_lock_mode IN ('none', 'forbid_attack', 'interrupt_attack', 'interrupt_and_forbid')),

    input_override_mode varchar(32) NOT NULL DEFAULT 'none'
        CHECK (input_override_mode IN (
            'none',
            'force_to_source',
            'force_from_source',
            'force_to_target',
            'force_along_path',
            'force_stop'
        )),

    displacement_kind varchar(24) NOT NULL DEFAULT 'none'
        CHECK (displacement_kind IN ('none', 'knockup', 'knockback', 'pull', 'forced_dash')),

    blocks_control_input boolean NOT NULL DEFAULT false,
    grants_unstoppable boolean NOT NULL DEFAULT false,
    breaks_on_damage boolean NOT NULL DEFAULT false,
    tenacity_reducible boolean NOT NULL DEFAULT true,
    priority int NOT NULL DEFAULT 0,

    extend jsonb NOT NULL DEFAULT '{}',
    updated_at timestamp NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_control_state_profiles PRIMARY KEY (game_id, control_profile_id),
    CONSTRAINT ck_control_state_profiles_control_profile_id_format
        CHECK (control_profile_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_control_state_profiles_version_range
        CHECK (start_version_id <= end_version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.control_state_profiles IS '控制状态语义表：描述眩晕、魅惑、恐惧、击飞等对角色行动状态流转与输入接管的影响。';
COMMENT ON COLUMN public.control_state_profiles.game_id IS '游戏标识；按 game_id 做分区。';
COMMENT ON COLUMN public.control_state_profiles.control_profile_id IS '控制语义唯一标识；status_definitions.control_profile_id 可引用它。';
COMMENT ON COLUMN public.control_state_profiles.start_version_id IS '该控制语义覆盖区间的起始版本（含）。';
COMMENT ON COLUMN public.control_state_profiles.end_version_id IS '该控制语义覆盖区间的结束版本（含）。';
COMMENT ON COLUMN public.control_state_profiles.name IS '控制语义名称。';
COMMENT ON COLUMN public.control_state_profiles.description IS '控制语义说明；供后台和调试展示。';
COMMENT ON COLUMN public.control_state_profiles.control_kind IS '控制类型枚举：stun/root/silence/disarm/taunt/fear/charm/airborne/grounded/knockback/pull/suppress/special。';
COMMENT ON COLUMN public.control_state_profiles.movement_lock_mode IS '移动限制模式：是否禁止移动、强制移动或禁止转向。';
COMMENT ON COLUMN public.control_state_profiles.cast_lock_mode IS '施法限制模式：是否禁止施法、打断施法或打断引导。';
COMMENT ON COLUMN public.control_state_profiles.attack_lock_mode IS '普攻限制模式：是否禁止普攻或打断当前普攻。';
COMMENT ON COLUMN public.control_state_profiles.input_override_mode IS '输入接管模式：例如魅惑可强制朝来源移动，恐惧可强制远离来源。';
COMMENT ON COLUMN public.control_state_profiles.displacement_kind IS '位移控制类型；用于描述控制实现细节，可与 control_kind 共同表达最终运行时行为。';
COMMENT ON COLUMN public.control_state_profiles.blocks_control_input IS '是否屏蔽玩家主动输入。';
COMMENT ON COLUMN public.control_state_profiles.grants_unstoppable IS '该控制态是否赋予不可阻挡语义；用于极少数特殊机制。';
COMMENT ON COLUMN public.control_state_profiles.breaks_on_damage IS '该控制态是否会在受伤时中断。';
COMMENT ON COLUMN public.control_state_profiles.tenacity_reducible IS '该控制态是否受韧性/控制时长减免影响。';
COMMENT ON COLUMN public.control_state_profiles.priority IS '多个控制态并存时的优先级。';
COMMENT ON COLUMN public.control_state_profiles.extend IS '扩展字段；预留给少量特殊游戏规则。';
COMMENT ON COLUMN public.control_state_profiles.updated_at IS '最近更新时间。';

CREATE TABLE public.control_state_profiles_log (
    game_id varchar(64) NOT NULL,
    control_profile_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,

    name varchar(100) NOT NULL,
    description text,

    control_kind varchar(24) NOT NULL,
    movement_lock_mode varchar(24) NOT NULL,
    cast_lock_mode varchar(24) NOT NULL,
    attack_lock_mode varchar(24) NOT NULL,
    input_override_mode varchar(32) NOT NULL,
    displacement_kind varchar(24) NOT NULL,
    blocks_control_input boolean NOT NULL,
    grants_unstoppable boolean NOT NULL,
    breaks_on_damage boolean NOT NULL,
    tenacity_reducible boolean NOT NULL,
    priority int NOT NULL,

    extend jsonb NOT NULL DEFAULT '{}',

    CONSTRAINT pk_control_state_profiles_log PRIMARY KEY (game_id, control_profile_id, start_version_id),
    CONSTRAINT ck_control_state_profiles_log_control_profile_id_format
        CHECK (control_profile_id ~ '^[a-z0-9_\\.]+$'),
    CONSTRAINT ck_control_state_profiles_log_control_kind
        CHECK (control_kind IN (
            'stun',
            'root',
            'silence',
            'disarm',
            'taunt',
            'fear',
            'charm',
            'airborne',
            'grounded',
            'knockback',
            'pull',
            'suppress',
            'special'
        )),
    CONSTRAINT ck_control_state_profiles_log_movement_lock_mode
        CHECK (movement_lock_mode IN ('none', 'forbid_move', 'force_move', 'forbid_turn')),
    CONSTRAINT ck_control_state_profiles_log_cast_lock_mode
        CHECK (cast_lock_mode IN ('none', 'forbid_cast', 'interrupt_cast', 'forbid_channel', 'interrupt_and_forbid')),
    CONSTRAINT ck_control_state_profiles_log_attack_lock_mode
        CHECK (attack_lock_mode IN ('none', 'forbid_attack', 'interrupt_attack', 'interrupt_and_forbid')),
    CONSTRAINT ck_control_state_profiles_log_input_override_mode
        CHECK (input_override_mode IN (
            'none',
            'force_to_source',
            'force_from_source',
            'force_to_target',
            'force_along_path',
            'force_stop'
        )),
    CONSTRAINT ck_control_state_profiles_log_displacement_kind
        CHECK (displacement_kind IN ('none', 'knockup', 'knockback', 'pull', 'forced_dash')),
    CONSTRAINT ck_control_state_profiles_log_version_range
        CHECK (start_version_id <= end_version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.control_state_profiles_log IS 'control_state_profiles 日志表，用于多版本差异分析。';

CREATE INDEX idx_status_definitions_stack_group
    ON public.status_definitions (game_id, stack_group_key);

CREATE INDEX idx_status_definitions_status_kind
    ON public.status_definitions (game_id, status_kind);

CREATE INDEX idx_status_definitions_control_profile
    ON public.status_definitions (game_id, control_profile_id);

CREATE INDEX idx_status_definitions_version
    ON public.status_definitions (game_id, start_version_id, end_version_id);

CREATE INDEX idx_status_definitions_log_version
    ON public.status_definitions_log (game_id, start_version_id, end_version_id);

CREATE INDEX idx_status_modifier_groups_phase
    ON public.status_modifier_groups (game_id, status_id, phase_key);

CREATE INDEX idx_status_modifier_groups_version
    ON public.status_modifier_groups (game_id, start_version_id, end_version_id);

CREATE INDEX idx_status_modifier_groups_log_version
    ON public.status_modifier_groups_log (game_id, start_version_id, end_version_id);

CREATE INDEX idx_status_attribute_modifiers_attr
    ON public.status_attribute_modifiers (game_id, attr_key);

CREATE INDEX idx_status_attribute_modifiers_bucket
    ON public.status_attribute_modifiers (game_id, bucket_key);

CREATE INDEX idx_status_attribute_modifiers_version
    ON public.status_attribute_modifiers (game_id, start_version_id, end_version_id);

CREATE INDEX idx_status_attribute_modifiers_log_version
    ON public.status_attribute_modifiers_log (game_id, start_version_id, end_version_id);

CREATE INDEX idx_status_periodic_hp_effects_kind
    ON public.status_periodic_hp_effects (game_id, effect_kind);

CREATE INDEX idx_status_periodic_hp_effects_version
    ON public.status_periodic_hp_effects (game_id, start_version_id, end_version_id);

CREATE INDEX idx_status_periodic_hp_effects_log_version
    ON public.status_periodic_hp_effects_log (game_id, start_version_id, end_version_id);

CREATE INDEX idx_control_state_profiles_kind
    ON public.control_state_profiles (game_id, control_kind);

CREATE INDEX idx_control_state_profiles_version
    ON public.control_state_profiles (game_id, start_version_id, end_version_id);

CREATE INDEX idx_control_state_profiles_log_version
    ON public.control_state_profiles_log (game_id, start_version_id, end_version_id);

-- -----------------------------------------------------------------------------
-- 8. Wasm Canonical Catalog (fresh-install baseline; not a separate/optional schema step)
--    Formerly wasm_catalog_schema.sql — executable DDL preserved below.
-- -----------------------------------------------------------------------------

CREATE TABLE public.wasm_catalog_sources (
    game_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    schema_version varchar(64) NOT NULL,
    catalog_json jsonb NOT NULL,
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_wasm_catalog_sources PRIMARY KEY (game_id),
    CONSTRAINT fk_wasm_catalog_sources_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_wasm_catalog_sources_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_wasm_catalog_sources_json_object CHECK (jsonb_typeof(catalog_json) = 'object'),
    CONSTRAINT ck_wasm_catalog_sources_version_range CHECK (start_version_id <= end_version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.wasm_catalog_sources IS 'Wasm Canonical Catalog 编辑态 source；每个 game 一行当前草稿';
COMMENT ON COLUMN public.wasm_catalog_sources.schema_version IS 'Wasm schema 版本；首期固定 generic-p0；不重复写入 catalog_json';
COMMENT ON COLUMN public.wasm_catalog_sources.catalog_json IS 'source body（排除根 schemaVersion、meta 与 hash）';

CREATE TABLE public.wasm_catalog_sources_log (
    game_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    schema_version varchar(64) NOT NULL,
    catalog_json jsonb NOT NULL,
    CONSTRAINT pk_wasm_catalog_sources_log PRIMARY KEY (game_id, start_version_id),
    CONSTRAINT fk_wasm_catalog_sources_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_wasm_catalog_sources_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_wasm_catalog_sources_log_json_object CHECK (jsonb_typeof(catalog_json) = 'object'),
    CONSTRAINT ck_wasm_catalog_sources_log_version_range CHECK (start_version_id <= end_version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.wasm_catalog_sources_log IS 'wasm_catalog_sources 发布历史；仅变更过的 source 写入';

CREATE INDEX idx_wasm_catalog_sources_log_version
    ON public.wasm_catalog_sources_log (game_id, start_version_id, end_version_id);

CREATE TABLE public.published_wasm_catalog_snapshots (
    game_id varchar(64) NOT NULL,
    version_id bigint NOT NULL,
    version_code varchar(64) NOT NULL,
    schema_version varchar(64) NOT NULL,
    schema_hash varchar(80) NOT NULL,
    rules_hash varchar(80) NOT NULL,
    catalog_json jsonb NOT NULL,
    created_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_published_wasm_catalog_snapshots PRIMARY KEY (game_id, version_code),
    CONSTRAINT uq_published_wasm_catalog_snapshots_version UNIQUE (game_id, version_id),
    CONSTRAINT fk_published_wasm_catalog_snapshots_version FOREIGN KEY (game_id, version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT ck_published_wasm_catalog_snapshots_json_object CHECK (jsonb_typeof(catalog_json) = 'object')
);

COMMENT ON TABLE public.published_wasm_catalog_snapshots IS '已发布 Wasm Canonical Catalog 快照；Public 只读此表';
COMMENT ON COLUMN public.published_wasm_catalog_snapshots.catalog_json IS '完整 WasmCatalogV1（含 meta）';
COMMENT ON COLUMN public.published_wasm_catalog_snapshots.schema_hash IS 'schema 契约指纹，形如 sha256:...';
COMMENT ON COLUMN public.published_wasm_catalog_snapshots.rules_hash IS 'catalog 规则与定义指纹，形如 sha256:...';