import {
  ApiRequestError, buildApiUrl, isConfigurationWrite, isReadMethod, jsonRequestHeaders, readApiResult,
  type ApiResult, type JsonRequestOptions
} from './apiClient';
import { captureMaintenanceRequest, getMaintenanceBatch, getMaintenanceRevision } from './maintenanceState';

export async function requestMaintenanceJson<T>(
  apiBaseUrl: string, path: string, options: JsonRequestOptions = {}
): Promise<ApiResult<T>> {
  const url = buildApiUrl(apiBaseUrl, path);
  if (!/^\/(?:api\/(?:admin\/)?games|internal\/maintenance)(?:\/|$)/.test(url.pathname)) {
    throw new ApiRequestError('维护端不能访问此接口。', 403, 'MAINTENANCE.REQUEST_INVALID');
  }
  const { ifNoneMatch: _etag, ...requestOptions } = options;
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = jsonRequestHeaders(options);
  for (const field of ['X-Damage-Maintenance-Batch', 'X-Damage-Maintenance-Token', 'X-Damage-Deployment-Token', 'X-Damage-Internal-Token']) {
    headers.delete(field);
  }
  if (!isReadMethod(method)) headers.set('X-Damage-Client', 'web');

  const revision = getMaintenanceRevision();
  const configurationWrite = isConfigurationWrite(method, url.pathname);
  if (configurationWrite) {
    if (options.body != null && typeof options.body !== 'string') {
      throw new ApiRequestError('候选保存只接受明确的 JSON 请求。', 400, 'MAINTENANCE.REQUEST_INVALID');
    }
    const batch = getMaintenanceBatch();
    captureMaintenanceRequest({ method, path: `${url.pathname}${url.search}`, body: options.body ?? null });
    if (!batch) {
      throw new ApiRequestError('候选请求已记录，请下载并独立验证；当前草稿未写入数据库。', 409, 'MAINTENANCE.CANDIDATE_CAPTURED');
    }
    headers.set('X-Damage-Maintenance-Batch', batch);
  }

  const response = await fetch(url.toString(), {
    ...requestOptions, headers, credentials: 'omit', mode: 'same-origin', redirect: 'error'
  });
  const result = await readApiResult<T>(response);
  if (configurationWrite && revision !== getMaintenanceRevision()) {
    throw new ApiRequestError('维护身份已变化，请独立回读本次保存结果。', 409, 'MAINTENANCE.PRINCIPAL_CHANGED');
  }
  return result;
}
