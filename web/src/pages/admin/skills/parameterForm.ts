import type {
  CreateSkillParameterRequest,
  SkillParameter,
  SkillParameterValueMode,
  SkillParameterValueType,
  UpdateSkillParameterRequest
} from '../../../types/skillParameter';

export const PARAMETER_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export type SkillParameterDraft = {
  parameterKey: string;
  name: string;
  valueType: SkillParameterValueType;
  valueMode: SkillParameterValueMode;
  fixedValue: string;
  levelValues: Record<string, string>;
  description: string;
  sortOrder: string;
};

export type SkillParameterDraftField =
  | 'parameterKey'
  | 'name'
  | 'valueType'
  | 'valueMode'
  | 'fixedValue'
  | 'levelValues'
  | 'description'
  | 'sortOrder';

export type SkillParameterDraftErrors = Partial<Record<SkillParameterDraftField, string>>;

export type SkillParameterFormValidation =
  | { ok: true; normalized: CreateSkillParameterRequest }
  | { ok: false; fieldErrors: SkillParameterDraftErrors };

export type LevelRange = {
  minLevel: number;
  maxLevel: number;
};

export function createEmptyParameterDraft(
  valueMode: SkillParameterValueMode = 'FIXED',
  levelRange?: LevelRange | null
): SkillParameterDraft {
  return applyValueModeReset(
    {
      parameterKey: '',
      name: '',
      valueType: 'DECIMAL',
      valueMode,
      fixedValue: '',
      levelValues: {},
      description: '',
      sortOrder: '0'
    },
    valueMode,
    levelRange ?? null
  );
}

export function parameterToDraft(
  parameter: SkillParameter,
  levelRange?: LevelRange | null
): SkillParameterDraft {
  const draft: SkillParameterDraft = {
    parameterKey: parameter.parameterKey,
    name: parameter.name,
    valueType: parameter.valueType,
    valueMode: parameter.valueMode,
    fixedValue: parameter.fixedValue === null || parameter.fixedValue === undefined
      ? ''
      : String(parameter.fixedValue),
    levelValues: {},
    description: parameter.description ?? '',
    sortOrder: String(parameter.sortOrder)
  };
  if (
    (parameter.valueMode === 'SKILL_LEVEL' || parameter.valueMode === 'CHARACTER_LEVEL')
    && parameter.levelValues
  ) {
    const range = parameter.valueMode === 'SKILL_LEVEL'
      ? levelRange
      : levelRange;
    if (range) {
      for (let level = range.minLevel; level <= range.maxLevel; level += 1) {
        const key = String(level);
        const value = parameter.levelValues[key];
        draft.levelValues[key] = value === undefined ? '' : String(value);
      }
    } else {
      for (const [key, value] of Object.entries(parameter.levelValues)) {
        draft.levelValues[key] = String(value);
      }
    }
  }
  return draft;
}

export function applyValueModeReset(
  draft: SkillParameterDraft,
  nextMode: SkillParameterValueMode,
  levelRange: LevelRange | null
): SkillParameterDraft {
  if (nextMode === 'FIXED') {
    return {
      ...draft,
      valueMode: nextMode,
      fixedValue: '',
      levelValues: {}
    };
  }
  if (nextMode === 'RUNTIME_INPUT') {
    return {
      ...draft,
      valueMode: nextMode,
      fixedValue: '',
      levelValues: {}
    };
  }
  const range = levelRange ?? { minLevel: 1, maxLevel: 1 };
  const levelValues: Record<string, string> = {};
  for (let level = range.minLevel; level <= range.maxLevel; level += 1) {
    levelValues[String(level)] = '';
  }
  return {
    ...draft,
    valueMode: nextMode,
    fixedValue: '',
    levelValues
  };
}

export function fillFixedLevelValues(
  minLevel: number,
  maxLevel: number,
  value: number
): Record<string, string> {
  const result: Record<string, string> = {};
  for (let level = minLevel; level <= maxLevel; level += 1) {
    result[String(level)] = String(value);
  }
  return result;
}

export function fillArithmeticLevelValues(
  minLevel: number,
  maxLevel: number,
  start: number,
  step: number
): Record<string, string> {
  const result: Record<string, string> = {};
  let index = 0;
  for (let level = minLevel; level <= maxLevel; level += 1) {
    const value = start + index * step;
    result[String(level)] = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(8)));
    index += 1;
  }
  return result;
}

