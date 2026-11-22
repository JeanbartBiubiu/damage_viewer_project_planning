import { encodePathSegment } from '../apiClient';
import { type CreateBuildGroupRequest, type CreateBuildOptionRequest, type CreateBuildSystemRequest, type UpdateBuildGroupRequest, type UpdateBuildOptionRequest, type UpdateBuildSystemRequest } from '../../types/build';
import { basePath, exact, group, option, system } from '../buildClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

export function createBuildSystem(apiBaseUrl: string, gameId: string, body: CreateBuildSystemRequest) {
  return exact(requestMaintenanceJson(apiBaseUrl, basePath(gameId), { method: 'POST', body: JSON.stringify(body) }), value => system(value, gameId), value => value.systemKey, body.systemKey);
}

export function updateBuildSystem(apiBaseUrl: string, gameId: string, systemKey: string, body: UpdateBuildSystemRequest) {
  return exact(requestMaintenanceJson(apiBaseUrl, basePath(gameId, systemKey), { method: 'PUT', body: JSON.stringify(body) }), value => system(value, gameId), value => value.systemKey, systemKey);
}

export function deleteBuildSystem(apiBaseUrl: string, gameId: string, systemKey: string) {
  return requestMaintenanceJson<null>(apiBaseUrl, basePath(gameId, systemKey), { method: 'DELETE' });
}

export function createBuildGroup(apiBaseUrl: string, gameId: string, systemKey: string, body: CreateBuildGroupRequest) {
  return exact(requestMaintenanceJson(apiBaseUrl, `${basePath(gameId, systemKey)}/groups`, { method: 'POST', body: JSON.stringify(body) }), value => group(value, gameId, systemKey), value => value.groupKey, body.groupKey);
}

export function updateBuildGroup(apiBaseUrl: string, gameId: string, systemKey: string, groupKey: string, body: UpdateBuildGroupRequest) {
  return exact(requestMaintenanceJson(apiBaseUrl, `${basePath(gameId, systemKey)}/groups/${encodePathSegment(groupKey)}`, { method: 'PUT', body: JSON.stringify(body) }), value => group(value, gameId, systemKey), value => value.groupKey, groupKey);
}

export function deleteBuildGroup(apiBaseUrl: string, gameId: string, systemKey: string, groupKey: string) {
  return requestMaintenanceJson<null>(apiBaseUrl, `${basePath(gameId, systemKey)}/groups/${encodePathSegment(groupKey)}`, { method: 'DELETE' });
}

export function createBuildOption(apiBaseUrl: string, gameId: string, systemKey: string, body: CreateBuildOptionRequest) {
  return exact(requestMaintenanceJson(apiBaseUrl, `${basePath(gameId, systemKey)}/options`, { method: 'POST', body: JSON.stringify(body) }), value => option(value, gameId, systemKey), value => value.optionKey, body.optionKey);
}

export function updateBuildOption(apiBaseUrl: string, gameId: string, systemKey: string, optionKey: string, body: UpdateBuildOptionRequest) {
  return exact(requestMaintenanceJson(apiBaseUrl, `${basePath(gameId, systemKey)}/options/${encodePathSegment(optionKey)}`, { method: 'PUT', body: JSON.stringify(body) }), value => option(value, gameId, systemKey), value => value.optionKey, optionKey);
}

export function deleteBuildOption(apiBaseUrl: string, gameId: string, systemKey: string, optionKey: string) {
  return requestMaintenanceJson<null>(apiBaseUrl, `${basePath(gameId, systemKey)}/options/${encodePathSegment(optionKey)}`, { method: 'DELETE' });
}
