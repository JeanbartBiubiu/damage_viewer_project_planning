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
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_attribute_definitions PRIMARY KEY (game_id, attr_key),
    CONSTRAINT ck_attribute_definitions_rate_target
        CHECK (
            (value_kind = 'rate' AND rate_target_attr_key IS NOT NULL)
            OR (value_kind <> 'rate' AND rate_target_attr_key IS NULL)
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
    CONSTRAINT pk_attribute_definitions_log PRIMARY KEY (game_id, attr_key, start_version_id),
    CONSTRAINT ck_attribute_definitions_log_rate_target
        CHECK (
            (value_kind = 'rate' AND rate_target_attr_key IS NOT NULL)
            OR (value_kind <> 'rate' AND rate_target_attr_key IS NULL)
        ),
    CONSTRAINT ck_attribute_definitions_log_sort_order
        CHECK (sort_order >= 0),
    CONSTRAINT fk_attribute_definitions_log_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_attribute_definitions_log_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.attribute_definitions_log IS '属性定义日志表（用于多版本差异分析；按 id+start_version 唯一）';

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
    target_id varchar(64) NOT NULL,
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
    target_id varchar(64) NOT NULL,
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
    target_id varchar(64) NOT NULL,
    binding_key varchar(64) NOT NULL,
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
    target_id varchar(64) NOT NULL,
    binding_key varchar(64) NOT NULL,
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
    skill_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    owner_id varchar(64),
    owner_type varchar(32),
    skill_key varchar(16),
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
    skill_id varchar(64) NOT NULL,
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    owner_id varchar(64),
    owner_type varchar(32),
    skill_key varchar(16),
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
    item_id varchar(64) NOT NULL,
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
    item_id varchar(64) NOT NULL,
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
    item_id varchar(64) NOT NULL,
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
    item_id varchar(64) NOT NULL,
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
    target_id varchar(64) NOT NULL,
    skill_id varchar(64) NOT NULL,
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
    target_id varchar(64) NOT NULL,
    skill_id varchar(64) NOT NULL,
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
