import { lifecycleConditionError, LIFECYCLE_CHECK_LABELS } from './lifecycleCondition';
import { allowsSourceCastResourceCost, sourceCastResourceCostError } from './sourceCastResourceCost';
import { allowsTargetCategoryCheck, targetCategoryConditionError, TARGET_CATEGORY_LABELS } from './targetCategoryCondition';
import type { Attribute } from '../../../../types/attribute';
import { fixedValue, numericFormulaKey, numericParameterKey } from '../../../../types/numericValue';
import { numericValueError, numericValueSummary, numericValuesIn } from '../numericValueForm';
import { type NumericValue } from '../../../../types/numericValue';
import { ApiRequestError } from '../../../../services/apiClient';
import type { DamageType } from '../../../../types/damageType';
import type { FormulaAttributeValueKind, FormulaExpressionNode, SkillFormula } from '../../../../types/skillFormula';
import type { SkillInternalState, SkillInternalStateType } from '../../../../types/skillInternalState';
import type { SkillParameter, SkillParameterValueType } from '../../../../types/skillParameter';
import type {
  SkillEffect,
  SkillEffectResult,
  SkillEffectResultType
} from '../../../../types/skillEffect';
import type {
  SkillProcess,
  SkillProcessMoment,
  SkillProcessMomentType,
  SkillProcessStepType
} from '../../../../types/skillProcess';
import type {
  CreateSkillTriggerRuleRequest,
  SkillTriggerAction,
  SkillTriggerActionType,
  SkillTriggerAttributeCompareDetail,
  SkillTriggerCombatStatusBinding,
  SkillTriggerCombatStatusBindingDetail,
  SkillTriggerCombatStatusMeasuredBindingDetail,
  SkillTriggerCombatStatusPresentBindingDetail,
  SkillTriggerCombatStatusValueKind,
  SkillTriggerComparator,
  SkillTriggerCondition,
  SkillTriggerConditionGroup,
  SkillTriggerConditionType,
  SkillTriggerLifecycleCheckDetail,
  SkillTriggerDamageDeliveryKind,
  SkillTriggerDamageOriginKind,
  SkillTriggerEventSource,
  SkillTriggerEventType,
  SkillTriggerEventUseKind,
  SkillTriggerEventValueBinding,
  SkillTriggerEventValueBindingDetail,
  SkillTriggerEventValueCompareDetail,
  SkillTriggerEventValueKey,
  SkillTriggerHealthDirection,
  SkillTriggerInternalStateBinding,
  SkillTriggerInternalStateBindingDetail,
  SkillTriggerInternalStateChangeKind,
  SkillTriggerInternalStateCheckDetail,
  SkillTriggerInternalStateEnabledDetail,
  SkillTriggerInternalStateOptionDetail,
  SkillTriggerInternalStateRemainingDetail,
  SkillTriggerInternalStateValueDetail,
  SkillTriggerInternalStateValueKind,
  SkillTriggerLifecycleEventMoment,
  SkillTriggerPriorResultBinding,
  SkillTriggerPriorResultBindingDetail,
  SkillTriggerPriorResultOutputKind,
  SkillTriggerProcessFailureReason,
  SkillTriggerResultModifier,
  SkillTriggerRuleDetail,
  SkillTriggerRuntimeInputBinding,
  SkillTriggerRuntimeInputSourceType,
  SkillTriggerSourceCastResourceCostBinding,
  SkillTriggerStatusChangeKind,
  SkillTriggerStatusCheckDetail,
  SkillTriggerStatusCheckKind,
  SkillTriggerStatusCompareDetail,
  SkillTriggerStatusPresenceDetail,
  SkillTriggerSubject,
  SkillTriggerTargetContext,
  SkillTriggerTargetCategoryCheckDetail,
  SkillTriggerValueDomain,
  UpdateSkillTriggerRuleRequest
} from '../../../../types/skillTriggerRule';
import { FORMULA_ATTRIBUTE_VALUE_KINDS, attributeValueKindLabel } from '../formulaExpression';
import { isProcessLevelMoment, SKILL_PROCESS_MOMENT_TYPE_LABELS } from '../processes/processForm';
import { SKILL_INTERNAL_STATE_TYPE_LABELS } from '../processes/internalStateForm';

export const SKILL_TRIGGER_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const SKILL_TRIGGER_ENTRY_LABEL = '条件与触发';
export const SKILL_TRIGGER_EMPTY_STATE = '当前技能还没有条件与触发规则';
export const SKILL_TRIGGER_CONDITION_GROUP_HINT =
  '不添加条件时直接触发；多个条件组满足任意一组即可，同一组内必须全部满足。';
export const SKILL_TRIGGER_GROUP_OR_LABEL = '或者';
export const SKILL_TRIGGER_GROUP_AND_LABEL = '并且';
export const SKILL_TRIGGER_UNSAVED_CONFIRM = '当前修改尚未保存，确定要离开吗？';
export const SKILL_TRIGGER_FAIL_PROCESS_LAST_MESSAGE = '令过程失败必须保持为最后一个动作。';
export const SKILL_TRIGGER_CYCLE_MESSAGE = '当前关系形成没有保护的循环';
export const SKILL_TRIGGER_CYCLE_HINT = '可增加每目标冷却、单次过程最大触发次数或调整关系。';
export const SKILL_TRIGGER_RESULT_EVENT_GRAPH_HINT =
  '斩杀结果可产生击杀/死亡事件；命中联动应用产生应用命中联动事件；攻击联动应用产生触发攻击联动事件。来源技能只缩小事件匹配范围。';
export const SKILL_TRIGGER_SOURCE_SKILL_FILTER_HINT =
  '空值表示任意技能；选择具体技能只缩小事件匹配范围。';
export const SKILL_TRIGGER_BOOLEAN_EVENT_VALUE_HINT = '否 = 0，是 = 1';
export const SKILL_TRIGGER_PRIOR_BOOLEAN_OUTPUT_HINT = '以 0/1 供值';
export const SKILL_TRIGGER_SHAPE_IN_USE_MESSAGE = '该结构仍被条件与触发规则使用';
export const SKILL_TRIGGER_RESULT_IN_USE_MESSAGE = '该结果仍被条件与触发规则使用';
export const SKILL_TRIGGER_RUNTIME_INPUT_IN_USE_MESSAGE = '该公式参数仍被条件与触发规则使用';
export const SKILL_TRIGGER_ADJUST_RULES_BEFORE_EFFECT_HINT = '请先调整条件与触发规则再保存效果。';
export const SKILL_TRIGGER_SOURCE_EFFECT_LOAD_MESSAGE = '来源效果详情未加载，无法校验前序结果。请重试。';

export const SKILL_TRIGGER_PRODUCED_EVENTS_BY_RESULT = {
  EXECUTE: ['KILL', 'ENTITY_DIED'],
  HIT_LINK_APPLICATION: ['HIT_LINK_APPLIED'],
  ATTACK_LINK_APPLICATION: ['ATTACK_LINK_APPLIED']
} as const;
export const SKILL_TRIGGER_PARAMETER_IN_USE_MESSAGE =
  '该参数正在被技能公式或条件与触发规则使用，不能删除';
export const SKILL_TRIGGER_INTERNAL_STATE_IN_USE_MESSAGE =
  '该内部状态正在被技能过程或条件与触发规则使用，不能删除';
export const DISABLED_CATALOG_LABEL = '已停用';
export const MISSING_CATALOG_LABEL = '目录缺失';
export const INCOMPLETE_CATALOG_MESSAGE = '缺少当前表单必需目录，无法保存。';
export const RESULT_MODIFIER_ORDER_HINT = '应用在效果基础修正之后';
export const MAX_TRIGGERS_SCOPE_HINT = '只保存次数取值，不执行计数。';

export const SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_KINDS = [
  'CONFIGURED_VALUE',
  'RAW_DAMAGE',
  'POST_DEFENSE_DAMAGE',
  'SHIELD_ABSORBED',
  'ACTUAL_HP_LOSS',
  'ACTUAL_HEALING',
  'BLOCKED',
  'IMMUNE',
  'STATUS_APPLIED',
  'KILLED'
] as const satisfies readonly SkillTriggerPriorResultOutputKind[];

export const SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_LABELS = {
  CONFIGURED_VALUE: '基础配置值',
  RAW_DAMAGE: '原始伤害',
  POST_DEFENSE_DAMAGE: '防御后伤害',
  SHIELD_ABSORBED: '护盾吸收',
  ACTUAL_HP_LOSS: '实际扣血',
  ACTUAL_HEALING: '实际治疗',
  BLOCKED: '是否被法术护盾阻挡（0/1）',
  IMMUNE: '是否被伤害免疫（0/1）',
  STATUS_APPLIED: '是否成功施加状态（0/1）',
  KILLED: '是否形成击杀（0/1）'
} as const satisfies { [K in SkillTriggerPriorResultOutputKind]: string };

export const SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_DOMAINS = {
  CONFIGURED_VALUE: 'DECIMAL',
  RAW_DAMAGE: 'DECIMAL',
  POST_DEFENSE_DAMAGE: 'DECIMAL',
  SHIELD_ABSORBED: 'DECIMAL',
  ACTUAL_HP_LOSS: 'DECIMAL',
  ACTUAL_HEALING: 'DECIMAL',
  BLOCKED: 'INTEGER',
  IMMUNE: 'INTEGER',
  STATUS_APPLIED: 'INTEGER',
  KILLED: 'INTEGER'
} as const satisfies { [K in SkillTriggerPriorResultOutputKind]: SkillTriggerValueDomain };

export const SKILL_TRIGGER_BOOLEAN_PRIOR_RESULT_OUTPUT_KINDS = [
  'BLOCKED',
  'IMMUNE',
  'STATUS_APPLIED',
  'KILLED'
] as const satisfies readonly SkillTriggerPriorResultOutputKind[];

const BLOCKABLE_PRIOR_RESULT_TYPES = new Set<SkillEffectResultType>([
  'DAMAGE',
  'ATTRIBUTE_CHANGE',
  'RESOURCE_CHANGE',
  'COOLDOWN_CHANGE',
  'STATUS_OPERATION',
  'LIFECYCLE_OPERATION',
  'EXECUTE',
  'HIT_LINK_APPLICATION',
  'ATTACK_LINK_APPLICATION'
]);

export const FORBIDDEN_PRIOR_RESULT_OUTPUT_KINDS = [
  'MODIFIER_ZONE_SUM',
  'MODIFIER_ZONE_FACTOR',
  'FINAL_MODIFIED_VALUE',
  'ZONE_ADDEND'
] as const;

export const SKILL_TRIGGER_DAMAGE_DELIVERY_KIND_LABELS = {
  ANY: '任意',
  SKILL: '技能',
  BASIC_ATTACK: '普通攻击'
} as const satisfies { [K in SkillTriggerDamageDeliveryKind]: string };

export const SKILL_TRIGGER_DAMAGE_ORIGIN_KIND_LABELS = {
  ANY: '任意',
  DIRECT: '直接伤害',
  REFLECTED: '反伤'
} as const satisfies { [K in SkillTriggerDamageOriginKind]: string };

export const SKILL_TRIGGER_EVENT_TYPES = [
  'SKILL_USED',
  'BASIC_ATTACK_START',
  'BASIC_ATTACK_HIT',
  'SKILL_HIT',
  'PROCESS_MOMENT',
  'RESULT_AVAILABLE',
  'LIFECYCLE_MOMENT',
  'DAMAGE_PENDING',
  'DAMAGE_DEALT',
  'DAMAGE_TAKEN',
  'STATUS_CHANGED',
  'HEALTH_THRESHOLD_CROSSED',
  'INTERNAL_STATE_CHANGED',
  'CONTROL_RECEIVED',
  'ENTITY_DIED',
  'ENTITY_UNTARGETABLE',
  'KILL',
  'PROCESS_CANCEL_REQUESTED',
  'SPELL_SHIELD_BLOCKED',
  'HIT_LINK_APPLIED',
  'ATTACK_LINK_APPLIED'
] as const satisfies readonly SkillTriggerEventType[];

export const SKILL_TRIGGER_CONDITION_TYPES = [
  'ATTRIBUTE_COMPARE',
  'STATUS_CHECK',
  'LIFECYCLE_CHECK',
  'TARGET_CATEGORY_CHECK',
  'INTERNAL_STATE_CHECK',
  'EVENT_VALUE_COMPARE'
] as const satisfies readonly SkillTriggerConditionType[];

export const SKILL_TRIGGER_ACTION_TYPES = [
  'EXECUTE_EFFECT',
  'START_PROCESS',
  'FAIL_PROCESS'
] as const satisfies readonly SkillTriggerActionType[];

export const SKILL_TRIGGER_SOURCE_TYPES = [
  'INTERNAL_STATE',
  'COMBAT_STATUS',
  'EVENT_VALUE',
  'SOURCE_CAST_RESOURCE_COST',
  'PRIOR_ACTION_RESULT'
] as const satisfies readonly SkillTriggerRuntimeInputSourceType[];

export const SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENTS = [
  'APPLICATION',
  'FULL_STACKS',
  'PERIODIC',
  'NATURAL_END',
  'EARLY_REMOVE'
] as const satisfies readonly SkillTriggerLifecycleEventMoment[];

export const SKILL_TRIGGER_EVENT_VALUE_KEYS = [
  'STEP_EXECUTION_INDEX',
  'CHARGE_DURATION_MS',
  'RECAST_COUNT',
  'HIT_INDEX',
  'LIFECYCLE_STACKS',
  'PERIOD_INDEX',
  'REMAINING_MS',
  'STATE_BEFORE',
  'STATE_AFTER',
  'ATTRIBUTE_BEFORE',
  'ATTRIBUTE_AFTER',
  'THRESHOLD_VALUE',
  'RAW_DAMAGE',
  'POST_DEFENSE_DAMAGE',
  'HEALTH_BEFORE',
  'PROJECTED_HEALTH_AFTER',
  'SHIELD_ABSORBED',
  'ACTUAL_HP_LOSS',
  'BLOCKED',
  'IMMUNE',
  'KILLED',
  'LINK_INDEX',
  'LINK_COUNT'
] as const satisfies readonly SkillTriggerEventValueKey[];

export const SKILL_TRIGGER_COMPARATORS = [
  'LT',
  'LTE',
  'EQ',
  'NE',
  'GTE',
  'GT'
] as const satisfies readonly SkillTriggerComparator[];

export type SkillTriggerCatalogKind =
  | 'skills'
  | 'attributes'
  | 'statuses'
  | 'parameters'
  | 'formulas'
  | 'effects'
  | 'damageTypes'
  | 'processes'
  | 'internalStates';

export type SkillTriggerCatalogNeed =
  | SkillTriggerCatalogKind
  | 'steps'
  | 'results';

export type CatalogLoadState = 'idle' | 'loading' | 'ready' | 'error';

export type SkillTriggerEventCapability = {
  eventType: SkillTriggerEventType;
  label: string;
  currentTargetBinding: string;
  hasEventSource: boolean;
  requiredCatalogs: readonly SkillTriggerCatalogNeed[];
  detailFields: readonly string[];
};

export const SKILL_TRIGGER_EVENT_TYPE_LABELS = {
  SKILL_USED: '技能被主动或消耗使用',
  BASIC_ATTACK_START: '普通攻击发起',
  BASIC_ATTACK_HIT: '普通攻击命中',
  SKILL_HIT: '技能命中',
  PROCESS_MOMENT: '当前技能过程到达固定时点',
  RESULT_AVAILABLE: '当前技能某个无生命周期基础结果到达可用时点',
  LIFECYCLE_MOMENT: '当前技能生命周期到达离散时点',
  DAMAGE_PENDING: '即将受到伤害',
  DAMAGE_DEALT: '来源对象造成伤害',
  DAMAGE_TAKEN: '来源对象受到伤害',
  STATUS_CHANGED: '指定对象的战斗状态施加或移除',
  HEALTH_THRESHOLD_CROSSED: '指定对象生命属性越过阈值',
  INTERNAL_STATE_CHANGED: '当前技能内部状态发生固定变化',
  CONTROL_RECEIVED: '来源对象受到控制',
  ENTITY_DIED: '指定对象死亡',
  ENTITY_UNTARGETABLE: '指定对象变为不可选取',
  KILL: '来源对象完成击杀',
  PROCESS_CANCEL_REQUESTED: '指定过程收到主动取消请求',
  SPELL_SHIELD_BLOCKED: '法术护盾成功阻挡',
  HIT_LINK_APPLIED: '应用命中联动',
  ATTACK_LINK_APPLIED: '触发攻击联动'
} as const satisfies { [K in SkillTriggerEventType]: string };

