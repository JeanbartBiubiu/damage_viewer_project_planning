import { ApiRequestError } from '../../../../services/apiClient';
import type { Attribute } from '../../../../types/attribute';
import type { DamageType } from '../../../../types/damageType';
import type { Skill } from '../../../../types/skill';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type {
  AttributeChangeOperation,
  CooldownChangeOperation,
  CreateSkillEffectRequest,
  ResourceChangeOperation,
  SkillEffect,
  SkillEffectExpiryMode,
  SkillEffectFirstPeriodicExecution,
  SkillEffectLifecycle,
  SkillEffectLifecycleInstanceScope,
  SkillEffectLifecycleMoment,
  SkillEffectLifecycleOperation,
  SkillEffectPeriodicExecutionMode,
  SkillEffectReapplicationDurationMode,
  SkillEffectReapplicationStackMode,
  SkillEffectReapplicationValueMode,
  SkillEffectResult,
  SkillEffectResultLifecycleBehavior,
  SkillEffectResultRequest,
  SkillEffectResultType,
  SkillEffectStackValueMode,
  SkillEffectSummary,
  SkillEffectTarget,
  SkillEffectValueReadMode,
  SkillEffectValueRule,
  StatusOperation,
  UpdateSkillEffectRequest
} from '../../../../types/skillEffect';
import type { GameStatus } from '../../../../types/status';

export const SKILL_EFFECT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const SKILL_EFFECT_RESULT_TYPES = [
  'DAMAGE',
  'DIRECT_HEAL',
  'NORMAL_SHIELD',
  'ATTRIBUTE_CHANGE',
  'RESOURCE_CHANGE',
  'COOLDOWN_CHANGE',
  'STATUS_OPERATION',
  'LIFECYCLE_OPERATION'
] as const satisfies readonly SkillEffectResultType[];

export const SKILL_EFFECT_RESULT_TYPE_LABELS = {
  DAMAGE: '伤害',
  DIRECT_HEAL: '直接治疗',
  NORMAL_SHIELD: '普通护盾',
  ATTRIBUTE_CHANGE: '属性变化',
  RESOURCE_CHANGE: '资源变化',
  COOLDOWN_CHANGE: '冷却变化',
  STATUS_OPERATION: '状态操作',
  LIFECYCLE_OPERATION: '生命周期操作'
} as const satisfies { [K in SkillEffectResultType]: string };

export const SKILL_EFFECT_TARGET_LABELS = {
  SOURCE: '施法者',
  TARGET: '当前目标'
} as const satisfies { [K in SkillEffectTarget]: string };

export const ATTRIBUTE_CHANGE_OPERATION_LABELS = {
  INCREASE: '增加',
  DECREASE: '减少',
  SET: '覆盖'
} as const satisfies { [K in AttributeChangeOperation]: string };

export const RESOURCE_CHANGE_OPERATION_LABELS = {
  RESTORE: '恢复',
  CONSUME: '扣除',
  REFUND: '返还'
} as const satisfies { [K in ResourceChangeOperation]: string };

export const COOLDOWN_CHANGE_OPERATION_LABELS = {
  REDUCE: '减少',
  INCREASE: '增加',
  RESET: '重置为可用'
} as const satisfies { [K in CooldownChangeOperation]: string };

export const STATUS_OPERATION_LABELS = {
  APPLY: '施加',
  REMOVE: '移除'
} as const satisfies { [K in StatusOperation]: string };

export const SKILL_EFFECT_INSTANCE_SCOPE_LABELS = {
  SKILL: '当前技能',
  SOURCE: '按来源对象',
  TARGET: '按承受对象',
  SOURCE_TARGET: '按来源与承受对象'
} as const satisfies { [K in SkillEffectLifecycleInstanceScope]: string };

export const SKILL_EFFECT_REAPPLICATION_STACK_MODE_LABELS = {
  KEEP: '保留层数',
  INCREASE: '增加层数',
  REPLACE: '覆盖层数'
} as const satisfies { [K in SkillEffectReapplicationStackMode]: string };

export const SKILL_EFFECT_REAPPLICATION_DURATION_MODE_LABELS = {
  REFRESH_ALL: '刷新全部时间',
  KEEP_REMAINING: '保留剩余时间',
  INDEPENDENT: '独立计时'
} as const satisfies { [K in SkillEffectReapplicationDurationMode]: string };

export const SKILL_EFFECT_EXPIRY_MODE_LABELS = {
  ALL_AT_ONCE: '一次全部到期',
  ONE_BY_ONE: '逐层到期',
  INDEPENDENT: '独立到期',
  EXPLICIT_ONLY: '仅显式移除'
} as const satisfies { [K in SkillEffectExpiryMode]: string };

export const SKILL_EFFECT_FIRST_PERIODIC_EXECUTION_LABELS = {
  IMMEDIATE: '立即',
  AFTER_INTERVAL: '等待一个间隔'
} as const satisfies { [K in SkillEffectFirstPeriodicExecution]: string };

export const SKILL_EFFECT_LIFECYCLE_MOMENT_LABELS = {
  APPLICATION: '施加时',
  PERSISTENT: '持续生效',
  FULL_STACKS: '达到满层',
  PERIODIC: '每次周期',
  NATURAL_END: '自然结束',
  EARLY_REMOVE: '提前移除'
} as const satisfies { [K in SkillEffectLifecycleMoment]: string };

export const SKILL_EFFECT_VALUE_READ_MODE_LABELS = {
  APPLICATION_SNAPSHOT: '施加时留存',
  MOMENT_EVALUATION: '到当前时点重新读取'
} as const satisfies { [K in SkillEffectValueReadMode]: string };

export const SKILL_EFFECT_STACK_VALUE_MODE_LABELS = {
  SHARED: '整个实例共享数值',
  PER_STACK: '每层分别贡献数值'
} as const satisfies { [K in SkillEffectStackValueMode]: string };

export const SKILL_EFFECT_REAPPLICATION_VALUE_MODE_LABELS = {
  KEEP: '保留',
  REPLACE: '覆盖',
  ADD: '相加'
} as const satisfies { [K in SkillEffectReapplicationValueMode]: string };

export const SKILL_EFFECT_PERIODIC_EXECUTION_MODE_LABELS = {
  ONCE_PER_INSTANCE: '每个生命周期实例执行一次',
  ONCE_PER_ACTIVE_STACK: '按当前有效层分别执行'
} as const satisfies { [K in SkillEffectPeriodicExecutionMode]: string };

export const SKILL_EFFECT_LIFECYCLE_OPERATION_LABELS = {
  INCREASE: '增加',
  DECREASE: '减少',
  SET: '覆盖',
  REFRESH: '刷新',
  CONSUME: '消耗',
  REMOVE: '移除'
} as const satisfies { [K in SkillEffectLifecycleOperation]: string };

export const COOLDOWN_CHANGE_AMOUNT_HINT = '变化量按毫秒解释';
export const DISABLED_CATALOG_LABEL = '已停用';
export const DISABLED_PARENT_SKILL_LABEL = '当前技能（已停用）';
export const INCOMPLETE_CATALOG_MESSAGE = '目录不完整，无法保存未知引用。';
export const DISABLED_CATALOG_MESSAGE = '不能选择已停用的目录项。';
export const UNKNOWN_LIFECYCLE_TARGET_LABEL = '未知目标';
export const LIFECYCLE_PENDING_BEHAVIOR_LABEL = '待配置';
export const SKILL_EFFECT_LIFECYCLE_IN_USE_MESSAGE = '该效果正在被其他效果的生命周期操作引用，不能删除。';

export const SKILL_EFFECT_LIFECYCLE_OPERATIONS = [
  'INCREASE',
  'DECREASE',
  'SET',
  'REFRESH',
  'CONSUME',
  'REMOVE'
] as const satisfies readonly SkillEffectLifecycleOperation[];

export type SkillEffectLifecycleDraft = {
  durationFormulaKey: string;
  maxStacksFormulaKey: string;
  applicationStacksFormulaKey: string;
  instanceScope: SkillEffectLifecycleInstanceScope | '';
  reapplicationStackMode: SkillEffectReapplicationStackMode | '';
  reapplicationDurationMode: SkillEffectReapplicationDurationMode | '';
  expiryMode: SkillEffectExpiryMode | '';
  periodicIntervalFormulaKey: string;
  firstPeriodicExecution: SkillEffectFirstPeriodicExecution | '';
};

export type SkillEffectResultLifecycleBehaviorDraft = {
  moment: SkillEffectLifecycleMoment | '';
  valueReadMode: SkillEffectValueReadMode | '';
  stackValueMode: SkillEffectStackValueMode | '';
  reapplicationValueMode: SkillEffectReapplicationValueMode | '';
  periodicExecutionMode: SkillEffectPeriodicExecutionMode | '';
};

export type SkillEffectResultDraft = {
  resultKey: string;
  name: string;
  resultType: SkillEffectResultType;
  target: SkillEffectTarget;
  description: string;
  sortOrder: string;
  formulaKey: string;
  fixedMultiplier: string;
  fixedMinValue: string;
  fixedMaxValue: string;
  damageTypeKey: string;
  attributeKey: string;
  attributeOperation: AttributeChangeOperation | '';
  resourceOperation: ResourceChangeOperation | '';
  affectedSkillKey: string;
  cooldownOperation: CooldownChangeOperation | '';
  statusKey: string;
  statusOperation: StatusOperation | '';
  targetEffectKey: string;
  lifecycleOperation: SkillEffectLifecycleOperation | '';
  lifecycleBehavior: SkillEffectResultLifecycleBehaviorDraft;
  originalResultType: SkillEffectResultType | null;
  originalDamageTypeKey: string | null;
  originalAttributeKey: string | null;
  originalAffectedSkillKey: string | null;
  originalStatusKey: string | null;
  originalTargetEffectKey: string | null;
};

export type SkillEffectDraft = {
  effectKey: string;
  name: string;
  description: string;
  sortOrder: string;
  lifecycleEnabled: boolean;
  lifecycle: SkillEffectLifecycleDraft;
  originalLifecycleEnabled: boolean;
  originalInstanceScope: SkillEffectLifecycleInstanceScope | '';
  results: SkillEffectResultDraft[];
};

export type SkillEffectDraftField =
  | 'effectKey'
  | 'name'
  | 'description'
  | 'sortOrder'
  | 'results'
  | 'lifecycle'
  | 'durationFormulaKey'
  | 'maxStacksFormulaKey'
  | 'applicationStacksFormulaKey'
  | 'instanceScope'
  | 'reapplicationStackMode'
  | 'reapplicationDurationMode'
  | 'expiryMode'
  | 'periodicIntervalFormulaKey'
  | 'firstPeriodicExecution';

