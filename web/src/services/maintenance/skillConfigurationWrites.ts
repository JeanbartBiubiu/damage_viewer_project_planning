import type { ApiResult } from '../apiClient';
import type { CreateSkillConfigurationRequest, SkillConfiguration, UpdateSkillConfigurationRequest } from '../../types/skillConfiguration';
import { skillConfigurationPath, validateSkillConfiguration } from '../skillConfigurationClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

export async function createSkillConfiguration(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  body: CreateSkillConfigurationRequest
): Promise<ApiResult<SkillConfiguration>> {
  const result = await requestMaintenanceJson<unknown>(apiBaseUrl, skillConfigurationPath(gameId, skillKey), {
    method: 'POST', body: JSON.stringify(body)
  });
  return { ...result, data: validateSkillConfiguration(result.data, gameId, skillKey) };
}

export async function updateSkillConfiguration(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  body: UpdateSkillConfigurationRequest
): Promise<ApiResult<SkillConfiguration>> {
  const result = await requestMaintenanceJson<unknown>(apiBaseUrl, skillConfigurationPath(gameId, skillKey), {
    method: 'PATCH', body: JSON.stringify(body)
  });
  return { ...result, data: validateSkillConfiguration(result.data, gameId, skillKey) };
}
