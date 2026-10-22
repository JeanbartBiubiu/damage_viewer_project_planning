import type { SkillParameter } from '../../../../types/skillParameter';
import { sceneInitialParameterDetailIssue } from '../../../../services/sceneInitialParameterContract';
import { isCounterTargetTiming } from '../../../../services/counterTargetTiming';
import type { SkillTriggerSceneInitialParameterBinding } from '../../../../types/skillTriggerRule';
import { numericIssuePath, numericValueError } from '../numericValueForm';
import { numericFormulaKey } from '../../../../types/numericValue';
import { type NumericValue } from '../../../../types/numericValue';
import { ApiRequestError } from '../../../../services/apiClient';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type {
  CreateSkillInternalStateRequest,
  SkillInternalState,
  CounterTargetTiming,
  SkillInternalStateAmmoRecoveryMode,
  SkillInternalStateAmmoRecoveryStartCondition,
  SkillInternalStateModeOption,
  SkillInternalStateScope,
  SkillInternalStateType,
  UpdateSkillInternalStateRequest
} from '../../../../types/skillInternalState';

export const SKILL_INTERNAL_STATE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const SKILL_INTERNAL_STATE_TYPES = [
  'COUNTER',
  'AMMO',
  'MODE',
  'FLAG',
  'INTERNAL_COOLDOWN'
] as const satisfies readonly SkillInternalStateType[];

export const SKILL_INTERNAL_STATE_TYPE_LABELS = {
  COUNTER: '计数',
  AMMO: '弹药',
  MODE: '模式',
  FLAG: '准备标记',
  INTERNAL_COOLDOWN: '内部冷却'
} as const satisfies { [K in SkillInternalStateType]: string };

export const SKILL_INTERNAL_STATE_SCOPE_LABELS = {
  SKILL: '技能自身',
  TARGET: '按当前目标分别保存'
} as const satisfies { [K in SkillInternalStateScope]: string };

export const AMMO_RECOVERY_MODE_LABELS = {
  ONE_BY_ONE: '逐个恢复',
  ALL_AT_ONCE: '一次全部恢复'
} as const satisfies { [K in SkillInternalStateAmmoRecoveryMode]: string };
export const AMMO_RECOVERY_START_CONDITION_LABELS = {
  AFTER_CONSUME: '消耗后开始恢复',
  WHEN_EMPTY: '弹药耗尽后开始恢复或装填'
} as const satisfies { [K in SkillInternalStateAmmoRecoveryStartCondition]: string };

export const MILLISECOND_FORMULA_HINT = '结果按毫秒解释';
export const INCOMPLETE_CATALOG_MESSAGE = '目录不完整，无法保存未知引用。';
export const MISSING_CATALOG_LABEL = '目录缺失';

export type SkillInternalStateModeOptionDraft = {
  optionKey: string;
  name: string;
  sortOrder: string;
  initial: boolean;
  originalOptionKey: string | null;
};

export type SkillInternalStateDraft = {
  stateKey: string;
  name: string;
  stateType: SkillInternalStateType;
  scope: SkillInternalStateScope;
  description: string;
  sortOrder: string;
  initialValue: NumericValue | null;
  initialValueBinding?: SkillTriggerSceneInitialParameterBinding;
  initialRemainingValue?: NumericValue;
  initialRemainingMsBinding?: SkillTriggerSceneInitialParameterBinding;
  maxValue: NumericValue | null;
  recoveryIntervalValue: NumericValue | null;
  recoveryMode: SkillInternalStateAmmoRecoveryMode | '';
  recoveryStartCondition: SkillInternalStateAmmoRecoveryStartCondition | '';
  options: SkillInternalStateModeOptionDraft[];
  initialEnabled: boolean;
  durationValue: NumericValue | null;
  targetTiming?: CounterTargetTiming;
  originalStateType: SkillInternalStateType | null;
  originalScope: SkillInternalStateScope | null;
};

