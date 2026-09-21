import { formulaValue } from '../types/numericValue';
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
  spellShieldBlockScope: null,
  lifecycleBehavior: null,
  valueRule: {
    value: formulaValue("damage"),
    fixedMultiplier: 1,
    fixedMinValue: null,
    fixedMaxValue: null
  },
  detail: {
    damageTypeKey: 'physical',
    deliveryKind: 'SKILL',
    originKind: 'DIRECT',
    critical: { mode: 'DISALLOWED', multiplierValue: null },
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

const persistentStatusLifecycleBehavior = {
  moment: 'PERSISTENT' as const,
  valueReadMode: null,
  stackValueMode: null,
  reapplicationValueMode: null,
  periodicExecutionMode: null
};

const persistentStatusLifecycle = {
  durationValue: formulaValue('stun_duration_ms'),
  maxStacksValue: formulaValue('one'),
  applicationStacksValue: formulaValue('one'),
  instanceScope: 'SOURCE_TARGET' as const,
  reapplicationStackMode: 'KEEP' as const,
  reapplicationDurationMode: 'REFRESH_ALL' as const,
  expiryMode: 'ALL_AT_ONCE' as const,
  periodicIntervalValue: null,
  firstPeriodicExecution: null
};

const persistentStatusResult = {
  ...damageResult,
  resultKey: 'stun',
  name: '事件视界眩晕',
  resultType: 'STATUS_OPERATION' as const,
  spellShieldBlockScope: 'RESULT' as const,
  lifecycleBehavior: persistentStatusLifecycleBehavior,
  valueRule: null,
  detail: { statusKey: 'vertigo', operation: 'APPLY' as const }
};

const persistentStatusSummary: SkillEffectSummary = {
  ...summary,
  skillKey: 'veigar_e',
  effectKey: 'event_horizon_stun',
  name: '碰到牢笼边缘眩晕',
  resultCount: 1,
  lifecycleEnabled: true
};

const persistentStatusDetail: SkillEffect = {
  ...persistentStatusSummary,
  lifecycle: persistentStatusLifecycle,
  results: [persistentStatusResult]
};

describe('仅记录生命周期的效果响应', () => {
  it('保留合法空结果数组与生命周期，不生成结果占位项', () => {
    const marker = { ...persistentStatusDetail, results: [] };
    expect(parseSkillEffect(marker)).toEqual(marker);
    expect(() => parseSkillEffect({ ...marker, results: null })).toThrow(SkillEffectProtocolError);
    const { results: _results, ...missingResults } = marker;
    expect(() => parseSkillEffect(missingResults)).toThrow(SkillEffectProtocolError);
  });
});

describe('普通减速响应解析', () => {
  function slowEffect(): SkillEffect {
    return { ...structuredClone(persistentStatusDetail), results: [{ ...structuredClone(persistentStatusResult),
      valueRule: { value: { kind: 'FIXED', value: 0.3 }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: 1 },
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
        reapplicationValueMode: 'REPLACE', periodicExecutionMode: null }
    }] };
  }

  it('读回普通减速的固定值、参数和公式规则，详情不扩充状态身份', () => {
    for (const value of [{ kind: 'FIXED', value: 0 }, { kind: 'FIXED', value: 0.3 },
      { kind: 'PARAMETER', parameterKey: 'slow_percent' }, { kind: 'FORMULA', formulaKey: 'slow_ratio' }]) {
      const response = slowEffect();
      Object.assign(response.results[0].valueRule!, { value, fixedMultiplier: value.kind === 'PARAMETER' ? 0.01 : 1 });
      expect(parseSkillEffect(response)).toEqual(response);
    }
  });

  it.each(['min', 'max', 'duration', 'lifecycle', 'operation', 'read', 'stack', 'reapply', 'periodic', 'detail'])(
    '拒绝非法减速响应 %s', (field) => {
      const response = slowEffect();
      const result = response.results[0];
      if (field === 'min') result.valueRule!.fixedMinValue = null;
      if (field === 'max') result.valueRule!.fixedMaxValue = 100;
      if (field === 'duration') response.lifecycle!.durationValue = null;
      if (field === 'lifecycle') response.lifecycle = null;
      if (field === 'operation') Object.assign(result.detail, { operation: 'REMOVE' });
      if (field === 'read') result.lifecycleBehavior!.valueReadMode = 'MOMENT_EVALUATION';
      if (field === 'stack') result.lifecycleBehavior!.stackValueMode = 'PER_STACK';
      if (field === 'reapply') result.lifecycleBehavior!.reapplicationValueMode = 'ADD';
      if (field === 'periodic') result.lifecycleBehavior!.periodicExecutionMode = 'ONCE_PER_INSTANCE';
      if (field === 'detail') Object.assign(result.detail, { statusKind: 'MOVEMENT_SLOW' });
      expect(() => parseSkillEffect(response)).toThrow(SkillEffectProtocolError);
    }
  );
});

