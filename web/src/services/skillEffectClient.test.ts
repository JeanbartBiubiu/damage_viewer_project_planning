import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSkillEffect,
  deleteSkillEffect,
  getSkillEffect,
  listSkillEffects,
  updateSkillEffect
} from './skillEffectClient';
import type {
  CreateSkillEffectRequest,
  SkillEffect,
  SkillEffectSummary,
  UpdateSkillEffectRequest
} from '../types/skillEffect';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const damageResult = {
  resultKey: 'damage',
  name: '造成物理伤害',
  resultType: 'DAMAGE' as const,
  target: 'TARGET' as const,
  description: null,
  sortOrder: 10,
  valueRule: {
    formulaKey: 'damage',
    fixedMultiplier: 1,
    fixedMinValue: null,
    fixedMaxValue: null
  },
  detail: { damageTypeKey: 'physical' }
};

const summary: SkillEffectSummary = {
  gameId: 'demo',
  skillKey: 'ezreal_q',
  effectKey: 'on_hit_results',
  name: '命中结果',
  description: null,
  sortOrder: 10,
  resultCount: 1,
  createdAt: '2026-08-27T00:00:00Z',
  updatedAt: '2026-08-27T00:00:00Z'
};

const detail: SkillEffect = {
  ...summary,
  results: [damageResult]
};

const createBody: CreateSkillEffectRequest = {
  effectKey: 'on_hit_results',
  name: '命中结果',
  description: null,
  sortOrder: 10,
  results: [damageResult]
};

const updateBody: UpdateSkillEffectRequest = {
  name: '命中结果',
  description: null,
  sortOrder: 11,
  results: [damageResult]
};

describe('skillEffectClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encodes game, skill and effect path segments with admin token', async () => {
    const listMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo%20arena/skills/active%2Fq/effects'
      );
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(200, [summary]);
    });
    vi.stubGlobal('fetch', listMock);
    const listed = await listSkillEffects(
      'http://localhost:8080/',
      'demo arena',
      'active/q',
      'token'
    );
    expect(listed.status).toBe(200);
    expect(listed.data[0]).not.toHaveProperty('results');
    expect(listed.data[0]?.resultCount).toBe(1);

    const detailMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo/skills/ezreal_q/effects/on%2Fhit'
      );
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(200, detail);
    });
    vi.stubGlobal('fetch', detailMock);
    const loaded = await getSkillEffect(
      'http://localhost:8080',
      'demo',
      'ezreal_q',
      'on/hit',
      'token'
    );
    expect(loaded.data.results).toEqual([damageResult]);
  });

  it('sends POST, PUT without effectKey, and DELETE with expected statuses', async () => {
    const calls: Array<{ method: string; url: string; status: number; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const status = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;
      calls.push({
        method,
        url: String(input),
        status,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(status, method === 'DELETE' ? null : detail);
    });
    vi.stubGlobal('fetch', fetchMock);

    const created = await createSkillEffect(
      'http://localhost:8080',
      'demo arena',
      'active/q',
      'token',
      createBody
    );
    const updated = await updateSkillEffect(
      'http://localhost:8080',
      'demo',
      'ezreal_q',
      'on/hit',
      'token',
      updateBody
    );
    const deleted = await deleteSkillEffect(
      'http://localhost:8080',
      'demo',
      'ezreal_q',
      'on/hit',
      'token'
    );

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(deleted.status).toBe(204);
    expect(calls.map((call) => call.method)).toEqual(['POST', 'PUT', 'DELETE']);
    expect(calls[0]?.url).toBe(
      'http://localhost:8080/api/admin/games/demo%20arena/skills/active%2Fq/effects'
    );
    expect(calls[1]?.url).toBe(
      'http://localhost:8080/api/admin/games/demo/skills/ezreal_q/effects/on%2Fhit'
    );
    expect(calls[2]?.url).toBe(
      'http://localhost:8080/api/admin/games/demo/skills/ezreal_q/effects/on%2Fhit'
    );
    expect(calls[0]?.body).toEqual(createBody);
    expect(calls[0]?.body).toMatchObject({ effectKey: 'on_hit_results' });
    expect(calls[1]?.body).toEqual(updateBody);
    expect(calls[1]?.body).not.toHaveProperty('effectKey');
    expect(calls[2]?.body).toBeNull();
  });
});
