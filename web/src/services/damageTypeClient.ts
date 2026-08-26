import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import type {
  CreateDamageTypeRequest,
  DamageType,
  DamageTypeListQuery,
  DamageTypeListResponse,
  UpdateDamageTypeRequest
} from '../types/damageType';

function damageTypesPath(gameId: string, damageTypeKey?: string): string {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/damage-types`;
  return damageTypeKey === undefined ? base : `${base}/${encodePathSegment(damageTypeKey)}`;
}

function withQuery(path: string, query: DamageTypeListQuery = {}): string {
  const params = new URLSearchParams();
  const keyword = query.keyword?.trim();
  if (keyword) params.set('keyword', keyword);
  if (query.status) params.set('status', query.status);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function listDamageTypes(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  query: DamageTypeListQuery = {}
): Promise<ApiResult<DamageTypeListResponse>> {
  return requestJson<DamageTypeListResponse>(
    apiBaseUrl,
    withQuery(damageTypesPath(gameId), query),
    { token }
  );
}

export function getDamageType(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string,
  token: string
): Promise<ApiResult<DamageType>> {
  return requestJson<DamageType>(apiBaseUrl, damageTypesPath(gameId, damageTypeKey), { token });
}

export function createDamageType(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: CreateDamageTypeRequest
): Promise<ApiResult<DamageType>> {
  return requestJson<DamageType>(apiBaseUrl, damageTypesPath(gameId), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  });
}

export function updateDamageType(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string,
  token: string,
  body: UpdateDamageTypeRequest
): Promise<ApiResult<DamageType>> {
  return requestJson<DamageType>(apiBaseUrl, damageTypesPath(gameId, damageTypeKey), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export function deleteDamageType(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, damageTypesPath(gameId, damageTypeKey), {
    method: 'DELETE',
    token
  });
}
