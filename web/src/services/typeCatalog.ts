import { getTypeRelations, getTypes, resolveApiBaseUrl } from './apiClient';
import type { TypeDefinition, TypeRelation } from '../types/api';

export type LoadedTypeCatalog = {
  types: TypeDefinition[];
  typeRelations: TypeRelation[];
};

export type TypeTreeNode = {
  type: TypeDefinition;
  parentTypeId?: number;
  children: TypeTreeNode[];
};

const resolvedCache = new Map<string, LoadedTypeCatalog>();
const pendingCache = new Map<string, Promise<LoadedTypeCatalog>>();

export async function loadTypeCatalog(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  forceRefresh = false
): Promise<LoadedTypeCatalog> {
  const cacheKey = `${resolveApiBaseUrl(apiBaseUrl)}::${gameId}`;
  if (!forceRefresh) {
    const cached = resolvedCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = pendingCache.get(cacheKey);
    if (pending) {
      return pending;
    }
  }

  const pending = Promise.all([getTypes(apiBaseUrl, gameId, token), getTypeRelations(apiBaseUrl, gameId, token)])
    .then(([typesResult, relationsResult]) => {
      const catalog = {
        types: normalizeTypes(typesResult.data.types),
        typeRelations: normalizeRelations(relationsResult.data.typeRelations)
      } satisfies LoadedTypeCatalog;
      resolvedCache.set(cacheKey, catalog);
      pendingCache.delete(cacheKey);
      return catalog;
    })
    .catch((error) => {
      pendingCache.delete(cacheKey);
      throw error;
    });

  pendingCache.set(cacheKey, pending);
  return pending;
}

export function clearTypeCatalogCache(gameId?: string) {
  if (!gameId) {
    resolvedCache.clear();
    pendingCache.clear();
    return;
  }

  for (const key of Array.from(resolvedCache.keys())) {
    if (key.includes(`::${gameId}`)) {
      resolvedCache.delete(key);
    }
  }
  for (const key of Array.from(pendingCache.keys())) {
    if (key.includes(`::${gameId}`)) {
      pendingCache.delete(key);
    }
  }
}

export function buildTypeParentMap(typeRelations: TypeRelation[]): Map<number, number> {
  const parentMap = new Map<number, number>();
  for (const relation of typeRelations) {
    if (relation.targetCategory !== 'type') {
      continue;
    }
    const parentTypeId = Number(relation.targetId);
    if (!Number.isFinite(parentTypeId) || parentTypeId <= 0 || parentTypeId === relation.typeId) {
      continue;
    }
    if (!parentMap.has(relation.typeId)) {
      parentMap.set(relation.typeId, parentTypeId);
    }
  }
  return parentMap;
}

export function buildTargetTypeIdsMap(typeRelations: TypeRelation[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const relation of typeRelations) {
    const key = `${relation.targetCategory}:${relation.targetId}`;
    const current = map.get(key) ?? [];
    if (!current.includes(relation.typeId)) {
      current.push(relation.typeId);
      current.sort((left, right) => left - right);
      map.set(key, current);
    }
  }
  return map;
}

export function buildTypeTree(types: TypeDefinition[], typeRelations: TypeRelation[]): TypeTreeNode[] {
  const nodeMap = new Map<number, TypeTreeNode>();
  const parentMap = buildTypeParentMap(typeRelations);

  for (const type of types) {
    nodeMap.set(type.typeId, {
      type,
      parentTypeId: parentMap.get(type.typeId),
      children: []
    });
  }

  const roots: TypeTreeNode[] = [];
  for (const node of nodeMap.values()) {
    const parentTypeId = node.parentTypeId;
    if (parentTypeId && nodeMap.has(parentTypeId) && parentTypeId !== node.type.typeId) {
      nodeMap.get(parentTypeId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: TypeTreeNode[]) => {
    nodes.sort((left, right) => compareTypes(left.type, right.type));
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

function normalizeTypes(types: TypeDefinition[]): TypeDefinition[] {
  return [...types].sort(compareTypes);
}

function normalizeRelations(typeRelations: TypeRelation[]): TypeRelation[] {
  return [...typeRelations].sort((left, right) => {
    const byCategory = left.targetCategory.localeCompare(right.targetCategory, 'zh-CN');
    if (byCategory !== 0) {
      return byCategory;
    }
    const byTargetId = left.targetId.localeCompare(right.targetId, 'zh-CN');
    if (byTargetId !== 0) {
      return byTargetId;
    }
    return left.typeId - right.typeId;
  });
}

function compareTypes(left: TypeDefinition, right: TypeDefinition) {
  const leftLabel = `${left.name ?? ''}${left.typeId}`.toLowerCase();
  const rightLabel = `${right.name ?? ''}${right.typeId}`.toLowerCase();
  return leftLabel.localeCompare(rightLabel, 'zh-CN');
}