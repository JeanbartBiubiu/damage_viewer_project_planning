import { ApiRequestError } from '../../../../services/apiClient';
import type { SkillEffectSummary } from '../../../../types/skillEffect';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type {
  SkillInternalStateSummary,
  SkillInternalStateType
} from '../../../../types/skillInternalState';
import type {
  CreateSkillProcessRequest,
  SkillProcess,
  SkillProcessActivationType,
  SkillProcessCooldown,
  SkillProcessEffectBinding,
  SkillProcessEmpoweredConsumeMoment,
  SkillProcessFirstExecution,
  SkillProcessMoment,
  SkillProcessMomentType,
  SkillProcessProcessMomentType,
  SkillProcessStateOperation,
  SkillProcessStateOperationKind,
  SkillProcessStep,
  SkillProcessStepMomentType,
  SkillProcessStepType,
  UpdateSkillProcessRequest
} from '../../../../types/skillProcess';

export const SKILL_PROCESS_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const SKILL_PROCESS_ACTIVATION_TYPES = [
  'ACTIVE',
  'PASSIVE',
  'CONSUMABLE'
] as const satisfies readonly SkillProcessActivationType[];

export const SKILL_PROCESS_ACTIVATION_TYPE_LABELS = {
  ACTIVE: '主动',
  PASSIVE: '被动',
  CONSUMABLE: '消耗'
} as const satisfies { [K in SkillProcessActivationType]: string };

export const SKILL_PROCESS_STEP_TYPES = [
  'IMMEDIATE',
  'DELAY',
  'MULTI_HIT',
  'PERIODIC',
  'CHANNEL',
  'CHARGE',
  'RECAST',
  'EMPOWERED_BASIC_ATTACK'
] as const satisfies readonly SkillProcessStepType[];

export const SKILL_PROCESS_STEP_TYPE_LABELS = {
  IMMEDIATE: '立即',
  DELAY: '延迟',
  MULTI_HIT: '多段',
  PERIODIC: '周期',
  CHANNEL: '引导',
  CHARGE: '蓄力',
  RECAST: '重施',
  EMPOWERED_BASIC_ATTACK: '强化下一次普通攻击'
} as const satisfies { [K in SkillProcessStepType]: string };

export const SKILL_PROCESS_MOMENT_TYPES = [
  'PROCESS_START',
  'STEP_START',
  'STEP_EXECUTION',
  'STEP_COMPLETE',
  'STEP_TIMEOUT',
  'PROCESS_COMPLETE',
  'PROCESS_FAILURE'
] as const satisfies readonly SkillProcessMomentType[];

export const SKILL_PROCESS_MOMENT_TYPE_LABELS = {
  PROCESS_START: '过程开始',
  STEP_START: '步骤开始',
  STEP_EXECUTION: '步骤执行',
  STEP_COMPLETE: '步骤完成',
  STEP_TIMEOUT: '步骤超时',
  PROCESS_COMPLETE: '过程完成',
  PROCESS_FAILURE: '过程失败'
} as const satisfies { [K in SkillProcessMomentType]: string };

export const PROCESS_LEVEL_MOMENT_TYPES = [
  'PROCESS_START',
  'PROCESS_COMPLETE',
  'PROCESS_FAILURE'
] as const satisfies readonly SkillProcessMomentType[];

export const STEP_LEVEL_MOMENT_TYPES = [
  'STEP_START',
  'STEP_EXECUTION',
  'STEP_COMPLETE',
  'STEP_TIMEOUT'
] as const satisfies readonly SkillProcessMomentType[];

export const TIMEOUT_ALLOWED_STEP_TYPES = [
  'CHARGE',
  'RECAST',
  'EMPOWERED_BASIC_ATTACK'
] as const satisfies readonly SkillProcessStepType[];

export const FIRST_EXECUTION_LABELS = {
  IMMEDIATE: '立即执行',
  AFTER_INTERVAL: '等待一个间隔'
} as const satisfies { [K in SkillProcessFirstExecution]: string };

export const EMPOWERED_CONSUME_MOMENT_LABELS = {
  ATTACK_START: '攻击发起',
  ATTACK_HIT: '攻击命中'
} as const satisfies { [K in SkillProcessEmpoweredConsumeMoment]: string };

export const STATE_OPERATION_LABELS = {
  INCREASE: '增加',
  DECREASE: '减少',
  CONSUME: '消耗',
  SET: '设置',
  RESET: '重置',
  SELECT: '选择',
  ENABLE: '启用',
  DISABLE: '停用',
  TOGGLE: '切换',
  START: '开始'
} as const satisfies { [K in SkillProcessStateOperationKind]: string };

export const MILLISECOND_FORMULA_HINT = '时长按毫秒解释';
export const POSITIVE_INTEGER_FORMULA_HINT = '未来按正整数解释';
export const EMPOWERED_STEP_EXECUTION_HINT = '普通攻击命中时执行';
export const PROCESS_BEHAVIOR_REQUIRED_MESSAGE = '至少需要一个效果挂接或内部状态操作。';
export const INCOMPLETE_CATALOG_MESSAGE = '目录不完整，无法保存未知引用。';
export const MISSING_CATALOG_LABEL = '目录缺失';

export type SkillProcessMomentDraft = {
  momentType: SkillProcessMomentType;
  stepKey: string;
};

export type SkillProcessStepDraft = {
  stepKey: string;
  name: string;
  stepType: SkillProcessStepType;
  description: string;
  sortOrder: string;
  delayFormulaKey: string;
  repeatCountFormulaKey: string;
  intervalFormulaKey: string;
  firstExecution: SkillProcessFirstExecution | '';
  durationFormulaKey: string;
  executionCountFormulaKey: string;
  minimumChargeFormulaKey: string;
  maximumChargeFormulaKey: string;
  releaseAtMaximum: boolean;
  windowFormulaKey: string;
  maximumRecastCountFormulaKey: string;
  consumeMoment: SkillProcessEmpoweredConsumeMoment | '';
  originalStepType: SkillProcessStepType | null;
};

export type SkillProcessEffectBindingDraft = {
  bindingKey: string;
  effectKey: string;
  momentType: SkillProcessMomentType;
  stepKey: string;
  sortOrder: string;
  originalBindingKey: string | null;
};

export type SkillProcessStateOperationDraft = {
  operationKey: string;
  name: string;
  stateKey: string;
  operation: SkillProcessStateOperationKind | '';
  valueFormulaKey: string;
  optionKey: string;
  momentType: SkillProcessMomentType;
  stepKey: string;
  sortOrder: string;
  originalOperation: SkillProcessStateOperationKind | null;
};

export type SkillProcessDraft = {
  processKey: string;
  name: string;
  activationType: SkillProcessActivationType;
  description: string;
  sortOrder: string;
  cooldownEnabled: boolean;
  cooldownDurationFormulaKey: string;
  cooldownMomentType: SkillProcessMomentType;
  cooldownStepKey: string;
  steps: SkillProcessStepDraft[];
  effectBindings: SkillProcessEffectBindingDraft[];
  stateOperations: SkillProcessStateOperationDraft[];
};

export type SkillProcessDraftField =
  | 'processKey'
  | 'name'
  | 'activationType'
  | 'description'
  | 'sortOrder'
  | 'cooldown'
  | 'cooldownDurationFormulaKey'
  | 'cooldownMoment'
  | 'steps'
  | 'effectBindings'
  | 'stateOperations';

export type SkillProcessDraftErrors = {
  [K in SkillProcessDraftField]?: string;
};

