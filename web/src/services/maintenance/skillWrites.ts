import type { ApiResult } from '../apiClient';
import type { CreateSkillRequest, Skill, UpdateSkillRequest } from '../../types/skill';
import { skillsPath } from '../skillClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

export function createSkill(
  apiBaseUrl: string,
  gameId: string,
  body: CreateSkillRequest
): Promise<ApiResult<Skill>> {
  return requestMaintenanceJson<Skill>(apiBaseUrl, skillsPath(gameId), {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export function updateSkill(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  body: UpdateSkillRequest
): Promise<ApiResult<Skill>> {
  return requestMaintenanceJson<Skill>(apiBaseUrl, skillsPath(gameId, skillKey), {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

export function deleteSkill(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string
): Promise<ApiResult<null>> {
  return requestMaintenanceJson<null>(apiBaseUrl, skillsPath(gameId, skillKey), {
    method: 'DELETE'
  });
}
