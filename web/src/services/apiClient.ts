import type { ApiErrorResponse, GameSummary } from '../types/api';
import { getAuthRevision, setAuthSession, showLoginRequired } from './authState';

export type ApiResult<T> = {
  data: T;
  status: number;
  etag: string | null;
  flowCsrf?: string;
};

export type JsonRequestOptions = Omit<RequestInit, 'credentials' | 'mode'> & {
  ifNoneMatch?: string;
};

export type ApiRequestOptions = JsonRequestOptions & {
  authentication?: 'anonymous' | 'bootstrap' | 'session' | 'flow';
  authFailure?: 'silent' | 'prompt';
  loginPrompt?: 'operation' | 'compute';
  preserveSessionOn401?: boolean;
  csrfToken?: string | null;
};

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;
  handledByLoginPrompt = false;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function resolveApiBaseUrl(explicitValue?: string): string {
  const pageOrigin = typeof window === 'undefined' ? undefined : window.location.origin;
  const candidate = explicitValue?.trim() || import.meta.env.VITE_API_BASE_URL?.trim() || pageOrigin || 'http://localhost:8080';
  let url: URL;
  try { url = new URL(candidate); } catch {
    throw new ApiRequestError('API 地址必须是本站的 HTTP 或 HTTPS 来源。', 400, 'API.ORIGIN_INVALID');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.href !== `${url.origin}/`
    || (pageOrigin !== undefined && url.origin !== pageOrigin)) {
    throw new ApiRequestError('API 地址必须是本站的 HTTP 或 HTTPS 来源。', 400, 'API.ORIGIN_INVALID');
  }
  return url.origin;
}

export function buildApiUrl(apiBaseUrl: string, path: string): URL {
  const origin = resolveApiBaseUrl(apiBaseUrl);
  const url = new URL(path, origin);
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin || url.username || url.password || url.hash) {
    throw new ApiRequestError('API 请求必须指向本站。', 400, 'API.ORIGIN_INVALID');
  }
  return url;
}

export function getErrorMessage(error: unknown): string {
  if (isLoginPromptHandled(error)) return '';
  if (error instanceof ApiRequestError) {
    if (error.code === 'AUTH.LOGIN_NOT_ENABLED') return '账号尚未开通，请完成开通后重新登录。';
    if (error.code === 'AUTH.ACCOUNT_DISABLED') return '账号已被禁用，请联系维护者。';
    return error.code ? `${error.code}: ${error.message}` : error.message;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (/^(failed to fetch|fetch failed|network request failed|load failed|networkerror when attempting to fetch resource\.?)$/i.test(message)) {
      return '网络请求失败，请检查网络连接和 API 地址。';
    }
    return message ? error.message : '发生未知错误，请稍后重试。';
  }
  return '发生未知错误，请稍后重试。';
}

export function isLoginPromptHandled(error: unknown): boolean {
  return error instanceof Error && 'handledByLoginPrompt' in error && error.handledByLoginPrompt === true;
}

export function getErrorMessageWithContext(error: unknown, prefix: string, suffix = ''): string {
  return isLoginPromptHandled(error) ? '' : `${prefix}${getErrorMessage(error)}${suffix}`;
}

export async function listGames(apiBaseUrl: string): Promise<ApiResult<GameSummary[]>> {
  const result = await requestJson<unknown>(apiBaseUrl, '/api/games');
  return {
    ...result,
    data: normalizeGameSummaries(result.data)
  };
}

export function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

export function isSnapshotRead(method: string, pathname: string): boolean {
  return method === 'POST' && /^\/api\/admin\/games\/[^/]+\/simulation-snapshot$/.test(pathname);
}

export function isConfigurationWrite(method: string, pathname: string): boolean {
  return /^\/api\/admin\/games(?:\/|$)/.test(pathname) && !isReadMethod(method) && !isSnapshotRead(method, pathname);
}

export function jsonRequestHeaders(options: JsonRequestOptions): Headers {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (options.ifNoneMatch) headers.set('If-None-Match', options.ifNoneMatch);
  for (const field of ['Authorization', 'Cookie', 'X-CSRF-Token', 'X-Damage-Client', 'Origin', 'Sec-Fetch-Site']) {
    headers.delete(field);
  }
  return headers;
}