export type SkillProcessStepDraftField =
  | 'stepKey'
  | 'name'
  | 'stepType'
  | 'description'
  | 'sortOrder'
  | 'delayFormulaKey'
  | 'repeatCountFormulaKey'
  | 'intervalFormulaKey'
  | 'firstExecution'
  | 'durationFormulaKey'
  | 'executionCountFormulaKey'
  | 'minimumChargeFormulaKey'
  | 'maximumChargeFormulaKey'
  | 'releaseAtMaximum'
  | 'windowFormulaKey'
  | 'maximumRecastCountFormulaKey'
  | 'consumeMoment'
  | 'detail';

export type SkillProcessStepDraftErrors = {
  [K in SkillProcessStepDraftField]?: string;
};

export type SkillProcessEffectBindingDraftField =
  | 'bindingKey'
  | 'effectKey'
  | 'moment'
  | 'momentType'
  | 'stepKey'
  | 'sortOrder';

export type SkillProcessEffectBindingDraftErrors = {
  [K in SkillProcessEffectBindingDraftField]?: string;
};

export type SkillProcessStateOperationDraftField =
  | 'operationKey'
  | 'name'
  | 'stateKey'
  | 'operation'
  | 'valueFormulaKey'
  | 'optionKey'
  | 'moment'
  | 'momentType'
  | 'stepKey'
  | 'sortOrder';

export type SkillProcessStateOperationDraftErrors = {
  [K in SkillProcessStateOperationDraftField]?: string;
};

export type IndexedFieldErrors<T> = {
  index: number;
  fieldErrors: T;
};

export type NormalizedSkillProcessForm = CreateSkillProcessRequest;

export type SkillProcessFormValidation =
  | { ok: true; normalized: NormalizedSkillProcessForm }
  | {
      ok: false;
      fieldErrors: SkillProcessDraftErrors;
      stepErrors: IndexedFieldErrors<SkillProcessStepDraftErrors>[];
      bindingErrors: IndexedFieldErrors<SkillProcessEffectBindingDraftErrors>[];
      operationErrors: IndexedFieldErrors<SkillProcessStateOperationDraftErrors>[];
    };

export type ProcessCatalogLoadState = {
  formulas?: 'ready' | 'failed';
  effects?: 'ready' | 'failed';
  internalStates?: 'ready' | 'failed';
  modeOptions?: 'ready' | 'failed';
};

export type ProcessFormCatalog = {
  formulas: ReadonlyArray<Pick<SkillFormulaSummary, 'formulaKey' | 'name'>>;
  effects: ReadonlyArray<Pick<SkillEffectSummary, 'effectKey' | 'name'>>;
  internalStates: ReadonlyArray<Pick<SkillInternalStateSummary, 'stateKey' | 'name' | 'stateType'>>;
  modeOptionsByStateKey: { [stateKey: string]: ReadonlyArray<{ optionKey: string; name: string }> };
};

export type SkillProcessFormValidationOptions = {
  includeProcessKey: boolean;
  catalog?: ProcessFormCatalog | null;
  catalogLoadState?: ProcessCatalogLoadState | null;
};

export type CatalogRefOption = {
  key: string;
  source: 'catalog' | 'unknown';
};

export type MappedSkillProcessFieldIssues = {
  fieldErrors: SkillProcessDraftErrors;
  stepErrors: IndexedFieldErrors<SkillProcessStepDraftErrors>[];
  bindingErrors: IndexedFieldErrors<SkillProcessEffectBindingDraftErrors>[];
  operationErrors: IndexedFieldErrors<SkillProcessStateOperationDraftErrors>[];
  unmappedMessages: string[];
};

export type StepDeleteBlocker = {
  area: 'cooldown' | 'effectBindings' | 'stateOperations';
  key: string;
  label: string;
};

const PROCESS_DRAFT_FIELDS = new Set<SkillProcessDraftField>([
  'processKey',
  'name',
  'activationType',
  'description',
  'sortOrder',
  'cooldown',
  'cooldownDurationFormulaKey',
  'cooldownMoment',
  'steps',
  'effectBindings',
  'stateOperations'
]);

const STEP_FIELD_BY_PATH: { [path: string]: SkillProcessStepDraftField } = {
  stepKey: 'stepKey',
  name: 'name',
  stepType: 'stepType',
  description: 'description',
  sortOrder: 'sortOrder',
  detail: 'detail',
  'detail.delayFormulaKey': 'delayFormulaKey',
  'detail.repeatCountFormulaKey': 'repeatCountFormulaKey',
  'detail.intervalFormulaKey': 'intervalFormulaKey',
  'detail.firstExecution': 'firstExecution',
  'detail.durationFormulaKey': 'durationFormulaKey',
  'detail.executionCountFormulaKey': 'executionCountFormulaKey',
  'detail.minimumChargeFormulaKey': 'minimumChargeFormulaKey',
  'detail.maximumChargeFormulaKey': 'maximumChargeFormulaKey',
  'detail.releaseAtMaximum': 'releaseAtMaximum',
  'detail.windowFormulaKey': 'windowFormulaKey',
  'detail.maximumRecastCountFormulaKey': 'maximumRecastCountFormulaKey',
  'detail.consumeMoment': 'consumeMoment'
};

const BINDING_FIELD_BY_PATH: { [path: string]: SkillProcessEffectBindingDraftField } = {
  bindingKey: 'bindingKey',
  effectKey: 'effectKey',
  moment: 'moment',
  'moment.momentType': 'momentType',
  'moment.stepKey': 'stepKey',
  sortOrder: 'sortOrder'
};

const OPERATION_FIELD_BY_PATH: { [path: string]: SkillProcessStateOperationDraftField } = {
  operationKey: 'operationKey',
  name: 'name',
  stateKey: 'stateKey',
  operation: 'operation',
  valueFormulaKey: 'valueFormulaKey',
  optionKey: 'optionKey',
  moment: 'moment',
  'moment.momentType': 'momentType',
  'moment.stepKey': 'stepKey',
  sortOrder: 'sortOrder'
};

const INDEXED_STEP_PATH = /^steps\[(\d+)\](?:\.(.*))?$/;
const INDEXED_BINDING_PATH = /^effectBindings\[(\d+)\](?:\.(.*))?$/;
const INDEXED_OPERATION_PATH = /^stateOperations\[(\d+)\](?:\.(.*))?$/;

export function isProcessLevelMoment(
  momentType: SkillProcessMomentType
): momentType is SkillProcessProcessMomentType {
  return (PROCESS_LEVEL_MOMENT_TYPES as readonly string[]).includes(momentType);
}

export function isStepLevelMoment(
  momentType: SkillProcessMomentType
): momentType is SkillProcessStepMomentType {
  return (STEP_LEVEL_MOMENT_TYPES as readonly string[]).includes(momentType);
}

export function allowsTimeoutMoment(stepType: SkillProcessStepType | undefined): boolean {
  return Boolean(stepType && (TIMEOUT_ALLOWED_STEP_TYPES as readonly string[]).includes(stepType));
}

export function allowedOperationsForStateType(
  stateType: SkillInternalStateType | undefined
): SkillProcessStateOperationKind[] {
  if (stateType === 'COUNTER' || stateType === 'AMMO') {
    return ['INCREASE', 'DECREASE', 'CONSUME', 'SET', 'RESET'];
  }
  if (stateType === 'MODE') return ['SELECT'];
  if (stateType === 'FLAG') return ['ENABLE', 'DISABLE', 'TOGGLE'];
  if (stateType === 'INTERNAL_COOLDOWN') return ['START', 'RESET'];
  return [];
}

export function requiresValueFormula(operation: SkillProcessStateOperationKind | ''): boolean {
  return operation === 'INCREASE' || operation === 'DECREASE' || operation === 'CONSUME' || operation === 'SET';
}

