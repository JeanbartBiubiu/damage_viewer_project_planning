import { assertNumericUses } from './numericValue';
import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import { skillsPath } from './skillClient';
import { parseSkillProcessMoment } from './skillProcessMoment';
import type {
  CreateSkillProcessRequest,
  SkillProcess,
  SkillProcessSummary,
  UpdateSkillProcessRequest
} from '../types/skillProcess';

export class SkillProcessProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillProcessProtocolError';
  }
}

function processesPath(gameId: string, skillKey: string, processKey?: string): string {
  const base = `${skillsPath(gameId, skillKey)}/processes`;
  return processKey === undefined ? base : `${base}/${encodePathSegment(processKey)}`;
}

export function listSkillProcesses(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string
): Promise<ApiResult<SkillProcessSummary[]>> {
  return requestJson<SkillProcessSummary[]>(apiBaseUrl, processesPath(gameId, skillKey));
}

export function getSkillProcess(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  processKey: string
): Promise<ApiResult<SkillProcess>> {
  return requestJson<SkillProcess>(apiBaseUrl, processesPath(gameId, skillKey, processKey)).then((result) => ({ ...result, data: parseSkillProcess(result.data) }));
}

export function createSkillProcess(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  body: CreateSkillProcessRequest
): Promise<ApiResult<SkillProcess>> {
  return requestJson<SkillProcess>(apiBaseUrl, processesPath(gameId, skillKey), {
    method: 'POST',
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: parseSkillProcess(result.data) }));
}

export function updateSkillProcess(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  processKey: string,
  body: UpdateSkillProcessRequest
): Promise<ApiResult<SkillProcess>> {
  return requestJson<SkillProcess>(apiBaseUrl, processesPath(gameId, skillKey, processKey), {
    method: 'PUT',
    body: JSON.stringify(body)
  }).then((result) => ({ ...result, data: parseSkillProcess(result.data) }));
}

export function deleteSkillProcess(
  apiBaseUrl: string,
  gameId: string,
  skillKey: string,
  processKey: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, processesPath(gameId, skillKey, processKey), {
    method: 'DELETE'
  });
}

function protocolError(path: string): never {
  throw new SkillProcessProtocolError(`过程响应与固定联合类型不匹配：${path}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSkillProcess(value: unknown): SkillProcess {
  assertNumericUses(value, 'process', (path) => { throw new Error(`数值取值响应不合法：${path}`); });
  if (!isRecord(value)) protocolError('process');
  if (Array.isArray(value.steps)) value.steps.forEach((step, index) => {
    if (!isRecord(step) || step.occupiesAction != null && typeof step.occupiesAction !== 'boolean') {
      protocolError(`process.steps[${index}].occupiesAction`);
    }
    if (step.stepType === 'EMPOWERED_BASIC_ATTACK') {
      if (!isRecord(step.detail) || Object.keys(step.detail).some(key => !['windowValue', 'consumeMoment', 'maximumAttackCountValue'].includes(key))
        || step.detail.consumeMoment !== (Object.prototype.hasOwnProperty.call(step.detail, 'maximumAttackCountValue') ? 'ATTACK_START' : 'ATTACK_HIT')) {
        protocolError(`process.steps[${index}].detail`);
      }
    }
  });
  if (isRecord(value.cooldown) && 'startMoment' in value.cooldown) {
    value.cooldown.startMoment = parseSkillProcessMoment(
      value.cooldown.startMoment,
      'process.cooldown.startMoment',
      protocolError
    );
  }
  if (Array.isArray(value.effectBindings)) {
    value.effectBindings.forEach((item, index) => {
      if (!isRecord(item)) protocolError(`process.effectBindings[${index}]`);
      item.moment = parseSkillProcessMoment(
        item.moment,
        `process.effectBindings[${index}].moment`,
        protocolError
      );
    });
  }
  if (Array.isArray(value.stateOperations)) {
    value.stateOperations.forEach((item, index) => {
      if (!isRecord(item)) protocolError(`process.stateOperations[${index}]`);
      item.moment = parseSkillProcessMoment(
        item.moment,
        `process.stateOperations[${index}].moment`,
        protocolError
      );
    });
  }
  return value as SkillProcess;
}