export type SkillInternalStateDraftField =
  | 'stateKey'
  | 'name'
  | 'stateType'
  | 'scope'
  | 'description'
  | 'sortOrder'
  | 'initialValue'
  | 'initialValueBinding'
  | 'initialRemainingValue'
  | 'initialRemainingMsBinding'
  | 'maxValue'
  | 'recoveryIntervalValue'
  | 'recoveryMode'
  | 'recoveryStartCondition'
  | 'options'
  | 'initialEnabled'
  | 'durationValue'
  | 'targetTiming'
  | 'detail';

export type SkillInternalStateDraftErrors = {
  [K in SkillInternalStateDraftField]?: string;
};

export type SkillInternalStateOptionDraftField =
  | 'optionKey'
  | 'name'
  | 'sortOrder'
  | 'initial';

export type SkillInternalStateOptionDraftErrors = {
  [K in SkillInternalStateOptionDraftField]?: string;
};

export type SkillInternalStateOptionIndexError = {
  index: number;
  fieldErrors: SkillInternalStateOptionDraftErrors;
};

export type NormalizedSkillInternalStateForm = CreateSkillInternalStateRequest;

export type SkillInternalStateFormValidation =
  | { ok: true; normalized: NormalizedSkillInternalStateForm }
  | {
      ok: false;
      fieldErrors: SkillInternalStateDraftErrors;
      optionErrors: SkillInternalStateOptionIndexError[];
    };

export type InternalStateCatalogLoadState = {
  formulas?: 'ready' | 'failed';
};

export type InternalStateFormCatalog = {
  formulas: ReadonlyArray<Pick<SkillFormulaSummary, 'formulaKey' | 'name'>>;
};

export type SkillInternalStateFormValidationOptions = {
  parameters?: readonly SkillParameter[];
  parametersLoadState?: 'ready' | 'failed';
  includeStateKey: boolean;
  catalog?: InternalStateFormCatalog | null;
  catalogLoadState?: InternalStateCatalogLoadState | null;
};

export type CatalogRefOption = {
  key: string;
  source: 'catalog' | 'unknown';
};

export type MappedSkillInternalStateFieldIssues = {
  fieldErrors: SkillInternalStateDraftErrors;
  optionErrors: SkillInternalStateOptionIndexError[];
  unmappedMessages: string[];
};

const STATE_DRAFT_FIELDS = new Set<SkillInternalStateDraftField>([
  'stateKey',
  'name',
  'stateType',
  'scope',
  'description',
  'sortOrder',
  'initialValue',
  'initialValueBinding', 'initialRemainingValue', 'initialRemainingMsBinding',
  'maxValue',
  'recoveryIntervalValue',
  'recoveryMode',
  'recoveryStartCondition',
  'options',
  'initialEnabled',
  'durationValue',
  'targetTiming',
  'detail'
]);

const DETAIL_FIELD_BY_PATH: { [path: string]: SkillInternalStateDraftField } = {
  'detail.initialValue': 'initialValue',
  'detail.initialValueBinding': 'initialValueBinding',
  'detail.initialRemainingValue': 'initialRemainingValue',
  'detail.initialRemainingMsBinding': 'initialRemainingMsBinding',
  'detail.maxValue': 'maxValue',
  'detail.recoveryIntervalValue': 'recoveryIntervalValue',
  'detail.recoveryMode': 'recoveryMode',
  'detail.recoveryStartCondition': 'recoveryStartCondition',
  'detail.initialEnabled': 'initialEnabled',
  'detail.durationValue': 'durationValue',
  'detail.targetTiming': 'targetTiming',
  'detail.targetTiming.processKey': 'targetTiming',
  'detail.targetTiming.intervalValue': 'targetTiming',
  'detail.options': 'options'
};

const OPTION_FIELD_BY_PATH: { [path: string]: SkillInternalStateOptionDraftField } = {
  optionKey: 'optionKey',
  name: 'name',
  sortOrder: 'sortOrder',
  initial: 'initial'
};

const INDEXED_OPTION_PATH = /^detail\.options\[(\d+)\](?:\.(.*))?$/;

export function createEmptyModeOptionDraft(): SkillInternalStateModeOptionDraft {
  return {
    optionKey: '',
    name: '',
    sortOrder: '0',
    initial: false,
    originalOptionKey: null
  };
}

