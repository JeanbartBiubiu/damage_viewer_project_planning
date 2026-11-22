import { ApiRequestError, resolveApiBaseUrl } from './apiClient';
import { requestMaintenanceJson } from './maintenanceApiRequest';
import { setMaintenancePrincipal, type MaintenancePrincipal } from './maintenanceState';

function readPrincipal(value: unknown): MaintenancePrincipal {
  const row = value as Partial<MaintenancePrincipal> | null;
  if (!row || typeof row.principalId !== 'string' || typeof row.displayName !== 'string' || !row.displayName.trim()
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.principalId)) {
    throw new ApiRequestError('维护身份响应不完整。', 502, 'MAINTENANCE.RESPONSE_INVALID');
  }
  return { principalId: row.principalId, displayName: row.displayName };
}

let principalRequest: Promise<MaintenancePrincipal> | undefined;

export async function refreshMaintenancePrincipal(apiBaseUrl: string): Promise<MaintenancePrincipal> {
  const origin = resolveApiBaseUrl(apiBaseUrl);
  principalRequest ??= requestMaintenanceJson<unknown>(origin, '/internal/maintenance/me', { cache: 'no-store' })
    .then(result => {
      const principal = readPrincipal(result.data);
      setMaintenancePrincipal(principal);
      return principal;
    })
    .finally(() => { principalRequest = undefined; });
  return principalRequest;
}

export async function getMaintenanceWasmGrant(apiBaseUrl: string): Promise<{ grant: string; expiresAt: string }> {
  await refreshMaintenancePrincipal(apiBaseUrl);
  const response = await requestMaintenanceJson<{ grant: string; expiresAt: string }>(apiBaseUrl, '/internal/maintenance/wasm-grant', {
    method: 'POST', body: '{}', cache: 'no-store'
  });
  return response.data;
}