export const SKILL_TRIGGER_EVENT_CAPABILITIES: {
  [K in SkillTriggerEventType]: SkillTriggerEventCapability
} = {
  SKILL_USED: {
    eventType: 'SKILL_USED',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.SKILL_USED,
    currentTargetBinding: '该次技能使用的显式目标；没有时为来源对象。',
    hasEventSource: false,
    requiredCatalogs: ['skills'],
    detailFields: ['sourceSkillKey', 'useKind']
  },
  BASIC_ATTACK_START: {
    eventType: 'BASIC_ATTACK_START',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.BASIC_ATTACK_START,
    currentTargetBinding: '本次普通攻击目标。',
    hasEventSource: false,
    requiredCatalogs: [],
    detailFields: []
  },
  BASIC_ATTACK_HIT: {
    eventType: 'BASIC_ATTACK_HIT',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.BASIC_ATTACK_HIT,
    currentTargetBinding: '本次普通攻击命中的对象。',
    hasEventSource: false,
    requiredCatalogs: [],
    detailFields: []
  },
  SKILL_HIT: {
    eventType: 'SKILL_HIT',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.SKILL_HIT,
    currentTargetBinding: '本次技能命中的对象。',
    hasEventSource: false,
    requiredCatalogs: ['skills'],
    detailFields: ['sourceSkillKey']
  },
  PROCESS_MOMENT: {
    eventType: 'PROCESS_MOMENT',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.PROCESS_MOMENT,
    currentTargetBinding: '目标过程实例的目标；没有时为来源对象。',
    hasEventSource: false,
    requiredCatalogs: ['processes', 'steps'],
    detailFields: ['processKey', 'moment']
  },
  RESULT_AVAILABLE: {
    eventType: 'RESULT_AVAILABLE',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.RESULT_AVAILABLE,
    currentTargetBinding: '目标效果执行上下文的目标；没有时为来源对象。',
    hasEventSource: false,
    requiredCatalogs: ['effects', 'results'],
    detailFields: ['effectKey', 'resultKey']
  },
  LIFECYCLE_MOMENT: {
    eventType: 'LIFECYCLE_MOMENT',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.LIFECYCLE_MOMENT,
    currentTargetBinding: '目标生命周期实例的承受对象。',
    hasEventSource: false,
    requiredCatalogs: ['effects'],
    detailFields: ['effectKey', 'moment']
  },
  DAMAGE_PENDING: {
    eventType: 'DAMAGE_PENDING',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.DAMAGE_PENDING,
    currentTargetBinding: '技能拥有者自身。',
    hasEventSource: true,
    requiredCatalogs: ['damageTypes'],
    detailFields: ['damageTypeKey', 'deliveryKind', 'originKind']
  },
  DAMAGE_DEALT: {
    eventType: 'DAMAGE_DEALT',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.DAMAGE_DEALT,
    currentTargetBinding: '本次伤害承受对象。',
    hasEventSource: false,
    requiredCatalogs: ['damageTypes'],
    detailFields: ['damageTypeKey', 'deliveryKind', 'originKind']
  },
  DAMAGE_TAKEN: {
    eventType: 'DAMAGE_TAKEN',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.DAMAGE_TAKEN,
    currentTargetBinding: '来源对象自身。',
    hasEventSource: true,
    requiredCatalogs: ['damageTypes'],
    detailFields: ['damageTypeKey', 'deliveryKind', 'originKind']
  },
  STATUS_CHANGED: {
    eventType: 'STATUS_CHANGED',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.STATUS_CHANGED,
    currentTargetBinding: 'subject 指定的状态变化对象。',
    hasEventSource: true,
    requiredCatalogs: ['statuses'],
    detailFields: ['subject', 'statusKey', 'change']
  },
  HEALTH_THRESHOLD_CROSSED: {
    eventType: 'HEALTH_THRESHOLD_CROSSED',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.HEALTH_THRESHOLD_CROSSED,
    currentTargetBinding: 'subject 指定的生命属性变化对象。',
    hasEventSource: false,
    requiredCatalogs: ['attributes', 'formulas'],
    detailFields: ['subject', 'attributeKey', 'thresholdValue', 'direction']
  },
  INTERNAL_STATE_CHANGED: {
    eventType: 'INTERNAL_STATE_CHANGED',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.INTERNAL_STATE_CHANGED,
    currentTargetBinding: 'TARGET 范围状态的实例目标；技能范围状态为来源对象。',
    hasEventSource: false,
    requiredCatalogs: ['internalStates'],
    detailFields: ['stateKey', 'changeKind']
  },
  CONTROL_RECEIVED: {
    eventType: 'CONTROL_RECEIVED',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.CONTROL_RECEIVED,
    currentTargetBinding: '来源对象自身。',
    hasEventSource: true,
    requiredCatalogs: [],
    detailFields: []
  },
  ENTITY_DIED: {
    eventType: 'ENTITY_DIED',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.ENTITY_DIED,
    currentTargetBinding: 'subject 指定的死亡对象。',
    hasEventSource: false,
    requiredCatalogs: [],
    detailFields: ['subject']
  },
  ENTITY_UNTARGETABLE: {
    eventType: 'ENTITY_UNTARGETABLE',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.ENTITY_UNTARGETABLE,
    currentTargetBinding: 'subject 指定的不可选取对象。',
    hasEventSource: false,
    requiredCatalogs: [],
    detailFields: ['subject']
  },
  KILL: {
    eventType: 'KILL',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.KILL,
    currentTargetBinding: '本次被击杀对象。',
    hasEventSource: false,
    requiredCatalogs: [],
    detailFields: []
  },
  PROCESS_CANCEL_REQUESTED: {
    eventType: 'PROCESS_CANCEL_REQUESTED',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.PROCESS_CANCEL_REQUESTED,
    currentTargetBinding: '目标过程实例的目标；没有时为来源对象。',
    hasEventSource: false,
    requiredCatalogs: ['processes'],
    detailFields: ['processKey']
  },
  SPELL_SHIELD_BLOCKED: {
    eventType: 'SPELL_SHIELD_BLOCKED',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.SPELL_SHIELD_BLOCKED,
    currentTargetBinding: '法术护盾承受对象（技能拥有者自身）。',
    hasEventSource: true,
    requiredCatalogs: ['effects'],
    detailFields: ['shieldEffectKey']
  },
  HIT_LINK_APPLIED: {
    eventType: 'HIT_LINK_APPLIED',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.HIT_LINK_APPLIED,
    currentTargetBinding: '本次联动目标。',
    hasEventSource: false,
    requiredCatalogs: ['skills'],
    detailFields: ['sourceSkillKey']
  },
  ATTACK_LINK_APPLIED: {
    eventType: 'ATTACK_LINK_APPLIED',
    label: SKILL_TRIGGER_EVENT_TYPE_LABELS.ATTACK_LINK_APPLIED,
    currentTargetBinding: '本次联动目标。',
    hasEventSource: false,
    requiredCatalogs: ['skills'],
    detailFields: ['sourceSkillKey']
  }
};

export const SKILL_TRIGGER_EVENT_VALUE_LABELS = {
  STEP_EXECUTION_INDEX: '当前步骤第几次执行',
  CHARGE_DURATION_MS: '实际蓄力毫秒数',
  RECAST_COUNT: '当前过程已重施次数',
  HIT_INDEX: '当前命中序号',
  LIFECYCLE_STACKS: '当前生命周期层数',
  PERIOD_INDEX: '当前周期序号',
  REMAINING_MS: '当前生命周期剩余毫秒数',
  STATE_BEFORE: '数值内部状态变化前值',
  STATE_AFTER: '数值内部状态变化后值',
  ATTRIBUTE_BEFORE: '生命属性越阈值前值',
  ATTRIBUTE_AFTER: '生命属性越阈值后值',
  THRESHOLD_VALUE: '本次阈值取值值',
  RAW_DAMAGE: '原始伤害',
  POST_DEFENSE_DAMAGE: '防御后伤害',
  HEALTH_BEFORE: '受伤前生命',
  PROJECTED_HEALTH_AFTER: '预计受伤后生命',
  SHIELD_ABSORBED: '护盾吸收',
  ACTUAL_HP_LOSS: '实际扣血',
  BLOCKED: '是否被法术护盾阻挡（0/1）',
  IMMUNE: '是否被伤害免疫（0/1）',
  KILLED: '是否形成击杀（0/1）',
  LINK_INDEX: '本次序号（从 1 开始）',
  LINK_COUNT: '总次数（从 1 开始）'
} as const satisfies { [K in SkillTriggerEventValueKey]: string };

export const SKILL_TRIGGER_EVENT_VALUE_DOMAINS = {
  STEP_EXECUTION_INDEX: 'INTEGER',
  CHARGE_DURATION_MS: 'DECIMAL',
  RECAST_COUNT: 'INTEGER',
  HIT_INDEX: 'INTEGER',
  LIFECYCLE_STACKS: 'INTEGER',
  PERIOD_INDEX: 'INTEGER',
  REMAINING_MS: 'DECIMAL',
  STATE_BEFORE: 'INTEGER',
  STATE_AFTER: 'INTEGER',
  ATTRIBUTE_BEFORE: 'DECIMAL',
  ATTRIBUTE_AFTER: 'DECIMAL',
  THRESHOLD_VALUE: 'DECIMAL',
  RAW_DAMAGE: 'DECIMAL',
  POST_DEFENSE_DAMAGE: 'DECIMAL',
  HEALTH_BEFORE: 'DECIMAL',
  PROJECTED_HEALTH_AFTER: 'DECIMAL',
  SHIELD_ABSORBED: 'DECIMAL',
  ACTUAL_HP_LOSS: 'DECIMAL',
  BLOCKED: 'INTEGER',
  IMMUNE: 'INTEGER',
  KILLED: 'INTEGER',
  LINK_INDEX: 'INTEGER',
  LINK_COUNT: 'INTEGER'
} as const satisfies { [K in SkillTriggerEventValueKey]: SkillTriggerValueDomain };

export const SKILL_TRIGGER_CONDITION_TYPE_LABELS = {
  ATTRIBUTE_COMPARE: '属性比较',
  STATUS_CHECK: '战斗状态检查',
  LIFECYCLE_CHECK: '生命周期检查',
  TARGET_CATEGORY_CHECK: '命中目标类别',
  INTERNAL_STATE_CHECK: '技能内部状态检查',
  EVENT_VALUE_COMPARE: '事件值比较'
} as const satisfies { [K in SkillTriggerConditionType]: string };

export const SKILL_TRIGGER_ACTION_TYPE_LABELS = {
  EXECUTE_EFFECT: '执行效果',
  START_PROCESS: '启动过程',
  FAIL_PROCESS: '令过程失败'
} as const satisfies { [K in SkillTriggerActionType]: string };

export const SKILL_TRIGGER_SOURCE_TYPE_LABELS = {
  INTERNAL_STATE: '技能内部状态',
  COMBAT_STATUS: '战斗状态',
  EVENT_VALUE: '当前事件值',
  SOURCE_CAST_RESOURCE_COST: '来源施放资源消耗',
  PRIOR_ACTION_RESULT: '更早动作结果'
} as const satisfies { [K in SkillTriggerRuntimeInputSourceType]: string };

export const SKILL_TRIGGER_SUBJECT_LABELS = {
  SOURCE: '来源对象',
  CURRENT_TARGET: '当前目标',
  EVENT_SOURCE: '事件来源对象'
} as const satisfies { [K in SkillTriggerSubject]: string };

export const SKILL_TRIGGER_TARGET_CONTEXT_LABELS = {
  CURRENT_TARGET: '当前目标',
  EVENT_SOURCE: '事件来源对象'
} as const satisfies { [K in SkillTriggerTargetContext]: string };

export const SKILL_TRIGGER_USE_KIND_LABELS = {
  ACTIVE: '主动',
  CONSUMABLE: '消耗',
  ANY: '任意'
} as const satisfies { [K in SkillTriggerEventUseKind]: string };

export const SKILL_TRIGGER_LIFECYCLE_EVENT_MOMENT_LABELS = {
  APPLICATION: '施加',
  FULL_STACKS: '满层',
  PERIODIC: '周期',
  NATURAL_END: '自然结束',
  EARLY_REMOVE: '提前移除'
} as const satisfies { [K in SkillTriggerLifecycleEventMoment]: string };

export const SKILL_TRIGGER_STATUS_CHANGE_LABELS = {
  APPLY: '施加',
  REMOVE: '移除'
} as const satisfies { [K in SkillTriggerStatusChangeKind]: string };

export const SKILL_TRIGGER_HEALTH_DIRECTION_LABELS = {
  UPWARD: '向上',
  DOWNWARD: '向下'
} as const satisfies { [K in SkillTriggerHealthDirection]: string };

export const SKILL_TRIGGER_INTERNAL_STATE_CHANGE_LABELS = {
  VALUE_CHANGED: '数值变化',
  OPTION_SELECTED: '模式选项变化',
  FLAG_CHANGED: '准备标记变化',
  COOLDOWN_READY: '内部冷却就绪'
} as const satisfies { [K in SkillTriggerInternalStateChangeKind]: string };

export const SKILL_TRIGGER_COMPARATOR_LABELS = {
  LT: '小于',
  LTE: '小于等于',
  EQ: '等于',
  NE: '不等于',
  GTE: '大于等于',
  GT: '大于'
} as const satisfies { [K in SkillTriggerComparator]: string };

export const SKILL_TRIGGER_STATUS_CHECK_LABELS = {
  PRESENT: '存在',
  ABSENT: '不存在',
  STACKS_COMPARE: '层数比较',
  REMAINING_MS_COMPARE: '剩余时间比较'
} as const satisfies { [K in SkillTriggerStatusCheckKind]: string };

export const SKILL_TRIGGER_INTERNAL_STATE_VALUE_LABELS = {
  VALUE: '数值',
  OPTION_SELECTED: '模式是否选中',
  ENABLED: '准备标记是否启用',
  REMAINING_MS: '剩余毫秒'
} as const satisfies { [K in SkillTriggerInternalStateValueKind]: string };

export const SKILL_TRIGGER_COMBAT_STATUS_VALUE_LABELS = {
  PRESENT: '存在',
  STACKS: '层数',
  REMAINING_MS: '剩余时间'
} as const satisfies { [K in SkillTriggerCombatStatusValueKind]: string };

export const SKILL_TRIGGER_FAILURE_REASON_LABELS = {
  CONTROLLED: '受到控制',
  SOURCE_DIED: '来源对象死亡',
  TARGET_UNTARGETABLE: '当前目标不可选取',
  ACTIVE_CANCELLED: '主动取消',
  EVENT_ABORTED: '当前事件终止'
} as const satisfies { [K in SkillTriggerProcessFailureReason]: string };

export const SKILL_TRIGGER_VALUE_TYPE_LABELS = {
  INTEGER: '整数',
  DECIMAL: '小数'
} as const satisfies { [K in SkillParameterValueType]: string };

type ConditionDraftBase = {
  conditionKey: string;
  sortOrder: string;
};

export type SkillTriggerAttributeCompareConditionDraft = ConditionDraftBase & {
  conditionType: 'ATTRIBUTE_COMPARE';
  detail: SkillTriggerAttributeCompareDetail;
};

export type SkillTriggerStatusCheckConditionDraft = ConditionDraftBase & {
  conditionType: 'STATUS_CHECK';
  detail: SkillTriggerStatusCheckDetail;
};

export type SkillTriggerLifecycleCheckConditionDraft = ConditionDraftBase & {
  conditionType: 'LIFECYCLE_CHECK';
  detail: SkillTriggerLifecycleCheckDetail;
};

export type SkillTriggerTargetCategoryCheckConditionDraft = ConditionDraftBase & {
  conditionType: 'TARGET_CATEGORY_CHECK';
  detail: SkillTriggerTargetCategoryCheckDetail;
};

export type SkillTriggerInternalStateCheckConditionDraft = ConditionDraftBase & {
  conditionType: 'INTERNAL_STATE_CHECK';
  detail: SkillTriggerInternalStateCheckDetail;
};

export type SkillTriggerEventValueCompareConditionDraft = ConditionDraftBase & {
  conditionType: 'EVENT_VALUE_COMPARE';
  detail: SkillTriggerEventValueCompareDetail;
};

export type SkillTriggerConditionDraft =
  | SkillTriggerAttributeCompareConditionDraft
  | SkillTriggerStatusCheckConditionDraft
  | SkillTriggerLifecycleCheckConditionDraft
  | SkillTriggerTargetCategoryCheckConditionDraft
  | SkillTriggerInternalStateCheckConditionDraft
  | SkillTriggerEventValueCompareConditionDraft;

export type SkillTriggerConditionGroupDraft = {
  draftId: string;
  groupKey: string;
  name: string;
  sortOrder: string;
  conditions: SkillTriggerConditionDraft[];
};

type ActionDraftBase = {
  actionKey: string;
  name: string;
  sortOrder: string;
  runtimeInputBindings: SkillTriggerRuntimeInputBinding[];
  resultModifiers: SkillTriggerResultModifier[];
};

export type SkillTriggerExecuteEffectActionDraft = ActionDraftBase & {
  actionType: 'EXECUTE_EFFECT';
  targetContext: SkillTriggerTargetContext;
  detail: { effectKey: string };
};

export type SkillTriggerStartProcessActionDraft = ActionDraftBase & {
  actionType: 'START_PROCESS';
  targetContext: SkillTriggerTargetContext;
  detail: { processKey: string };
};

export type SkillTriggerFailProcessActionDraft = ActionDraftBase & {
  actionType: 'FAIL_PROCESS';
  targetContext: null;
  detail: {
    processKey: string;
    failureReason: SkillTriggerProcessFailureReason;
  };
};

export type SkillTriggerActionDraft =
  | SkillTriggerExecuteEffectActionDraft
  | SkillTriggerStartProcessActionDraft
  | SkillTriggerFailProcessActionDraft;

export type SkillTriggerRuleDraft = {
  ruleKey: string;
  name: string;
  description: string;
  sortOrder: string;
  eventSource: SkillTriggerEventSource;
  conditionGroups: SkillTriggerConditionGroupDraft[];
  actions: SkillTriggerActionDraft[];
  perTargetCooldownEnabled: boolean;
  perTargetCooldownDurationValue: NumericValue | null;
  perTargetCooldownTargetContext: SkillTriggerTargetContext;
  maxTriggersPerProcessEnabled: boolean;
  maxTriggersLimitValue: NumericValue | null;
};

export type SkillTriggerDraftField =
  | 'ruleKey'
  | 'name'
  | 'description'
  | 'sortOrder'
  | 'eventSource'
  | 'conditionGroups'
  | 'actions'
  | 'perTargetCooldown'
  | 'maxTriggersPerProcess';

export type SkillTriggerDraftErrors = Partial<Record<SkillTriggerDraftField, string>>;

export type NestedFieldError = {
  path: string;
  message: string;
};

export type TriggerCyclePathItem = {
  ruleKey: string;
  actionKey?: string;
  producedEvent?: Record<string, unknown>;
};

export type MappedTriggerFieldIssues = {
  fieldErrors: SkillTriggerDraftErrors;
  nestedErrors: NestedFieldError[];
  unmappedMessages: string[];
  retainedCode: string | null;
  retainedMessage: string | null;
  retainedDetails: Record<string, unknown> | null;
  cycle: {
    message: string;
    hint: string;
    pathItems: TriggerCyclePathItem[];
  } | null;
};

export type SkillTriggerFormValidation =
  | { ok: true; normalized: CreateSkillTriggerRuleRequest }
  | { ok: false; fieldErrors: SkillTriggerDraftErrors; nestedErrors: NestedFieldError[] };

export type EventSwitchImpact = {
  summary: string;
  clearsEventValues: boolean;
  clearsEventSourceRefs: boolean;
  clearsProcessLimit: boolean;
};

export type SourceActionCleanupImpact = {
  actionKey: string;
  bindingKeys: string[];
  summaries: string[];
};

export type BindingCompleteness = {
  parameterKey: string;
  name: string;
  valueType: SkillParameterValueType;
  missing: boolean;
  duplicate: boolean;
  extra: boolean;
  typeCompatible: boolean | null;
  summary: string;
};

export type ImmediatePriorResult = {
  sourceActionKey: string;
  sourceActionName: string;
  sourceEffectKey: string;
  sourceResultKey: string;
  sourceResultName: string;
};

export type PriorSourceActionOption = {
  sourceActionKey: string;
  sourceActionName: string;
  sourceEffectKey: string;
};