export function createEmptyInternalStateDraft(
  stateType: SkillInternalStateType = 'COUNTER'
): SkillInternalStateDraft {
  return clearHiddenInternalStateFields({
    stateKey: '',
    name: '',
    stateType,
    scope: 'SKILL',
    description: '',
    sortOrder: '0',
    initialValue: null,
    maxValue: null,
    recoveryIntervalValue: null,
    recoveryMode: stateType === 'AMMO' ? 'ONE_BY_ONE' : '',
    recoveryStartCondition: '',
    options: stateType === 'MODE' ? [createEmptyModeOptionDraft(), createEmptyModeOptionDraft()] : [],
    initialEnabled: false,
    durationValue: null,
    originalStateType: null,
    originalScope: null
  });
}

export function skillInternalStateToDraft(state: SkillInternalState): SkillInternalStateDraft {
  const draft = createEmptyInternalStateDraft(state.stateType);
  draft.stateKey = state.stateKey;
  draft.name = state.name;
  draft.stateType = state.stateType;
  draft.scope = state.scope;
  draft.description = state.description ?? '';
  draft.sortOrder = String(state.sortOrder);
  draft.originalStateType = state.stateType;
  draft.originalScope = state.scope;
  switch (state.stateType) {
    case 'COUNTER':
      draft.initialValue = state.detail.initialValue;
      if (state.detail.initialValueBinding !== undefined) draft.initialValueBinding = structuredClone(state.detail.initialValueBinding);
      draft.maxValue = state.detail.maxValue;
      draft.durationValue = state.detail.durationValue ?? null;
      if (state.detail.targetTiming !== undefined) draft.targetTiming = structuredClone(state.detail.targetTiming);
      break;
    case 'AMMO':
      draft.initialValue = state.detail.initialValue;
      if (state.detail.initialValueBinding !== undefined) draft.initialValueBinding = structuredClone(state.detail.initialValueBinding);
      if (state.detail.initialRemainingValue !== undefined) draft.initialRemainingValue = structuredClone(state.detail.initialRemainingValue);
      if (state.detail.initialRemainingMsBinding !== undefined) draft.initialRemainingMsBinding = structuredClone(state.detail.initialRemainingMsBinding);
      draft.maxValue = state.detail.maxValue;
      draft.recoveryIntervalValue = state.detail.recoveryIntervalValue;
      draft.recoveryMode = state.detail.recoveryMode;
      draft.recoveryStartCondition = state.detail.recoveryStartCondition ?? '';
      break;
    case 'MODE':
      draft.options = sortModeOptionDrafts(state.detail.options.map(modeOptionToDraft));
      break;
    case 'FLAG':
      draft.initialEnabled = state.detail.initialEnabled;
      break;
    case 'INTERNAL_COOLDOWN':
      draft.durationValue = state.detail.durationValue;
      break;
    default: {
      const unexpected: never = state;
      return unexpected;
    }
  }
  return clearHiddenInternalStateFields(draft);
}

export function modeOptionToDraft(option: SkillInternalStateModeOption): SkillInternalStateModeOptionDraft {
  return {
    optionKey: option.optionKey,
    name: option.name,
    sortOrder: String(option.sortOrder),
    initial: option.initial,
    originalOptionKey: option.optionKey
  };
}

export function requiresFormulaCatalog(stateType: SkillInternalStateType): boolean {
  return stateType === 'COUNTER' || stateType === 'AMMO' || stateType === 'INTERNAL_COOLDOWN';
}

export function allowsTargetScope(stateType: SkillInternalStateType): boolean {
  return stateType === 'COUNTER';
}

export function applyStateTypeChange(
  draft: SkillInternalStateDraft,
  nextType: SkillInternalStateType
): SkillInternalStateDraft {
  return clearHiddenInternalStateFields({
    ...draft,
    stateType: nextType,
    scope: allowsTargetScope(nextType) ? draft.scope : 'SKILL',
    initialValue: null,
    initialValueBinding: undefined, initialRemainingValue: undefined, initialRemainingMsBinding: undefined,
    maxValue: null,
    recoveryIntervalValue: null,
    recoveryMode: nextType === 'AMMO' ? 'ONE_BY_ONE' : '',
    recoveryStartCondition: '',
    options: nextType === 'MODE' ? [createEmptyModeOptionDraft(), createEmptyModeOptionDraft()] : [],
    initialEnabled: false,
    durationValue: null
  });
}

