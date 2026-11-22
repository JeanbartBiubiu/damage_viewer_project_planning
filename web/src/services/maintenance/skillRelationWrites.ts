import type { ApiRequestOptions, ApiResult } from '../apiClient';
import type { CharacterSkillRelation, CreateCharacterSkillRelationRequest, CreateEquipmentSkillRelationRequest, EquipmentSkillRelation, BuildOptionSkillRelation, CreateBuildOptionSkillRelationRequest, UpdateBuildOptionSkillRelationRequest, UpdateSkillRelationRequest } from '../../types/skillRelation';
import { buildRelationPath, normalizeRelation, parseBuildOptionSkillRelation, path, protocolError, relationOwnerKey } from '../skillRelationClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

async function writeRelation<T extends CharacterSkillRelation | EquipmentSkillRelation>(
  apiBaseUrl: string, requestPath: string, options: ApiRequestOptions,
  normalize: (value: unknown) => T, ownerKey: string, skillKey: string
): Promise<ApiResult<T>> {
  const result = await requestMaintenanceJson<unknown>(apiBaseUrl, requestPath, options);
  const data = normalize(result.data);
  if (data.skillKey !== skillKey
    || relationOwnerKey(data) !== ownerKey) return protocolError();
  return { ...result, data };
}

export function createCharacterSkillRelation(
  apiBaseUrl: string, gameId: string, body: CreateCharacterSkillRelationRequest
): Promise<ApiResult<CharacterSkillRelation>> {
  return writeRelation(apiBaseUrl, path(gameId, 'character'), { method: 'POST', body: JSON.stringify(body) },
    value => normalizeRelation(value, gameId, 'character'), body.characterKey, body.skillKey);
}

export function createEquipmentSkillRelation(
  apiBaseUrl: string, gameId: string, body: CreateEquipmentSkillRelationRequest
): Promise<ApiResult<EquipmentSkillRelation>> {
  return writeRelation(apiBaseUrl, path(gameId, 'equipment'), { method: 'POST', body: JSON.stringify(body) },
    value => normalizeRelation(value, gameId, 'equipment'), body.equipmentKey, body.skillKey);
}

export function updateCharacterSkillRelation(
  apiBaseUrl: string, gameId: string, characterKey: string, skillKey: string,
  body: UpdateSkillRelationRequest
): Promise<ApiResult<CharacterSkillRelation>> {
  return writeRelation(apiBaseUrl, path(gameId, 'character', characterKey, skillKey),
    { method: 'PUT', body: JSON.stringify({ sortOrder: body.sortOrder }) },
    value => normalizeRelation(value, gameId, 'character'), characterKey, skillKey);
}

export function updateEquipmentSkillRelation(
  apiBaseUrl: string, gameId: string, equipmentKey: string, skillKey: string,
  body: UpdateSkillRelationRequest
): Promise<ApiResult<EquipmentSkillRelation>> {
  return writeRelation(apiBaseUrl, path(gameId, 'equipment', equipmentKey, skillKey),
    { method: 'PUT', body: JSON.stringify({ sortOrder: body.sortOrder }) },
    value => normalizeRelation(value, gameId, 'equipment'), equipmentKey, skillKey);
}

async function deleteRelation(apiBaseUrl: string, requestPath: string): Promise<ApiResult<null>> {
  const result = await requestMaintenanceJson<unknown>(apiBaseUrl, requestPath, { method: 'DELETE' });
  if (result.status !== 204 || result.data !== null) return protocolError();
  return { ...result, data: null };
}

export function deleteCharacterSkillRelation(
  apiBaseUrl: string, gameId: string, characterKey: string, skillKey: string
): Promise<ApiResult<null>> {
  return deleteRelation(apiBaseUrl, path(gameId, 'character', characterKey, skillKey));
}

export function deleteEquipmentSkillRelation(
  apiBaseUrl: string, gameId: string, equipmentKey: string, skillKey: string
): Promise<ApiResult<null>> {
  return deleteRelation(apiBaseUrl, path(gameId, 'equipment', equipmentKey, skillKey));
}

async function writeBuildRelation(
  apiBaseUrl: string, requestPath: string, options: ApiRequestOptions,
  expected: { systemKey: string; optionKey: string; skillKey: string }, gameId: string
): Promise<ApiResult<BuildOptionSkillRelation>> {
  const result = await requestMaintenanceJson<unknown>(apiBaseUrl, requestPath, options);
  const data = parseBuildOptionSkillRelation(result.data, gameId, expected);
  return { ...result, data };
}

export function createBuildOptionSkillRelation(
  apiBaseUrl: string, gameId: string, body: CreateBuildOptionSkillRelationRequest
): Promise<ApiResult<BuildOptionSkillRelation>> {
  return writeBuildRelation(apiBaseUrl, buildRelationPath(gameId), { method: 'POST', body: JSON.stringify(body) }, body, gameId);
}

export function updateBuildOptionSkillRelation(
  apiBaseUrl: string, gameId: string, systemKey: string, optionKey: string, skillKey: string,
  body: UpdateBuildOptionSkillRelationRequest
): Promise<ApiResult<BuildOptionSkillRelation>> {
  return writeBuildRelation(
    apiBaseUrl, buildRelationPath(gameId, systemKey, optionKey, skillKey),
    { method: 'PUT', body: JSON.stringify(body) },
    { systemKey, optionKey, skillKey }, gameId
  );
}

export function deleteBuildOptionSkillRelation(
  apiBaseUrl: string, gameId: string, systemKey: string, optionKey: string, skillKey: string
): Promise<ApiResult<null>> {
  return deleteRelation(apiBaseUrl, buildRelationPath(gameId, systemKey, optionKey, skillKey));
}