export type FormulaSessionCache = {
  get(gameId: string, skillKey: string, formulaKey: string): SkillFormula | undefined;
  set(gameId: string, skillKey: string, formulaKey: string, formula: SkillFormula): void;
  has(gameId: string, skillKey: string, formulaKey: string): boolean;
  keys(): string[];
};

export function skillTriggerManagementTitle(skillName: string): string {
  return `${SKILL_TRIGGER_ENTRY_LABEL} - ${skillName}`;
}

export function createFormulaSessionCache(): FormulaSessionCache {
  const store = new Map<string, SkillFormula>();
  const keyOf = (gameId: string, skillKey: string, formulaKey: string) => (
    `${gameId}/${skillKey}/${formulaKey}`
  );
  return {
    get(gameId, skillKey, formulaKey) {
      return store.get(keyOf(gameId, skillKey, formulaKey));
    },
    set(gameId, skillKey, formulaKey, formula) {
      store.set(keyOf(gameId, skillKey, formulaKey), formula);
    },
    has(gameId, skillKey, formulaKey) {
      return store.has(keyOf(gameId, skillKey, formulaKey));
    },
    keys() {
      return [...store.keys()];
    }
  };
}

export function emptyEventDetail(): Record<never, never> {
  return {};
}

export function createEmptyEventSource(eventType: SkillTriggerEventType): SkillTriggerEventSource {
  switch (eventType) {
    case 'SKILL_USED':
      return { eventType, detail: { sourceSkillKey: null, useKind: 'ANY' } };
    case 'SKILL_HIT':
      return { eventType, detail: { sourceSkillKey: null } };
    case 'HIT_LINK_APPLIED':
      return { eventType, detail: { sourceSkillKey: null } };
    case 'ATTACK_LINK_APPLIED':
      return { eventType, detail: { sourceSkillKey: null } };
    case 'PROCESS_MOMENT':
      return {
        eventType,
        detail: { processKey: '', moment: { momentType: 'PROCESS_START', stepKey: null } }
      };
    case 'RESULT_AVAILABLE':
      return { eventType, detail: { effectKey: '', resultKey: '' } };
    case 'LIFECYCLE_MOMENT':
      return { eventType, detail: { effectKey: '', moment: 'APPLICATION' } };
    case 'STATUS_CHANGED':
      return { eventType, detail: { subject: 'CURRENT_TARGET', statusKey: '', change: 'APPLY' } };
    case 'HEALTH_THRESHOLD_CROSSED':
      return {
        eventType,
        detail: {
          subject: 'SOURCE',
          attributeKey: '',
          thresholdValue: fixedValue(Number.NaN),
          direction: 'DOWNWARD'
        }
      };
    case 'INTERNAL_STATE_CHANGED':
      return { eventType, detail: { stateKey: '', changeKind: 'VALUE_CHANGED' } };
    case 'ENTITY_DIED':
      return { eventType, detail: { subject: 'CURRENT_TARGET' } };
    case 'ENTITY_UNTARGETABLE':
      return { eventType, detail: { subject: 'CURRENT_TARGET' } };
    case 'PROCESS_CANCEL_REQUESTED':
      return { eventType, detail: { processKey: '' } };
    case 'SPELL_SHIELD_BLOCKED':
      return { eventType, detail: { shieldEffectKey: '' } };
    case 'BASIC_ATTACK_START':
      return { eventType, detail: emptyEventDetail() };
    case 'BASIC_ATTACK_HIT':
      return { eventType, detail: emptyEventDetail() };
    case 'DAMAGE_PENDING':
    case 'DAMAGE_DEALT':
    case 'DAMAGE_TAKEN':
      return {
        eventType,
        detail: { damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY' }
      };
    case 'CONTROL_RECEIVED':
      return { eventType, detail: emptyEventDetail() };
    case 'KILL':
      return { eventType, detail: emptyEventDetail() };
  }
}

export function createEmptyConditionDetail(
  conditionType: 'LIFECYCLE_CHECK'
): SkillTriggerLifecycleCheckDetail;
export function createEmptyConditionDetail(
  conditionType: 'TARGET_CATEGORY_CHECK'
): SkillTriggerTargetCategoryCheckDetail;
export function createEmptyConditionDetail(
  conditionType: 'ATTRIBUTE_COMPARE'
): SkillTriggerAttributeCompareDetail;
export function createEmptyConditionDetail(
  conditionType: 'STATUS_CHECK'
): SkillTriggerStatusPresenceDetail;
export function createEmptyConditionDetail(
  conditionType: 'INTERNAL_STATE_CHECK'
): SkillTriggerInternalStateValueDetail;
export function createEmptyConditionDetail(
  conditionType: 'EVENT_VALUE_COMPARE'
): SkillTriggerEventValueCompareDetail;
export function createEmptyConditionDetail(
  conditionType: SkillTriggerConditionType
): SkillTriggerCondition['detail'];
export function createEmptyConditionDetail(
  conditionType: SkillTriggerConditionType
): SkillTriggerCondition['detail'] {
  switch (conditionType) {
    case 'TARGET_CATEGORY_CHECK':
      return { categories: [] };
    case 'LIFECYCLE_CHECK':
      return { effectKey: '', subject: null, checkKind: 'PRESENT', comparator: null, comparisonValue: null };
    case 'ATTRIBUTE_COMPARE':
      return {
        subject: 'CURRENT_TARGET',
        attributeKey: '',
        attributeValueKind: 'CURRENT',
        comparator: 'LTE',
        comparisonValue: fixedValue(Number.NaN)
      };
    case 'STATUS_CHECK':
      return {
        subject: 'CURRENT_TARGET',
        statusKey: '',
        checkKind: 'PRESENT',
        sourceEffectKey: null,
        sourceResultKey: null,
        comparator: null,
        comparisonValue: null
      };
    case 'INTERNAL_STATE_CHECK':
      return {
        stateKey: '',
        valueKind: 'VALUE',
        optionKey: null,
        expectedBoolean: null,
        comparator: 'GTE',
        comparisonValue: fixedValue(Number.NaN)
      };
    case 'EVENT_VALUE_COMPARE':
      return {
        eventValueKey: 'HIT_INDEX',
        comparator: 'EQ',
        comparisonValue: fixedValue(Number.NaN)
      };
  }
}

export function createEmptyBindingDetail(
  sourceType: 'INTERNAL_STATE'
): SkillTriggerInternalStateBindingDetail;
export function createEmptyBindingDetail(
  sourceType: 'COMBAT_STATUS'
): SkillTriggerCombatStatusPresentBindingDetail;
export function createEmptyBindingDetail(
  sourceType: 'EVENT_VALUE'
): SkillTriggerEventValueBindingDetail;
export function createEmptyBindingDetail(
  sourceType: 'SOURCE_CAST_RESOURCE_COST'
): SkillTriggerSourceCastResourceCostBinding['detail'];
export function createEmptyBindingDetail(
  sourceType: 'PRIOR_ACTION_RESULT'
): SkillTriggerPriorResultBindingDetail;
export function createEmptyBindingDetail(
  sourceType: SkillTriggerRuntimeInputSourceType
): SkillTriggerRuntimeInputBinding['detail'];
export function createEmptyBindingDetail(
  sourceType: SkillTriggerRuntimeInputSourceType
): SkillTriggerRuntimeInputBinding['detail'] {
  switch (sourceType) {
    case 'INTERNAL_STATE':
      return { stateKey: '', valueKind: 'VALUE', optionKey: null };
    case 'COMBAT_STATUS':
      return {
        subject: 'CURRENT_TARGET',
        statusKey: '',
        valueKind: 'PRESENT',
        sourceEffectKey: null,
        sourceResultKey: null
      };
    case 'EVENT_VALUE':
      return { eventValueKey: 'HIT_INDEX' };
    case 'SOURCE_CAST_RESOURCE_COST':
      return { attributeKey: '' };
    case 'PRIOR_ACTION_RESULT':
      return {
        sourceActionKey: '',
        sourceResultKey: '',
        outputKind: 'CONFIGURED_VALUE'
      };
  }
}

export function createEmptyActionDetail(
  actionType: 'EXECUTE_EFFECT'
): { effectKey: string };
export function createEmptyActionDetail(
  actionType: 'START_PROCESS'
): { processKey: string };
export function createEmptyActionDetail(
  actionType: 'FAIL_PROCESS'
): { processKey: string; failureReason: SkillTriggerProcessFailureReason };
export function createEmptyActionDetail(
  actionType: SkillTriggerActionType
): SkillTriggerAction['detail'];
export function createEmptyActionDetail(
  actionType: SkillTriggerActionType
): SkillTriggerAction['detail'] {
  if (actionType === 'EXECUTE_EFFECT') return { effectKey: '' };
  if (actionType === 'START_PROCESS') return { processKey: '' };
  return { processKey: '', failureReason: 'CONTROLLED' };
}

export function nextDraftKey(existing: readonly string[], prefix: string): string {
  let index = 1;
  let candidate = `${prefix}_${index}`;
  const used = new Set(existing);
  while (used.has(candidate)) {
    index += 1;
    candidate = `${prefix}_${index}`;
  }
  return candidate;
}

export function createEmptyConditionDraft(
  existingKeys: readonly string[],
  conditionType: 'TARGET_CATEGORY_CHECK'
): SkillTriggerTargetCategoryCheckConditionDraft;
export function createEmptyConditionDraft(
  existingKeys: readonly string[],
  conditionType: 'LIFECYCLE_CHECK'
): SkillTriggerLifecycleCheckConditionDraft;
export function createEmptyConditionDraft(
  existingKeys: readonly string[],
  conditionType: 'ATTRIBUTE_COMPARE'
): SkillTriggerAttributeCompareConditionDraft;
export function createEmptyConditionDraft(
  existingKeys: readonly string[],
  conditionType: 'STATUS_CHECK'
): SkillTriggerStatusCheckConditionDraft;
export function createEmptyConditionDraft(
  existingKeys: readonly string[],
  conditionType: 'INTERNAL_STATE_CHECK'
): SkillTriggerInternalStateCheckConditionDraft;
export function createEmptyConditionDraft(
  existingKeys: readonly string[],
  conditionType: 'EVENT_VALUE_COMPARE'
): SkillTriggerEventValueCompareConditionDraft;
export function createEmptyConditionDraft(
  existingKeys: readonly string[],
  conditionType?: SkillTriggerConditionType
): SkillTriggerConditionDraft;
export function createEmptyConditionDraft(
  existingKeys: readonly string[],
  conditionType: SkillTriggerConditionType = 'ATTRIBUTE_COMPARE'
): SkillTriggerConditionDraft {
  const base = {
    conditionKey: nextDraftKey(existingKeys, 'cond'),
    sortOrder: '10'
  };
  switch (conditionType) {
    case 'TARGET_CATEGORY_CHECK':
      return { ...base, conditionType, detail: createEmptyConditionDetail('TARGET_CATEGORY_CHECK') };
    case 'LIFECYCLE_CHECK':
      return { ...base, conditionType, detail: createEmptyConditionDetail('LIFECYCLE_CHECK') };
    case 'ATTRIBUTE_COMPARE':
      return { ...base, conditionType, detail: createEmptyConditionDetail('ATTRIBUTE_COMPARE') };
    case 'STATUS_CHECK':
      return { ...base, conditionType, detail: createEmptyConditionDetail('STATUS_CHECK') };
    case 'INTERNAL_STATE_CHECK':
      return { ...base, conditionType, detail: createEmptyConditionDetail('INTERNAL_STATE_CHECK') };
    case 'EVENT_VALUE_COMPARE':
      return { ...base, conditionType, detail: createEmptyConditionDetail('EVENT_VALUE_COMPARE') };
  }
}

export function createEmptyGroupDraft(existingKeys: readonly string[]): SkillTriggerConditionGroupDraft {
  return {
    draftId: crypto.randomUUID(),
    groupKey: nextDraftKey(existingKeys, 'group'),
    name: '',
    sortOrder: '10',
    conditions: [createEmptyConditionDraft([])]
  };
}

export function createEmptyActionDraft(
  existingKeys: readonly string[],
  actionType: 'EXECUTE_EFFECT'
): SkillTriggerExecuteEffectActionDraft;
export function createEmptyActionDraft(
  existingKeys: readonly string[],
  actionType: 'START_PROCESS'
): SkillTriggerStartProcessActionDraft;
export function createEmptyActionDraft(
  existingKeys: readonly string[],
  actionType: 'FAIL_PROCESS'
): SkillTriggerFailProcessActionDraft;
export function createEmptyActionDraft(
  existingKeys: readonly string[],
  actionType?: SkillTriggerActionType
): SkillTriggerActionDraft;
export function createEmptyActionDraft(
  existingKeys: readonly string[],
  actionType: SkillTriggerActionType = 'EXECUTE_EFFECT'
): SkillTriggerActionDraft {
  const base = {
    actionKey: nextDraftKey(existingKeys, 'action'),
    name: '',
    sortOrder: '10',
    runtimeInputBindings: [] as SkillTriggerRuntimeInputBinding[],
    resultModifiers: [] as SkillTriggerResultModifier[]
  };
  if (actionType === 'FAIL_PROCESS') {
    return {
      ...base,
      actionType,
      targetContext: null,
      detail: createEmptyActionDetail('FAIL_PROCESS')
    };
  }
  if (actionType === 'START_PROCESS') {
    return {
      ...base,
      actionType,
      targetContext: 'CURRENT_TARGET',
      detail: createEmptyActionDetail('START_PROCESS')
    };
  }
  return {
    ...base,
    actionType: 'EXECUTE_EFFECT',
    targetContext: 'CURRENT_TARGET',
    detail: createEmptyActionDetail('EXECUTE_EFFECT')
  };
}

export function createEmptyBinding(
  existingKeys: readonly string[],
  sourceType: 'INTERNAL_STATE'
): SkillTriggerInternalStateBinding;
export function createEmptyBinding(
  existingKeys: readonly string[],
  sourceType: 'COMBAT_STATUS'
): SkillTriggerCombatStatusBinding;
export function createEmptyBinding(
  existingKeys: readonly string[],
  sourceType: 'EVENT_VALUE'
): SkillTriggerEventValueBinding;
export function createEmptyBinding(
  existingKeys: readonly string[],
  sourceType: 'SOURCE_CAST_RESOURCE_COST'
): SkillTriggerSourceCastResourceCostBinding;
export function createEmptyBinding(
  existingKeys: readonly string[],
  sourceType: 'PRIOR_ACTION_RESULT'
): SkillTriggerPriorResultBinding;
export function createEmptyBinding(
  existingKeys: readonly string[],
  sourceType?: SkillTriggerRuntimeInputSourceType
): SkillTriggerRuntimeInputBinding;
export function createEmptyBinding(
  existingKeys: readonly string[],
  sourceType: SkillTriggerRuntimeInputSourceType = 'INTERNAL_STATE'
): SkillTriggerRuntimeInputBinding {
  const base = {
    bindingKey: nextDraftKey(existingKeys, 'bind'),
    parameterKey: ''
  };
  switch (sourceType) {
    case 'INTERNAL_STATE':
      return { ...base, sourceType, detail: createEmptyBindingDetail('INTERNAL_STATE') };
    case 'COMBAT_STATUS':
      return { ...base, sourceType, detail: createEmptyBindingDetail('COMBAT_STATUS') };
    case 'EVENT_VALUE':
      return { ...base, sourceType, detail: createEmptyBindingDetail('EVENT_VALUE') };
    case 'SOURCE_CAST_RESOURCE_COST':
      return { ...base, sourceType, detail: createEmptyBindingDetail('SOURCE_CAST_RESOURCE_COST') };
    case 'PRIOR_ACTION_RESULT':
      return { ...base, sourceType, detail: createEmptyBindingDetail('PRIOR_ACTION_RESULT') };
  }
}

export function createEmptyRuleDraft(): SkillTriggerRuleDraft {
  return {
    ruleKey: '',
    name: '',
    description: '',
    sortOrder: '0',
    eventSource: createEmptyEventSource('SKILL_USED'),
    conditionGroups: [],
    actions: [createEmptyActionDraft([])],
    perTargetCooldownEnabled: false,
    perTargetCooldownDurationValue: null,
    perTargetCooldownTargetContext: 'CURRENT_TARGET',
    maxTriggersPerProcessEnabled: false,
    maxTriggersLimitValue: null
  };
}

export function eventHasEventSource(eventType: SkillTriggerEventType): boolean {
  return SKILL_TRIGGER_EVENT_CAPABILITIES[eventType].hasEventSource;
}

export function eventStepType(
  eventSource: SkillTriggerEventSource,
  process: SkillProcess | null | undefined
): SkillProcessStepType | null {
  if (eventSource.eventType !== 'PROCESS_MOMENT') return null;
  const stepKey = eventSource.detail.moment.stepKey;
  if (!stepKey || !process) return null;
  return process.steps.find((item) => item.stepKey === stepKey)?.stepType ?? null;
}

export const SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES: {
  readonly [K in SkillTriggerEventType]: readonly SkillTriggerEventValueKey[];
} = {
  SKILL_USED: [],
  BASIC_ATTACK_START: [],
  BASIC_ATTACK_HIT: ['HIT_INDEX'],
  SKILL_HIT: ['HIT_INDEX'],
  PROCESS_MOMENT: [],
  RESULT_AVAILABLE: [],
  LIFECYCLE_MOMENT: ['LIFECYCLE_STACKS', 'REMAINING_MS'],
  DAMAGE_PENDING: ['RAW_DAMAGE', 'POST_DEFENSE_DAMAGE', 'HEALTH_BEFORE', 'PROJECTED_HEALTH_AFTER'],
  DAMAGE_DEALT: [
    'RAW_DAMAGE',
    'POST_DEFENSE_DAMAGE',
    'SHIELD_ABSORBED',
    'ACTUAL_HP_LOSS',
    'BLOCKED',
    'IMMUNE',
    'KILLED'
  ],
  DAMAGE_TAKEN: [
    'RAW_DAMAGE',
    'POST_DEFENSE_DAMAGE',
    'SHIELD_ABSORBED',
    'ACTUAL_HP_LOSS',
    'BLOCKED',
    'IMMUNE',
    'KILLED'
  ],
  STATUS_CHANGED: [],
  HEALTH_THRESHOLD_CROSSED: ['ATTRIBUTE_BEFORE', 'ATTRIBUTE_AFTER', 'THRESHOLD_VALUE'],
  INTERNAL_STATE_CHANGED: ['STATE_BEFORE', 'STATE_AFTER'],
  CONTROL_RECEIVED: [],
  ENTITY_DIED: [],
  ENTITY_UNTARGETABLE: [],
  KILL: [],
  PROCESS_CANCEL_REQUESTED: [],
  SPELL_SHIELD_BLOCKED: [],
  HIT_LINK_APPLIED: ['LINK_INDEX', 'LINK_COUNT'],
  ATTACK_LINK_APPLIED: ['LINK_INDEX', 'LINK_COUNT']
};

export function allowedEventValuesFor(
  eventSource: SkillTriggerEventSource,
  stepType: SkillProcessStepType | null = null
): SkillTriggerEventValueKey[] {
  switch (eventSource.eventType) {
    case 'PROCESS_MOMENT': {
      const momentType = eventSource.detail.moment.momentType;
      const values: SkillTriggerEventValueKey[] = [];
      if (momentType === 'STEP_EXECUTION') values.push('STEP_EXECUTION_INDEX');
      const chargeMoments: SkillProcessMomentType[] = ['STEP_EXECUTION', 'STEP_COMPLETE', 'STEP_TIMEOUT'];
      if (stepType === 'CHARGE' && chargeMoments.includes(momentType)) {
        values.push('CHARGE_DURATION_MS');
      }
      if (stepType === 'RECAST' && chargeMoments.includes(momentType)) {
        values.push('RECAST_COUNT');
      }
      return values;
    }
    case 'LIFECYCLE_MOMENT': {
      const values: SkillTriggerEventValueKey[] = [
        ...SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES.LIFECYCLE_MOMENT
      ];
      if (eventSource.detail.moment === 'PERIODIC') values.push('PERIOD_INDEX');
      return values;
    }
    case 'INTERNAL_STATE_CHANGED':
      return eventSource.detail.changeKind === 'VALUE_CHANGED'
        ? [...SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES.INTERNAL_STATE_CHANGED]
        : [];
    default:
      return [...SKILL_TRIGGER_EVENT_VALUE_CAPABILITIES[eventSource.eventType]];
  }
}

export function eventValueDomain(key: SkillTriggerEventValueKey): SkillTriggerValueDomain {
  return SKILL_TRIGGER_EVENT_VALUE_DOMAINS[key];
}

export function eventValueOptionLabel(key: SkillTriggerEventValueKey): string {
  const label = SKILL_TRIGGER_EVENT_VALUE_LABELS[key];
  if (key === 'BLOCKED' || key === 'IMMUNE' || key === 'KILLED') {
    return `${label}（${SKILL_TRIGGER_BOOLEAN_EVENT_VALUE_HINT}）`;
  }
  return label;
}

export function priorResultOutputLabel(kind: SkillTriggerPriorResultOutputKind): string {
  return SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_LABELS[kind];
}

export function priorResultOutputDomain(
  kind: SkillTriggerPriorResultOutputKind
): SkillTriggerValueDomain {
  return SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_DOMAINS[kind];
}

export function isBooleanPriorResultOutput(kind: SkillTriggerPriorResultOutputKind): boolean {
  return (SKILL_TRIGGER_BOOLEAN_PRIOR_RESULT_OUTPUT_KINDS as readonly string[]).includes(kind);
}

export function isAllowedPriorResultOutputKind(kind: string): kind is SkillTriggerPriorResultOutputKind {
  return (SKILL_TRIGGER_PRIOR_RESULT_OUTPUT_KINDS as readonly string[]).includes(kind);
}

export function switchEventType(
  current: SkillTriggerEventSource,
  nextType: SkillTriggerEventType
): SkillTriggerEventSource {
  if (current.eventType === nextType) return current;
  return createEmptyEventSource(nextType);
}

export function switchConditionType(
  current: SkillTriggerConditionDraft,
  nextType: SkillTriggerConditionType
): SkillTriggerConditionDraft {
  if (current.conditionType === nextType) return current;
  const next = createEmptyConditionDraft([], nextType);
  return { ...next, conditionKey: current.conditionKey, sortOrder: current.sortOrder };
}

export function switchActionType(
  current: SkillTriggerActionDraft,
  nextType: SkillTriggerActionType
): SkillTriggerActionDraft {
  if (current.actionType === nextType) return current;
  const next = createEmptyActionDraft([current.actionKey], nextType);
  return { ...next, actionKey: current.actionKey, name: current.name, sortOrder: current.sortOrder };
}

export function switchBindingSourceType(
  current: SkillTriggerRuntimeInputBinding,
  nextType: SkillTriggerRuntimeInputSourceType
): SkillTriggerRuntimeInputBinding {
  if (current.sourceType === nextType) return current;
  const next = createEmptyBinding([current.bindingKey], nextType);
  return {
    ...next,
    bindingKey: current.bindingKey,
    parameterKey: current.parameterKey
  };
}

export function rebuildStatusCheckDetail(
  current: SkillTriggerStatusCheckDetail,
  checkKind: 'PRESENT' | 'ABSENT'
): SkillTriggerStatusPresenceDetail;
export function rebuildStatusCheckDetail(
  current: SkillTriggerStatusCheckDetail,
  checkKind: 'STACKS_COMPARE' | 'REMAINING_MS_COMPARE'
): SkillTriggerStatusCompareDetail;
export function rebuildStatusCheckDetail(
  current: SkillTriggerStatusCheckDetail,
  checkKind: SkillTriggerStatusCheckKind
): SkillTriggerStatusCheckDetail;
export function rebuildStatusCheckDetail(
  current: SkillTriggerStatusCheckDetail,
  checkKind: SkillTriggerStatusCheckKind
): SkillTriggerStatusCheckDetail {
  if (checkKind === 'PRESENT' || checkKind === 'ABSENT') {
    return {
      subject: current.subject,
      statusKey: current.statusKey,
      checkKind,
      sourceEffectKey: null,
      sourceResultKey: null,
      comparator: null,
      comparisonValue: null
    };
  }
  return {
    subject: current.subject,
    statusKey: current.statusKey,
    checkKind,
    sourceEffectKey: current.checkKind === 'STACKS_COMPARE' || current.checkKind === 'REMAINING_MS_COMPARE'
      ? current.sourceEffectKey
      : '',
    sourceResultKey: current.checkKind === 'STACKS_COMPARE' || current.checkKind === 'REMAINING_MS_COMPARE'
      ? current.sourceResultKey
      : '',
    comparator: current.checkKind === 'STACKS_COMPARE' || current.checkKind === 'REMAINING_MS_COMPARE'
      ? current.comparator
      : 'GTE',
    comparisonValue: current.checkKind === 'STACKS_COMPARE' || current.checkKind === 'REMAINING_MS_COMPARE'
      ? current.comparisonValue
      : fixedValue(Number.NaN)
  };
}

export function rebuildInternalStateCheckDetail(
  current: SkillTriggerInternalStateCheckDetail,
  valueKind: 'VALUE'
): SkillTriggerInternalStateValueDetail;
export function rebuildInternalStateCheckDetail(
  current: SkillTriggerInternalStateCheckDetail,
  valueKind: 'OPTION_SELECTED'
): SkillTriggerInternalStateOptionDetail;
export function rebuildInternalStateCheckDetail(
  current: SkillTriggerInternalStateCheckDetail,
  valueKind: 'ENABLED'
): SkillTriggerInternalStateEnabledDetail;
export function rebuildInternalStateCheckDetail(
  current: SkillTriggerInternalStateCheckDetail,
  valueKind: 'REMAINING_MS'
): SkillTriggerInternalStateRemainingDetail;
export function rebuildInternalStateCheckDetail(
  current: SkillTriggerInternalStateCheckDetail,
  valueKind: SkillTriggerInternalStateValueKind
): SkillTriggerInternalStateCheckDetail;
export function rebuildInternalStateCheckDetail(
  current: SkillTriggerInternalStateCheckDetail,
  valueKind: SkillTriggerInternalStateValueKind
): SkillTriggerInternalStateCheckDetail {
  if (valueKind === 'VALUE') {
    return {
      stateKey: current.stateKey,
      valueKind,
      optionKey: null,
      expectedBoolean: null,
      comparator: current.valueKind === 'VALUE' || current.valueKind === 'REMAINING_MS'
        ? current.comparator
        : 'GTE',
      comparisonValue: current.valueKind === 'VALUE' || current.valueKind === 'REMAINING_MS'
        ? current.comparisonValue
        : fixedValue(Number.NaN)
    };
  }
  if (valueKind === 'REMAINING_MS') {
    return {
      stateKey: current.stateKey,
      valueKind,
      optionKey: null,
      expectedBoolean: null,
      comparator: current.valueKind === 'VALUE' || current.valueKind === 'REMAINING_MS'
        ? current.comparator
        : 'GTE',
      comparisonValue: current.valueKind === 'VALUE' || current.valueKind === 'REMAINING_MS'
        ? current.comparisonValue
        : fixedValue(Number.NaN)
    };
  }
  if (valueKind === 'OPTION_SELECTED') {
    return {
      stateKey: current.stateKey,
      valueKind,
      optionKey: current.valueKind === 'OPTION_SELECTED' ? current.optionKey : '',
      expectedBoolean: null,
      comparator: null,
      comparisonValue: null
    };
  }
  return {
    stateKey: current.stateKey,
    valueKind: 'ENABLED',
    optionKey: null,
    expectedBoolean: current.valueKind === 'ENABLED' ? current.expectedBoolean : true,
    comparator: null,
    comparisonValue: null
  };
}

export function rebuildCombatStatusBindingDetail(
  current: SkillTriggerCombatStatusBindingDetail,
  valueKind: 'PRESENT'
): SkillTriggerCombatStatusPresentBindingDetail;
export function rebuildCombatStatusBindingDetail(
  current: SkillTriggerCombatStatusBindingDetail,
  valueKind: 'STACKS' | 'REMAINING_MS'
): SkillTriggerCombatStatusMeasuredBindingDetail;
export function rebuildCombatStatusBindingDetail(
  current: SkillTriggerCombatStatusBindingDetail,
  valueKind: SkillTriggerCombatStatusValueKind
): SkillTriggerCombatStatusBindingDetail;
export function rebuildCombatStatusBindingDetail(
  current: SkillTriggerCombatStatusBindingDetail,
  valueKind: SkillTriggerCombatStatusValueKind
): SkillTriggerCombatStatusBindingDetail {
  if (valueKind === 'PRESENT') {
    return {
      subject: current.subject,
      statusKey: current.statusKey,
      valueKind,
      sourceEffectKey: null,
      sourceResultKey: null
    };
  }
  return {
    subject: current.subject,
    statusKey: current.statusKey,
    valueKind,
    sourceEffectKey: current.valueKind === 'STACKS' || current.valueKind === 'REMAINING_MS'
      ? current.sourceEffectKey
      : '',
    sourceResultKey: current.valueKind === 'STACKS' || current.valueKind === 'REMAINING_MS'
      ? current.sourceResultKey
      : ''
  };
}

export function patchAttributeCompareDetail(
  current: SkillTriggerAttributeCompareConditionDraft,
  patch: Partial<SkillTriggerAttributeCompareDetail>
): SkillTriggerAttributeCompareConditionDraft {
  return { ...current, detail: { ...current.detail, ...patch } };
}

export function patchStatusCheckSubject(
  current: SkillTriggerStatusCheckConditionDraft,
  subject: SkillTriggerSubject
): SkillTriggerStatusCheckConditionDraft {
  return { ...current, detail: { ...current.detail, subject } };
}

export function patchStatusCheckStatusKey(
  current: SkillTriggerStatusCheckConditionDraft,
  statusKey: string
): SkillTriggerStatusCheckConditionDraft {
  return { ...current, detail: { ...current.detail, statusKey } };
}

export function patchStatusCheckKind(
  current: SkillTriggerStatusCheckConditionDraft,
  checkKind: SkillTriggerStatusCheckKind
): SkillTriggerStatusCheckConditionDraft {
  return { ...current, detail: rebuildStatusCheckDetail(current.detail, checkKind) };
}

export function patchStatusCompareFields(
  current: SkillTriggerStatusCheckConditionDraft,
  patch: Partial<Pick<
    SkillTriggerStatusCompareDetail,
    'sourceEffectKey' | 'sourceResultKey' | 'comparator' | 'comparisonValue'
  >>
): SkillTriggerStatusCheckConditionDraft {
  if (current.detail.checkKind !== 'STACKS_COMPARE' && current.detail.checkKind !== 'REMAINING_MS_COMPARE') {
    return current;
  }
  return { ...current, detail: { ...current.detail, ...patch } };
}

export function patchInternalStateCheckStateKey(
  current: SkillTriggerInternalStateCheckConditionDraft,
  stateKey: string,
  valueKind: SkillTriggerInternalStateValueKind
): SkillTriggerInternalStateCheckConditionDraft {
  return {
    ...current,
    detail: rebuildInternalStateCheckDetail({ ...current.detail, stateKey }, valueKind)
  };
}

export function patchInternalStateCheckValueKind(
  current: SkillTriggerInternalStateCheckConditionDraft,
  valueKind: SkillTriggerInternalStateValueKind
): SkillTriggerInternalStateCheckConditionDraft {
  return { ...current, detail: rebuildInternalStateCheckDetail(current.detail, valueKind) };
}

export function patchInternalStateOptionKey(
  current: SkillTriggerInternalStateCheckConditionDraft,
  optionKey: string
): SkillTriggerInternalStateCheckConditionDraft {
  if (current.detail.valueKind !== 'OPTION_SELECTED') return current;
  return { ...current, detail: { ...current.detail, optionKey } };
}

export function patchInternalStateExpectedBoolean(
  current: SkillTriggerInternalStateCheckConditionDraft,
  expectedBoolean: boolean
): SkillTriggerInternalStateCheckConditionDraft {
  if (current.detail.valueKind !== 'ENABLED') return current;
  return { ...current, detail: { ...current.detail, expectedBoolean } };
}

export function patchInternalStateCompareFields(
  current: SkillTriggerInternalStateCheckConditionDraft,
  patch: Partial<Pick<
    SkillTriggerInternalStateValueDetail,
    'comparator' | 'comparisonValue'
  >>
): SkillTriggerInternalStateCheckConditionDraft {
  if (current.detail.valueKind !== 'VALUE' && current.detail.valueKind !== 'REMAINING_MS') {
    return current;
  }
  return { ...current, detail: { ...current.detail, ...patch } };
}

export function patchEventValueCompareDetail(
  current: SkillTriggerEventValueCompareConditionDraft,
  patch: Partial<SkillTriggerEventValueCompareDetail>
): SkillTriggerEventValueCompareConditionDraft {
  return { ...current, detail: { ...current.detail, ...patch } };
}

export function patchCombatStatusBinding(
  current: SkillTriggerCombatStatusBinding,
  patch: Partial<Pick<SkillTriggerCombatStatusBindingDetail, 'subject' | 'statusKey'>>
): SkillTriggerCombatStatusBinding {
  return { ...current, detail: { ...current.detail, ...patch } };
}

export function patchCombatStatusValueKind(
  current: SkillTriggerCombatStatusBinding,
  valueKind: SkillTriggerCombatStatusValueKind
): SkillTriggerCombatStatusBinding {
  return { ...current, detail: rebuildCombatStatusBindingDetail(current.detail, valueKind) };
}

export function patchCombatStatusMeasuredFields(
  current: SkillTriggerCombatStatusBinding,
  patch: Partial<Pick<SkillTriggerCombatStatusMeasuredBindingDetail, 'sourceEffectKey' | 'sourceResultKey'>>
): SkillTriggerCombatStatusBinding {
  if (current.detail.valueKind === 'PRESENT') return current;
  return { ...current, detail: { ...current.detail, ...patch } };
}

export function patchInternalStateBindingDetail(
  current: SkillTriggerInternalStateBinding,
  patch: Partial<SkillTriggerInternalStateBindingDetail>
): SkillTriggerInternalStateBinding {
  return { ...current, detail: { ...current.detail, ...patch } };
}

export function patchPriorResultBinding(
  current: SkillTriggerPriorResultBinding,
  patch: Partial<SkillTriggerPriorResultBindingDetail>
): SkillTriggerPriorResultBinding {
  return { ...current, detail: { ...current.detail, ...patch } };
}

export function formatTriggerInboundDependency(item: {
  ruleKey: string;
  actionKey: string;
  bindingKey: string;
  outputKind: string;
}): string {
  const output = isAllowedPriorResultOutputKind(item.outputKind)
    ? priorResultOutputLabel(item.outputKind)
    : item.outputKind;
  return [item.ruleKey, item.actionKey, item.bindingKey, output].join(' / ');
}

function parseSortOrder(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0 || value > 999999) return null;
  return value;
}

