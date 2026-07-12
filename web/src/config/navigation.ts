import type { JsonObject } from '../types/api';
import { combatDataNavGroups, type CombatDataNavGroup } from '../pages/admin/combatDataNav';

/** Top-level static pages (not combat-data resources). */
export type StaticRouteId = 'overview' | 'workspace' | 'wasm-validation-generic' | 'images';

/**
 * App route id:
 * - static pages use their id
 * - combat-data uses `combat-data/<resource-id>` (e.g. `combat-data/effect-steps`)
 * - bare `combat-data` only exists transiently before redirect
 */
export type RouteId = StaticRouteId | 'combat-data' | `combat-data/${string}`;

export type NavigationItem = {
  id: RouteId;
  /** Hash path without `#/`, e.g. `overview` or `combat-data/entities`. */
  hashSegment: string;
  label: string;
  summary: string;
};

export type NavigationGroupId =
  | 'data-management'
  | 'combat-data-basics'
  | 'combat-data-entities'
  | 'combat-data-providers'
  | 'combat-data-abilities'
  | 'combat-data-effects'
  | 'wasm-validation';

export type NavigationGroup = {
  id: NavigationGroupId;
  label: string;
  items: NavigationItem[];
};

export type SurfaceEndpoint = {
  title: string;
  method: string;
  path: string;
  description: string;
};

export type AdminEndpoint = {
  title: string;
  method: string;
  path: string;
  description: string;
  sampleBody?: JsonObject;
};

const COMBAT_DATA_GROUP_ID_MAP: Record<string, NavigationGroupId> = {
  basics: 'combat-data-basics',
  entities: 'combat-data-entities',
  providers: 'combat-data-providers',
  abilities: 'combat-data-abilities',
  effects: 'combat-data-effects'
};

function combatDataGroupToNavigationGroup(group: CombatDataNavGroup): NavigationGroup {
  return {
    id: COMBAT_DATA_GROUP_ID_MAP[group.id] ?? `combat-data-${group.id}` as NavigationGroupId,
    label: group.label,
    items: group.items.map((item) => ({
      id: item.hashSegment as RouteId,
      hashSegment: item.hashSegment,
      label: item.label,
      summary: item.summary
    }))
  };
}

const dataManagementNavigationItems: NavigationItem[] = [
  {
    id: 'overview',
    hashSegment: 'overview',
    label: '系统总览',
    summary: '查看当前版本、combat-data 修订与接口面。'
  },
  {
    id: 'workspace',
    hashSegment: 'workspace',
    label: '版本发布',
    summary: '发布版本并刷新 current / combat-data 状态。'
  },
  {
    id: 'images',
    hashSegment: 'images',
    label: '图片缓存',
    summary: '查看并同步图片缓存资源。'
  }
];

const wasmSimulationNavigationItems: NavigationItem[] = [
  {
    id: 'wasm-validation-generic',
    hashSegment: 'wasm-validation-generic',
    label: '通用引擎验证',
    summary: '从 combat-data 装配场景后编译、运行与释放'
  }
];

export const navigationGroups: NavigationGroup[] = [
  {
    id: 'data-management',
    label: '数据管理',
    items: dataManagementNavigationItems
  },
  ...combatDataNavGroups.map(combatDataGroupToNavigationGroup),
  {
    id: 'wasm-validation',
    label: 'Wasm 验证',
    items: wasmSimulationNavigationItems
  }
];

export const navigationItems: NavigationItem[] = navigationGroups.flatMap((group) => group.items);

export function isCombatDataRouteId(route: RouteId): boolean {
  return route === 'combat-data' || route.startsWith('combat-data/');
}

export function combatDataResourceIdFromRoute(route: RouteId): string | null {
  if (route === 'combat-data') {
    return null;
  }
  if (!route.startsWith('combat-data/')) {
    return null;
  }
  return route.slice('combat-data/'.length) || null;
}

/** Sidebar combat-data section ids (registry domains → nav groups). */
export const COMBAT_DATA_NAVIGATION_GROUP_IDS: readonly NavigationGroupId[] = [
  'combat-data-basics',
  'combat-data-entities',
  'combat-data-providers',
  'combat-data-abilities',
  'combat-data-effects'
];