export type SkillEffectResultDraftField =
  | 'resultKey'
  | 'name'
  | 'resultType'
  | 'target'
  | 'description'
  | 'sortOrder'
  | 'formulaKey'
  | 'fixedMultiplier'
  | 'fixedMinValue'
  | 'fixedMaxValue'
  | 'valueRule'
  | 'damageTypeKey'
  | 'attributeKey'
  | 'attributeOperation'
  | 'resourceOperation'
  | 'affectedSkillKey'
  | 'cooldownOperation'
  | 'statusKey'
  | 'statusOperation'
  | 'targetEffectKey'
  | 'lifecycleOperation'
  | 'detail'
  | 'lifecycleBehavior'
  | 'moment'
  | 'valueReadMode'
  | 'stackValueMode'
  | 'reapplicationValueMode'
  | 'periodicExecutionMode';

export type SkillEffectDraftErrors = {
  [K in SkillEffectDraftField]?: string;
};

export type SkillEffectResultDraftErrors = {
  [K in SkillEffectResultDraftField]?: string;
};

export type SkillEffectResultIndexError = {
  index: number;
  fieldErrors: SkillEffectResultDraftErrors;
};

export type NormalizedSkillEffectForm = {
  effectKey: string;
  name: string;
  description: string | null;
  sortOrder: number;
  lifecycle: SkillEffectLifecycle | null;
  results: SkillEffectResultRequest[];
};

export type SkillEffectFormValidation =
  | { ok: true; normalized: NormalizedSkillEffectForm }
  | {
      ok: false;
      fieldErrors: SkillEffectDraftErrors;
      resultErrors: SkillEffectResultIndexError[];
    };

export type EffectCatalogLoadState = {
  formulas?: 'ready' | 'failed';
  effects?: 'ready' | 'failed';
  damageTypes?: 'ready' | 'failed';
  attributes?: 'ready' | 'failed';
  skills?: 'ready' | 'failed';
  statuses?: 'ready' | 'failed';
};

export type EffectFormCatalog = {
  parentSkillKey: string;
  parentEffectKey?: string;
  formulas: ReadonlyArray<Pick<SkillFormulaSummary, 'formulaKey'>>;
  effects: ReadonlyArray<Pick<SkillEffectSummary, 'effectKey' | 'name' | 'lifecycleEnabled'>>;
  damageTypes: ReadonlyArray<Pick<DamageType, 'damageTypeKey' | 'status'>>;
  attributes: ReadonlyArray<Pick<Attribute, 'attributeKey' | 'status'>>;
  skills: ReadonlyArray<Pick<Skill, 'skillKey' | 'status'>>;
  statuses: ReadonlyArray<Pick<GameStatus, 'statusKey' | 'status'>>;
};

export type SkillEffectFormValidationOptions = {
  includeEffectKey: boolean;
  catalog?: EffectFormCatalog | null;
  catalogLoadState?: EffectCatalogLoadState | null;
  skipLifecycleShapeValidation?: boolean;
};

export type CatalogRefOption = {
  key: string;
  status: 'ENABLED' | 'DISABLED' | null;
  source: 'enabled' | 'retained-disabled' | 'parent-skill-self-ref' | 'unknown';
};

export type MappedSkillEffectFieldIssues = {
  fieldErrors: SkillEffectDraftErrors;
  resultErrors: SkillEffectResultIndexError[];
  unmappedMessages: string[];
};

const EFFECT_DRAFT_FIELDS = new Set<SkillEffectDraftField>([
  'effectKey',
  'name',
  'description',
  'sortOrder',
  'results',
  'lifecycle',
  'durationFormulaKey',
  'maxStacksFormulaKey',
  'applicationStacksFormulaKey',
  'instanceScope',
  'reapplicationStackMode',
  'reapplicationDurationMode',
  'expiryMode',
  'periodicIntervalFormulaKey',
  'firstPeriodicExecution'
]);

const LIFECYCLE_FIELD_BY_PATH: { [path: string]: SkillEffectDraftField } = {
  lifecycle: 'lifecycle',
  'lifecycle.durationFormulaKey': 'durationFormulaKey',
  'lifecycle.maxStacksFormulaKey': 'maxStacksFormulaKey',
  'lifecycle.applicationStacksFormulaKey': 'applicationStacksFormulaKey',
  'lifecycle.instanceScope': 'instanceScope',
  'lifecycle.reapplicationStackMode': 'reapplicationStackMode',
  'lifecycle.reapplicationDurationMode': 'reapplicationDurationMode',
  'lifecycle.expiryMode': 'expiryMode',
  'lifecycle.periodicIntervalFormulaKey': 'periodicIntervalFormulaKey',
  'lifecycle.firstPeriodicExecution': 'firstPeriodicExecution'
};

const RESULT_FIELD_BY_PATH: { [path: string]: SkillEffectResultDraftField } = {
  resultKey: 'resultKey',
  name: 'name',
  resultType: 'resultType',
  target: 'target',
  description: 'description',
  sortOrder: 'sortOrder',
  valueRule: 'valueRule',
  'valueRule.formulaKey': 'formulaKey',
  'valueRule.fixedMultiplier': 'fixedMultiplier',
  'valueRule.fixedMinValue': 'fixedMinValue',
  'valueRule.fixedMaxValue': 'fixedMaxValue',
  detail: 'detail',
  'detail.damageTypeKey': 'damageTypeKey',
  'detail.attributeKey': 'attributeKey',
  'detail.affectedSkillKey': 'affectedSkillKey',
  'detail.statusKey': 'statusKey',
  'detail.targetEffectKey': 'targetEffectKey',
  lifecycleBehavior: 'lifecycleBehavior',
  'lifecycleBehavior.moment': 'moment',
  'lifecycleBehavior.valueReadMode': 'valueReadMode',
  'lifecycleBehavior.stackValueMode': 'stackValueMode',
  'lifecycleBehavior.reapplicationValueMode': 'reapplicationValueMode',
  'lifecycleBehavior.periodicExecutionMode': 'periodicExecutionMode'
};

const INDEXED_RESULT_PATH = /^results\[(\d+)\](?:\.(.*))?$/;

export function createEmptyLifecycleDraft(): SkillEffectLifecycleDraft {
  return {
    durationFormulaKey: '',
    maxStacksFormulaKey: '',
    applicationStacksFormulaKey: '',
    instanceScope: '',
    reapplicationStackMode: '',
    reapplicationDurationMode: '',
    expiryMode: '',
    periodicIntervalFormulaKey: '',
    firstPeriodicExecution: ''
  };
}

export function createEmptyLifecycleBehaviorDraft(): SkillEffectResultLifecycleBehaviorDraft {
  return {
    moment: '',
    valueReadMode: '',
    stackValueMode: '',
    reapplicationValueMode: '',
    periodicExecutionMode: ''
  };
}

export function createEmptyEffectDraft(): SkillEffectDraft {
  return {
    effectKey: '',
    name: '',
    description: '',
    sortOrder: '0',
    lifecycleEnabled: false,
    lifecycle: createEmptyLifecycleDraft(),
    originalLifecycleEnabled: false,
    originalInstanceScope: '',
    results: []
  };
}

export function createEmptyResultDraft(
  resultType: SkillEffectResultType = 'DAMAGE'
): SkillEffectResultDraft {
  return clearHiddenResultFields({
    resultKey: '',
    name: '',
    resultType,
    target: 'TARGET',
    description: '',
    sortOrder: '0',
    formulaKey: '',
    fixedMultiplier: requiresValueRule(resultType, defaultCooldownOperation(resultType)) ? '1' : '',
    fixedMinValue: '',
    fixedMaxValue: '',
    damageTypeKey: '',
    attributeKey: '',
    attributeOperation: resultType === 'ATTRIBUTE_CHANGE' ? 'INCREASE' : '',
    resourceOperation: resultType === 'RESOURCE_CHANGE' ? 'RESTORE' : '',
    affectedSkillKey: '',
    cooldownOperation: defaultCooldownOperation(resultType),
    statusKey: '',
    statusOperation: resultType === 'STATUS_OPERATION' ? 'APPLY' : '',
    targetEffectKey: '',
    lifecycleOperation: defaultLifecycleOperation(resultType),
    lifecycleBehavior: createEmptyLifecycleBehaviorDraft(),
    originalResultType: null,
    originalDamageTypeKey: null,
    originalAttributeKey: null,
    originalAffectedSkillKey: null,
    originalStatusKey: null,
    originalTargetEffectKey: null
  });
}

export function skillEffectToDraft(effect: SkillEffect): SkillEffectDraft {
  const lifecycleEnabled = effect.lifecycle !== null;
  return {
    effectKey: effect.effectKey,
    name: effect.name,
    description: effect.description ?? '',
    sortOrder: String(effect.sortOrder),
    lifecycleEnabled,
    lifecycle: lifecycleToDraft(effect.lifecycle),
    originalLifecycleEnabled: lifecycleEnabled,
    originalInstanceScope: effect.lifecycle?.instanceScope ?? '',
    results: effect.results.map(skillEffectResultToDraft)
  };
}

