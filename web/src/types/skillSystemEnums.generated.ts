// 由 planning 真源 tools/system-enums/generate.mjs 生成；修改 contracts/system-enums/authoring.json 后重新生成。
// 固定值不表示所有运行位置都已支持；位置准入与作者目录保持独立。

// 触发动作
export const SKILL_TRIGGER_ACTION_TYPES = ["EXECUTE_EFFECT","START_PROCESS","FAIL_PROCESS","ADVANCE_PROCESS","MODIFY_INTERNAL_STATE"] as const;
export type SkillTriggerActionType = (typeof SKILL_TRIGGER_ACTION_TYPES)[number];
export const SKILL_TRIGGER_ACTION_TYPE_LABELS = {
  EXECUTE_EFFECT: "执行效果",
  START_PROCESS: "启动过程",
  FAIL_PROCESS: "令过程失败",
  ADVANCE_PROCESS: "推进当前过程",
  MODIFY_INTERNAL_STATE: "修改内部状态",
} as const satisfies Record<SkillTriggerActionType, string>;

// 内部状态修改操作
export const SKILL_TRIGGER_INTERNAL_STATE_OPERATIONS = ["REDUCE_RECOVERY"] as const;
export type SkillTriggerInternalStateOperation = (typeof SKILL_TRIGGER_INTERNAL_STATE_OPERATIONS)[number];
export const SKILL_TRIGGER_INTERNAL_STATE_OPERATION_LABELS = {
  REDUCE_RECOVERY: "减少下一次回充余时",
} as const satisfies Record<SkillTriggerInternalStateOperation, string>;

// 施放阶段
export const SKILL_TRIGGER_CAST_PHASES = ["INITIAL","RECAST","CHARGE_RELEASE"] as const;
export type SkillTriggerCastPhase = (typeof SKILL_TRIGGER_CAST_PHASES)[number];
export const SKILL_TRIGGER_CAST_PHASE_LABELS = {
  INITIAL: "首次施放",
  RECAST: "再次施放",
  CHARGE_RELEASE: "蓄力释放",
} as const satisfies Record<SkillTriggerCastPhase, string>;

// 战斗状态读值
export const SKILL_TRIGGER_COMBAT_STATUS_VALUE_KINDS = ["PRESENT","STACKS","REMAINING_MS"] as const;
export type SkillTriggerCombatStatusValueKind = (typeof SKILL_TRIGGER_COMBAT_STATUS_VALUE_KINDS)[number];
export const SKILL_TRIGGER_COMBAT_STATUS_VALUE_LABELS = {
  PRESENT: "存在",
  STACKS: "层数",
  REMAINING_MS: "剩余时间",
} as const satisfies Record<SkillTriggerCombatStatusValueKind, string>;

// 比较符
export const SKILL_TRIGGER_COMPARATORS = ["LT","LTE","EQ","NE","GTE","GT"] as const;
export type SkillTriggerComparator = (typeof SKILL_TRIGGER_COMPARATORS)[number];
export const SKILL_TRIGGER_COMPARATOR_LABELS = {
  LT: "小于",
  LTE: "小于等于",
  EQ: "等于",
  NE: "不等于",
  GTE: "大于等于",
  GT: "大于",
} as const satisfies Record<SkillTriggerComparator, string>;

// 触发条件
export const SKILL_TRIGGER_CONDITION_TYPES = ["ATTRIBUTE_COMPARE","STATUS_CHECK","LIFECYCLE_CHECK","TARGET_CATEGORY_CHECK","EXPLICIT_TARGET_IS_SOURCE","SKILL_HIT_TARGET_IS_ENEMY","INTERNAL_STATE_CHECK","EVENT_VALUE_COMPARE"] as const;
export type SkillTriggerConditionType = (typeof SKILL_TRIGGER_CONDITION_TYPES)[number];
export const SKILL_TRIGGER_CONDITION_TYPE_LABELS = {
  ATTRIBUTE_COMPARE: "属性比较",
  STATUS_CHECK: "战斗状态检查",
  LIFECYCLE_CHECK: "生命周期检查",
  TARGET_CATEGORY_CHECK: "事件对方类别",
  EXPLICIT_TARGET_IS_SOURCE: "显式目标为来源对象",
  SKILL_HIT_TARGET_IS_ENEMY: "技能命中敌方对象",
  INTERNAL_STATE_CHECK: "技能内部状态检查",
  EVENT_VALUE_COMPARE: "事件值比较",
} as const satisfies Record<SkillTriggerConditionType, string>;

