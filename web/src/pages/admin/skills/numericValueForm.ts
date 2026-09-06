import type { NumericValue } from '../../../types/numericValue';
import { isNumericValue } from '../../../types/numericValue';
import type { SkillParameter } from '../../../types/skillParameter';

export type NumericCatalog = {
  parameters?: readonly SkillParameter[];
  formulas?: ReadonlyArray<{ formulaKey: string; name?: string }>;
};
export type NumericLimits = {
  required?: boolean;
  integer?: boolean;
  min?: number;
  exclusiveMin?: boolean;
  allowRuntimeInput?: boolean;
  parametersState?: 'ready' | 'failed';
  formulasState?: 'ready' | 'failed';
};

export function staticNumericValues(value: NumericValue | null | undefined, parameters: readonly SkillParameter[] = []): number[] | null {
  if (value?.kind === 'FIXED') return [value.value];
  if (value?.kind !== 'PARAMETER') return null;
  const parameter = parameters.find((item) => item.parameterKey === value.parameterKey);
  if (!parameter || parameter.valueMode === 'RUNTIME_INPUT') return null;
  return parameter.valueMode === 'FIXED'
    ? parameter.fixedValue === null ? [] : [parameter.fixedValue]
    : Object.values(parameter.levelValues ?? {});
}

export function numericValueError(value: NumericValue | null | undefined, catalog: NumericCatalog = {}, limits: NumericLimits = {}): string | undefined {
  if (value === null || value === undefined) return limits.required === false ? undefined : '请配置取值来源。';
  if (!isNumericValue(value)) return '取值来源不完整或数值不合法。';
  if (value.kind === 'FORMULA') {
    if (limits.formulasState === 'failed') return '目录不完整，无法保存未知引用。';
    if (catalog.formulas && !catalog.formulas.some((item) => item.formulaKey === value.formulaKey)) return '目录不完整，无法保存未知引用。';
  }
  if (value.kind === 'PARAMETER') {
    if (limits.parametersState === 'failed') return '参数目录不完整，无法保存未知引用。';
    const parameter = catalog.parameters?.find((item) => item.parameterKey === value.parameterKey);
    if (catalog.parameters && !parameter) return '技能参数不存在。';
    if (parameter && limits.allowRuntimeInput === false && parameter.valueMode === 'RUNTIME_INPUT') return '此处不能使用计算时传入的技能参数。';
    if (parameter && limits.integer && parameter.valueType !== 'INTEGER') return '此处需要整数类型的技能参数。';
  }
  const values = staticNumericValues(value, catalog.parameters);
  if (values && values.some((number) => !Number.isFinite(number))) return '固定数值必须是有效数值。';
  if (values && limits.integer && values.some((number) => !Number.isInteger(number))) return '此处数值必须为整数。';
  if (values && limits.min !== undefined && values.some((number) => limits.exclusiveMin ? number <= limits.min! : number < limits.min!)) {
    return `此处数值必须${limits.exclusiveMin ? '大于' : '大于等于'} ${limits.min}。`;
  }
  return undefined;
}

export function numericValueSummary(value: NumericValue | null | undefined, names?: ReadonlyMap<string, string>): string {
  if (!value) return '未配置';
  if (value.kind === 'FIXED') return Number.isFinite(value.value) ? String(value.value) : '待填写';
  const key = value.kind === 'PARAMETER' ? value.parameterKey : value.formulaKey;
  return names?.get(key) || key || '待选择';
}

export function numericValuesIn(value: unknown): NumericValue[] {
  if (isNumericValue(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(numericValuesIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numericValuesIn);
  return [];
}

export function numericIssuePath(path: string): string {
  return path.replace(/((?:^|\.)(?:value|\w+Value))\.(?:kind|value|parameterKey|formulaKey)$/, '$1');
}

export function staticChargeRangeIsValid(minimum: NumericValue | null, maximum: NumericValue | null, parameters: readonly SkillParameter[] = []): boolean | null {
  const entries = (value: NumericValue | null) => {
    if (value?.kind === 'FIXED') return { axis: 'FIXED', values: { '*': value.value } as Record<string, number> };
    if (value?.kind !== 'PARAMETER') return null;
    const item = parameters.find((parameter) => parameter.parameterKey === value.parameterKey);
    if (!item || item.valueMode === 'RUNTIME_INPUT') return null;
    return { axis: item.valueMode, values: item.valueMode === 'FIXED' ? { '*': item.fixedValue! } : item.levelValues! };
  };
  const left = entries(minimum), right = entries(maximum);
  if (!left || !right || !left.values || !right.values) return null;
  if (left.axis === right.axis && left.axis !== 'FIXED') return Object.entries(left.values).every(([level, value]) => right.values[level] >= value);
  return Object.values(left.values).every((min) => Object.values(right.values).every((max) => max >= min));
}
