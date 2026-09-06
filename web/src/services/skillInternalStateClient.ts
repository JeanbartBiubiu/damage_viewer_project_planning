import { assertNumericUses } from './numericValue';
import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import { skillsPath } from './skillClient';
import type {
  CreateSkillInternalStateRequest,
  SkillInternalState,
  SkillInternalStateSummary,
  UpdateSkillInternalStateRequest
} from '../types/skillInternalState';

function internalStatesPath(gameId: string, skillKey: string, stateKey?: string): string {
  const base = `${skillsPath(gameId, skillKey)}/internal-states`;
  return stateKey === undefined ? base : `${base}/${encodePathSegment(stateKey)}`;
}

export function listSkillInternalStates(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string
): Promise<ApiResult<SkillInternalStateSummary[]>> {
  return requestJson<SkillInternalStateSummary[]>(apiBaseUrl, internalStatesPath(gameId, skillKey), { token });
}

export function getSkillInternalState(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  stateKey: string,
  token: string
): Promise<ApiResult<SkillInternalState>> {
  return requestJson<SkillInternalState>(apiBaseUrl, internalStatesPath(gameId, skillKey, stateKey), { token }).then((result) => ({ ...result, data: parseSkillInternalState(result.data) }));
}

export function createSkillInternalState(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  token: string,
  body: CreateSkillInternalStateRequest
): Promise<ApiResult<SkillInternalState>> {
  return requestJson<SkillInternalState>(apiBaseUrl, internalStatesPath(gameId, skillKey), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: parseSkillInternalState(result.data) }));
}

export function updateSkillInternalState(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  stateKey: string,
  token: string,
  body: UpdateSkillInternalStateRequest
): Promise<ApiResult<SkillInternalState>> {
  return requestJson<SkillInternalState>(apiBaseUrl, internalStatesPath(gameId, skillKey, stateKey), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: parseSkillInternalState(result.data) }));
}

export function deleteSkillInternalState(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  stateKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, internalStatesPath(gameId, skillKey, stateKey), {
    method: 'DELETE',
    token
  });
}

export function parseSkillInternalState(value: unknown): SkillInternalState {
  assertNumericUses(value, 'state', (path) => { throw new Error(`数值取值响应不合法：${path}`); });
  return value as SkillInternalState;
}