// 触发伤害产生方式
export const SKILL_TRIGGER_DAMAGE_DELIVERY_KINDS = ["ANY","SKILL","BASIC_ATTACK"] as const;
export type SkillTriggerDamageDeliveryKind = (typeof SKILL_TRIGGER_DAMAGE_DELIVERY_KINDS)[number];
export const SKILL_TRIGGER_DAMAGE_DELIVERY_KIND_LABELS = {
  ANY: "任意",
  SKILL: "技能",
  BASIC_ATTACK: "普通攻击",
} as const satisfies Record<SkillTriggerDamageDeliveryKind, string>;

// 触发伤害来源性质
export const SKILL_TRIGGER_DAMAGE_ORIGIN_KINDS = ["ANY","DIRECT","REFLECTED"] as const;
export type SkillTriggerDamageOriginKind = (typeof SKILL_TRIGGER_DAMAGE_ORIGIN_KINDS)[number];
export const SKILL_TRIGGER_DAMAGE_ORIGIN_KIND_LABELS = {
  ANY: "任意",
  DIRECT: "直接伤害",
  REFLECTED: "反伤",
} as const satisfies Record<SkillTriggerDamageOriginKind, string>;

// 触发事件
export const SKILL_TRIGGER_EVENT_TYPES = ["SOURCE_INITIALIZED","SKILL_USED","BASIC_ATTACK_START","BASIC_ATTACK_HIT","BASIC_ATTACK_RECEIVED","SKILL_HIT","PROCESS_MOMENT","PROCESS_RESOLVED","RESULT_AVAILABLE","LIFECYCLE_MOMENT","DAMAGE_PENDING","DAMAGE_DEALT","DAMAGE_TAKEN","STATUS_CHANGED","HEALTH_THRESHOLD_CROSSED","INTERNAL_STATE_CHANGED","CONTROL_RECEIVED","ENTITY_DIED","ENTITY_UNTARGETABLE","KILL","TAKEDOWN","PROCESS_CANCEL_REQUESTED","SPELL_SHIELD_BLOCKED","HIT_LINK_APPLIED","ATTACK_LINK_APPLIED"] as const;
export type SkillTriggerEventType = (typeof SKILL_TRIGGER_EVENT_TYPES)[number];
export const SKILL_TRIGGER_EVENT_TYPE_LABELS = {
  SOURCE_INITIALIZED: "来源对象初始化完成",
  SKILL_USED: "技能被主动或消耗使用",
  BASIC_ATTACK_START: "普通攻击发起",
  BASIC_ATTACK_HIT: "普通攻击命中",
  BASIC_ATTACK_RECEIVED: "普通攻击命中接收（结果前）",
  SKILL_HIT: "技能命中",
  PROCESS_MOMENT: "当前技能过程到达固定时点",
  PROCESS_RESOLVED: "技能完成且绑定命中已结算",
  RESULT_AVAILABLE: "当前技能某个无生命周期基础结果到达可用时点",
  LIFECYCLE_MOMENT: "当前技能生命周期到达离散时点",
  DAMAGE_PENDING: "即将受到伤害",
  DAMAGE_DEALT: "来源对象造成伤害",
  DAMAGE_TAKEN: "来源对象受到伤害",
  STATUS_CHANGED: "指定对象的战斗状态施加或移除",
  HEALTH_THRESHOLD_CROSSED: "指定对象生命属性越过阈值",
  INTERNAL_STATE_CHANGED: "当前技能内部状态发生固定变化",
  CONTROL_RECEIVED: "来源对象受到控制",
  ENTITY_DIED: "指定对象死亡",
  ENTITY_UNTARGETABLE: "指定对象变为不可选取",
  KILL: "来源对象完成击杀",
  TAKEDOWN: "来源对象参与击杀",
  PROCESS_CANCEL_REQUESTED: "指定过程收到主动取消请求",
  SPELL_SHIELD_BLOCKED: "法术护盾成功阻挡",
  HIT_LINK_APPLIED: "应用命中联动",
  ATTACK_LINK_APPLIED: "触发攻击联动",
} as const satisfies Record<SkillTriggerEventType, string>;