export function clearHiddenInternalStateFields(draft: SkillInternalStateDraft): SkillInternalStateDraft {
  const isCounter = draft.stateType === 'COUNTER';
  const isAmmo = draft.stateType === 'AMMO';
  const isMode = draft.stateType === 'MODE';
  const isFlag = draft.stateType === 'FLAG';
  const isCooldown = draft.stateType === 'INTERNAL_COOLDOWN';
  return {
    ...draft,
    scope: allowsTargetScope(draft.stateType) ? draft.scope : 'SKILL',
    initialValue: isCounter || isAmmo ? draft.initialValue : null,
    ...(draft.initialValueBinding !== undefined ? { initialValueBinding: isCounter || isAmmo ? draft.initialValueBinding : undefined } : {}),
    ...(draft.initialRemainingValue !== undefined ? { initialRemainingValue: isAmmo ? draft.initialRemainingValue : undefined } : {}),
    ...(draft.initialRemainingMsBinding !== undefined ? { initialRemainingMsBinding: isAmmo ? draft.initialRemainingMsBinding : undefined } : {}),
    maxValue: isCounter || isAmmo ? draft.maxValue : null,
    recoveryIntervalValue: isAmmo ? draft.recoveryIntervalValue : null,
    recoveryMode: isAmmo ? draft.recoveryMode || 'ONE_BY_ONE' : '',
    recoveryStartCondition: isAmmo ? draft.recoveryStartCondition : '',
    options: isMode ? draft.options : [],
    initialEnabled: isFlag ? draft.initialEnabled : false,
    durationValue: isCooldown || isCounter ? draft.durationValue : null,
    ...(draft.targetTiming !== undefined ? { targetTiming: isCounter && draft.scope === 'TARGET' ? draft.targetTiming : undefined } : {})
  };
}

export function sortModeOptionDrafts(
  options: SkillInternalStateModeOptionDraft[]
): SkillInternalStateModeOptionDraft[] {
  return [...options].sort((left, right) => {
    const leftOrder = Number(left.sortOrder.trim());
    const rightOrder = Number(right.sortOrder.trim());
    const leftValue = Number.isFinite(leftOrder) ? leftOrder : 0;
    const rightValue = Number.isFinite(rightOrder) ? rightOrder : 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
    return left.optionKey.trim().localeCompare(right.optionKey.trim());
  });
}

export function listFormulaOptions(
  catalog: InternalStateFormCatalog,
  currentKey = ''
): CatalogRefOption[] {
  currentKey = typeof currentKey === 'string' ? currentKey : numericFormulaKey(currentKey);
  const options: CatalogRefOption[] = catalog.formulas.map((item) => ({
    key: item.formulaKey,
    source: 'catalog'
  }));
  const trimmed = currentKey.trim();
  if (trimmed && !options.some((item) => item.key === trimmed)) {
    options.push({ key: trimmed, source: 'unknown' });
  }
  return options;
}

export function isCatalogOptionSelectable(option: CatalogRefOption): boolean {
  return option.source !== 'unknown';
}