export function skillEffectResultToDraft(result: SkillEffectResult): SkillEffectResultDraft {
  const valueRule = result.valueRule;
  const draft = createEmptyResultDraft(result.resultType);
  draft.resultKey = result.resultKey;
  draft.name = result.name;
  draft.resultType = result.resultType;
  draft.target = result.target;
  draft.description = result.description ?? '';
  draft.sortOrder = String(result.sortOrder);
  draft.originalResultType = result.resultType;
  draft.lifecycleBehavior = lifecycleBehaviorToDraft(result.lifecycleBehavior);
  if (valueRule) {
    draft.formulaKey = valueRule.formulaKey;
    draft.fixedMultiplier = String(valueRule.fixedMultiplier);
    draft.fixedMinValue = valueRule.fixedMinValue === null ? '' : String(valueRule.fixedMinValue);
    draft.fixedMaxValue = valueRule.fixedMaxValue === null ? '' : String(valueRule.fixedMaxValue);
  }
  switch (result.resultType) {
    case 'DAMAGE':
      draft.damageTypeKey = result.detail.damageTypeKey;
      draft.originalDamageTypeKey = result.detail.damageTypeKey;
      break;
    case 'ATTRIBUTE_CHANGE':
      draft.attributeKey = result.detail.attributeKey;
      draft.attributeOperation = result.detail.operation;
      draft.originalAttributeKey = result.detail.attributeKey;
      break;
    case 'RESOURCE_CHANGE':
      draft.attributeKey = result.detail.attributeKey;
      draft.resourceOperation = result.detail.operation;
      draft.originalAttributeKey = result.detail.attributeKey;
      break;
    case 'COOLDOWN_CHANGE':
      draft.affectedSkillKey = result.detail.affectedSkillKey;
      draft.cooldownOperation = result.detail.operation;
      draft.originalAffectedSkillKey = result.detail.affectedSkillKey;
      break;
    case 'STATUS_OPERATION':
      draft.statusKey = result.detail.statusKey;
      draft.statusOperation = result.detail.operation;
      draft.originalStatusKey = result.detail.statusKey;
      break;
    case 'LIFECYCLE_OPERATION':
      draft.targetEffectKey = result.detail.targetEffectKey;
      draft.lifecycleOperation = result.detail.operation;
      draft.originalTargetEffectKey = result.detail.targetEffectKey;
      break;
    case 'DIRECT_HEAL':
    case 'NORMAL_SHIELD':
      break;
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
  return clearHiddenResultFields(draft);
}

export function requiresValueRule(
  resultType: SkillEffectResultType,
  cooldownOperation: CooldownChangeOperation | '' = '',
  lifecycleOperation: SkillEffectLifecycleOperation | '' = ''
): boolean {
  if (resultType === 'STATUS_OPERATION') {
    return false;
  }
  if (resultType === 'COOLDOWN_CHANGE') {
    return cooldownOperation === 'REDUCE' || cooldownOperation === 'INCREASE';
  }
  if (resultType === 'LIFECYCLE_OPERATION') {
    return lifecycleOperation === 'INCREASE'
      || lifecycleOperation === 'DECREASE'
      || lifecycleOperation === 'SET'
      || lifecycleOperation === 'CONSUME';
  }
  return (
    resultType === 'DAMAGE'
    || resultType === 'DIRECT_HEAL'
    || resultType === 'NORMAL_SHIELD'
    || resultType === 'ATTRIBUTE_CHANGE'
    || resultType === 'RESOURCE_CHANGE'
  );
}

export function isValueRuleVisible(draft: SkillEffectResultDraft): boolean {
  return requiresValueRule(draft.resultType, draft.cooldownOperation, draft.lifecycleOperation);
}

export function cooldownChangeAmountHint(draft: SkillEffectResultDraft): string | null {
  if (
    draft.resultType === 'COOLDOWN_CHANGE'
    && (draft.cooldownOperation === 'REDUCE' || draft.cooldownOperation === 'INCREASE')
  ) {
    return COOLDOWN_CHANGE_AMOUNT_HINT;
  }
  return null;
}

export function applyResultTypeChange(
  draft: SkillEffectResultDraft,
  nextType: SkillEffectResultType
): SkillEffectResultDraft {
  const nextCooldown = defaultCooldownOperation(nextType);
  const nextLifecycleOperation = defaultLifecycleOperation(nextType);
  const nextNeeds = requiresValueRule(nextType, nextCooldown, nextLifecycleOperation);
  const prevNeeds = requiresValueRule(draft.resultType, draft.cooldownOperation, draft.lifecycleOperation);
  return clearHiddenResultFields({
    ...draft,
    resultType: nextType,
    formulaKey: nextNeeds && prevNeeds ? draft.formulaKey : '',
    fixedMultiplier: nextNeeds ? (prevNeeds && draft.fixedMultiplier.trim() ? draft.fixedMultiplier : '1') : '',
    fixedMinValue: nextNeeds && prevNeeds ? draft.fixedMinValue : '',
    fixedMaxValue: nextNeeds && prevNeeds ? draft.fixedMaxValue : '',
    damageTypeKey: '',
    attributeKey: '',
    attributeOperation: nextType === 'ATTRIBUTE_CHANGE' ? 'INCREASE' : '',
    resourceOperation: nextType === 'RESOURCE_CHANGE' ? 'RESTORE' : '',
    affectedSkillKey: '',
    cooldownOperation: nextCooldown,
    statusKey: '',
    statusOperation: nextType === 'STATUS_OPERATION' ? 'APPLY' : '',
    targetEffectKey: '',
    lifecycleOperation: nextLifecycleOperation,
    lifecycleBehavior: createEmptyLifecycleBehaviorDraft()
  });
}

export function applyCooldownOperationChange(
  draft: SkillEffectResultDraft,
  nextOperation: CooldownChangeOperation
): SkillEffectResultDraft {
  const nextNeeds = requiresValueRule('COOLDOWN_CHANGE', nextOperation);
  const prevNeeds = requiresValueRule(draft.resultType, draft.cooldownOperation, draft.lifecycleOperation);
  return clearHiddenResultFields({
    ...draft,
    resultType: 'COOLDOWN_CHANGE',
    cooldownOperation: nextOperation,
    formulaKey: nextNeeds && prevNeeds ? draft.formulaKey : '',
    fixedMultiplier: nextNeeds ? (prevNeeds && draft.fixedMultiplier.trim() ? draft.fixedMultiplier : '1') : '',
    fixedMinValue: nextNeeds && prevNeeds ? draft.fixedMinValue : '',
    fixedMaxValue: nextNeeds && prevNeeds ? draft.fixedMaxValue : ''
  });
}

export function applyLifecycleOperationChange(
  draft: SkillEffectResultDraft,
  nextOperation: SkillEffectLifecycleOperation
): SkillEffectResultDraft {
  const nextNeeds = requiresValueRule('LIFECYCLE_OPERATION', '', nextOperation);
  const prevNeeds = requiresValueRule(draft.resultType, draft.cooldownOperation, draft.lifecycleOperation);
  return clearHiddenResultFields({
    ...draft,
    resultType: 'LIFECYCLE_OPERATION',
    lifecycleOperation: nextOperation,
    formulaKey: nextNeeds && prevNeeds ? draft.formulaKey : '',
    fixedMultiplier: nextNeeds ? (prevNeeds && draft.fixedMultiplier.trim() ? draft.fixedMultiplier : '1') : '',
    fixedMinValue: nextNeeds && prevNeeds ? draft.fixedMinValue : '',
    fixedMaxValue: nextNeeds && prevNeeds ? draft.fixedMaxValue : ''
  });
}

export function applyLifecycleMomentChange(
  draft: SkillEffectResultDraft,
  nextMoment: SkillEffectLifecycleMoment | ''
): SkillEffectResultDraft {
  return clearHiddenLifecycleBehaviorFields({
    ...draft,
    lifecycleBehavior: {
      ...draft.lifecycleBehavior,
      moment: nextMoment
    }
  });
}

export function applyStackValueModeChange(
  draft: SkillEffectResultDraft,
  nextMode: SkillEffectStackValueMode | ''
): SkillEffectResultDraft {
  return clearHiddenLifecycleBehaviorFields({
    ...draft,
    lifecycleBehavior: {
      ...draft.lifecycleBehavior,
      stackValueMode: nextMode
    }
  });
}

export function clearHiddenResultFields(draft: SkillEffectResultDraft): SkillEffectResultDraft {
  const needsValue = requiresValueRule(draft.resultType, draft.cooldownOperation, draft.lifecycleOperation);
  return clearHiddenLifecycleBehaviorFields({
    ...draft,
    formulaKey: needsValue ? draft.formulaKey : '',
    fixedMultiplier: needsValue ? (draft.fixedMultiplier === '' ? '1' : draft.fixedMultiplier) : '',
    fixedMinValue: needsValue ? draft.fixedMinValue : '',
    fixedMaxValue: needsValue ? draft.fixedMaxValue : '',
    damageTypeKey: draft.resultType === 'DAMAGE' ? draft.damageTypeKey : '',
    attributeKey:
      draft.resultType === 'ATTRIBUTE_CHANGE' || draft.resultType === 'RESOURCE_CHANGE'
        ? draft.attributeKey
        : '',
    attributeOperation: draft.resultType === 'ATTRIBUTE_CHANGE' ? draft.attributeOperation || 'INCREASE' : '',
    resourceOperation: draft.resultType === 'RESOURCE_CHANGE' ? draft.resourceOperation || 'RESTORE' : '',
    affectedSkillKey: draft.resultType === 'COOLDOWN_CHANGE' ? draft.affectedSkillKey : '',
    cooldownOperation:
      draft.resultType === 'COOLDOWN_CHANGE' ? draft.cooldownOperation || 'REDUCE' : '',
    statusKey: draft.resultType === 'STATUS_OPERATION' ? draft.statusKey : '',
    statusOperation: draft.resultType === 'STATUS_OPERATION' ? draft.statusOperation || 'APPLY' : '',
    targetEffectKey: draft.resultType === 'LIFECYCLE_OPERATION' ? draft.targetEffectKey : '',
    lifecycleOperation:
      draft.resultType === 'LIFECYCLE_OPERATION' ? draft.lifecycleOperation || 'INCREASE' : ''
  });
}

export function clearHiddenLifecycleBehaviorFields(
  draft: SkillEffectResultDraft
): SkillEffectResultDraft {
  const behavior = draft.lifecycleBehavior ?? createEmptyLifecycleBehaviorDraft();
  const moment = behavior.moment;
  const needsValue = requiresValueRule(draft.resultType, draft.cooldownOperation, draft.lifecycleOperation);
  const snapshotOnly = moment === 'APPLICATION' || moment === 'PERSISTENT';
  const showValueRead = needsValue && moment !== '';
  const showStackValue = moment === 'PERSISTENT' && isPersistentNumericResult(draft);
  const showReapplicationValue = showStackValue && behavior.stackValueMode === 'SHARED';
  const showPeriodicExecution = moment === 'PERIODIC';
  let valueReadMode = behavior.valueReadMode;
  if (!showValueRead) {
    valueReadMode = '';
  } else if (snapshotOnly) {
    valueReadMode = 'APPLICATION_SNAPSHOT';
  }
  return {
    ...draft,
    lifecycleBehavior: {
      moment,
      valueReadMode,
      stackValueMode: showStackValue ? behavior.stackValueMode : '',
      reapplicationValueMode: showReapplicationValue ? behavior.reapplicationValueMode : '',
      periodicExecutionMode: showPeriodicExecution ? behavior.periodicExecutionMode : ''
    }
  };
}

export function clearHiddenLifecycleFields(draft: SkillEffectDraft): SkillEffectDraft {
  if (!draft.lifecycleEnabled) {
    return {
      ...draft,
      lifecycle: createEmptyLifecycleDraft(),
      results: draft.results.map((item) => ({
        ...item,
        lifecycleBehavior: createEmptyLifecycleBehaviorDraft()
      }))
    };
  }
  const hasDuration = Boolean(draft.lifecycle.durationFormulaKey.trim());
  const hasPeriodic = draft.results.some((item) => item.lifecycleBehavior.moment === 'PERIODIC');
  let expiryMode = draft.lifecycle.expiryMode;
  let reapplicationDurationMode = draft.lifecycle.reapplicationDurationMode;
  if (!hasDuration) {
    expiryMode = 'EXPLICIT_ONLY';
    reapplicationDurationMode = '';
  } else if (expiryMode === 'EXPLICIT_ONLY') {
    expiryMode = '';
  }
  return {
    ...draft,
    lifecycle: {
      ...draft.lifecycle,
      expiryMode,
      reapplicationDurationMode: hasDuration ? reapplicationDurationMode : '',
      periodicIntervalFormulaKey: hasPeriodic ? draft.lifecycle.periodicIntervalFormulaKey : '',
      firstPeriodicExecution: hasPeriodic ? draft.lifecycle.firstPeriodicExecution : ''
    },
    results: draft.results.map((item) => clearHiddenLifecycleBehaviorFields(item))
  };
}

export function enableLifecycleDraft(draft: SkillEffectDraft): SkillEffectDraft {
  const nextLifecycle = createEmptyLifecycleDraft();
  nextLifecycle.expiryMode = 'EXPLICIT_ONLY';
  if (draft.originalLifecycleEnabled && draft.originalInstanceScope) {
    nextLifecycle.instanceScope = draft.originalInstanceScope;
  }
  return clearHiddenLifecycleFields({
    ...draft,
    lifecycleEnabled: true,
    lifecycle: nextLifecycle
  });
}

export function disableLifecycleDraft(draft: SkillEffectDraft): SkillEffectDraft {
  return clearHiddenLifecycleFields({
    ...draft,
    lifecycleEnabled: false,
    lifecycle: createEmptyLifecycleDraft()
  });
}

export function hasLifecycleDraftContent(draft: SkillEffectDraft): boolean {
  if (draft.lifecycleEnabled) {
    const lifecycle = draft.lifecycle;
    if (
      lifecycle.durationFormulaKey.trim()
      || lifecycle.maxStacksFormulaKey.trim()
      || lifecycle.applicationStacksFormulaKey.trim()
      || lifecycle.instanceScope
      || lifecycle.reapplicationStackMode
      || lifecycle.reapplicationDurationMode
      || (lifecycle.expiryMode && lifecycle.expiryMode !== 'EXPLICIT_ONLY')
      || lifecycle.periodicIntervalFormulaKey.trim()
      || lifecycle.firstPeriodicExecution
    ) {
      return true;
    }
  }
  return draft.results.some((item) => (
    item.lifecycleBehavior.moment
    || item.lifecycleBehavior.valueReadMode
    || item.lifecycleBehavior.stackValueMode
    || item.lifecycleBehavior.reapplicationValueMode
    || item.lifecycleBehavior.periodicExecutionMode
  ));
}

export function applyDurationFormulaChange(
  draft: SkillEffectDraft,
  nextFormulaKey: string
): SkillEffectDraft {
  return clearHiddenLifecycleFields({
    ...draft,
    lifecycle: {
      ...draft.lifecycle,
      durationFormulaKey: nextFormulaKey
    }
  });
}

export function applyReapplicationDurationModeChange(
  draft: SkillEffectDraft,
  nextMode: SkillEffectReapplicationDurationMode | ''
): SkillEffectDraft {
  const nextExpiry = nextMode === 'INDEPENDENT' ? 'INDEPENDENT' : draft.lifecycle.expiryMode;
  return clearHiddenLifecycleFields({
    ...draft,
    lifecycle: {
      ...draft.lifecycle,
      reapplicationDurationMode: nextMode,
      expiryMode: nextExpiry
    }
  });
}

export function applyExpiryModeChange(
  draft: SkillEffectDraft,
  nextMode: SkillEffectExpiryMode | ''
): SkillEffectDraft {
  const nextDurationMode = nextMode === 'INDEPENDENT'
    ? 'INDEPENDENT'
    : draft.lifecycle.reapplicationDurationMode;
  return clearHiddenLifecycleFields({
    ...draft,
    lifecycle: {
      ...draft.lifecycle,
      expiryMode: nextMode,
      reapplicationDurationMode: nextDurationMode
    }
  });
}

export function isInstanceScopeLocked(draft: SkillEffectDraft): boolean {
  return draft.originalLifecycleEnabled;
}

export function hasPeriodicResults(draft: SkillEffectDraft): boolean {
  return draft.results.some((item) => item.lifecycleBehavior.moment === 'PERIODIC');
}

export function hasUnconfiguredLifecycleResults(draft: SkillEffectDraft): boolean {
  return draft.lifecycleEnabled && draft.results.some((item) => !item.lifecycleBehavior.moment);
}

export function isPersistentMomentAllowed(draft: SkillEffectResultDraft): boolean {
  if (draft.resultType === 'NORMAL_SHIELD' || draft.resultType === 'ATTRIBUTE_CHANGE') {
    return true;
  }
  return draft.resultType === 'STATUS_OPERATION' && draft.statusOperation === 'APPLY';
}

export function isPersistentNumericResult(draft: SkillEffectResultDraft): boolean {
  return draft.resultType === 'NORMAL_SHIELD' || draft.resultType === 'ATTRIBUTE_CHANGE';
}

export function isValueReadModeVisible(draft: SkillEffectResultDraft): boolean {
  return isValueRuleVisible(draft) && Boolean(draft.lifecycleBehavior.moment);
}

export function isValueReadModeFixed(draft: SkillEffectResultDraft): boolean {
  const moment = draft.lifecycleBehavior.moment;
  return moment === 'APPLICATION' || moment === 'PERSISTENT';
}

export function isStackValueModeVisible(draft: SkillEffectResultDraft): boolean {
  return draft.lifecycleBehavior.moment === 'PERSISTENT' && isPersistentNumericResult(draft);
}

export function isReapplicationValueModeVisible(draft: SkillEffectResultDraft): boolean {
  return isStackValueModeVisible(draft) && draft.lifecycleBehavior.stackValueMode === 'SHARED';
}

export function isPeriodicExecutionModeVisible(draft: SkillEffectResultDraft): boolean {
  return draft.lifecycleBehavior.moment === 'PERIODIC';
}

export function isAttributeSetPersistent(draft: SkillEffectResultDraft): boolean {
  return draft.resultType === 'ATTRIBUTE_CHANGE'
    && draft.attributeOperation === 'SET'
    && draft.lifecycleBehavior.moment === 'PERSISTENT';
}

export function listAllowedLifecycleMoments(
  draft: SkillEffectResultDraft,
  hasDuration: boolean
): SkillEffectLifecycleMoment[] {
  const moments: SkillEffectLifecycleMoment[] = ['APPLICATION'];
  if (isPersistentMomentAllowed(draft)) {
    moments.push('PERSISTENT');
  }
  moments.push('FULL_STACKS', 'PERIODIC');
  if (hasDuration) {
    moments.push('NATURAL_END');
  }
  moments.push('EARLY_REMOVE');
  if (draft.lifecycleBehavior.moment && !moments.includes(draft.lifecycleBehavior.moment)) {
    moments.push(draft.lifecycleBehavior.moment);
  }
  return moments;
}

export function sortResultDrafts(results: SkillEffectResultDraft[]): SkillEffectResultDraft[] {
  return [...results].sort((left, right) => {
    const leftOrder = Number(left.sortOrder.trim());
    const rightOrder = Number(right.sortOrder.trim());
    const leftValue = Number.isFinite(leftOrder) ? leftOrder : 0;
    const rightValue = Number.isFinite(rightOrder) ? rightOrder : 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
    return left.resultKey.trim().localeCompare(right.resultKey.trim());
  });
}

export function isCatalogOptionSelectable(option: CatalogRefOption): boolean {
  return option.source !== 'unknown';
}

export function listFormulaOptions(
  catalog: EffectFormCatalog,
  currentKey = ''
): CatalogRefOption[] {
  const options: CatalogRefOption[] = catalog.formulas.map((item) => ({
    key: item.formulaKey,
    status: 'ENABLED',
    source: 'enabled'
  }));
  appendUnknownOption(options, currentKey);
  return options;
}

export function listDamageTypeOptions(
  catalog: EffectFormCatalog,
  currentKey = '',
  originalKey: string | null = null
): CatalogRefOption[] {
  return listStatusKeyedOptions(
    catalog.damageTypes.map((item) => ({ key: item.damageTypeKey, status: item.status })),
    currentKey,
    originalKey
  );
}

export function listAttributeOptions(
  catalog: EffectFormCatalog,
  currentKey = '',
  originalKey: string | null = null
): CatalogRefOption[] {
  return listStatusKeyedOptions(
    catalog.attributes.map((item) => ({ key: item.attributeKey, status: item.status })),
    currentKey,
    originalKey
  );
}

export function listStatusOptions(
  catalog: EffectFormCatalog,
  currentKey = '',
  originalKey: string | null = null
): CatalogRefOption[] {
  return listStatusKeyedOptions(
    catalog.statuses.map((item) => ({ key: item.statusKey, status: item.status })),
    currentKey,
    originalKey
  );
}

export function listAffectedSkillOptions(
  catalog: EffectFormCatalog,
  currentKey = '',
  originalKey: string | null = null
): CatalogRefOption[] {
  const options = listStatusKeyedOptions(
    catalog.skills.map((item) => ({ key: item.skillKey, status: item.status })),
    currentKey,
    originalKey,
    catalog.parentSkillKey
  );
  if (!options.some((item) => item.key === catalog.parentSkillKey)) {
    const parent = catalog.skills.find((item) => item.skillKey === catalog.parentSkillKey);
    options.unshift({
      key: catalog.parentSkillKey,
      status: parent?.status ?? 'DISABLED',
      source: parent?.status === 'ENABLED' ? 'enabled' : 'parent-skill-self-ref'
    });
  } else {
    const parentOption = options.find((item) => item.key === catalog.parentSkillKey);
    if (parentOption && parentOption.status === 'DISABLED' && parentOption.source !== 'retained-disabled') {
      parentOption.source = 'parent-skill-self-ref';
    }
  }
  return options;
}

export function listLifecycleTargetOptions(
  catalog: EffectFormCatalog,
  currentKey = '',
  parentEffectKey = ''
): CatalogRefOption[] {
  const excluded = parentEffectKey.trim();
  const options: CatalogRefOption[] = catalog.effects
    .filter((item) => item.lifecycleEnabled && item.effectKey !== excluded)
    .map((item) => ({
      key: item.effectKey,
      status: 'ENABLED' as const,
      source: 'enabled' as const
    }));
  appendUnknownOption(options, currentKey);
  return options;
}

export function validateSkillEffectDraft(
  draft: SkillEffectDraft,
  options: SkillEffectFormValidationOptions
): SkillEffectFormValidation {
  const prepared = clearHiddenLifecycleFields({
    ...draft,
    results: draft.results.map((item) => clearHiddenResultFields(item))
  });
  const fieldErrors: SkillEffectDraftErrors = {};
  const resultErrors: SkillEffectResultIndexError[] = [];
  const effectKey = prepared.effectKey.trim();
  const name = prepared.name.trim();
  const description = prepared.description.trim();

  if (options.includeEffectKey) {
    if (!effectKey) {
      fieldErrors.effectKey = '效果标识不能为空。';
    } else if (!SKILL_EFFECT_KEY_PATTERN.test(effectKey)) {
      fieldErrors.effectKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
    }
  }

  if (!name) {
    fieldErrors.name = '效果名称不能为空。';
  } else if (name.length > 100) {
    fieldErrors.name = '效果名称不能超过 100 个字符。';
  }

  if (description.length > 2000) {
    fieldErrors.description = '说明不能超过 2000 个字符。';
  }

  const sortOrder = parseNonNegativeInteger(prepared.sortOrder, fieldErrors, 'sortOrder');
  if (prepared.results.length === 0) {
    fieldErrors.results = '至少需要一个结果。';
  }

  const hasPeriodic = hasPeriodicResults(prepared);
  const lifecycle = prepared.lifecycleEnabled
    ? (options.skipLifecycleShapeValidation
      ? null
      : validateAndBuildLifecycle(prepared, options, fieldErrors, hasPeriodic))
    : null;
  if (!prepared.lifecycleEnabled && !options.skipLifecycleShapeValidation) {
    validateDisabledLifecycle(prepared, fieldErrors);
  }

  const seenKeys = new Map<string, number>();
  const builtResults: SkillEffectResultRequest[] = [];
  let allResultsValid = prepared.results.length > 0;
  const parentEffectKey = options.catalog?.parentEffectKey?.trim() || effectKey;
  const hasDuration = Boolean(prepared.lifecycle.durationFormulaKey.trim());

  for (let index = 0; index < prepared.results.length; index += 1) {
    const resultFieldErrors: SkillEffectResultDraftErrors = {};
    const resultDraft = prepared.results[index]!;
    const resultKey = resultDraft.resultKey.trim();
    if (!resultKey) {
      resultFieldErrors.resultKey = '结果标识不能为空。';
    } else if (!SKILL_EFFECT_KEY_PATTERN.test(resultKey)) {
      resultFieldErrors.resultKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
    } else if (seenKeys.has(resultKey)) {
      resultFieldErrors.resultKey = '结果标识不能重复。';
    } else {
      seenKeys.set(resultKey, index);
    }

    const built = validateAndBuildResult(
      resultDraft,
      options,
      resultFieldErrors,
      {
        lifecycleEnabled: prepared.lifecycleEnabled,
        hasDuration,
        parentEffectKey
      }
    );
    if (Object.keys(resultFieldErrors).length > 0) {
      allResultsValid = false;
      resultErrors.push({ index, fieldErrors: resultFieldErrors });
    } else if (built) {
      builtResults.push(built);
    } else {
      allResultsValid = false;
    }
  }

  if (Object.keys(fieldErrors).length > 0 || !allResultsValid) {
    return { ok: false, fieldErrors, resultErrors };
  }

  return {
    ok: true,
    normalized: {
      effectKey,
      name,
      description: description || null,
      sortOrder: sortOrder ?? 0,
      lifecycle,
      results: builtResults
    }
  };
}

export function buildCreateSkillEffectRequest(
  normalized: NormalizedSkillEffectForm
): CreateSkillEffectRequest {
  return {
    effectKey: normalized.effectKey,
    name: normalized.name,
    description: normalized.description,
    sortOrder: normalized.sortOrder,
    lifecycle: cloneLifecycle(normalized.lifecycle),
    results: normalized.results.map(cloneResultRequest)
  };
}

export function buildUpdateSkillEffectRequest(
  normalized: NormalizedSkillEffectForm
): UpdateSkillEffectRequest {
  return {
    name: normalized.name,
    description: normalized.description,
    sortOrder: normalized.sortOrder,
    lifecycle: cloneLifecycle(normalized.lifecycle),
    results: normalized.results.map(cloneResultRequest)
  };
}

export function buildSkillEffectResult(draft: SkillEffectResultDraft): SkillEffectResultRequest {
  const fieldErrors: SkillEffectResultDraftErrors = {};
  const built = validateAndBuildResult(
    clearHiddenResultFields(draft),
    { includeEffectKey: false },
    fieldErrors,
    { lifecycleEnabled: false, hasDuration: false, parentEffectKey: '' }
  );
  if (!built || Object.keys(fieldErrors).length > 0) {
    throw new Error('结果草稿无法构建为强类型请求。');
  }
  return built;
}

export function mapSkillEffectFieldIssues(
  source: unknown,
  submittedResults: ReadonlyArray<Pick<SkillEffectResultDraft, 'resultType'>> = []
): MappedSkillEffectFieldIssues {
  const fieldErrors: SkillEffectDraftErrors = {};
  const resultErrorMap = new Map<number, SkillEffectResultDraftErrors>();
  const unmappedMessages: string[] = [];
  let details: unknown;
  if (source instanceof ApiRequestError) {
    details = source.details;
  } else if (isRecord(source) && 'details' in source) {
    details = source.details;
  } else {
    details = source;
  }
  if (!isRecord(details) || !Array.isArray(details.fieldIssues)) {
    return { fieldErrors, resultErrors: [], unmappedMessages };
  }

  for (const rawIssue of details.fieldIssues) {
    if (!isRecord(rawIssue)) {
      continue;
    }
    const field = typeof rawIssue.field === 'string' ? rawIssue.field : '';
    const message = typeof rawIssue.message === 'string' && rawIssue.message.trim()
      ? rawIssue.message.trim()
      : '字段值不合法。';
    const indexed = INDEXED_RESULT_PATH.exec(field);
    if (indexed) {
      const index = Number(indexed[1]);
      const nested = indexed[2] ?? '';
      if (!Number.isInteger(index) || index < 0) {
        unmappedMessages.push(message);
        continue;
      }
      if (submittedResults.length > 0 && index >= submittedResults.length) {
        unmappedMessages.push(message);
        continue;
      }
      const mappedField = mapResultIssueField(nested, submittedResults[index]?.resultType);
      if (mappedField === null) {
        unmappedMessages.push(message);
        continue;
      }
      const current = resultErrorMap.get(index) ?? {};
      current[mappedField] = message;
      resultErrorMap.set(index, current);
      continue;
    }
    const lifecycleField = LIFECYCLE_FIELD_BY_PATH[field];
    if (lifecycleField) {
      fieldErrors[lifecycleField] = message;
      continue;
    }
    if (EFFECT_DRAFT_FIELDS.has(field as SkillEffectDraftField)) {
      fieldErrors[field as SkillEffectDraftField] = message;
    } else {
      unmappedMessages.push(message);
    }
  }

  const resultErrors = [...resultErrorMap.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([index, errors]) => ({ index, fieldErrors: errors }));
  return { fieldErrors, resultErrors, unmappedMessages };
}

function defaultCooldownOperation(
  resultType: SkillEffectResultType
): CooldownChangeOperation | '' {
  return resultType === 'COOLDOWN_CHANGE' ? 'REDUCE' : '';
}

function defaultLifecycleOperation(
  resultType: SkillEffectResultType
): SkillEffectLifecycleOperation | '' {
  return resultType === 'LIFECYCLE_OPERATION' ? 'INCREASE' : '';
}

function lifecycleToDraft(lifecycle: SkillEffectLifecycle | null): SkillEffectLifecycleDraft {
  if (!lifecycle) {
    return createEmptyLifecycleDraft();
  }
  return {
    durationFormulaKey: lifecycle.durationFormulaKey ?? '',
    maxStacksFormulaKey: lifecycle.maxStacksFormulaKey,
    applicationStacksFormulaKey: lifecycle.applicationStacksFormulaKey,
    instanceScope: lifecycle.instanceScope,
    reapplicationStackMode: lifecycle.reapplicationStackMode,
    reapplicationDurationMode: lifecycle.reapplicationDurationMode ?? '',
    expiryMode: lifecycle.expiryMode,
    periodicIntervalFormulaKey: lifecycle.periodicIntervalFormulaKey ?? '',
    firstPeriodicExecution: lifecycle.firstPeriodicExecution ?? ''
  };
}

function lifecycleBehaviorToDraft(
  behavior: SkillEffectResultLifecycleBehavior | null
): SkillEffectResultLifecycleBehaviorDraft {
  if (!behavior) {
    return createEmptyLifecycleBehaviorDraft();
  }
  return {
    moment: behavior.moment,
    valueReadMode: behavior.valueReadMode ?? '',
    stackValueMode: behavior.stackValueMode ?? '',
    reapplicationValueMode: behavior.reapplicationValueMode ?? '',
    periodicExecutionMode: behavior.periodicExecutionMode ?? ''
  };
}

function listStatusKeyedOptions(
  entries: ReadonlyArray<{ key: string; status: 'ENABLED' | 'DISABLED' }>,
  currentKey: string,
  originalKey: string | null,
  parentSkillKey?: string
): CatalogRefOption[] {
  const options: CatalogRefOption[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.status === 'ENABLED') {
      options.push({ key: entry.key, status: 'ENABLED', source: 'enabled' });
      seen.add(entry.key);
    }
  }
  if (parentSkillKey && !seen.has(parentSkillKey)) {
    const parent = entries.find((item) => item.key === parentSkillKey);
    options.push({
      key: parentSkillKey,
      status: parent?.status ?? 'DISABLED',
      source: parent?.status === 'ENABLED' ? 'enabled' : 'parent-skill-self-ref'
    });
    seen.add(parentSkillKey);
  }
  if (originalKey && !seen.has(originalKey)) {
    const original = entries.find((item) => item.key === originalKey);
    if (original && original.status === 'DISABLED') {
      options.push({
        key: originalKey,
        status: 'DISABLED',
        source: 'retained-disabled'
      });
      seen.add(originalKey);
    }
  }
  appendUnknownOption(options, currentKey);
  return options;
}

