import { ApiRequestError, encodePathSegment, requestJson } from './apiClient';
import type { ApiRequestOptions, ApiResult } from './apiClient';
import type {
  CharacterSkillRelation,
  CharacterSkillRelationQuery,
  CreateCharacterSkillRelationRequest,
  CreateEquipmentSkillRelationRequest,
  EquipmentSkillRelation,
  EquipmentSkillRelationQuery,
  BuildOptionSkillRelation,
  BuildOptionSkillRelationQuery,
  CreateBuildOptionSkillRelationRequest,
  UpdateBuildOptionSkillRelationRequest,
  SkillRelationList,
  UpdateSkillRelationRequest
} from '../types/skillRelation';
import { BUILD_SKILL_LEVEL_MODES, type BuildSkillLevelMode } from '../types/build';

function protocolError(): never {
  throw new ApiRequestError('技能挂载响应不符合接口约定，请刷新后重试。', 502, 'INVALID_RESPONSE');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return protocolError();
  return value as Record<string, unknown>;
}

function exactRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const item = record(value);
  if (Object.keys(item).some(field => !fields.includes(field))) return protocolError();
  return item;
}

function textField(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return protocolError();
  return value;
}

function normalizeRelation(value: unknown, gameId: string, kind: 'character'): CharacterSkillRelation;
function normalizeRelation(value: unknown, gameId: string, kind: 'equipment'): EquipmentSkillRelation;
function normalizeRelation(value: unknown, gameId: string, kind: 'character' | 'equipment') {
  const item = record(value);
  if (item.gameId !== gameId || (item.skillStatus !== 'ENABLED' && item.skillStatus !== 'DISABLED')) {
    return protocolError();
  }
  if (typeof item.sortOrder !== 'number' || !Number.isInteger(item.sortOrder)
    || item.sortOrder < 0 || item.sortOrder > 2147483647) return protocolError();
  const common: Pick<CharacterSkillRelation, 'gameId' | 'skillKey' | 'skillName' | 'skillStatus' | 'sortOrder'> = {
    gameId,
    skillKey: textField(item.skillKey),
    skillName: textField(item.skillName),
    skillStatus: item.skillStatus,
    sortOrder: item.sortOrder
  };
  return kind === 'character'
    ? { ...common, characterKey: textField(item.characterKey), characterName: textField(item.characterName) }
    : { ...common, equipmentKey: textField(item.equipmentKey), equipmentName: textField(item.equipmentName) };
}

function relationOwnerKey(item: CharacterSkillRelation | EquipmentSkillRelation): string {
  return 'characterKey' in item ? item.characterKey : item.equipmentKey;
}