function compareSortThenKey(leftSort: number, leftKey: string, rightSort: number, rightKey: string): number {
  if (leftSort !== rightSort) return leftSort - rightSort;
  return leftKey.localeCompare(rightKey);
}

export function sortConditionDrafts(
  items: readonly SkillTriggerConditionDraft[]
): SkillTriggerConditionDraft[] {
  return [...items].sort((left, right) => compareSortThenKey(
    parseSortOrder(left.sortOrder) ?? 0,
    left.conditionKey,
    parseSortOrder(right.sortOrder) ?? 0,
    right.conditionKey
  ));
}

export function sortGroupDrafts(
  items: readonly SkillTriggerConditionGroupDraft[]
): SkillTriggerConditionGroupDraft[] {
  return [...items].sort((left, right) => compareSortThenKey(
    parseSortOrder(left.sortOrder) ?? 0,
    left.groupKey,
    parseSortOrder(right.sortOrder) ?? 0,
    right.groupKey
  )).map((group) => ({ ...group, conditions: sortConditionDrafts(group.conditions) }));
}

export function sortActionDrafts(items: readonly SkillTriggerActionDraft[]): SkillTriggerActionDraft[] {
  return [...items].sort((left, right) => compareSortThenKey(
    parseSortOrder(left.sortOrder) ?? 0,
    left.actionKey,
    parseSortOrder(right.sortOrder) ?? 0,
    right.actionKey
  ));
}

export function failProcessIndex(actions: readonly SkillTriggerActionDraft[]): number {
  return actions.findIndex((item) => item.actionType === 'FAIL_PROCESS');
}

export function isFailProcessLast(actions: readonly SkillTriggerActionDraft[]): boolean {
  const sorted = sortActionDrafts(actions);
  const index = failProcessIndex(sorted);
  if (index < 0) return true;
  return index === sorted.length - 1 && sorted.filter((item) => item.actionType === 'FAIL_PROCESS').length === 1;
}

