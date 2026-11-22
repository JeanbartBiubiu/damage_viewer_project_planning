import { ApiRequestError } from '../services/apiClient';
import { getMaintenanceWasmGrant } from '../services/maintenanceClient';
import { getMaintenancePrincipal, onMaintenancePrincipalChanged } from '../services/maintenanceState';
import type { EngineAuthorization } from './genericEngineClient';

/** 这里只核对客户端的时点和身份；签名及授权最终仍由正式引擎验证。 */
export function maintenanceNotBefore(grant: string, expiresAt: number, principalId?: string): number {
  try {
    const part = grant.split('.')[1];
    if (!part || !principalId) throw new Error('missing');
    const encoded = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload: unknown = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('shape');
    const row = payload as Record<string, unknown>;
    if (row.subjectType !== 'MAINTENANCE' || row.sub !== principalId || row.authorizationVersion !== 2
      || typeof row.nbf !== 'number' || !Number.isSafeInteger(row.nbf) || row.nbf !== row.iat
      || typeof row.exp !== 'number' || !Number.isSafeInteger(row.exp) || row.exp * 1000 !== expiresAt
      || row.exp <= row.nbf || row.exp - row.nbf > 1800
      || Object.prototype.hasOwnProperty.call(row, 'canLogin')) throw new Error('identity');
    return row.nbf * 1000;
  } catch {
    throw new ApiRequestError('维护计算授权的身份或期限不匹配，请刷新维护身份。', 502, 'MAINTENANCE.INVALID_WASM_GRANT');
  }
}

export const maintenanceAuthorization: EngineAuthorization = {
  requestGrant: getMaintenanceWasmGrant,
  notBefore: (grant, expiresAt) => maintenanceNotBefore(grant, expiresAt, getMaintenancePrincipal()?.principalId),
  refreshBeforeExpirationMs: 0,
  onIdentityChanged: onMaintenancePrincipalChanged,
  identityChangedMessage: '维护身份已变化，请重新发起计算。'
};
