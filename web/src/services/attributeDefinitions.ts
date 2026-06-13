import { getAttributeDefinitions, resolveApiBaseUrl } from './apiClient';
import { loadPublishedBundleSnapshot } from './bundleSnapshot';
import type { AttributeDefinition } from '../types/api';

export type AttributeDefinitionsSource = 'provided' | 'admin' | 'bundle';

export type LoadAttributeDefinitionsOptions = {
  apiBaseUrl: string;
  gameId: string;
  token?: string;
  forceRefresh?: boolean;
};

export type LoadedAttributeDefinitions = {
  definitions: AttributeDefinition[];
  source: AttributeDefinitionsSource;
};

const resolvedCache = new Map<string, LoadedAttributeDefinitions>();
const pendingCache = new Map<string, Promise<LoadedAttributeDefinitions>>();

export function clearAttributeDefinitionsCache(gameId?: string) {
  if (!gameId) {
    resolvedCache.clear();
    pendingCache.clear();
    return;
  }

  for (const key of Array.from(resolvedCache.keys())) {
    if (key.includes(`::${gameId}::`)) {
      resolvedCache.delete(key);
    }
  }

  for (const key of Array.from(pendingCache.keys())) {
    if (key.includes(`::${gameId}::`)) {
      pendingCache.delete(key);
    }
  }
}

export async function loadAttributeDefinitions(
  options: LoadAttributeDefinitionsOptions
): Promise<LoadedAttributeDefinitions> {
  const cacheKey = createCacheKey(options);
  if (!options.forceRefresh) {
    const cached = resolvedCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = pendingCache.get(cacheKey);
    if (pending) {
      return pending;
    }
  }

  const pending = (async () => {
    const resolved = options.token?.trim()
      ? await loadFromAdmin(options)
      : await loadFromBundle(options);
    resolvedCache.set(cacheKey, resolved);
    pendingCache.delete(cacheKey);
    return resolved;
  })().catch((error) => {
    pendingCache.delete(cacheKey);
    throw error;
  });

  pendingCache.set(cacheKey, pending);
  return pending;
}

async function loadFromAdmin(options: LoadAttributeDefinitionsOptions): Promise<LoadedAttributeDefinitions> {
  const result = await getAttributeDefinitions(options.apiBaseUrl, options.gameId, options.token!.trim());
  return {
    definitions: normalizeDefinitions(result.data.attributeDefinitions),
    source: 'admin'
  };
}

async function loadFromBundle(options: LoadAttributeDefinitionsOptions): Promise<LoadedAttributeDefinitions> {
  const snapshot = await loadPublishedBundleSnapshot(options.apiBaseUrl, options.gameId);
  return {
    definitions: normalizeDefinitions(snapshot.bundle.attributeDefinitions),
    source: 'bundle'
  };
}

function createCacheKey(options: LoadAttributeDefinitionsOptions): string {
  const baseUrl = resolveApiBaseUrl(options.apiBaseUrl);
  const source = options.token?.trim() ? 'admin' : 'bundle';
  return `${baseUrl}::${options.gameId}::${source}`;
}

function normalizeDefinitions(definitions: AttributeDefinition[]): AttributeDefinition[] {
  const deduped = new Map<string, AttributeDefinition>();
  for (const definition of definitions) {
    const attrKey = String(definition.attrKey ?? '').trim();
    if (!attrKey) {
      continue;
    }
    deduped.set(attrKey, {
      ...definition,
      attrKey,
      attrName: definition.attrName ? String(definition.attrName).trim() : undefined,
      attrType: definition.attrType ? String(definition.attrType).trim() : undefined,
      rateTargetAttrKey: definition.rateTargetAttrKey ? String(definition.rateTargetAttrKey).trim() : undefined,
      ...normalizeAttributeBoundsFields(definition)
    });
  }

  return Array.from(deduped.values()).sort((left, right) => {
    const leftLabel = `${left.attrName ?? ''}${left.attrKey}`.toLowerCase();
    const rightLabel = `${right.attrName ?? ''}${right.attrKey}`.toLowerCase();
    return leftLabel.localeCompare(rightLabel, 'zh-CN');
  });
}

function normalizeAttributeBoundsFields(definition: AttributeDefinition): Partial<AttributeDefinition> {
  const result: Partial<AttributeDefinition> = {};

  const minValue = resolvePersistedMinValue(definition);
  if (minValue !== undefined) {
    result.minValue = minValue;
  }

  const maxValue = resolvePersistedMaxValue(definition);
  if (maxValue !== undefined) {
    result.maxValue = maxValue;
  }

  return result;
}

function resolvePersistedMinValue(definition: AttributeDefinition): number | undefined {
  const minValue = toFiniteNumber(definition.minValue);
  if (minValue !== undefined) {
    return minValue;
  }
  if (definition.hasClampMin === true) {
    return toFiniteNumber(definition.clampMin);
  }
  return undefined;
}

function resolvePersistedMaxValue(definition: AttributeDefinition): number | undefined {
  const maxValue = toFiniteNumber(definition.maxValue);
  if (maxValue !== undefined) {
    return maxValue;
  }
  if (definition.hasClampMax === true) {
    return toFiniteNumber(definition.clampMax);
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}
