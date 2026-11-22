import { BASIC_ATTACK_ROUTE, COMBAT_ANALYSIS_ROUTE, type SimulationRouteId } from './viewerRoutes';

export type StaticRouteId =
  | 'images'
  | 'attributes'
  | 'characters'
  | 'equipment'
  | 'builds'
  | 'skill-categories'
  | 'damage-types'
  | 'modifier-zones'
  | 'skills'
  | 'statuses'
  | 'game-settings';

export type RouteId = StaticRouteId | SimulationRouteId;
export type WorkspaceMode = 'management' | 'simulation';

export type NavigationItem = {
  id: RouteId;
  /** Hash path without `#/`, e.g. `attributes`. */
  hashSegment: string;
  label: string;
  summary: string;
};

export type NavigationGroupId = 'data-management' | 'simulation';

export type NavigationGroup = {
  id: NavigationGroupId;
  mode: WorkspaceMode;
  label: string;
  items: NavigationItem[];
};

export const DEFAULT_ROUTE: StaticRouteId = 'attributes';
const DEFAULT_SIMULATION_ROUTE = BASIC_ATTACK_ROUTE;

const dataManagementNavigationItems: NavigationItem[] = [
  {
    id: 'attributes',
    hashSegment: 'attributes',
    label: '属性管理',
    summary: '维护游戏内属性、范围、状态和排序。'
  },
  {
    id: 'characters',
    hashSegment: 'characters',
    label: '角色管理',
    summary: '维护角色基本资料和各等级属性。'
  },
  {
    id: 'equipment',
    hashSegment: 'equipment',
    label: '装备管理',
    summary: '维护装备基本资料和直接属性。'
  },
  {
    id: 'builds',
    hashSegment: 'builds',
    label: '构筑系统管理',
    summary: '维护构筑系统、可选项、分组位置，并试配完整配置。'
  },
  {
    id: 'skill-categories',
    hashSegment: 'skill-categories',
    label: '技能分类管理',
    summary: ''
  },
  {
    id: 'damage-types',
    hashSegment: 'damage-types',
    label: '伤害类型管理',
    summary: ''
  },
  {
    id: 'modifier-zones',
    hashSegment: 'modifier-zones',
    label: '乘区管理',
    summary: ''
  },
  {
    id: 'skills',
    hashSegment: 'skills',
    label: '技能管理',
    summary: ''
  },
  {
    id: 'statuses',
    hashSegment: 'statuses',
    label: '状态管理',
    summary: ''
  },
  {
    id: 'game-settings',
    hashSegment: 'game-settings',
    label: '游戏配置',
    summary: '维护当前游戏的等级范围。'
  },
  {
    id: 'images',
    hashSegment: 'images',
    label: '图片管理',
    summary: '维护图片内容、状态和本地缓存。'
  }
];

export const navigationGroups: NavigationGroup[] = [
  {
    id: 'data-management',
    mode: 'management',
    label: '数据管理',
    items: dataManagementNavigationItems
  },
  {
    id: 'simulation',
    mode: 'simulation',
    label: '计算模拟',
    items: [
      {
        id: DEFAULT_SIMULATION_ROUTE,
        hashSegment: DEFAULT_SIMULATION_ROUTE,
        label: '普攻模拟',
        summary: '单次／连续普攻与固定时刻技能计划。'
      },
      {
        id: COMBAT_ANALYSIS_ROUTE,
        hashSegment: COMBAT_ANALYSIS_ROUTE,
        label: '混合战斗分析',
        summary: '自动连招、背景普攻与曲线及结算分析。'
      }
    ]
  }
];

export const navigationItems: NavigationItem[] = navigationGroups.flatMap((group) => group.items);

export function routeFromHash(hash: string): RouteId {
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  return navigationItems.find((item) => item.hashSegment === path)?.id ?? DEFAULT_ROUTE;
}

export function modeForRoute(route: RouteId): WorkspaceMode {
  return navigationGroups.find((group) => group.items.some((item) => item.id === route))?.mode ?? 'management';
}

export function defaultRouteForMode(mode: WorkspaceMode): RouteId {
  return mode === 'simulation' ? DEFAULT_SIMULATION_ROUTE : DEFAULT_ROUTE;
}

export function navigationGroupsForMode(mode: WorkspaceMode): NavigationGroup[] {
  return navigationGroups.filter((group) => group.mode === mode);
}

/** Resolve which sidebar group owns a route. */
export function navigationGroupIdForRoute(route: RouteId): NavigationGroupId | undefined {
  for (const group of navigationGroups) {
    if (group.items.some((item) => item.hashSegment === route || item.id === route)) {
      return group.id;
    }
  }
  return undefined;
}

/**
 * Default collapsed map: 数据管理 stays open (absent / falsy).
 */
export function createDefaultCollapsedNavigationGroups(): Partial<Record<NavigationGroupId, boolean>> {
  return {};
}