export type PastedLevelValuesResult =
  | { ok: true; levelValues: Record<string, string> }
  | { ok: false; message: string };

const DECIMAL_NUMBER_PATTERN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u;

/**
 * 将按等级顺序粘贴的一列文本解析为当前等级草稿。
 * 这里不把空项、千位分隔符或其他非十进制写法当成有效值，也不修改传入的草稿。
 */
export function applyPastedLevelValues(
  currentValues: Record<string, string>,
  text: string,
  minLevel: number,
  maxLevel: number,
  valueType: SkillParameterValueType
): PastedLevelValuesResult {
  const normalizedText = text.trim();
  const entries = normalizedText ? normalizedText.split(/\r\n|[\r\n\t,，]/u) : [];
  const expectedCount = maxLevel - minLevel + 1;
  if (entries.length !== expectedCount) {
    return {
      ok: false,
      message: `请按 Lv${minLevel} 至 Lv${maxLevel} 的顺序输入 ${expectedCount} 个数值，当前为 ${entries.length} 个。`
    };
  }

  const pastedValues: Record<string, string> = {};
  for (let index = 0; index < entries.length; index += 1) {
    const level = minLevel + index;
    const raw = entries[index]!.trim();
    if (!raw) {
      return { ok: false, message: `第${index + 1}项（Lv${level}）不能为空。` };
    }
    const value = Number(raw);
    if (!DECIMAL_NUMBER_PATTERN.test(raw) || !Number.isFinite(value)) {
      return { ok: false, message: `第${index + 1}项（Lv${level}）必须是十进制有限数字。` };
    }
    if (valueType === 'INTEGER' && !Number.isInteger(value)) {
      return { ok: false, message: `第${index + 1}项（Lv${level}）必须是整数。` };
    }
    pastedValues[String(level)] = raw;
  }

  return { ok: true, levelValues: { ...currentValues, ...pastedValues } };
}

export type BuildLevelValuesResult =
  | { ok: true; levelValues: Record<string, number> }
  | { ok: false; message: string };

export function buildLevelValues(
  draftValues: Record<string, string>,
  minLevel: number,
  maxLevel: number,
  valueType: SkillParameterValueType
): BuildLevelValuesResult {
  const expectedKeys = new Set<string>();
  for (let level = minLevel; level <= maxLevel; level += 1) {
    expectedKeys.add(String(level));
  }
  const actualKeys = Object.keys(draftValues);
  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) {
      return { ok: false, message: `存在范围外的等级键：${key}` };
    }
  }
  for (const key of expectedKeys) {
    if (!(key in draftValues) || draftValues[key]!.trim() === '') {
      return { ok: false, message: `缺少等级 ${key} 的数值。` };
    }
  }

  const levelValues: Record<string, number> = {};
  for (const key of expectedKeys) {
    const raw = draftValues[key]!.trim();
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return { ok: false, message: `等级 ${key} 的数值必须是有限数字。` };
    }
    if (valueType === 'INTEGER' && !Number.isInteger(value)) {
      return { ok: false, message: `等级 ${key} 的数值必须是整数。` };
    }
    levelValues[key] = value;
  }
  return { ok: true, levelValues };
}