// 事件使用方式
export const SKILL_TRIGGER_USE_KINDS = ["ACTIVE","CONSUMABLE","ANY"] as const;
export type SkillTriggerEventUseKind = (typeof SKILL_TRIGGER_USE_KINDS)[number];
export const SKILL_TRIGGER_USE_KIND_LABELS = {
  ACTIVE: "主动",
  CONSUMABLE: "消耗",
  ANY: "任意",
} as const satisfies Record<SkillTriggerEventUseKind, string>;

// 事件读值口径
export const SKILL_TRIGGER_EVENT_VALUE_KEYS = ["STEP_EXECUTION_INDEX","CHARGE_DURATION_MS","RECAST_COUNT","HIT_INDEX","SKILL_HIT_FIRST_CONTACT","SKILL_USE_CONTACT_COUNT","SKILL_HIT_SPELL_SHIELD_BLOCKED","LIFECYCLE_STACKS","PERIOD_INDEX","REMAINING_MS","STATE_BEFORE","STATE_AFTER","ATTRIBUTE_BEFORE","ATTRIBUTE_AFTER","THRESHOLD_VALUE","RAW_DAMAGE","POST_DEFENSE_DAMAGE","HEALTH_BEFORE","PROJECTED_HEALTH_AFTER","SHIELD_ABSORBED","ACTUAL_HP_LOSS","BLOCKED","IMMUNE","KILLED","LINK_INDEX","LINK_COUNT"] as const;
export type SkillTriggerEventValueKey = (typeof SKILL_TRIGGER_EVENT_VALUE_KEYS)[number];
export const SKILL_TRIGGER_EVENT_VALUE_LABELS = {
  STEP_EXECUTION_INDEX: "当前步骤第几次执行",
  CHARGE_DURATION_MS: "实际蓄力毫秒数",
  RECAST_COUNT: "当前过程已重施次数",
  HIT_INDEX: "当前命中序号",
  SKILL_HIT_FIRST_CONTACT: "本次使用首次目标接触",
  SKILL_USE_CONTACT_COUNT: "本次使用已结算接触数",
  SKILL_HIT_SPELL_SHIELD_BLOCKED: "技能命中被法术护盾阻挡",
  LIFECYCLE_STACKS: "当前生命周期层数",
  PERIOD_INDEX: "当前周期序号",
  REMAINING_MS: "当前生命周期剩余毫秒数",
  STATE_BEFORE: "数值内部状态变化前值",
  STATE_AFTER: "数值内部状态变化后值",
  ATTRIBUTE_BEFORE: "生命属性越阈值前值",
  ATTRIBUTE_AFTER: "生命属性越阈值后值",
  THRESHOLD_VALUE: "本次阈值取值值",
  RAW_DAMAGE: "原始伤害",
  POST_DEFENSE_DAMAGE: "防御后伤害",
  HEALTH_BEFORE: "受伤前生命",
  PROJECTED_HEALTH_AFTER: "预计受伤后生命",
  SHIELD_ABSORBED: "护盾吸收",
  ACTUAL_HP_LOSS: "实际扣血",
  BLOCKED: "是否被法术护盾阻挡（0/1）",
  IMMUNE: "是否被伤害免疫（0/1）",
  KILLED: "是否形成击杀（0/1）",
  LINK_INDEX: "本次序号（从 1 开始）",
  LINK_COUNT: "总次数（从 1 开始）",
} as const satisfies Record<SkillTriggerEventValueKey, string>;
export const SKILL_TRIGGER_EVENT_VALUE_DOMAINS = {
  STEP_EXECUTION_INDEX: "INTEGER",
  CHARGE_DURATION_MS: "DECIMAL",
  RECAST_COUNT: "INTEGER",
  HIT_INDEX: "INTEGER",
  SKILL_HIT_FIRST_CONTACT: "INTEGER",
  SKILL_USE_CONTACT_COUNT: "INTEGER",
  SKILL_HIT_SPELL_SHIELD_BLOCKED: "INTEGER",
  LIFECYCLE_STACKS: "INTEGER",
  PERIOD_INDEX: "INTEGER",
  REMAINING_MS: "DECIMAL",
  STATE_BEFORE: "INTEGER",
  STATE_AFTER: "INTEGER",
  ATTRIBUTE_BEFORE: "DECIMAL",
  ATTRIBUTE_AFTER: "DECIMAL",
  THRESHOLD_VALUE: "DECIMAL",
  RAW_DAMAGE: "DECIMAL",
  POST_DEFENSE_DAMAGE: "DECIMAL",
  HEALTH_BEFORE: "DECIMAL",
  PROJECTED_HEALTH_AFTER: "DECIMAL",
  SHIELD_ABSORBED: "DECIMAL",
  ACTUAL_HP_LOSS: "DECIMAL",
  BLOCKED: "INTEGER",
  IMMUNE: "INTEGER",
  KILLED: "INTEGER",
  LINK_INDEX: "INTEGER",
  LINK_COUNT: "INTEGER",
} as const satisfies Record<SkillTriggerEventValueKey, SkillTriggerValueDomain>;

