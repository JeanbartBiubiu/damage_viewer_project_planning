import type { JsonObject } from '../types/api';
import {
  adminResourceNavigationItems as adminResourceNavigationItemsFromAdminConfig,
  type AdminResourceKind,
  type AdminResourceNavigationItem
} from '../pages/admin/adminResourceConfig';

export type BuiltinAdminResourceRouteId =
  | 'formula-profiles'
  | 'formula-bindings'
  | 'coefficient-buckets'
  | 'status-action-control-rules';

export type ExtendedAdminResourceRouteId =
  | 'heroes'
  | 'skills'
  | 'items'
  | 'attribute-definitions'
  | 'status-management'
  | 'types'
  | 'type-relations'
  | 'skill-mounts';

export type AdminResourceRouteId = BuiltinAdminResourceRouteId | ExtendedAdminResourceRouteId;

export type RouteId =
  | 'overview'
  | 'workspace'
  | 'wasm-validation'
  | 'wasm-validation-m2'
  | 'wasm-validation-m3'
  | 'wasm-validation-m4-closure'
  | 'wasm-validation-v2-dps'
  | 'wasm-validation-v2-dps-multi-hero'
  | 'wasm-validation-v2-dps-stacking-passive'
  | 'images'
  | AdminResourceRouteId;

export type NavigationItem = {
  id: RouteId;
  label: string;
  summary: string;
};

export type NavigationGroupId = 'data-management' | 'wasm-validation';

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

export const adminResourceRouteMap: Record<BuiltinAdminResourceRouteId, AdminResourceKind> = {
  'formula-profiles': 'formulaProfiles',
  'formula-bindings': 'formulaBindings',
  'coefficient-buckets': 'coefficientBuckets',
  'status-action-control-rules': 'statusActionControlRules'
};

const dataManagementBaseNavigationItems: NavigationItem[] = [
  {
    id: 'overview',
    label: '系统总览',
    summary: '查看前后端能力、接口约束和当前工作面状态。'
  },
  {
    id: 'workspace',
    label: '版本发布',
    summary: '集中处理版本发布以及 current / bundle 快照校验。'
  },
  {
    id: 'images',
    label: '图片缓存',
    summary: '查看并同步图片缓存资源。'
  }
];

const wasmSimulationNavigationItems: NavigationItem[] = [
  {
    id: 'wasm-validation',
    label: 'Wasm 验证',
    summary: 'TinyGo V2 M1 Actor 初始化快照与人工字段对照。'
  },
  {
    id: 'wasm-validation-m2',
    label: 'Wasm 验证 M2',
    summary: 'TinyGo V2 M2 Action 初始状态快照与人工基线对照。'
  },
  {
    id: 'wasm-validation-m3',
    label: 'Wasm 验证 M3/M4',
    summary: 'TinyGo V2 M3 单技能与 M4 机制扩展字段级证据。'
  },
  {
    id: 'wasm-validation-m4-closure',
    label: 'Wasm 验证 M4 闭环',
    summary: 'TinyGo V2 M4 剩余页面能力缺口的固定 preset 闭环验证。'
  },
  {
    id: 'wasm-validation-v2-dps',
    label: 'V2 DPS 验证',
    summary: 'TinyGo V2 单攻击方站桩普攻 DPS 验证。'
  },
  {
    id: 'wasm-validation-v2-dps-multi-hero',
    label: 'V2 DPS 多英雄',
    summary: '多英雄共用同一目标与装备的 TinyGo V2 DPS 对比。'
  },
  {
    id: 'wasm-validation-v2-dps-stacking-passive',
    label: 'V2 DPS 批量英雄',
    summary: '验证 3124 Guinsoo p_boiling 叠层攻速被动从 published bundle 到 Wasm 输出的链路。'
  }
];

const extendedAdminRouteItems: NavigationItem[] = [
  {
    id: 'heroes',
    label: '英雄',
    summary: '维护英雄主数据、头像与基础数值。'
  },
  {
    id: 'skills',
    label: '技能',
    summary: '维护技能归属、键位、描述与机制配置。'
  },
  {
    id: 'items',
    label: '装备',
    summary: '维护装备成本、图标、属性修正与引用。'
  },
  {
    id: 'attribute-definitions',
    label: '属性定义',
    summary: '维护属性键、类型、默认值与取值语义。'
  },
  {
    id: 'status-management',
    label: '状态管理',
    summary: '统一维护状态定义、控制语义、效果组和周期生命效果。'
  },
  {
    id: 'types',
    label: '类型定义',
    summary: '维护类型标签、描述与保留映射。'
  },
  {
    id: 'type-relations',
    label: '类型挂载',
    summary: '把类型挂到目标实体并维护附加扩展信息。'
  },
  {
    id: 'skill-mounts',
    label: '技能挂载',
    summary: '把技能挂到英雄、装备或其它目标并维护槽位与扩展信息。'
  }
];

const builtinAdminRouteItems: NavigationItem[] = adminResourceNavigationItemsFromAdminConfig.map((item) => ({
  id: item.hashSegment as BuiltinAdminResourceRouteId,
  label: item.label,
  summary: item.summary
}));