function swappedActionDrafts(
  sorted: readonly SkillTriggerActionDraft[],
  index: number,
  target: number
): SkillTriggerActionDraft[] {
  const reordered = [...sorted];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  const hasTiedOrder = sorted.some((item, position) => position > 0
    && parseSortOrder(item.sortOrder) === parseSortOrder(sorted[position - 1].sortOrder));
  if (hasTiedOrder) {
    // 并列排序仅交换数值不会改变执行顺序；按实际移动后的顺序重编号。
    return reordered.map((item, position) => ({ ...item, sortOrder: String((position + 1) * 10) }));
  }
  return reordered.map((item, position) => {
    if (position === index || position === target) return { ...item, sortOrder: sorted[position].sortOrder };
    return item;
  });
}

export function canMoveAction(
  actions: readonly SkillTriggerActionDraft[],
  index: number,
  direction: -1 | 1
): { ok: true } | { ok: false; message: string } {
  const sorted = sortActionDrafts(actions);
  const target = index + direction;
  if (index < 0 || index >= sorted.length || target < 0 || target >= sorted.length) {
    return { ok: false, message: '无法移动该动作。' };
  }
  const simulated = swappedActionDrafts(sorted, index, target);
  if (!isFailProcessLast(simulated)) {
    return { ok: false, message: SKILL_TRIGGER_FAIL_PROCESS_LAST_MESSAGE };
  }
  return { ok: true };
}

export function moveActionDrafts(
  actions: readonly SkillTriggerActionDraft[],
  index: number,
  direction: -1 | 1
): SkillTriggerActionDraft[] {
  const permission = canMoveAction(actions, index, direction);
  if (!permission.ok) return [...actions];
  const sorted = sortActionDrafts(actions);
  const target = index + direction;
  return swappedActionDrafts(sorted, index, target);
}

export function ensureFailProcessLast(actions: readonly SkillTriggerActionDraft[]): SkillTriggerActionDraft[] {
  const sorted = sortActionDrafts(actions);
  const fails = sorted.filter((item) => item.actionType === 'FAIL_PROCESS');
  const others = sorted.filter((item) => item.actionType !== 'FAIL_PROCESS');
  if (fails.length === 0) return sorted;
  const fail = fails[0];
  const maxOther = others.reduce((max, item) => Math.max(max, parseSortOrder(item.sortOrder) ?? 0), 0);
  const failSort = String(Math.max(maxOther + 10, parseSortOrder(fail.sortOrder) ?? 0));
  return [...others, { ...fail, sortOrder: failSort }];
}

function conditionFromDetail(condition: SkillTriggerCondition): SkillTriggerConditionDraft {
  switch (condition.conditionType) {
    case 'TARGET_CATEGORY_CHECK':
      return { conditionKey: condition.conditionKey, conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: String(condition.sortOrder), detail: { categories: [...condition.detail.categories] } };
    case 'LIFECYCLE_CHECK':
      return { conditionKey: condition.conditionKey, conditionType: 'LIFECYCLE_CHECK', sortOrder: String(condition.sortOrder), detail: condition.detail };
    case 'ATTRIBUTE_COMPARE':
      return {
        conditionKey: condition.conditionKey,
        conditionType: 'ATTRIBUTE_COMPARE',
        sortOrder: String(condition.sortOrder),
        detail: condition.detail
      };
    case 'STATUS_CHECK':
      return {
        conditionKey: condition.conditionKey,
        conditionType: 'STATUS_CHECK',
        sortOrder: String(condition.sortOrder),
        detail: condition.detail
      };
    case 'INTERNAL_STATE_CHECK':
      return {
        conditionKey: condition.conditionKey,
        conditionType: 'INTERNAL_STATE_CHECK',
        sortOrder: String(condition.sortOrder),
        detail: condition.detail
      };
    case 'EVENT_VALUE_COMPARE':
      return {
        conditionKey: condition.conditionKey,
        conditionType: 'EVENT_VALUE_COMPARE',
        sortOrder: String(condition.sortOrder),
        detail: condition.detail
      };
  }
}

function actionFromDetail(action: SkillTriggerAction): SkillTriggerActionDraft {
  switch (action.actionType) {
    case 'EXECUTE_EFFECT':
      return {
        actionKey: action.actionKey,
        name: action.name,
        actionType: 'EXECUTE_EFFECT',
        sortOrder: String(action.sortOrder),
        targetContext: action.targetContext,
        detail: action.detail,
        runtimeInputBindings: action.runtimeInputBindings.map((item) => ({ ...item })),
        resultModifiers: action.resultModifiers.map((item) => ({ ...item }))
      };
    case 'START_PROCESS':
      return {
        actionKey: action.actionKey,
        name: action.name,
        actionType: 'START_PROCESS',
        sortOrder: String(action.sortOrder),
        targetContext: action.targetContext,
        detail: action.detail,
        runtimeInputBindings: action.runtimeInputBindings.map((item) => ({ ...item })),
        resultModifiers: []
      };
    case 'FAIL_PROCESS':
      return {
        actionKey: action.actionKey,
        name: action.name,
        actionType: 'FAIL_PROCESS',
        sortOrder: String(action.sortOrder),
        targetContext: null,
        detail: action.detail,
        runtimeInputBindings: [],
        resultModifiers: []
      };
  }
}

export function fromDetail(detail: SkillTriggerRuleDetail): SkillTriggerRuleDraft {
  return {
    ruleKey: detail.ruleKey,
    name: detail.name,
    description: detail.description ?? '',
    sortOrder: String(detail.sortOrder),
    eventSource: detail.eventSource,
    conditionGroups: detail.conditionGroups.map((group) => ({
      draftId: crypto.randomUUID(),
      groupKey: group.groupKey,
      name: group.name,
      sortOrder: String(group.sortOrder),
      conditions: group.conditions.map(conditionFromDetail)
    })),
    actions: detail.actions.map(actionFromDetail),
    perTargetCooldownEnabled: detail.perTargetCooldown !== null,
    perTargetCooldownDurationValue: detail.perTargetCooldown?.durationValue ?? null,
    perTargetCooldownTargetContext: detail.perTargetCooldown?.targetContext ?? 'CURRENT_TARGET',
    maxTriggersPerProcessEnabled: detail.maxTriggersPerProcess !== null,
    maxTriggersLimitValue: detail.maxTriggersPerProcess?.limitValue ?? null
  };
}

