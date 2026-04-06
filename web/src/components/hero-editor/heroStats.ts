import type { AttributeDefinition, JsonObject, JsonValue } from '../../types/api';
import { parseJsonObjectText, stringifyJson } from '../../pages/admin/resources/shared/json';

export type HeroBaseStatRow = {
  attrKey: string;
  value: number;
};

export type HeroStatsByLevelRow = {
  attrKey: string;
  values: number[];
};

export type HeroStatsMatrixRow = {
  attrKey: string;
  attrName: string;
  baseValue: number;
  levelValues: number[];
};

type StageRange = {
  stageMin: number;
  stageMax: number;
  stageCount: number;
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

export function parseStatsByLevelRows(text: string, stageMin = 1, stageMax = 18): HeroStatsByLevelRow[] {
  const range = normalizeStageRange(stageMin, stageMax);
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
        values: normalizeLevelValues(Array.isArray(values) ? values : [], range.stageCount)
      }))
      .sort((left, right) => left.attrKey.localeCompare(right.attrKey, 'zh-CN'));
  }

  const rowMap = new Map<string, number[]>();
  for (const [stageKey, stageValue] of entries) {
    const stage = Number(stageKey);
    if (
      !Number.isFinite(stage)
      || stage < range.stageMin
      || stage > range.stageMax
      || !stageValue
      || typeof stageValue !== 'object'
      || Array.isArray(stageValue)
    ) {
      continue;
    }

    for (const [attrKey, value] of Object.entries(stageValue as JsonObject)) {
      const current = rowMap.get(attrKey) ?? createLevelArray(range.stageCount);
      current[stage - range.stageMin] = toNumber(value);
      rowMap.set(attrKey, current);
    }
  }

  return Array.from(rowMap.entries())
    .map(([attrKey, values]) => ({ attrKey, values: normalizeLevelValues(values, range.stageCount) }))
    .sort((left, right) => left.attrKey.localeCompare(right.attrKey, 'zh-CN'));
}

export function stringifyStatsByLevelRows(
  rows: HeroStatsByLevelRow[],
  stageMin = 1,
  stageMax = 18
): string {
  const range = normalizeStageRange(stageMin, stageMax);
  const result: Record<string, number[]> = {};
  for (const row of rows) {
    const attrKey = row.attrKey.trim();
    if (!attrKey) {
      continue;
    }
    result[attrKey] = normalizeLevelValues(row.values, range.stageCount);
  }
  return stringifyJson(result);
}

export function createLevelArray(length: number, fillValue = 0): number[] {
  const safeLength = Number.isFinite(length) ? Math.max(0, Math.floor(length)) : 0;
  return Array.from({ length: safeLength }, () => fillValue);
}

export function parseHeroStatsMatrix(
  baseStatsText: string,
  statsByLevelText: string,
  definitions: AttributeDefinition[],
  stageMin = 1,
  stageMax = 18
): HeroStatsMatrixRow[] {
  const range = normalizeStageRange(stageMin, stageMax);
  const baseStats = parseJsonObjectText(baseStatsText, 'baseStats');
  const statsByLevelRows = parseStatsByLevelRows(statsByLevelText, range.stageMin, range.stageMax);
  const statsByLevelMap = new Map(statsByLevelRows.map((row) => [row.attrKey, normalizeLevelValues(row.values, range.stageCount)]));

  const definitionMap = new Map<string, AttributeDefinition>();
  const orderedKeys: string[] = [];
  for (const definition of definitions) {
    const attrKey = `${definition.attrKey ?? ''}`.trim();
    if (!attrKey || definitionMap.has(attrKey)) {
      continue;
    }
    definitionMap.set(attrKey, definition);
    orderedKeys.push(attrKey);
  }

  const mergedKeys = new Set<string>(orderedKeys);
  for (const attrKey of Object.keys(baseStats)) {
    if (attrKey.trim()) {
      mergedKeys.add(attrKey.trim());
    }
  }
  for (const attrKey of statsByLevelMap.keys()) {
    if (attrKey.trim()) {
      mergedKeys.add(attrKey.trim());
    }
  }

  const extraKeys = Array.from(mergedKeys)
    .filter((attrKey) => !definitionMap.has(attrKey))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const allKeys = [...orderedKeys, ...extraKeys];

  return allKeys.map((attrKey) => {
    const definition = definitionMap.get(attrKey);
    const defaultValue = toNumber(definition?.defaultValue);
    const hasBaseValue = Object.prototype.hasOwnProperty.call(baseStats, attrKey);
    return {
      attrKey,
      attrName: `${definition?.attrName ?? ''}`.trim() || attrKey,
      baseValue: hasBaseValue ? toNumber(baseStats[attrKey]) : defaultValue,
      levelValues: statsByLevelMap.get(attrKey) ?? createLevelArray(range.stageCount, defaultValue)
    };
  });
}

export function stringifyHeroStatsMatrix(
  rows: HeroStatsMatrixRow[],
  stageMin = 1,
  stageMax = 18
): { baseStatsText: string; statsByLevelText: string } {
  const range = normalizeStageRange(stageMin, stageMax);
  const baseStats: Record<string, number> = {};
  const statsByLevel: Record<string, number[]> = {};

  for (const row of rows) {
    const attrKey = row.attrKey.trim();
    if (!attrKey) {
      continue;
    }
    baseStats[attrKey] = toNumber(row.baseValue);
    const levelValues = normalizeLevelValues(row.levelValues, range.stageCount);
    if (levelValues.some((value) => value !== 0)) {
      statsByLevel[attrKey] = levelValues;
    }
  }

  return {
    baseStatsText: stringifyJson(baseStats),
    statsByLevelText: stringifyJson(statsByLevel)
  };
}

function normalizeLevelValues(values: JsonValue[] | number[], stageCount: number): number[] {
  const normalized = createLevelArray(stageCount);
  for (let index = 0; index < Math.min(values.length, stageCount); index += 1) {
    normalized[index] = toNumber(values[index]);
  }
  return normalized;
}

function normalizeStageRange(stageMin: number, stageMax: number): StageRange {
  const safeStageMin = Number.isFinite(stageMin) ? Math.floor(stageMin) : 1;
  const safeStageMax = Number.isFinite(stageMax) ? Math.floor(stageMax) : 18;
  const normalizedStageMin = Math.max(1, safeStageMin);
  const normalizedStageMax = Math.max(normalizedStageMin, safeStageMax);
  return {
    stageMin: normalizedStageMin,
    stageMax: normalizedStageMax,
    stageCount: normalizedStageMax - normalizedStageMin + 1
  };
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
