import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = 'https://damage.example';
const ID = '7f4fc9bb-348e-4f59-9c68-708432d99311';
const OTHER_ID = 'c4b34974-f49a-42a4-bfd6-dfe5440d10d4';
const KEY = 'damage-viewer.visitor-id';
let saved: Map<string, string>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T00:00:00Z'));
  vi.resetModules();
  saved = new Map();
  vi.stubGlobal('window', { location: { origin: API }, localStorage: {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { saved.set(key, value); })
  } });
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => ID) });
  vi.stubGlobal('document', { cookie: '__Host-dv_csrf=fixture-session-csrf' });
});
afterEach(async () => {
  const { setAuthSession } = await import('./authState');
  setAuthSession(null);
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});

describe('访问统计', () => {
  it('首次生成编号并跨整页加载复用存储中的编号', async () => {
    const first = await import('./visitStatisticsClient');
    expect(first.getVisitorId()).toBe(ID);
    expect(saved.get(KEY)).toBe(ID);
    vi.resetModules();
    expect((await import('./visitStatisticsClient')).getVisitorId()).toBe(ID);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('复用已有标准UUID，替换无效编号', async () => {
    saved.set(KEY, OTHER_ID);
    expect((await import('./visitStatisticsClient')).getVisitorId()).toBe(OTHER_ID);
    expect(crypto.randomUUID).not.toHaveBeenCalled();
    vi.resetModules(); saved.set(KEY, 'invalid-visitor');
    expect((await import('./visitStatisticsClient')).getVisitorId()).toBe(ID);
    expect(saved.get(KEY)).toBe(ID);
  });

  it('存储读写均被禁用时在当前页面稳定复用内存编号', async () => {
    vi.stubGlobal('window', { location: { origin: API }, get localStorage() { throw new Error('storage denied'); } });
    const { getVisitorId } = await import('./visitStatisticsClient');
    expect(getVisitorId()).toBe(ID); expect(getVisitorId()).toBe(ID);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('匿名上报不携带账号凭据，使用现有基址与客户端标记', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init: RequestInit) => {
      expect(String(url)).toBe(`${API}/api/visits`);
      expect(init.credentials).toBe('omit'); expect(init.method).toBe('POST'); expect(init.cache).toBe('no-store');
      const headers = new Headers(init.headers);
      expect(headers.get('X-Damage-Client')).toBe('web'); expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('Cookie')).toBeNull(); expect(headers.get('Authorization')).toBeNull(); expect(headers.get('X-CSRF-Token')).toBeNull();
      expect(JSON.parse(String(init.body))).toEqual({ visitorId: ID });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await (await import('./visitStatisticsClient')).recordPageVisit(`${API}/`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['network', '401', '503'])('上报失败%s静默结束、不重试、不改变登录状态', async failure => {
    const { setAuthSession, getAuthSession, onLoginRequired } = await import('./authState');
    const session = { accountId: 'fixture', username: 'fixture', canLogin: 1 as const, canEdit: true, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    setAuthSession(session); const prompt = vi.fn(); const stop = onLoginRequired(prompt);
    const fetchMock = vi.fn(async () => {
      if (failure === 'network') throw new Error('network failure');
      return new Response(JSON.stringify({ error: { code: 'fixture', message: 'fixture' } }), { status: Number(failure) });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect((await import('./visitStatisticsClient')).recordPageVisit(API)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(prompt).not.toHaveBeenCalled(); expect(getAuthSession()).toBe(session);
    stop();
  });

  it('统计查询明确携带正式会话并传递取消信号，日期原样返回', async () => {
    const controller = new AbortController();
    const days = [{ date: '2026-11-05', pv: 7, uv: 3 }];
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init: RequestInit) => {
      expect(String(url)).toBe(`${API}/api/admin/visits/last30days`);
      expect(init.credentials).toBe('include'); expect(init.cache).toBe('no-store'); expect(init.signal).toBe(controller.signal);
      expect(new Headers(init.headers).get('X-CSRF-Token')).toBeNull();
      return new Response(JSON.stringify(days), { status: 200 });
    }));
    expect(await (await import('./visitStatisticsClient')).listVisitStatistics(API, controller.signal)).toEqual(days);
  });
});
