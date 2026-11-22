import type { ApiResult } from '../apiClient';
import type { CreateSkillEffectRequest, SkillEffect, UpdateSkillEffectRequest } from '../../types/skillEffect';
import { effectsPath, maybeParseEffect } from '../skillEffectClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

export function createSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  body: CreateSkillEffectRequest
): Promise<ApiResult<SkillEffect>> {
  return requestMaintenanceJson<unknown>(apiBaseUrl, effectsPath(gameId, skillKey), {
    method: 'POST',
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: maybeParseEffect(result.data) }));
}

export function updateSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  effectKey: string,
  body: UpdateSkillEffectRequest
): Promise<ApiResult<SkillEffect>> {
  return requestMaintenanceJson<unknown>(apiBaseUrl, effectsPath(gameId, skillKey, effectKey), {
    method: 'PUT',
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: maybeParseEffect(result.data) }));
}

export function deleteSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  effectKey: string
): Promise<ApiResult<null>> {
  return requestMaintenanceJson<null>(apiBaseUrl, effectsPath(gameId, skillKey, effectKey), {
    method: 'DELETE'
  });
}