function appendUnknownOption(options: CatalogRefOption[], currentKey: string): void {
  const trimmed = currentKey.trim();
  if (trimmed && !options.some((item) => item.key === trimmed)) {
    options.push({ key: trimmed, status: null, source: 'unknown' });
  }
}

type ResultLifecycleContext = {
  lifecycleEnabled: boolean;
  hasDuration: boolean;
  parentEffectKey: string;
};

function validateAndBuildResult(
  draft: SkillEffectResultDraft,
  options: SkillEffectFormValidationOptions,
  fieldErrors: SkillEffectResultDraftErrors,
  context: ResultLifecycleContext
): SkillEffectResultRequest | null {
  const resultKey = draft.resultKey.trim();
  const name = draft.name.trim();
  const description = draft.description.trim();

  if (!name) {
    fieldErrors.name = '结果名称不能为空。';
  } else if (name.length > 100) {
    fieldErrors.name = '结果名称不能超过 100 个字符。';
  }

  if (description.length > 2000) {
    fieldErrors.description = '说明不能超过 2000 个字符。';
  }

  if (!isResultType(draft.resultType)) {
    fieldErrors.resultType = '请选择结果种类。';
  } else if (draft.originalResultType && draft.resultType !== draft.originalResultType) {
    fieldErrors.resultType = '已有结果的种类不可修改。';
  }

  if (draft.target !== 'SOURCE' && draft.target !== 'TARGET') {
    fieldErrors.target = '请选择作用对象。';
  }

  const sortOrder = parseNonNegativeInteger(draft.sortOrder, fieldErrors, 'sortOrder');
  const valueRule = validateValueRule(draft, fieldErrors);
  validateTypeSpecificFields(draft, options, fieldErrors, context);
  const needsValueRule = requiresValueRule(draft.resultType, draft.cooldownOperation, draft.lifecycleOperation);
  const lifecycleBehavior = validateAndBuildLifecycleBehavior(draft, fieldErrors, context, needsValueRule);

  if (
    Object.keys(fieldErrors).length > 0
    || sortOrder === null
    || !isResultType(draft.resultType)
    || (needsValueRule && !valueRule)
    || (context.lifecycleEnabled && !lifecycleBehavior)
  ) {
    return null;
  }

  const base = {
    resultKey,
    name,
    target: draft.target,
    description: description || null,
    sortOrder,
    lifecycleBehavior
  };

  switch (draft.resultType) {
    case 'DAMAGE':
      return {
        ...base,
        resultType: 'DAMAGE',
        valueRule: valueRule!,
        detail: { damageTypeKey: draft.damageTypeKey.trim() }
      };
    case 'DIRECT_HEAL':
      return {
        ...base,
        resultType: 'DIRECT_HEAL',
        valueRule: valueRule!,
        detail: {}
      };
    case 'NORMAL_SHIELD':
      return {
        ...base,
        resultType: 'NORMAL_SHIELD',
        valueRule: valueRule!,
        detail: {}
      };
    case 'ATTRIBUTE_CHANGE':
      return {
        ...base,
        resultType: 'ATTRIBUTE_CHANGE',
        valueRule: valueRule!,
        detail: {
          attributeKey: draft.attributeKey.trim(),
          operation: draft.attributeOperation as AttributeChangeOperation
        }
      };
    case 'RESOURCE_CHANGE':
      return {
        ...base,
        resultType: 'RESOURCE_CHANGE',
        valueRule: valueRule!,
        detail: {
          attributeKey: draft.attributeKey.trim(),
          operation: draft.resourceOperation as ResourceChangeOperation
        }
      };
    case 'COOLDOWN_CHANGE':
      if (draft.cooldownOperation === 'RESET') {
        return {
          ...base,
          resultType: 'COOLDOWN_CHANGE',
          valueRule: null,
          detail: {
            affectedSkillKey: draft.affectedSkillKey.trim(),
            operation: 'RESET'
          }
        };
      }
      return {
        ...base,
        resultType: 'COOLDOWN_CHANGE',
        valueRule: valueRule!,
        detail: {
          affectedSkillKey: draft.affectedSkillKey.trim(),
          operation: draft.cooldownOperation as 'REDUCE' | 'INCREASE'
        }
      };
    case 'STATUS_OPERATION':
      return {
        ...base,
        resultType: 'STATUS_OPERATION',
        valueRule: null,
        detail: {
          statusKey: draft.statusKey.trim(),
          operation: draft.statusOperation as StatusOperation
        }
      };
    case 'LIFECYCLE_OPERATION':
      if (
        draft.lifecycleOperation === 'REFRESH'
        || draft.lifecycleOperation === 'REMOVE'
      ) {
        return {
          ...base,
          resultType: 'LIFECYCLE_OPERATION',
          valueRule: null,
          detail: {
            targetEffectKey: draft.targetEffectKey.trim(),
            operation: draft.lifecycleOperation
          }
        };
      }
      return {
        ...base,
        resultType: 'LIFECYCLE_OPERATION',
        valueRule: valueRule!,
        detail: {
          targetEffectKey: draft.targetEffectKey.trim(),
          operation: draft.lifecycleOperation as 'INCREASE' | 'DECREASE' | 'SET' | 'CONSUME'
        }
      };
    default: {
      const unexpected: never = draft.resultType;
      return unexpected;
    }
  }
}

