import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEquipment,
  deleteEquipment,
  getEquipmentAttributes,
  listEquipment,
  updateEquipment,
  updateEquipmentAttributes
} from './equipmentClient';

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('equipmentClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses independent equipment routes and normalized keyword queries', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return jsonResponse(200, { items: [], total: 0 });
    }));

    await listEquipment('http://localhost:8080', 'demo', 'token', { keyword: '  长剑 /  ' });

    expect(calls[0]).toContain('/api/admin/games/demo/equipment?keyword=');
    expect(decodeURIComponent(calls[0])).toContain('keyword=长剑+/');
    expect(calls[0]).not.toContain('combat-data');
    expect(calls[0]).not.toContain('providers');
  });

  it('keeps basic fields and the direct attribute map in separate writes', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(input).endsWith('/attributes')) {
        return jsonResponse(200, { equipmentKey: 'long_sword', attributeValues: { hp: 100 } });
      }
      return jsonResponse(init?.method === 'POST' ? 201 : 200, {
        gameId: 'demo', equipmentKey: 'long_sword', name: '长剑', description: null,
        createdAt: 'now', updatedAt: 'now'
      });
    }));

    await createEquipment('http://localhost:8080', 'demo', 'token', {
      equipmentKey: 'long_sword', name: '长剑', description: null
    });
    await updateEquipment('http://localhost:8080', 'demo', 'long_sword', 'token', {
      name: '长剑改', description: null
    });
    await getEquipmentAttributes('http://localhost:8080', 'demo', 'long_sword', 'token');
    await updateEquipmentAttributes('http://localhost:8080', 'demo', 'long_sword', 'token', {
      attributeValues: { hp: 100 }
    });

    expect(calls[0].body).toEqual({ equipmentKey: 'long_sword', name: '长剑', description: null });
    expect(calls[1].body).toEqual({ name: '长剑改', description: null });
    expect(calls[3].body).toEqual({ attributeValues: { hp: 100 } });
  });

  it('hard deletes the equipment route and accepts 204', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8080/api/admin/games/demo/equipment/long_sword');
      expect(init?.method).toBe('DELETE');
      return jsonResponse(204);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await deleteEquipment('http://localhost:8080', 'demo', 'long_sword', 'token');
    expect(result.status).toBe(204);
    expect(result.data).toBeNull();
  });
});
