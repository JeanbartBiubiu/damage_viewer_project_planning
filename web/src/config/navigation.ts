import type { JsonObject } from '../types/api';

export type RouteId = 'overview' | 'workspace' | 'images' | 'admin';

export type NavigationItem = {
  id: RouteId;
  label: string;
  summary: string;
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

export const navigationItems: NavigationItem[] = [
  {
    id: 'overview',
    label: '系统总览',
    summary: '对齐读写链路、版本模型和前端信息架构。'
  },
  {
    id: 'workspace',
    label: '游戏工作台',
    summary: '承接当前版本、Bundle 预览和内容规模概览。'
  },
  {
    id: 'images',
    label: '图片缓存',
    summary: '按现有方案接入 IndexDB 全量与增量同步。'
  },
  {
    id: 'admin',
    label: '编辑后台',
    summary: '预留 Admin CRUD、发布与公式扩展入口。'
  }
];

export const publicSurfaceEndpoints: SurfaceEndpoint[] = [
  {
    title: '游戏列表',
    method: 'GET',
    path: '/api/games',
    description: '动态发现可用的 gameId，并驱动整个前端入口。'
  },
  {
    title: '当前版本',
    method: 'GET',
    path: '/api/games/{gameId}/versions/current',
    description: '轮询当前已发布版本，作为 Bundle 与缓存刷新入口。'
  },
  {
    title: '版本 Bundle',
    method: 'GET',
    path: '/api/games/{gameId}/versions/{versionId}/bundle',
    description: '拉取当前版本全量数据包，供工作台和后续编辑器消费。'
  },
  {
    title: '图片资源',
    method: 'GET',
    path: '/api/games/{gameId}/images?updatedAfter=...',
    description: '支持全量和增量拉取，用于本地 IndexDB 图片缓存。'
  },
  {
    title: '技能归属字典',
    method: 'GET',
    path: '/api/games/{gameId}/owner-categories',
    description: '驱动技能编辑器里 ownerType 的可选项。'
  }
];

export const adminEndpoints: AdminEndpoint[] = [
  {
    title: '英雄',
    method: 'PUT/PATCH',
    path: '/api/admin/games/{gameId}/heroes/{heroId}',
    description: '维护英雄基础信息与成长属性。',
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
    method: 'PUT/PATCH',
    path: '/api/admin/games/{gameId}/skills/{skillId}',
    description: '维护 ownerType、mechanicsConfig 和技能表现数据。',
    sampleBody: {
      ownerType: 'hero',
      ownerId: 'hero_ahri',
      skillKey: 'Q',
      name: 'Orb of Deception',
      mechanicsConfig: {
        version: 1,
        triggers: []
      }
    }
  },
  {
    title: '装备',
    method: 'PUT/PATCH',
    path: '/api/admin/games/{gameId}/items/{itemId}',
    description: '维护装备信息、skillRefs 与 recipeIds。',
    sampleBody: {
      name: 'Amplifying Tome',
      goldCost: 435
    }
  },
  {
    title: '属性定义',
    method: 'PUT/PATCH',
    path: '/api/admin/games/{gameId}/attribute-definitions/{attrKey}',
    description: '维护前端和 WASM 共用的属性字典。',
    sampleBody: {
      attrName: 'Attack Damage',
      attrType: 'number',
      defaultValue: 0
    }
  },
  {
    title: '类型与挂载关系',
    method: 'PUT/PATCH',
    path: '/api/admin/games/{gameId}/types/{typeId} + /type-relations/{typeId}/{targetCategory}/{targetId}',
    description: '维护 type 树、挂载关系与规则引用基础。'
  },
  {
    title: '图片',
    method: 'PUT',
    path: '/api/admin/games/{gameId}/images/{uri}',
    description: '更新单图后立即回写本地 IndexDB。',
    sampleBody: {
      imageBase64: 'data:image/png;base64,...'
    }
  },
  {
    title: '状态动作控制',
    method: 'GET/PUT/PATCH',
    path: '/api/admin/games/{gameId}/status-action-control-rules/{ruleId}',
    description: '维护眩晕、打断、禁止动作等规则。',
    sampleBody: {
      statusTypeId: 50020,
      ruleKind: 'forbid',
      actionTypeIds: [50101, 50102],
      actionMatchTypeIds: [],
      interruptPhaseTypeIds: [],
      priority: 100
    }
  },
  {
    title: '乘区桶',
    method: 'GET/PUT/PATCH',
    path: '/api/admin/games/{gameId}/coefficient-buckets/{bucketKey}',
    description: '维护属性域和伤害域的聚合桶。',
    sampleBody: {
      resolutionDomain: 'attribute',
      stageKey: 'percent_bonus',
      targetAttrKey: 'move_speed',
      aggregationMode: 'add'
    }
  },
  {
    title: '公式扩展',
    method: 'GET/PUT/PATCH',
    path: '/api/admin/games/{gameId}/formula-profiles/{formulaId} + /formula-bindings/{targetCategory}/{targetId}/{bindingKey}',
    description: '对齐后端已经存在的公式配置与绑定能力。'
  },
  {
    title: '版本创建与发布',
    method: 'POST',
    path: '/api/admin/games/{gameId}/versions + /versions/{versionId}:publish',
    description: '把原始表冻结成当前版本，并切换读路径。',
    sampleBody: {
      versionCode: '14.1'
    }
  }
];
