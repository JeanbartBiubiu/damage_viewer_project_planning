-- =============================================================================
-- Damage Viewer System - Status Resource Schema Draft
-- =============================================================================
--
-- 设计说明：
-- 1. 本文件单独维护，先不直接并入 schema.sql。
-- 2. 本文件用于把“状态资源”从 skills.mechanics_config 中拆出，形成独立真源。
-- 3. skills 仍负责动作编排与触发入口；状态的持续、叠层、属性修改、周期伤害/治疗改由这里管理。
-- 4. status_action_control_rules 继续承担“状态对动作的 forbid / interrupt 约束”；
--    本文件新增 control_state_profiles 承担“角色行动状态流转/强制行为”的控制语义。
-- 5. 第一版按编辑态资源表设计：不加跨表外键，引用完整性由服务层写入校验与发布校验保证。
-- 6. 本文件已补齐主表 + _log 表草案；正式接入时，仍需同步补充 triggers.sql 的自动分区逻辑。

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