function validateValueRule(
  draft: SkillEffectResultDraft,
  fieldErrors: SkillEffectResultDraftErrors
): SkillEffectValueRule | null {
  const needed = requiresValueRule(draft.resultType, draft.cooldownOperation, draft.lifecycleOperation);
  const formulaKey = draft.formulaKey.trim();
  const multiplierRaw = draft.fixedMultiplier.trim();
  const minRaw = draft.fixedMinValue.trim();
  const maxRaw = draft.fixedMaxValue.trim();

  if (!needed) {
    if (formulaKey || multiplierRaw || minRaw || maxRaw) {
      if (draft.resultType === 'STATUS_OPERATION') {
        fieldErrors.valueRule = '状态操作不能携带数值规则。';
      } else if (draft.resultType === 'LIFECYCLE_OPERATION') {
        fieldErrors.valueRule = '刷新和移除不能携带数值规则。';
      } else {
        fieldErrors.valueRule = '冷却重置不能携带数值规则。';
      }
    }
    return null;
  }

  if (!formulaKey) {
    fieldErrors.formulaKey = '请选择数值公式。';
  }

  let fixedMultiplier: number | null = null;
  if (!multiplierRaw) {
    fieldErrors.fixedMultiplier = '固定倍率不能为空。';
  } else {
    const parsed = Number(multiplierRaw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      fieldErrors.fixedMultiplier = '固定倍率必须大于等于 0。';
    } else {
      fixedMultiplier = parsed;
    }
  }

  const fixedMinValue = parseOptionalDecimal(minRaw, fieldErrors, 'fixedMinValue', '固定最小值');
  const fixedMaxValue = parseOptionalDecimal(maxRaw, fieldErrors, 'fixedMaxValue', '固定最大值');
  if (
    fixedMinValue !== null
    && fixedMaxValue !== null
    && !fieldErrors.fixedMinValue
    && !fieldErrors.fixedMaxValue
    && fixedMinValue > fixedMaxValue
  ) {
    fieldErrors.fixedMinValue = '固定最小值不能大于固定最大值。';
  }

  if (fieldErrors.formulaKey || fieldErrors.fixedMultiplier || fieldErrors.fixedMinValue || fieldErrors.fixedMaxValue) {
    return null;
  }

  return {
    formulaKey,
    fixedMultiplier: fixedMultiplier ?? 0,
    fixedMinValue,
    fixedMaxValue
  };
}