// 生命越阈值方向
export const SKILL_TRIGGER_HEALTH_DIRECTIONS = ["UPWARD","DOWNWARD"] as const;
export type SkillTriggerHealthDirection = (typeof SKILL_TRIGGER_HEALTH_DIRECTIONS)[number];
export const SKILL_TRIGGER_HEALTH_DIRECTION_LABELS = {
  UPWARD: "向上",
  DOWNWARD: "向下",
} as const satisfies Record<SkillTriggerHealthDirection, string>;

// 内部状态变化种类
export const SKILL_TRIGGER_INTERNAL_STATE_CHANGE_KINDS = ["VALUE_CHANGED","OPTION_SELECTED","FLAG_CHANGED","COOLDOWN_READY"] as const;
export type SkillTriggerInternalStateChangeKind = (typeof SKILL_TRIGGER_INTERNAL_STATE_CHANGE_KINDS)[number];
export const SKILL_TRIGGER_INTERNAL_STATE_CHANGE_LABELS = {
  VALUE_CHANGED: "数值变化",
  OPTION_SELECTED: "模式选项变化",
  FLAG_CHANGED: "准备标记变化",
  COOLDOWN_READY: "内部冷却就绪",
} as const satisfies Record<SkillTriggerInternalStateChangeKind, string>;

// 内部状态读值
export const SKILL_TRIGGER_INTERNAL_STATE_VALUE_KINDS = ["VALUE","ATTACK_START_VALUE","OPTION_SELECTED","ENABLED","REMAINING_MS"] as const;
export type SkillTriggerInternalStateValueKind = (typeof SKILL_TRIGGER_INTERNAL_STATE_VALUE_KINDS)[number];
export const SKILL_TRIGGER_INTERNAL_STATE_VALUE_LABELS = {
  VALUE: "数值",
  ATTACK_START_VALUE: "本次攻击开始值",
  OPTION_SELECTED: "模式是否选中",
  ENABLED: "准备标记是否启用",
  REMAINING_MS: "剩余毫秒",
} as const satisfies Record<SkillTriggerInternalStateValueKind, string>;

// 生命周期检查
export const SKILL_TRIGGER_LIFECYCLE_CHECK_KINDS = ["PRESENT","ABSENT","STACKS_COMPARE"] as const;
export type SkillTriggerLifecycleCheckKind = (typeof SKILL_TRIGGER_LIFECYCLE_CHECK_KINDS)[number];
export const LIFECYCLE_CHECK_LABELS = {
  PRESENT: "存在",
  ABSENT: "不存在",
  STACKS_COMPARE: "层数比较",
} as const satisfies Record<SkillTriggerLifecycleCheckKind, string>;

// 生命周期离散事件
export const SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENTS = ["APPLICATION","FULL_STACKS","PERIODIC","NATURAL_END","EARLY_REMOVE"] as const;
export type SkillTriggerLifecycleEventMoment = (typeof SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENTS)[number];
export const SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENT_LABELS = {
  APPLICATION: "施加",
  FULL_STACKS: "满层",
  PERIODIC: "周期",
  NATURAL_END: "自然结束",
  EARLY_REMOVE: "提前移除",
} as const satisfies Record<SkillTriggerLifecycleEventMoment, string>;

