import { NumericAdaptationError } from '../../numericAdapter';

export const METADATA = ['name', 'description', 'sortOrder', 'createdAt', 'updatedAt'];

export function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
export function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '需要完整对象');
  return value as Record<string, unknown>;
}
export function exact(value: unknown, fields: readonly string[], path: string) {
  const unexpected = Object.keys(record(value, path)).find(key => !fields.includes(key));
  if (unexpected) fail(`${path}.${unexpected}`, '4C未接入的字段不能被静默忽略');
}
export function array<T>(value: T[], path: string): T[] {
  if (!Array.isArray(value)) fail(path, '需要完整数组');
  return value;
}
export function stableKey(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) fail(path, '需要合法稳定标识');
  return value;
}
export function uniqueRows<T>(rows: T[], keyFor: (row: T) => string, path: string) {
  const seen = new Set<string>();
  for (const row of array(rows, path)) {
    const key = stableKey(keyFor(row), path);
    if (seen.has(key)) fail(path, '稳定标识重复，不能过滤后继续');
    seen.add(key);
  }
}

export function ordered<T extends { sortOrder: number }>(rows: T[], path: string): T[] {
  if (array(rows, path).some(row => !Number.isInteger(row.sortOrder))) fail(path, '排序必须为整数');
  return rows.map((row, index) => ({ row, index }))
    .sort((left, right) => left.row.sortOrder - right.row.sortOrder || left.index - right.index).map(entry => entry.row);
}