function validateTypeSpecificFields(
  draft: SkillEffectResultDraft,
  options: SkillEffectFormValidationOptions,
  fieldErrors: SkillEffectResultDraftErrors,
  context: ResultLifecycleContext
): void {
  switch (draft.resultType) {
    case 'DAMAGE':
      requireNonEmpty(draft.damageTypeKey, fieldErrors, 'damageTypeKey', '请选择伤害类型。');
      validateCatalogRef(options, 'damageTypes', draft.damageTypeKey, draft.originalDamageTypeKey, fieldErrors, 'damageTypeKey');
      validateCatalogRef(options, 'formulas', draft.formulaKey, draft.formulaKey, fieldErrors, 'formulaKey', { allowDisabled: true });
      break;
    case 'DIRECT_HEAL':
    case 'NORMAL_SHIELD':
      validateCatalogRef(options, 'formulas', draft.formulaKey, draft.formulaKey, fieldErrors, 'formulaKey', { allowDisabled: true });
      break;
    case 'ATTRIBUTE_CHANGE':
      requireNonEmpty(draft.attributeKey, fieldErrors, 'attributeKey', '请选择属性。');
      if (
        draft.attributeOperation !== 'INCREASE'
        && draft.attributeOperation !== 'DECREASE'
        && draft.attributeOperation !== 'SET'
      ) {
        fieldErrors.attributeOperation = '请选择操作。';
      }
      validateCatalogRef(options, 'attributes', draft.attributeKey, draft.originalAttributeKey, fieldErrors, 'attributeKey');
      validateCatalogRef(options, 'formulas', draft.formulaKey, draft.formulaKey, fieldErrors, 'formulaKey', { allowDisabled: true });
      break;
    case 'RESOURCE_CHANGE':
      requireNonEmpty(draft.attributeKey, fieldErrors, 'attributeKey', '请选择属性。');
      if (
        draft.resourceOperation !== 'RESTORE'
        && draft.resourceOperation !== 'CONSUME'
        && draft.resourceOperation !== 'REFUND'
      ) {
        fieldErrors.resourceOperation = '请选择操作。';
      }
      validateCatalogRef(options, 'attributes', draft.attributeKey, draft.originalAttributeKey, fieldErrors, 'attributeKey');
      validateCatalogRef(options, 'formulas', draft.formulaKey, draft.formulaKey, fieldErrors, 'formulaKey', { allowDisabled: true });
      break;
    case 'COOLDOWN_CHANGE':
      requireNonEmpty(draft.affectedSkillKey, fieldErrors, 'affectedSkillKey', '请选择受影响技能。');
      if (
        draft.cooldownOperation !== 'REDUCE'
        && draft.cooldownOperation !== 'INCREASE'
        && draft.cooldownOperation !== 'RESET'
      ) {
        fieldErrors.cooldownOperation = '请选择操作。';
      }
      validateCatalogRef(
        options,
        'skills',
        draft.affectedSkillKey,
        draft.originalAffectedSkillKey,
        fieldErrors,
        'affectedSkillKey',
        { parentSkillKey: options.catalog?.parentSkillKey }
      );
      if (requiresValueRule(draft.resultType, draft.cooldownOperation, draft.lifecycleOperation)) {
        validateCatalogRef(options, 'formulas', draft.formulaKey, draft.formulaKey, fieldErrors, 'formulaKey', { allowDisabled: true });
      }
      break;
    case 'STATUS_OPERATION':
      requireNonEmpty(draft.statusKey, fieldErrors, 'statusKey', '请选择状态。');
      if (draft.statusOperation !== 'APPLY' && draft.statusOperation !== 'REMOVE') {
        fieldErrors.statusOperation = '请选择操作。';
      }
      validateCatalogRef(options, 'statuses', draft.statusKey, draft.originalStatusKey, fieldErrors, 'statusKey');
      break;
    case 'LIFECYCLE_OPERATION':
      requireNonEmpty(draft.targetEffectKey, fieldErrors, 'targetEffectKey', '请选择目标效果。');
      if (!isLifecycleOperation(draft.lifecycleOperation)) {
        fieldErrors.lifecycleOperation = '请选择操作。';
      }
      validateLifecycleTarget(draft, options, fieldErrors, context.parentEffectKey);
      if (requiresValueRule(draft.resultType, draft.cooldownOperation, draft.lifecycleOperation)) {
        validateCatalogRef(options, 'formulas', draft.formulaKey, draft.formulaKey, fieldErrors, 'formulaKey', { allowDisabled: true });
      }
      break;
    default: {
      const unexpected: never = draft.resultType;
      void unexpected;
    }
  }
}