function path(gameId: string, kind: 'character' | 'equipment', ownerKey?: string, skillKey?: string) {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/${kind}-skill-relations`;
  return ownerKey === undefined || skillKey === undefined
    ? base : `${base}/${encodePathSegment(ownerKey)}/${encodePathSegment(skillKey)}`;
}

function queryPath(base: string, query: CharacterSkillRelationQuery | EquipmentSkillRelationQuery | BuildOptionSkillRelationQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value);
  }
  if (params.size === 0) throw new Error('查询技能挂载时至少需要选择一个对象。');
  return `${base}?${params.toString()}`;
}

function normalizeList<T extends CharacterSkillRelation | EquipmentSkillRelation>(
  value: unknown,
  normalize: (item: unknown) => T,
  query: CharacterSkillRelationQuery | EquipmentSkillRelationQuery
): SkillRelationList<T> {
  const data = record(value);
  if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total !== data.items.length) {
    return protocolError();
  }
  const items = data.items.map(normalize);
  const identities = new Set<string>();
  for (const item of items) {
    for (const [key, expected] of Object.entries(query)) {
      if (expected !== undefined && (item as unknown as Record<string, unknown>)[key] !== expected) {
        return protocolError();
      }
    }
    const ownerKey = relationOwnerKey(item);
    const identity = JSON.stringify([ownerKey, item.skillKey]);
    if (identities.has(identity)) return protocolError();
    identities.add(identity);
  }
  return { items, total: items.length };
}

async function writeRelation<T extends CharacterSkillRelation | EquipmentSkillRelation>(
  apiBaseUrl: string, requestPath: string, options: ApiRequestOptions,
  normalize: (value: unknown) => T, ownerKey: string, skillKey: string
): Promise<ApiResult<T>> {
  const result = await requestJson<unknown>(apiBaseUrl, requestPath, options);
  const data = normalize(result.data);
  if (data.skillKey !== skillKey
    || relationOwnerKey(data) !== ownerKey) return protocolError();
  return { ...result, data };
}

export async function listCharacterSkillRelations(
  apiBaseUrl: string, gameId: string, token: string, query: CharacterSkillRelationQuery
): Promise<ApiResult<SkillRelationList<CharacterSkillRelation>>> {
  const result = await requestJson<unknown>(apiBaseUrl, queryPath(path(gameId, 'character'), query), { token });
  return { ...result, data: normalizeList(result.data, value => normalizeRelation(value, gameId, 'character'), query) };
}

export async function listEquipmentSkillRelations(
  apiBaseUrl: string, gameId: string, token: string, query: EquipmentSkillRelationQuery
): Promise<ApiResult<SkillRelationList<EquipmentSkillRelation>>> {
  const result = await requestJson<unknown>(apiBaseUrl, queryPath(path(gameId, 'equipment'), query), { token });
  return { ...result, data: normalizeList(result.data, value => normalizeRelation(value, gameId, 'equipment'), query) };
}

export function createCharacterSkillRelation(
  apiBaseUrl: string, gameId: string, token: string, body: CreateCharacterSkillRelationRequest
): Promise<ApiResult<CharacterSkillRelation>> {
  return writeRelation(apiBaseUrl, path(gameId, 'character'), { method: 'POST', token, body: JSON.stringify(body) },
    value => normalizeRelation(value, gameId, 'character'), body.characterKey, body.skillKey);
}

export function createEquipmentSkillRelation(
  apiBaseUrl: string, gameId: string, token: string, body: CreateEquipmentSkillRelationRequest
): Promise<ApiResult<EquipmentSkillRelation>> {
  return writeRelation(apiBaseUrl, path(gameId, 'equipment'), { method: 'POST', token, body: JSON.stringify(body) },
    value => normalizeRelation(value, gameId, 'equipment'), body.equipmentKey, body.skillKey);
}

export function updateCharacterSkillRelation(
  apiBaseUrl: string, gameId: string, characterKey: string, skillKey: string,
  token: string, body: UpdateSkillRelationRequest
): Promise<ApiResult<CharacterSkillRelation>> {
  return writeRelation(apiBaseUrl, path(gameId, 'character', characterKey, skillKey),
    { method: 'PUT', token, body: JSON.stringify({ sortOrder: body.sortOrder }) },
    value => normalizeRelation(value, gameId, 'character'), characterKey, skillKey);
}

export function updateEquipmentSkillRelation(
  apiBaseUrl: string, gameId: string, equipmentKey: string, skillKey: string,
  token: string, body: UpdateSkillRelationRequest
): Promise<ApiResult<EquipmentSkillRelation>> {
  return writeRelation(apiBaseUrl, path(gameId, 'equipment', equipmentKey, skillKey),
    { method: 'PUT', token, body: JSON.stringify({ sortOrder: body.sortOrder }) },
    value => normalizeRelation(value, gameId, 'equipment'), equipmentKey, skillKey);
}

async function deleteRelation(apiBaseUrl: string, requestPath: string, token: string): Promise<ApiResult<null>> {
  const result = await requestJson<unknown>(apiBaseUrl, requestPath, { method: 'DELETE', token });
  if (result.status !== 204 || result.data !== null) return protocolError();
  return { ...result, data: null };
}

export function deleteCharacterSkillRelation(
  apiBaseUrl: string, gameId: string, characterKey: string, skillKey: string, token: string
): Promise<ApiResult<null>> {
  return deleteRelation(apiBaseUrl, path(gameId, 'character', characterKey, skillKey), token);
}

export function deleteEquipmentSkillRelation(
  apiBaseUrl: string, gameId: string, equipmentKey: string, skillKey: string, token: string
): Promise<ApiResult<null>> {
  return deleteRelation(apiBaseUrl, path(gameId, 'equipment', equipmentKey, skillKey), token);
}

function grantInteger(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > 2147483647) return protocolError();
  return value;
}

export function parseBuildOptionSkillRelation(
  value: unknown, gameId: string, expected?: { systemKey?: string; optionKey?: string; skillKey?: string }
): BuildOptionSkillRelation {
  const item = exactRecord(value, [
    'gameId', 'systemKey', 'optionKey', 'optionName', 'skillKey', 'skillName', 'skillStatus',
    'activationRank', 'skillLevelMode', 'fixedSkillLevel', 'sortOrder'
  ]);
  if (item.gameId !== gameId || (item.skillStatus !== 'ENABLED' && item.skillStatus !== 'DISABLED')) return protocolError();
  if (!BUILD_SKILL_LEVEL_MODES.includes(item.skillLevelMode as BuildSkillLevelMode)) return protocolError();
  const skillLevelMode = item.skillLevelMode as BuildSkillLevelMode;
  const fixedSkillLevel = item.fixedSkillLevel === null ? null : grantInteger(item.fixedSkillLevel, 1);
  if (skillLevelMode === 'FIXED' && fixedSkillLevel === null) return protocolError();
  if (skillLevelMode === 'SAME_AS_OPTION' && fixedSkillLevel !== null) return protocolError();
  const relation: BuildOptionSkillRelation = {
    gameId,
    systemKey: textField(item.systemKey),
    optionKey: textField(item.optionKey),
    optionName: textField(item.optionName),
    skillKey: textField(item.skillKey),
    skillName: textField(item.skillName),
    skillStatus: item.skillStatus,
    activationRank: grantInteger(item.activationRank, 1),
    skillLevelMode,
    fixedSkillLevel,
    sortOrder: grantInteger(item.sortOrder, 0)
  };
  if ((expected?.systemKey !== undefined && relation.systemKey !== expected.systemKey)
    || (expected?.optionKey !== undefined && relation.optionKey !== expected.optionKey)
    || (expected?.skillKey !== undefined && relation.skillKey !== expected.skillKey)) return protocolError();
  return relation;
}

function buildRelationPath(gameId: string, systemKey?: string, optionKey?: string, skillKey?: string): string {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/build-option-skill-relations`;
  if (systemKey === undefined || optionKey === undefined || skillKey === undefined) return base;
  return `${base}/${encodePathSegment(systemKey)}/${encodePathSegment(optionKey)}/${encodePathSegment(skillKey)}`;
}