export function validateParameterDraft(
  draft: SkillParameterDraft,
  includeKey: boolean,
  levelRange: LevelRange | null
): SkillParameterFormValidation {
  const fieldErrors: SkillParameterDraftErrors = {};
  const parameterKey = draft.parameterKey.trim();
  const name = draft.name.trim();
  const description = draft.description.trim();

  if (includeKey) {
    if (!parameterKey) {
      fieldErrors.parameterKey = '稳定标识不能为空。';
    } else if (!PARAMETER_KEY_PATTERN.test(parameterKey)) {
      fieldErrors.parameterKey = '须以小写字母开头，且只能包含小写字母、数字和下划线，最长 64 位。';
    }
  }

  if (!name) {
    fieldErrors.name = '参数名称不能为空。';
  } else if (name.length > 100) {
    fieldErrors.name = '参数名称不能超过 100 个字符。';
  }

  if (description.length > 2000) {
    fieldErrors.description = '说明不能超过 2000 个字符。';
  }

  if (draft.valueType !== 'INTEGER' && draft.valueType !== 'DECIMAL') {
    fieldErrors.valueType = '请选择数值类型。';
  }

  if (
    draft.valueMode !== 'FIXED'
    && draft.valueMode !== 'SKILL_LEVEL'
    && draft.valueMode !== 'CHARACTER_LEVEL'
    && draft.valueMode !== 'RUNTIME_INPUT'
  ) {
    fieldErrors.valueMode = '请选择取值方式。';
  }

  if (draft.valueMode === 'CHARACTER_LEVEL' && !levelRange) {
    fieldErrors.valueMode = '请先设置游戏等级范围';
  }

  const sortOrderRaw = draft.sortOrder.trim();
  const sortOrder = Number(sortOrderRaw);
  if (!sortOrderRaw) {
    fieldErrors.sortOrder = '排序不能为空。';
  } else if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    fieldErrors.sortOrder = '排序必须是大于等于 0 的整数。';
  }

  let fixedValue: number | null = null;
  let levelValues: Record<string, number> | null = null;

  if (draft.valueMode === 'FIXED') {
    const raw = draft.fixedValue.trim();
    const value = Number(raw);
    if (!raw) {
      fieldErrors.fixedValue = '固定值不能为空。';
    } else if (!Number.isFinite(value)) {
      fieldErrors.fixedValue = '固定值必须是有限数字。';
    } else if (draft.valueType === 'INTEGER' && !Number.isInteger(value)) {
      fieldErrors.fixedValue = '整数参数的固定值必须是整数。';
    } else {
      fixedValue = value;
    }
    levelValues = null;
  } else if (draft.valueMode === 'RUNTIME_INPUT') {
    fixedValue = null;
    levelValues = null;
  } else if (levelRange) {
    const built = buildLevelValues(
      draft.levelValues,
      levelRange.minLevel,
      levelRange.maxLevel,
      draft.valueType
    );
    if (!built.ok) {
      fieldErrors.levelValues = built.message;
    } else {
      levelValues = built.levelValues;
      fixedValue = null;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    normalized: {
      parameterKey,
      name,
      valueType: draft.valueType,
      valueMode: draft.valueMode,
      fixedValue,
      levelValues,
      description: description || null,
      sortOrder
    }
  };
}

export function buildCreateParameterRequest(
  normalized: CreateSkillParameterRequest
): CreateSkillParameterRequest {
  return {
    ...normalized,
    levelValues: normalized.levelValues ? { ...normalized.levelValues } : null
  };
}

export function buildUpdateParameterRequest(
  normalized: CreateSkillParameterRequest
): UpdateSkillParameterRequest {
  const { parameterKey: _parameterKey, ...request } = normalized;
  return {
    ...request,
    levelValues: request.levelValues ? { ...request.levelValues } : null
  };
}

export function formatParameterValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(8)));
}

const PARAMETER_DRAFT_FIELDS = new Set<SkillParameterDraftField>([
  'parameterKey',
  'name',
  'valueType',
  'valueMode',
  'fixedValue',
  'levelValues',
  'description',
  'sortOrder'
]);

export function mapParameterFieldIssues(source: unknown): {
  fieldErrors: SkillParameterDraftErrors;
  unmappedMessages: string[];
} {
  const fieldErrors: SkillParameterDraftErrors = {};
  const unmappedMessages: string[] = [];
  const details = isRecord(source) && 'details' in source
    ? (source as { details?: unknown }).details
    : source;
  if (!isRecord(details) || !Array.isArray(details.fieldIssues)) {
    return { fieldErrors, unmappedMessages };
  }

  for (const rawIssue of details.fieldIssues) {
    if (!isRecord(rawIssue)) continue;
    const field = typeof rawIssue.field === 'string' ? rawIssue.field : '';
    const message = typeof rawIssue.message === 'string' && rawIssue.message.trim()
      ? rawIssue.message.trim()
      : '字段值不合法。';
    if (PARAMETER_DRAFT_FIELDS.has(field as SkillParameterDraftField)) {
      fieldErrors[field as SkillParameterDraftField] = message;
      continue;
    }
    unmappedMessages.push(message);
  }

  return { fieldErrors, unmappedMessages };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
