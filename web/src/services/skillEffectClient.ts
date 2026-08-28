import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import { skillsPath } from './skillClient';
import type {
  CreateSkillEffectRequest,
  SkillEffect,
  SkillEffectSummary,
  UpdateSkillEffectRequest
} from '../types/skillEffect';

function effectsPath(gameId: string, skillKey: string, effectKey?: string): string {
  const base = `${skillsPath(gameId, skillKey)}/effects`;
  return effectKey === undefined ? base : `${base}/${encodePathSegment(effectKey)}`;
}

export function listSkillEffects(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string
): Promise<ApiResult<SkillEffectSummary[]>> {
  return requestJson<SkillEffectSummary[]>(apiBaseUrl, effectsPath(gameId, skillKey), { token });
}

export function getSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  effectKey: string,
  token: string
): Promise<ApiResult<SkillEffect>> {
  return requestJson<SkillEffect>(apiBaseUrl, effectsPath(gameId, skillKey, effectKey), { token });
}

export function createSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string,
  body: CreateSkillEffectRequest
): Promise<ApiResult<SkillEffect>> {
  return requestJson<SkillEffect>(apiBaseUrl, effectsPath(gameId, skillKey), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  });
}

export function updateSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  effectKey: string,
  token: string,
  body: UpdateSkillEffectRequest
): Promise<ApiResult<SkillEffect>> {
  return requestJson<SkillEffect>(apiBaseUrl, effectsPath(gameId, skillKey, effectKey), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export function deleteSkillEffect(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  effectKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, effectsPath(gameId, skillKey, effectKey), {
    method: 'DELETE',
    token
  });
}
