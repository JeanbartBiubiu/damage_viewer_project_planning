export type StaticRouteId =
  | 'images'
  | 'attributes'
  | 'characters'
  | 'equipment'
  | 'skill-categories'
  | 'damage-types'
  | 'skills'
  | 'statuses'
  | 'game-settings';

export type RouteId = StaticRouteId;

export type NavigationItem = {
  id: RouteId;
  /** Hash path without `#/`, e.g. `attributes`. */
  hashSegment: string;
  label: string;
  summary: string;
};

export type NavigationGroupId = 'data-management';

export type NavigationGroup = {
  id: NavigationGroupId;
  label: string;
  items: NavigationItem[];
};

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
    label: '图片缓存',
    summary: '查看并同步图片缓存资源。'
  }
];

export const navigationGroups: NavigationGroup[] = [
  {
    id: 'data-management',
    label: '数据管理',
    items: dataManagementNavigationItems
  }
];

export const navigationItems: NavigationItem[] = navigationGroups.flatMap((group) => group.items);

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