function validateLifecycleTarget(
  draft: SkillEffectResultDraft,
  options: SkillEffectFormValidationOptions,
  fieldErrors: SkillEffectResultDraftErrors,
  parentEffectKey: string
): void {
  if (fieldErrors.targetEffectKey) {
    return;
  }
  const trimmed = draft.targetEffectKey.trim();
  if (!trimmed) {
    return;
  }
  if (parentEffectKey && trimmed === parentEffectKey) {
    fieldErrors.targetEffectKey = '不能引用当前效果。';
    return;
  }
  if (options.catalogLoadState?.effects === 'failed') {
    fieldErrors.targetEffectKey = INCOMPLETE_CATALOG_MESSAGE;
    return;
  }
  const catalog = options.catalog;
  if (!catalog) {
    return;
  }
  const found = catalog.effects.find((item) => item.effectKey === trimmed);
  if (!found) {
    fieldErrors.targetEffectKey = INCOMPLETE_CATALOG_MESSAGE;
    return;
  }
  if (!found.lifecycleEnabled) {
    fieldErrors.targetEffectKey = '请选择有生命周期的目标效果。';
  }
}

function validateDisabledLifecycle(
  draft: SkillEffectDraft,
  fieldErrors: SkillEffectDraftErrors
): void {
  const lifecycle = draft.lifecycle;
  if (
    lifecycle.durationFormulaKey.trim()
    || lifecycle.maxStacksFormulaKey.trim()
    || lifecycle.applicationStacksFormulaKey.trim()
    || lifecycle.instanceScope
    || lifecycle.reapplicationStackMode
    || lifecycle.reapplicationDurationMode
    || lifecycle.expiryMode
    || lifecycle.periodicIntervalFormulaKey.trim()
    || lifecycle.firstPeriodicExecution
  ) {
    fieldErrors.lifecycle = '无生命周期效果不能携带生命周期配置。';
  }
}

function validateAndBuildLifecycle(
  draft: SkillEffectDraft,
  options: SkillEffectFormValidationOptions,
  fieldErrors: SkillEffectDraftErrors,
  hasPeriodic: boolean
): SkillEffectLifecycle | null {
  const lifecycle = draft.lifecycle;
  const durationFormulaKey = lifecycle.durationFormulaKey.trim() || null;
  const maxStacksFormulaKey = lifecycle.maxStacksFormulaKey.trim();
  const applicationStacksFormulaKey = lifecycle.applicationStacksFormulaKey.trim();
  const periodicIntervalFormulaKey = lifecycle.periodicIntervalFormulaKey.trim() || null;

  if (!maxStacksFormulaKey) {
    fieldErrors.maxStacksFormulaKey = '请选择最大层数公式。';
  } else {
    validateLifecycleFormula(options, maxStacksFormulaKey, fieldErrors, 'maxStacksFormulaKey');
  }
  if (!applicationStacksFormulaKey) {
    fieldErrors.applicationStacksFormulaKey = '请选择每次施加层数公式。';
  } else {
    validateLifecycleFormula(options, applicationStacksFormulaKey, fieldErrors, 'applicationStacksFormulaKey');
  }
  if (durationFormulaKey) {
    validateLifecycleFormula(options, durationFormulaKey, fieldErrors, 'durationFormulaKey');
  }
  if (!isInstanceScope(lifecycle.instanceScope)) {
    fieldErrors.instanceScope = '请选择实例范围。';
  } else if (draft.originalLifecycleEnabled && lifecycle.instanceScope !== draft.originalInstanceScope) {
    fieldErrors.instanceScope = '已有生命周期的实例范围不可修改。';
  }
  if (!isReapplicationStackMode(lifecycle.reapplicationStackMode)) {
    fieldErrors.reapplicationStackMode = '请选择重复层数方式。';
  }

  if (!durationFormulaKey) {
    if (lifecycle.expiryMode !== 'EXPLICIT_ONLY') {
      fieldErrors.expiryMode = '没有持续时间时到期方式必须为仅显式移除。';
    }
    if (lifecycle.reapplicationDurationMode) {
      fieldErrors.reapplicationDurationMode = '没有持续时间时不能选择重复持续方式。';
    }
  } else {
    if (!isReapplicationDurationMode(lifecycle.reapplicationDurationMode)) {
      fieldErrors.reapplicationDurationMode = '请选择重复持续方式。';
    }
    if (!isExpiryMode(lifecycle.expiryMode) || lifecycle.expiryMode === 'EXPLICIT_ONLY') {
      fieldErrors.expiryMode = '有持续时间时不能使用仅显式移除。';
    }
    if (
      lifecycle.reapplicationDurationMode === 'INDEPENDENT'
      && lifecycle.expiryMode !== 'INDEPENDENT'
    ) {
      fieldErrors.expiryMode = '独立计时必须搭配独立到期。';
    }
    if (
      lifecycle.expiryMode === 'INDEPENDENT'
      && lifecycle.reapplicationDurationMode !== 'INDEPENDENT'
    ) {
      fieldErrors.reapplicationDurationMode = '独立到期必须搭配独立计时。';
    }
    if (
      lifecycle.expiryMode === 'ONE_BY_ONE'
      && lifecycle.reapplicationDurationMode !== 'REFRESH_ALL'
      && lifecycle.reapplicationDurationMode !== 'KEEP_REMAINING'
      && !fieldErrors.expiryMode
    ) {
      fieldErrors.expiryMode = '逐层到期只能搭配刷新全部时间或保留剩余时间。';
    }
  }

  if (hasPeriodic) {
    if (!periodicIntervalFormulaKey) {
      fieldErrors.periodicIntervalFormulaKey = '请选择周期间隔公式。';
    } else {
      validateLifecycleFormula(options, periodicIntervalFormulaKey, fieldErrors, 'periodicIntervalFormulaKey');
    }
    if (!isFirstPeriodicExecution(lifecycle.firstPeriodicExecution)) {
      fieldErrors.firstPeriodicExecution = '请选择首次周期。';
    }
  } else {
    if (periodicIntervalFormulaKey) {
      fieldErrors.periodicIntervalFormulaKey = '没有周期结果时不能填写周期间隔。';
    }
    if (lifecycle.firstPeriodicExecution) {
      fieldErrors.firstPeriodicExecution = '没有周期结果时不能选择首次周期。';
    }
  }

  if (
    fieldErrors.durationFormulaKey
    || fieldErrors.maxStacksFormulaKey
    || fieldErrors.applicationStacksFormulaKey
    || fieldErrors.instanceScope
    || fieldErrors.reapplicationStackMode
    || fieldErrors.reapplicationDurationMode
    || fieldErrors.expiryMode
    || fieldErrors.periodicIntervalFormulaKey
    || fieldErrors.firstPeriodicExecution
    || fieldErrors.lifecycle
  ) {
    return null;
  }

  return {
    durationFormulaKey,
    maxStacksFormulaKey,
    applicationStacksFormulaKey,
    instanceScope: lifecycle.instanceScope as SkillEffectLifecycleInstanceScope,
    reapplicationStackMode: lifecycle.reapplicationStackMode as SkillEffectReapplicationStackMode,
    reapplicationDurationMode: durationFormulaKey
      ? lifecycle.reapplicationDurationMode as SkillEffectReapplicationDurationMode
      : null,
    expiryMode: lifecycle.expiryMode as SkillEffectExpiryMode,
    periodicIntervalFormulaKey: hasPeriodic ? periodicIntervalFormulaKey : null,
    firstPeriodicExecution: hasPeriodic
      ? lifecycle.firstPeriodicExecution as SkillEffectFirstPeriodicExecution
      : null
  };
}

function validateAndBuildLifecycleBehavior(
  draft: SkillEffectResultDraft,
  fieldErrors: SkillEffectResultDraftErrors,
  context: ResultLifecycleContext,
  needsValueRule: boolean
): SkillEffectResultLifecycleBehavior | null {
  const behavior = draft.lifecycleBehavior;
  if (!context.lifecycleEnabled) {
    if (
      behavior.moment
      || behavior.valueReadMode
      || behavior.stackValueMode
      || behavior.reapplicationValueMode
      || behavior.periodicExecutionMode
    ) {
      fieldErrors.lifecycleBehavior = '无生命周期效果不能配置结果生命周期行为。';
    }
    return null;
  }

  if (!isLifecycleMoment(behavior.moment)) {
    fieldErrors.moment = '请选择生命周期时点。';
    return null;
  }

  if (behavior.moment === 'NATURAL_END' && !context.hasDuration) {
    fieldErrors.moment = '没有持续时间时不能选择自然结束。';
  }
  if (behavior.moment === 'PERSISTENT' && !isPersistentMomentAllowed(draft)) {
    fieldErrors.moment = '该结果不能选择持续生效。';
  }

  if (needsValueRule) {
    if (behavior.moment === 'APPLICATION' || behavior.moment === 'PERSISTENT') {
      if (behavior.valueReadMode !== 'APPLICATION_SNAPSHOT') {
        fieldErrors.valueReadMode = '施加时和持续生效必须使用施加时留存。';
      }
    } else if (!isValueReadMode(behavior.valueReadMode)) {
      fieldErrors.valueReadMode = '请选择数值读取方式。';
    }
  } else if (behavior.valueReadMode) {
    fieldErrors.valueReadMode = '该结果不能选择数值读取方式。';
  }

  if (behavior.moment === 'PERSISTENT' && isPersistentNumericResult(draft)) {
    if (!isStackValueMode(behavior.stackValueMode)) {
      fieldErrors.stackValueMode = '请选择层数值方式。';
    } else if (isAttributeSetPersistent(draft) && behavior.stackValueMode !== 'SHARED') {
      fieldErrors.stackValueMode = '属性覆盖只能使用整个实例共享数值。';
    }
    if (behavior.stackValueMode === 'SHARED') {
      if (!isReapplicationValueMode(behavior.reapplicationValueMode)) {
        fieldErrors.reapplicationValueMode = '请选择重复值方式。';
      } else if (isAttributeSetPersistent(draft) && behavior.reapplicationValueMode === 'ADD') {
        fieldErrors.reapplicationValueMode = '属性覆盖不能使用相加。';
      }
    } else if (behavior.reapplicationValueMode) {
      fieldErrors.reapplicationValueMode = '每层分别贡献时不能选择重复值方式。';
    }
  } else {
    if (behavior.stackValueMode) {
      fieldErrors.stackValueMode = '该结果不能选择层数值方式。';
    }
    if (behavior.reapplicationValueMode) {
      fieldErrors.reapplicationValueMode = '该结果不能选择重复值方式。';
    }
  }

  if (behavior.moment === 'PERIODIC') {
    if (!isPeriodicExecutionMode(behavior.periodicExecutionMode)) {
      fieldErrors.periodicExecutionMode = '请选择周期执行次数。';
    }
  } else if (behavior.periodicExecutionMode) {
    fieldErrors.periodicExecutionMode = '只有每次周期才能选择执行次数。';
  }

  if (
    fieldErrors.moment
    || fieldErrors.valueReadMode
    || fieldErrors.stackValueMode
    || fieldErrors.reapplicationValueMode
    || fieldErrors.periodicExecutionMode
    || fieldErrors.lifecycleBehavior
  ) {
    return null;
  }

  return {
    moment: behavior.moment,
    valueReadMode: needsValueRule ? behavior.valueReadMode as SkillEffectValueReadMode : null,
    stackValueMode: behavior.stackValueMode ? behavior.stackValueMode as SkillEffectStackValueMode : null,
    reapplicationValueMode: behavior.reapplicationValueMode
      ? behavior.reapplicationValueMode as SkillEffectReapplicationValueMode
      : null,
    periodicExecutionMode: behavior.periodicExecutionMode
      ? behavior.periodicExecutionMode as SkillEffectPeriodicExecutionMode
      : null
  };
}