export function requiresModeOption(operation: SkillProcessStateOperationKind | ''): boolean {
  return operation === 'SELECT';
}

export function createEmptyMomentDraft(
  momentType: SkillProcessMomentType = 'PROCESS_START'
): SkillProcessMomentDraft {
  return {
    momentType,
    stepKey: ''
  };
}

export function createEmptyStepDraft(
  stepType: SkillProcessStepType = 'IMMEDIATE'
): SkillProcessStepDraft {
  return clearHiddenStepFields({
    stepKey: '',
    name: '',
    stepType,
    description: '',
    sortOrder: '10',
    delayFormulaKey: '',
    repeatCountFormulaKey: '',
    intervalFormulaKey: '',
    firstExecution: stepType === 'PERIODIC'
      ? 'AFTER_INTERVAL'
      : stepType === 'CHANNEL'
        ? 'IMMEDIATE'
        : '',
    durationFormulaKey: '',
    executionCountFormulaKey: '',
    minimumChargeFormulaKey: '',
    maximumChargeFormulaKey: '',
    releaseAtMaximum: true,
    windowFormulaKey: '',
    maximumRecastCountFormulaKey: '',
    consumeMoment: stepType === 'EMPOWERED_BASIC_ATTACK' ? 'ATTACK_HIT' : '',
    originalStepType: null
  });
}

export function createEmptyEffectBindingDraft(): SkillProcessEffectBindingDraft {
  return {
    bindingKey: '',
    effectKey: '',
    momentType: 'PROCESS_START',
    stepKey: '',
    sortOrder: '10',
    originalBindingKey: null
  };
}

export function createEmptyStateOperationDraft(): SkillProcessStateOperationDraft {
  return {
    operationKey: '',
    name: '',
    stateKey: '',
    operation: '',
    valueFormulaKey: '',
    optionKey: '',
    momentType: 'PROCESS_START',
    stepKey: '',
    sortOrder: '10',
    originalOperation: null
  };
}

export function createEmptyProcessDraft(): SkillProcessDraft {
  return {
    processKey: '',
    name: '',
    activationType: 'ACTIVE',
    description: '',
    sortOrder: '0',
    cooldownEnabled: false,
    cooldownDurationFormulaKey: '',
    cooldownMomentType: 'PROCESS_START',
    cooldownStepKey: '',
    steps: [createEmptyStepDraft('IMMEDIATE')],
    effectBindings: [],
    stateOperations: []
  };
}

export function skillProcessToDraft(process: SkillProcess): SkillProcessDraft {
  return {
    processKey: process.processKey,
    name: process.name,
    activationType: process.activationType,
    description: process.description ?? '',
    sortOrder: String(process.sortOrder),
    cooldownEnabled: process.cooldown !== null,
    cooldownDurationFormulaKey: process.cooldown?.durationFormulaKey ?? '',
    cooldownMomentType: process.cooldown?.startMoment.momentType ?? 'PROCESS_START',
    cooldownStepKey: process.cooldown?.startMoment.stepKey ?? '',
    steps: sortStepDrafts(process.steps.map(skillProcessStepToDraft)),
    effectBindings: sortBindingDrafts(process.effectBindings.map(skillProcessBindingToDraft)),
    stateOperations: sortOperationDrafts(process.stateOperations.map(skillProcessOperationToDraft))
  };
}

export function skillProcessStepToDraft(step: SkillProcessStep): SkillProcessStepDraft {
  const draft = createEmptyStepDraft(step.stepType);
  draft.stepKey = step.stepKey;
  draft.name = step.name;
  draft.stepType = step.stepType;
  draft.description = step.description ?? '';
  draft.sortOrder = String(step.sortOrder);
  draft.originalStepType = step.stepType;
  switch (step.stepType) {
    case 'IMMEDIATE':
      break;
    case 'DELAY':
      draft.delayFormulaKey = step.detail.delayFormulaKey;
      break;
    case 'MULTI_HIT':
      draft.repeatCountFormulaKey = step.detail.repeatCountFormulaKey;
      draft.intervalFormulaKey = step.detail.intervalFormulaKey ?? '';
      break;
    case 'PERIODIC':
      draft.repeatCountFormulaKey = step.detail.repeatCountFormulaKey;
      draft.intervalFormulaKey = step.detail.intervalFormulaKey;
      draft.firstExecution = step.detail.firstExecution;
      break;
    case 'CHANNEL':
      draft.durationFormulaKey = step.detail.durationFormulaKey;
      draft.executionCountFormulaKey = step.detail.executionCountFormulaKey;
      draft.firstExecution = step.detail.firstExecution;
      break;
    case 'CHARGE':
      draft.minimumChargeFormulaKey = step.detail.minimumChargeFormulaKey;
      draft.maximumChargeFormulaKey = step.detail.maximumChargeFormulaKey;
      draft.releaseAtMaximum = step.detail.releaseAtMaximum;
      break;
    case 'RECAST':
      draft.windowFormulaKey = step.detail.windowFormulaKey;
      draft.maximumRecastCountFormulaKey = step.detail.maximumRecastCountFormulaKey;
      break;
    case 'EMPOWERED_BASIC_ATTACK':
      draft.windowFormulaKey = step.detail.windowFormulaKey;
      draft.consumeMoment = step.detail.consumeMoment;
      break;
    default: {
      const unexpected: never = step;
      return unexpected;
    }
  }
  return clearHiddenStepFields(draft);
}

export function skillProcessBindingToDraft(
  binding: SkillProcessEffectBinding
): SkillProcessEffectBindingDraft {
  return {
    bindingKey: binding.bindingKey,
    effectKey: binding.effectKey,
    momentType: binding.moment.momentType,
    stepKey: binding.moment.stepKey ?? '',
    sortOrder: String(binding.sortOrder),
    originalBindingKey: binding.bindingKey
  };
}

export function skillProcessOperationToDraft(
  operation: SkillProcessStateOperation
): SkillProcessStateOperationDraft {
  return {
    operationKey: operation.operationKey,
    name: operation.name,
    stateKey: operation.stateKey,
    operation: operation.operation,
    valueFormulaKey: operation.valueFormulaKey ?? '',
    optionKey: operation.optionKey ?? '',
    momentType: operation.moment.momentType,
    stepKey: operation.moment.stepKey ?? '',
    sortOrder: String(operation.sortOrder),
    originalOperation: operation.operation
  };
}

export function applyStepTypeChange(
  draft: SkillProcessStepDraft,
  nextType: SkillProcessStepType
): SkillProcessStepDraft {
  return clearHiddenStepFields({
    ...draft,
    stepType: nextType,
    delayFormulaKey: '',
    repeatCountFormulaKey: '',
    intervalFormulaKey: '',
    firstExecution: nextType === 'PERIODIC'
      ? 'AFTER_INTERVAL'
      : nextType === 'CHANNEL'
        ? 'IMMEDIATE'
        : '',
    durationFormulaKey: '',
    executionCountFormulaKey: '',
    minimumChargeFormulaKey: '',
    maximumChargeFormulaKey: '',
    releaseAtMaximum: true,
    windowFormulaKey: '',
    maximumRecastCountFormulaKey: '',
    consumeMoment: nextType === 'EMPOWERED_BASIC_ATTACK' ? 'ATTACK_HIT' : ''
  });
}

