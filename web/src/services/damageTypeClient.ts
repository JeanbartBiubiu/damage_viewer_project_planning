import type { ApiResult } from './apiClient';
import { ApiRequestError, encodePathSegment, requestJson } from './apiClient';
import type {
  FormulaAttributeOwner,
  FormulaAttributeValueKind,
  FormulaOperation
} from '../types/skillFormula';
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
  DamageTypeFormulaDetail,
  DamageTypeFormulaNode,
  DamageTypeFormulaStageKey
} from '../types/damageTypeFormula';
import {
  DAMAGE_TYPE_FORMULA_MAX_DEPTH,
  DAMAGE_TYPE_FORMULA_MAX_NODES,
  DAMAGE_TYPE_FORMULA_STAGE_KEYS,
  isDamageTypeFormulaStageResultKey,
  priorDamageTypeFormulaStageResults
} from '../types/damageTypeFormula';

const OPERATIONS = new Set<FormulaOperation>(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
const ATTRIBUTE_OWNERS = new Set<FormulaAttributeOwner>(['SOURCE', 'TARGET']);
const ATTRIBUTE_VALUE_KINDS = new Set<FormulaAttributeValueKind>([
  'BASE',
  'BONUS',
  'TOTAL',
  'CURRENT',
  'MISSING',
  'CURRENT_RATIO',
  'MISSING_RATIO'
]);
const STATUSES = new Set<DamageTypeStatus>(['ENABLED', 'DISABLED']);

const DETAIL_KEYS = ['gameId', 'damageTypeKey', 'formula', 'updatedAt'] as const;
const OPERATION_KEYS = ['nodeType', 'operation', 'operands'] as const;
const FIXED_KEYS = ['nodeType', 'value'] as const;
const ATTRIBUTE_KEYS = ['nodeType', 'attributeOwner', 'attributeKey', 'attributeValueKind'] as const;
const STAGE_RESULT_KEYS = ['nodeType', 'stageKey'] as const;

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

function rejectFormula(path: string, message = '伤害类型公式响应不完整。'): never {
  throw new Error(path ? `${message}：${path}` : message);
}

function parseFormulaNode(
  value: unknown,
  stage: DamageTypeFormulaStageKey,
  path: string,
  depth: number,
  counter: { count: number }
): DamageTypeFormulaNode {
  counter.count += 1;
  if (depth > DAMAGE_TYPE_FORMULA_MAX_DEPTH) {
    rejectFormula(path, `公式深度不能超过 ${DAMAGE_TYPE_FORMULA_MAX_DEPTH}。`);
  }
  if (counter.count > DAMAGE_TYPE_FORMULA_MAX_NODES) {
    rejectFormula(path, `公式节点总数不能超过 ${DAMAGE_TYPE_FORMULA_MAX_NODES}。`);
  }
  if (!isRecord(value)) rejectFormula(path);
  if (value.nodeType === 'PARAMETER') {
    rejectFormula(path, '伤害类型公式不允许 PARAMETER。');
  }

  if (value.nodeType === 'OPERATION' && hasExactKeys(value, OPERATION_KEYS)) {
    if (!OPERATIONS.has(value.operation as FormulaOperation) || !Array.isArray(value.operands) || value.operands.length !== 2) {
      rejectFormula(path);
    }
    return {
      nodeType: 'OPERATION',
      operation: value.operation as FormulaOperation,
      operands: [
        parseFormulaNode(value.operands[0], stage, `${path}.operands[0]`, depth + 1, counter),
        parseFormulaNode(value.operands[1], stage, `${path}.operands[1]`, depth + 1, counter)
      ]
    };
  }

  if (value.nodeType === 'FIXED' && hasExactKeys(value, FIXED_KEYS)) {
    if (typeof value.value !== 'number' || !Number.isFinite(value.value)) rejectFormula(path);
    return { nodeType: 'FIXED', value: value.value };
  }

  if (value.nodeType === 'ATTRIBUTE' && hasExactKeys(value, ATTRIBUTE_KEYS)) {
    if (!ATTRIBUTE_OWNERS.has(value.attributeOwner as FormulaAttributeOwner)
      || typeof value.attributeKey !== 'string'
      || value.attributeKey.trim() === ''
      || !ATTRIBUTE_VALUE_KINDS.has(value.attributeValueKind as FormulaAttributeValueKind)) {
      rejectFormula(path);
    }
    return {
      nodeType: 'ATTRIBUTE',
      attributeOwner: value.attributeOwner as FormulaAttributeOwner,
      attributeKey: value.attributeKey,
      attributeValueKind: value.attributeValueKind as FormulaAttributeValueKind
    };
  }

  if (value.nodeType === 'STAGE_RESULT' && hasExactKeys(value, STAGE_RESULT_KEYS)) {
    if (!isDamageTypeFormulaStageResultKey(value.stageKey)
      || !priorDamageTypeFormulaStageResults(stage).includes(value.stageKey)) {
      rejectFormula(path, '伤害类型公式引用了当前或后续阶段。');
    }
    return { nodeType: 'STAGE_RESULT', stageKey: value.stageKey };
  }

  rejectFormula(path);
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
  if (!hasExactKeys(value.formula, DAMAGE_TYPE_FORMULA_STAGE_KEYS)) {
    throw new Error('伤害类型公式响应不完整。');
  }
  const formula = {} as DamageTypeFormula;
  for (const stage of DAMAGE_TYPE_FORMULA_STAGE_KEYS) {
    formula[stage] = parseFormulaNode(value.formula[stage], stage, `formula.${stage}`, 1, { count: 0 });
  }
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
  token: string,
  query: DamageTypeListQuery = {}
): Promise<ApiResult<DamageTypeListResponse>> {
  return requestJson<unknown>(apiBaseUrl, withQuery(damageTypesPath(gameId), query), { token })
    .then(parseDamageTypeList);
}

export function getDamageType(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string,
  token: string
): Promise<ApiResult<DamageType>> {
  return requestJson<unknown>(apiBaseUrl, damageTypesPath(gameId, damageTypeKey), { token })
    .then(parseDamageTypeResult);
}

export function createDamageType(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: CreateDamageTypeRequest
): Promise<ApiResult<DamageType>> {
  return requestJson<unknown>(apiBaseUrl, damageTypesPath(gameId), {
    method: 'POST',
    token,
    body: JSON.stringify(createPayload(body))
  }).then(parseDamageTypeResult);
}

export function updateDamageType(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string,
  token: string,
  body: UpdateDamageTypeRequest
): Promise<ApiResult<DamageType>> {
  return requestJson<unknown>(apiBaseUrl, damageTypesPath(gameId, damageTypeKey), {
    method: 'PUT',
    token,
    body: JSON.stringify(updatePayload(body))
  }).then(parseDamageTypeResult);
}

export function deleteDamageType(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, damageTypesPath(gameId, damageTypeKey), {
    method: 'DELETE',
    token
  });
}

export function getDamageTypeFormula(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string,
  token: string
): Promise<ApiResult<DamageTypeFormulaDetail>> {
  return requestJson<unknown>(apiBaseUrl, damageTypeFormulaPath(gameId, damageTypeKey), { token })
    .then((result) => parseFormulaResult(result, { gameId, damageTypeKey }));
}

export function updateDamageTypeFormula(
  apiBaseUrl: string,
  gameId: string,
  damageTypeKey: string,
  token: string,
  body: { formula: DamageTypeFormula }
): Promise<ApiResult<DamageTypeFormulaDetail>> {
  return requestJson<unknown>(apiBaseUrl, damageTypeFormulaPath(gameId, damageTypeKey), {
    method: 'PUT',
    token,
    body: JSON.stringify({ formula: body.formula })
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
  damageTypeKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, damageTypeFormulaPath(gameId, damageTypeKey), {
    method: 'DELETE',
    token
  }).catch((error: unknown) => unconfirmedFormulaWrite(error, '伤害类型公式删除结果无法确认。'));
}
