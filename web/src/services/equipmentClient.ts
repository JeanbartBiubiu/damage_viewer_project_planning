import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import type { Equipment, EquipmentAttributes, EquipmentListQuery, EquipmentListResponse } from '../types/equipment';

export function equipmentPath(gameId: string, equipmentKey?: string): string {
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