function assertBuildQuery(query: BuildOptionSkillRelationQuery): void {
  const hasSkill = query.skillKey !== undefined;
  const hasSystem = query.systemKey !== undefined;
  const hasOption = query.optionKey !== undefined;
  if ((hasSystem || hasOption) && !(hasSystem && hasOption)) {
    throw new Error('查询技能授予时必须同时提供构筑系统与可选项。');
  }
  if (!hasSkill && !(hasSystem && hasOption)) {
    throw new Error('查询技能授予时需要技能标识，或同时提供构筑系统与可选项。');
  }
}

export async function listBuildOptionSkillRelations(
  apiBaseUrl: string, gameId: string, token: string, query: BuildOptionSkillRelationQuery
): Promise<ApiResult<SkillRelationList<BuildOptionSkillRelation>>> {
  assertBuildQuery(query);
  const result = await requestJson<unknown>(apiBaseUrl, queryPath(buildRelationPath(gameId), query), { token });
  const data = exactRecord(result.data, ['items', 'total']);
  if (!Array.isArray(data.items) || data.total !== data.items.length) return protocolError();
  const items = data.items.map(item => parseBuildOptionSkillRelation(item, gameId, query));
  const identities = new Set<string>();
  for (const item of items) {
    const identity = JSON.stringify([item.systemKey, item.optionKey, item.skillKey]);
    if (identities.has(identity)) return protocolError();
    identities.add(identity);
  }
  return { ...result, data: { items, total: items.length } };
}

async function writeBuildRelation(
  apiBaseUrl: string, requestPath: string, options: ApiRequestOptions,
  expected: { systemKey: string; optionKey: string; skillKey: string }, gameId: string
): Promise<ApiResult<BuildOptionSkillRelation>> {
  const result = await requestJson<unknown>(apiBaseUrl, requestPath, options);
  const data = parseBuildOptionSkillRelation(result.data, gameId, expected);
  return { ...result, data };
}

export function createBuildOptionSkillRelation(
  apiBaseUrl: string, gameId: string, token: string, body: CreateBuildOptionSkillRelationRequest
): Promise<ApiResult<BuildOptionSkillRelation>> {
  return writeBuildRelation(apiBaseUrl, buildRelationPath(gameId), { method: 'POST', token, body: JSON.stringify(body) }, body, gameId);
}

export function updateBuildOptionSkillRelation(
  apiBaseUrl: string, gameId: string, systemKey: string, optionKey: string, skillKey: string,
  token: string, body: UpdateBuildOptionSkillRelationRequest
): Promise<ApiResult<BuildOptionSkillRelation>> {
  return writeBuildRelation(
    apiBaseUrl, buildRelationPath(gameId, systemKey, optionKey, skillKey),
    { method: 'PUT', token, body: JSON.stringify(body) },
    { systemKey, optionKey, skillKey }, gameId
  );
}

export function deleteBuildOptionSkillRelation(
  apiBaseUrl: string, gameId: string, systemKey: string, optionKey: string, skillKey: string, token: string
): Promise<ApiResult<null>> {
  return deleteRelation(apiBaseUrl, buildRelationPath(gameId, systemKey, optionKey, skillKey), token);
}
