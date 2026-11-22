import { ApiRequestError, encodePathSegment, requestJson, type ApiResult } from './apiClient';
import type { ImageOptionsResponse, ImageRelationTarget, ImageSourceStatus, ImageUsages, RepresentativeImageResponse } from '../types/imageRelation';

function adminGamePath(gameId: string): string {
  return `/api/admin/games/${encodePathSegment(gameId)}`;
}

export function representativeImagePath(gameId: string, target: ImageRelationTarget): string {
  const base = adminGamePath(gameId);
  const key = encodePathSegment(target.key);
  switch (target.kind) {
    case 'game':
      if (target.key !== gameId) throw new ApiRequestError('游戏来源必须是当前游戏。', 400, '400.VALIDATION_FAILED');
      return `${base}/representative-image`;
    case 'character': return `${base}/characters/${key}/representative-image`;
    case 'attribute': return `${base}/attributes/${key}/representative-image`;
    case 'equipment': return `${base}/equipment/${key}/representative-image`;
    case 'buildOption':
      if (!target.systemKey?.trim()) throw new ApiRequestError('构筑可选项缺少所属构筑系统。', 400, '400.VALIDATION_FAILED');
      return `${base}/build-systems/${encodePathSegment(target.systemKey)}/options/${key}/representative-image`;
    case 'buildGroup':
      if (!target.systemKey?.trim()) throw new ApiRequestError('构筑分组缺少所属构筑系统。', 400, '400.VALIDATION_FAILED');
      return `${base}/build-systems/${encodePathSegment(target.systemKey)}/groups/${key}/representative-image`;
    case 'skill': return `${base}/skills/${key}/representative-image`;
    case 'skillEffect':
      if (!target.skillKey?.trim()) throw new ApiRequestError('技能效果缺少所属技能。', 400, '400.VALIDATION_FAILED');
      return `${base}/skills/${encodePathSegment(target.skillKey)}/effects/${key}/representative-image`;
    case 'status': return `${base}/statuses/${key}/representative-image`;
  }
}

export function invalidResponse(): never {
  throw new ApiRequestError('图片关联响应格式不合法，请刷新后重试。', 502, '502.IMAGE_RELATION_RESPONSE_INVALID');
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}

function textField(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || !value.trim()) invalidResponse();
  return value;
}

function statusField(row: Record<string, unknown>, field: string): ImageSourceStatus {
  const value = row[field];
  if (value !== 'ENABLED' && value !== 'DISABLED') invalidResponse();
  return value;
}

export function parseRepresentative(value: unknown): RepresentativeImageResponse {
  const record = recordOf(value);
  if (record.image === null) return { image: null };
  const image = recordOf(record.image);
  if (typeof image.enabled !== 'boolean') invalidResponse();
  return { image: { imageKey: textField(image, 'imageKey'), name: textField(image, 'name'), enabled: image.enabled } };
}

function parseOptions(value: unknown): ImageOptionsResponse {
  const record = recordOf(value);
  if (!Array.isArray(record.items) || record.items.length > 50 || record.total !== record.items.length) invalidResponse();
  const items = record.items.map((raw) => {
    const row = recordOf(raw);
    return { imageKey: textField(row, 'imageKey'), name: textField(row, 'name') };
  });
  if (new Set(items.map((item) => item.imageKey)).size !== items.length) invalidResponse();
  return { items, total: items.length };
}

function parseUsages(value: unknown, gameId: string, imageKey: string): ImageUsages {
  const record = recordOf(value);
  if (textField(record, 'imageKey') !== imageKey) invalidResponse();
  const group = <T>(field: string, parse: (row: Record<string, unknown>) => T): T[] => {
    const rows = record[field];
    if (!Array.isArray(rows)) invalidResponse();
    return rows.map((row) => parse(recordOf(row)));
  };
  const games = group('games', (row) => ({ gameId: textField(row, 'gameId'), gameName: textField(row, 'gameName') }));
  if (games.some((game) => game.gameId !== gameId)) invalidResponse();
  return {
    imageKey,
    games,
    characters: group('characters', (row) => ({ characterKey: textField(row, 'characterKey'), characterName: textField(row, 'characterName') })),
    attributes: group('attributes', (row) => ({ attributeKey: textField(row, 'attributeKey'), attributeName: textField(row, 'attributeName'), attributeStatus: statusField(row, 'attributeStatus') })),
    equipment: group('equipment', (row) => ({ equipmentKey: textField(row, 'equipmentKey'), equipmentName: textField(row, 'equipmentName') })),
    buildOptions: group('buildOptions', (row) => ({ systemKey: textField(row, 'systemKey'), optionKey: textField(row, 'optionKey'), optionName: textField(row, 'optionName') })),
    buildGroups: group('buildGroups', (row) => ({ systemKey: textField(row, 'systemKey'), groupKey: textField(row, 'groupKey'), groupName: textField(row, 'groupName') })),
    skills: group('skills', (row) => ({ skillKey: textField(row, 'skillKey'), skillName: textField(row, 'skillName'), skillStatus: statusField(row, 'skillStatus') })),
    skillEffects: group('skillEffects', (row) => ({ skillKey: textField(row, 'skillKey'), skillName: textField(row, 'skillName'), effectKey: textField(row, 'effectKey'), effectName: textField(row, 'effectName') })),
    statuses: group('statuses', (row) => ({ statusKey: textField(row, 'statusKey'), statusName: textField(row, 'statusName'), statusStatus: statusField(row, 'statusStatus') }))
  };
}

export async function normalized<T>(result: Promise<ApiResult<unknown>>, parse: (value: unknown) => T): Promise<ApiResult<T>> {
  const response = await result;
  return { ...response, data: parse(response.data) };
}

export function getRepresentativeImage(apiBaseUrl: string, gameId: string, target: ImageRelationTarget, signal?: AbortSignal): Promise<ApiResult<RepresentativeImageResponse>> {
  return normalized(requestJson<unknown>(apiBaseUrl, representativeImagePath(gameId, target), { signal }), parseRepresentative);
}

export function listImageOptions(apiBaseUrl: string, gameId: string, keyword: string): Promise<ApiResult<ImageOptionsResponse>> {
  const normalizedKeyword = keyword.trim();
  if (normalizedKeyword.length < 1 || normalizedKeyword.length > 100) {
    return Promise.reject(new ApiRequestError('图片搜索文字须为 1～100 个字符。', 400, '400.VALIDATION_FAILED'));
  }
  return normalized(requestJson<unknown>(apiBaseUrl, `${adminGamePath(gameId)}/image-options?${new URLSearchParams({ keyword: normalizedKeyword })}`), parseOptions);
}

export function getImageUsages(apiBaseUrl: string, gameId: string, imageKey: string): Promise<ApiResult<ImageUsages>> {
  return normalized(requestJson<unknown>(apiBaseUrl, `${adminGamePath(gameId)}/images/${encodePathSegment(imageKey)}/usages`), (value) => parseUsages(value, gameId, imageKey));
}
