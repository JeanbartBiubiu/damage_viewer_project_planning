import type { JsonObject, JsonValue } from '../../types/api';
import { parseJsonObjectText, stringifyJson } from '../../pages/admin/resources/shared/json';

export type HeroBaseStatRow = {
  attrKey: string;
  value: number;
};

export type HeroStatsByLevelRow = {
  attrKey: string;
  values: number[];
};

export function parseBaseStatsRows(text: string): HeroBaseStatRow[] {
  const parsed = parseJsonObjectText(text, 'baseStats');
  return Object.entries(parsed)
    .map(([attrKey, value]) => ({
      attrKey,
      value: toNumber(value)
    }))
    .sort((left, right) => left.attrKey.localeCompare(right.attrKey, 'zh-CN'));
}

export function stringifyBaseStatsRows(rows: HeroBaseStatRow[]): string {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const attrKey = row.attrKey.trim();
    if (!attrKey) {
      continue;
    }
    result[attrKey] = Number.isFinite(row.value) ? row.value : 0;
  }
  return stringifyJson(result);
}

export function parseStatsByLevelRows(text: string): HeroStatsByLevelRow[] {
  const parsed = parseJsonObjectText(text, 'statsByLevel');
  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    return [];
  }

  const firstValue = entries[0]?.[1];
  if (Array.isArray(firstValue)) {
    return entries
      .map(([attrKey, values]) => ({
        attrKey,
        values: normalizeLevelValues(Array.isArray(values) ? values : [])
      }))
      .sort((left, right) => left.attrKey.localeCompare(right.attrKey, 'zh-CN'));
  }

  const rowMap = new Map<string, number[]>();
  for (const [levelKey, levelValue] of entries) {
    const level = Number(levelKey);
    if (!Number.isFinite(level) || level < 1 || level > 18 || !levelValue || typeof levelValue !== 'object' || Array.isArray(levelValue)) {
      continue;
    }

    for (const [attrKey, value] of Object.entries(levelValue as JsonObject)) {
      const current = rowMap.get(attrKey) ?? createLevelArray();
      current[level - 1] = toNumber(value);
      rowMap.set(attrKey, current);
    }
  }

  return Array.from(rowMap.entries())
    .map(([attrKey, values]) => ({ attrKey, values: normalizeLevelValues(values) }))
    .sort((left, right) => left.attrKey.localeCompare(right.attrKey, 'zh-CN'));
}

export function stringifyStatsByLevelRows(rows: HeroStatsByLevelRow[]): string {
  const result: Record<string, number[]> = {};
  for (const row of rows) {
    const attrKey = row.attrKey.trim();
    if (!attrKey) {
      continue;
    }
    result[attrKey] = normalizeLevelValues(row.values);
  }
  return stringifyJson(result);
}

export function createLevelArray(fillValue = 0): number[] {
  return Array.from({ length: 18 }, () => fillValue);
}

function normalizeLevelValues(values: JsonValue[] | number[]): number[] {
  const normalized = createLevelArray();
  for (let index = 0; index < Math.min(values.length, 18); index += 1) {
    normalized[index] = toNumber(values[index]);
  }
  return normalized;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}