import type { ApiResult } from '../apiClient';
import { ApiRequestError } from '../apiClient';
import type { CreateDamageTypeRequest, DamageType, UpdateDamageTypeRequest } from '../../types/damageType';
import type { DamageTypeFormula, DamageTypeFormulaDetail } from '../../types/damageTypeFormula';
import { damageTypeFormulaPath, damageTypesPath, parseDamageTypeFormulaDefinition, parseDamageTypeResult, parseFormulaResult } from '../damageTypeClient';
import { requestMaintenanceJson } from '../maintenanceApiRequest';

export class UnconfirmedDamageTypeFormulaWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnconfirmedDamageTypeFormulaWriteError';
  }
}

function unconfirmedFormulaWrite(error: unknown, fallback: string): never {
  if (error instanceof UnconfirmedDamageTypeFormulaWriteError) throw error;
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) throw error;
  throw new UnconfirmedDamageTypeFormulaWriteError(
    error instanceof Error && error.message.trim() ? error.message : fallback
  );
}

function createPayload(body: CreateDamageTypeRequest): CreateDamageTypeRequest {
  return {
    damageTypeKey: body.damageTypeKey,
    name: body.name,
    description: body.description,
    status: body.status,
    sortOrder: body.sortOrder
  };
}

function updatePayload(body: UpdateDamageTypeRequest): UpdateDamageTypeRequest {
  return {
    name: body.name,
    description: body.description,
    status: body.status,
    sortOrder: body.sortOrder
  };
}

export function createDamageType(
  apiBaseUrl: string,
  gameId: string,
  body: CreateDamageTypeRequest
): Promise<ApiResult<DamageType>> {
  return requestMaintenanceJson<unknown>(apiBaseUrl, damageTypesPath(gameId), {
    method: 'POST',
    body: JSON.stringify(createPayload(body))
  }).then(parseDamageTypeResult);
}

export function updateDamageType(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string,
  body: UpdateDamageTypeRequest
): Promise<ApiResult<DamageType>> {
  return requestMaintenanceJson<unknown>(apiBaseUrl, damageTypesPath(gameId, damageTypeKey), {
    method: 'PUT',
    body: JSON.stringify(updatePayload(body))
  }).then(parseDamageTypeResult);
}

export function deleteDamageType(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string
): Promise<ApiResult<null>> {
  return requestMaintenanceJson<null>(apiBaseUrl, damageTypesPath(gameId, damageTypeKey), {
    method: 'DELETE'
  });
}

export function updateDamageTypeFormula(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string,
  body: { formula: DamageTypeFormula }
): Promise<ApiResult<DamageTypeFormulaDetail>> {
  const formula = parseDamageTypeFormulaDefinition(body.formula);
  return requestMaintenanceJson<unknown>(apiBaseUrl, damageTypeFormulaPath(gameId, damageTypeKey), {
    method: 'PUT',
    body: JSON.stringify({ formula })
  }).then((result) => {
    try {
      return parseFormulaResult(result, { gameId, damageTypeKey });
    } catch (error) {
      throw new UnconfirmedDamageTypeFormulaWriteError(
        error instanceof Error ? error.message : '伤害类型公式写入响应无法解析。'
      );
    }
  }).catch((error: unknown) => unconfirmedFormulaWrite(error, '伤害类型公式写入结果无法确认。'));
}

export function deleteDamageTypeFormula(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string
): Promise<ApiResult<null>> {
  return requestMaintenanceJson<null>(apiBaseUrl, damageTypeFormulaPath(gameId, damageTypeKey), {
    method: 'DELETE'
  }).catch((error: unknown) => unconfirmedFormulaWrite(error, '伤害类型公式删除结果无法确认。'));
}