export function clearHiddenStepFields(draft: SkillProcessStepDraft): SkillProcessStepDraft {
  const type = draft.stepType;
  return {
    ...draft,
    delayFormulaKey: type === 'DELAY' ? draft.delayFormulaKey : '',
    repeatCountFormulaKey: type === 'MULTI_HIT' || type === 'PERIODIC' ? draft.repeatCountFormulaKey : '',
    intervalFormulaKey: type === 'MULTI_HIT' || type === 'PERIODIC' ? draft.intervalFormulaKey : '',
    firstExecution: type === 'PERIODIC' || type === 'CHANNEL'
      ? draft.firstExecution || (type === 'PERIODIC' ? 'AFTER_INTERVAL' : 'IMMEDIATE')
      : '',
    durationFormulaKey: type === 'CHANNEL' ? draft.durationFormulaKey : '',
    executionCountFormulaKey: type === 'CHANNEL' ? draft.executionCountFormulaKey : '',
    minimumChargeFormulaKey: type === 'CHARGE' ? draft.minimumChargeFormulaKey : '',
    maximumChargeFormulaKey: type === 'CHARGE' ? draft.maximumChargeFormulaKey : '',
    releaseAtMaximum: type === 'CHARGE' ? draft.releaseAtMaximum : true,
    windowFormulaKey: type === 'RECAST' || type === 'EMPOWERED_BASIC_ATTACK' ? draft.windowFormulaKey : '',
    maximumRecastCountFormulaKey: type === 'RECAST' ? draft.maximumRecastCountFormulaKey : '',
    consumeMoment: type === 'EMPOWERED_BASIC_ATTACK' ? draft.consumeMoment || 'ATTACK_HIT' : ''
  };
}

export function applyStateOperationChange(
  draft: SkillProcessStateOperationDraft,
  nextOperation: SkillProcessStateOperationKind
): SkillProcessStateOperationDraft {
  return {
    ...draft,
    operation: nextOperation,
    valueFormulaKey: requiresValueFormula(nextOperation) ? draft.valueFormulaKey : '',
    optionKey: requiresModeOption(nextOperation) ? draft.optionKey : ''
  };
}

export function applyStateKeyChange(
  draft: SkillProcessStateOperationDraft,
  nextStateKey: string,
  stateType: SkillInternalStateType | undefined
): SkillProcessStateOperationDraft {
  const allowed = allowedOperationsForStateType(stateType);
  const nextOperation = allowed.includes(draft.operation as SkillProcessStateOperationKind)
    ? (draft.operation as SkillProcessStateOperationKind)
    : allowed[0];
  if (!nextOperation) {
    return {
      ...draft,
      stateKey: nextStateKey,
      operation: '',
      valueFormulaKey: '',
      optionKey: ''
    };
  }
  return applyStateOperationChange({
    ...draft,
    stateKey: nextStateKey
  }, nextOperation);
}

export function sortStepDrafts(steps: SkillProcessStepDraft[]): SkillProcessStepDraft[] {
  return sortByOrderAndKey(steps, (item) => item.sortOrder, (item) => item.stepKey);
}

export function sortBindingDrafts(
  bindings: SkillProcessEffectBindingDraft[]
): SkillProcessEffectBindingDraft[] {
  return sortByOrderAndKey(bindings, (item) => item.sortOrder, (item) => item.bindingKey);
}

export function sortOperationDrafts(
  operations: SkillProcessStateOperationDraft[]
): SkillProcessStateOperationDraft[] {
  return sortByOrderAndKey(operations, (item) => item.sortOrder, (item) => item.operationKey);
}

export function findStepDeleteBlockers(
  stepKey: string,
  draft: SkillProcessDraft
): StepDeleteBlocker[] {
  const trimmed = stepKey.trim();
  if (!trimmed) return [];
  const blockers: StepDeleteBlocker[] = [];
  if (draft.cooldownEnabled && isStepLevelMoment(draft.cooldownMomentType) && draft.cooldownStepKey.trim() === trimmed) {
    blockers.push({ area: 'cooldown', key: 'cooldown', label: '普通冷却' });
  }
  for (const binding of draft.effectBindings) {
    if (isStepLevelMoment(binding.momentType) && binding.stepKey.trim() === trimmed) {
      blockers.push({
        area: 'effectBindings',
        key: binding.bindingKey.trim() || binding.effectKey.trim() || '未命名挂接',
        label: `效果挂接 ${binding.bindingKey.trim() || binding.effectKey.trim() || '未命名挂接'}`
      });
    }
  }
  for (const operation of draft.stateOperations) {
    if (isStepLevelMoment(operation.momentType) && operation.stepKey.trim() === trimmed) {
      blockers.push({
        area: 'stateOperations',
        key: operation.operationKey.trim() || operation.name.trim() || '未命名操作',
        label: `内部状态操作 ${operation.operationKey.trim() || operation.name.trim() || '未命名操作'}`
      });
    }
  }
  return blockers;
}

export function stepSummary(step: SkillProcessStepDraft): string {
  switch (step.stepType) {
    case 'IMMEDIATE':
      return '—';
    case 'DELAY':
      return step.delayFormulaKey || '—';
    case 'MULTI_HIT':
      return step.intervalFormulaKey
        ? `${step.repeatCountFormulaKey || '—'} / ${step.intervalFormulaKey}`
        : (step.repeatCountFormulaKey || '—');
    case 'PERIODIC':
      return `${step.repeatCountFormulaKey || '—'} / ${step.intervalFormulaKey || '—'}`;
    case 'CHANNEL':
      return `${step.durationFormulaKey || '—'} / ${step.executionCountFormulaKey || '—'}`;
    case 'CHARGE':
      return `${step.minimumChargeFormulaKey || '—'} ~ ${step.maximumChargeFormulaKey || '—'}`;
    case 'RECAST':
      return `${step.windowFormulaKey || '—'} / ${step.maximumRecastCountFormulaKey || '—'}`;
    case 'EMPOWERED_BASIC_ATTACK':
      return `${step.windowFormulaKey || '—'} / ${step.consumeMoment ? EMPOWERED_CONSUME_MOMENT_LABELS[step.consumeMoment] : '—'}`;
    default: {
      const unexpected: never = step.stepType;
      return unexpected;
    }
  }
}

export function operationValueSummary(operation: SkillProcessStateOperationDraft): string {
  if (requiresValueFormula(operation.operation)) return operation.valueFormulaKey || '—';
  if (requiresModeOption(operation.operation)) return operation.optionKey || '—';
  return '—';
}

export function stepExecutionMomentHint(stepType: SkillProcessStepType | undefined): string | null {
  return stepType === 'EMPOWERED_BASIC_ATTACK' ? EMPOWERED_STEP_EXECUTION_HINT : null;
}

export function listFormulaOptions(catalog: ProcessFormCatalog, currentKey = ''): CatalogRefOption[] {
  return appendUnknown(catalog.formulas.map((item) => item.formulaKey), currentKey);
}

export function listEffectOptions(catalog: ProcessFormCatalog, currentKey = ''): CatalogRefOption[] {
  return appendUnknown(catalog.effects.map((item) => item.effectKey), currentKey);
}

export function listInternalStateOptions(catalog: ProcessFormCatalog, currentKey = ''): CatalogRefOption[] {
  return appendUnknown(catalog.internalStates.map((item) => item.stateKey), currentKey);
}

export function listModeOptionOptions(
  catalog: ProcessFormCatalog,
  stateKey: string,
  currentKey = ''
): CatalogRefOption[] {
  const options = catalog.modeOptionsByStateKey[stateKey] ?? [];
  return appendUnknown(options.map((item) => item.optionKey), currentKey);
}

export function listStepOptions(steps: SkillProcessStepDraft[], currentKey = ''): CatalogRefOption[] {
  return appendUnknown(steps.map((item) => item.stepKey.trim()).filter(Boolean), currentKey);
}

