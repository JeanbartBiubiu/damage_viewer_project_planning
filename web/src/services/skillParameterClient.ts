import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import { skillsPath } from './skillClient';
import type {
  CreateSkillParameterRequest,
  SkillParameter,
  UpdateSkillParameterRequest
} from '../types/skillParameter';

function parametersPath(gameId: string, skillKey: string, parameterKey?: string): string {
  const base = `${skillsPath(gameId, skillKey)}/parameters`;
  return parameterKey === undefined ? base : `${base}/${encodePathSegment(parameterKey)}`;
}

export function listSkillParameters(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string
): Promise<ApiResult<SkillParameter[]>> {
  return requestJson<SkillParameter[]>(apiBaseUrl, parametersPath(gameId, skillKey), { token });
}

export function getSkillParameter(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  parameterKey: string,
  token: string
): Promise<ApiResult<SkillParameter>> {
  return requestJson<SkillParameter>(
    apiBaseUrl,
    parametersPath(gameId, skillKey, parameterKey),
    { token }
  );
}

export function createSkillParameter(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string,
  body: CreateSkillParameterRequest
): Promise<ApiResult<SkillParameter>> {
  return requestJson<SkillParameter>(apiBaseUrl, parametersPath(gameId, skillKey), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  });
}

export function updateSkillParameter(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  parameterKey: string,
  token: string,
  body: UpdateSkillParameterRequest
): Promise<ApiResult<SkillParameter>> {
  return requestJson<SkillParameter>(
    apiBaseUrl,
    parametersPath(gameId, skillKey, parameterKey),
    {
      method: 'PUT',
      token,
      body: JSON.stringify(body)
    }
  );
}

export function deleteSkillParameter(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  parameterKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, parametersPath(gameId, skillKey, parameterKey), {
    method: 'DELETE',
    token
  });
}
