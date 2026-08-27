import type { ApiResult } from './apiClient';
import { encodePathSegment, requestJson } from './apiClient';
import type {
  CreateStatusRequest,
  GameStatus,
  StatusListQuery,
  StatusListResponse,
  UpdateStatusRequest
} from '../types/status';

function statusesPath(gameId: string, statusKey?: string): string {
  const base = `/api/admin/games/${encodePathSegment(gameId)}/statuses`;
  return statusKey === undefined ? base : `${base}/${encodePathSegment(statusKey)}`;
}

function withQuery(path: string, query: StatusListQuery = {}): string {
  const params = new URLSearchParams();
  const keyword = query.keyword?.trim();
  if (keyword) params.set('keyword', keyword);
  if (query.status) params.set('status', query.status);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function listStatuses(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  query: StatusListQuery = {}
): Promise<ApiResult<StatusListResponse>> {
  return requestJson<StatusListResponse>(
    apiBaseUrl,
    withQuery(statusesPath(gameId), query),
    { token }
  );
}

export function getStatus(
  apiBaseUrl: string,
  gameId: string,
  statusKey: string,
  token: string
): Promise<ApiResult<GameStatus>> {
  return requestJson<GameStatus>(apiBaseUrl, statusesPath(gameId, statusKey), { token });
}

export function createStatus(
  apiBaseUrl: string,
  gameId: string,
  token: string,
  body: CreateStatusRequest
): Promise<ApiResult<GameStatus>> {
  return requestJson<GameStatus>(apiBaseUrl, statusesPath(gameId), {
    method: 'POST',
    token,
    body: JSON.stringify(body)
  });
}

export function updateStatus(
  apiBaseUrl: string,
  gameId: string,
  statusKey: string,
  token: string,
  body: UpdateStatusRequest
): Promise<ApiResult<GameStatus>> {
  return requestJson<GameStatus>(apiBaseUrl, statusesPath(gameId, statusKey), {
    method: 'PUT',
    token,
    body: JSON.stringify(body)
  });
}

export function deleteStatus(
  apiBaseUrl: string,
  gameId: string,
  statusKey: string,
  token: string
): Promise<ApiResult<null>> {
  return requestJson<null>(apiBaseUrl, statusesPath(gameId, statusKey), {
    method: 'DELETE',
    token
  });
}