export function isCombatDataNavigationGroupId(groupId: NavigationGroupId): boolean {
  return (COMBAT_DATA_NAVIGATION_GROUP_IDS as readonly string[]).includes(groupId);
}

/** Resolve which sidebar group owns a route (static or combat-data). */
export function navigationGroupIdForRoute(route: RouteId): NavigationGroupId | undefined {
  for (const group of navigationGroups) {
    if (group.items.some((item) => item.hashSegment === route || item.id === route)) {
      return group.id;
    }
  }
  return undefined;
}

/**
 * Map a combat-data resource id to its sidebar NavigationGroupId.
 * e.g. `effect-steps` → `combat-data-effects`, `entities` → `combat-data-entities`.
 */
export function navigationGroupIdForCombatDataResource(
  resourceId: string
): NavigationGroupId | undefined {
  return navigationGroupIdForRoute(`combat-data/${resourceId}` as RouteId);
}

/**
 * Default collapsed map: all combat-data groups + Wasm folded; 数据管理 stays open
 * (absent / falsy). Active combat-data group for `route` is expanded when provided.
 */
export function createDefaultCollapsedNavigationGroups(
  route?: RouteId
): Partial<Record<NavigationGroupId, boolean>> {
  const collapsed: Partial<Record<NavigationGroupId, boolean>> = {
    'wasm-validation': true
  };
  for (const groupId of COMBAT_DATA_NAVIGATION_GROUP_IDS) {
    collapsed[groupId] = true;
  }
  if (!route) {
    return collapsed;
  }
  return ensureActiveCombatDataNavigationGroupExpanded(collapsed, route);
}

/**
 * Ensure the combat-data group that owns `route` is expanded.
 * Does not collapse any other group (preserves manual expands).
 */
export function ensureActiveCombatDataNavigationGroupExpanded(
  collapsed: Partial<Record<NavigationGroupId, boolean>>,
  route: RouteId
): Partial<Record<NavigationGroupId, boolean>> {
  const groupId = navigationGroupIdForRoute(route);
  if (!groupId || !isCombatDataNavigationGroupId(groupId)) {
    return collapsed;
  }
  if (collapsed[groupId] !== true) {
    return collapsed;
  }
  return { ...collapsed, [groupId]: false };
}

export const publicSurfaceEndpoints: SurfaceEndpoint[] = [
  {
    title: '游戏列表',
    method: 'GET',
    path: '/api/games',
    description: '动态发现可用 gameId，并驱动整个前端壳层。'
  },
  {
    title: '当前版本',
    method: 'GET',
    path: '/api/games/{gameId}/versions/current',
    description: '获取当前已发布版本信息（versionCode / changeRevision 等）。'
  },
  {
    title: 'Combat-data 状态',
    method: 'GET',
    path: '/api/games/{gameId}/combat-data/state',
    description: '读取 currentRevision / publishedRevision 与更新时间。'
  },
  {
    title: 'Combat-data 实体与资源',
    method: 'GET',
    path: '/api/games/{gameId}/combat-data/**',
    description: 'entities、providers、abilities、effect-sequences 等公开列表与详情。'
  },
  {
    title: '图片资源',
    method: 'GET',
    path: '/api/games/{gameId}/images?updatedAfter=...',
    description: '支持图片资源的全量与增量同步。'
  }
];

export const adminEndpoints: AdminEndpoint[] = [
  {
    title: 'Combat-data 写入',
    method: 'PUT',
    path: '/api/admin/games/{gameId}/combat-data/**',
    description: '按资源路径整条 PUT 保存 combat-data（实体、能力、效果步骤等）。',
    sampleBody: {
      displayName: 'Example Entity',
      description: 'admin write sample'
    }
  },
  {
    title: '版本发布',
    method: 'POST',
    path: '/api/admin/games/{gameId}/versions:publish',
    description: '提交 versionCode 与可选 releaseDate，发布并推进 changeRevision / publishedRevision。'
  }
];