function validateLifecycleFormula(
  options: SkillEffectFormValidationOptions,
  formulaKey: string,
  fieldErrors: SkillEffectDraftErrors,
  field: SkillEffectDraftField
): void {
  if (fieldErrors[field]) {
    return;
  }
  if (options.catalogLoadState?.formulas === 'failed') {
    fieldErrors[field] = INCOMPLETE_CATALOG_MESSAGE;
    return;
  }
  const catalog = options.catalog;
  if (!catalog) {
    return;
  }
  if (
    options.catalogLoadState?.formulas !== 'ready'
    && options.catalogLoadState?.formulas !== 'failed'
    && catalog.formulas.length === 0
  ) {
    return;
  }
  if (!catalog.formulas.some((item) => item.formulaKey === formulaKey)) {
    fieldErrors[field] = INCOMPLETE_CATALOG_MESSAGE;
  }
}

function validateCatalogRef(
  options: SkillEffectFormValidationOptions,
  kind: keyof EffectCatalogLoadState,
  currentKey: string,
  originalKey: string | null,
  fieldErrors: SkillEffectResultDraftErrors,
  field: SkillEffectResultDraftField,
  extra: { allowDisabled?: boolean; parentSkillKey?: string } = {}
): void {
  if (fieldErrors[field]) {
    return;
  }
  const trimmed = currentKey.trim();
  if (!trimmed) {
    return;
  }
  if (options.catalogLoadState?.[kind] === 'failed') {
    fieldErrors[field] = INCOMPLETE_CATALOG_MESSAGE;
    return;
  }
  const catalog = options.catalog;
  if (!catalog) {
    return;
  }

  if (kind === 'formulas') {
    if (
      options.catalogLoadState?.formulas !== 'ready'
      && options.catalogLoadState?.formulas !== 'failed'
      && catalog.formulas.length === 0
    ) {
      return;
    }
    if (!catalog.formulas.some((item) => item.formulaKey === trimmed)) {
      fieldErrors[field] = INCOMPLETE_CATALOG_MESSAGE;
    }
    return;
  }
  if (kind === 'effects') {
    return;
  }

  if (options.catalogLoadState?.[kind] !== 'ready' && options.catalogLoadState?.[kind] !== 'failed') {
    const entries = catalogEntries(catalog, kind);
    if (entries.length === 0) {
      return;
    }
  }

  const entries = catalogEntries(catalog, kind);
  const found = entries.find((item) => item.key === trimmed);
  if (!found) {
    if (kind === 'skills' && extra.parentSkillKey === trimmed) {
      return;
    }
    fieldErrors[field] = INCOMPLETE_CATALOG_MESSAGE;
    return;
  }
  if (found.status === 'ENABLED' || extra.allowDisabled) {
    return;
  }
  if (kind === 'skills' && extra.parentSkillKey === trimmed) {
    return;
  }
  if (originalKey === trimmed) {
    return;
  }
  fieldErrors[field] = DISABLED_CATALOG_MESSAGE;
}

function catalogEntries(
  catalog: EffectFormCatalog,
  kind: Exclude<keyof EffectCatalogLoadState, 'formulas' | 'effects'>
): Array<{ key: string; status: 'ENABLED' | 'DISABLED' }> {
  if (kind === 'damageTypes') {
    return catalog.damageTypes.map((item) => ({ key: item.damageTypeKey, status: item.status }));
  }
  if (kind === 'attributes') {
    return catalog.attributes.map((item) => ({ key: item.attributeKey, status: item.status }));
  }
  if (kind === 'skills') {
    return catalog.skills.map((item) => ({ key: item.skillKey, status: item.status }));
  }
  return catalog.statuses.map((item) => ({ key: item.statusKey, status: item.status }));
}

function requireNonEmpty(
  value: string,
  fieldErrors: SkillEffectResultDraftErrors,
  field: SkillEffectResultDraftField,
  message: string
): void {
  if (!value.trim()) {
    fieldErrors[field] = message;
  }
}

function parseNonNegativeInteger<T extends { sortOrder?: string }>(
  raw: string,
  fieldErrors: T,
  field: 'sortOrder'
): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    fieldErrors[field] = '排序不能为空。';
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    fieldErrors[field] = '排序必须是大于等于 0 的整数。';
    return null;
  }
  return parsed;
}

function parseOptionalDecimal(
  raw: string,
  fieldErrors: SkillEffectResultDraftErrors,
  field: 'fixedMinValue' | 'fixedMaxValue',
  label: string
): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    fieldErrors[field] = `${label}必须是数字。`;
    return null;
  }
  return parsed;
}

function cloneLifecycle(lifecycle: SkillEffectLifecycle | null): SkillEffectLifecycle | null {
  return lifecycle ? { ...lifecycle } : null;
}

function cloneLifecycleBehavior(
  behavior: SkillEffectResultLifecycleBehavior | null
): SkillEffectResultLifecycleBehavior | null {
  return behavior ? { ...behavior } : null;
}

function cloneResultRequest(result: SkillEffectResultRequest): SkillEffectResultRequest {
  const lifecycleBehavior = cloneLifecycleBehavior(result.lifecycleBehavior);
  switch (result.resultType) {
    case 'DAMAGE':
      return {
        ...result,
        lifecycleBehavior,
        valueRule: { ...result.valueRule },
        detail: { ...result.detail }
      };
    case 'DIRECT_HEAL':
    case 'NORMAL_SHIELD':
      return { ...result, lifecycleBehavior, valueRule: { ...result.valueRule }, detail: {} };
    case 'ATTRIBUTE_CHANGE':
      return {
        ...result,
        lifecycleBehavior,
        valueRule: { ...result.valueRule },
        detail: { ...result.detail }
      };
    case 'RESOURCE_CHANGE':
      return {
        ...result,
        lifecycleBehavior,
        valueRule: { ...result.valueRule },
        detail: { ...result.detail }
      };
    case 'COOLDOWN_CHANGE':
      if (result.valueRule === null) {
        return { ...result, lifecycleBehavior, valueRule: null, detail: { ...result.detail } };
      }
      return {
        ...result,
        lifecycleBehavior,
        valueRule: { ...result.valueRule },
        detail: { ...result.detail }
      };
    case 'STATUS_OPERATION':
      return { ...result, lifecycleBehavior, valueRule: null, detail: { ...result.detail } };
    case 'LIFECYCLE_OPERATION':
      if (result.valueRule === null) {
        return { ...result, lifecycleBehavior, valueRule: null, detail: { ...result.detail } };
      }
      return {
        ...result,
        lifecycleBehavior,
        valueRule: { ...result.valueRule },
        detail: { ...result.detail }
      };
    default: {
      const unexpected: never = result;
      return unexpected;
    }
  }
}

function mapResultIssueField(
  nested: string,
  resultType: SkillEffectResultType | undefined
): SkillEffectResultDraftField | null {
  if (!nested) {
    return 'resultKey';
  }
  const direct = RESULT_FIELD_BY_PATH[nested];
  if (direct) {
    return direct;
  }
  if (nested === 'detail.operation') {
    if (resultType === 'ATTRIBUTE_CHANGE') return 'attributeOperation';
    if (resultType === 'RESOURCE_CHANGE') return 'resourceOperation';
    if (resultType === 'COOLDOWN_CHANGE') return 'cooldownOperation';
    if (resultType === 'STATUS_OPERATION') return 'statusOperation';
    if (resultType === 'LIFECYCLE_OPERATION') return 'lifecycleOperation';
    return 'detail';
  }
  return null;
}

function isResultType(value: string): value is SkillEffectResultType {
  return (SKILL_EFFECT_RESULT_TYPES as readonly string[]).includes(value);
}

function isLifecycleOperation(value: string): value is SkillEffectLifecycleOperation {
  return (SKILL_EFFECT_LIFECYCLE_OPERATIONS as readonly string[]).includes(value);
}

function isInstanceScope(value: string): value is SkillEffectLifecycleInstanceScope {
  return value === 'SKILL' || value === 'SOURCE' || value === 'TARGET' || value === 'SOURCE_TARGET';
}

function isReapplicationStackMode(value: string): value is SkillEffectReapplicationStackMode {
  return value === 'KEEP' || value === 'INCREASE' || value === 'REPLACE';
}

function isReapplicationDurationMode(value: string): value is SkillEffectReapplicationDurationMode {
  return value === 'REFRESH_ALL' || value === 'KEEP_REMAINING' || value === 'INDEPENDENT';
}

function isExpiryMode(value: string): value is SkillEffectExpiryMode {
  return value === 'ALL_AT_ONCE'
    || value === 'ONE_BY_ONE'
    || value === 'INDEPENDENT'
    || value === 'EXPLICIT_ONLY';
}

function isFirstPeriodicExecution(value: string): value is SkillEffectFirstPeriodicExecution {
  return value === 'IMMEDIATE' || value === 'AFTER_INTERVAL';
}

function isLifecycleMoment(value: string): value is SkillEffectLifecycleMoment {
  return value === 'APPLICATION'
    || value === 'PERSISTENT'
    || value === 'FULL_STACKS'
    || value === 'PERIODIC'
    || value === 'NATURAL_END'
    || value === 'EARLY_REMOVE';
}

function isValueReadMode(value: string): value is SkillEffectValueReadMode {
  return value === 'APPLICATION_SNAPSHOT' || value === 'MOMENT_EVALUATION';
}

function isStackValueMode(value: string): value is SkillEffectStackValueMode {
  return value === 'SHARED' || value === 'PER_STACK';
}

function isReapplicationValueMode(value: string): value is SkillEffectReapplicationValueMode {
  return value === 'KEEP' || value === 'REPLACE' || value === 'ADD';
}

function isPeriodicExecutionMode(value: string): value is SkillEffectPeriodicExecutionMode {
  return value === 'ONCE_PER_INSTANCE' || value === 'ONCE_PER_ACTIVE_STACK';
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}