export function isCatalogOptionSelectable(option: CatalogRefOption): boolean {
  return option.source !== 'unknown';
}

export function validateSkillProcessDraft(
  draft: SkillProcessDraft,
  options: SkillProcessFormValidationOptions
): SkillProcessFormValidation {
  const sorted: SkillProcessDraft = {
    ...draft,
    steps: sortStepDrafts(draft.steps.map(clearHiddenStepFields)),
    effectBindings: sortBindingDrafts(draft.effectBindings),
    stateOperations: sortOperationDrafts(draft.stateOperations)
  };
  const fieldErrors: SkillProcessDraftErrors = {};
  const stepErrors: IndexedFieldErrors<SkillProcessStepDraftErrors>[] = [];
  const bindingErrors: IndexedFieldErrors<SkillProcessEffectBindingDraftErrors>[] = [];
  const operationErrors: IndexedFieldErrors<SkillProcessStateOperationDraftErrors>[] = [];
  const processKey = sorted.processKey.trim();
  const name = sorted.name.trim();
  const description = sorted.description.trim();

  if (options.includeProcessKey) {
    if (!processKey) {
      fieldErrors.processKey = '过程标识不能为空。';
    } else if (!SKILL_PROCESS_KEY_PATTERN.test(processKey)) {
      fieldErrors.processKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
    }
  }

  if (!name) {
    fieldErrors.name = '过程名称不能为空。';
  } else if (name.length > 100) {
    fieldErrors.name = '过程名称不能超过 100 个字符。';
  }

  if (description.length > 2000) {
    fieldErrors.description = '说明不能超过 2000 个字符。';
  }

  if (!(SKILL_PROCESS_ACTIVATION_TYPES as readonly string[]).includes(sorted.activationType)) {
    fieldErrors.activationType = '请选择启动方式。';
  }

  const sortOrder = parseNonNegativeInteger(sorted.sortOrder, fieldErrors, 'sortOrder');
  const builtSteps: SkillProcessStep[] = [];
  const seenStepKeys = new Map<string, number>();

  if (sorted.steps.length === 0) {
    fieldErrors.steps = '至少需要一个步骤。';
  }

  for (let index = 0; index < sorted.steps.length; index += 1) {
    const stepFieldErrors: SkillProcessStepDraftErrors = {};
    const built = validateAndBuildStep(sorted.steps[index]!, options, seenStepKeys, index, stepFieldErrors);
    if (Object.keys(stepFieldErrors).length > 0) {
      stepErrors.push({ index, fieldErrors: stepFieldErrors });
    } else if (built) {
      builtSteps.push(built);
    }
  }

  const cooldown = validateAndBuildCooldown(sorted, builtSteps, options, fieldErrors);
  const builtBindings: SkillProcessEffectBinding[] = [];
  const seenBindingKeys = new Map<string, number>();
  for (let index = 0; index < sorted.effectBindings.length; index += 1) {
    const bindingFieldErrors: SkillProcessEffectBindingDraftErrors = {};
    const built = validateAndBuildBinding(
      sorted.effectBindings[index]!,
      builtSteps,
      options,
      seenBindingKeys,
      bindingFieldErrors
    );
    if (Object.keys(bindingFieldErrors).length > 0) {
      bindingErrors.push({ index, fieldErrors: bindingFieldErrors });
    } else if (built) {
      builtBindings.push(built);
    }
  }

  const builtOperations: SkillProcessStateOperation[] = [];
  const seenOperationKeys = new Map<string, number>();
  for (let index = 0; index < sorted.stateOperations.length; index += 1) {
    const operationFieldErrors: SkillProcessStateOperationDraftErrors = {};
    const built = validateAndBuildOperation(
      sorted.stateOperations[index]!,
      builtSteps,
      options,
      seenOperationKeys,
      operationFieldErrors
    );
    if (Object.keys(operationFieldErrors).length > 0) {
      operationErrors.push({ index, fieldErrors: operationFieldErrors });
    } else if (built) {
      builtOperations.push(built);
    }
  }

  if (sorted.effectBindings.length === 0 && sorted.stateOperations.length === 0) {
    fieldErrors.effectBindings = PROCESS_BEHAVIOR_REQUIRED_MESSAGE;
    fieldErrors.stateOperations = PROCESS_BEHAVIOR_REQUIRED_MESSAGE;
  }

  if (
    Object.keys(fieldErrors).length > 0
    || stepErrors.length > 0
    || bindingErrors.length > 0
    || operationErrors.length > 0
    || sortOrder === null
  ) {
    return { ok: false, fieldErrors, stepErrors, bindingErrors, operationErrors };
  }

  return {
    ok: true,
    normalized: {
      processKey,
      name,
      activationType: sorted.activationType,
      description: description || null,
      sortOrder: sortOrder ?? 0,
      cooldown,
      steps: builtSteps,
      effectBindings: builtBindings,
      stateOperations: builtOperations
    }
  };
}

export function buildCreateSkillProcessRequest(
  normalized: NormalizedSkillProcessForm
): CreateSkillProcessRequest {
  return cloneProcessRequest(normalized);
}

export function buildUpdateSkillProcessRequest(
  normalized: NormalizedSkillProcessForm
): UpdateSkillProcessRequest {
  const { processKey: _processKey, ...rest } = cloneProcessRequest(normalized);
  void _processKey;
  return rest;
}

export function mapSkillProcessFieldIssues(source: unknown): MappedSkillProcessFieldIssues {
  const fieldErrors: SkillProcessDraftErrors = {};
  const stepErrorMap = new Map<number, SkillProcessStepDraftErrors>();
  const bindingErrorMap = new Map<number, SkillProcessEffectBindingDraftErrors>();
  const operationErrorMap = new Map<number, SkillProcessStateOperationDraftErrors>();
  const unmappedMessages: string[] = [];
  const details = extractDetails(source);
  if (!isRecord(details) || !Array.isArray(details.fieldIssues)) {
    return { fieldErrors, stepErrors: [], bindingErrors: [], operationErrors: [], unmappedMessages };
  }

  for (const rawIssue of details.fieldIssues) {
    if (!isRecord(rawIssue)) continue;
    const field = typeof rawIssue.field === 'string' ? rawIssue.field : '';
    const message = typeof rawIssue.message === 'string' && rawIssue.message.trim()
      ? rawIssue.message.trim()
      : '字段值不合法。';
    const stepMatch = INDEXED_STEP_PATH.exec(field);
    if (stepMatch) {
      const index = Number(stepMatch[1]);
      const nested = stepMatch[2] ?? '';
      const mapped = nested ? STEP_FIELD_BY_PATH[nested] ?? null : 'stepKey';
      if (!Number.isInteger(index) || index < 0 || mapped === null) {
        unmappedMessages.push(message);
        continue;
      }
      const current = stepErrorMap.get(index) ?? {};
      current[mapped] = message;
      stepErrorMap.set(index, current);
      continue;
    }
    const bindingMatch = INDEXED_BINDING_PATH.exec(field);
    if (bindingMatch) {
      const index = Number(bindingMatch[1]);
      const nested = bindingMatch[2] ?? '';
      const mapped = nested ? BINDING_FIELD_BY_PATH[nested] ?? null : 'bindingKey';
      if (!Number.isInteger(index) || index < 0 || mapped === null) {
        unmappedMessages.push(message);
        continue;
      }
      const current = bindingErrorMap.get(index) ?? {};
      current[mapped] = message;
      bindingErrorMap.set(index, current);
      continue;
    }
    const operationMatch = INDEXED_OPERATION_PATH.exec(field);
    if (operationMatch) {
      const index = Number(operationMatch[1]);
      const nested = operationMatch[2] ?? '';
      const mapped = nested ? OPERATION_FIELD_BY_PATH[nested] ?? null : 'operationKey';
      if (!Number.isInteger(index) || index < 0 || mapped === null) {
        unmappedMessages.push(message);
        continue;
      }
      const current = operationErrorMap.get(index) ?? {};
      current[mapped] = message;
      operationErrorMap.set(index, current);
      continue;
    }
    const mappedProcess = mapProcessIssueField(field);
    if (mappedProcess) {
      fieldErrors[mappedProcess] = message;
    } else {
      unmappedMessages.push(message);
    }
  }

  return {
    fieldErrors,
    stepErrors: toSortedIndexErrors(stepErrorMap),
    bindingErrors: toSortedIndexErrors(bindingErrorMap),
    operationErrors: toSortedIndexErrors(operationErrorMap),
    unmappedMessages
  };
}

