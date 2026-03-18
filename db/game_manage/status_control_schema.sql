-- =============================================================================
-- Damage Viewer System - Simple Status Action Control Schema
-- =============================================================================
--
-- 设计目标：
-- 1. 只保留一张主表 + 一张日志表。
-- 2. 只表达两件事：
--    - 某种状态下，哪些动作不能执行
--    - 某种状态下，哪些正在执行的动作会被终止
-- 3. 继续依赖 public.types / public.type_relations：
--    - status_type_id：状态 type
--    - action_type_ids：动作大类 type 集合，例如 basic_attack / cast_skill
--    - action_match_type_ids：可选，进一步匹配技能/动作身上的 type 标签集合
--    - interrupt_phase_type_ids：可选，表示会被终止的执行阶段 type 集合，例如 cast / channel
--
-- 推荐 type 约定：
-- - status/*       具体状态，例如 stun_basic / silence_basic / fear_basic
-- - action/*       动作类型，例如 basic_attack / cast_skill
-- - skill_tag/*    技能标签，例如 dash / blink / channel_skill
-- - exec_phase/*   执行阶段，例如 cast / channel / basic_attack_windup

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
