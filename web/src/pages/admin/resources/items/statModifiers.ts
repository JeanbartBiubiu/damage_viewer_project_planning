import type { JsonObject } from '../../../../types/api';
import { parseJsonArrayText, stringifyJson } from '../shared/json';

export type StatModifierRow = {
  attrKey: string;
  value: number;
};

/**
 * 解析 statModifiers JSON 文本为基础行结构。
 * 仅做结构校验（每项必须是对象、attrKey 必填、value 必须是数字），
 * 不做去重也不排序，保留输入顺序。
 */
export function parseStatModifierEntries(text: string): StatModifierRow[] {
  const parsed = parseJsonArrayText(text, 'statModifiers');
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`statModifiers[${index}] must be object`);
    }
    const attrKeyRaw = (entry as JsonObject).attrKey;
    const attrKey = typeof attrKeyRaw === 'string' ? attrKeyRaw.trim() : '';
    if (!attrKey) {
      throw new Error(`statModifiers[${index}].attrKey is required`);
    }
    const value = Number((entry as JsonObject).value);
    if (!Number.isFinite(value)) {
      throw new Error(`statModifiers[${index}].value must be number`);
    }
    return { attrKey, value };
  });
}

/**
 * 解析 statModifiers 并校验 attrKey 唯一性，用于保存前的严格校验。
 */
export function parseStatModifiersStrict(text: string): StatModifierRow[] {
  const rows = parseStatModifierEntries(text);
  const seenAttrKeys = new Set<string>();
  rows.forEach((row, index) => {
    if (seenAttrKeys.has(row.attrKey)) {
      throw new Error(`statModifiers[${index}].attrKey duplicated: ${row.attrKey}`);
    }
    seenAttrKeys.add(row.attrKey);
  });
  return rows;
}

/**
 * 解析 statModifiers 并按 attrKey 排序，用于编辑器展示。
 */
export function parseStatModifierRowsSorted(text: string): StatModifierRow[] {
  return parseStatModifierEntries(text).sort((left, right) => left.attrKey.localeCompare(right.attrKey, 'zh-CN'));
}

/**
 * 将行结构序列化为 statModifiers JSON 文本，过滤掉空 attrKey。
 */
export function stringifyStatModifierRows(rows: StatModifierRow[]): string {
  const normalized = rows
    .map((row) => ({
      attrKey: row.attrKey.trim(),
      value: Number.isFinite(row.value) ? row.value : 0
    }))
    .filter((row) => row.attrKey.length > 0);
  return stringifyJson(normalized);
}