function validateAndBuildStep(
  draft: SkillProcessStepDraft,
  options: SkillProcessFormValidationOptions,
  seenKeys: Map<string, number>,
  index: number,
  fieldErrors: SkillProcessStepDraftErrors
): SkillProcessStep | null {
  const stepKey = draft.stepKey.trim();
  const name = draft.name.trim();
  const description = draft.description.trim();
  if (!stepKey) {
    fieldErrors.stepKey = '步骤标识不能为空。';
  } else if (!SKILL_PROCESS_KEY_PATTERN.test(stepKey)) {
    fieldErrors.stepKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
  } else if (seenKeys.has(stepKey)) {
    fieldErrors.stepKey = '步骤标识不能重复。';
  } else {
    seenKeys.set(stepKey, index);
  }
  if (!name) {
    fieldErrors.name = '步骤名称不能为空。';
  } else if (name.length > 100) {
    fieldErrors.name = '步骤名称不能超过 100 个字符。';
  }
  if (description.length > 2000) {
    fieldErrors.description = '说明不能超过 2000 个字符。';
  }
  if (!(SKILL_PROCESS_STEP_TYPES as readonly string[]).includes(draft.stepType)) {
    fieldErrors.stepType = '请选择步骤种类。';
  } else if (draft.originalStepType && draft.stepType !== draft.originalStepType) {
    fieldErrors.stepType = '已有步骤的种类不可修改。';
  }
  const sortOrder = parseNonNegativeInteger(draft.sortOrder, fieldErrors, 'sortOrder');
  validateStepDetail(draft, options, fieldErrors);
  if (Object.keys(fieldErrors).length > 0 || sortOrder === null) return null;
  return buildStep(draft, stepKey, name, description || null, sortOrder);
}

function validateStepDetail(
  draft: SkillProcessStepDraft,
  options: SkillProcessFormValidationOptions,
  fieldErrors: SkillProcessStepDraftErrors
): void {
  switch (draft.stepType) {
    case 'IMMEDIATE':
      break;
    case 'DELAY':
      requireNonEmpty(draft.delayFormulaKey, fieldErrors, 'delayFormulaKey', '请选择延迟公式。');
      validateFormulaRef(options, draft.delayFormulaKey, fieldErrors, 'delayFormulaKey');
      break;
    case 'MULTI_HIT':
      requireNonEmpty(draft.repeatCountFormulaKey, fieldErrors, 'repeatCountFormulaKey', '请选择执行次数公式。');
      validateFormulaRef(options, draft.repeatCountFormulaKey, fieldErrors, 'repeatCountFormulaKey');
      if (draft.intervalFormulaKey.trim()) {
        validateFormulaRef(options, draft.intervalFormulaKey, fieldErrors, 'intervalFormulaKey');
      }
      break;
    case 'PERIODIC':
      requireNonEmpty(draft.repeatCountFormulaKey, fieldErrors, 'repeatCountFormulaKey', '请选择执行次数公式。');
      requireNonEmpty(draft.intervalFormulaKey, fieldErrors, 'intervalFormulaKey', '请选择间隔公式。');
      if (draft.firstExecution !== 'IMMEDIATE' && draft.firstExecution !== 'AFTER_INTERVAL') {
        fieldErrors.firstExecution = '请选择首次执行时机。';
      }
      validateFormulaRef(options, draft.repeatCountFormulaKey, fieldErrors, 'repeatCountFormulaKey');
      validateFormulaRef(options, draft.intervalFormulaKey, fieldErrors, 'intervalFormulaKey');
      break;
    case 'CHANNEL':
      requireNonEmpty(draft.durationFormulaKey, fieldErrors, 'durationFormulaKey', '请选择持续时间公式。');
      requireNonEmpty(draft.executionCountFormulaKey, fieldErrors, 'executionCountFormulaKey', '请选择执行次数公式。');
      if (draft.firstExecution !== 'IMMEDIATE' && draft.firstExecution !== 'AFTER_INTERVAL') {
        fieldErrors.firstExecution = '请选择首次执行时机。';
      }
      validateFormulaRef(options, draft.durationFormulaKey, fieldErrors, 'durationFormulaKey');
      validateFormulaRef(options, draft.executionCountFormulaKey, fieldErrors, 'executionCountFormulaKey');
      break;
    case 'CHARGE':
      requireNonEmpty(draft.minimumChargeFormulaKey, fieldErrors, 'minimumChargeFormulaKey', '请选择最短蓄力公式。');
      requireNonEmpty(draft.maximumChargeFormulaKey, fieldErrors, 'maximumChargeFormulaKey', '请选择最长蓄力公式。');
      validateFormulaRef(options, draft.minimumChargeFormulaKey, fieldErrors, 'minimumChargeFormulaKey');
      validateFormulaRef(options, draft.maximumChargeFormulaKey, fieldErrors, 'maximumChargeFormulaKey');
      break;
    case 'RECAST':
      requireNonEmpty(draft.windowFormulaKey, fieldErrors, 'windowFormulaKey', '请选择重施窗口公式。');
      requireNonEmpty(draft.maximumRecastCountFormulaKey, fieldErrors, 'maximumRecastCountFormulaKey', '请选择最大重施次数公式。');
      validateFormulaRef(options, draft.windowFormulaKey, fieldErrors, 'windowFormulaKey');
      validateFormulaRef(options, draft.maximumRecastCountFormulaKey, fieldErrors, 'maximumRecastCountFormulaKey');
      break;
    case 'EMPOWERED_BASIC_ATTACK':
      requireNonEmpty(draft.windowFormulaKey, fieldErrors, 'windowFormulaKey', '请选择有效窗口公式。');
      if (draft.consumeMoment !== 'ATTACK_START' && draft.consumeMoment !== 'ATTACK_HIT') {
        fieldErrors.consumeMoment = '请选择消耗时点。';
      }
      validateFormulaRef(options, draft.windowFormulaKey, fieldErrors, 'windowFormulaKey');
      break;
    default: {
      const unexpected: never = draft.stepType;
      void unexpected;
    }
  }
}

