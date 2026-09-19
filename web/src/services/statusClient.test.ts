import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStatus,
  deleteStatus,
  getStatus,
  listStatuses,
  parseStatus,
  updateStatus
} from './statusClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('statusClient', () => {
  it.each([undefined, null, 'UNKNOWN', 'stun'])('拒绝缺失或未知状态种类 %s', (statusKind) => {
    expect(() => parseStatus({ statusKey: 'slow', statusKind })).toThrow('状态种类');
  });

  it.each(['STUN', 'MOVEMENT_SLOW', 'ROOT', 'SILENCE'])('列表和详情保留显式种类 %s', async (statusKind) => {
    const row = { statusKey: 'arbitrary_key', statusKind, status: 'DISABLED' };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => jsonResponse(200,
      String(input).endsWith('/statuses') ? { items: [row], total: 1 } : row)));
    expect((await listStatuses('http://localhost:8080', 'demo', 'token')).data.items[0]).toEqual(row);
    expect((await getStatus('http://localhost:8080', 'demo', 'arbitrary_key', 'token')).data).toEqual(row);
  });

  it('整个状态目录拒绝无种类条目，不返回部分或默认眩晕', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { items: [{ statusKey: 'stun' }], total: 1 })));
    await expect(listStatuses('http://localhost:8080', 'demo', 'token')).rejects.toThrow('状态种类');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encodes game, key and normalized list query', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/admin/games/demo%20arena/statuses');
      expect(url.searchParams.get('keyword')).toBe('眩晕/+');
      expect(url.searchParams.get('status')).toBe('DISABLED');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(200, { items: [], total: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await listStatuses('http://localhost:8080/', 'demo arena', 'token', {
      keyword: ' 眩晕/+ ',
      status: 'DISABLED'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('omits blank keyword and unselected status from the list query', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/admin/games/demo/statuses');
      expect(url.search).toBe('');
      return jsonResponse(200, { items: [], total: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await listStatuses('http://localhost:8080', 'demo', 'token', {
      keyword: '   ',
      status: undefined
    });
  });

  it('uses the independent detail path', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo/statuses/stun%2Fcontrol'
      );
      return jsonResponse(200, { statusKind: 'STUN' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await getStatus('http://localhost:8080', 'demo', 'stun/control', 'token');
  });

  it('sends POST, full PUT without the stable key, and DELETE', async () => {
    const calls: Array<{ method: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      if (init?.method === 'DELETE') return jsonResponse(204, null);
      return jsonResponse(init?.method === 'POST' ? 201 : 200, { statusKind: 'STUN' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await createStatus('http://localhost:8080', 'demo', 'token', {
      statusKey: 'stun',
      statusKind: 'STUN',
      name: '眩晕',
      description: null,
      status: 'ENABLED',
      sortOrder: 10
    });
    await updateStatus('http://localhost:8080', 'demo', 'stun', 'token', {
      statusKind: 'STUN',
      name: '眩晕',
      description: null,
      status: 'DISABLED',
      sortOrder: 20
    });
    await deleteStatus('http://localhost:8080', 'demo', 'stun', 'token');

    expect(calls.map((call) => call.method)).toEqual(['POST', 'PUT', 'DELETE']);
    expect(calls[0]?.body).toEqual({
      statusKey: 'stun',
      statusKind: 'STUN',
      name: '眩晕',
      description: null,
      status: 'ENABLED',
      sortOrder: 10
    });
    expect(calls[1]?.body).toEqual({
      statusKind: 'STUN',
      name: '眩晕',
      description: null,
      status: 'DISABLED',
      sortOrder: 20
    });
    expect(calls[1]?.body).not.toHaveProperty('statusKey');
  });
});
