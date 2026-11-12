import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../config/deployment', () => ({ DEPLOYMENT_MODE: 'maintenance' }));
import { requestJson } from './apiClient';
import { setMaintenanceSession } from './maintenanceState';

afterEach(() => { setMaintenanceSession(null); vi.unstubAllGlobals(); });
describe('私有维护窗口内的只读回查', () => {
  it.each([
    { path: '/api/games', method: 'GET', body: undefined },
    { path: '/api/admin/games/lol/simulation-snapshot', method: 'POST', body: '{}' }
  ])('有效维护会话可以继续读取 $path，其他正常读取保持匿名', async input => {
    setMaintenanceSession({ principalId: '0f053196-ddbb-4e83-9a77-818c51b21268', displayName: '维护', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      return calls.length === 1 ? new Response(JSON.stringify({ error: { code: 'MAINTENANCE.WINDOW_OPEN', message: '维护中' } }), { status: 503 })
        : new Response('{}', { status: 200 });
    }));
    await requestJson('https://maintenance.example', input.path, { method: input.method, body: input.body });
    expect(calls).toHaveLength(2); expect(calls[0].credentials).toBe('omit'); expect(calls[1].credentials).toBe('include');
    expect(calls[1].body).toBe(input.body); expect(calls[1].method).toBe(input.method);
  });
  it('没有维护会话或普通503时不重试', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'MAINTENANCE.WINDOW_OPEN', message: '维护中' } }), { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(requestJson('https://maintenance.example', '/api/games')).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
