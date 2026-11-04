import type { ApiErrorResponse, GameSummary } from '../types/api';
import { getAuthRevision, setAuthSession, showLoginRequired } from './authState';

const DEFAULT_API_BASE_URL = typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin;

export type ApiResult<T> = {
  data: T;
  status: number;
  etag: string | null;
  flowCsrf?: string;
};

export type ApiRequestOptions = Omit<RequestInit, 'credentials'> & {
  ifNoneMatch?: string;
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
  const candidate = explicitValue?.trim() || import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  return candidate.replace(/\/$/, '');
}

export function getErrorMessage(error: unknown): string {
  if (isLoginPromptHandled(error)) return '';
  if (error instanceof ApiRequestError) {
    if (error.code === 'AUTH.LOGIN_NOT_ENABLED') return '账号尚未开通，请完成开通后重新登录。';
    if (error.code === 'AUTH.ACCOUNT_DISABLED') return '账号已被禁用，请联系维护者。';
    if (error.code === 'AUTH.EDIT_REQUIRED') return '当前账号没有编辑资格，可以继续浏览游戏资料。';
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

  const { authentication, authFailure = 'prompt', loginPrompt = 'operation', preserveSessionOn401 = false, csrfToken, ifNoneMatch, ...requestOptions } = options;
  const method = (options.method ?? 'GET').toUpperCase();
  const authRevision = getAuthRevision();
  const access = authentication ?? ((method === 'GET' || method === 'HEAD' || /\/simulation-snapshot(?:\?|$)/.test(path)) ? 'anonymous' : 'session');
  headers.delete('Authorization');
  headers.delete('Cookie');
  headers.delete('X-CSRF-Token');
  headers.delete('X-Damage-Client');
  if (access !== 'anonymous') {
    headers.set('X-Damage-Client', 'web');
    if (method !== 'GET' && method !== 'HEAD') {
      headers.set('Content-Type', 'application/json');
    }
    if (access === 'flow' || (access === 'session' && method !== 'GET' && method !== 'HEAD')) {
      const csrf = csrfToken === undefined ? readAuthCsrf(access) : csrfToken;
      if (csrf) headers.set('X-CSRF-Token', csrf);
    }
  }

  if (ifNoneMatch) {
    headers.set('If-None-Match', ifNoneMatch);
  }

  const response = await fetch(buildUrl(apiBaseUrl, path), {
    ...requestOptions,
    headers,
    credentials: access === 'anonymous' ? 'omit' : 'include'
  });

  const body = await parseBody(response);

  if (!response.ok) {
    const error = toRequestError(response, body);
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
    return [];
  }
  return value.map((item) => normalizeGameSummary(item));
}

function normalizeGameSummary(value: unknown): GameSummary {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    gameId: typeof record.gameId === 'string' ? record.gameId : '',
    gameName: typeof record.gameName === 'string' ? record.gameName : '',
    representativeImageKey: typeof record.representativeImageKey === 'string' ? record.representativeImageKey : null
  };
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
      payload.error?.message || `请求失败（HTTP ${response.status}）。`,
      response.status,
      payload.error?.code,
      payload.error?.details as Record<string, unknown> | undefined
    );
  }

  return new ApiRequestError(`请求失败（HTTP ${response.status}）。`, response.status);
}