export function validateSkillInternalStateDraft(
  draft: SkillInternalStateDraft,
  options: SkillInternalStateFormValidationOptions
): SkillInternalStateFormValidation {
  const prepared = clearHiddenInternalStateFields(draft);
  const fieldErrors: SkillInternalStateDraftErrors = {};
  const optionErrors: SkillInternalStateOptionIndexError[] = [];
  const stateKey = prepared.stateKey.trim();
  const name = prepared.name.trim();
  const description = prepared.description.trim();
  const scopeToValidate = draft.scope;

  if (options.includeStateKey) {
    if (!stateKey) {
      fieldErrors.stateKey = '内部状态标识不能为空。';
    } else if (!SKILL_INTERNAL_STATE_KEY_PATTERN.test(stateKey)) {
      fieldErrors.stateKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
    }
  }

  if (!name) {
    fieldErrors.name = '内部状态名称不能为空。';
  } else if (name.length > 100) {
    fieldErrors.name = '内部状态名称不能超过 100 个字符。';
  }

  if (description.length > 2000) {
    fieldErrors.description = '说明不能超过 2000 个字符。';
  }

  if (!isStateType(prepared.stateType)) {
    fieldErrors.stateType = '请选择状态种类。';
  } else if (prepared.originalStateType && prepared.stateType !== prepared.originalStateType) {
    fieldErrors.stateType = '已有内部状态的种类不可修改。';
  }

  if (scopeToValidate !== 'SKILL' && scopeToValidate !== 'TARGET') {
    fieldErrors.scope = '请选择保存范围。';
  } else if (!allowsTargetScope(prepared.stateType) && scopeToValidate === 'TARGET') {
    fieldErrors.scope = '只有计数允许按当前目标分别保存。';
  } else if (prepared.originalScope && scopeToValidate !== prepared.originalScope) {
    fieldErrors.scope = '已有内部状态的范围不可修改。';
  }

  const sortOrder = parseNonNegativeInteger(prepared.sortOrder, fieldErrors, 'sortOrder');
  validateTypeSpecificFields(prepared, options, fieldErrors, optionErrors);

  if (Object.keys(fieldErrors).length > 0 || optionErrors.length > 0 || sortOrder === null) {
    return { ok: false, fieldErrors, optionErrors };
  }

  const built = buildNormalizedRequest(prepared, stateKey, name, description || null, sortOrder);
  if (!built) {
    return { ok: false, fieldErrors, optionErrors };
  }
  return { ok: true, normalized: built };
}

export function buildCreateSkillInternalStateRequest(
  normalized: NormalizedSkillInternalStateForm
): CreateSkillInternalStateRequest {
  return cloneInternalStateRequest(normalized);
}

export function buildUpdateSkillInternalStateRequest(
  normalized: NormalizedSkillInternalStateForm
): UpdateSkillInternalStateRequest {
  const { stateKey: _stateKey, ...rest } = cloneInternalStateRequest(normalized);
  void _stateKey;
  return rest;
}

export function mapSkillInternalStateFieldIssues(source: unknown): MappedSkillInternalStateFieldIssues {
  const fieldErrors: SkillInternalStateDraftErrors = {};
  const optionErrorMap = new Map<number, SkillInternalStateOptionDraftErrors>();
  const unmappedMessages: string[] = [];
  const details = extractDetails(source);
  if (!isRecord(details) || !Array.isArray(details.fieldIssues)) {
    return { fieldErrors, optionErrors: [], unmappedMessages };
  }

  for (const rawIssue of details.fieldIssues) {
    if (!isRecord(rawIssue)) continue;
    const field = typeof rawIssue.field === 'string' ? numericIssuePath(rawIssue.field) : '';
    const message = typeof rawIssue.message === 'string' && rawIssue.message.trim()
      ? rawIssue.message.trim()
      : '字段值不合法。';
    const indexed = INDEXED_OPTION_PATH.exec(field);
    if (indexed) {
      const index = Number(indexed[1]);
      const nested = indexed[2] ?? '';
      const mappedField = nested ? OPTION_FIELD_BY_PATH[nested] ?? null : 'optionKey';
      if (!Number.isInteger(index) || index < 0 || mappedField === null) {
        unmappedMessages.push(message);
        continue;
      }
      const current = optionErrorMap.get(index) ?? {};
      current[mappedField] = message;
      optionErrorMap.set(index, current);
      continue;
    }
    const mapped = mapStateIssueField(field);
    if (mapped) {
      fieldErrors[mapped] = message;
    } else {
      unmappedMessages.push(message);
    }
  }

  const optionErrors = [...optionErrorMap.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([index, errors]) => ({ index, fieldErrors: errors }));
  return { fieldErrors, optionErrors, unmappedMessages };
}