const dataManagementNavigationItems: NavigationItem[] = [
  ...dataManagementBaseNavigationItems,
  ...extendedAdminRouteItems,
  ...builtinAdminRouteItems
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

export const navigationItems: NavigationItem[] = [...dataManagementNavigationItems, ...wasmSimulationNavigationItems];

export const adminResourceNavigationItems: AdminResourceNavigationItem[] = adminResourceNavigationItemsFromAdminConfig;

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
    description: '获取当前已发布快照信息，并用 versionCode 驱动 Bundle 刷新。'
  },
  {
    title: '版本 Bundle',
    method: 'GET',
    path: '/api/games/{gameId}/versions/{versionCode}/bundle',
    description: '按 versionCode 拉取已发布快照，不再依赖 versionId / ETag。'
  },
  {
    title: '图片资源',
    method: 'GET',
    path: '/api/games/{gameId}/images?updatedAfter=...',
    description: '支持图片资源的全量与增量同步。'
  },
  {
    title: '归属分类字典',
    method: 'GET',
    path: '/api/games/{gameId}/owner-categories',
    description: '为技能等资源页提供 ownerType 参考值。'
  }
];

export const adminEndpoints: AdminEndpoint[] = [
  {
    title: '英雄',
    method: 'GET/PUT',
    path: '/api/admin/games/{gameId}/heroes/{heroId}',
    description: '列表读取与整条 PUT 保存英雄数据。',
    sampleBody: {
      name: 'Ahri',
      baseStats: {
        hp: 500,
        atk: 55
      }
    }
  },
  {
    title: '技能',
    method: 'GET/PUT',
    path: '/api/admin/games/{gameId}/skills/{skillId}',
    description: '列表读取与整条 PUT 保存技能配置。',
    sampleBody: {
      ownerType: 'hero',
      ownerId: 'hero_ahri',
      skillKey: 'Q',
      name: 'Orb of Deception'
    }
  },
  {
    title: '装备',
    method: 'GET/PUT',
    path: '/api/admin/games/{gameId}/items/{itemId}',
    description: '列表读取与整条 PUT 保存装备主数据。',
    sampleBody: {
      name: 'Boots',
      goldCost: 300
    }
  },
  {
    title: '属性定义',
    method: 'GET/PUT',
    path: '/api/admin/games/{gameId}/attribute-definitions/{attrKey}',
    description: '列表读取与整条 PUT 保存属性定义。',
    sampleBody: {
      attrName: 'Attack Damage',
      attrType: 'number',
      defaultValue: 0,
      valueKind: 'scalar'
    }
  },
  {
    title: '类型定义',
    method: 'GET/PUT',
    path: '/api/admin/games/{gameId}/types/{typeId}',
    description: '列表读取与整条 PUT 保存类型定义。',
    sampleBody: {
      name: 'Marksman',
      description: 'role tag'
    }
  },
  {
    title: '类型挂载',
    method: 'GET/PUT',
    path: '/api/admin/games/{gameId}/type-relations/{typeId}/{targetCategory}/{targetId}',
    description: '列表读取与整条 PUT 保存类型挂载关系。',
    sampleBody: {
      extend: {}
    }
  },
  {
    title: '技能挂载',
    method: 'GET/PUT',
    path: '/api/admin/games/{gameId}/skill-mounts/{targetCategory}/{targetId}/{skillId}',
    description: '列表读取与整条 PUT 保存技能挂载关系；自然键为 targetCategory + targetId + skillId。',
    sampleBody: {
      targetCategory: 'hero',
      targetId: 'hero_ezreal',
      skillId: 'skill_lol_basic_attack_default',
      enabled: true,
      extend: {}
    }
  },
  {
    title: '公式档案',
    method: 'GET/PUT',
    path: '/api/admin/games/{gameId}/formula-profiles/{formulaId}',
    description: '列表读取与整条 PUT 保存公式定义。',
    sampleBody: {
      formulaId: 'damage.skill.katarina.r.base',
      formulaType: 'damage',
      formulaKind: 'base',
      params: { base: 1 }
    }
  },
  {
    title: '公式绑定',
    method: 'GET/PUT',
    path: '/api/admin/games/{gameId}/formula-bindings/{targetCategory}/{targetId}/{bindingKey}',
    description: '列表读取与整条 PUT 保存目标实体上的公式绑定。',
    sampleBody: {
      targetCategory: 'skill',
      targetId: 'skill_katarina_r',
      bindingKey: 'damage.base',
      formulaId: 'damage.skill.katarina.r.base',
      overrideParams: {}
    }
  },
  {
    title: '乘区桶',
    method: 'GET/PUT',
    path: '/api/admin/games/{gameId}/coefficient-buckets/{bucketKey}',
    description: '列表读取与整条 PUT 保存乘区桶配置。',
    sampleBody: {
      bucketKey: 'magic_damage.percent_bonus',
      resolutionDomain: 'attribute',
      stageKey: 'percent_bonus',
      targetAttrKey: 'move_speed',
      aggregationMode: 'add'
    }
  },
  {
    title: '状态动作规则',
    method: 'GET/PUT',
    path: '/api/admin/games/{gameId}/status-action-control-rules/{ruleId}',
    description: '列表读取与整条 PUT 保存状态动作规则。',
    sampleBody: {
      ruleId: 'status_stun_forbid_cast',
      statusTypeId: 50020,
      ruleKind: 'forbid',
      actionTypeIds: [50101, 50102],
      actionMatchTypeIds: [],
      interruptPhaseTypeIds: [],
      priority: 100
    }
  },
  {
    title: '版本发布',
    method: 'POST',
    path: '/api/admin/games/{gameId}/versions:publish',
    description: '在独立发布页直接提交 versionCode 与可选 releaseDate 并发布快照。'
  }
];
