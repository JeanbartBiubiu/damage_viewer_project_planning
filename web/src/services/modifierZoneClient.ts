import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import { isLegalModifierZoneCombination } from '../types/modifierZone';
import type {
  CreateModifierZoneRequest,
  ModifierZone,
  ModifierZoneApplicationStage,
  ModifierZoneCalculationMode,
  ModifierZoneDomain,
  ModifierZoneListQuery,
  ModifierZoneListResponse,
  ModifierZoneStatus,
  UpdateModifierZoneRequest
} from '../types/modifierZone';

const DOMAINS = new Set<ModifierZoneDomain>(['ATTRIBUTE', 'DAMAGE', 'HEALING', 'SHIELD']);
const CALCULATION_MODES = new Set<ModifierZoneCalculationMode>(['FLAT_ADD', 'RATIO_ADD', 'RATIO_MAX']);
const APPLICATION_STAGES = new Set<ModifierZoneApplicationStage>([
  'ATTRIBUTE_FLAT', 'ATTRIBUTE_PERCENT', 'DAMAGE_PRE_DEFENSE', 'DAMAGE_POST_DEFENSE', 'HEALING_RESULT', 'SHIELD_RESULT'
]);
const STATUSES = new Set<ModifierZoneStatus>(['ENABLED', 'DISABLED']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseModifierZone(value: unknown): ModifierZone {
  if (!isRecord(value)) throw new Error('乘区响应不完整。');
  const domain = value.domain;
  const calculationMode = value.calculationMode;
  const applicationStage = value.applicationStage;
  const status = value.status;
  if (typeof value.modifierZoneKey !== 'string' || typeof value.name !== 'string'
    || typeof value.gameId !== 'string'
    || !DOMAINS.has(domain as ModifierZoneDomain)
    || !CALCULATION_MODES.has(calculationMode as ModifierZoneCalculationMode)
    || !APPLICATION_STAGES.has(applicationStage as ModifierZoneApplicationStage)
    || !STATUSES.has(status as ModifierZoneStatus)
    || (value.description !== null && typeof value.description !== 'string')
    || typeof value.sortOrder !== 'number' || !Number.isInteger(value.sortOrder)
    || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') {
    throw new Error('乘区响应缺少合法的作用域、计算方式或应用阶段。');
  }
  if (!isLegalModifierZoneCombination(
    domain as ModifierZoneDomain,
    calculationMode as ModifierZoneCalculationMode,
    applicationStage as ModifierZoneApplicationStage
  )) {
    throw new Error('乘区响应的作用域、计算方式和应用阶段组合不合法。');
  }
  return value as ModifierZone;
}

function parseModifierZoneResult(result: ApiResult<unknown>): ApiResult<ModifierZone> {
  return { ...result, data: parseModifierZone(result.data) };
}

function modifierZonesPath(gameId: string, modifierZoneKey?: string): string {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/modifier-zones`;
  return modifierZoneKey === undefined ? base : `${base}/${encodePathSegment(modifierZoneKey)}`;
}

function withQuery(path: string, query: ModifierZoneListQuery = {}): string {
  const params = new URLSearchParams();
  const keyword = query.keyword?.trim();
  if (keyword) params.set('keyword', keyword);
  if (query.domain) params.set('domain', query.domain);
  if (query.status) params.set('status', query.status);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function listModifierZones(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  query: ModifierZoneListQuery = {}
): Promise<ApiResult<ModifierZoneListResponse>> {
  return requestJson<unknown>(apiBaseUrl, withQuery(modifierZonesPath(gameId), query), { token }).then((result) => {
    if (!isRecord(result.data) || !Array.isArray(result.data.items) || typeof result.data.total !== 'number') {
      throw new Error('乘区目录响应不完整。');
    }
    return {
      ...result,
      data: { items: result.data.items.map(parseModifierZone), total: result.data.total }
    };
  });
}

export function getModifierZone(
  apiBaseUrl: string,
  gameId: string,
  modifierZoneKey: string,
  token: string
): Promise<ApiResult<ModifierZone>> {
  return requestJson<unknown>(apiBaseUrl, modifierZonesPath(gameId, modifierZoneKey), { token }).then(parseModifierZoneResult);
}

export function createModifierZone(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: CreateModifierZoneRequest
): Promise<ApiResult<ModifierZone>> {
  return requestJson<unknown>(apiBaseUrl, modifierZonesPath(gameId), {
    method: 'POST', token, body: JSON.stringify(body)
  }).then(parseModifierZoneResult);
}

export function updateModifierZone(
  apiBaseUrl: string,
  gameId: string,
  modifierZoneKey: string,
  token: string,
  body: UpdateModifierZoneRequest
): Promise<ApiResult<ModifierZone>> {
  return requestJson<unknown>(apiBaseUrl, modifierZonesPath(gameId, modifierZoneKey), {
    method: 'PUT', token, body: JSON.stringify(body)
  }).then(parseModifierZoneResult);
}

export function deleteModifierZone(
  apiBaseUrl: string,
  gameId: string,
  modifierZoneKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, modifierZonesPath(gameId, modifierZoneKey), {
    method: 'DELETE', token
  });
}
