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
  SkillEffectResult,
  SkillEffectResultRequest,
  SkillEffectResultType,
  SkillEffectTarget,
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
  'STATUS_OPERATION'
] as const satisfies readonly SkillEffectResultType[];

export const SKILL_EFFECT_RESULT_TYPE_LABELS = {
  DAMAGE: '伤害',
  DIRECT_HEAL: '直接治疗',
  NORMAL_SHIELD: '普通护盾',
  ATTRIBUTE_CHANGE: '属性变化',
  RESOURCE_CHANGE: '资源变化',
  COOLDOWN_CHANGE: '冷却变化',
  STATUS_OPERATION: '状态操作'
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

export const COOLDOWN_CHANGE_AMOUNT_HINT = '变化量按毫秒解释';
export const DISABLED_CATALOG_LABEL = '已停用';
export const DISABLED_PARENT_SKILL_LABEL = '当前技能（已停用）';
export const INCOMPLETE_CATALOG_MESSAGE = '目录不完整，无法保存未知引用。';
export const DISABLED_CATALOG_MESSAGE = '不能选择已停用的目录项。';

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
  originalResultType: SkillEffectResultType | null;
  originalDamageTypeKey: string | null;
  originalAttributeKey: string | null;
  originalAffectedSkillKey: string | null;
  originalStatusKey: string | null;
};

export type SkillEffectDraft = {
  effectKey: string;
  name: string;
  description: string;
  sortOrder: string;
  results: SkillEffectResultDraft[];
};

export type SkillEffectDraftField =
  | 'effectKey'
  | 'name'
  | 'description'
  | 'sortOrder'
  | 'results';

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
  | 'detail';

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
  damageTypes?: 'ready' | 'failed';
  attributes?: 'ready' | 'failed';
  skills?: 'ready' | 'failed';
  statuses?: 'ready' | 'failed';
};

export type EffectFormCatalog = {
  parentSkillKey: string;
  formulas: ReadonlyArray<Pick<SkillFormulaSummary, 'formulaKey'>>;
  damageTypes: ReadonlyArray<Pick<DamageType, 'damageTypeKey' | 'status'>>;
  attributes: ReadonlyArray<Pick<Attribute, 'attributeKey' | 'status'>>;
  skills: ReadonlyArray<Pick<Skill, 'skillKey' | 'status'>>;
  statuses: ReadonlyArray<Pick<GameStatus, 'statusKey' | 'status'>>;
};

export type SkillEffectFormValidationOptions = {
  includeEffectKey: boolean;
  catalog?: EffectFormCatalog | null;
  catalogLoadState?: EffectCatalogLoadState | null;
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
  'results'
]);

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
  'detail.statusKey': 'statusKey'
};

const INDEXED_RESULT_PATH = /^results\[(\d+)\](?:\.(.*))?$/;

export function createEmptyEffectDraft(): SkillEffectDraft {
  return {
    effectKey: '',
    name: '',
    description: '',
    sortOrder: '0',
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
    originalResultType: null,
    originalDamageTypeKey: null,
    originalAttributeKey: null,
    originalAffectedSkillKey: null,
    originalStatusKey: null
  });
}

export function skillEffectToDraft(effect: SkillEffect): SkillEffectDraft {
  return {
    effectKey: effect.effectKey,
    name: effect.name,
    description: effect.description ?? '',
    sortOrder: String(effect.sortOrder),
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
  cooldownOperation: CooldownChangeOperation | '' = ''
): boolean {
  if (resultType === 'STATUS_OPERATION') {
    return false;
  }
  if (resultType === 'COOLDOWN_CHANGE') {
    return cooldownOperation === 'REDUCE' || cooldownOperation === 'INCREASE';
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
  return requiresValueRule(draft.resultType, draft.cooldownOperation);
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
  const nextNeeds = requiresValueRule(nextType, nextCooldown);
  const prevNeeds = requiresValueRule(draft.resultType, draft.cooldownOperation);
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
    statusOperation: nextType === 'STATUS_OPERATION' ? 'APPLY' : ''
  });
}

