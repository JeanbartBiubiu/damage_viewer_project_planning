import type { ApiResult } from './apiClient';
import { ApiRequestError, encodePathSegment, requestJson } from './apiClient';
import { validateFormulaDefinition } from './formulaContract';
import type { Binding } from '../types/formulaContract.generated';
import type {
  CreateDamageTypeRequest,
  DamageType,
  DamageTypeListQuery,
  DamageTypeListResponse,
  DamageTypeStatus,
  UpdateDamageTypeRequest
} from '../types/damageType';
import type {
  DamageTypeFormula,
  DamageTypeFormulaDetail
} from '../types/damageTypeFormula';
import { isDamageTypeFormulaAttributeBinding } from '../types/damageTypeFormula';

const STATUSES = new Set<DamageTypeStatus>(['ENABLED', 'DISABLED']);

const DETAIL_KEYS = ['gameId', 'damageTypeKey', 'formula', 'updatedAt'] as const;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function damageTypesPath(gameId: string, damageTypeKey?: string): string {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/damage-types`;
  return damageTypeKey === undefined ? base : `${base}/${encodePathSegment(damageTypeKey)}`;
}

function damageTypeFormulaPath(gameId: string, damageTypeKey: string): string {
  return `${damageTypesPath(gameId, damageTypeKey)}/formula`;
}

function withQuery(path: string, query: DamageTypeListQuery = {}): string {
  const params = new URLSearchParams();
  const keyword = query.keyword?.trim();
  if (keyword) params.set('keyword', keyword);
  if (query.status) params.set('status', query.status);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function parseDamageType(value: unknown): DamageType {
  if (!isRecord(value)) throw new Error('伤害类型响应不完整。');
  const status = value.status;
  const description = value.description;
  const baseReady = typeof value.gameId === 'string'
    && value.gameId.length > 0
    && typeof value.damageTypeKey === 'string'
    && value.damageTypeKey.length > 0
    && typeof value.name === 'string'
    && (description === null || typeof description === 'string')
    && STATUSES.has(status as DamageTypeStatus)
    && typeof value.sortOrder === 'number'
    && Number.isInteger(value.sortOrder)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
  if (!baseReady) throw new Error('伤害类型响应不完整。');
  if (typeof value.formulaConfigured !== 'boolean') {
    throw new Error('伤害类型响应缺少 formulaConfigured。');
  }
  return {
    gameId: value.gameId as string,
    damageTypeKey: value.damageTypeKey as string,
    name: value.name as string,
    description,
    status: status as DamageTypeStatus,
    sortOrder: value.sortOrder as number,
    formulaConfigured: value.formulaConfigured,
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string
  };
}

function parseDamageTypeResult(result: ApiResult<unknown>): ApiResult<DamageType> {
  return { ...result, data: parseDamageType(result.data) };
}

function parseDamageTypeList(result: ApiResult<unknown>): ApiResult<DamageTypeListResponse> {
  if (!isRecord(result.data) || !Array.isArray(result.data.items) || typeof result.data.total !== 'number') {
    throw new Error('伤害类型目录响应不完整。');
  }
  return {
    ...result,
    data: {
      items: result.data.items.map(parseDamageType),
      total: result.data.total
    }
  };
}

/** 此处只校验保存结构、局部引用和使用点形状，不把作者声明当成目录授权。 */
export function parseDamageTypeFormulaDefinition(value: unknown, allowedBindings?: readonly Binding[]): DamageTypeFormula {
  const declaredBindings = isRecord(value) && Array.isArray(value.inputs)
    ? value.inputs.flatMap(input => isRecord(input) && isRecord(input.binding) ? [input.binding as Binding] : []) : [];
  const problem = validateFormulaDefinition(value, allowedBindings ?? declaredBindings.filter(isDamageTypeFormulaAttributeBinding));
  if (problem) throw new Error(`伤害类型公式不合法：${problem.code} ${problem.path || '/'}`);
  const formula = value as DamageTypeFormula;
  for (const [index, input] of formula.inputs.entries()) {
    if (!isDamageTypeFormulaAttributeBinding(input.binding)) {
      throw new Error(`伤害类型公式输入未授权：FORMULA_UNKNOWN_BINDING /inputs/${index}/binding`);
    }
  }
  return structuredClone(formula);
}
export function parseDamageTypeFormulaDetail(
  value: unknown,
  expected: { gameId: string; damageTypeKey: string }
): DamageTypeFormulaDetail {
  if (!isRecord(value) || !hasExactKeys(value, DETAIL_KEYS)) {
    throw new Error('伤害类型公式响应不完整。');
  }
  if (value.gameId !== expected.gameId || value.damageTypeKey !== expected.damageTypeKey) {
    throw new Error('伤害类型公式响应与当前对象不一致。');
  }
  if (typeof value.updatedAt !== 'string' || value.updatedAt.length === 0 || !isRecord(value.formula)) {
    throw new Error('伤害类型公式响应不完整。');
  }
  const formula = parseDamageTypeFormulaDefinition(value.formula);
  return {
    gameId: value.gameId,
    damageTypeKey: value.damageTypeKey,
    formula,
    updatedAt: value.updatedAt
  };
}

function parseFormulaResult(
  result: ApiResult<unknown>,
  expected: { gameId: string; damageTypeKey: string }
): ApiResult<DamageTypeFormulaDetail> {
  return { ...result, data: parseDamageTypeFormulaDetail(result.data, expected) };
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

export function listDamageTypes(
  apiBaseUrl: string,
  gameId: string,
  query: DamageTypeListQuery = {}
): Promise<ApiResult<DamageTypeListResponse>> {
  return requestJson<unknown>(apiBaseUrl, withQuery(damageTypesPath(gameId), query))
    .then(parseDamageTypeList);
}

export function getDamageType(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string
): Promise<ApiResult<DamageType>> {
  return requestJson<unknown>(apiBaseUrl, damageTypesPath(gameId, damageTypeKey))
    .then(parseDamageTypeResult);
}

export function createDamageType(
  apiBaseUrl: string,
  gameId: string,
  body: CreateDamageTypeRequest
): Promise<ApiResult<DamageType>> {
  return requestJson<unknown>(apiBaseUrl, damageTypesPath(gameId), {
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
  return requestJson<unknown>(apiBaseUrl, damageTypesPath(gameId, damageTypeKey), {
    method: 'PUT',
    body: JSON.stringify(updatePayload(body))
  }).then(parseDamageTypeResult);
}

export function deleteDamageType(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, damageTypesPath(gameId, damageTypeKey), {
    method: 'DELETE'
  });
}

export function getDamageTypeFormula(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string
): Promise<ApiResult<DamageTypeFormulaDetail>> {
  return requestJson<unknown>(apiBaseUrl, damageTypeFormulaPath(gameId, damageTypeKey))
    .then((result) => parseFormulaResult(result, { gameId, damageTypeKey }));
}

export function updateDamageTypeFormula(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string,
  body: { formula: DamageTypeFormula }
): Promise<ApiResult<DamageTypeFormulaDetail>> {
  const formula = parseDamageTypeFormulaDefinition(body.formula);
  return requestJson<unknown>(apiBaseUrl, damageTypeFormulaPath(gameId, damageTypeKey), {
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
  return requestJson<null>(apiBaseUrl, damageTypeFormulaPath(gameId, damageTypeKey), {
    method: 'DELETE'
  }).catch((error: unknown) => unconfirmedFormulaWrite(error, '伤害类型公式删除结果无法确认。'));
}
