import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthSession } from './authState';
import { requestMaintenanceJson } from './maintenanceApiRequest';
import { getMaintenanceCandidate, getMaintenancePrincipal, getMaintenanceBatch, onMaintenancePrincipalChanged,
  setMaintenanceBatch, setMaintenancePrincipal } from './maintenanceState';
import { getMaintenanceWasmGrant, refreshMaintenancePrincipal } from './maintenanceClient';

const api = 'https://private.example';
const current = { principalId: 'e3e2a480-9bf4-49bb-a036-fef46b341da4', displayName: '配置维护' };
const other = { principalId: '530a455c-4241-45b9-a2e5-90023c80c737', displayName: '另一维护者' };
const batchId = '682ae67a-1be7-4dcf-8ebe-b414b9e949df';
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => vi.stubGlobal('window', { location: { origin: api } }));
afterEach(() => { setMaintenancePrincipal(null); vi.unstubAllGlobals(); });

function checkHeaders(init: RequestInit, client: string | null, batch: string | null = null) {
  expect(init).toMatchObject({ credentials: 'omit', mode: 'same-origin', redirect: 'error' });
  const headers = new Headers(init.headers);
  expect(headers.get('X-Damage-Client')).toBe(client);
  expect(headers.get('X-Damage-Maintenance-Batch')).toBe(batch);
  for (const header of ['Authorization', 'Cookie', 'X-CSRF-Token', 'Origin', 'Sec-Fetch-Site',
    'X-Damage-Maintenance-Token', 'X-Damage-Deployment-Token']) expect(headers.has(header)).toBe(false);
}

describe('私有维护主体与候选保存', () => {
  it('读取无有效期的维护主体，不建立玩家身份', async () => {
    const fetchMock = vi.fn(async (url, init: RequestInit) => {
      expect(String(url)).toBe(`${api}/internal/maintenance/me`);
      expect(init.cache).toBe('no-store');
      checkHeaders(init, null);
      return json(200, current);
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(Promise.all([refreshMaintenancePrincipal(api), refreshMaintenancePrincipal(api)])).resolves.toEqual([current, current]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAuthSession()).toBeNull();
  });

  it('拒绝玩家身份作为维护响应', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { accountId: current.principalId, username: 'player', canLogin: 1 })));
    await expect(refreshMaintenancePrincipal(api)).rejects.toMatchObject({ code: 'MAINTENANCE.RESPONSE_INVALID' });
    expect(getMaintenancePrincipal()).toBeNull();
  });

  it.each([
    ['/api/games', 'GET', undefined, null],
    ['/api/games/lol/images?updatedAfter=0', 'GET', undefined, null],
    ['/api/admin/games/lol/simulation-snapshot', 'POST', '{}', 'web'],
    ['/internal/maintenance/games/lol/simulation-preview', 'POST', '{}', 'web']
  ] as const)('私有读取和候选预检直接走同源连接器 %s', async (path, method, body, client) => {
    const fetchMock = vi.fn(async (url, init: RequestInit) => {
      expect(url).toBe(api + path);
      expect(init.method).toBe(method);
      checkHeaders(init, client);
      return json(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    await requestMaintenanceJson(api, path, { method, body });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('候选模式保留原始请求及正文，不自动提交', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const body = '{"baseDigest":"old", "changes": []}';
    const path = '/api/admin/games/lol/skills/q/configuration';
    await expect(requestMaintenanceJson(api, path, { method: 'PATCH', body })).rejects.toMatchObject({ code: 'MAINTENANCE.CANDIDATE_CAPTURED' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getMaintenanceCandidate()).toEqual({ method: 'PATCH', path, body });
  });

  it('正式请求带当前批次及客户端标记，不透传外部身份头，拒绝后不自动重试', async () => {
    setMaintenancePrincipal(current); setMaintenanceBatch(batchId);
    const fetchMock = vi.fn(async (_url, init: RequestInit) => {
      checkHeaders(init, 'web', batchId);
      expect(init.body).toBe('{"name": "新名称"}');
      return json(409, { error: { code: 'MAINTENANCE.BATCH_MISMATCH', message: '请求不匹配' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestMaintenanceJson(api, '/api/admin/games/lol/attributes/hp', {
      method: 'PUT', body: '{"name": "新名称"}',
      headers: { Authorization: 'ignored', Cookie: 'ignored', Origin: 'ignored', 'Sec-Fetch-Site': 'ignored',
        'X-CSRF-Token': 'ignored', 'X-Damage-Maintenance-Token': 'ignored', 'X-Damage-Deployment-Token': 'ignored',
        'X-Damage-Maintenance-Batch': 'ignored' }
    })).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('取票前重新核对入口身份，读取和取票均不依赖 Cookie', async () => {
    const fetchMock = vi.fn(async (url, init: RequestInit) => {
      if (url === `${api}/internal/maintenance/me`) {
        checkHeaders(init, null);
        return json(200, current);
      }
      expect(url).toBe(`${api}/internal/maintenance/wasm-grant`);
      expect(init.method).toBe('POST');
      checkHeaders(init, 'web');
      return json(200, { grant: 'fixture', expiresAt: '2099-01-01T00:00:00Z' });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect((await getMaintenanceWasmGrant(api)).grant).toBe('fixture');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('身份切换清理批次，旧写入结果需独立回读，且只发出一次', async () => {
    setMaintenancePrincipal(current); setMaintenanceBatch(batchId);
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetchMock);
    const pending = requestMaintenanceJson(api, '/api/admin/games/lol/attributes/hp', { method: 'PUT', body: '{}' });
    const changed = vi.fn();
    const stop = onMaintenancePrincipalChanged(changed);
    try {
      setMaintenancePrincipal({ ...current, displayName: '更名' });
      expect(getMaintenanceBatch()).toBe(batchId);
      expect(changed).not.toHaveBeenCalled();
      setMaintenancePrincipal(other);
      finish(json(200, { name: '已提交的旧结果' }));
      await expect(pending).rejects.toMatchObject({ code: 'MAINTENANCE.PRINCIPAL_CHANGED' });
      expect(getMaintenanceBatch()).toBeNull();
      expect(getMaintenanceCandidate()).toBeNull();
      expect(changed).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });

  it.each([
    ['https://private.example.other', '/internal/maintenance/me'],
    ['http://private.example', '/internal/maintenance/me'],
    ['https://private.example:8443', '/internal/maintenance/me'],
    [api, '//other.example/internal/maintenance/me'],
    [api, '/api/auth/me']
  ])('拒绝不受维护端信任的目标 %s %s', async (base, path) => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(requestMaintenanceJson(base, path)).rejects.toBeInstanceOf(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
