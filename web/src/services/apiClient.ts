import type {
  ApiErrorResponse,
  CurrentVersion,
  GameSummary,
  ImageAsset,
  ImageCollectionResponse,
  VersionPublishPayload,
  VersionPublishResponse
} from '../types/api';

const DEFAULT_API_BASE_URL = 'http://localhost:8080';

export type ApiResult<T> = {
  data: T;
  status: number;
  etag: string | null;
};

export type ApiRequestOptions = RequestInit & {
  token?: string;
  ifNoneMatch?: string;
};

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function resolveApiBaseUrl(explicitValue?: string): string {
  const candidate = explicitValue?.trim() || import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  return candidate.replace(/\/$/, '');
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.code ? `${error.code}: ${error.message}` : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unknown error occurred.';
}

export async function listGames(apiBaseUrl: string): Promise<ApiResult<GameSummary[]>> {
  return requestJson<GameSummary[]>(apiBaseUrl, '/api/games');
}

export async function getCurrentVersion(apiBaseUrl: string, gameId: string): Promise<ApiResult<CurrentVersion>> {
  const result = await requestJson<CurrentVersion>(apiBaseUrl, `/api/games/${encodePathSegment(gameId)}/versions/current`);
  return {
    ...result,
    data: normalizeCurrentVersion(result.data)
  };
}

export async function getImages(
  apiBaseUrl: string,
  gameId: string,
  updatedAfter?: string
): Promise<ApiResult<ImageCollectionResponse>> {
  const url = new URL(`/api/games/${encodePathSegment(gameId)}/images`, `${resolveApiBaseUrl(apiBaseUrl)}/`);
  if (updatedAfter) {
    url.searchParams.set('updatedAfter', updatedAfter);
  }
  return requestJson<ImageCollectionResponse>(apiBaseUrl, `${url.pathname}${url.search}`);
}

export async function putImage(
  apiBaseUrl: string,
  gameId: string,
  uri: string,
  token: string,
  imageBase64: string
): Promise<ApiResult<ImageAsset>> {
  return requestJson<ImageAsset>(apiBaseUrl, adminPath(gameId, 'images', uri), {
    method: 'PUT',
    token,
    body: JSON.stringify({ imageBase64 })
  });
}

export async function publishVersion(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: VersionPublishPayload
): Promise<ApiResult<VersionPublishResponse>> {
  const result = await requestJson<VersionPublishResponse>(apiBaseUrl, adminPath(gameId, 'versions:publish'), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  });

  return {
    ...result,
    data: normalizePublishedVersion(result.data)
  };
}

export async function requestJson<T>(
  apiBaseUrl: string,
  path: string,
  options: ApiRequestOptions = {}
): Promise<ApiResult<T>> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  if (options.ifNoneMatch) {
    headers.set('If-None-Match', options.ifNoneMatch);
  }

  const response = await fetch(buildUrl(apiBaseUrl, path), {
    ...options,
    headers
  });

  const body = await parseBody(response);

  if (!response.ok) {
    throw toRequestError(response, body);
  }

  return {
    data: body as T,
    status: response.status,
    etag: response.headers.get('ETag')
  };
}

function normalizeCurrentVersion(version: CurrentVersion): CurrentVersion {
  return {
    gameId: version.gameId,
    versionCode: version.versionCode,
    releaseDate: version.releaseDate,
    publishedAt: version.publishedAt,
    updatedAt: version.updatedAt,
    changeRevision: version.changeRevision
  };
}

function normalizePublishedVersion(version: VersionPublishResponse): VersionPublishResponse {
  return {
    gameId: version.gameId,
    versionCode: version.versionCode,
    releaseDate: version.releaseDate,
    publishedAt: version.publishedAt,
    updatedAt: version.updatedAt,
    changeRevision: version.changeRevision
  };
}

function adminPath(gameId: string, ...segments: string[]): string {
  const encodedSegments = segments.map(encodePathSegment).join('/');
  return `/api/admin/games/${encodePathSegment(gameId)}/${encodedSegments}`;
}

function buildUrl(apiBaseUrl: string, path: string): string {
  return new URL(path, `${resolveApiBaseUrl(apiBaseUrl)}/`).toString();
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

async function parseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function toRequestError(response: Response, body: unknown): ApiRequestError {
  if (typeof body === 'object' && body !== null) {
    const payload = body as ApiErrorResponse;
    return new ApiRequestError(
      payload.error?.message || `Request failed with HTTP ${response.status}`,
      response.status,
      payload.error?.code,
      payload.error?.details as Record<string, unknown> | undefined
    );
  }

  return new ApiRequestError(`Request failed with HTTP ${response.status}`, response.status);
}