function validateTypeSpecificFields(
  draft: SkillInternalStateDraft,
  options: SkillInternalStateFormValidationOptions,
  fieldErrors: SkillInternalStateDraftErrors,
  optionErrors: SkillInternalStateOptionIndexError[]
): void {
  switch (draft.stateType) {
    case 'COUNTER':
      requireNonEmpty(draft.initialValue, fieldErrors, 'initialValue', '请选择初始值取值。');
      requireNonEmpty(draft.maxValue, fieldErrors, 'maxValue', '请选择上限取值。');
      validateFormulaRef(options, draft.initialValue, fieldErrors, 'initialValue');
      validateFormulaRef(options, draft.maxValue, fieldErrors, 'maxValue');
      if (draft.durationValue !== null) validateFormulaRef(options, draft.durationValue, fieldErrors, 'durationValue', false, true);
      if (draft.targetTiming !== undefined) {
        const timing = draft.targetTiming;
        if (!isCounterTargetTiming(timing) || draft.scope !== 'TARGET' || draft.initialValueBinding !== undefined || !draft.durationValue
          || !SKILL_INTERNAL_STATE_KEY_PATTERN.test(timing.processKey)) fieldErrors.targetTiming = '目标时序须使用本技能目标计数、静态零初值、容量1及正整数期限，并选择完整即时被动过程。';
        if (draft.initialValue?.kind === 'FIXED' && draft.initialValue.value !== 0
          || draft.maxValue?.kind === 'FIXED' && draft.maxValue.value !== 1
          || draft.durationValue?.kind === 'FIXED' && (!Number.isSafeInteger(draft.durationValue.value) || draft.durationValue.value <= 0)) {
          fieldErrors.targetTiming = '目标时序须使用静态零初值、容量1及正安全整数期限。';
        }
        if (timing.kind === 'PHASED_TICK') validateFormulaRef(options, timing.intervalValue, fieldErrors, 'targetTiming', false, true);
      }
      break;
    case 'AMMO':
      requireNonEmpty(draft.initialValue, fieldErrors, 'initialValue', '请选择初始值取值。');
      requireNonEmpty(draft.maxValue, fieldErrors, 'maxValue', '请选择上限取值。');
      requireNonEmpty(draft.recoveryIntervalValue, fieldErrors, 'recoveryIntervalValue', '请选择恢复间隔取值。');
      if (draft.recoveryMode !== 'ONE_BY_ONE' && draft.recoveryMode !== 'ALL_AT_ONCE') {
        fieldErrors.recoveryMode = '请选择恢复方式。';
      }
      if (draft.recoveryStartCondition !== 'AFTER_CONSUME' && draft.recoveryStartCondition !== 'WHEN_EMPTY') {
        fieldErrors.recoveryStartCondition = '请根据来源确认恢复启动条件。';
      }
      validateFormulaRef(options, draft.initialValue, fieldErrors, 'initialValue');
      validateFormulaRef(options, draft.maxValue, fieldErrors, 'maxValue', true);
      validateFormulaRef(options, draft.recoveryIntervalValue, fieldErrors, 'recoveryIntervalValue');
      break;
    case 'MODE':
      validateModeOptions(draft.options, fieldErrors, optionErrors);
      break;
    case 'FLAG':
      break;
    case 'INTERNAL_COOLDOWN':
      requireNonEmpty(draft.durationValue, fieldErrors, 'durationValue', '请选择时长取值。');
      validateFormulaRef(options, draft.durationValue, fieldErrors, 'durationValue');
      break;
    default: {
      const unexpected: never = draft.stateType;
      void unexpected;
    }
  }
  for (const [field, binding, value] of [
    ['initialValueBinding', draft.initialValueBinding, draft.initialValue],
    ['initialRemainingMsBinding', draft.initialRemainingMsBinding, draft.initialRemainingValue]
  ] as const) if (binding !== undefined) {
    const parameter = options.parameters?.find(row => row.parameterKey === binding.parameterKey);
    if (draft.scope !== 'SKILL' || binding.sourceType !== 'SCENE_INITIAL_PARAMETER'
      || !SKILL_INTERNAL_STATE_KEY_PATTERN.test(binding.bindingKey) || !value || value.kind !== 'PARAMETER' || value.parameterKey !== binding.parameterKey
      || !parameter || parameter.valueType !== 'INTEGER' || parameter.valueMode !== 'RUNTIME_INPUT'
      || parameter.fixedValue !== null || parameter.levelValues !== null
      || sceneInitialParameterDetailIssue(binding.detail, true) !== null
      || binding.detail.minValue < 0 || binding.detail.minValue > binding.detail.maxValue) {
      fieldErrors[field] = '状态初值须直接绑定本技能无默认整数参数，并明确非负整数范围。';
    }
  }
  if (draft.stateType === 'AMMO' && (draft.initialRemainingValue !== undefined || draft.initialRemainingMsBinding !== undefined)) {
    if (draft.recoveryMode !== 'ONE_BY_ONE' || draft.recoveryStartCondition !== 'AFTER_CONSUME') fieldErrors.initialRemainingValue = '初充余时仅用于逐枚消耗后恢复。';
    else if (!draft.initialRemainingValue) fieldErrors.initialRemainingValue = '余时声明必须有对应数值引用。';
    else validateFormulaRef(options, draft.initialRemainingValue, fieldErrors, 'initialRemainingValue', false, true);
  }
}

