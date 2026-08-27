import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSkillParameter,
  deleteSkillParameter,
  getSkillParameter,
  listSkillParameters,
  updateSkillParameter
} from './skillParameterClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('skillParameterClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encodes game, skill and parameter path segments with auth', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo%20arena/skills/active%2Fq/parameters'
      );
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      return jsonResponse(200, []);
    });
    vi.stubGlobal('fetch', fetchMock);
    await listSkillParameters('http://localhost:8080/', 'demo arena', 'active/q', 'token');

    const detailMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo/skills/ezreal_q/parameters/base%2Fdamage'
      );
      return jsonResponse(200, {});
    });
    vi.stubGlobal('fetch', detailMock);
    await getSkillParameter('http://localhost:8080', 'demo', 'ezreal_q', 'base/damage', 'token');
  });

  it('sends four value-mode bodies and omits parameterKey on PUT', async () => {
    const calls: Array<{ method: string; status: number; body: unknown }> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const status = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;
      calls.push({
        method,
        status,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      return jsonResponse(status, method === 'DELETE' ? null : {});
    });
    vi.stubGlobal('fetch', fetchMock);

    await createSkillParameter('http://localhost:8080', 'demo', 'ezreal_q', 'token', {
      parameterKey: 'total_ad_ratio',
      name: '总攻击力系数',
      valueType: 'DECIMAL',
      valueMode: 'FIXED',
      fixedValue: 1.3,
      levelValues: null,
      description: null,
      sortOrder: 20
    });
    await createSkillParameter('http://localhost:8080', 'demo', 'ezreal_q', 'token', {
      parameterKey: 'base_damage',
      name: '基础伤害',
      valueType: 'DECIMAL',
      valueMode: 'SKILL_LEVEL',
      fixedValue: null,
      levelValues: { '1': 20, '2': 45 },
      description: null,
      sortOrder: 10
    });
    await createSkillParameter('http://localhost:8080', 'demo', 'ezreal_q', 'token', {
      parameterKey: 'level_scaling',
      name: '角色等级缩放',
      valueType: 'INTEGER',
      valueMode: 'CHARACTER_LEVEL',
      fixedValue: null,
      levelValues: { '1': 0, '2': 1 },
      description: null,
      sortOrder: 30
    });
    await createSkillParameter('http://localhost:8080', 'demo', 'ezreal_q', 'token', {
      parameterKey: 'current_stacks',
      name: '当前层数',
      valueType: 'INTEGER',
      valueMode: 'RUNTIME_INPUT',
      fixedValue: null,
      levelValues: null,
      description: null,
      sortOrder: 40
    });
    await updateSkillParameter(
      'http://localhost:8080',
      'demo',
      'ezreal_q',
      'total_ad_ratio',
      'token',
      {
        name: '总攻击力系数',
        valueType: 'DECIMAL',
        valueMode: 'FIXED',
        fixedValue: 1.4,
        levelValues: null,
        description: null,
        sortOrder: 21
      }
    );
    await deleteSkillParameter(
      'http://localhost:8080',
      'demo',
      'ezreal_q',
      'total_ad_ratio',
      'token'
    );

    expect(calls.map((call) => call.method)).toEqual([
      'POST',
      'POST',
      'POST',
      'POST',
      'PUT',
      'DELETE'
    ]);
    expect(calls[0]?.body).toMatchObject({
      parameterKey: 'total_ad_ratio',
      valueMode: 'FIXED',
      fixedValue: 1.3,
      levelValues: null
    });
    expect(calls[1]?.body).toMatchObject({
      valueMode: 'SKILL_LEVEL',
      fixedValue: null,
      levelValues: { '1': 20, '2': 45 }
    });
    expect(calls[2]?.body).toMatchObject({
      valueMode: 'CHARACTER_LEVEL',
      fixedValue: null,
      levelValues: { '1': 0, '2': 1 }
    });
    expect(calls[3]?.body).toMatchObject({
      valueMode: 'RUNTIME_INPUT',
      fixedValue: null,
      levelValues: null
    });
    expect(calls[4]?.body).not.toHaveProperty('parameterKey');
    expect(calls[4]?.body).toMatchObject({ fixedValue: 1.4, levelValues: null });
    expect(calls[5]?.body).toBeNull();
  });
});