export function applyCooldownOperationChange(
  draft: SkillEffectResultDraft,
  nextOperation: CooldownChangeOperation
): SkillEffectResultDraft {
  const nextNeeds = requiresValueRule('COOLDOWN_CHANGE', nextOperation);
  const prevNeeds = requiresValueRule(draft.resultType, draft.cooldownOperation);
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

export function clearHiddenResultFields(draft: SkillEffectResultDraft): SkillEffectResultDraft {
  const needsValue = requiresValueRule(draft.resultType, draft.cooldownOperation);
  return {
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
    statusOperation: draft.resultType === 'STATUS_OPERATION' ? draft.statusOperation || 'APPLY' : ''
  };
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

export function validateSkillEffectDraft(
  draft: SkillEffectDraft,
  options: SkillEffectFormValidationOptions
): SkillEffectFormValidation {
  const fieldErrors: SkillEffectDraftErrors = {};
  const resultErrors: SkillEffectResultIndexError[] = [];
  const effectKey = draft.effectKey.trim();
  const name = draft.name.trim();
  const description = draft.description.trim();

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

  const sortOrder = parseNonNegativeInteger(draft.sortOrder, fieldErrors, 'sortOrder');
  if (draft.results.length === 0) {
    fieldErrors.results = '至少需要一个结果。';
  }

  const seenKeys = new Map<string, number>();
  const builtResults: SkillEffectResultRequest[] = [];
  let allResultsValid = draft.results.length > 0;

  for (let index = 0; index < draft.results.length; index += 1) {
    const prepared = clearHiddenResultFields(draft.results[index]!);
    const resultFieldErrors: SkillEffectResultDraftErrors = {};
    const resultKey = prepared.resultKey.trim();
    if (!resultKey) {
      resultFieldErrors.resultKey = '结果标识不能为空。';
    } else if (!SKILL_EFFECT_KEY_PATTERN.test(resultKey)) {
      resultFieldErrors.resultKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
    } else if (seenKeys.has(resultKey)) {
      resultFieldErrors.resultKey = '结果标识不能重复。';
    } else {
      seenKeys.set(resultKey, index);
    }

    const built = validateAndBuildResult(prepared, options, resultFieldErrors);
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
    results: normalized.results.map(cloneResultRequest)
  };
}

export function buildSkillEffectResult(draft: SkillEffectResultDraft): SkillEffectResultRequest {
  const fieldErrors: SkillEffectResultDraftErrors = {};
  const built = validateAndBuildResult(
    clearHiddenResultFields(draft),
    { includeEffectKey: false },
    fieldErrors
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
      const mappedField = mapResultIssueField(nested, submittedResults[index]?.resultType);
      if (!Number.isInteger(index) || index < 0 || mappedField === null) {
        unmappedMessages.push(message);
        continue;
      }
      const current = resultErrorMap.get(index) ?? {};
      current[mappedField] = message;
      resultErrorMap.set(index, current);
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

function validateAndBuildResult(
  draft: SkillEffectResultDraft,
  options: SkillEffectFormValidationOptions,
  fieldErrors: SkillEffectResultDraftErrors
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
  validateTypeSpecificFields(draft, options, fieldErrors);
  const needsValueRule = requiresValueRule(draft.resultType, draft.cooldownOperation);

  if (
    Object.keys(fieldErrors).length > 0
    || sortOrder === null
    || !isResultType(draft.resultType)
    || (needsValueRule && !valueRule)
  ) {
    return null;
  }

  const base = {
    resultKey,
    name,
    target: draft.target,
    description: description || null,
    sortOrder
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
  const needed = requiresValueRule(draft.resultType, draft.cooldownOperation);
  const formulaKey = draft.formulaKey.trim();
  const multiplierRaw = draft.fixedMultiplier.trim();
  const minRaw = draft.fixedMinValue.trim();
  const maxRaw = draft.fixedMaxValue.trim();

  if (!needed) {
    if (formulaKey || multiplierRaw || minRaw || maxRaw) {
      fieldErrors.valueRule = draft.resultType === 'STATUS_OPERATION'
        ? '状态操作不能携带数值规则。'
        : '冷却重置不能携带数值规则。';
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
  fieldErrors: SkillEffectResultDraftErrors
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
      if (requiresValueRule(draft.resultType, draft.cooldownOperation)) {
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
    default: {
      const unexpected: never = draft.resultType;
      void unexpected;
    }
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
    if (!catalog.formulas.some((item) => item.formulaKey === trimmed)) {
      fieldErrors[field] = INCOMPLETE_CATALOG_MESSAGE;
    }
    return;
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
  kind: Exclude<keyof EffectCatalogLoadState, 'formulas'>
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

function cloneResultRequest(result: SkillEffectResultRequest): SkillEffectResultRequest {
  switch (result.resultType) {
    case 'DAMAGE':
      return { ...result, valueRule: { ...result.valueRule }, detail: { ...result.detail } };
    case 'DIRECT_HEAL':
    case 'NORMAL_SHIELD':
      return { ...result, valueRule: { ...result.valueRule }, detail: {} };
    case 'ATTRIBUTE_CHANGE':
      return { ...result, valueRule: { ...result.valueRule }, detail: { ...result.detail } };
    case 'RESOURCE_CHANGE':
      return { ...result, valueRule: { ...result.valueRule }, detail: { ...result.detail } };
    case 'COOLDOWN_CHANGE':
      if (result.valueRule === null) {
        return { ...result, valueRule: null, detail: { ...result.detail } };
      }
      return { ...result, valueRule: { ...result.valueRule }, detail: { ...result.detail } };
    case 'STATUS_OPERATION':
      return { ...result, valueRule: null, detail: { ...result.detail } };
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
    return 'detail';
  }
  return null;
}

function isResultType(value: string): value is SkillEffectResultType {
  return (SKILL_EFFECT_RESULT_TYPES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}
