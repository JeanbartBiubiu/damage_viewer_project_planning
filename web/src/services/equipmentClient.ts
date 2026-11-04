import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import type {
  CreateEquipmentRequest,
  Equipment,
  EquipmentAttributes,
  EquipmentListQuery,
  EquipmentListResponse,
  UpdateEquipmentAttributesRequest,
  UpdateEquipmentRequest
} from '../types/equipment';

function equipmentPath(gameId: string, equipmentKey?: string): string {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/equipment`;
  return equipmentKey === undefined ? base : `${base}/${encodePathSegment(equipmentKey)}`;
}

export function listEquipment(
  apiBaseUrl: string,
  gameId: string,
  query: EquipmentListQuery = {},
  signal?: AbortSignal
): Promise<ApiResult<EquipmentListResponse>> {
  const keyword = query.keyword?.trim();
  const path = keyword
    ? `${equipmentPath(gameId)}?${new URLSearchParams({ keyword }).toString()}`
    : equipmentPath(gameId);
  return requestJson<EquipmentListResponse>(apiBaseUrl, path, { signal });
}

export function getEquipment(
  apiBaseUrl: string,
  gameId: string,
  equipmentKey: string
): Promise<ApiResult<Equipment>> {
  return requestJson<Equipment>(apiBaseUrl, equipmentPath(gameId, equipmentKey));
}

export function createEquipment(
  apiBaseUrl: string,
  gameId: string,
  body: CreateEquipmentRequest
): Promise<ApiResult<Equipment>> {
  return requestJson<Equipment>(apiBaseUrl, equipmentPath(gameId), {
    method: 'POST', body: JSON.stringify(body)
  });
}

export function updateEquipment(
  apiBaseUrl: string,
  gameId: string,
  equipmentKey: string,
  body: UpdateEquipmentRequest
): Promise<ApiResult<Equipment>> {
  return requestJson<Equipment>(apiBaseUrl, equipmentPath(gameId, equipmentKey), {
    method: 'PUT', body: JSON.stringify(body)
  });
}

export function deleteEquipment(
  apiBaseUrl: string,
  gameId: string,
  equipmentKey: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, equipmentPath(gameId, equipmentKey), {
    method: 'DELETE'
  });
}

export function getEquipmentAttributes(
  apiBaseUrl: string,
  gameId: string,
  equipmentKey: string
): Promise<ApiResult<EquipmentAttributes>> {
  return requestJson<EquipmentAttributes>(
    apiBaseUrl,
    `${equipmentPath(gameId, equipmentKey)}/attributes`
  );
}

export function updateEquipmentAttributes(
  apiBaseUrl: string,
  gameId: string,
  equipmentKey: string,
  body: UpdateEquipmentAttributesRequest
): Promise<ApiResult<EquipmentAttributes>> {
  return requestJson<EquipmentAttributes>(
    apiBaseUrl,
    `${equipmentPath(gameId, equipmentKey)}/attributes`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
}
