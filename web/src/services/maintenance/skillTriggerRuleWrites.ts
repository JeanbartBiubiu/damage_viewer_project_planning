import type { ApiResult } from '../apiClient';
import type { CreateSkillTriggerRuleRequest, SkillTriggerRuleDetail, UpdateSkillTriggerRuleRequest } from '../../types/skillTriggerRule';
import { maybeParseDetail, triggerRulesPath } from '../skillTriggerRuleClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

export function createSkillTriggerRule(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  body: CreateSkillTriggerRuleRequest
): Promise<ApiResult<SkillTriggerRuleDetail>> {
  return requestMaintenanceJson<unknown>(apiBaseUrl, triggerRulesPath(gameId, skillKey), {
    method: 'POST',
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: maybeParseDetail(result.data) }));
}

export function updateSkillTriggerRule(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  ruleKey: string,
  body: UpdateSkillTriggerRuleRequest
): Promise<ApiResult<SkillTriggerRuleDetail>> {
  return requestMaintenanceJson<unknown>(apiBaseUrl, triggerRulesPath(gameId, skillKey, ruleKey), {
    method: 'PUT',
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: maybeParseDetail(result.data) }));
}

export function deleteSkillTriggerRule(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  ruleKey: string
): Promise<ApiResult<null>> {
  return requestMaintenanceJson<null>(apiBaseUrl, triggerRulesPath(gameId, skillKey, ruleKey), {
    method: 'DELETE'
  });
}