function buildStep(
  draft: SkillProcessStepDraft,
  stepKey: string,
  name: string,
  description: string | null,
  sortOrder: number
): SkillProcessStep {
  const base = { stepKey, name, description, sortOrder };
  switch (draft.stepType) {
    case 'IMMEDIATE':
      return { ...base, stepType: 'IMMEDIATE', detail: {} };
    case 'DELAY':
      return { ...base, stepType: 'DELAY', detail: { delayFormulaKey: draft.delayFormulaKey.trim() } };
    case 'MULTI_HIT':
      return {
        ...base,
        stepType: 'MULTI_HIT',
        detail: {
          repeatCountFormulaKey: draft.repeatCountFormulaKey.trim(),
          intervalFormulaKey: draft.intervalFormulaKey.trim() || null
        }
      };
    case 'PERIODIC':
      return {
        ...base,
        stepType: 'PERIODIC',
        detail: {
          repeatCountFormulaKey: draft.repeatCountFormulaKey.trim(),
          intervalFormulaKey: draft.intervalFormulaKey.trim(),
          firstExecution: draft.firstExecution as SkillProcessFirstExecution
        }
      };
    case 'CHANNEL':
      return {
        ...base,
        stepType: 'CHANNEL',
        detail: {
          durationFormulaKey: draft.durationFormulaKey.trim(),
          executionCountFormulaKey: draft.executionCountFormulaKey.trim(),
          firstExecution: draft.firstExecution as SkillProcessFirstExecution
        }
      };
    case 'CHARGE':
      return {
        ...base,
        stepType: 'CHARGE',
        detail: {
          minimumChargeFormulaKey: draft.minimumChargeFormulaKey.trim(),
          maximumChargeFormulaKey: draft.maximumChargeFormulaKey.trim(),
          releaseAtMaximum: draft.releaseAtMaximum
        }
      };
    case 'RECAST':
      return {
        ...base,
        stepType: 'RECAST',
        detail: {
          windowFormulaKey: draft.windowFormulaKey.trim(),
          maximumRecastCountFormulaKey: draft.maximumRecastCountFormulaKey.trim()
        }
      };
    case 'EMPOWERED_BASIC_ATTACK':
      return {
        ...base,
        stepType: 'EMPOWERED_BASIC_ATTACK',
        detail: {
          windowFormulaKey: draft.windowFormulaKey.trim(),
          consumeMoment: draft.consumeMoment as SkillProcessEmpoweredConsumeMoment
        }
      };
    default: {
      const unexpected: never = draft.stepType;
      return unexpected;
    }
  }
}

function validateAndBuildCooldown(
  draft: SkillProcessDraft,
  steps: SkillProcessStep[],
  options: SkillProcessFormValidationOptions,
  fieldErrors: SkillProcessDraftErrors
): SkillProcessCooldown | null {
  if (!draft.cooldownEnabled) return null;
  const durationFormulaKey = draft.cooldownDurationFormulaKey.trim();
  if (!durationFormulaKey) {
    fieldErrors.cooldownDurationFormulaKey = '请选择冷却时长公式。';
  } else {
    validateFormulaRef(options, durationFormulaKey, fieldErrors, 'cooldownDurationFormulaKey');
  }
  const moment = validateMoment(
    { momentType: draft.cooldownMomentType, stepKey: draft.cooldownStepKey },
    steps,
    fieldErrors,
    'cooldownMoment'
  );
  if (!moment || fieldErrors.cooldownDurationFormulaKey || fieldErrors.cooldownMoment) return null;
  return { durationFormulaKey, startMoment: moment };
}

function validateAndBuildBinding(
  draft: SkillProcessEffectBindingDraft,
  steps: SkillProcessStep[],
  options: SkillProcessFormValidationOptions,
  seenKeys: Map<string, number>,
  fieldErrors: SkillProcessEffectBindingDraftErrors
): SkillProcessEffectBinding | null {
  const bindingKey = draft.bindingKey.trim();
  const effectKey = draft.effectKey.trim();
  if (!bindingKey) {
    fieldErrors.bindingKey = '挂接标识不能为空。';
  } else if (!SKILL_PROCESS_KEY_PATTERN.test(bindingKey)) {
    fieldErrors.bindingKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
  } else if (seenKeys.has(bindingKey)) {
    fieldErrors.bindingKey = '挂接标识不能重复。';
  } else {
    seenKeys.set(bindingKey, 1);
  }
  if (draft.originalBindingKey && bindingKey !== draft.originalBindingKey) {
    fieldErrors.bindingKey = '已有挂接的标识不可修改。';
  }
  if (!effectKey) {
    fieldErrors.effectKey = '请选择效果。';
  } else {
    validateCatalogKey(options, 'effects', effectKey, fieldErrors, 'effectKey');
  }
  const sortOrder = parseNonNegativeInteger(draft.sortOrder, fieldErrors, 'sortOrder');
  const moment = validateMoment(
    { momentType: draft.momentType, stepKey: draft.stepKey },
    steps,
    fieldErrors,
    'moment'
  );
  if (Object.keys(fieldErrors).length > 0 || sortOrder === null || !moment) return null;
  return { bindingKey, effectKey, moment, sortOrder };
}

function validateAndBuildOperation(
  draft: SkillProcessStateOperationDraft,
  steps: SkillProcessStep[],
  options: SkillProcessFormValidationOptions,
  seenKeys: Map<string, number>,
  fieldErrors: SkillProcessStateOperationDraftErrors
): SkillProcessStateOperation | null {
  const operationKey = draft.operationKey.trim();
  const name = draft.name.trim();
  const stateKey = draft.stateKey.trim();
  if (!operationKey) {
    fieldErrors.operationKey = '操作标识不能为空。';
  } else if (!SKILL_PROCESS_KEY_PATTERN.test(operationKey)) {
    fieldErrors.operationKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
  } else if (seenKeys.has(operationKey)) {
    fieldErrors.operationKey = '操作标识不能重复。';
  } else {
    seenKeys.set(operationKey, 1);
  }
  if (!name) {
    fieldErrors.name = '操作名称不能为空。';
  } else if (name.length > 100) {
    fieldErrors.name = '操作名称不能超过 100 个字符。';
  }
  if (!stateKey) {
    fieldErrors.stateKey = '请选择内部状态。';
  } else {
    validateCatalogKey(options, 'internalStates', stateKey, fieldErrors, 'stateKey');
  }
  const stateType = options.catalog?.internalStates.find((item) => item.stateKey === stateKey)?.stateType;
  const allowed = allowedOperationsForStateType(stateType);
  if (!draft.operation) {
    fieldErrors.operation = '请选择操作。';
  } else if (stateType && !allowed.includes(draft.operation)) {
    fieldErrors.operation = '该内部状态不支持此操作。';
  } else if (draft.originalOperation && draft.operation !== draft.originalOperation) {
    fieldErrors.operation = '已有操作的种类不可修改。';
  }
  if (requiresValueFormula(draft.operation)) {
    requireNonEmpty(draft.valueFormulaKey, fieldErrors, 'valueFormulaKey', '请选择数值公式。');
    validateFormulaRef(options, draft.valueFormulaKey, fieldErrors, 'valueFormulaKey');
    if (draft.optionKey.trim()) {
      fieldErrors.optionKey = '该操作不能选择模式选项。';
    }
  } else if (requiresModeOption(draft.operation)) {
    requireNonEmpty(draft.optionKey, fieldErrors, 'optionKey', '请选择模式选项。');
    if (draft.valueFormulaKey.trim()) {
      fieldErrors.valueFormulaKey = '模式选择不能携带数值公式。';
    }
    if (stateKey && draft.optionKey.trim()) {
      validateModeOptionRef(options, stateKey, draft.optionKey, fieldErrors);
    }
  } else if (draft.operation) {
    if (draft.valueFormulaKey.trim()) {
      fieldErrors.valueFormulaKey = '该操作不能携带数值公式。';
    }
    if (draft.optionKey.trim()) {
      fieldErrors.optionKey = '该操作不能选择模式选项。';
    }
  }
  const sortOrder = parseNonNegativeInteger(draft.sortOrder, fieldErrors, 'sortOrder');
  const moment = validateMoment(
    { momentType: draft.momentType, stepKey: draft.stepKey },
    steps,
    fieldErrors,
    'moment'
  );
  if (Object.keys(fieldErrors).length > 0 || sortOrder === null || !moment || !draft.operation) return null;
  return buildOperation(draft, operationKey, name, stateKey, moment, sortOrder);
}

