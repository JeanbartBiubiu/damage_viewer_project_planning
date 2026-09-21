import { ApiRequestError } from '../../../services/apiClient';
import { getSkill } from '../../../services/skillClient';
import type { Skill } from '../../../types/skill';

export async function loadFocusedSkill(apiBaseUrl: string, gameId: string, skillKey: string, token: string): Promise<Skill> {
  const result = await getSkill(apiBaseUrl, gameId, skillKey, token);
  if (result.data?.gameId !== gameId || result.data?.skillKey !== skillKey) {
    throw new ApiRequestError('技能响应与当前选择不一致，请重新打开。', 502, '502.SKILL_RESPONSE_INVALID');
  }
  return result.data;
}