function validateModeOptions(
  options: SkillInternalStateModeOptionDraft[],
  fieldErrors: SkillInternalStateDraftErrors,
  optionErrors: SkillInternalStateOptionIndexError[]
): void {
  if (options.length < 2) {
    fieldErrors.options = '模式至少需要两个选项。';
  }
  const seenKeys = new Map<string, number>();
  let initialCount = 0;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]!;
    const optionFieldErrors: SkillInternalStateOptionDraftErrors = {};
    const optionKey = option.optionKey.trim();
    const name = option.name.trim();
    if (!optionKey) {
      optionFieldErrors.optionKey = '选项标识不能为空。';
    } else if (!SKILL_INTERNAL_STATE_KEY_PATTERN.test(optionKey)) {
      optionFieldErrors.optionKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
    } else if (seenKeys.has(optionKey)) {
      optionFieldErrors.optionKey = '选项标识不能重复。';
    } else {
      seenKeys.set(optionKey, index);
    }
    if (option.originalOptionKey && optionKey !== option.originalOptionKey) {
      optionFieldErrors.optionKey = '已有模式选项的标识不可修改。';
    }
    if (!name) {
      optionFieldErrors.name = '选项名称不能为空。';
    } else if (name.length > 100) {
      optionFieldErrors.name = '选项名称不能超过 100 个字符。';
    }
    parseNonNegativeInteger(option.sortOrder, optionFieldErrors, 'sortOrder');
    if (option.initial) {
      initialCount += 1;
    }
    if (Object.keys(optionFieldErrors).length > 0) {
      optionErrors.push({ index, fieldErrors: optionFieldErrors });
    }
  }
  if (options.length >= 2 && initialCount !== 1) {
    fieldErrors.options = '必须且只能选择一个初始选项。';
    for (let index = 0; index < options.length; index += 1) {
      const current = optionErrors.find((item) => item.index === index);
      if (current) {
        current.fieldErrors.initial = '必须且只能选择一个初始选项。';
      } else {
        optionErrors.push({ index, fieldErrors: { initial: '必须且只能选择一个初始选项。' } });
      }
    }
  }
}

function validateFormulaRef(options: SkillInternalStateFormValidationOptions, value: NumericValue | null, fieldErrors: SkillInternalStateDraftErrors, field: SkillInternalStateDraftField, ammo = false, counterDuration = false): void {
  if (fieldErrors[field]) return;
  const quantity = field === 'initialValue' || field === 'maxValue';
  const error = numericValueError(value, { ...options.catalog, parameters: options.parameters }, {
    integer: quantity || counterDuration, min: ammo && field === 'maxValue' || field === 'targetTiming' ? 1 : 0, exclusiveMin: field === 'recoveryIntervalValue',
    ...(field === 'targetTiming' ? { allowRuntimeInput: false } : {}),
    formulasState: options.catalogLoadState?.formulas, parametersState: options.parametersLoadState
  });
  if (error) fieldErrors[field] = error;
}

