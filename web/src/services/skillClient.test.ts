import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSkill, deleteSkill, getSkill, listSkills, updateSkill } from './skillClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('skillClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encodes game and normalized list query with auth', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/admin/games/demo%20arena/skills');
      expect(url.searchParams.get('keyword')).toBe('火球/+');
      expect(url.searchParams.get('status')).toBe('DISABLED');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(200, { items: [], total: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await listSkills('http://localhost:8080/', 'demo arena', 'token', {
      keyword: ' 火球/+ ',
      status: 'DISABLED'
    });

    const emptyQueryMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/admin/games/demo/skills');
      expect(url.search).toBe('');
      return jsonResponse(200, { items: [], total: 0 });
    });
    vi.stubGlobal('fetch', emptyQueryMock);

    await listSkills('http://localhost:8080', 'demo', 'token', { keyword: '   ' });
    expect(emptyQueryMock).toHaveBeenCalledOnce();
  });

  it('uses the independent detail path', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://localhost:8080/api/admin/games/demo/skills/active%2Fcontrol');
      return jsonResponse(200, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    await getSkill('http://localhost:8080', 'demo', 'active/control', 'token');
  });

  it('sends POST body, full PUT category array without skillKey, and DELETE', async () => {
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

    await createSkill('http://localhost:8080', 'demo', 'token', {
      skillKey: 'fireball',
      name: '火球',
      description: null,
      maxLevel: 4,
      status: 'ENABLED',
      sortOrder: 10,
      skillCategoryKeys: ['active', 'damage']
    });
    await updateSkill('http://localhost:8080', 'demo', 'fireball', 'token', {
      name: '火球',
      description: null,
      maxLevel: 5,
      status: 'DISABLED',
      sortOrder: 20,
      skillCategoryKeys: ['active', 'disabled-cat']
    });
    await deleteSkill('http://localhost:8080', 'demo', 'fireball', 'token');

    expect(calls.map((call) => call.method)).toEqual(['POST', 'PUT', 'DELETE']);
    expect(calls[0]?.body).toEqual({
      skillKey: 'fireball',
      name: '火球',
      description: null,
      maxLevel: 4,
      status: 'ENABLED',
      sortOrder: 10,
      skillCategoryKeys: ['active', 'damage']
    });
    expect(calls[1]?.body).toEqual({
      name: '火球',
      description: null,
      maxLevel: 5,
      status: 'DISABLED',
      sortOrder: 20,
      skillCategoryKeys: ['active', 'disabled-cat']
    });
    expect(calls[1]?.body).not.toHaveProperty('skillKey');
    expect(calls[2]?.body).toBeNull();
  });
});