function normalizeDescription(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

export function isTriggerRuleDraftDirty(draft: SkillTriggerRuleDraft, baseline: SkillTriggerRuleDraft): boolean {
  const businessFields = (value: SkillTriggerRuleDraft) => ({
    ...value,
    conditionGroups: value.conditionGroups.map(({ draftId: _draftId, ...group }) => group)
  });
  return JSON.stringify(businessFields(draft)) !== JSON.stringify(businessFields(baseline));
}

function toCondition(condition: SkillTriggerConditionDraft, sortOrder: number): SkillTriggerCondition {
  switch (condition.conditionType) {
    case 'TARGET_CATEGORY_CHECK':
      return { conditionKey: condition.conditionKey.trim(), conditionType: 'TARGET_CATEGORY_CHECK', sortOrder, detail: { categories: [...condition.detail.categories] } };
    case 'LIFECYCLE_CHECK':
      return { conditionKey: condition.conditionKey.trim(), conditionType: 'LIFECYCLE_CHECK', sortOrder: sortOrder, detail: condition.detail };
    case 'ATTRIBUTE_COMPARE':
      return {
        conditionKey: condition.conditionKey.trim(),
        conditionType: 'ATTRIBUTE_COMPARE',
        sortOrder,
        detail: condition.detail
      };
    case 'STATUS_CHECK':
      return {
        conditionKey: condition.conditionKey.trim(),
        conditionType: 'STATUS_CHECK',
        sortOrder,
        detail: condition.detail
      };
    case 'INTERNAL_STATE_CHECK':
      return {
        conditionKey: condition.conditionKey.trim(),
        conditionType: 'INTERNAL_STATE_CHECK',
        sortOrder,
        detail: condition.detail
      };
    case 'EVENT_VALUE_COMPARE':
      return {
        conditionKey: condition.conditionKey.trim(),
        conditionType: 'EVENT_VALUE_COMPARE',
        sortOrder,
        detail: condition.detail
      };
  }
}

export function actionEffectKey(detail: SkillTriggerAction['detail']): string {
  return 'effectKey' in detail ? detail.effectKey : '';
}

export function actionProcessKey(detail: SkillTriggerAction['detail']): string {
  return 'processKey' in detail ? detail.processKey : '';
}

export function actionFailureReason(
  detail: SkillTriggerAction['detail']
): SkillTriggerProcessFailureReason {
  return 'failureReason' in detail ? detail.failureReason : 'CONTROLLED';
}

function toAction(action: SkillTriggerActionDraft, sortOrder: number): SkillTriggerAction {
  if (action.actionType === 'EXECUTE_EFFECT') {
    return {
      actionKey: action.actionKey.trim(),
      name: action.name.trim(),
      actionType: 'EXECUTE_EFFECT',
      sortOrder,
      targetContext: action.targetContext ?? 'CURRENT_TARGET',
      detail: { effectKey: actionEffectKey(action.detail) },
      runtimeInputBindings: action.runtimeInputBindings,
      resultModifiers: action.resultModifiers
    };
  }
  if (action.actionType === 'START_PROCESS') {
    return {
      actionKey: action.actionKey.trim(),
      name: action.name.trim(),
      actionType: 'START_PROCESS',
      sortOrder,
      targetContext: action.targetContext ?? 'CURRENT_TARGET',
      detail: { processKey: actionProcessKey(action.detail) },
      runtimeInputBindings: action.runtimeInputBindings,
      resultModifiers: []
    };
  }
  return {
    actionKey: action.actionKey.trim(),
    name: action.name.trim(),
    actionType: 'FAIL_PROCESS',
    sortOrder,
    targetContext: null,
    detail: {
      processKey: actionProcessKey(action.detail),
      failureReason: actionFailureReason(action.detail)
    },
    runtimeInputBindings: [],
    resultModifiers: []
  };
}

function toConditionGroups(groups: SkillTriggerConditionGroupDraft[]): SkillTriggerConditionGroup[] {
  return sortGroupDrafts(groups).map((group) => ({
    groupKey: group.groupKey.trim(),
    name: group.name.trim(),
    sortOrder: parseSortOrder(group.sortOrder) ?? 0,
    conditions: sortConditionDrafts(group.conditions).map((condition) => (
      toCondition(condition, parseSortOrder(condition.sortOrder) ?? 0)
    ))
  }));
}

function toActions(actions: SkillTriggerActionDraft[]): SkillTriggerAction[] {
  return sortActionDrafts(actions).map((action) => (
    toAction(action, parseSortOrder(action.sortOrder) ?? 0)
  ));
}

function protectionsFromDraft(draft: SkillTriggerRuleDraft): Pick<
  CreateSkillTriggerRuleRequest,
  'perTargetCooldown' | 'maxTriggersPerProcess'
> {
  const processKey = draft.eventSource.eventType === 'PROCESS_MOMENT'
    ? draft.eventSource.detail.processKey
    : '';
  return {
    perTargetCooldown: draft.perTargetCooldownEnabled
      ? {
          durationValue: draft.perTargetCooldownDurationValue!,
          targetContext: draft.perTargetCooldownTargetContext
        }
      : null,
    maxTriggersPerProcess: draft.maxTriggersPerProcessEnabled && draft.eventSource.eventType === 'PROCESS_MOMENT'
      ? {
          processKey,
          limitValue: draft.maxTriggersLimitValue!
        }
      : null
  };
}

export function toCreateRequest(draft: SkillTriggerRuleDraft): CreateSkillTriggerRuleRequest {
  const protections = protectionsFromDraft(draft);
  return {
    ruleKey: draft.ruleKey.trim(),
    name: draft.name.trim(),
    description: normalizeDescription(draft.description),
    sortOrder: parseSortOrder(draft.sortOrder) ?? 0,
    eventSource: draft.eventSource,
    conditionGroups: toConditionGroups(draft.conditionGroups),
    actions: toActions(draft.actions),
    perTargetCooldown: protections.perTargetCooldown,
    maxTriggersPerProcess: protections.maxTriggersPerProcess
  };
}

export function toUpdateRequest(draft: SkillTriggerRuleDraft): UpdateSkillTriggerRuleRequest {
  const { ruleKey: _ruleKey, ...rest } = toCreateRequest(draft);
  return rest;
}

function usesEventValueKey(draft: SkillTriggerRuleDraft, key: SkillTriggerEventValueKey): boolean {
  const inConditions = draft.conditionGroups.some((group) => group.conditions.some((condition) => (
    condition.conditionType === 'EVENT_VALUE_COMPARE'
    && condition.detail.eventValueKey === key
  )));
  const inBindings = draft.actions.some((action) => action.runtimeInputBindings.some((binding) => (
    binding.sourceType === 'EVENT_VALUE' && binding.detail.eventValueKey === key
  )));
  return inConditions || inBindings;
}

function usesEventSourceSubject(draft: SkillTriggerRuleDraft): boolean {
  const inConditions = draft.conditionGroups.some((group) => group.conditions.some((condition) => {
    if (condition.conditionType === 'ATTRIBUTE_COMPARE' || condition.conditionType === 'STATUS_CHECK' || condition.conditionType === 'LIFECYCLE_CHECK') {
      return condition.detail.subject === 'EVENT_SOURCE';
    }
    return false;
  }));
  const inBindings = draft.actions.some((action) => action.runtimeInputBindings.some((binding) => (
    binding.sourceType === 'COMBAT_STATUS' && binding.detail.subject === 'EVENT_SOURCE'
  )));
  const inActions = draft.actions.some((action) => action.targetContext === 'EVENT_SOURCE');
  const inCooldown = draft.perTargetCooldownEnabled
    && draft.perTargetCooldownTargetContext === 'EVENT_SOURCE';
  return inConditions || inBindings || inActions || inCooldown;
}

export function analyzeEventSwitchImpact(
  draft: SkillTriggerRuleDraft,
  nextSource: SkillTriggerEventSource,
  stepType: SkillProcessStepType | null = null
): EventSwitchImpact {
  const allowed = new Set(allowedEventValuesFor(nextSource, stepType));
  const staleValues = SKILL_TRIGGER_EVENT_VALUE_KEYS.filter((key) => (
    usesEventValueKey(draft, key) && !allowed.has(key)
  ));
  const clearsEventSourceRefs = usesEventSourceSubject(draft) && !eventHasEventSource(nextSource.eventType);
  const clearsProcessLimit = draft.maxTriggersPerProcessEnabled && nextSource.eventType !== 'PROCESS_MOMENT';
  const parts: string[] = [];
  if (!allowsTargetCategoryCheck(nextSource.eventType) && draft.conditionGroups.some((group) => group.conditions.some((condition) => condition.conditionType === 'TARGET_CATEGORY_CHECK'))) {
    parts.push('当前事件不提供命中目标类别，将清除命中目标类别条件。');
  }
  if (!allowsSourceCastResourceCost(nextSource) && draft.actions.some((action) => action.runtimeInputBindings.some((binding) => binding.sourceType === 'SOURCE_CAST_RESOURCE_COST'))) {
    parts.push('当前事件未明确技能命中来源，将清除来源施放资源消耗绑定。');
  }
  if (staleValues.length > 0) {
    parts.push(`将清除不再可用的事件值：${staleValues.map((key) => SKILL_TRIGGER_EVENT_VALUE_LABELS[key]).join('、')}`);
  }
  if (clearsEventSourceRefs) {
    parts.push('当前事件不提供事件来源对象，将清除相关对象选择。');
  }
  if (clearsProcessLimit) {
    parts.push('单次过程最大触发次数仅用于过程时点事件，将关闭该保护。');
  }
  return {
    summary: parts.join(' '),
    clearsEventValues: staleValues.length > 0,
    clearsEventSourceRefs,
    clearsProcessLimit
  };
}

function fallbackSubject(subject: SkillTriggerSubject, hasEventSource: boolean): SkillTriggerSubject {
  if (subject === 'EVENT_SOURCE' && !hasEventSource) return 'CURRENT_TARGET';
  return subject;
}

function fallbackTargetContext(
  context: SkillTriggerTargetContext | null,
  hasEventSource: boolean
): SkillTriggerTargetContext | null {
  if (context === 'EVENT_SOURCE' && !hasEventSource) return 'CURRENT_TARGET';
  return context;
}

function cleanupConditionForEventSwitch(
  condition: SkillTriggerConditionDraft,
  hasEventSource: boolean,
  allowed: readonly SkillTriggerEventValueKey[],
  nextSource: SkillTriggerEventSource
): SkillTriggerConditionDraft | null {
  switch (condition.conditionType) {
    case 'TARGET_CATEGORY_CHECK':
      return allowsTargetCategoryCheck(nextSource.eventType) ? condition : null;
    case 'EVENT_VALUE_COMPARE': {
      if (!allowed.includes(condition.detail.eventValueKey)) return null;
      return condition;
    }
    case 'ATTRIBUTE_COMPARE':
      return patchAttributeCompareDetail(condition, {
        subject: fallbackSubject(condition.detail.subject, hasEventSource)
      });
    case 'LIFECYCLE_CHECK':
      return { ...condition, detail: { ...condition.detail, subject: condition.detail.subject === null ? null : fallbackSubject(condition.detail.subject, hasEventSource) } };
    case 'STATUS_CHECK':
      return patchStatusCheckSubject(
        condition,
        fallbackSubject(condition.detail.subject, hasEventSource)
      );
    case 'INTERNAL_STATE_CHECK':
      return condition;
  }
}

function cleanupBindingForEventSwitch(
  binding: SkillTriggerRuntimeInputBinding,
  hasEventSource: boolean,
  allowed: readonly SkillTriggerEventValueKey[],
  nextSource: SkillTriggerEventSource
): SkillTriggerRuntimeInputBinding | null {
  switch (binding.sourceType) {
    case 'SOURCE_CAST_RESOURCE_COST':
      return allowsSourceCastResourceCost(nextSource) ? binding : null;
    case 'EVENT_VALUE': {
      if (!allowed.includes(binding.detail.eventValueKey)) return null;
      return binding;
    }
    case 'COMBAT_STATUS':
      return patchCombatStatusBinding(binding, {
        subject: fallbackSubject(binding.detail.subject, hasEventSource)
      });
    case 'INTERNAL_STATE':
    case 'PRIOR_ACTION_RESULT':
      return binding;
  }
}

function cleanupActionForEventSwitch(
  action: SkillTriggerActionDraft,
  hasEventSource: boolean,
  allowed: readonly SkillTriggerEventValueKey[],
  nextSource: SkillTriggerEventSource
): SkillTriggerActionDraft {
  const runtimeInputBindings: SkillTriggerRuntimeInputBinding[] = [];
  for (const binding of action.runtimeInputBindings) {
    const next = cleanupBindingForEventSwitch(binding, hasEventSource, allowed, nextSource);
    if (next) runtimeInputBindings.push(next);
  }
  if (action.actionType === 'FAIL_PROCESS') {
    return { ...action, targetContext: null, runtimeInputBindings };
  }
  return {
    ...action,
    targetContext: fallbackTargetContext(action.targetContext, hasEventSource) ?? 'CURRENT_TARGET',
    runtimeInputBindings
  };
}

export function applyEventSwitchCleanup(
  draft: SkillTriggerRuleDraft,
  nextSource: SkillTriggerEventSource,
  stepType: SkillProcessStepType | null = null
): SkillTriggerRuleDraft {
  const hasEventSource = eventHasEventSource(nextSource.eventType);
  const allowed = allowedEventValuesFor(nextSource, stepType);
  const nextGroups = draft.conditionGroups.map((group) => {
    const conditions: SkillTriggerConditionDraft[] = [];
    for (const condition of group.conditions) {
      const next = cleanupConditionForEventSwitch(condition, hasEventSource, allowed, nextSource);
      if (next) conditions.push(next);
    }
    return { ...group, conditions };
  });
  const nextActions = draft.actions.map((action) => (
    cleanupActionForEventSwitch(action, hasEventSource, allowed, nextSource)
  ));
  return {
    ...draft,
    eventSource: nextSource,
    conditionGroups: nextGroups,
    actions: nextActions,
    perTargetCooldownTargetContext: fallbackTargetContext(
      draft.perTargetCooldownTargetContext,
      hasEventSource
    ) ?? 'CURRENT_TARGET',
    maxTriggersPerProcessEnabled: nextSource.eventType === 'PROCESS_MOMENT'
      ? draft.maxTriggersPerProcessEnabled
      : false,
    maxTriggersLimitValue: nextSource.eventType === 'PROCESS_MOMENT'
      ? draft.maxTriggersLimitValue
      : null
  };
}

export function findSourceActionCleanupImpact(
  actions: readonly SkillTriggerActionDraft[],
  removedOrMovedLaterKeys: readonly string[]
): SourceActionCleanupImpact[] {
  const removed = new Set(removedOrMovedLaterKeys);
  const impacts: SourceActionCleanupImpact[] = [];
  for (const action of actions) {
    const bindingKeys: string[] = [];
    const summaries: string[] = [];
    for (const binding of action.runtimeInputBindings) {
      if (
        binding.sourceType === 'PRIOR_ACTION_RESULT'
        && removed.has(binding.detail.sourceActionKey)
      ) {
        bindingKeys.push(binding.bindingKey);
        summaries.push(priorResultBindingCleanupSummary(action, binding));
      }
    }
    if (bindingKeys.length > 0) {
      impacts.push({ actionKey: action.actionKey, bindingKeys, summaries });
    }
  }
  return impacts;
}

export function findStalePriorResultBindings(
  actions: readonly SkillTriggerActionDraft[],
  effectsByKey: ReadonlyMap<string, SkillEffect>
): SourceActionCleanupImpact[] {
  const sorted = sortActionDrafts(actions);
  const impacts: SourceActionCleanupImpact[] = [];
  for (let actionIndex = 0; actionIndex < sorted.length; actionIndex += 1) {
    const action = sorted[actionIndex];
    const bindingKeys: string[] = [];
    const summaries: string[] = [];
    for (const binding of action.runtimeInputBindings) {
      if (binding.sourceType !== 'PRIOR_ACTION_RESULT') continue;
      const legal = isLegalPriorResultBinding(binding, sorted, actionIndex, effectsByKey);
      if (legal.ok || legal.reason === 'missing-effect') continue;
      bindingKeys.push(binding.bindingKey);
      summaries.push(priorResultBindingCleanupSummary(action, binding));
    }
    if (bindingKeys.length > 0) {
      impacts.push({ actionKey: action.actionKey, bindingKeys, summaries });
    }
  }
  return impacts;
}

function priorResultBindingCleanupSummary(
  action: SkillTriggerActionDraft,
  binding: SkillTriggerPriorResultBinding
): string {
  const output = isAllowedPriorResultOutputKind(binding.detail.outputKind)
    ? priorResultOutputLabel(binding.detail.outputKind)
    : binding.detail.outputKind;
  return [
    action.actionKey,
    binding.bindingKey,
    binding.detail.sourceResultKey,
    output
  ].join(' / ');
}

export function removeBindingsByKeys(
  actions: readonly SkillTriggerActionDraft[],
  bindingKeys: readonly string[]
): SkillTriggerActionDraft[] {
  const removed = new Set(bindingKeys);
  return actions.map((action): SkillTriggerActionDraft => {
    const runtimeInputBindings = action.runtimeInputBindings.filter(
      (item) => !removed.has(item.bindingKey)
    );
    if (action.actionType === 'EXECUTE_EFFECT') {
      return { ...action, runtimeInputBindings };
    }
    if (action.actionType === 'START_PROCESS') {
      return { ...action, runtimeInputBindings };
    }
    return { ...action, runtimeInputBindings: [] };
  });
}

export function conditionSummary(condition: SkillTriggerConditionDraft): string {
  switch (condition.conditionType) {
    case 'TARGET_CATEGORY_CHECK':
      return `${SKILL_TRIGGER_CONDITION_TYPE_LABELS.TARGET_CATEGORY_CHECK} / ${condition.detail.categories.map((category) => TARGET_CATEGORY_LABELS[category]).join('、')}`;
    case 'ATTRIBUTE_COMPARE':
      return [
        SKILL_TRIGGER_CONDITION_TYPE_LABELS.ATTRIBUTE_COMPARE,
        SKILL_TRIGGER_SUBJECT_LABELS[condition.detail.subject],
        condition.detail.attributeKey,
        attributeValueKindLabel(condition.detail.attributeValueKind),
        SKILL_TRIGGER_COMPARATOR_LABELS[condition.detail.comparator],
        numericValueSummary(condition.detail.comparisonValue)
      ].filter(Boolean).join(' / ');
    case 'LIFECYCLE_CHECK':
      return ['生命周期检查', condition.detail.effectKey, condition.detail.subject ? SKILL_TRIGGER_SUBJECT_LABELS[condition.detail.subject] : null,
        LIFECYCLE_CHECK_LABELS[condition.detail.checkKind], condition.detail.checkKind === 'STACKS_COMPARE' ? SKILL_TRIGGER_COMPARATOR_LABELS[condition.detail.comparator] + ' ' + numericValueSummary(condition.detail.comparisonValue) : null].filter(Boolean).join(' / ');
    case 'STATUS_CHECK':
      return [
        SKILL_TRIGGER_CONDITION_TYPE_LABELS.STATUS_CHECK,
        SKILL_TRIGGER_SUBJECT_LABELS[condition.detail.subject],
        condition.detail.statusKey,
        SKILL_TRIGGER_STATUS_CHECK_LABELS[condition.detail.checkKind]
      ].join(' / ');
    case 'INTERNAL_STATE_CHECK':
      return [
        SKILL_TRIGGER_CONDITION_TYPE_LABELS.INTERNAL_STATE_CHECK,
        condition.detail.stateKey,
        SKILL_TRIGGER_INTERNAL_STATE_VALUE_LABELS[condition.detail.valueKind]
      ].join(' / ');
    case 'EVENT_VALUE_COMPARE':
      return [
        SKILL_TRIGGER_CONDITION_TYPE_LABELS.EVENT_VALUE_COMPARE,
        SKILL_TRIGGER_EVENT_VALUE_LABELS[condition.detail.eventValueKey],
        SKILL_TRIGGER_COMPARATOR_LABELS[condition.detail.comparator]
      ].join(' / ');
  }
}

export function groupConditionSummary(group: SkillTriggerConditionGroupDraft): string {
  return sortConditionDrafts(group.conditions)
    .map((item) => conditionSummary(item))
    .join(` ${SKILL_TRIGGER_GROUP_AND_LABEL} `);
}

export function actionSummary(action: SkillTriggerActionDraft): string {
  const target = action.targetContext
    ? SKILL_TRIGGER_TARGET_CONTEXT_LABELS[action.targetContext]
    : '—';
  const object = action.actionType === 'EXECUTE_EFFECT'
    ? actionEffectKey(action.detail)
    : actionProcessKey(action.detail);
  return [
    SKILL_TRIGGER_ACTION_TYPE_LABELS[action.actionType],
    target,
    object,
    `绑定 ${action.runtimeInputBindings.length}`,
    `修正 ${action.resultModifiers.length}`
  ].join(' / ');
}

export function bindingSummary(binding: SkillTriggerRuntimeInputBinding): string {
  switch (binding.sourceType) {
    case 'SOURCE_CAST_RESOURCE_COST':
      return `${SKILL_TRIGGER_SOURCE_TYPE_LABELS.SOURCE_CAST_RESOURCE_COST} / ${binding.detail.attributeKey}`;
    case 'INTERNAL_STATE':
      return [
        SKILL_TRIGGER_SOURCE_TYPE_LABELS.INTERNAL_STATE,
        binding.detail.stateKey,
        SKILL_TRIGGER_INTERNAL_STATE_VALUE_LABELS[binding.detail.valueKind],
        binding.detail.optionKey ?? ''
      ].filter(Boolean).join(' / ');
    case 'COMBAT_STATUS':
      return [
        SKILL_TRIGGER_SOURCE_TYPE_LABELS.COMBAT_STATUS,
        SKILL_TRIGGER_SUBJECT_LABELS[binding.detail.subject],
        binding.detail.statusKey,
        SKILL_TRIGGER_COMBAT_STATUS_VALUE_LABELS[binding.detail.valueKind]
      ].join(' / ');
    case 'EVENT_VALUE':
      return [
        SKILL_TRIGGER_SOURCE_TYPE_LABELS.EVENT_VALUE,
        SKILL_TRIGGER_EVENT_VALUE_LABELS[binding.detail.eventValueKey]
      ].join(' / ');
    case 'PRIOR_ACTION_RESULT':
      return [
        SKILL_TRIGGER_SOURCE_TYPE_LABELS.PRIOR_ACTION_RESULT,
        binding.detail.sourceActionKey,
        binding.detail.sourceResultKey,
        isAllowedPriorResultOutputKind(binding.detail.outputKind)
          ? priorResultOutputLabel(binding.detail.outputKind)
          : binding.detail.outputKind
      ].join(' / ');
  }
}

export function collectFormulaParameterKeys(expression: FormulaExpressionNode): string[] {
  if (expression.nodeType === 'PARAMETER') return [expression.parameterKey];
  if (expression.nodeType === 'OPERATION') {
    return [
      ...collectFormulaParameterKeys(expression.operands[0]),
      ...collectFormulaParameterKeys(expression.operands[1])
    ];
  }
  return [];
}

export function formulaHasRuntimeInput(
  formula: SkillFormula | undefined,
  parameters: ReadonlyArray<Pick<SkillParameter, 'parameterKey' | 'valueMode'>>
): boolean {
  if (!formula) return false;
  const keys = new Set(collectFormulaParameterKeys(formula.expression));
  return parameters.some((item) => item.valueMode === 'RUNTIME_INPUT' && keys.has(item.parameterKey));
}

export function collectExecuteEffectValues(effect: SkillEffect): NumericValue[] {
  return [...numericValuesIn(effect.results), ...numericValuesIn(effect.lifecycle)];
}

export function collectExecuteEffectFormulaKeys(effect: SkillEffect): string[] {
  return [...new Set(collectExecuteEffectValues(effect).map(numericFormulaKey).filter(Boolean))];
}

export function collectStartProcessValues(
  process: SkillProcess,
  effectsByKey: ReadonlyMap<string, SkillEffect>,
  statesByKey: ReadonlyMap<string, SkillInternalState>
): NumericValue[] {
  const values = numericValuesIn(process);
  for (const operation of process.stateOperations) {
    const state = statesByKey.get(operation.stateKey);
    if (!state) continue;
    if (state.stateType === 'COUNTER' || state.stateType === 'AMMO'
      || (state.stateType === 'INTERNAL_COOLDOWN' && (operation.operation === 'START' || operation.operation === 'RESET'))) {
      values.push(...numericValuesIn(state.detail));
    }
  }
  for (const binding of process.effectBindings) {
    const effect = effectsByKey.get(binding.effectKey);
    if (effect) values.push(...collectExecuteEffectValues(effect));
  }
  return values;
}

export function collectStartProcessFormulaKeys(
  process: SkillProcess,
  effectsByKey: ReadonlyMap<string, SkillEffect>,
  statesByKey: ReadonlyMap<string, SkillInternalState>
): string[] {
  return [...new Set(collectStartProcessValues(process, effectsByKey, statesByKey).map(numericFormulaKey).filter(Boolean))];
}

export function effectHasReflectedDamage(effect: SkillEffect | undefined): boolean {
  return Boolean(effect?.results.some((result) => (
    result.resultType === 'DAMAGE' && result.detail.originKind === 'REFLECTED'
  )));
}

export function processHasReflectedDamage(
  process: SkillProcess | undefined,
  effectsByKey: ReadonlyMap<string, SkillEffect> | undefined
): boolean {
  if (!process || !effectsByKey) return false;
  return process.effectBindings.some((binding) => (
    effectHasReflectedDamage(effectsByKey.get(binding.effectKey))
  ));
}

export function reachableRuntimeInputParameters(
  values: readonly NumericValue[],
  formulasByKey: ReadonlyMap<string, SkillFormula>,
  parameters: ReadonlyArray<SkillParameter>
): SkillParameter[] {
  const referenced = new Set(values.map(numericParameterKey).filter(Boolean));
  const formulaKeys = values.map(numericFormulaKey).filter(Boolean);
  for (const formulaKey of formulaKeys) {
    const formula = formulasByKey.get(formulaKey);
    if (!formula) continue;
    for (const parameterKey of collectFormulaParameterKeys(formula.expression)) {
      referenced.add(parameterKey);
    }
  }
  return parameters.filter((item) => (
    item.valueMode === 'RUNTIME_INPUT' && referenced.has(item.parameterKey)
  ));
}

export function sourceValueDomain(
  binding: SkillTriggerRuntimeInputBinding
): SkillTriggerValueDomain | null {
  switch (binding.sourceType) {
    case 'SOURCE_CAST_RESOURCE_COST':
      return 'DECIMAL';
    case 'INTERNAL_STATE':
      return binding.detail.valueKind === 'REMAINING_MS' ? 'DECIMAL' : 'INTEGER';
    case 'COMBAT_STATUS':
      return binding.detail.valueKind === 'REMAINING_MS' ? 'DECIMAL' : 'INTEGER';
    case 'EVENT_VALUE':
      return eventValueDomain(binding.detail.eventValueKey);
    case 'PRIOR_ACTION_RESULT':
      return isAllowedPriorResultOutputKind(binding.detail.outputKind)
        ? priorResultOutputDomain(binding.detail.outputKind)
        : null;
  }
}

export function isBindingTypeCompatible(
  sourceDomain: SkillTriggerValueDomain,
  parameterType: SkillParameterValueType
): boolean {
  if (sourceDomain === 'INTEGER') return parameterType === 'INTEGER' || parameterType === 'DECIMAL';
  return parameterType === 'DECIMAL';
}

export function evaluateBindingCompleteness(
  reachable: readonly SkillParameter[],
  bindings: readonly SkillTriggerRuntimeInputBinding[]
): BindingCompleteness[] {
  const byParameter = new Map<string, SkillTriggerRuntimeInputBinding[]>();
  for (const binding of bindings) {
    const list = byParameter.get(binding.parameterKey) ?? [];
    list.push(binding);
    byParameter.set(binding.parameterKey, list);
  }
  const reachableKeys = new Set(reachable.map((item) => item.parameterKey));
  const rows: BindingCompleteness[] = reachable.map((parameter) => {
    const matched = byParameter.get(parameter.parameterKey) ?? [];
    const first = matched[0];
    const compatible = first
      ? isBindingTypeCompatible(sourceValueDomain(first) ?? 'DECIMAL', parameter.valueType)
      : null;
    return {
      parameterKey: parameter.parameterKey,
      name: parameter.name,
      valueType: parameter.valueType,
      missing: matched.length === 0,
      duplicate: matched.length > 1,
      extra: false,
      typeCompatible: compatible,
      summary: first ? bindingSummary(first) : '缺少绑定'
    };
  });
  for (const binding of bindings) {
    if (!reachableKeys.has(binding.parameterKey)) {
      rows.push({
        parameterKey: binding.parameterKey,
        name: binding.parameterKey,
        valueType: 'DECIMAL',
        missing: false,
        duplicate: false,
        extra: true,
        typeCompatible: null,
        summary: '未使用绑定'
      });
    }
  }
  return rows;
}

export function hasNumericValueRule(result: SkillEffectResult): boolean {
  return result.valueRule !== null;
}

export function isImmediateResult(result: SkillEffectResult, hasLifecycle?: boolean): boolean {
  const scoped = hasLifecycle ?? result.lifecycleBehavior !== null;
  if (!scoped) return true;
  return result.lifecycleBehavior?.moment === 'APPLICATION';
}

export function isImmediateNumericResult(result: SkillEffectResult, hasLifecycle?: boolean): boolean {
  return hasNumericValueRule(result) && isImmediateResult(result, hasLifecycle);
}

export function cooldownOperationOf(
  result: SkillEffectResult
): 'REDUCE' | 'INCREASE' | 'RESET' | null {
  return result.resultType === 'COOLDOWN_CHANGE' ? result.detail.operation : null;
}

export function listAvailablePriorResultOutputs(
  result: SkillEffectResult
): SkillTriggerPriorResultOutputKind[] {
  const outputs: SkillTriggerPriorResultOutputKind[] = [];
  const cooldownOperation = cooldownOperationOf(result);
  if (hasNumericValueRule(result) && cooldownOperation !== 'RESET') {
    outputs.push('CONFIGURED_VALUE');
  }
  if (result.resultType === 'DAMAGE') {
    outputs.push(
      'RAW_DAMAGE',
      'POST_DEFENSE_DAMAGE',
      'SHIELD_ABSORBED',
      'ACTUAL_HP_LOSS',
      'IMMUNE',
      'KILLED'
    );
    if (result.detail.vampRules.length > 0) {
      outputs.push('ACTUAL_HEALING');
    }
  } else if (result.resultType === 'DIRECT_HEAL') {
    outputs.push('ACTUAL_HEALING');
  } else if (result.resultType === 'EXECUTE') {
    outputs.push('KILLED');
  }
  if (
    result.resultType === 'STATUS_OPERATION'
    && result.detail.operation === 'APPLY'
  ) {
    outputs.push('STATUS_APPLIED');
  }
  if (
    result.spellShieldBlockScope !== null
    && BLOCKABLE_PRIOR_RESULT_TYPES.has(result.resultType)
    && result.resultType !== 'DIRECT_HEAL'
    && result.resultType !== 'NORMAL_SHIELD'
  ) {
    outputs.push('BLOCKED');
  }
  return outputs;
}

export function filterPriorResultOutputsForParameter(
  outputs: readonly SkillTriggerPriorResultOutputKind[],
  parameterType: SkillParameterValueType | null | undefined
): SkillTriggerPriorResultOutputKind[] {
  if (parameterType !== 'INTEGER' && parameterType !== 'DECIMAL') {
    return [...outputs];
  }
  return outputs.filter((kind) => (
    isBindingTypeCompatible(priorResultOutputDomain(kind), parameterType)
  ));
}

export function listEarlierExecuteEffectActions(
  actions: readonly SkillTriggerActionDraft[],
  currentIndex: number
): PriorSourceActionOption[] {
  const sorted = sortActionDrafts(actions);
  const priorCount = Math.min(Math.max(currentIndex, 0), sorted.length);
  const earlier: PriorSourceActionOption[] = [];
  for (let index = 0; index < priorCount; index += 1) {
    const action = sorted[index];
    if (action.actionType !== 'EXECUTE_EFFECT') continue;
    earlier.push({
      sourceActionKey: action.actionKey,
      sourceActionName: action.name || action.actionKey,
      sourceEffectKey: action.detail.effectKey
    });
  }
  return earlier;
}

export function listImmediateSourceResults(
  effect: SkillEffect | null | undefined
): SkillEffectResult[] {
  if (!effect) return [];
  const hasLifecycle = effect.lifecycle !== null;
  const seen = new Set<string>();
  const results: SkillEffectResult[] = [];
  for (const result of effect.results) {
    if (seen.has(result.resultKey)) continue;
    if (!isImmediateResult(result, hasLifecycle)) continue;
    if (listAvailablePriorResultOutputs(result).length === 0) continue;
    seen.add(result.resultKey);
    results.push(result);
  }
  return results;
}

export function listImmediatePriorResults(
  actions: readonly SkillTriggerActionDraft[],
  currentIndex: number,
  effectsByKey: ReadonlyMap<string, SkillEffect>
): ImmediatePriorResult[] {
  const results: ImmediatePriorResult[] = [];
  for (const action of listEarlierExecuteEffectActions(actions, currentIndex)) {
    const effect = effectsByKey.get(action.sourceEffectKey);
    if (!effect) continue;
    for (const result of listImmediateSourceResults(effect)) {
      results.push({
        sourceActionKey: action.sourceActionKey,
        sourceActionName: action.sourceActionName,
        sourceEffectKey: action.sourceEffectKey,
        sourceResultKey: result.resultKey,
        sourceResultName: result.name || result.resultKey
      });
    }
  }
  return results;
}

export function isLegalPriorResultBinding(
  binding: SkillTriggerPriorResultBinding,
  actions: readonly SkillTriggerActionDraft[],
  currentIndex: number,
  effectsByKey: ReadonlyMap<string, SkillEffect>
): { ok: true } | { ok: false; reason: 'missing-effect' | 'illegal' } {
  const earlier = listEarlierExecuteEffectActions(actions, currentIndex);
  const sourceAction = earlier.find((item) => item.sourceActionKey === binding.detail.sourceActionKey);
  if (!sourceAction) return { ok: false, reason: 'illegal' };
  const effect = effectsByKey.get(sourceAction.sourceEffectKey);
  if (!effect) return { ok: false, reason: 'missing-effect' };
  const result = listImmediateSourceResults(effect).find((item) => (
    item.resultKey === binding.detail.sourceResultKey
  ));
  if (!result) return { ok: false, reason: 'illegal' };
  if (!isAllowedPriorResultOutputKind(binding.detail.outputKind)) {
    return { ok: false, reason: 'illegal' };
  }
  if (!listAvailablePriorResultOutputs(result).includes(binding.detail.outputKind)) {
    return { ok: false, reason: 'illegal' };
  }
  return { ok: true };
}

export function validateResultModifier(
  modifier: SkillTriggerResultModifier
): string | null {
  const hasValue = modifier.fixedMultiplier !== null
    || modifier.fixedMinValue !== null
    || modifier.fixedMaxValue !== null;
  if (!hasValue) return '固定结果修正至少需要一项非空。';
  if (modifier.fixedMultiplier !== null && modifier.fixedMultiplier < 0) {
    return '额外固定倍率不能小于 0。';
  }
  if (
    modifier.fixedMinValue !== null
    && modifier.fixedMaxValue !== null
    && modifier.fixedMinValue > modifier.fixedMaxValue
  ) {
    return '额外固定最小值不能大于额外固定最大值。';
  }
  return null;
}

function pushError(
  nested: NestedFieldError[],
  path: string,
  message: string
): void {
  nested.push({ path, message });
}

function validateKey(value: string, label: string): string | undefined {
  if (!value.trim()) return `${label}不能为空。`;
  if (!SKILL_TRIGGER_KEY_PATTERN.test(value.trim())) return `${label}格式不合法。`;
  return undefined;
}

export function collectDirectValues(draft: SkillTriggerRuleDraft): NumericValue[] {
  return numericValuesIn({ eventSource: draft.eventSource, conditionGroups: draft.conditionGroups,
    cooldown: draft.perTargetCooldownEnabled ? draft.perTargetCooldownDurationValue : null,
    limit: draft.maxTriggersPerProcessEnabled ? draft.maxTriggersLimitValue : null });
}

export function collectDirectFormulaKeys(draft: SkillTriggerRuleDraft): string[] {
  return [...new Set(collectDirectValues(draft).map(numericFormulaKey).filter(Boolean))];
}

type ReferencedCatalogs = {
  effectsByKey?: ReadonlyMap<string, SkillEffect>;
  processesByKey?: ReadonlyMap<string, SkillProcess>;
  statesByKey?: ReadonlyMap<string, SkillInternalState>;
};

export function collectActionValues(action: SkillTriggerActionDraft, catalogs: ReferencedCatalogs): NumericValue[] {
  if (action.actionType === 'EXECUTE_EFFECT') {
    const effect = catalogs.effectsByKey?.get(action.detail.effectKey);
    return effect ? collectExecuteEffectValues(effect) : [];
  }
  if (action.actionType === 'START_PROCESS') {
    const process = catalogs.processesByKey?.get(action.detail.processKey);
    return process ? collectStartProcessValues(process, catalogs.effectsByKey ?? new Map(), catalogs.statesByKey ?? new Map()) : [];
  }
  return [];
}

export function requiredCatalogsForDraft(draft: SkillTriggerRuleDraft, catalogs: ReferencedCatalogs = {}): SkillTriggerCatalogKind[] {
  const required = new Set<SkillTriggerCatalogKind>(['effects', 'processes']);
  const values = [...collectDirectValues(draft), ...draft.actions.flatMap((action) => collectActionValues(action, catalogs))];
  if (values.some((value) => value.kind === 'FORMULA')) { required.add('formulas'); required.add('parameters'); }
  if (values.some((value) => value.kind === 'PARAMETER') || draft.actions.some((action) => action.runtimeInputBindings.length > 0)) required.add('parameters');
  for (const need of SKILL_TRIGGER_EVENT_CAPABILITIES[draft.eventSource.eventType].requiredCatalogs) {
    if (
      need === 'skills'
      || need === 'attributes'
      || need === 'statuses'
      || need === 'internalStates'
      || need === 'effects'
      || need === 'processes'
    ) {
      required.add(need);
    }
  }
  for (const group of draft.conditionGroups) {
    for (const condition of group.conditions) {
      if (condition.conditionType === 'ATTRIBUTE_COMPARE') required.add('attributes');
      if (condition.conditionType === 'STATUS_CHECK') required.add('statuses');
      if (condition.conditionType === 'INTERNAL_STATE_CHECK') required.add('internalStates');
    }
  }
  for (const action of draft.actions) {
    if (action.runtimeInputBindings.some((item) => item.sourceType === 'SOURCE_CAST_RESOURCE_COST')) required.add('attributes');
    if (action.runtimeInputBindings.some((item) => item.sourceType === 'INTERNAL_STATE')) {
      required.add('internalStates');
    }
    if (action.runtimeInputBindings.some((item) => item.sourceType === 'COMBAT_STATUS')) {
      required.add('statuses');
    }
  }
  return [...required];
}

export function catalogsBlockingSave(
  required: readonly SkillTriggerCatalogKind[],
  states: Partial<Record<SkillTriggerCatalogKind, CatalogLoadState>>
): SkillTriggerCatalogKind[] {
  return required.filter((kind) => states[kind] !== 'ready');
}

export function shouldKeepDraftOnHttpStatus(status: number): boolean {
  return status === 400 || status === 409;
}

export function canOverwriteMissingRecord(status: number, code?: string): boolean {
  return !(status === 404 || code === '404.SKILL_TRIGGER_RULE_NOT_FOUND' || code === '404.SKILL_NOT_FOUND');
}

export function isSkillNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === '404.SKILL_NOT_FOUND';
}

