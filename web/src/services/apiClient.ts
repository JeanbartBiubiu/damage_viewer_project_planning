import type {
  ApiErrorResponse,
  CoefficientBucketsResponse,
  CurrentVersion,
  FormulaBindingsResponse,
  FormulaProfilesResponse,
  GameDataBundle,
  GameSummary,
  ImageCollectionResponse,
  OwnerCategoryResponse,
  StatusActionControlRulesResponse
} from '../types/api';

const DEFAULT_API_BASE_URL = 'http://localhost:8080';

export type ApiResult<T> = {
  data: T;
  status: number;
  etag: string | null;
};

type RequestOptions = RequestInit & {
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
  return '发生了未知错误';
}

export async function listGames(apiBaseUrl: string): Promise<ApiResult<GameSummary[]>> {
  return requestJson<GameSummary[]>(apiBaseUrl, '/api/games');
}

export async function getCurrentVersion(apiBaseUrl: string, gameId: string): Promise<ApiResult<CurrentVersion>> {
  return requestJson<CurrentVersion>(apiBaseUrl, `/api/games/${gameId}/versions/current`);
}

export async function getBundle(
  apiBaseUrl: string,
  gameId: string,
  versionId: number,
  ifNoneMatch?: string
): Promise<ApiResult<GameDataBundle>> {
  return requestJson<GameDataBundle>(apiBaseUrl, `/api/games/${gameId}/versions/${versionId}/bundle`, {
    ifNoneMatch
  });
}

export async function getOwnerCategories(apiBaseUrl: string, gameId: string): Promise<ApiResult<OwnerCategoryResponse>> {
  return requestJson<OwnerCategoryResponse>(apiBaseUrl, `/api/games/${gameId}/owner-categories`);
}

export async function getImages(
  apiBaseUrl: string,
  gameId: string,
  updatedAfter?: string
): Promise<ApiResult<ImageCollectionResponse>> {
  const url = new URL(`/api/games/${gameId}/images`, `${resolveApiBaseUrl(apiBaseUrl)}/`);
  if (updatedAfter) {
    url.searchParams.set('updatedAfter', updatedAfter);
  }
  return requestJson<ImageCollectionResponse>(apiBaseUrl, `${url.pathname}${url.search}`);
}

export async function getCoefficientBuckets(
  apiBaseUrl: string,
  gameId: string,
  token: string
): Promise<ApiResult<CoefficientBucketsResponse>> {
  return requestJson<CoefficientBucketsResponse>(apiBaseUrl, `/api/admin/games/${gameId}/coefficient-buckets`, {
    token
  });
}

export async function getStatusActionControlRules(
  apiBaseUrl: string,
  gameId: string,
  token: string
): Promise<ApiResult<StatusActionControlRulesResponse>> {
  return requestJson<StatusActionControlRulesResponse>(apiBaseUrl, `/api/admin/games/${gameId}/status-action-control-rules`, {
    token
  });
}

export async function getFormulaProfiles(
  apiBaseUrl: string,
  gameId: string,
  token: string
): Promise<ApiResult<FormulaProfilesResponse>> {
  return requestJson<FormulaProfilesResponse>(apiBaseUrl, `/api/admin/games/${gameId}/formula-profiles`, {
    token
  });
}

export async function getFormulaBindings(
  apiBaseUrl: string,
  gameId: string,
  token: string
): Promise<ApiResult<FormulaBindingsResponse>> {
  return requestJson<FormulaBindingsResponse>(apiBaseUrl, `/api/admin/games/${gameId}/formula-bindings`, {
    token
  });
}

async function requestJson<T>(apiBaseUrl: string, path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
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

function buildUrl(apiBaseUrl: string, path: string): string {
  return new URL(path, `${resolveApiBaseUrl(apiBaseUrl)}/`).toString();
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
      payload.error?.message || `请求失败，HTTP ${response.status}`,
      response.status,
      payload.error?.code,
      payload.error?.details as Record<string, unknown> | undefined
    );
  }

  return new ApiRequestError(`请求失败，HTTP ${response.status}`, response.status);
}
