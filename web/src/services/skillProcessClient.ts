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
  return requestJson<SkillProcess>(apiBaseUrl, processesPath(gameId, skillKey, processKey), { token }).then((result) => ({ ...result, data: parseSkillProcess(result.data) }));
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
  }).then((result) => ({ ...result, data: parseSkillProcess(result.data) }));
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
  }).then((result) => ({ ...result, data: parseSkillProcess(result.data) }));
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

function protocolError(path: string): never {
  throw new SkillProcessProtocolError(`过程响应与固定联合类型不匹配：${path}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSkillProcess(value: unknown): SkillProcess {
  assertNumericUses(value, 'process', (path) => { throw new Error(`数值取值响应不合法：${path}`); });
  if (!isRecord(value)) protocolError('process');
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