export function isTriggerRuleNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === '404.SKILL_TRIGGER_RULE_NOT_FOUND';
}

export function subjectOptionsForEvent(eventType: SkillTriggerEventType): SkillTriggerSubject[] {
  return eventHasEventSource(eventType)
    ? ['SOURCE', 'CURRENT_TARGET', 'EVENT_SOURCE']
    : ['SOURCE', 'CURRENT_TARGET'];
}

export function targetContextOptionsForEvent(eventType: SkillTriggerEventType): SkillTriggerTargetContext[] {
  return eventHasEventSource(eventType)
    ? ['CURRENT_TARGET', 'EVENT_SOURCE']
    : ['CURRENT_TARGET'];
}

export function changeKindsForInternalState(
  stateType: SkillInternalStateType | null
): SkillTriggerInternalStateChangeKind[] {
  switch (stateType) {
    case 'COUNTER':
    case 'AMMO':
      return ['VALUE_CHANGED'];
    case 'MODE':
      return ['OPTION_SELECTED'];
    case 'FLAG':
      return ['FLAG_CHANGED'];
    case 'INTERNAL_COOLDOWN':
      return ['COOLDOWN_READY'];
    default:
      return ['VALUE_CHANGED', 'OPTION_SELECTED', 'FLAG_CHANGED', 'COOLDOWN_READY'];
  }
}

export function valueKindsForInternalState(
  stateType: SkillInternalStateType | null
): SkillTriggerInternalStateValueKind[] {
  switch (stateType) {
    case 'COUNTER':
    case 'AMMO':
      return ['VALUE'];
    case 'MODE':
      return ['OPTION_SELECTED'];
    case 'FLAG':
      return ['ENABLED'];
    case 'INTERNAL_COOLDOWN':
      return ['REMAINING_MS'];
    default:
      return ['VALUE', 'OPTION_SELECTED', 'ENABLED', 'REMAINING_MS'];
  }
}

export function resultAvailableEffects(
  effects: ReadonlyArray<Pick<SkillEffect, 'effectKey' | 'lifecycle' | 'name'>>
): Array<Pick<SkillEffect, 'effectKey' | 'lifecycle' | 'name'>> {
  return effects.filter((item) => item.lifecycle === null);
}

export function lifecycleEventEffects(
  effects: ReadonlyArray<Pick<SkillEffect, 'effectKey' | 'lifecycle' | 'name'>>
): Array<Pick<SkillEffect, 'effectKey' | 'lifecycle' | 'name'>> {
  return effects.filter((item) => item.lifecycle !== null);
}

export function isSpellShieldEventEffect(effect: SkillEffect): boolean {
  return effect.lifecycle !== null && effect.results.some((result) => (
    result.resultType === 'SPELL_SHIELD'
    && result.lifecycleBehavior?.moment === 'PERSISTENT'
  ));
}

export function spellShieldEventEffects(effects: readonly SkillEffect[]): SkillEffect[] {
  return effects.filter(isSpellShieldEventEffect);
}

export function persistentStatusApplyResults(
  effect: SkillEffect,
  statusKey: string
): SkillEffectResult[] {
  if (!effect.lifecycle) return [];
  return effect.results.filter((result) => (
    result.resultType === 'STATUS_OPERATION'
    && result.detail.operation === 'APPLY'
    && result.detail.statusKey === statusKey
    && result.lifecycleBehavior?.moment === 'PERSISTENT'
  ));
}

