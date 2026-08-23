import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCharacter,
  deleteCharacter,
  getCharacterAttributes,
  getLevelConfig,
  listCharacters,
  updateCharacter,
  updateCharacterAttributes,
  updateLevelConfig
} from './characterClient';

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('characterClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the independent level and character routes', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (String(input).endsWith('/level-config')) {
        return jsonResponse(200, { gameId: 'demo', minLevel: 1, maxLevel: 18 });
      }
      return jsonResponse(200, { items: [], total: 0 });
    }));

    await getLevelConfig('http://localhost:8080', 'demo', 'token');
    await listCharacters('http://localhost:8080', 'demo', 'token', { keyword: '  寒冰 /  ' });

    expect(calls[0]).toBe('GET http://localhost:8080/api/admin/games/demo/level-config');
    expect(calls[1]).toContain('/api/admin/games/demo/characters?keyword=');
    expect(decodeURIComponent(calls[1])).toContain('keyword=寒冰+/');
    expect(calls.join(' ')).not.toContain('combat-data');
    expect(calls.join(' ')).not.toContain('providers');
  });

  it('creates and updates only character basic fields', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse(init?.method === 'POST' ? 201 : 200, {
        gameId: 'demo', characterKey: 'ashe', name: '艾希', description: null,
        createdAt: 'now', updatedAt: 'now'
      });
    }));

    await createCharacter('http://localhost:8080', 'demo', 'token', {
      characterKey: 'ashe', name: '艾希', description: null
    });
    await updateCharacter('http://localhost:8080', 'demo', 'ashe', 'token', {
      name: '寒冰射手', description: null
    });

    expect(bodies).toEqual([
      { characterKey: 'ashe', name: '艾希', description: null },
      { name: '寒冰射手', description: null }
    ]);
    expect(bodies[1]).not.toHaveProperty('characterKey');
    expect(bodies[1]).not.toHaveProperty('levelValues');
  });

  it('updates the game level range through the standalone configuration route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8080/api/admin/games/demo/level-config');
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(String(init?.body))).toEqual({ minLevel: 1, maxLevel: 20 });
      return jsonResponse(200, { gameId: 'demo', minLevel: 1, maxLevel: 20 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await updateLevelConfig(
      'http://localhost:8080',
      'demo',
      'token',
      { minLevel: 1, maxLevel: 20 }
    );

    expect(result.data.maxLevel).toBe(20);
  });

  it('gets and replaces one complete levelValues map', async () => {
    const levelValues = { '1': { hp: 580 }, '2': { hp: 610 } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8080/api/admin/games/demo/characters/ashe/attributes');
      if (init?.method === 'PUT') {
        expect(JSON.parse(String(init.body))).toEqual({ levelValues });
      }
      return jsonResponse(200, { characterKey: 'ashe', minLevel: 1, maxLevel: 2, levelValues });
    });
    vi.stubGlobal('fetch', fetchMock);

    await getCharacterAttributes('http://localhost:8080', 'demo', 'ashe', 'token');
    await updateCharacterAttributes('http://localhost:8080', 'demo', 'ashe', 'token', { levelValues });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('hard deletes the character route and accepts a 204 body', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:8080/api/admin/games/demo/characters/ashe');
      expect(init?.method).toBe('DELETE');
      return jsonResponse(204);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await deleteCharacter('http://localhost:8080', 'demo', 'ashe', 'token');

    expect(result.status).toBe(204);
    expect(result.data).toBeNull();
  });
});
