import { ApiRequestError, requestJson } from './apiClient';
import { getMaintenanceRevision, getMaintenanceSession, setMaintenanceSession, type MaintenanceSession } from './maintenanceState';

function readSession(value: unknown): MaintenanceSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiRequestError('维护会话响应不完整。', 502, 'MAINTENANCE.RESPONSE_INVALID');
  const row = value as Record<string, unknown>;
  if (typeof row.principalId !== 'string' || typeof row.displayName !== 'string' || typeof row.expiresAt !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.principalId)
    || !row.displayName.trim() || !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= Date.now()) {
    throw new ApiRequestError('维护会话响应不完整或已过期。', 502, 'MAINTENANCE.RESPONSE_INVALID');
  }
  return { principalId: row.principalId, displayName: row.displayName, expiresAt: row.expiresAt };
}

export async function restoreMaintenanceSession(apiBaseUrl: string): Promise<MaintenanceSession | null> {
  const revision = getMaintenanceRevision();
  try {
    const result = await requestJson<unknown>(apiBaseUrl, '/internal/maintenance/me', { authentication: 'maintenance', cache: 'no-store' });
    if (revision !== getMaintenanceRevision()) return getMaintenanceSession();
    setMaintenanceSession(readSession(result.data));
    return getMaintenanceSession();
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

export async function logoutMaintenance(apiBaseUrl: string): Promise<void> {
  await requestJson<null>(apiBaseUrl, '/internal/maintenance/logout', { method: 'POST', body: '{}', authentication: 'maintenance', cache: 'no-store' });
  setMaintenanceSession(null, true);
}

export async function getMaintenanceWasmGrant(apiBaseUrl: string): Promise<{ grant: string; expiresAt: string }> {
  const response = await requestJson<{ grant: string; expiresAt: string }>(apiBaseUrl, '/internal/maintenance/wasm-grant', {
    method: 'POST', body: '{}', authentication: 'maintenance', cache: 'no-store'
  });
  return response.data;
}