// 同次使用范围
export const SKILL_TRIGGER_ONCE_PER_USE_SCOPES = ["SKILL","TARGET"] as const;
export type SkillTriggerOncePerUseScope = (typeof SKILL_TRIGGER_ONCE_PER_USE_SCOPES)[number];
export const SKILL_TRIGGER_ONCE_PER_USE_SCOPE_LABELS = {
  SKILL: "整个技能使用",
  TARGET: "每个目标",
} as const satisfies Record<SkillTriggerOncePerUseScope, string>;

// 前序结果读值
export const SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_KINDS = ["CONFIGURED_VALUE","RAW_DAMAGE","POST_DEFENSE_DAMAGE","SHIELD_ABSORBED","ACTUAL_HP_LOSS","ACTUAL_HEALING","BLOCKED","IMMUNE","STATUS_APPLIED","KILLED"] as const;
export type SkillTriggerPriorResultOutputKind = (typeof SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_KINDS)[number];
export const SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_LABELS = {
  CONFIGURED_VALUE: "基础配置值",
  RAW_DAMAGE: "原始伤害",
  POST_DEFENSE_DAMAGE: "防御后伤害",
  SHIELD_ABSORBED: "护盾吸收",
  ACTUAL_HP_LOSS: "实际扣血",
  ACTUAL_HEALING: "实际治疗",
  BLOCKED: "是否被法术护盾阻挡（0/1）",
  IMMUNE: "是否被伤害免疫（0/1）",
  STATUS_APPLIED: "是否成功施加状态（0/1）",
  KILLED: "是否形成击杀（0/1）",
} as const satisfies Record<SkillTriggerPriorResultOutputKind, string>;
export const SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_DOMAINS = {
  CONFIGURED_VALUE: "DECIMAL",
  RAW_DAMAGE: "DECIMAL",
  POST_DEFENSE_DAMAGE: "DECIMAL",
  SHIELD_ABSORBED: "DECIMAL",
  ACTUAL_HP_LOSS: "DECIMAL",
  ACTUAL_HEALING: "DECIMAL",
  BLOCKED: "INTEGER",
  IMMUNE: "INTEGER",
  STATUS_APPLIED: "INTEGER",
  KILLED: "INTEGER",
} as const satisfies Record<SkillTriggerPriorResultOutputKind, SkillTriggerValueDomain>;

// 过程失败原因
export const PROCESS_FAILURE_REASONS = ["CONTROLLED","SOURCE_DIED","TARGET_UNTARGETABLE","ACTIVE_CANCELLED","EVENT_ABORTED"] as const;
export type SkillProcessFailureReason = (typeof PROCESS_FAILURE_REASONS)[number];
export const PROCESS_FAILURE_REASON_LABELS = {
  CONTROLLED: "受到控制",
  SOURCE_DIED: "来源对象死亡",
  TARGET_UNTARGETABLE: "当前目标不可选取",
  ACTIVE_CANCELLED: "主动取消",
  EVENT_ABORTED: "当前事件终止",
} as const satisfies Record<SkillProcessFailureReason, string>;

// 近期受伤读值
export const SKILL_TRIGGER_RECENT_DAMAGE_OUTPUT_KINDS = ["POST_DEFENSE_DAMAGE","ACTUAL_HP_LOSS"] as const;
export type SkillTriggerRecentDamageOutputKind = (typeof SKILL_TRIGGER_RECENT_DAMAGE_OUTPUT_KINDS)[number];
export const SKILL_TRIGGER_RECENT_DAMAGE_OUTPUT_LABELS = {
  POST_DEFENSE_DAMAGE: "防御后伤害",
  ACTUAL_HP_LOSS: "实际扣血",
} as const satisfies Record<SkillTriggerRecentDamageOutputKind, string>;

