import type { JsonObject } from '../types/api';
import {
  adminResourceNavigationItems as adminResourceNavigationItemsFromAdminConfig,
  type AdminResourceKind,
  type AdminResourceNavigationItem
} from '../pages/admin/adminResourceConfig';

export type AdminResourceRouteId =
  | 'formula-profiles'
  | 'formula-bindings'
  | 'coefficient-buckets'
  | 'status-action-control-rules';

export type RouteId = 'overview' | 'workspace' | 'katarina-mvp' | 'images' | AdminResourceRouteId;

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

export const adminResourceRouteMap: Record<AdminResourceRouteId, AdminResourceKind> = {
  'formula-profiles': 'formulaProfiles',
  'formula-bindings': 'formulaBindings',
  'coefficient-buckets': 'coefficientBuckets',
  'status-action-control-rules': 'statusActionControlRules'
};

const baseNavigationItems: NavigationItem[] = [
  {
    id: 'overview',
    label: '系统总览',
    summary: '查看当前前后端能力、接口契约和工作面分工。'
  },
  {
    id: 'workspace',
    label: '版本发布',
    summary: '集中处理版本创建、版本发布以及 current / bundle 核对。'
  },
  {
    id: 'katarina-mvp',
    label: 'Katarina MVP',
    summary: '围绕 current + bundle 跑最小验证闭环。'
  },
  {
    id: 'images',
    label: '图片缓存',
    summary: '查看和同步图片缓存资源。'
  }
];

const adminResourceRouteItems: NavigationItem[] = adminResourceNavigationItemsFromAdminConfig.map((item) => ({
  id: item.hashSegment as AdminResourceRouteId,
  label: item.label,
  summary: item.summary
}));

export const navigationItems: NavigationItem[] = [...baseNavigationItems, ...adminResourceRouteItems];

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
    description: '获取当前已发布版本，作为 Bundle 与缓存刷新的入口。'
  },
  {
    title: '版本 Bundle',
    method: 'GET',
    path: '/api/games/{gameId}/versions/{versionId}/bundle',
    description: '拉取工作面和 MVP 运行依赖的当前数据包。'
  },
  {
    title: '图片资源',
    method: 'GET',
    path: '/api/games/{gameId}/images?updatedAfter=...',
    description: '支持图片的全量与增量同步。'
  },
  {
    title: '归属分类字典',
    method: 'GET',
    path: '/api/games/{gameId}/owner-categories',
    description: '为技能等编辑场景提供 ownerType 可选项。'
  }
];

export const adminEndpoints: AdminEndpoint[] = [
  {
    title: '公式档案',
    method: 'GET/PUT',
    path: '/api/admin/games/{gameId}/formula-profiles/{formulaId}',
    description: '列表读取和整条 PUT 保存公式定义、类型、种类和参数。',
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
    description: '列表读取和整条 PUT 保存目标实体上的公式绑定。',
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
    description: '列表读取和整条 PUT 保存乘区桶配置。',
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
    description: '列表读取和整条 PUT 保存状态动作控制规则。',
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
    title: '版本创建与发布',
    method: 'POST',
    path: '/api/admin/games/{gameId}/versions + /versions/{versionId}:publish',
    description: '在独立发布页面创建版本并发布到当前读链路。'
  }
];
