import { ApiRequestError } from '../services/apiClient';
import { getMaintenanceSession } from '../services/maintenanceState';

/** 这里只核对客户端的时点和身份；签名及授权最终仍由正式引擎验证。 */
export function maintenanceNotBefore(grant: string, expiresAt: number): number {
  const session = getMaintenanceSession();
  try {
    const part = grant.split('.')[1];
    if (!part || !session) throw new Error('missing');
    const encoded = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload: unknown = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('shape');
    const row = payload as Record<string, unknown>;
    if (row.subjectType !== 'MAINTENANCE' || row.sub !== session.principalId || row.authorizationVersion !== 2
      || typeof row.nbf !== 'number' || !Number.isSafeInteger(row.nbf) || row.nbf !== row.iat
      || typeof row.exp !== 'number' || !Number.isSafeInteger(row.exp) || row.exp * 1000 !== expiresAt
      || row.exp <= row.nbf || row.exp - row.nbf > 1800 || expiresAt > Date.parse(session.expiresAt)
      || Object.prototype.hasOwnProperty.call(row, 'canLogin')) throw new Error('identity');
    return row.nbf * 1000;
  } catch {
    throw new ApiRequestError('维护计算授权的身份或期限不匹配，请刷新维护会话。', 502, 'MAINTENANCE.INVALID_WASM_GRANT');
  }
}
