import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSkillEffect,
  deleteSkillEffect,
  getSkillEffect,
  listSkillEffects,
  parseSkillEffect,
  SkillEffectProtocolError,
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
  lifecycleBehavior: null,
  valueRule: {
    formulaKey: 'damage',
    fixedMultiplier: 1,
    fixedMinValue: null,
    fixedMaxValue: null
  },
  detail: {
    damageTypeKey: 'physical',
    deliveryKind: 'SKILL',
    originKind: 'DIRECT',
    critical: { mode: 'DISALLOWED', multiplierFormulaKey: null },
    vampRules: []
  }
};

const summary: SkillEffectSummary = {
  gameId: 'demo',
  skillKey: 'ezreal_q',
  effectKey: 'on_hit_results',
  name: '命中结果',
  description: null,
  sortOrder: 10,
  resultCount: 1,
  lifecycleEnabled: false,
  createdAt: '2026-08-27T00:00:00Z',
  updatedAt: '2026-08-27T00:00:00Z'
};

const detail: SkillEffect = {
  ...summary,
  lifecycle: null,
  results: [damageResult]
};

const createBody: CreateSkillEffectRequest = {
  effectKey: 'on_hit_results',
  name: '命中结果',
  description: null,
  sortOrder: 10,
  lifecycle: null,
  results: [damageResult]
};

const updateBody: UpdateSkillEffectRequest = {
  name: '命中结果',
  description: null,
  sortOrder: 11,
  lifecycle: null,
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
    expect(listed.data[0]?.lifecycleEnabled).toBe(false);

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

  it('passes through lifecycleEnabled, lifecycle and lifecycle operation results', async () => {
    const lifecycleDetail: SkillEffect = {
      gameId: 'demo',
      skillKey: 'ezreal_q',
      effectKey: 'toxic_trap',
      name: '剧毒陷阱',
      description: null,
      sortOrder: 10,
      createdAt: '2026-08-28T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
      lifecycle: {
        durationFormulaKey: 'poison_duration_ms',
        maxStacksFormulaKey: 'one',
        applicationStacksFormulaKey: 'one',
        instanceScope: 'SOURCE_TARGET',
        reapplicationStackMode: 'KEEP',
        reapplicationDurationMode: 'REFRESH_ALL',
        expiryMode: 'ALL_AT_ONCE',
        periodicIntervalFormulaKey: 'poison_tick_interval_ms',
        firstPeriodicExecution: 'AFTER_INTERVAL'
      },
      results: [
        {
          resultKey: 'poison_tick',
          name: '周期伤害',
          resultType: 'DAMAGE',
          target: 'TARGET',
          description: null,
          sortOrder: 10,
          lifecycleBehavior: {
            moment: 'PERIODIC',
            valueReadMode: 'MOMENT_EVALUATION',
            stackValueMode: null,
            reapplicationValueMode: null,
            periodicExecutionMode: 'ONCE_PER_INSTANCE'
          },
          valueRule: {
            formulaKey: 'damage',
            fixedMultiplier: 1,
            fixedMinValue: null,
            fixedMaxValue: null
          },
          detail: {
            damageTypeKey: 'physical',
            deliveryKind: 'SKILL',
            originKind: 'DIRECT',
            critical: { mode: 'DISALLOWED', multiplierFormulaKey: null },
            vampRules: []
          }
        },
        {
          resultKey: 'consume_focus',
          name: '消耗专注',
          resultType: 'LIFECYCLE_OPERATION',
          target: 'TARGET',
          description: null,
          sortOrder: 20,
          lifecycleBehavior: null,
          valueRule: {
            formulaKey: 'damage',
            fixedMultiplier: 1,
            fixedMinValue: null,
            fixedMaxValue: null
          },
          detail: { targetEffectKey: 'focus_mark', operation: 'CONSUME' }
        }
      ]
    };
    const createLifecycleBody: CreateSkillEffectRequest = {
      effectKey: 'toxic_trap',
      name: '剧毒陷阱',
      description: null,
      sortOrder: 10,
      lifecycle: lifecycleDetail.lifecycle,
      results: lifecycleDetail.results
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET' && String(input).endsWith('/effects')) {
        return jsonResponse(200, [{
          gameId: 'demo',
          skillKey: 'ezreal_q',
          effectKey: 'toxic_trap',
          name: '剧毒陷阱',
          description: null,
          sortOrder: 10,
          resultCount: 2,
          lifecycleEnabled: true,
          createdAt: '2026-08-28T00:00:00Z',
          updatedAt: '2026-08-28T00:00:00Z'
        }]);
      }
      return jsonResponse(method === 'POST' ? 201 : 200, lifecycleDetail);
    });
    vi.stubGlobal('fetch', fetchMock);

    const listed = await listSkillEffects('http://localhost:8080', 'demo', 'ezreal_q', 'token');
    expect(listed.data[0]?.lifecycleEnabled).toBe(true);

    const created = await createSkillEffect(
      'http://localhost:8080',
      'demo',
      'ezreal_q',
      'token',
      createLifecycleBody
    );
    expect(created.data.lifecycle).toEqual(lifecycleDetail.lifecycle);
    expect(created.data.results[1]).toMatchObject({
      resultType: 'LIFECYCLE_OPERATION',
      detail: { targetEffectKey: 'focus_mark', operation: 'CONSUME' }
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual(createLifecycleBody);
  });

  it('rejects migrated damage and shield responses when required detail fields are missing', () => {
    expect(() => parseSkillEffect({
      ...detail,
      results: [{ ...damageResult, detail: { damageTypeKey: 'physical' } }]
    })).toThrow(SkillEffectProtocolError);

    expect(() => parseSkillEffect({
      ...detail,
      results: [{
        ...damageResult,
        resultType: 'NORMAL_SHIELD',
        detail: { absorbedDamageTypeKey: null }
      }]
    })).toThrow(/effect\.results\[0\]\.detail\.decayMode/);
  });
});
