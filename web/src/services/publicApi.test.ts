import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../config/deployment', () => ({ DEPLOYMENT_MODE: 'viewer' }));
import { requestJson } from './apiClient';

afterEach(() => { vi.unstubAllGlobals(); });
describe('公共产物请求边界', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('配置写入%s在发出请求前拒绝', async method => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(requestJson('https://viewer.example', '/api/admin/games/lol/skills/q/configuration', { method, body: '{}' }))
      .rejects.toMatchObject({ code: 'PUBLIC.CONFIGURATION_READ_ONLY', status: 403 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('只读快照POST保留匿名查询语义', async () => {
    const fetch = vi.fn(async (_url, init: RequestInit) => {
      expect(init.credentials).toBe('omit'); expect(new Headers(init.headers).get('X-Damage-Maintenance-Batch')).toBeNull();
      return new Response('{}', { status: 200 });
    }); vi.stubGlobal('fetch', fetch);
    await requestJson('https://viewer.example', '/api/admin/games/lol/simulation-snapshot', { method: 'POST', body: '{}' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('不因路径包含simulation-snapshot就放行其他方法或嵌套写路径', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const path of ['/api/admin/games/lol/simulation-snapshot', '/api/admin/games/lol/skills/q/simulation-snapshot']) {
      await expect(requestJson('https://viewer.example', path, { method: 'PATCH', body: '{}' })).rejects.toMatchObject({ code: 'PUBLIC.CONFIGURATION_READ_ONLY' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
