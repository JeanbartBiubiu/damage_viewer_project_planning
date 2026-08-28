import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import { skillsPath } from './skillClient';
import type {
  CreateSkillProcessRequest,
  SkillProcess,
  SkillProcessSummary,
  UpdateSkillProcessRequest
} from '../types/skillProcess';

function processesPath(gameId: string, skillKey: string, processKey?: string): string {
  const base = `${skillsPath(gameId, skillKey)}/processes`;
  return processKey === undefined ? base : `${base}/${encodePathSegment(processKey)}`;
}

export function listSkillProcesses(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string
): Promise<ApiResult<SkillProcessSummary[]>> {
  return requestJson<SkillProcessSummary[]>(apiBaseUrl, processesPath(gameId, skillKey), { token });
}

export function getSkillProcess(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  processKey: string,
  token: string
): Promise<ApiResult<SkillProcess>> {
  return requestJson<SkillProcess>(apiBaseUrl, processesPath(gameId, skillKey, processKey), { token });
}

export function createSkillProcess(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string,
  body: CreateSkillProcessRequest
): Promise<ApiResult<SkillProcess>> {
  return requestJson<SkillProcess>(apiBaseUrl, processesPath(gameId, skillKey), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  });
}

export function updateSkillProcess(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  processKey: string,
  token: string,
  body: UpdateSkillProcessRequest
): Promise<ApiResult<SkillProcess>> {
  return requestJson<SkillProcess>(apiBaseUrl, processesPath(gameId, skillKey, processKey), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export function deleteSkillProcess(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  processKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, processesPath(gameId, skillKey, processKey), {
    method: 'DELETE',
    token
  });
}
