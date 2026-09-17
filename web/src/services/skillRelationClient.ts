import { ApiRequestError, encodePathSegment, requestJson } from './apiClient';
import type { ApiRequestOptions, ApiResult } from './apiClient';
import type {
  CharacterSkillRelation,
  CharacterSkillRelationQuery,
  CreateCharacterSkillRelationRequest,
  CreateEquipmentSkillRelationRequest,
  EquipmentSkillRelation,
  EquipmentSkillRelationQuery,
  RuneSkillRelation,
  RuneSkillRelationQuery,
  CreateRuneSkillRelationRequest,
  AnySkillRelation,
  SkillRelationList,
  SkillRelationOwnerKind,
  UpdateSkillRelationRequest
} from '../types/skillRelation';

function protocolError(): never {
  throw new ApiRequestError('技能挂载响应不符合接口约定，请刷新后重试。', 502, 'INVALID_RESPONSE');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return protocolError();
  return value as Record<string, unknown>;
}

function textField(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return protocolError();
  return value;
}

function normalizeRelation(value: unknown, gameId: string, kind: 'character'): CharacterSkillRelation;
function normalizeRelation(value: unknown, gameId: string, kind: 'equipment'): EquipmentSkillRelation;
function normalizeRelation(value: unknown, gameId: string, kind: 'rune'): RuneSkillRelation;
function normalizeRelation(value: unknown, gameId: string, kind: SkillRelationOwnerKind) {
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
    : kind === 'rune' ? { ...common, runeKey: textField(item.runeKey), runeName: textField(item.runeName) }
    : { ...common, equipmentKey: textField(item.equipmentKey), equipmentName: textField(item.equipmentName) };
}

function relationOwnerKey(item: AnySkillRelation): string {
  return 'characterKey' in item ? item.characterKey : 'equipmentKey' in item ? item.equipmentKey : item.runeKey;
}

function path(gameId: string, kind: SkillRelationOwnerKind, ownerKey?: string, skillKey?: string) {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/${kind}-skill-relations`;
  return ownerKey === undefined || skillKey === undefined
    ? base : `${base}/${encodePathSegment(ownerKey)}/${encodePathSegment(skillKey)}`;
}

function queryPath(base: string, query: CharacterSkillRelationQuery | EquipmentSkillRelationQuery | RuneSkillRelationQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value);
  }
  if (params.size === 0) throw new Error('查询技能挂载时至少需要选择一个对象。');
  return `${base}?${params.toString()}`;
}

function normalizeList<T extends AnySkillRelation>(
  value: unknown,
  normalize: (item: unknown) => T,
  query: CharacterSkillRelationQuery | EquipmentSkillRelationQuery | RuneSkillRelationQuery
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

async function writeRelation<T extends AnySkillRelation>(
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

export async function listRuneSkillRelations(apiBaseUrl: string, gameId: string, token: string, query: RuneSkillRelationQuery): Promise<ApiResult<SkillRelationList<RuneSkillRelation>>> {
  const result = await requestJson<unknown>(apiBaseUrl, queryPath(path(gameId, 'rune'), query), { token });
  return { ...result, data: normalizeList(result.data, value => normalizeRelation(value, gameId, 'rune'), query) };
}
export function createRuneSkillRelation(apiBaseUrl: string, gameId: string, token: string, body: CreateRuneSkillRelationRequest): Promise<ApiResult<RuneSkillRelation>> {
  return writeRelation(apiBaseUrl, path(gameId, 'rune'), { method: 'POST', token, body: JSON.stringify(body) }, value => normalizeRelation(value, gameId, 'rune'), body.runeKey, body.skillKey);
}
export function updateRuneSkillRelation(apiBaseUrl: string, gameId: string, runeKey: string, skillKey: string, token: string, body: UpdateSkillRelationRequest): Promise<ApiResult<RuneSkillRelation>> {
  return writeRelation(apiBaseUrl, path(gameId, 'rune', runeKey, skillKey), { method: 'PUT', token, body: JSON.stringify({ sortOrder: body.sortOrder }) }, value => normalizeRelation(value, gameId, 'rune'), runeKey, skillKey);
}
export function deleteRuneSkillRelation(apiBaseUrl: string, gameId: string, runeKey: string, skillKey: string, token: string): Promise<ApiResult<null>> {
  return deleteRelation(apiBaseUrl, path(gameId, 'rune', runeKey, skillKey), token);
}
