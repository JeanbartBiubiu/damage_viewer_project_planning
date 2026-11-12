import { afterEach, describe, expect, it } from 'vitest';
import { maintenanceNotBefore } from './maintenanceGrant';
import { setMaintenanceSession } from '../services/maintenanceState';

const principal = 'e3e2a480-9bf4-49bb-a036-fef46b341da4';
const now = Math.floor(Date.now() / 1000);
const claims = { sub: principal, subjectType: 'MAINTENANCE', authorizationVersion: 2, iat: now, nbf: now, exp: now + 60 };
function grant(payload: unknown) { return `header.${btoa(JSON.stringify(payload))}.signature`; }
afterEach(() => setMaintenanceSession(null));
describe('维护票据客户端时点与身份核对', () => {
  it('支持被会话剩余期限截短的票据，不从过期时间倒推固定30分钟', () => {
    setMaintenanceSession({ principalId: principal, displayName: '维护', expiresAt: new Date((now + 120) * 1000).toISOString() });
    expect(maintenanceNotBefore(grant(claims), claims.exp * 1000)).toBe(now * 1000);
  });
  it.each([{ subjectType: 'PLAYER' }, { sub: '94f7f37a-2e64-44f2-a89c-01e949f708b8' }, { canLogin: 1 }, { exp: now + 1801 }, { authorizationVersion: 1 }])('拒绝不匹配类别、主体、字段及期限 %j', patch => {
    setMaintenanceSession({ principalId: principal, displayName: '维护', expiresAt: new Date((now + 3600) * 1000).toISOString() });
    const payload = { ...claims, ...patch };
    expect(() => maintenanceNotBefore(grant(payload), payload.exp * 1000)).toThrow('维护计算授权的身份或期限不匹配');
  });
  it('会话不存在或比票据更早到期时拒绝', () => {
    expect(() => maintenanceNotBefore(grant(claims), claims.exp * 1000)).toThrow();
    setMaintenanceSession({ principalId: principal, displayName: '维护', expiresAt: new Date((now + 30) * 1000).toISOString() });
    expect(() => maintenanceNotBefore(grant(claims), claims.exp * 1000)).toThrow();
  });
});
