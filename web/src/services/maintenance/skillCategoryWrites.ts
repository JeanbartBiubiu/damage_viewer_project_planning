import type { ApiResult } from '../apiClient';
import type { CreateSkillCategoryRequest, SkillCategory, UpdateSkillCategoryRequest } from '../../types/skillCategory';
import { skillCategoriesPath } from '../skillCategoryClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

export function createSkillCategory(
  apiBaseUrl: string,
  gameId: string,
  body: CreateSkillCategoryRequest
): Promise<ApiResult<SkillCategory>> {
  return requestMaintenanceJson<SkillCategory>(apiBaseUrl, skillCategoriesPath(gameId), {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export function updateSkillCategory(
  apiBaseUrl: string,
  gameId: string,
  skillCategoryKey: string,
  body: UpdateSkillCategoryRequest
): Promise<ApiResult<SkillCategory>> {
  return requestMaintenanceJson<SkillCategory>(apiBaseUrl, skillCategoriesPath(gameId, skillCategoryKey), {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

export function deleteSkillCategory(
  apiBaseUrl: string,
  gameId: string,
  skillCategoryKey: string
): Promise<ApiResult<null>> {
  return requestMaintenanceJson<null>(apiBaseUrl, skillCategoriesPath(gameId, skillCategoryKey), {
    method: 'DELETE'
  });
}
