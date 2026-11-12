import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from './apiClient';
import { getAuthSession, setAuthSession } from './authState';
import { getMaintenanceCandidate, getMaintenanceSession, getMaintenanceBatch, onMaintenanceSessionChanged, setMaintenanceBatch, setMaintenanceCaptureOnly, setMaintenanceSession } from './maintenanceState';
import { getMaintenanceWasmGrant, restoreMaintenanceSession } from './maintenanceClient';

const api = 'https://private.example';
const principalId = 'e3e2a480-9bf4-49bb-a036-fef46b341da4';
const batchId = '682ae67a-1be7-4dcf-8ebe-b414b9e949df';
const current = () => ({ principalId, displayName: '配置维护', expiresAt: new Date(Date.now() + 600_000).toISOString() });
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('document', { cookie: '__Host-damage-maint-csrf=private-csrf; __Host-dv_csrf=player-csrf' }); });
afterEach(() => { setMaintenanceSession(null); setMaintenanceBatch(''); setMaintenanceCaptureOnly(false); setAuthSession(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('独立维护会话与候选保存', () => {
  it('只读查询恢复维护身份，不把它发布为玩家账号', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, init: RequestInit) => {
      expect(String(url)).toBe(`${api}/internal/maintenance/me`); expect(init.credentials).toBe('include');
      expect(new Headers(init.headers).get('X-CSRF-Token')).toBeNull(); return json(200, current());
    }));
    expect(await restoreMaintenanceSession(api)).toEqual(current()); expect(getAuthSession()).toBeNull();
  });
  it('玩家凭据不能被当作维护响应，长期维护凭据不能由网页请求头透传', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
      expect(new Headers(init.headers).get('X-Damage-Maintenance-Token')).toBeNull();
      return json(200, { accountId: principalId, username: 'player', canLogin: 1, expiresAt: current().expiresAt });
    }));
    await expect(restoreMaintenanceSession(api)).rejects.toMatchObject({ code: 'MAINTENANCE.RESPONSE_INVALID' });
    await requestJson(api, '/internal/maintenance/me', { authentication: 'maintenance', headers: { 'X-Damage-Maintenance-Token': 'do-not-send' } });
    expect(getMaintenanceSession()).toBeNull();
  });
  it('候选模式保留原始请求，不发送保存、不伪造保存成功', async () => {
    setMaintenanceSession(current());
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(requestJson(api, '/api/admin/games/lol/skills/q/configuration', { method: 'PATCH', body: '{"baseDigest":"old","changes":[]}' }))
      .rejects.toMatchObject({ code: 'MAINTENANCE.CANDIDATE_CAPTURED' });
    expect(fetch).not.toHaveBeenCalled();
    expect(getMaintenanceCandidate()).toEqual({ method: 'PATCH', path: '/api/admin/games/lol/skills/q/configuration', body: '{"baseDigest":"old","changes":[]}' });
  });
  it('已选择批次的正式请求只带维护防伪和当前批次，后端拒绝时不自动重试', async () => {
    setMaintenanceSession(current()); setMaintenanceBatch(batchId);
    const fetch = vi.fn(async (_url, init: RequestInit) => {
      const headers = new Headers(init.headers);
      expect(headers.get('X-CSRF-Token')).toBe('private-csrf'); expect(headers.get('X-Damage-Maintenance-Batch')).toBe(batchId);
      return json(409, { error: { code: 'MAINTENANCE.BATCH_MISMATCH', message: '请求不匹配' } });
    });
    vi.stubGlobal('fetch', fetch);
    await expect(requestJson(api, '/api/admin/games/lol/attributes/hp', { method: 'PUT', body: '{}' })).rejects.toMatchObject({ status: 409 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('维护授权签发使用独立入口和防伪，不读取玩家票据', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, init: RequestInit) => {
      expect(String(url)).toBe(`${api}/internal/maintenance/wasm-grant`); expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('private-csrf');
      return json(200, { grant: 'fixture', expiresAt: current().expiresAt });
    }));
    expect((await getMaintenanceWasmGrant(api)).grant).toBe('fixture');
  });
  it('身份切换后的迟到写响应不覆盖当前草稿，也不重发已经可能提交的请求', async () => {
    setMaintenanceSession(current()); setMaintenanceBatch(batchId);
    let finish!: (value: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetch);
    const pending = requestJson(api, '/api/admin/games/lol/attributes/hp', { method: 'PUT', body: '{}' });
    setMaintenanceSession({ ...current(), principalId: '530a455c-4241-45b9-a2e5-90023c80c737' });
    finish(json(200, { name: '已经提交的旧结果' }));
    await expect(pending).rejects.toMatchObject({ code: 'MAINTENANCE.SESSION_CHANGED' });
    expect(fetch).toHaveBeenCalledTimes(1); expect(getMaintenanceBatch()).toBeNull();
  });
  it('会话到期清除批次和候选并使计算订阅者失效', () => {
    const changed = vi.fn(); const stop = onMaintenanceSessionChanged(changed);
    setMaintenanceSession({ ...current(), expiresAt: new Date(Date.now() + 1000).toISOString() }); setMaintenanceBatch(batchId); changed.mockClear();
    vi.advanceTimersByTime(1000);
    expect(getMaintenanceSession()).toBeNull(); expect(getMaintenanceBatch()).toBeNull(); expect(getMaintenanceCandidate()).toBeNull(); expect(changed).toHaveBeenCalledTimes(1); stop();
  });
});