function buildNormalizedRequest(
  draft: SkillInternalStateDraft,
  stateKey: string,
  name: string,
  description: string | null,
  sortOrder: number
): NormalizedSkillInternalStateForm | null {
  const base = {
    stateKey,
    name,
    scope: draft.scope,
    description,
    sortOrder
  };
  switch (draft.stateType) {
    case 'COUNTER':
      return {
        ...base,
        stateType: 'COUNTER',
        detail: {
          initialValue: draft.initialValue!,
          ...(draft.initialValueBinding !== undefined ? { initialValueBinding: structuredClone(draft.initialValueBinding) } : {}),
          maxValue: draft.maxValue!,
          ...(draft.durationValue !== null ? { durationValue: draft.durationValue } : {}),
          ...(draft.targetTiming !== undefined ? { targetTiming: structuredClone(draft.targetTiming) } : {})
        }
      };
    case 'AMMO':
      return {
        ...base,
        stateType: 'AMMO',
        detail: {
          initialValue: draft.initialValue!,
          ...(draft.initialValueBinding !== undefined ? { initialValueBinding: structuredClone(draft.initialValueBinding) } : {}),
          ...(draft.initialRemainingValue !== undefined ? { initialRemainingValue: structuredClone(draft.initialRemainingValue) } : {}),
          ...(draft.initialRemainingMsBinding !== undefined ? { initialRemainingMsBinding: structuredClone(draft.initialRemainingMsBinding) } : {}),
          maxValue: draft.maxValue!,
          recoveryIntervalValue: draft.recoveryIntervalValue!,
          recoveryMode: draft.recoveryMode as SkillInternalStateAmmoRecoveryMode,
          recoveryStartCondition: draft.recoveryStartCondition as SkillInternalStateAmmoRecoveryStartCondition
        }
      };
    case 'MODE':
      return {
        ...base,
        stateType: 'MODE',
        detail: {
          options: sortModeOptionDrafts(draft.options).map((option) => ({
            optionKey: option.optionKey.trim(),
            name: option.name.trim(),
            sortOrder: Number(option.sortOrder.trim()),
            initial: option.initial
          }))
        }
      };
    case 'FLAG':
      return {
        ...base,
        stateType: 'FLAG',
        detail: { initialEnabled: draft.initialEnabled }
      };
    case 'INTERNAL_COOLDOWN':
      return {
        ...base,
        stateType: 'INTERNAL_COOLDOWN',
        detail: { durationValue: draft.durationValue! }
      };
    default: {
      const unexpected: never = draft.stateType;
      return unexpected;
    }
  }
}

function cloneInternalStateRequest(
  request: CreateSkillInternalStateRequest
): CreateSkillInternalStateRequest {
  switch (request.stateType) {
    case 'COUNTER':
      return { ...request, detail: { ...request.detail } };
    case 'AMMO':
      return { ...request, detail: { ...request.detail } };
    case 'MODE':
      return {
        ...request,
        detail: { options: request.detail.options.map((option) => ({ ...option })) }
      };
    case 'FLAG':
      return { ...request, detail: { ...request.detail } };
    case 'INTERNAL_COOLDOWN':
      return { ...request, detail: { ...request.detail } };
  }
}

function mapStateIssueField(field: string): SkillInternalStateDraftField | null {
  if (STATE_DRAFT_FIELDS.has(field as SkillInternalStateDraftField)) {
    return field as SkillInternalStateDraftField;
  }
  return DETAIL_FIELD_BY_PATH[field] ?? null;
}

function requireNonEmpty(
  value: string | NumericValue | null,
  fieldErrors: SkillInternalStateDraftErrors,
  field: SkillInternalStateDraftField,
  message: string
): void {
  if (typeof value === 'string' ? !value.trim() : !value) {
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

function extractDetails(source: unknown): unknown {
  if (source instanceof ApiRequestError) return source.details;
  if (isRecord(source) && 'details' in source) return source.details;
  return source;
}

function isStateType(value: string): value is SkillInternalStateType {
  return (SKILL_INTERNAL_STATE_TYPES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}