// 运行输入来源
export const SKILL_TRIGGER_SOURCE_TYPES = ["INTERNAL_STATE","COMBAT_STATUS","EVENT_VALUE","SOURCE_CAST_RESOURCE_COST","SCENE_ATTRIBUTE_SNAPSHOT","SCENE_INITIAL_PARAMETER","PRIOR_ACTION_RESULT","COMBAT_ELAPSED_TIME","RECENT_DAMAGE_SUM"] as const;
export type SkillTriggerRuntimeInputSourceType = (typeof SKILL_TRIGGER_SOURCE_TYPES)[number];
export const SKILL_TRIGGER_SOURCE_TYPE_LABELS = {
  INTERNAL_STATE: "技能内部状态",
  COMBAT_STATUS: "战斗状态",
  EVENT_VALUE: "当前事件值",
  SOURCE_CAST_RESOURCE_COST: "来源施放资源消耗",
  SCENE_ATTRIBUTE_SNAPSHOT: "场景属性快照",
  SCENE_INITIAL_PARAMETER: "场景显式初值",
  PRIOR_ACTION_RESULT: "更早动作结果",
  COMBAT_ELAPSED_TIME: "本次入战后时长",
  RECENT_DAMAGE_SUM: "近期受伤累计",
} as const satisfies Record<SkillTriggerRuntimeInputSourceType, string>;

// 战斗状态变化
export const SKILL_TRIGGER_STATUS_CHANGE_KINDS = ["APPLY","REMOVE"] as const;
export type SkillTriggerStatusChangeKind = (typeof SKILL_TRIGGER_STATUS_CHANGE_KINDS)[number];
export const SKILL_TRIGGER_STATUS_CHANGE_LABELS = {
  APPLY: "施加",
  REMOVE: "移除",
} as const satisfies Record<SkillTriggerStatusChangeKind, string>;

// 战斗状态检查
export const SKILL_TRIGGER_STATUS_CHECK_KINDS = ["PRESENT","ABSENT","STACKS_COMPARE","REMAINING_MS_COMPARE"] as const;
export type SkillTriggerStatusCheckKind = (typeof SKILL_TRIGGER_STATUS_CHECK_KINDS)[number];
export const SKILL_TRIGGER_STATUS_CHECK_LABELS = {
  PRESENT: "存在",
  ABSENT: "不存在",
  STACKS_COMPARE: "层数比较",
  REMAINING_MS_COMPARE: "剩余时间比较",
} as const satisfies Record<SkillTriggerStatusCheckKind, string>;

// 触发主体
export const SKILL_TRIGGER_SUBJECTS = ["SOURCE","CURRENT_TARGET","EVENT_SOURCE"] as const;
export type SkillTriggerSubject = (typeof SKILL_TRIGGER_SUBJECTS)[number];
export const SKILL_TRIGGER_SUBJECT_LABELS = {
  SOURCE: "来源对象",
  CURRENT_TARGET: "当前目标",
  EVENT_SOURCE: "事件来源对象",
} as const satisfies Record<SkillTriggerSubject, string>;

// 事件对方类别
export const SKILL_TRIGGER_TARGET_CATEGORIES = ["CHAMPION","EPIC_MONSTER","MINION","NON_EPIC_MONSTER","STRUCTURE"] as const;
export type SkillTriggerTargetCategory = (typeof SKILL_TRIGGER_TARGET_CATEGORIES)[number];
export const TARGET_CATEGORY_LABELS = {
  CHAMPION: "英雄",
  EPIC_MONSTER: "史诗野怪",
  MINION: "小兵",
  NON_EPIC_MONSTER: "非史诗野怪",
  STRUCTURE: "建筑",
} as const satisfies Record<SkillTriggerTargetCategory, string>;

// 动作目标上下文
export const SKILL_TRIGGER_TARGET_CONTEXTS = ["CURRENT_TARGET","EVENT_SOURCE"] as const;
export type SkillTriggerTargetContext = (typeof SKILL_TRIGGER_TARGET_CONTEXTS)[number];
export const SKILL_TRIGGER_TARGET_CONTEXT_LABELS = {
  CURRENT_TARGET: "当前目标",
  EVENT_SOURCE: "事件来源对象",
} as const satisfies Record<SkillTriggerTargetContext, string>;