function buildOperation(
  draft: SkillProcessStateOperationDraft,
  operationKey: string,
  name: string,
  stateKey: string,
  moment: SkillProcessMoment,
  sortOrder: number
): SkillProcessStateOperation {
  const base = { operationKey, name, stateKey, moment, sortOrder };
  const operation = draft.operation as SkillProcessStateOperationKind;
  if (requiresValueFormula(operation)) {
    return {
      ...base,
      operation: operation as 'INCREASE' | 'DECREASE' | 'CONSUME' | 'SET',
      valueFormulaKey: draft.valueFormulaKey.trim(),
      optionKey: null
    };
  }
  if (operation === 'SELECT') {
    return {
      ...base,
      operation: 'SELECT',
      valueFormulaKey: null,
      optionKey: draft.optionKey.trim()
    };
  }
  if (operation === 'ENABLE' || operation === 'DISABLE' || operation === 'TOGGLE') {
    return {
      ...base,
      operation,
      valueFormulaKey: null,
      optionKey: null
    };
  }
  return {
    ...base,
    operation: operation as 'START' | 'RESET',
    valueFormulaKey: null,
    optionKey: null
  };
}

function validateMoment(
  draft: SkillProcessMomentDraft,
  steps: SkillProcessStep[],
  fieldErrors: SkillProcessDraftErrors | SkillProcessEffectBindingDraftErrors | SkillProcessStateOperationDraftErrors,
  field: 'moment' | 'cooldownMoment'
): SkillProcessMoment | null {
  if (!(SKILL_PROCESS_MOMENT_TYPES as readonly string[]).includes(draft.momentType)) {
    assignMomentError(fieldErrors, field, '请选择过程时点。');
    return null;
  }
  if (isProcessLevelMoment(draft.momentType)) {
    if (draft.stepKey.trim()) {
      assignMomentError(fieldErrors, field, '过程级时点不能携带步骤。');
      return null;
    }
    return { momentType: draft.momentType, stepKey: null };
  }
  const stepKey = draft.stepKey.trim();
  if (!stepKey) {
    assignMomentError(fieldErrors, field, '请选择步骤。');
    return null;
  }
  const step = steps.find((item) => item.stepKey === stepKey);
  if (!step) {
    assignMomentError(fieldErrors, field, '请选择当前过程中的步骤。');
    return null;
  }
  if (draft.momentType === 'STEP_TIMEOUT' && !allowsTimeoutMoment(step.stepType)) {
    assignMomentError(fieldErrors, field, '超时时点只允许蓄力、重施或强化下一次普通攻击步骤。');
    return null;
  }
  return { momentType: draft.momentType, stepKey };
}

function assignMomentError(
  fieldErrors: SkillProcessDraftErrors | SkillProcessEffectBindingDraftErrors | SkillProcessStateOperationDraftErrors,
  field: 'moment' | 'cooldownMoment',
  message: string
): void {
  if (field === 'cooldownMoment') {
    (fieldErrors as SkillProcessDraftErrors).cooldownMoment = message;
    return;
  }
  (fieldErrors as SkillProcessEffectBindingDraftErrors | SkillProcessStateOperationDraftErrors).moment = message;
}

function validateFormulaRef<T>(
  options: SkillProcessFormValidationOptions,
  currentKey: string,
  fieldErrors: T,
  field: keyof T
): void {
  validateCatalogKey(options, 'formulas', currentKey, fieldErrors, field);
}

function validateCatalogKey<T>(
  options: SkillProcessFormValidationOptions,
  kind: 'formulas' | 'effects' | 'internalStates',
  currentKey: string,
  fieldErrors: T,
  field: keyof T
): void {
  if (fieldErrors[field]) return;
  const trimmed = currentKey.trim();
  if (!trimmed) return;
  if (options.catalogLoadState?.[kind] === 'failed') {
    fieldErrors[field] = INCOMPLETE_CATALOG_MESSAGE as T[keyof T];
    return;
  }
  const catalog = options.catalog;
  if (!catalog) return;
  const exists = kind === 'formulas'
    ? catalog.formulas.some((item) => item.formulaKey === trimmed)
    : kind === 'effects'
      ? catalog.effects.some((item) => item.effectKey === trimmed)
      : catalog.internalStates.some((item) => item.stateKey === trimmed);
  if (!exists) {
    fieldErrors[field] = INCOMPLETE_CATALOG_MESSAGE as T[keyof T];
  }
}

function validateModeOptionRef(
  options: SkillProcessFormValidationOptions,
  stateKey: string,
  optionKey: string,
  fieldErrors: SkillProcessStateOperationDraftErrors
): void {
  if (fieldErrors.optionKey) return;
  if (options.catalogLoadState?.modeOptions === 'failed' || options.catalogLoadState?.internalStates === 'failed') {
    fieldErrors.optionKey = INCOMPLETE_CATALOG_MESSAGE;
    return;
  }
  const catalog = options.catalog;
  if (!catalog) return;
  const modeOptions = catalog.modeOptionsByStateKey[stateKey];
  if (!modeOptions || !modeOptions.some((item) => item.optionKey === optionKey.trim())) {
    fieldErrors.optionKey = INCOMPLETE_CATALOG_MESSAGE;
  }
}

function cloneProcessRequest(request: CreateSkillProcessRequest): CreateSkillProcessRequest {
  return JSON.parse(JSON.stringify(request)) as CreateSkillProcessRequest;
}

function mapProcessIssueField(field: string): SkillProcessDraftField | null {
  if (PROCESS_DRAFT_FIELDS.has(field as SkillProcessDraftField)) {
    return field as SkillProcessDraftField;
  }
  if (field === 'cooldown.durationFormulaKey') return 'cooldownDurationFormulaKey';
  if (field === 'cooldown.startMoment' || field.startsWith('cooldown.startMoment.')) return 'cooldownMoment';
  return null;
}

function toSortedIndexErrors<T>(map: Map<number, T>): IndexedFieldErrors<T>[] {
  return [...map.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([index, fieldErrors]) => ({ index, fieldErrors }));
}

function appendUnknown(keys: string[], currentKey: string): CatalogRefOption[] {
  const options: CatalogRefOption[] = keys.filter(Boolean).map((key) => ({ key, source: 'catalog' }));
  const trimmed = currentKey.trim();
  if (trimmed && !options.some((item) => item.key === trimmed)) {
    options.push({ key: trimmed, source: 'unknown' });
  }
  return options;
}

function sortByOrderAndKey<T>(
  items: T[],
  orderOf: (item: T) => string,
  keyOf: (item: T) => string
): T[] {
  return [...items].sort((left, right) => {
    const leftOrder = Number(orderOf(left).trim());
    const rightOrder = Number(orderOf(right).trim());
    const leftValue = Number.isFinite(leftOrder) ? leftOrder : 0;
    const rightValue = Number.isFinite(rightOrder) ? rightOrder : 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
    return keyOf(left).trim().localeCompare(keyOf(right).trim());
  });
}

function requireNonEmpty<T>(
  value: string,
  fieldErrors: T,
  field: keyof T,
  message: string
): void {
  if (!value.trim()) {
    fieldErrors[field] = message as T[keyof T];
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

function extractDetails(source: unknown): unknown {
  if (source instanceof ApiRequestError) return source.details;
  if (isRecord(source) && 'details' in source) return source.details;
  return source;
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}
