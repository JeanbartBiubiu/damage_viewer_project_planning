import type { ApiErrorResponse, GameSummary } from '../types/api';
import { getAuthRevision, setAuthSession, showLoginRequired } from './authState';
import { captureMaintenanceRequest, getMaintenanceBatch, getMaintenanceRevision, getMaintenanceSession, maintenanceCapturesOnly, setMaintenanceSession } from './maintenanceState';
import { DEPLOYMENT_MODE } from '../config/deployment';

const DEFAULT_API_BASE_URL = typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin;

export type ApiResult<T> = {
  data: T;
  status: number;
  etag: string | null;
  flowCsrf?: string;
};

export type ApiRequestOptions = Omit<RequestInit, 'credentials'> & {
  ifNoneMatch?: string;
  authentication?: 'anonymous' | 'bootstrap' | 'session' | 'flow' | 'maintenance';
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
  const maintenanceRevision = DEPLOYMENT_MODE === 'maintenance' ? getMaintenanceRevision() : 0;
  const snapshotRead = method === 'POST' && /^\/api\/admin\/games\/[^/?]+\/simulation-snapshot(?:\?|$)/.test(path);
  const configurationWrite = /^\/api\/admin\/games(?:\/|$)/.test(path) && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !snapshotRead;
  if (DEPLOYMENT_MODE === 'viewer' && configurationWrite) throw new ApiRequestError('公共查看端不能修改游戏配置。', 403, 'PUBLIC.CONFIGURATION_READ_ONLY');
  const access = authentication ?? ((method === 'GET' || method === 'HEAD' || snapshotRead) ? 'anonymous' : configurationWrite ? 'maintenance' : 'session');
  headers.delete('Authorization');
  headers.delete('Cookie');
  headers.delete('X-CSRF-Token');
  headers.delete('X-Damage-Client');
  headers.delete('X-Damage-Maintenance-Token');
  if (DEPLOYMENT_MODE === 'maintenance') headers.delete('X-Damage-Maintenance-Batch');
  if (DEPLOYMENT_MODE === 'maintenance' && configurationWrite && access === 'maintenance') {
    if (typeof options.body !== 'string' && options.body !== undefined) throw new ApiRequestError('候选保存只接受明确的 JSON 请求。', 400, 'MAINTENANCE.REQUEST_INVALID');
    captureMaintenanceRequest({ method, path, body: typeof options.body === 'string' ? options.body : null });
    if (maintenanceCapturesOnly()) throw new ApiRequestError('候选请求已记录，请下载并独立验证；当前草稿未写入数据库。', 409, 'MAINTENANCE.CANDIDATE_CAPTURED');
    const batch = getMaintenanceBatch();
    if (batch) headers.set('X-Damage-Maintenance-Batch', batch);
  }
  if (access !== 'anonymous' || !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-Damage-Client', 'web');
  }
  if (access !== 'anonymous') {
    if (method !== 'GET' && method !== 'HEAD') {
      headers.set('Content-Type', 'application/json');
    }
    if (access === 'flow' || ((access === 'session' || access === 'maintenance') && method !== 'GET' && method !== 'HEAD')) {
      const csrf = csrfToken === undefined ? access === 'maintenance' ? readCookie('__Host-damage-maint-csrf') : readAuthCsrf(access) : csrfToken;
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
    // 正常读取继续匿名；维护窗口中仅私有版以有效维护会话补做一次只读回查。
    if (DEPLOYMENT_MODE === 'maintenance' && access === 'anonymous' && getMaintenanceSession()
      && response.status === 503 && error.code === 'MAINTENANCE.WINDOW_OPEN'
      && ((method === 'GET' || method === 'HEAD') && /^\/api\/(?:admin\/)?games(?:\/|$)/.test(path) || snapshotRead)) {
      return requestJson<T>(apiBaseUrl, path, { ...options, authentication: 'maintenance' });
    }
    if (DEPLOYMENT_MODE === 'maintenance' && access === 'maintenance' && response.status === 401 && maintenanceRevision === getMaintenanceRevision()) setMaintenanceSession(null);
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

  if (DEPLOYMENT_MODE === 'maintenance' && configurationWrite && access === 'maintenance' && maintenanceRevision !== getMaintenanceRevision()) {
    throw new ApiRequestError('维护身份已变化，请独立回读本次保存结果；页面不会自动重发。', 409, 'MAINTENANCE.SESSION_CHANGED');
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