// 运行输入数值类型
export const SKILL_TRIGGER_VALUE_DOMAINS = ["INTEGER","DECIMAL"] as const;
export type SkillTriggerValueDomain = (typeof SKILL_TRIGGER_VALUE_DOMAINS)[number];
export const SKILL_TRIGGER_VALUE_TYPE_LABELS = {
  INTEGER: "整数",
  DECIMAL: "小数",
} as const satisfies Record<SkillTriggerValueDomain, string>;

// 过程激活方式
export const SKILL_PROCESS_ACTIVATION_TYPES = ["ACTIVE","PASSIVE","CONSUMABLE"] as const;
export type SkillProcessActivationType = (typeof SKILL_PROCESS_ACTIVATION_TYPES)[number];
export const SKILL_PROCESS_ACTIVATION_TYPE_LABELS = {
  ACTIVE: "主动",
  PASSIVE: "被动",
  CONSUMABLE: "消耗",
} as const satisfies Record<SkillProcessActivationType, string>;

// 强化普攻消费时点
export const EMPOWERED_CONSUME_MOMENTS = ["ATTACK_START","ATTACK_HIT"] as const;
export type SkillProcessEmpoweredConsumeMoment = (typeof EMPOWERED_CONSUME_MOMENTS)[number];
export const EMPOWERED_CONSUME_MOMENT_LABELS = {
  ATTACK_START: "攻击发起",
  ATTACK_HIT: "攻击命中",
} as const satisfies Record<SkillProcessEmpoweredConsumeMoment, string>;

// 首次执行方式
export const SKILL_PROCESS_FIRST_EXECUTIONS = ["IMMEDIATE","AFTER_INTERVAL","CUSTOM_WINDOW"] as const;
export type SkillProcessFirstExecutionKind = (typeof SKILL_PROCESS_FIRST_EXECUTIONS)[number];
export const FIRST_EXECUTION_LABELS = {
  IMMEDIATE: "立即执行",
  AFTER_INTERVAL: "等待一个间隔",
  CUSTOM_WINDOW: "指定首末执行窗口",
} as const satisfies Record<SkillProcessFirstExecutionKind, string>;
export const SKILL_PROCESS_INTERVAL_FIRST_EXECUTIONS = ["IMMEDIATE","AFTER_INTERVAL"] as const satisfies readonly SkillProcessFirstExecutionKind[];
export type SkillProcessFirstExecution = (typeof SKILL_PROCESS_INTERVAL_FIRST_EXECUTIONS)[number];

// 过程与步骤时点
export const SKILL_PROCESS_MOMENT_TYPES = ["PROCESS_START","STEP_START","STEP_EXECUTION","STEP_COMPLETE","STEP_TIMEOUT","PROCESS_COMPLETE","PROCESS_FAILURE"] as const;
export type SkillProcessMomentType = (typeof SKILL_PROCESS_MOMENT_TYPES)[number];
export const SKILL_PROCESS_MOMENT_TYPE_LABELS = {
  PROCESS_START: "过程开始",
  STEP_START: "步骤开始",
  STEP_EXECUTION: "步骤执行",
  STEP_COMPLETE: "步骤完成",
  STEP_TIMEOUT: "步骤超时",
  PROCESS_COMPLETE: "过程完成",
  PROCESS_FAILURE: "过程失败",
} as const satisfies Record<SkillProcessMomentType, string>;
export const PROCESS_LEVEL_MOMENT_TYPES = ["PROCESS_START","PROCESS_COMPLETE","PROCESS_FAILURE"] as const satisfies readonly SkillProcessMomentType[];
export type SkillProcessProcessMomentType = (typeof PROCESS_LEVEL_MOMENT_TYPES)[number];
export const STEP_LEVEL_MOMENT_TYPES = ["STEP_START","STEP_EXECUTION","STEP_COMPLETE","STEP_TIMEOUT"] as const satisfies readonly SkillProcessMomentType[];
export type SkillProcessStepMomentType = (typeof STEP_LEVEL_MOMENT_TYPES)[number];

