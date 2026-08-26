import type { JsonObject } from '../types/api';
import { combatDataNavGroups } from '../pages/admin/combatDataNav';

/** Top-level static pages (not combat-data resources). */
export type StaticRouteId =
  | 'overview'
  | 'workspace'
  | 'wasm-validation-generic'
  | 'images'
  | 'attributes'
  | 'characters'
  | 'equipment'
  | 'skill-categories'
  | 'damage-types'
  | 'skills'
  | 'game-settings'
  | 'provider-setup'
  | 'ability-setup'
  | 'effect-sequence-setup'
  | 'effect-step-setup'
  | 'direct-damage-ability';

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

const dataManagementNavigationItems: NavigationItem[] = [
  {
    id: 'overview',
    hashSegment: 'overview',
    label: '系统总览',
    summary: '查看当前版本、combat-data 修订与接口面。'
  },
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
    id: 'game-settings',
    hashSegment: 'game-settings',
    label: '游戏配置',
    summary: '维护当前游戏的等级范围。'
  },
  {
    id: 'provider-setup',
    hashSegment: 'provider-setup',
    label: 'Provider 创建',
    summary: '按语义类型创建或更新 Provider 主档（单行 PUT）。'
  },
  {
    id: 'ability-setup',
    hashSegment: 'ability-setup',
    label: 'Ability 创建',
    summary: '普通 Ability 主档创建或有意更新（单行 PUT；非效果图）。'
  },
  {
    id: 'effect-sequence-setup',
    hashSegment: 'effect-sequence-setup',
    label: 'Effect Sequence 创建',
    summary: '普通 Effect Sequence 主档创建或有意更新（单行 PUT；非效果图）。'
  },
  {
    id: 'effect-step-setup',
    hashSegment: 'effect-step-setup',
    label: 'Effect Step 创建',
    summary: '在已有 Sequence 下创建或有意更新普通 Effect Step（单行 PUT；非聚合写）。'
  },
  {
    id: 'direct-damage-ability',
    hashSegment: 'direct-damage-ability',
    label: '直伤技能配置',
    summary: '在已有 Provider 下一次聚合写配置主动直伤技能图。'
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
  const resourceId = combatDataResourceIdFromRoute(route);
  if (resourceId) {
    return navigationGroupIdForCombatDataResource(resourceId);
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
  const registryGroup = combatDataNavGroups.find((group) =>
    group.items.some((item) => item.id === resourceId)
  );
  return registryGroup ? COMBAT_DATA_GROUP_ID_MAP[registryGroup.id] : undefined;
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
    title: '实体成长曲线聚合写',
    method: 'PUT',
    path: '/api/admin/games/{gameId}/combat-data/entities/{entityId}:batch',
    description:
      '两处具名聚合写例外之一（Entity Level Setup）：一次 revision 提交实体元数据与所选 attribute/resource 的完整 1..18 曲线。',
    sampleBody: {
      expectedCurrentRevision: 42,
      displayName: 'Example Entity',
      attributes: [
        {
          attrKey: 'ad',
          baseValue: 52,
          stages: [{ stage: 1, value: 52 }]
        }
      ]
    }
  },
  {
    title: '直伤技能图聚合写',
    method: 'PUT',
    path: '/api/admin/games/{gameId}/combat-data/providers/{providerId}/abilities/{abilityId}:direct-damage-setup',
    description:
      '两处具名聚合写例外之一（Direct-damage Ability Setup）：一次 revision 写入 ability/phase/sequence/step/binding。',
    sampleBody: {
      expectedCurrentRevision: 42,
      ability: {
        abilityId: 'ability_q',
        providerId: 'provider_q',
        abilityKey: 'q',
        abilityKindTypeId: 1,
        displayName: 'Q'
      },
      phase: {
        phaseId: 'phase_q_impact',
        abilityId: 'ability_q',
        phaseOrder: 0,
        phaseTypeId: 2,
        interruptible: true
      },
      effectSequence: {
        sequenceId: 'sequence_q_impact',
        providerId: 'provider_q',
        sequenceKey: 'q_impact',
        displayName: 'Q'
      },
      effectStep: {
        stepId: 'step_q_damage',
        sequenceId: 'sequence_q_impact',
        stepOrder: 0,
        operationTypeId: 3,
        targetSelectorTypeId: 4,
        damageDetail: {
          amountFormulaKey: 'dmg',
          damageTypeId: 5,
          valuePolicyTypeId: 6,
          copyableOnHit: false,
          critEligible: false
        }
      },
      phaseEffectSequenceBinding: {
        phaseId: 'phase_q_impact',
        triggerTypeId: 7,
        sequenceId: 'sequence_q_impact'
      }
    }
  },
  {
    title: '版本发布',
    method: 'POST',
    path: '/api/admin/games/{gameId}/versions:publish',
    description: '提交 versionCode 与可选 releaseDate，发布并推进 changeRevision / publishedRevision。'
  }
];
