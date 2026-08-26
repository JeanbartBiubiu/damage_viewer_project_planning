import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDamageType,
  deleteDamageType,
  getDamageType,
  listDamageTypes,
  updateDamageType
} from './damageTypeClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('damageTypeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encodes game, key and normalized list query', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/admin/games/demo%20arena/damage-types');
      expect(url.searchParams.get('keyword')).toBe('物理/+');
      expect(url.searchParams.get('status')).toBe('ENABLED');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(200, { items: [], total: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await listDamageTypes('http://localhost:8080/', 'demo arena', 'token', {
      keyword: ' 物理/+ ',
      status: 'ENABLED'
    });
  });

  it('uses the independent detail path', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo/damage-types/physical%2Fbonus'
      );
      return jsonResponse(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    await getDamageType('http://localhost:8080', 'demo', 'physical/bonus', 'token');
  });

  it('sends POST, full PUT without the stable key, and DELETE', async () => {
    const calls: Array<{ method: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      if (init?.method === 'DELETE') return jsonResponse(204, null);
      return jsonResponse(init?.method === 'POST' ? 201 : 200, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    await createDamageType('http://localhost:8080', 'demo', 'token', {
      damageTypeKey: 'physical', name: '物理伤害', description: null, status: 'ENABLED', sortOrder: 10
    });
    await updateDamageType('http://localhost:8080', 'demo', 'physical', 'token', {
      name: '物理伤害', description: null, status: 'DISABLED', sortOrder: 20
    });
    await deleteDamageType('http://localhost:8080', 'demo', 'physical', 'token');

    expect(calls.map((call) => call.method)).toEqual(['POST', 'PUT', 'DELETE']);
    expect(calls[1]?.body).not.toHaveProperty('damageTypeKey');
  });
});
