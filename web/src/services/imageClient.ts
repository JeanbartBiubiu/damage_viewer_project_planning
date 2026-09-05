import type { ApiResult } from './apiClient';
import { ApiRequestError, encodePathSegment, requestJson } from './apiClient';
import type {
  CreateImageRequest,
  ImageFieldIssue,
  ManagedImage,
  PublicImage,
  PublicImageListResponse,
  UpdateImageRequest
} from '../types/image';

function adminImagesPath(gameId: string, imageKey?: string): string {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/images`;
  return imageKey === undefined ? base : `${base}/${encodePathSegment(imageKey)}`;
}

function publicImagesPath(gameId: string): string {
  return `/api/games/${encodePathSegment(gameId)}/images`;
}

function invalidResponse(message: string): never {
  throw new ApiRequestError(message, 502, '502.IMAGE_RESPONSE_INVALID');
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidResponse(`${label}格式不合法。`);
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, field: string, label: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value) {
    invalidResponse(`${label}缺少 ${field}。`);
  }
  return value;
}

function nullableString(record: Record<string, unknown>, field: string, label: string): string | null {
  const value = record[field];
  if (value !== null && typeof value !== 'string') {
    invalidResponse(`${label}的 ${field} 格式不合法。`);
  }
  return value as string | null;
}

function positiveInteger(record: Record<string, unknown>, field: string, label: string): number {
  const value = record[field];
  if (!Number.isInteger(value) || Number(value) <= 0) {
    invalidResponse(`${label}的 ${field} 格式不合法。`);
  }
  return Number(value);
}

function booleanValue(record: Record<string, unknown>, field: string, label: string): boolean {
  const value = record[field];
  if (typeof value !== 'boolean') {
    invalidResponse(`${label}的 ${field} 格式不合法。`);
  }
  return value;
}

function normalizeManagedImage(value: unknown): ManagedImage {
  const label = '图片详情';
  const record = recordOf(value, label);
  const mimeType = requiredString(record, 'mimeType', label);
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') {
    invalidResponse('图片详情的 mimeType 不受支持。');
  }
  return {
    gameId: requiredString(record, 'gameId', label),
    imageKey: requiredString(record, 'imageKey', label),
    name: requiredString(record, 'name', label),
    description: nullableString(record, 'description', label),
    imageBase64: requiredString(record, 'imageBase64', label),
    mimeType,
    byteSize: positiveInteger(record, 'byteSize', label),
    width: positiveInteger(record, 'width', label),
    height: positiveInteger(record, 'height', label),
    enabled: booleanValue(record, 'enabled', label),
    createdAt: requiredString(record, 'createdAt', label),
    updatedAt: requiredString(record, 'updatedAt', label)
  };
}

function normalizePublicImage(value: unknown): PublicImage {
  const label = '公开图片';
  const record = recordOf(value, label);
  const normalized = {
    imageKey: requiredString(record, 'imageKey', label),
    enabled: booleanValue(record, 'enabled', label),
    imageBase64: nullableString(record, 'imageBase64', label),
    updatedAt: requiredString(record, 'updatedAt', label)
  };
  if ((normalized.enabled && normalized.imageBase64 === null)
    || (!normalized.enabled && normalized.imageBase64 !== null)) {
    invalidResponse('公开图片内容与启停状态不一致。');
  }
  return normalized;
}

function normalizePublicImageList(value: unknown): PublicImageListResponse {
  const record = recordOf(value, '公开图片列表');
  if (!Array.isArray(record.images)) {
    invalidResponse('公开图片列表缺少 images。');
  }
  return {
    gameId: requiredString(record, 'gameId', '公开图片列表'),
    images: record.images.map(normalizePublicImage)
  };
}

async function normalizeResult<T, U>(
  result: Promise<ApiResult<T>>,
  normalize: (value: T) => U
): Promise<ApiResult<U>> {
  const response = await result;
  return { ...response, data: normalize(response.data) };
}

export function getImage(
  apiBaseUrl: string,
  gameId: string,
  imageKey: string,
  token: string
): Promise<ApiResult<ManagedImage>> {
  return normalizeResult(
    requestJson<unknown>(apiBaseUrl, adminImagesPath(gameId, imageKey), { token }),
    normalizeManagedImage
  );
}

export function createImage(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: CreateImageRequest
): Promise<ApiResult<ManagedImage>> {
  return normalizeResult(
    requestJson<unknown>(apiBaseUrl, adminImagesPath(gameId), {
      method: 'POST',
      token,
      body: JSON.stringify(body)
    }),
    normalizeManagedImage
  );
}

export function updateImage(
  apiBaseUrl: string,
  gameId: string,
  imageKey: string,
  token: string,
  body: UpdateImageRequest
): Promise<ApiResult<ManagedImage>> {
  return normalizeResult(
    requestJson<unknown>(apiBaseUrl, adminImagesPath(gameId, imageKey), {
      method: 'PUT',
      token,
      body: JSON.stringify(body)
    }),
    normalizeManagedImage
  );
}

export function listPublicImages(
  apiBaseUrl: string,
  gameId: string,
  updatedAfter?: string
): Promise<ApiResult<PublicImageListResponse>> {
  const params = new URLSearchParams();
  if (updatedAfter) params.set('updatedAfter', updatedAfter);
  const search = params.toString();
  const path = `${publicImagesPath(gameId)}${search ? `?${search}` : ''}`;
  return normalizeResult(requestJson<unknown>(apiBaseUrl, path), normalizePublicImageList);
}

export function imageFieldIssues(error: unknown): ImageFieldIssue[] {
  if (!(error instanceof ApiRequestError)) return [];
  const raw = error.details?.fieldIssues;
  if (!Array.isArray(raw)) return [];
  return raw.filter((issue): issue is ImageFieldIssue => {
    if (!issue || typeof issue !== 'object') return false;
    const value = issue as Record<string, unknown>;
    return typeof value.field === 'string'
      && typeof value.code === 'string'
      && typeof value.message === 'string';
  });
}
