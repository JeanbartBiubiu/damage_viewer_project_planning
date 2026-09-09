import { ApiRequestError, encodePathSegment, requestJson, type ApiResult } from './apiClient';
import { RUNE_CATEGORIES, type Rune, type RuneCategory, type RunePath, type RuneSlot, type RuneListResponse, type RunePathListResponse, type CreateRuneRequest, type UpdateRuneRequest, type CreateRunePathRequest, type UpdateRunePathRequest } from '../types/rune';

function invalid(): never { throw new ApiRequestError('符文响应不符合接口约定，请重新读取。', 502, 'INVALID_RESPONSE'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim()) invalid(); return value; }
function category(value: unknown): RuneCategory { if (!RUNE_CATEGORIES.includes(value as RuneCategory)) invalid(); return value as RuneCategory; }
function common(row: Record<string, unknown>, gameId: string) {
  if (row.gameId !== gameId || (row.description !== null && typeof row.description !== 'string')) invalid();
  return { gameId, name: text(row.name), description: row.description as string | null, createdAt: text(row.createdAt), updatedAt: text(row.updatedAt) };
}
function rune(value: unknown, gameId: string): Rune {
  const row = record(value);
  return { ...common(row, gameId), runeKey: text(row.runeKey), category: category(row.category) };
}
function runePath(value: unknown, gameId: string): RunePath {
  const row = record(value);
  if ((row.kind !== 'RUNE_PATH' && row.kind !== 'SHARD_GROUP') || !Number.isInteger(row.sortOrder) || (row.sortOrder as number) < 0 || !Array.isArray(row.slots)) invalid();
  const slots: RuneSlot[] = row.slots.map(raw => {
    const slot = record(raw);
    if (!Array.isArray(slot.runeKeys)) invalid();
    const runeKeys = slot.runeKeys.map(text);
    if (new Set(runeKeys).size !== runeKeys.length) invalid();
    const slotCategory = category(slot.category);
    if ((row.kind === 'SHARD_GROUP') !== (slotCategory === 'SHARD')) invalid();
    return { name: text(slot.name), category: slotCategory, runeKeys };
  });
  return { ...common(row, gameId), pathKey: text(row.pathKey), kind: row.kind, sortOrder: row.sortOrder as number, slots };
}
function path(gameId: string, kind: 'runes' | 'rune-paths', key?: string) {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/${kind}`;
  return key === undefined ? base : `${base}/${encodePathSegment(key)}`;
}
function queryPath(base: string, query: { keyword?: string; category?: RuneCategory }) {
  const params = new URLSearchParams();
  if (query.keyword?.trim()) params.set('keyword', query.keyword.trim());
  if (query.category) params.set('category', query.category);
  return params.size ? `${base}?${params}` : base;
}
async function list<T>(request: Promise<ApiResult<unknown>>, parse: (value: unknown) => T, identity: (value: T) => string): Promise<ApiResult<{ items: T[]; total: number }>> {
  const result = await request;
  const row = record(result.data);
  if (!Array.isArray(row.items) || row.total !== row.items.length) invalid();
  const items = row.items.map(parse);
  if (new Set(items.map(identity)).size !== items.length) invalid();
  return { ...result, data: { items, total: items.length } };
}
async function one<T>(request: Promise<ApiResult<unknown>>, parse: (value: unknown) => T, identity: (value: T) => string, key: string): Promise<ApiResult<T>> {
  const result = await request;
  const data = parse(result.data);
  if (identity(data) !== key) invalid();
  return { ...result, data };
}
export function listRunes(apiBaseUrl: string, gameId: string, token: string, query: { keyword?: string; category?: RuneCategory } = {}): Promise<ApiResult<RuneListResponse>> {
  return list(requestJson(apiBaseUrl, queryPath(path(gameId, 'runes'), query), { token }), value => rune(value, gameId), value => value.runeKey);
}
export function getRune(apiBaseUrl: string, gameId: string, key: string, token: string) {
  return one(requestJson(apiBaseUrl, path(gameId, 'runes', key), { token }), value => rune(value, gameId), value => value.runeKey, key);
}
export function createRune(apiBaseUrl: string, gameId: string, token: string, body: CreateRuneRequest) {
  return one(requestJson(apiBaseUrl, path(gameId, 'runes'), { method: 'POST', token, body: JSON.stringify(body) }), value => rune(value, gameId), value => value.runeKey, body.runeKey);
}
export function updateRune(apiBaseUrl: string, gameId: string, key: string, token: string, body: UpdateRuneRequest) {
  return one(requestJson(apiBaseUrl, path(gameId, 'runes', key), { method: 'PUT', token, body: JSON.stringify(body) }), value => rune(value, gameId), value => value.runeKey, key);
}
export function deleteRune(apiBaseUrl: string, gameId: string, key: string, token: string) {
  return requestJson<null>(apiBaseUrl, path(gameId, 'runes', key), { method: 'DELETE', token });
}
export function listRunePaths(apiBaseUrl: string, gameId: string, token: string, query: { keyword?: string } = {}): Promise<ApiResult<RunePathListResponse>> {
  return list(requestJson(apiBaseUrl, queryPath(path(gameId, 'rune-paths'), query), { token }), value => runePath(value, gameId), value => value.pathKey);
}
export function getRunePath(apiBaseUrl: string, gameId: string, key: string, token: string) {
  return one(requestJson(apiBaseUrl, path(gameId, 'rune-paths', key), { token }), value => runePath(value, gameId), value => value.pathKey, key);
}
export function createRunePath(apiBaseUrl: string, gameId: string, token: string, body: CreateRunePathRequest) {
  return one(requestJson(apiBaseUrl, path(gameId, 'rune-paths'), { method: 'POST', token, body: JSON.stringify(body) }), value => runePath(value, gameId), value => value.pathKey, body.pathKey);
}
export function updateRunePath(apiBaseUrl: string, gameId: string, key: string, token: string, body: UpdateRunePathRequest) {
  return one(requestJson(apiBaseUrl, path(gameId, 'rune-paths', key), { method: 'PUT', token, body: JSON.stringify(body) }), value => runePath(value, gameId), value => value.pathKey, key);
}
export function deleteRunePath(apiBaseUrl: string, gameId: string, key: string, token: string) {
  return requestJson<null>(apiBaseUrl, path(gameId, 'rune-paths', key), { method: 'DELETE', token });
}
