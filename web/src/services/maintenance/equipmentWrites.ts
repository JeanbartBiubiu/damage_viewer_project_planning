import type { ApiResult } from '../apiClient';
import type { CreateEquipmentRequest, Equipment, EquipmentAttributes, UpdateEquipmentAttributesRequest, UpdateEquipmentRequest } from '../../types/equipment';
import { equipmentPath } from '../equipmentClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

export function createEquipment(
  apiBaseUrl: string,
  gameId: string,
  body: CreateEquipmentRequest
): Promise<ApiResult<Equipment>> {
  return requestMaintenanceJson<Equipment>(apiBaseUrl, equipmentPath(gameId), {
    method: 'POST', body: JSON.stringify(body)
  });
}

export function updateEquipment(
  apiBaseUrl: string,
  gameId: string,
  equipmentKey: string,
  body: UpdateEquipmentRequest
): Promise<ApiResult<Equipment>> {
  return requestMaintenanceJson<Equipment>(apiBaseUrl, equipmentPath(gameId, equipmentKey), {
    method: 'PUT', body: JSON.stringify(body)
  });
}

export function deleteEquipment(
  apiBaseUrl: string,
  gameId: string,
  equipmentKey: string
): Promise<ApiResult<null>> {
  return requestMaintenanceJson<null>(apiBaseUrl, equipmentPath(gameId, equipmentKey), {
    method: 'DELETE'
  });
}

export function updateEquipmentAttributes(
  apiBaseUrl: string,
  gameId: string,
  equipmentKey: string,
  body: UpdateEquipmentAttributesRequest
): Promise<ApiResult<EquipmentAttributes>> {
  return requestMaintenanceJson<EquipmentAttributes>(
    apiBaseUrl,
    `${equipmentPath(gameId, equipmentKey)}/attributes`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
}
