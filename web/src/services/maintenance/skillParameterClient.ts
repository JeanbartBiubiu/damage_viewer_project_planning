import { requestMaintenanceJson } from '../maintenanceApiRequest';
import type { ApiResult } from '../apiClient';
import { encodePathSegment } from '../apiClient';
import { skillsPath } from '../skillClient';
import type { CreateSkillParameterRequest, SkillParameter, UpdateSkillParameterRequest } from '../../types/skillParameter';

function parametersPath(gameId: string, skillKey: string, parameterKey?: string): string {
  const base = `${skillsPath(gameId, skillKey)}/parameters`;
  return parameterKey === undefined ? base : `${base}/${encodePathSegment(parameterKey)}`;
}

export function listSkillParameters(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string
): Promise<ApiResult<SkillParameter[]>> {
  return requestMaintenanceJson<SkillParameter[]>(apiBaseUrl, parametersPath(gameId, skillKey));
}

export function getSkillParameter(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  parameterKey: string
): Promise<ApiResult<SkillParameter>> {
  return requestMaintenanceJson<SkillParameter>(
    apiBaseUrl,
    parametersPath(gameId, skillKey, parameterKey)
  );
}

export function createSkillParameter(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  body: CreateSkillParameterRequest
): Promise<ApiResult<SkillParameter>> {
  return requestMaintenanceJson<SkillParameter>(apiBaseUrl, parametersPath(gameId, skillKey), {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export function updateSkillParameter(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  parameterKey: string,
  body: UpdateSkillParameterRequest
): Promise<ApiResult<SkillParameter>> {
  return requestMaintenanceJson<SkillParameter>(
    apiBaseUrl,
    parametersPath(gameId, skillKey, parameterKey),
    {
      method: 'PUT',
      body: JSON.stringify(body)
    }
  );
}

export function deleteSkillParameter(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  parameterKey: string
): Promise<ApiResult<null>> {
  return requestMaintenanceJson<null>(apiBaseUrl, parametersPath(gameId, skillKey, parameterKey), {
    method: 'DELETE'
  });
}
