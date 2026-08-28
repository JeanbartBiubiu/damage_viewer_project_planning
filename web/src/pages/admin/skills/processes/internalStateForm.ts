import { ApiRequestError } from '../../../../services/apiClient';
import type { SkillFormulaSummary } from '../../../../types/skillFormula';
import type {
  CreateSkillInternalStateRequest,
  SkillInternalState,
  SkillInternalStateAmmoRecoveryMode,
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
  initialValueFormulaKey: string;
  maxValueFormulaKey: string;
  recoveryIntervalFormulaKey: string;
  recoveryMode: SkillInternalStateAmmoRecoveryMode | '';
  options: SkillInternalStateModeOptionDraft[];
  initialEnabled: boolean;
  durationFormulaKey: string;
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
  | 'initialValueFormulaKey'
  | 'maxValueFormulaKey'
  | 'recoveryIntervalFormulaKey'
  | 'recoveryMode'
  | 'options'
  | 'initialEnabled'
  | 'durationFormulaKey'
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
  'initialValueFormulaKey',
  'maxValueFormulaKey',
  'recoveryIntervalFormulaKey',
  'recoveryMode',
  'options',
  'initialEnabled',
  'durationFormulaKey',
  'detail'
]);

const DETAIL_FIELD_BY_PATH: { [path: string]: SkillInternalStateDraftField } = {
  'detail.initialValueFormulaKey': 'initialValueFormulaKey',
  'detail.maxValueFormulaKey': 'maxValueFormulaKey',
  'detail.recoveryIntervalFormulaKey': 'recoveryIntervalFormulaKey',
  'detail.recoveryMode': 'recoveryMode',
  'detail.initialEnabled': 'initialEnabled',
  'detail.durationFormulaKey': 'durationFormulaKey',
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
    initialValueFormulaKey: '',
    maxValueFormulaKey: '',
    recoveryIntervalFormulaKey: '',
    recoveryMode: stateType === 'AMMO' ? 'ONE_BY_ONE' : '',
    options: stateType === 'MODE' ? [createEmptyModeOptionDraft(), createEmptyModeOptionDraft()] : [],
    initialEnabled: false,
    durationFormulaKey: '',
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
      draft.initialValueFormulaKey = state.detail.initialValueFormulaKey;
      draft.maxValueFormulaKey = state.detail.maxValueFormulaKey;
      break;
    case 'AMMO':
      draft.initialValueFormulaKey = state.detail.initialValueFormulaKey;
      draft.maxValueFormulaKey = state.detail.maxValueFormulaKey;
      draft.recoveryIntervalFormulaKey = state.detail.recoveryIntervalFormulaKey;
      draft.recoveryMode = state.detail.recoveryMode;
      break;
    case 'MODE':
      draft.options = sortModeOptionDrafts(state.detail.options.map(modeOptionToDraft));
      break;
    case 'FLAG':
      draft.initialEnabled = state.detail.initialEnabled;
      break;
    case 'INTERNAL_COOLDOWN':
      draft.durationFormulaKey = state.detail.durationFormulaKey;
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
    initialValueFormulaKey: '',
    maxValueFormulaKey: '',
    recoveryIntervalFormulaKey: '',
    recoveryMode: nextType === 'AMMO' ? 'ONE_BY_ONE' : '',
    options: nextType === 'MODE' ? [createEmptyModeOptionDraft(), createEmptyModeOptionDraft()] : [],
    initialEnabled: false,
    durationFormulaKey: ''
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
    initialValueFormulaKey: isCounter || isAmmo ? draft.initialValueFormulaKey : '',
    maxValueFormulaKey: isCounter || isAmmo ? draft.maxValueFormulaKey : '',
    recoveryIntervalFormulaKey: isAmmo ? draft.recoveryIntervalFormulaKey : '',
    recoveryMode: isAmmo ? draft.recoveryMode || 'ONE_BY_ONE' : '',
    options: isMode ? draft.options : [],
    initialEnabled: isFlag ? draft.initialEnabled : false,
    durationFormulaKey: isCooldown ? draft.durationFormulaKey : ''
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
    const field = typeof rawIssue.field === 'string' ? rawIssue.field : '';
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
      requireNonEmpty(draft.initialValueFormulaKey, fieldErrors, 'initialValueFormulaKey', '请选择初始值公式。');
      requireNonEmpty(draft.maxValueFormulaKey, fieldErrors, 'maxValueFormulaKey', '请选择上限公式。');
      validateFormulaRef(options, draft.initialValueFormulaKey, fieldErrors, 'initialValueFormulaKey');
      validateFormulaRef(options, draft.maxValueFormulaKey, fieldErrors, 'maxValueFormulaKey');
      break;
    case 'AMMO':
      requireNonEmpty(draft.initialValueFormulaKey, fieldErrors, 'initialValueFormulaKey', '请选择初始值公式。');
      requireNonEmpty(draft.maxValueFormulaKey, fieldErrors, 'maxValueFormulaKey', '请选择上限公式。');
      requireNonEmpty(draft.recoveryIntervalFormulaKey, fieldErrors, 'recoveryIntervalFormulaKey', '请选择恢复间隔公式。');
      if (draft.recoveryMode !== 'ONE_BY_ONE' && draft.recoveryMode !== 'ALL_AT_ONCE') {
        fieldErrors.recoveryMode = '请选择恢复方式。';
      }
      validateFormulaRef(options, draft.initialValueFormulaKey, fieldErrors, 'initialValueFormulaKey');
      validateFormulaRef(options, draft.maxValueFormulaKey, fieldErrors, 'maxValueFormulaKey');
      validateFormulaRef(options, draft.recoveryIntervalFormulaKey, fieldErrors, 'recoveryIntervalFormulaKey');
      break;
    case 'MODE':
      validateModeOptions(draft.options, fieldErrors, optionErrors);
      break;
    case 'FLAG':
      break;
    case 'INTERNAL_COOLDOWN':
      requireNonEmpty(draft.durationFormulaKey, fieldErrors, 'durationFormulaKey', '请选择时长公式。');
      validateFormulaRef(options, draft.durationFormulaKey, fieldErrors, 'durationFormulaKey');
      break;
    default: {
      const unexpected: never = draft.stateType;
      void unexpected;
    }
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

function validateFormulaRef(
  options: SkillInternalStateFormValidationOptions,
  currentKey: string,
  fieldErrors: SkillInternalStateDraftErrors,
  field: SkillInternalStateDraftField
): void {
  if (fieldErrors[field]) return;
  const trimmed = currentKey.trim();
  if (!trimmed) return;
  if (options.catalogLoadState?.formulas === 'failed') {
    fieldErrors[field] = INCOMPLETE_CATALOG_MESSAGE;
    return;
  }
  const catalog = options.catalog;
  if (!catalog) return;
  if (!catalog.formulas.some((item) => item.formulaKey === trimmed)) {
    fieldErrors[field] = INCOMPLETE_CATALOG_MESSAGE;
  }
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
          initialValueFormulaKey: draft.initialValueFormulaKey.trim(),
          maxValueFormulaKey: draft.maxValueFormulaKey.trim()
        }
      };
    case 'AMMO':
      return {
        ...base,
        stateType: 'AMMO',
        detail: {
          initialValueFormulaKey: draft.initialValueFormulaKey.trim(),
          maxValueFormulaKey: draft.maxValueFormulaKey.trim(),
          recoveryIntervalFormulaKey: draft.recoveryIntervalFormulaKey.trim(),
          recoveryMode: draft.recoveryMode as SkillInternalStateAmmoRecoveryMode
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
        detail: { durationFormulaKey: draft.durationFormulaKey.trim() }
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
  value: string,
  fieldErrors: SkillInternalStateDraftErrors,
  field: SkillInternalStateDraftField,
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
