export type NumericValue =
  | { kind: 'FIXED'; value: number }
  | { kind: 'PARAMETER'; parameterKey: string }
  | { kind: 'FORMULA'; formulaKey: string };

export const fixedValue = (value: number): NumericValue => ({ kind: 'FIXED', value });
export const parameterValue = (parameterKey: string): NumericValue => ({ kind: 'PARAMETER', parameterKey });
export const formulaValue = (formulaKey: string): NumericValue => ({ kind: 'FORMULA', formulaKey });

export function isNumericValue(value: unknown): value is NumericValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const field = item.kind === 'FIXED' ? 'value' : item.kind === 'PARAMETER' ? 'parameterKey'
    : item.kind === 'FORMULA' ? 'formulaKey' : null;
  if (!field || Object.keys(item).length !== 2 || !Object.prototype.hasOwnProperty.call(item, field)) return false;
  return field === 'value' ? typeof item.value === 'number' && Number.isFinite(item.value)
    : typeof item[field] === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(item[field]);
}

export function numericFormulaKey(value: NumericValue | null | undefined): string {
  return value?.kind === 'FORMULA' ? value.formulaKey : '';
}

export function numericParameterKey(value: NumericValue | null | undefined): string {
  return value?.kind === 'PARAMETER' ? value.parameterKey : '';
}