const persistentStatusBody: CreateSkillEffectRequest = {
  effectKey: persistentStatusDetail.effectKey,
  name: persistentStatusDetail.name,
  description: persistentStatusDetail.description,
  sortOrder: persistentStatusDetail.sortOrder,
  lifecycle: persistentStatusDetail.lifecycle,
  results: persistentStatusDetail.results
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
        durationValue: formulaValue("poison_duration_ms"),
        maxStacksValue: formulaValue("one"),
        applicationStacksValue: formulaValue("one"),
        instanceScope: 'SOURCE_TARGET',
        reapplicationStackMode: 'KEEP',
        reapplicationDurationMode: 'REFRESH_ALL',
        expiryMode: 'ALL_AT_ONCE',
        periodicIntervalValue: formulaValue("poison_tick_interval_ms"),
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
          spellShieldBlockScope: null,
          lifecycleBehavior: {
            moment: 'PERIODIC',
            valueReadMode: 'MOMENT_EVALUATION',
            stackValueMode: null,
            reapplicationValueMode: null,
            periodicExecutionMode: 'ONCE_PER_INSTANCE'
          },
          valueRule: {
            value: formulaValue("damage"),
            fixedMultiplier: 1,
            fixedMinValue: null,
            fixedMaxValue: null
          },
          detail: {
            damageTypeKey: 'physical',
            deliveryKind: 'SKILL',
            originKind: 'DIRECT',
            critical: { mode: 'DISALLOWED', multiplierValue: null },
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
          spellShieldBlockScope: null,
          lifecycleBehavior: null,
          valueRule: {
            value: formulaValue("damage"),
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

  it('requires an explicit legal spell-shield block scope on every result', () => {
    const { spellShieldBlockScope: _removed, ...legacyDamage } = damageResult;
    expect(() => parseSkillEffect({
      ...detail,
      results: [legacyDamage]
    })).toThrow(/effect\.results\[0\]\.spellShieldBlockScope/);

    expect(() => parseSkillEffect({
      ...detail,
      results: [{ ...damageResult, spellShieldBlockScope: 'UNKNOWN' }]
    })).toThrow(/effect\.results\[0\]\.spellShieldBlockScope/);

    expect(parseSkillEffect({
      ...detail,
      results: [{ ...damageResult, spellShieldBlockScope: 'DAMAGE_INSTANCE' }]
    }).results[0]).toMatchObject({ spellShieldBlockScope: 'DAMAGE_INSTANCE' });
  });

  it('parses persistent target status apply RESULT responses through list, get and create', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET' && String(input).endsWith('/effects')) {
        return jsonResponse(200, [persistentStatusSummary]);
      }
      return jsonResponse(method === 'POST' ? 201 : 200, persistentStatusDetail);
    });
    vi.stubGlobal('fetch', fetchMock);

    const listed = await listSkillEffects('http://localhost:8080', 'demo', 'veigar_e', 'token');
    expect(listed.data[0]).toMatchObject({ effectKey: 'event_horizon_stun', lifecycleEnabled: true });

    const loaded = await getSkillEffect(
      'http://localhost:8080', 'demo', 'veigar_e', 'event_horizon_stun', 'token'
    );
    expect(loaded.data.results[0]).toMatchObject({
      resultType: 'STATUS_OPERATION',
      target: 'TARGET',
      spellShieldBlockScope: 'RESULT',
      lifecycleBehavior: persistentStatusLifecycleBehavior,
      detail: { statusKey: 'vertigo', operation: 'APPLY' }
    });

    const created = await createSkillEffect(
      'http://localhost:8080', 'demo', 'veigar_e', 'token', persistentStatusBody
    );
    expect(created.status).toBe(201);
    expect(created.data.results[0]?.spellShieldBlockScope).toBe('RESULT');

    const nullScope = parseSkillEffect({
      ...persistentStatusDetail,
      results: [{ ...persistentStatusResult, spellShieldBlockScope: null }]
    });
    expect(nullScope.results[0]?.spellShieldBlockScope).toBeNull();

    for (const scope of ['SKILL', 'EFFECT', 'DAMAGE_INSTANCE'] as const) {
      expect(() => parseSkillEffect({
        ...persistentStatusDetail,
        results: [{ ...persistentStatusResult, spellShieldBlockScope: scope }]
      })).toThrow(/effect\.results\[0\]\.spellShieldBlockScope/);
    }
    expect(() => parseSkillEffect({
      ...persistentStatusDetail,
      results: [{ ...persistentStatusResult, target: 'SOURCE' as const }]
    })).toThrow(/effect\.results\[0\]\.spellShieldBlockScope/);
    expect(() => parseSkillEffect({
      ...persistentStatusDetail,
      results: [{
        ...persistentStatusResult,
        detail: { statusKey: 'vertigo', operation: 'REMOVE' as const }
      }]
    })).toThrow(/effect\.results\[0\]\.spellShieldBlockScope/);
    expect(() => parseSkillEffect({
      ...persistentStatusDetail,
      results: [{
        ...persistentStatusResult,
        resultType: 'DAMAGE' as const,
        valueRule: damageResult.valueRule,
        detail: damageResult.detail
      }]
    })).toThrow(/effect\.results\[0\]\.spellShieldBlockScope/);
  });

  it('parses a persistent spell shield without a value rule', () => {
    const parsed = parseSkillEffect({
      ...detail,
      lifecycle: {
        durationValue: null,
        maxStacksValue: formulaValue("one"),
        applicationStacksValue: formulaValue("one"),
        instanceScope: 'SOURCE_TARGET',
        reapplicationStackMode: 'KEEP',
        reapplicationDurationMode: null,
        expiryMode: 'EXPLICIT_ONLY',
        periodicIntervalValue: null,
        firstPeriodicExecution: null
      },
      results: [{
        ...damageResult,
        resultKey: 'spell_shield',
        resultType: 'SPELL_SHIELD',
        spellShieldBlockScope: null,
        lifecycleBehavior: {
          moment: 'PERSISTENT',
          valueReadMode: null,
          stackValueMode: null,
          reapplicationValueMode: null,
          periodicExecutionMode: null
        },
        valueRule: null,
        detail: {}
      }]
    });
    expect(parsed.results[0]).toMatchObject({
      resultType: 'SPELL_SHIELD',
      spellShieldBlockScope: null,
      valueRule: null,
      detail: {}
    });
  });

  it('parses persistent modifiers, damage immunity and health floor as typed results', () => {
    const lifecycleBehavior = {
      moment: 'PERSISTENT',
      valueReadMode: 'APPLICATION_SNAPSHOT',
      stackValueMode: 'SHARED',
      reapplicationValueMode: 'KEEP',
      periodicExecutionMode: null
    };
    const valueRule = {
      value: formulaValue('damage'),
      fixedMultiplier: 1,
      fixedMinValue: null,
      fixedMaxValue: null
    };
    const parsed = parseSkillEffect({
      ...detail,
      lifecycle: {
        durationValue: null,
        maxStacksValue: formulaValue("one"),
        applicationStacksValue: formulaValue("one"),
        instanceScope: 'SOURCE_TARGET',
        reapplicationStackMode: 'KEEP',
        reapplicationDurationMode: null,
        expiryMode: 'EXPLICIT_ONLY',
        periodicIntervalValue: null,
        firstPeriodicExecution: null
      },
      results: [
        {
          ...damageResult,
          resultKey: 'damage_modifier',
          resultType: 'DAMAGE_MODIFIER',
          lifecycleBehavior,
          valueRule,
          detail: {
            direction: 'TAKEN',
            operation: 'DECREASE',
            damageTypeKey: 'physical',
            deliveryKind: 'SKILL',
            originKind: 'DIRECT',
            criticalFilter: 'NON_CRITICAL_ONLY'
          }
        },
        {
          ...damageResult,
          resultKey: 'healing_modifier',
          resultType: 'HEALING_MODIFIER',
          lifecycleBehavior,
          valueRule,
          detail: {
            direction: 'RECEIVED',
            operation: 'DECREASE',
            healingKind: 'VAMP'
          }
        },
        {
          ...damageResult,
          resultKey: 'damage_immunity',
          resultType: 'DAMAGE_IMMUNITY',
          lifecycleBehavior: {
            ...lifecycleBehavior,
            valueReadMode: null,
            stackValueMode: null,
            reapplicationValueMode: null
          },
          valueRule: null,
          detail: {
            damageTypeKey: null,
            deliveryKind: 'ANY',
            originKind: 'REFLECTED'
          }
        },
        {
          ...damageResult,
          resultKey: 'health_floor',
          resultType: 'HEALTH_FLOOR',
          lifecycleBehavior,
          valueRule,
          detail: { attributeKey: 'hp' }
        }
      ]
    });

    expect(parsed.results.map((item) => item.resultType)).toEqual([
      'DAMAGE_MODIFIER',
      'HEALING_MODIFIER',
      'DAMAGE_IMMUNITY',
      'HEALTH_FLOOR'
    ]);
    expect(parsed.results[0]).toMatchObject({
      detail: { criticalFilter: 'NON_CRITICAL_ONLY' }
    });
    expect(parsed.results[2]).toMatchObject({
      valueRule: null,
      detail: { originKind: 'REFLECTED' }
    });
  });

  it('parses execute and empty-detail link results and rejects hidden fields', () => {
    const executeResult = {
      ...damageResult,
      resultKey: 'collect_execute',
      resultType: 'EXECUTE',
      spellShieldBlockScope: 'RESULT',
      lifecycleBehavior: {
        moment: 'APPLICATION',
        valueReadMode: 'APPLICATION_SNAPSHOT',
        stackValueMode: null,
        reapplicationValueMode: null,
        periodicExecutionMode: null
      },
      valueRule: damageResult.valueRule,
      detail: { attributeKey: 'hp' }
    };
    const parsed = parseSkillEffect({
      ...detail,
      results: [
        executeResult,
        {
          ...damageResult,
          resultKey: 'hit_link',
          resultType: 'HIT_LINK_APPLICATION',
          detail: {}
        },
        {
          ...damageResult,
          resultKey: 'attack_link',
          resultType: 'ATTACK_LINK_APPLICATION',
          spellShieldBlockScope: 'SKILL',
          detail: {}
        }
      ]
    });
    expect(parsed.results.map((item) => item.resultType)).toEqual([
      'EXECUTE',
      'HIT_LINK_APPLICATION',
      'ATTACK_LINK_APPLICATION'
    ]);
    expect(parsed.results[0]).toMatchObject({
      detail: { attributeKey: 'hp' },
      valueRule: damageResult.valueRule,
      spellShieldBlockScope: 'RESULT'
    });

    expect(() => parseSkillEffect({
      ...detail,
      results: [{
        ...executeResult,
        detail: { attributeKey: 'hp', modifierZoneKey: 'damage_ratio' }
      }]
    })).toThrow(/effect\.results\[0\]\.detail\.modifierZoneKey/);
    expect(() => parseSkillEffect({
      ...detail,
      results: [{
        ...damageResult,
        resultType: 'HIT_LINK_APPLICATION',
        detail: { sourceSkillKey: 'ashe_q' }
      }]
    })).toThrow(/effect\.results\[0\]\.detail/);
    expect(() => parseSkillEffect({
      ...detail,
      results: [{
        ...executeResult,
        spellShieldBlockScope: 'DAMAGE_INSTANCE'
      }]
    })).toThrow(/effect\.results\[0\]\.spellShieldBlockScope/);
    expect(() => parseSkillEffect({
      ...detail,
      results: [{
        ...executeResult,
        spellShieldBlockScope: null,
        lifecycleBehavior: {
          moment: 'PERSISTENT',
          valueReadMode: 'APPLICATION_SNAPSHOT',
          stackValueMode: 'SHARED',
          reapplicationValueMode: 'KEEP',
          periodicExecutionMode: null
        }
      }]
    })).toThrow(/effect\.results\[0\]\.lifecycleBehavior/);
  });

  it('parses cooldown and skill-haste public skill scopes and reports nested protocol paths', () => {
    const allScope = { mode: 'ALL', skillKeys: [], skillCategoryKeys: [] };
    const parsedCooldown = parseSkillEffect({
      ...detail,
      results: [{
        ...damageResult,
        resultKey: 'reset_cd',
        resultType: 'COOLDOWN_CHANGE',
        valueRule: null,
        detail: { operation: 'RESET', affectedSkillScope: allScope }
      }]
    });
    expect(parsedCooldown.results[0]).toMatchObject({
      resultType: 'COOLDOWN_CHANGE',
      detail: { operation: 'RESET', affectedSkillScope: allScope }
    });
    expect(parsedCooldown.results[0]?.detail).not.toHaveProperty('affectedSkillKeys');

    const hasteLifecycle = {
      moment: 'PERSISTENT',
      valueReadMode: 'APPLICATION_SNAPSHOT',
      stackValueMode: 'SHARED',
      reapplicationValueMode: 'KEEP',
      periodicExecutionMode: null
    };
    const parsedHaste = parseSkillEffect({
      ...detail,
      lifecycle: {
        durationValue: null,
        maxStacksValue: formulaValue("one"),
        applicationStacksValue: formulaValue("one"),
        instanceScope: 'SOURCE_TARGET',
        reapplicationStackMode: 'KEEP',
        reapplicationDurationMode: null,
        expiryMode: 'EXPLICIT_ONLY',
        periodicIntervalValue: null,
        firstPeriodicExecution: null
      },
      results: [{
        ...damageResult,
        resultKey: 'haste',
        resultType: 'SKILL_HASTE_MODIFIER',
        spellShieldBlockScope: null,
        lifecycleBehavior: hasteLifecycle,
        valueRule: damageResult.valueRule,
        detail: {
          operation: 'INCREASE',
          affectedSkillScope: {
            mode: 'CATEGORIES',
            skillKeys: [],
            skillCategoryKeys: ['displacement']
          }
        }
      }]
    });
    expect(parsedHaste.results[0]).toMatchObject({
      resultType: 'SKILL_HASTE_MODIFIER',
      lifecycleBehavior: hasteLifecycle,
      detail: {
        operation: 'INCREASE',
        affectedSkillScope: {
          mode: 'CATEGORIES',
          skillKeys: [],
          skillCategoryKeys: ['displacement']
        }
      }
    });

    expect(() => parseSkillEffect({
      ...detail,
      results: [{
        ...damageResult,
        resultType: 'COOLDOWN_CHANGE',
        valueRule: null,
        detail: { operation: 'RESET', affectedSkillKeys: ['ezreal_q'] }
      }]
    })).toThrow(/effect\.results\[0\]\.detail\.affectedSkillScope/);

    expect(() => parseSkillEffect({
      ...detail,
      results: [{
        ...damageResult,
        resultType: 'COOLDOWN_CHANGE',
        valueRule: null,
        detail: {
          operation: 'RESET',
          affectedSkillKeys: ['ezreal_q'],
          affectedSkillScope: allScope
        }
      }]
    })).toThrow(/effect\.results\[0\]\.detail\.affectedSkillKeys/);

    expect(() => parseSkillEffect({
      ...detail,
      results: [{
        ...damageResult,
        resultType: 'COOLDOWN_CHANGE',
        valueRule: null,
        detail: {
          operation: 'RESET',
          affectedSkillScope: { mode: 'MIXED', skillKeys: [], skillCategoryKeys: [] }
        }
      }]
    })).toThrow(/effect\.results\[0\]\.detail\.affectedSkillScope\.mode/);

    expect(() => parseSkillEffect({
      ...detail,
      results: [{
        ...damageResult,
        resultType: 'COOLDOWN_CHANGE',
        valueRule: damageResult.valueRule,
        detail: {
          operation: 'REDUCE',
          affectedSkillScope: { mode: 'SKILLS', skillKeys: ['q', 1], skillCategoryKeys: [] }
        }
      }]
    })).toThrow(/effect\.results\[0\]\.detail\.affectedSkillScope\.skillKeys\[1\]/);

    expect(() => parseSkillEffect({
      ...detail,
      results: [{
        ...damageResult,
        resultType: 'SKILL_HASTE_MODIFIER',
        spellShieldBlockScope: null,
        lifecycleBehavior: hasteLifecycle,
        valueRule: damageResult.valueRule,
        detail: {
          operation: 'INCREASE',
          affectedSkillScope: {
            mode: 'CATEGORIES',
            skillKeys: [],
            skillCategoryKeys: [null]
          }
        }
      }]
    })).toThrow(/effect\.results\[0\]\.detail\.affectedSkillScope\.skillCategoryKeys\[0\]/);

    expect(() => parseSkillEffect({
      ...detail,
      results: [{
        ...damageResult,
        resultType: 'SKILL_HASTE_MODIFIER',
        spellShieldBlockScope: null,
        lifecycleBehavior: {
          ...hasteLifecycle,
          moment: 'APPLICATION'
        },
        valueRule: damageResult.valueRule,
        detail: { operation: 'INCREASE', affectedSkillScope: allScope }
      }]
    })).toThrow(/effect\.results\[0\]\.lifecycleBehavior\.moment/);
  });
});
