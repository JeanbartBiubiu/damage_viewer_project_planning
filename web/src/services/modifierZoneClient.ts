import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import type {
  CreateModifierZoneRequest,
  ModifierZone,
  ModifierZoneListQuery,
  ModifierZoneListResponse,
  UpdateModifierZoneRequest
} from '../types/modifierZone';

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
  return requestJson<ModifierZoneListResponse>(apiBaseUrl, withQuery(modifierZonesPath(gameId), query), { token });
}

export function getModifierZone(
  apiBaseUrl: string,
  gameId: string,
  modifierZoneKey: string,
  token: string
): Promise<ApiResult<ModifierZone>> {
  return requestJson<ModifierZone>(apiBaseUrl, modifierZonesPath(gameId, modifierZoneKey), { token });
}

export function createModifierZone(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: CreateModifierZoneRequest
): Promise<ApiResult<ModifierZone>> {
  return requestJson<ModifierZone>(apiBaseUrl, modifierZonesPath(gameId), {
    method: 'POST', token, body: JSON.stringify(body)
  });
}

export function updateModifierZone(
  apiBaseUrl: string,
  gameId: string,
  modifierZoneKey: string,
  token: string,
  body: UpdateModifierZoneRequest
): Promise<ApiResult<ModifierZone>> {
  return requestJson<ModifierZone>(apiBaseUrl, modifierZonesPath(gameId, modifierZoneKey), {
    method: 'PUT', token, body: JSON.stringify(body)
  });
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