export async function requestJson<T>(
  apiBaseUrl: string,
  path: string,
  options: ApiRequestOptions = {}
): Promise<ApiResult<T>> {
  const url = buildApiUrl(apiBaseUrl, path);
  const headers = jsonRequestHeaders(options);
  const { authentication, authFailure = 'prompt', loginPrompt = 'operation', preserveSessionOn401 = false, csrfToken, ifNoneMatch: _ifNoneMatch, ...requestOptions } = options;
  const method = (options.method ?? 'GET').toUpperCase();
  const authRevision = getAuthRevision();
  if (isConfigurationWrite(method, url.pathname) || /^\/internal(?:\/|$)/.test(url.pathname)) {
    throw new ApiRequestError('公共查看端不能访问内部接口或修改游戏配置。', 403, 'PUBLIC.CONFIGURATION_READ_ONLY');
  }
  const access = authentication ?? ((method === 'GET' || method === 'HEAD' || isSnapshotRead(method, url.pathname)) ? 'anonymous' : 'session');
  if (access !== 'anonymous' || !isReadMethod(method)) {
    headers.set('X-Damage-Client', 'web');
  }
  if (access !== 'anonymous') {
    if (method !== 'GET' && method !== 'HEAD') {
      headers.set('Content-Type', 'application/json');
    }
    if (access === 'flow' || (access === 'session' && method !== 'GET' && method !== 'HEAD')) {
      const csrf = csrfToken === undefined ? readAuthCsrf(access) : csrfToken;
      if (csrf) headers.set('X-CSRF-Token', csrf);
    }
  }

  const response = await fetch(url.toString(), {
    ...requestOptions,
    headers,
    mode: 'same-origin',
    credentials: access === 'anonymous' ? 'omit' : 'include'
  });
  try {
    return await readApiResult<T>(response);
  } catch (error) {
    if (!(error instanceof ApiRequestError)) throw error;
    if (access === 'session' && response.status === 401 && !preserveSessionOn401 && authRevision === getAuthRevision()) {
      setAuthSession(null, authFailure === 'prompt');
      if (authFailure === 'prompt') {
        error.handledByLoginPrompt = true;
        showLoginRequired(loginPrompt);
      }
    }
    if (access === 'session' && response.status === 403 && authRevision === getAuthRevision() && (error.code === 'AUTH.ACCOUNT_DISABLED' || error.code === 'AUTH.LOGIN_NOT_ENABLED')) {
      setAuthSession(null, authFailure === 'prompt');
    }
    throw error;
  }

}

export async function readApiResult<T>(response: Response): Promise<ApiResult<T>> {
  const body = await parseBody(response);
  if (!response.ok) throw toRequestError(response, body);
  const flowCsrf = response.headers.get('X-Damage-Flow-CSRF');
  return {
    data: body as T,
    status: response.status,
    etag: response.headers.get('ETag'),
    ...(flowCsrf ? { flowCsrf } : {})
  };
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  if (!entry) return null;
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return null; }
}

export function readAuthCsrf(kind: 'session' | 'flow'): string | null {
  return readCookie(kind === 'session' ? '__Host-dv_csrf' : '__Host-dv_flow_csrf');
}

function normalizeGameSummaries(value: unknown): GameSummary[] {
  if (!Array.isArray(value)) {
    throw new ApiRequestError('游戏目录响应必须是数组。', 502, '502.GAME_RESPONSE_INVALID');
  }
  return value.map((item) => normalizeGameSummary(item));
}

function normalizeGameSummary(value: unknown): GameSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiRequestError('游戏摘要响应格式不合法。', 502, '502.GAME_RESPONSE_INVALID');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.gameId !== 'string' || typeof record.gameName !== 'string'
    || (record.representativeImageKey !== undefined && record.representativeImageKey !== null
      && typeof record.representativeImageKey !== 'string')) {
    throw new ApiRequestError('游戏摘要缺少合法的游戏身份、名称或代表图片标识。', 502, '502.GAME_RESPONSE_INVALID');
  }
  return {
    gameId: record.gameId,
    gameName: record.gameName,
    representativeImageKey: record.representativeImageKey ?? null
  };
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
      payload.error?.message || `请求失败（HTTP ${response.status}）。`,
      response.status,
      payload.error?.code,
      payload.error?.details as Record<string, unknown> | undefined
    );
  }

  return new ApiRequestError(`请求失败（HTTP ${response.status}）。`, response.status);
}
