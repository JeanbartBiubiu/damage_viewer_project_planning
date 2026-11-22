import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it.each([
    ['https://viewer.example.attacker.invalid', '/api/auth/me'],
    ['https://viewer.example:444', '/api/auth/me'],
    ['https://viewer.example', '//other.example/api/auth/me'],
    ['https://viewer.example', '/internal/maintenance/me']
  ])('公共会话请求拒绝异源和内部接口 %s %s', async (base, path) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { origin: 'https://viewer.example' } });
    await expect(requestJson(base, path, { authentication: 'session' })).rejects.toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