export function validateSkillTriggerDraft(
  draft: SkillTriggerRuleDraft,
  options: {
    includeRuleKey: boolean;
    skillKey?: string;
    catalogStates?: Partial<Record<SkillTriggerCatalogKind, CatalogLoadState>>;
    formulasByKey?: ReadonlyMap<string, SkillFormula>;
    parameters?: readonly SkillParameter[];
    attributes?: readonly Pick<Attribute, 'attributeKey'>[];
    effectsByKey?: ReadonlyMap<string, SkillEffect>;
    damageTypesByKey?: ReadonlyMap<string, DamageType>;
    processesByKey?: ReadonlyMap<string, SkillProcess>;
    statesByKey?: ReadonlyMap<string, SkillInternalState>;
    stepType?: SkillProcessStepType | null;
  }
): SkillTriggerFormValidation {
  const fieldErrors: SkillTriggerDraftErrors = {};
  const nestedErrors: NestedFieldError[] = [];
  if (options.includeRuleKey) {
    const keyError = validateKey(draft.ruleKey, '规则标识');
    if (keyError) fieldErrors.ruleKey = keyError;
  }
  if (!draft.name.trim()) fieldErrors.name = '规则名称不能为空。';
  else if (draft.name.trim().length > 100) fieldErrors.name = '规则名称不能超过100个字符。';
  if (draft.description.trim().length > 1000) fieldErrors.description = '说明不能超过1000个字符。';
  if (parseSortOrder(draft.sortOrder) === null) fieldErrors.sortOrder = '排序必须是 0～999999 的整数。';

  const required = requiredCatalogsForDraft(draft, options);
  const blocking = options.catalogStates ? catalogsBlockingSave(required, options.catalogStates) : [];
  if (blocking.length > 0) {
    fieldErrors.eventSource = INCOMPLETE_CATALOG_MESSAGE;
  }

  const allowedValues = allowedEventValuesFor(draft.eventSource, options.stepType ?? null);
  const hasEventSource = eventHasEventSource(draft.eventSource.eventType);
  if (draft.eventSource.eventType === 'PROCESS_MOMENT' && !draft.eventSource.detail.processKey.trim()) {
    pushError(nestedErrors, 'eventSource.detail.processKey', '过程不能为空。');
  }
  if (draft.eventSource.eventType === 'LIFECYCLE_MOMENT' && draft.eventSource.detail.moment === 'PERIODIC') {
    const effect = options.effectsByKey?.get(draft.eventSource.detail.effectKey);
    if (effect && !effect.lifecycle?.periodicIntervalValue) {
      pushError(nestedErrors, 'eventSource.detail.moment', '周期时点要求已配置周期间隔。');
    }
  }
  if (draft.eventSource.eventType === 'SPELL_SHIELD_BLOCKED') {
    const shieldEffectKey = draft.eventSource.detail.shieldEffectKey.trim();
    if (!shieldEffectKey) {
      pushError(nestedErrors, 'eventSource.detail.shieldEffectKey', '法术护盾效果不能为空。');
    } else {
      const effect = options.effectsByKey?.get(shieldEffectKey);
      if (!effect || !isSpellShieldEventEffect(effect)) {
        pushError(
          nestedErrors,
          'eventSource.detail.shieldEffectKey',
          '请选择含持续法术护盾结果的生命周期效果。'
        );
      }
    }
  }
  if (
    draft.eventSource.eventType === 'DAMAGE_PENDING'
    || draft.eventSource.eventType === 'DAMAGE_DEALT'
    || draft.eventSource.eventType === 'DAMAGE_TAKEN'
  ) {
    const detail = draft.eventSource.detail;
    if (
      detail.deliveryKind !== 'ANY'
      && detail.deliveryKind !== 'SKILL'
      && detail.deliveryKind !== 'BASIC_ATTACK'
    ) {
      pushError(nestedErrors, 'eventSource.detail.deliveryKind', '请选择伤害产生方式。');
    }
    if (
      detail.originKind !== 'ANY'
      && detail.originKind !== 'DIRECT'
      && detail.originKind !== 'REFLECTED'
    ) {
      pushError(nestedErrors, 'eventSource.detail.originKind', '请选择伤害来源性质。');
    }
    if (
      detail.damageTypeKey
      && options.damageTypesByKey
      && !options.damageTypesByKey.has(detail.damageTypeKey)
    ) {
      pushError(nestedErrors, 'eventSource.detail.damageTypeKey', '伤害类型目录中不存在该选项。');
    }
  }

  const groupKeys = new Set<string>();
  const sortedGroups = sortGroupDrafts(draft.conditionGroups);
  if (sortedGroups.length === 0) {
    // unconditional is allowed
  }
  for (let groupIndex = 0; groupIndex < sortedGroups.length; groupIndex += 1) {
    const group = sortedGroups[groupIndex];
    const keyError = validateKey(group.groupKey, '条件组标识');
    if (keyError) pushError(nestedErrors, `conditionGroups[${groupIndex}].groupKey`, keyError);
    if (groupKeys.has(group.groupKey.trim())) {
      pushError(nestedErrors, `conditionGroups[${groupIndex}].groupKey`, '条件组标识不能重复。');
    }
    groupKeys.add(group.groupKey.trim());
    if (!group.name.trim()) {
      pushError(nestedErrors, `conditionGroups[${groupIndex}].name`, '条件组名称不能为空。');
    }
    if (group.conditions.length === 0) {
      pushError(nestedErrors, `conditionGroups[${groupIndex}].conditions`, '条件组至少包含一个条件。');
    }
    const conditionKeys = new Set<string>();
    const sortedConditions = sortConditionDrafts(group.conditions);
    for (let conditionIndex = 0; conditionIndex < sortedConditions.length; conditionIndex += 1) {
      const condition = sortedConditions[conditionIndex];
      const conditionKeyError = validateKey(condition.conditionKey, '条件标识');
      if (conditionKeyError) {
        pushError(nestedErrors, `conditionGroups[${groupIndex}].conditions[${conditionIndex}].conditionKey`, conditionKeyError);
      }
      if (conditionKeys.has(condition.conditionKey.trim())) {
        pushError(nestedErrors, `conditionGroups[${groupIndex}].conditions[${conditionIndex}].conditionKey`, '条件标识不能重复。');
      }
      conditionKeys.add(condition.conditionKey.trim());
      if (condition.conditionType === 'LIFECYCLE_CHECK') {
        const issue = lifecycleConditionError(condition.detail, options.effectsByKey?.get(condition.detail.effectKey), subjectOptionsForEvent(draft.eventSource.eventType),
          { parameters: options.parameters, formulas: options.formulasByKey ? [...options.formulasByKey.values()] : undefined }, {}, options.skillKey);
        if (issue) pushError(nestedErrors, `conditionGroups[${groupIndex}].conditions[${conditionIndex}].detail.${issue.field}`, issue.message);
      }
      if (condition.conditionType === 'TARGET_CATEGORY_CHECK') {
        const error = targetCategoryConditionError(condition.detail, draft.eventSource.eventType);
        if (error) pushError(nestedErrors, `conditionGroups[${groupIndex}].conditions[${conditionIndex}].detail.categories`, error);
      }
      if (condition.conditionType === 'EVENT_VALUE_COMPARE') {
        if (!allowedValues.includes(condition.detail.eventValueKey)) {
          pushError(
            nestedErrors,
            `conditionGroups[${groupIndex}].conditions[${conditionIndex}].detail.eventValueKey`,
            '当前事件不提供该事件值。'
          );
        }
      }
      if (
        (condition.conditionType === 'ATTRIBUTE_COMPARE' || condition.conditionType === 'STATUS_CHECK')
        && condition.detail.subject === 'EVENT_SOURCE'
        && !hasEventSource
      ) {
        pushError(
          nestedErrors,
          `conditionGroups[${groupIndex}].conditions[${conditionIndex}].detail.subject`,
          '当前事件不提供事件来源对象。'
        );
      }
      if (
        condition.conditionType === 'STATUS_CHECK'
        && (condition.detail.checkKind === 'STACKS_COMPARE' || condition.detail.checkKind === 'REMAINING_MS_COMPARE')
        && (!condition.detail.sourceEffectKey || !condition.detail.sourceResultKey)
      ) {
        pushError(
          nestedErrors,
          `conditionGroups[${groupIndex}].conditions[${conditionIndex}].detail.sourceEffectKey`,
          '层数或剩余时间必须选择生命周期效果和状态施加结果。'
        );
      }
    }
  }

  const sortedActions = sortActionDrafts(draft.actions);
  if (sortedActions.length === 0) fieldErrors.actions = '规则至少包含一个动作。';
  const failCount = sortedActions.filter((item) => item.actionType === 'FAIL_PROCESS').length;
  if (failCount > 1) fieldErrors.actions = '同一规则只能有一个令过程失败动作。';
  if (!isFailProcessLast(sortedActions)) fieldErrors.actions = SKILL_TRIGGER_FAIL_PROCESS_LAST_MESSAGE;

  const actionKeys = new Set<string>();
  for (let actionIndex = 0; actionIndex < sortedActions.length; actionIndex += 1) {
    const action = sortedActions[actionIndex];
    const keyError = validateKey(action.actionKey, '动作标识');
    if (keyError) pushError(nestedErrors, `actions[${actionIndex}].actionKey`, keyError);
    if (actionKeys.has(action.actionKey.trim())) {
      pushError(nestedErrors, `actions[${actionIndex}].actionKey`, '动作标识不能重复。');
    }
    actionKeys.add(action.actionKey.trim());
    if (!action.name.trim()) pushError(nestedErrors, `actions[${actionIndex}].name`, '动作名称不能为空。');
    if (action.actionType !== 'FAIL_PROCESS' && action.targetContext === 'EVENT_SOURCE' && !hasEventSource) {
      pushError(nestedErrors, `actions[${actionIndex}].targetContext`, '当前事件不提供事件来源对象。');
    }
    if (action.actionType === 'FAIL_PROCESS' && action.targetContext !== null) {
      pushError(nestedErrors, `actions[${actionIndex}].targetContext`, '令过程失败不能选择目标对象。');
    }
    const bindingKeys = new Set<string>();
    const parameterKeys = new Set<string>();
    for (let bindingIndex = 0; bindingIndex < action.runtimeInputBindings.length; bindingIndex += 1) {
      const binding = action.runtimeInputBindings[bindingIndex];
      const bindingKeyError = validateKey(binding.bindingKey, '绑定标识');
      if (bindingKeyError) {
        pushError(nestedErrors, `actions[${actionIndex}].runtimeInputBindings[${bindingIndex}].bindingKey`, bindingKeyError);
      }
      if (bindingKeys.has(binding.bindingKey.trim())) {
        pushError(nestedErrors, `actions[${actionIndex}].runtimeInputBindings[${bindingIndex}].bindingKey`, '绑定标识不能重复。');
      }
      bindingKeys.add(binding.bindingKey.trim());
      if (parameterKeys.has(binding.parameterKey)) {
        pushError(nestedErrors, `actions[${actionIndex}].runtimeInputBindings[${bindingIndex}].parameterKey`, '同一参数不能重复绑定。');
      }
      parameterKeys.add(binding.parameterKey);
      if (binding.sourceType === 'SOURCE_CAST_RESOURCE_COST') {
        const reachable = reachableRuntimeInputParameters(collectActionValues(action, options), options.formulasByKey ?? new Map(), options.parameters ?? []);
        const error = sourceCastResourceCostError(binding, draft.eventSource, reachable, options.attributes ?? [], options.catalogStates?.attributes);
        if (error) pushError(nestedErrors, `actions[${actionIndex}].runtimeInputBindings[${bindingIndex}]`, error);
      }
      if (binding.sourceType === 'EVENT_VALUE' && !allowedValues.includes(binding.detail.eventValueKey)) {
        pushError(
          nestedErrors,
          `actions[${actionIndex}].runtimeInputBindings[${bindingIndex}].detail.eventValueKey`,
          '当前事件不提供该事件值。'
        );
      }
      if (binding.sourceType === 'PRIOR_ACTION_RESULT') {
        if (!isAllowedPriorResultOutputKind(binding.detail.outputKind)) {
          pushError(
            nestedErrors,
            `actions[${actionIndex}].runtimeInputBindings[${bindingIndex}].detail.outputKind`,
            '前序结果输出种类不合法。'
          );
        }
        const legality = isLegalPriorResultBinding(
          binding,
          sortedActions,
          actionIndex,
          options.effectsByKey ?? new Map()
        );
        if (!legality.ok && legality.reason === 'missing-effect') {
          pushError(
            nestedErrors,
            `actions[${actionIndex}].runtimeInputBindings[${bindingIndex}].detail.sourceActionKey`,
            SKILL_TRIGGER_SOURCE_EFFECT_LOAD_MESSAGE
          );
        } else if (!legality.ok) {
          pushError(
            nestedErrors,
            `actions[${actionIndex}].runtimeInputBindings[${bindingIndex}].detail.sourceActionKey`,
            '前序结果必须来自更早的执行效果动作及其即时合法输出。'
          );
        }
      }
    }
    if (action.actionType === 'EXECUTE_EFFECT') {
      const modifierKeys = new Set<string>();
      for (let modifierIndex = 0; modifierIndex < action.resultModifiers.length; modifierIndex += 1) {
        const modifier = action.resultModifiers[modifierIndex];
        if (modifierKeys.has(modifier.resultKey)) {
          pushError(nestedErrors, `actions[${actionIndex}].resultModifiers[${modifierIndex}].resultKey`, '同一结果不能重复修正。');
        }
        modifierKeys.add(modifier.resultKey);
        const modifierError = validateResultModifier(modifier);
        if (modifierError) {
          pushError(nestedErrors, `actions[${actionIndex}].resultModifiers[${modifierIndex}]`, modifierError);
        }
      }
    } else if (action.resultModifiers.length > 0) {
      pushError(nestedErrors, `actions[${actionIndex}].resultModifiers`, '只有执行效果可以配置结果修正。');
    }
    const reflected = action.actionType === 'EXECUTE_EFFECT'
      ? effectHasReflectedDamage(options.effectsByKey?.get(action.detail.effectKey))
      : action.actionType === 'START_PROCESS'
        ? processHasReflectedDamage(
            options.processesByKey?.get(action.detail.processKey),
            options.effectsByKey
          )
        : false;
    if (reflected) {
      if (
        draft.eventSource.eventType !== 'DAMAGE_PENDING'
        && draft.eventSource.eventType !== 'DAMAGE_TAKEN'
      ) {
        pushError(nestedErrors, 'eventSource.eventType', '反伤效果只能由即将受到伤害或受到伤害事件触发。');
      }
      if (action.targetContext !== 'EVENT_SOURCE') {
        pushError(
          nestedErrors,
          `actions[${actionIndex}].targetContext`,
          '反伤效果必须作用于事件来源对象。'
        );
      }
      const directOnly = (
        draft.eventSource.eventType === 'DAMAGE_PENDING'
        || draft.eventSource.eventType === 'DAMAGE_TAKEN'
      )
        && draft.eventSource.detail.originKind === 'DIRECT';
      if (!directOnly && !draft.perTargetCooldownEnabled) {
        pushError(
          nestedErrors,
          'eventSource.detail.originKind',
          '反伤规则必须只接收直接伤害，或配置每目标冷却。'
        );
      }
    }
    if (action.actionType !== 'FAIL_PROCESS' && options.parameters && options.effectsByKey) {
      const reachable = reachableRuntimeInputParameters(
        collectActionValues(action, options), options.formulasByKey ?? new Map(), options.parameters
      );
      const completeness = evaluateBindingCompleteness(reachable, action.runtimeInputBindings);
      if (completeness.some((item) => item.missing || item.extra || item.duplicate || item.typeCompatible === false)) {
        pushError(nestedErrors, `actions[${actionIndex}].runtimeInputBindings`, '动态输入绑定必须与可达参数完全一致且类型兼容。');
      }
    }
  }

  if (draft.perTargetCooldownEnabled) {
    if (!draft.perTargetCooldownDurationValue) {
      fieldErrors.perTargetCooldown = '每目标冷却取值不能为空。';
    }
    if (draft.perTargetCooldownTargetContext === 'EVENT_SOURCE' && !hasEventSource) {
      fieldErrors.perTargetCooldown = '当前事件不提供事件来源对象。';
    }
  }
  if (draft.maxTriggersPerProcessEnabled) {
    if (draft.eventSource.eventType !== 'PROCESS_MOMENT') {
      fieldErrors.maxTriggersPerProcess = '单次过程最大触发次数仅用于过程时点事件。';
    } else if (!draft.maxTriggersLimitValue) {
      fieldErrors.maxTriggersPerProcess = '次数取值不能为空。';
    }
  }

  const checkValue = (value: NumericValue | null, path: string, limits: { min?: number; integer?: boolean; exclusiveMin?: boolean } = {}) => {
    const error = numericValueError(value, { parameters: options.parameters, formulas: options.formulasByKey ? [...options.formulasByKey.values()] : undefined }, { ...limits, allowRuntimeInput: false,
      parametersState: options.catalogStates?.parameters === 'error' ? 'failed' : undefined,
      formulasState: options.catalogStates?.formulas === 'error' ? 'failed' : undefined });
    if (error) pushError(nestedErrors, path, error);
  };
  if (draft.eventSource.eventType === 'HEALTH_THRESHOLD_CROSSED') checkValue(draft.eventSource.detail.thresholdValue, 'eventSource.detail.thresholdValue');
  for (const [gi, group] of sortedGroups.entries()) for (const [ci, condition] of sortConditionDrafts(group.conditions).entries()) {
    if (condition.conditionType === 'TARGET_CATEGORY_CHECK') continue;
    const detail = condition.detail;
    if (detail.comparator !== null) checkValue(detail.comparisonValue, `conditionGroups[${gi}].conditions[${ci}].detail.comparisonValue`, condition.conditionType === 'LIFECYCLE_CHECK' ? { min: 0, integer: true } : {});
  }
  if (draft.perTargetCooldownEnabled) checkValue(draft.perTargetCooldownDurationValue, 'perTargetCooldown.durationValue', { min: 0, exclusiveMin: true });
  if (draft.maxTriggersPerProcessEnabled) checkValue(draft.maxTriggersLimitValue, 'maxTriggersPerProcess.limitValue', { min: 1, integer: true });

  if (options.formulasByKey && options.parameters) {
    for (const formulaKey of collectDirectFormulaKeys(draft)) {
      if (formulaHasRuntimeInput(options.formulasByKey.get(formulaKey), options.parameters)) {
        nestedErrors.push({
          path: 'formulas',
          message: `公式 ${formulaKey} 不能引用计算时传入参数。`
        });
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0 || nestedErrors.length > 0) {
    return { ok: false, fieldErrors, nestedErrors };
  }
  return { ok: true, normalized: toCreateRequest(draft) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function issueMessage(raw: Record<string, unknown>): string {
  return typeof raw.message === 'string' && raw.message.trim()
    ? raw.message.trim()
    : '字段值不合法。';
}

function assignBasicField(
  fieldErrors: SkillTriggerDraftErrors,
  field: string,
  message: string
): boolean {
  if (
    field === 'ruleKey'
    || field === 'name'
    || field === 'description'
    || field === 'sortOrder'
    || field === 'eventSource'
    || field === 'conditionGroups'
    || field === 'actions'
  ) {
    fieldErrors[field] = message;
    return true;
  }
  if (field.startsWith('perTargetCooldown')) {
    fieldErrors.perTargetCooldown = message;
    return true;
  }
  if (field.startsWith('maxTriggersPerProcess')) {
    fieldErrors.maxTriggersPerProcess = message;
    return true;
  }
  if (field.startsWith('eventSource')) {
    fieldErrors.eventSource = message;
    return true;
  }
  return false;
}

export function mapTriggerFieldIssues(source: unknown): MappedTriggerFieldIssues {
  const fieldErrors: SkillTriggerDraftErrors = {};
  const nestedErrors: NestedFieldError[] = [];
  const unmappedMessages: string[] = [];
  let retainedCode: string | null = null;
  let retainedMessage: string | null = null;
  let retainedDetails: Record<string, unknown> | null = null;
  let details: unknown;
  if (source instanceof ApiRequestError) {
    retainedCode = source.code ?? null;
    retainedMessage = source.message;
    retainedDetails = source.details ?? null;
    details = source.details;
  } else if (isRecord(source) && 'details' in source) {
    details = source.details;
    retainedDetails = isRecord(source.details) ? source.details : null;
  } else {
    details = source;
  }

  const cycle = retainedCode === '400.TRIGGER_RULE_CYCLE_UNGUARDED'
    ? {
        message: SKILL_TRIGGER_CYCLE_MESSAGE,
        hint: SKILL_TRIGGER_CYCLE_HINT,
        pathItems: cyclePathItems(retainedDetails)
      }
    : null;

  if (!isRecord(details) || !Array.isArray(details.fieldIssues)) {
    if (retainedMessage && !cycle) unmappedMessages.push(retainedMessage);
    return {
      fieldErrors,
      nestedErrors,
      unmappedMessages,
      retainedCode,
      retainedMessage,
      retainedDetails,
      cycle
    };
  }

  for (const rawIssue of details.fieldIssues) {
    if (!isRecord(rawIssue)) continue;
    const field = typeof rawIssue.field === 'string' ? rawIssue.field : '';
    const message = issueMessage(rawIssue);
    if (!field) {
      unmappedMessages.push(message);
      continue;
    }
    if (assignBasicField(fieldErrors, field, message)) continue;
    if (
      /^(eventSource|conditionGroups\[\d+\]|actions\[\d+\]|perTargetCooldown|maxTriggersPerProcess)/.test(field)
    ) {
      nestedErrors.push({ path: field, message });
      continue;
    }
    unmappedMessages.push(message);
  }

  return {
    fieldErrors,
    nestedErrors,
    unmappedMessages,
    retainedCode,
    retainedMessage,
    retainedDetails,
    cycle
  };
}

export function cyclePathItems(details: Record<string, unknown> | null): TriggerCyclePathItem[] {
  if (!details) return [];
  const items: TriggerCyclePathItem[] = [];
  const path = details.cyclePath;
  if (Array.isArray(path)) {
    for (const item of path) {
      if (typeof item === 'string') items.push({ ruleKey: item });
    }
  }
  if (typeof details.ruleKey === 'string') {
    const produced = isRecord(details.producedEvent) ? details.producedEvent : undefined;
    const existing = items.find((item) => item.ruleKey === details.ruleKey);
    const payload: TriggerCyclePathItem = {
      ruleKey: details.ruleKey,
      actionKey: typeof details.actionKey === 'string' ? details.actionKey : undefined,
      producedEvent: produced
    };
    if (existing) {
      existing.actionKey = payload.actionKey;
      existing.producedEvent = produced;
    } else {
      items.unshift(payload);
    }
  }
  return items;
}

export function formatCyclePath(
  items: readonly TriggerCyclePathItem[],
  namesByRuleKey: ReadonlyMap<string, string>
): string[] {
  return items.map((item) => {
    const name = namesByRuleKey.get(item.ruleKey);
    const label = name ? `${name}（${item.ruleKey}）` : item.ruleKey;
    const action = item.actionKey ? ` / ${item.actionKey}` : '';
    return `${label}${action}`;
  });
}

export function nestedErrorFor(pathPrefix: string, errors: readonly NestedFieldError[]): string | undefined {
  return errors.find((item) => item.path === pathPrefix || item.path.startsWith(`${pathPrefix}.`))?.message;
}

export function attributeValueKinds(): FormulaAttributeValueKind[] {
  return [...FORMULA_ATTRIBUTE_VALUE_KINDS];
}

export function processMomentLabel(moment: SkillProcessMoment): string {
  const typeLabel = SKILL_PROCESS_MOMENT_TYPE_LABELS[moment.momentType];
  if (isProcessLevelMoment(moment.momentType)) return typeLabel;
  return `${typeLabel} / ${moment.stepKey}`;
}

export function internalStateTypeLabel(stateType: SkillInternalStateType): string {
  return SKILL_INTERNAL_STATE_TYPE_LABELS[stateType];
}

export function eventFieldDescriptors(eventType: SkillTriggerEventType): readonly string[] {
  return SKILL_TRIGGER_EVENT_CAPABILITIES[eventType].detailFields;
}