// 内部状态操作
export const SKILL_PROCESS_STATE_OPERATION_KINDS = ["INCREASE","DECREASE","CONSUME","SET","RESET","SELECT","ENABLE","DISABLE","TOGGLE","START"] as const;
export type SkillProcessStateOperationKind = (typeof SKILL_PROCESS_STATE_OPERATION_KINDS)[number];
export const STATE_OPERATION_LABELS = {
  INCREASE: "增加",
  DECREASE: "减少",
  CONSUME: "消耗",
  SET: "设置",
  RESET: "重置",
  SELECT: "选择",
  ENABLE: "启用",
  DISABLE: "停用",
  TOGGLE: "切换",
  START: "开始",
} as const satisfies Record<SkillProcessStateOperationKind, string>;

// 过程步骤
export const SKILL_PROCESS_STEP_TYPES = ["IMMEDIATE","DELAY","MULTI_HIT","PERIODIC","CHANNEL","CHARGE","RECAST","EMPOWERED_BASIC_ATTACK"] as const;
export type SkillProcessStepType = (typeof SKILL_PROCESS_STEP_TYPES)[number];
export const SKILL_PROCESS_STEP_TYPE_LABELS = {
  IMMEDIATE: "立即",
  DELAY: "延迟",
  MULTI_HIT: "多段",
  PERIODIC: "周期",
  CHANNEL: "引导",
  CHARGE: "蓄力",
  RECAST: "重施",
  EMPOWERED_BASIC_ATTACK: "强化下一次普通攻击",
} as const satisfies Record<SkillProcessStepType, string>;

// 自动技能等待原因
export const AUTOMATIC_SKILL_WAIT_REASONS = ["OWN_COOLDOWN","RELATED_COOLDOWN","RELEASE_QUALIFICATION","ACTION_OCCUPIED","PROCESS_ACTIVE","MECHANIC_RESOURCE","AUTHOR_CONDITION"] as const;
export type AutomaticSkillWaitReason = (typeof AUTOMATIC_SKILL_WAIT_REASONS)[number];
export const AUTOMATIC_SKILL_WAIT_REASON_LABELS = {
  OWN_COOLDOWN: "自身冷却",
  RELATED_COOLDOWN: "关联冷却",
  RELEASE_QUALIFICATION: "缺释放资格",
  ACTION_OCCUPIED: "行动占用",
  PROCESS_ACTIVE: "同来源已有过程",
  MECHANIC_RESOURCE: "机制资源不足",
  AUTHOR_CONDITION: "作者条件不成立",
} as const satisfies Record<AutomaticSkillWaitReason, string>;

// 自动技能记录类别
export const AUTOMATIC_SKILL_RECORD_KINDS = ["ATTEMPT_REJECTED","ABORTED_BEFORE_START","STARTED","COMPLETED","FAILED","QUALIFICATION_GRANTED","QUALIFICATION_CONSUMED","WAIT_CHANGED"] as const;
export type AutomaticSkillRecordKind = (typeof AUTOMATIC_SKILL_RECORD_KINDS)[number];
export const AUTOMATIC_SKILL_RECORD_KIND_LABELS = {
  ATTEMPT_REJECTED: "尝试拒绝",
  ABORTED_BEFORE_START: "开始前中止",
  STARTED: "成功开始",
  COMPLETED: "成功终结",
  FAILED: "失败终结",
  QUALIFICATION_GRANTED: "资格授予",
  QUALIFICATION_CONSUMED: "资格消费",
  WAIT_CHANGED: "等待变化",
} as const satisfies Record<AutomaticSkillRecordKind, string>;

// 修正区域计算方式
export const MODIFIER_ZONE_CALCULATION_MODES = ["FLAT_ADD","RATIO_ADD","RATIO_MULTIPLY","RATIO_MAX","RATIO_COMPLEMENT_MULTIPLY"] as const;
export type ModifierZoneCalculationMode = (typeof MODIFIER_ZONE_CALCULATION_MODES)[number];
export const MODIFIER_ZONE_CALCULATION_MODE_LABELS = {
  FLAT_ADD: "固定值加算",
  RATIO_ADD: "比例加算",
  RATIO_MULTIPLY: "比例乘算",
  RATIO_MAX: "比例减少取强",
  RATIO_COMPLEMENT_MULTIPLY: "剩余比例连乘",
} as const satisfies Record<ModifierZoneCalculationMode, string>;
