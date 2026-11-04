import { assertNumericUses } from './numericValue';
import { isCounterTargetTiming } from './counterTargetTiming';
import type { NumericValue } from '../types/numericValue';
import type { SkillTriggerSceneInitialParameterBinding } from '../types/skillTriggerRule';
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
  skillKey: string
): Promise<ApiResult<SkillInternalStateSummary[]>> {
  return requestJson<SkillInternalStateSummary[]>(apiBaseUrl, internalStatesPath(gameId, skillKey));
}

export function getSkillInternalState(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  stateKey: string
): Promise<ApiResult<SkillInternalState>> {
  return requestJson<SkillInternalState>(apiBaseUrl, internalStatesPath(gameId, skillKey, stateKey)).then((result) => ({ ...result, data: parseSkillInternalState(result.data) }));
}

export function createSkillInternalState(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  body: CreateSkillInternalStateRequest
): Promise<ApiResult<SkillInternalState>> {
  return requestJson<SkillInternalState>(apiBaseUrl, internalStatesPath(gameId, skillKey), {
    method: 'POST',
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: parseSkillInternalState(result.data) }));
}

export function updateSkillInternalState(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  stateKey: string,
  body: UpdateSkillInternalStateRequest
): Promise<ApiResult<SkillInternalState>> {
  return requestJson<SkillInternalState>(apiBaseUrl, internalStatesPath(gameId, skillKey, stateKey), {
    method: 'PUT',
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: parseSkillInternalState(result.data) }));
}

export function deleteSkillInternalState(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  stateKey: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, internalStatesPath(gameId, skillKey, stateKey), {
    method: 'DELETE'
  });
}

export function parseSkillInternalState(value: unknown): SkillInternalState {
  assertNumericUses(value, 'state', (path) => { throw new Error(`数值取值响应不合法：${path}`); });
  const row = value as SkillInternalState;
  if (row.detail && Object.prototype.hasOwnProperty.call(row.detail, 'targetTiming')) {
    if (row.stateType !== 'COUNTER' || row.scope !== 'TARGET' || row.detail.initialValueBinding !== undefined
      || !isCounterTargetTiming(row.detail.targetTiming) || !row.detail.durationValue
      || row.detail.durationValue.kind === 'FIXED' && (!Number.isSafeInteger(row.detail.durationValue.value) || row.detail.durationValue.value <= 0)
      || row.detail.initialValue.kind === 'FIXED' && row.detail.initialValue.value !== 0
      || row.detail.maxValue.kind === 'FIXED' && row.detail.maxValue.value !== 1) {
      throw new Error('目标时序声明响应不合法：detail.targetTiming');
    }
  }
  if (row.stateType === 'COUNTER' || row.stateType === 'AMMO') {
    const declarations: Array<[SkillTriggerSceneInitialParameterBinding | undefined, NumericValue | undefined, string]> = [
      [row.detail.initialValueBinding, row.detail.initialValue, 'initialValueBinding']];
    if (row.stateType === 'AMMO') declarations.push([row.detail.initialRemainingMsBinding, row.detail.initialRemainingValue, 'initialRemainingMsBinding']);
    for (const [binding, numeric, path] of declarations) if (binding !== undefined) {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)
        || Object.keys(binding).length !== 4 || Object.keys(binding).some(key => !['bindingKey', 'parameterKey', 'sourceType', 'detail'].includes(key))
        || row.scope !== 'SKILL' || binding.sourceType !== 'SCENE_INITIAL_PARAMETER'
        || typeof binding.bindingKey !== 'string' || typeof binding.parameterKey !== 'string'
        || !/^[a-z][a-z0-9_]{0,63}$/.test(binding.bindingKey) || !/^[a-z][a-z0-9_]{0,63}$/.test(binding.parameterKey)
        || !numeric || numeric.kind !== 'PARAMETER' || numeric.parameterKey !== binding.parameterKey
        || !binding.detail || typeof binding.detail !== 'object' || Array.isArray(binding.detail)
        || Object.keys(binding.detail).some(key => !['minValue', 'maxValue', 'sharedInputKey'].includes(key))
        || Object.prototype.hasOwnProperty.call(binding.detail, 'sharedInputKey') && (typeof binding.detail.sharedInputKey !== 'string'
          || !/^[a-z][a-z0-9_]{0,63}$/.test(binding.detail.sharedInputKey))
        || !Number.isSafeInteger(binding.detail.minValue) || !Number.isSafeInteger(binding.detail.maxValue)
        || binding.detail.minValue < 0 || binding.detail.minValue > binding.detail.maxValue) throw new Error(`状态初值声明响应不合法：detail.${path}`);
    }
  }
  return value as SkillInternalState;
}
