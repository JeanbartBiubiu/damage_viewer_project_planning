import { describe, expect, it } from 'vitest';
import { maintenanceNotBefore } from './maintenanceGrant';

const principal = 'e3e2a480-9bf4-49bb-a036-fef46b341da4';
const now = Math.floor(Date.now() / 1000);
const claims = { sub: principal, subjectType: 'MAINTENANCE', authorizationVersion: 2, iat: now, nbf: now, exp: now + 60 };
function grant(payload: unknown) { return `header.${btoa(JSON.stringify(payload))}.signature`; }
describe('维护票据客户端时点与身份核对', () => {
  it.each([60, 1800])('按票据签发时刻接受 %i 秒期限', seconds => {
    const payload = { ...claims, exp: now + seconds };
    expect(maintenanceNotBefore(grant(payload), payload.exp * 1000, principal)).toBe(now * 1000);
  });
  it.each([{ subjectType: 'PLAYER' }, { sub: '94f7f37a-2e64-44f2-a89c-01e949f708b8' }, { canLogin: 1 }, { exp: now + 1801 }, { authorizationVersion: 1 }])('拒绝不匹配类别、主体、字段及期限 %j', patch => {
    const payload = { ...claims, ...patch };
    expect(() => maintenanceNotBefore(grant(payload), payload.exp * 1000, principal)).toThrow('维护计算授权的身份或期限不匹配');
  });
  it('拒绝未知主体或取票响应与票据过期时点不一致', () => {
    expect(() => maintenanceNotBefore(grant(claims), claims.exp * 1000)).toThrow();
    expect(() => maintenanceNotBefore(grant(claims), (claims.exp + 1) * 1000, principal)).toThrow();
  });
});
