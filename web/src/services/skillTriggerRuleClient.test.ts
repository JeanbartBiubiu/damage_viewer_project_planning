import { formulaValue } from '../types/numericValue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './apiClient';
import {
  createSkillTriggerRule,
  deleteSkillTriggerRule,
  getSkillTriggerRule,
  listSkillTriggerRules,
  parseSkillTriggerRuleDetail,
  parseSkillTriggerRuleSummary,
  SkillTriggerRuleProtocolError,
  updateSkillTriggerRule
} from './skillTriggerRuleClient';
import type {
  CreateSkillTriggerRuleRequest,
  SkillTriggerRuleDetail,
  SkillTriggerRuleSummary,
  UpdateSkillTriggerRuleRequest
} from '../types/skillTriggerRule';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const summary: SkillTriggerRuleSummary = {
  ruleKey: 'detonate_at_full_stacks',
  name: '满层引爆',
  description: null,
  eventType: 'LIFECYCLE_MOMENT',
  conditionGroupCount: 0,
  actionCount: 2,
  perTargetCooldownEnabled: false,
  maxTriggersPerProcessEnabled: false,
  sortOrder: 10,
  updatedAt: '2026-08-30T00:00:00Z'
};

const detail: SkillTriggerRuleDetail = {
  ruleKey: 'detonate_at_full_stacks',
  name: '满层引爆',
  description: null,
  sortOrder: 10,
  eventSource: {
    eventType: 'LIFECYCLE_MOMENT',
    detail: { effectKey: 'focus_mark', moment: 'FULL_STACKS' }
  },
  conditionGroups: [],
  actions: [
    {
      actionKey: 'detonate',
      name: '引爆伤害',
      actionType: 'EXECUTE_EFFECT',
      sortOrder: 10,
      targetContext: 'CURRENT_TARGET',
      detail: { effectKey: 'detonate_damage' },
      runtimeInputBindings: [],
      resultModifiers: []
    },
    {
      actionKey: 'remove_mark',
      name: '移除标记',
      actionType: 'EXECUTE_EFFECT',
      sortOrder: 20,
      targetContext: 'CURRENT_TARGET',
      detail: { effectKey: 'remove_focus_mark' },
      runtimeInputBindings: [],
      resultModifiers: []
    }
  ],
  perTargetCooldown: null,
  maxTriggersPerProcess: null
};

const createBody: CreateSkillTriggerRuleRequest = {
  ruleKey: 'detonate_at_full_stacks',
  name: '满层引爆',
  description: null,
  sortOrder: 10,
  eventSource: detail.eventSource,
  conditionGroups: detail.conditionGroups,
  actions: detail.actions,
  perTargetCooldown: null,
  maxTriggersPerProcess: null
};

const updateBody: UpdateSkillTriggerRuleRequest = {
  name: '满层引爆',
  description: null,
  sortOrder: 11,
  eventSource: detail.eventSource,
  conditionGroups: detail.conditionGroups,
  actions: detail.actions,
  perTargetCooldown: null,
  maxTriggersPerProcess: null
};

describe('skillTriggerRuleClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('saves and reads initialization rules with empty details and event-source actions', async () => {
    const initialized: SkillTriggerRuleDetail = {
      ...detail,
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} },
      actions: [{ ...detail.actions[0], targetContext: 'EVENT_SOURCE' }]
    };
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init?.body ? JSON.parse(String(init.body)) : null);
      return jsonResponse(init?.method === 'POST' ? 201 : 200, initialized);
    }));
    const created = await createSkillTriggerRule('http://localhost:8080', 'lol', 'nasus_p', 'local-entry', initialized);
    const loaded = await getSkillTriggerRule('http://localhost:8080', 'lol', 'nasus_p', initialized.ruleKey, 'local-entry');
    expect(calls).toEqual([initialized, null]);
    expect(created.data).toEqual(initialized);
    expect(loaded.data).toEqual(initialized);
    expect(parseSkillTriggerRuleSummary({ ...summary, eventType: 'SOURCE_INITIALIZED' }).eventType).toBe('SOURCE_INITIALIZED');
  });

  it.each([undefined, null, [], '', 0, true, { sourceSkillKey: null }, { subject: 'SOURCE' }])(
    'rejects nonempty or nonobject initialization detail %j',
    (eventDetail) => {
      expect(() => parseSkillTriggerRuleDetail({
        ...detail,
        eventSource: { eventType: 'SOURCE_INITIALIZED', detail: eventDetail }
      })).toThrow(/detail\.eventSource\.detail/);
    }
  );

  it('encodes game, skill and rule path segments with admin token and JSON headers', async () => {
    const listMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo%20arena/skills/active%2Fq/trigger-rules'
      );
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer token');
      expect(headers.get('Accept')).toBe('application/json');
      expect(headers.get('Content-Type')).toBeNull();
      expect(init?.method ?? 'GET').toBe('GET');
      return jsonResponse(200, [summary]);
    });
    vi.stubGlobal('fetch', listMock);

    const listed = await listSkillTriggerRules(
      'http://localhost:8080/',
      'demo arena',
      'active/q',
      'token'
    );
    expect(listed.status).toBe(200);
    expect(listed.data[0]).toEqual(summary);
    expect(listed.data[0]).not.toHaveProperty('eventSource');
    expect(listed.data[0]).not.toHaveProperty('actions');
    expect(listed.data[0]?.eventType).toBe('LIFECYCLE_MOMENT');
    expect(listed.data[0]?.actionCount).toBe(2);

    const detailMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://localhost:8080/api/admin/games/demo/skills/ezreal_q/trigger-rules/full%2Fstacks'
      );
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer token');
      expect(headers.get('Accept')).toBe('application/json');
      return jsonResponse(200, detail);
    });
    vi.stubGlobal('fetch', detailMock);

    const loaded = await getSkillTriggerRule(
      'http://localhost:8080',
      'demo',
      'ezreal_q',
      'full/stacks',
      'token'
    );
    expect(loaded.status).toBe(200);
    expect(loaded.data.eventSource).toEqual(detail.eventSource);
    expect(loaded.data.actions[0]?.detail).toEqual({ effectKey: 'detonate_damage' });
    expect(loaded.data.actions[1]?.actionType).toBe('EXECUTE_EFFECT');
  });

  it('sends POST with ruleKey, PUT without ruleKey, and DELETE 204', async () => {
    const calls: Array<{ method: string; url: string; status: number; body: unknown; headers: Headers }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const status = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200;
      const headers = new Headers(init?.headers);
      calls.push({
        method,
        url: String(input),
        status,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers
      });
      expect(headers.get('Authorization')).toBe('Bearer token');
      expect(headers.get('Accept')).toBe('application/json');
      if (method === 'POST' || method === 'PUT') {
        expect(headers.get('Content-Type')).toBe('application/json');
      }
      return jsonResponse(status, method === 'DELETE' ? null : detail);
    });
    vi.stubGlobal('fetch', fetchMock);

    const created = await createSkillTriggerRule(
      'http://localhost:8080',
      'demo arena',
      'active/q',
      'token',
      createBody
    );
    const updated = await updateSkillTriggerRule(
      'http://localhost:8080',
      'demo',
      'ezreal_q',
      'full/stacks',
      'token',
      updateBody
    );
    const deleted = await deleteSkillTriggerRule(
      'http://localhost:8080',
      'demo',
      'ezreal_q',
      'full/stacks',
      'token'
    );

    expect(created.status).toBe(201);
    expect(created.data.ruleKey).toBe('detonate_at_full_stacks');
    expect(created.data.eventSource.eventType).toBe('LIFECYCLE_MOMENT');
    expect(updated.status).toBe(200);
    expect(updated.data.actions).toHaveLength(2);
    expect(deleted.status).toBe(204);
    expect(deleted.data).toBeNull();

    expect(calls.map((call) => call.method)).toEqual(['POST', 'PUT', 'DELETE']);
    expect(calls[0]?.url).toBe(
      'http://localhost:8080/api/admin/games/demo%20arena/skills/active%2Fq/trigger-rules'
    );
    expect(calls[1]?.url).toBe(
      'http://localhost:8080/api/admin/games/demo/skills/ezreal_q/trigger-rules/full%2Fstacks'
    );
    expect(calls[2]?.url).toBe(
      'http://localhost:8080/api/admin/games/demo/skills/ezreal_q/trigger-rules/full%2Fstacks'
    );
    expect(calls[0]?.body).toEqual(createBody);
    expect(calls[0]?.body).toMatchObject({ ruleKey: 'detonate_at_full_stacks' });
    expect(calls[1]?.body).toEqual(updateBody);
    expect(calls[1]?.body).not.toHaveProperty('ruleKey');
    expect(calls[2]?.body).toBeNull();
  });

  it('parses typed summaries and details, including nested unions', () => {
    expect(parseSkillTriggerRuleSummary(summary)).toEqual(summary);
    const parsed = parseSkillTriggerRuleDetail(detail);
    expect(parsed.eventSource).toEqual({
      eventType: 'LIFECYCLE_MOMENT',
      detail: { effectKey: 'focus_mark', moment: 'FULL_STACKS' }
    });
    expect(parsed.actions[0]).toMatchObject({
      actionType: 'EXECUTE_EFFECT',
      detail: { effectKey: 'detonate_damage' },
      targetContext: 'CURRENT_TARGET'
    });
    expect(parsed.perTargetCooldown).toBeNull();
    expect(parsed.maxTriggersPerProcess).toBeNull();
  });

  it('rejects mismatched event detail shapes as protocol errors', () => {
    expect(() => parseSkillTriggerRuleSummary({ ...summary, eventType: 'VALUE_REACHED' }))
      .toThrow(SkillTriggerRuleProtocolError);
    expect(() => parseSkillTriggerRuleDetail({
      ...detail,
      eventSource: { eventType: 'LIFECYCLE_MOMENT', detail: { effectKey: 'focus_mark' } }
    })).toThrow(/触发规则响应与固定联合类型不匹配/);
    expect(() => parseSkillTriggerRuleDetail({
      ...detail,
      eventSource: { eventType: 'DAMAGE_TAKEN', detail: {} }
    })).toThrow(/eventSource\.detail\.damageTypeKey/);
    expect(parseSkillTriggerRuleDetail({
      ...detail,
      eventSource: {
        eventType: 'DAMAGE_TAKEN',
        detail: { damageTypeKey: null, deliveryKind: 'ANY', originKind: 'DIRECT' }
      }
    }).eventSource).toEqual({
      eventType: 'DAMAGE_TAKEN',
      detail: { damageTypeKey: null, deliveryKind: 'ANY', originKind: 'DIRECT' }
    });
    expect(parseSkillTriggerRuleDetail({
      ...detail,
      eventSource: {
        eventType: 'DAMAGE_PENDING',
        detail: { damageTypeKey: 'physical', deliveryKind: 'SKILL', originKind: 'REFLECTED' }
      }
    }).eventSource).toEqual({
      eventType: 'DAMAGE_PENDING',
      detail: { damageTypeKey: 'physical', deliveryKind: 'SKILL', originKind: 'REFLECTED' }
    });
    expect(parseSkillTriggerRuleDetail({
      ...detail,
      eventSource: {
        eventType: 'SPELL_SHIELD_BLOCKED',
        detail: { shieldEffectKey: 'sivir_spell_shield' }
      }
    }).eventSource).toEqual({
      eventType: 'SPELL_SHIELD_BLOCKED',
      detail: { shieldEffectKey: 'sivir_spell_shield' }
    });
    expect(() => parseSkillTriggerRuleDetail({
      ...detail,
      eventSource: { eventType: 'SPELL_SHIELD_BLOCKED', detail: {} }
    })).toThrow(/eventSource\.detail\.shieldEffectKey/);
    expect(parseSkillTriggerRuleDetail({
      ...detail,
      eventSource: { eventType: 'HIT_LINK_APPLIED', detail: { sourceSkillKey: null } }
    }).eventSource).toEqual({
      eventType: 'HIT_LINK_APPLIED',
      detail: { sourceSkillKey: null }
    });
    expect(parseSkillTriggerRuleDetail({
      ...detail,
      eventSource: { eventType: 'ATTACK_LINK_APPLIED', detail: { sourceSkillKey: 'ashe_q' } }
    }).eventSource).toEqual({
      eventType: 'ATTACK_LINK_APPLIED',
      detail: { sourceSkillKey: 'ashe_q' }
    });
    expect(() => parseSkillTriggerRuleDetail({
      ...detail,
      eventSource: {
        eventType: 'HIT_LINK_APPLIED',
        detail: { sourceSkillKey: null, eventValueKey: 'HIT_INDEX' }
      }
    })).toThrow(/eventSource\.detail/);
    expect(() => parseSkillTriggerRuleDetail({
      ...detail,
      eventSource: { eventType: 'ATTACK_LINK_APPLIED', detail: { sourceSkillKey: 12 } }
    })).toThrow(/eventSource\.detail\.sourceSkillKey/);
  });

  it('accepts final event values and prior outputs, and rejects unknown strings or extra prior-result fields', () => {
    expect(parseSkillTriggerRuleDetail({
      ...detail,
      eventSource: { eventType: 'HIT_LINK_APPLIED', detail: { sourceSkillKey: null } },
      conditionGroups: [{
        groupKey: 'when_link',
        name: '联动条件',
        sortOrder: 0,
        conditions: [{
          conditionKey: 'link_count',
          conditionType: 'EVENT_VALUE_COMPARE',
          sortOrder: 0,
          detail: {
            eventValueKey: 'LINK_COUNT',
            comparator: 'EQ',
            comparisonValue: formulaValue("one")
          }
        }]
      }],
      actions: [{
        ...detail.actions[0],
        runtimeInputBindings: [{
          bindingKey: 'bind_link_index',
          parameterKey: 'stacks',
          sourceType: 'EVENT_VALUE',
          detail: { eventValueKey: 'LINK_INDEX' }
        }]
      }]
    }).conditionGroups[0]?.conditions[0]).toMatchObject({
      conditionType: 'EVENT_VALUE_COMPARE',
      detail: { eventValueKey: 'LINK_COUNT' }
    });

    expect(parseSkillTriggerRuleDetail({
      ...detail,
      actions: [{
        ...detail.actions[0],
        runtimeInputBindings: [{
          bindingKey: 'bind_killed',
          parameterKey: 'stacks',
          sourceType: 'PRIOR_ACTION_RESULT',
          detail: {
            sourceActionKey: 'first_hit',
            sourceResultKey: 'damage',
            outputKind: 'KILLED'
          }
        }]
      }]
    }).actions[0]?.runtimeInputBindings[0]?.detail).toEqual({
      sourceActionKey: 'first_hit',
      sourceResultKey: 'damage',
      outputKind: 'KILLED'
    });

    expect(() => parseSkillTriggerRuleDetail({
      ...detail,
      conditionGroups: [{
        groupKey: 'when_hit',
        name: '命中条件',
        sortOrder: 0,
        conditions: [{
          conditionKey: 'hit_index',
          conditionType: 'EVENT_VALUE_COMPARE',
          sortOrder: 0,
          detail: {
            eventValueKey: 'FREE_OUTPUT',
            comparator: 'EQ',
            comparisonValue: formulaValue("one")
          }
        }]
      }]
    })).toThrow(/detail\.conditionGroups\[0\]\.conditions\[0\]/);

    expect(() => parseSkillTriggerRuleDetail({
      ...detail,
      actions: [{
        ...detail.actions[0],
        runtimeInputBindings: [{
          bindingKey: 'bind_unknown',
          parameterKey: 'stacks',
          sourceType: 'EVENT_VALUE',
          detail: { eventValueKey: 'FREE_EVENT_VALUE' }
        }]
      }]
    })).toThrow(/runtimeInputBindings\[0\]\.detail\.eventValueKey/);

    expect(() => parseSkillTriggerRuleDetail({
      ...detail,
      actions: [{
        ...detail.actions[0],
        runtimeInputBindings: [{
          bindingKey: 'bind_unknown_output',
          parameterKey: 'stacks',
          sourceType: 'PRIOR_ACTION_RESULT',
          detail: {
            sourceActionKey: 'first_hit',
            sourceResultKey: 'damage',
            outputKind: 'FREE_OUTPUT'
          }
        }]
      }]
    })).toThrow(/runtimeInputBindings\[0\]\.detail/);

    expect(() => parseSkillTriggerRuleDetail({
      ...detail,
      actions: [{
        ...detail.actions[0],
        runtimeInputBindings: [{
          bindingKey: 'bind_extra',
          parameterKey: 'stacks',
          sourceType: 'PRIOR_ACTION_RESULT',
          detail: {
            sourceActionKey: 'first_hit',
            sourceResultKey: 'damage',
            outputKind: 'CONFIGURED_VALUE',
            sourceEffectKey: 'on_hit_damage'
          }
        }]
      }]
    })).toThrow(/runtimeInputBindings\[0\]\.detail/);
  });

  it.each([
    {
      status: 400,
      code: '400.VALIDATION_FAILED',
      message: '触发规则信息不合法',
      details: {
        fieldIssues: [
          {
            field: 'actions[0].detail.effectKey',
            code: 'UNKNOWN_EFFECT',
            message: '效果不存在'
          }
        ]
      }
    },
    {
      status: 400,
      code: '400.TRIGGER_RULE_CYCLE_UNGUARDED',
      message: '当前关系形成没有保护的循环',
      details: {
        cyclePath: ['rule_a', 'rule_b'],
        ruleKey: 'rule_b',
        actionKey: 'loop'
      }
    },
    {
      status: 404,
      code: '404.SKILL_TRIGGER_RULE_NOT_FOUND',
      message: '触发规则不存在',
      details: { skillKey: 'ezreal_q', ruleKey: 'missing' }
    },
    {
      status: 409,
      code: '409.SKILL_TRIGGER_RULE_KEY_EXISTS',
      message: '触发规则标识已存在',
      details: {}
    }
  ])('preserves $status $code with message, details and fieldIssues', async (payload) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/api/admin/games/demo/skills/ezreal_q/trigger-rules');
      expect(String(input)).not.toContain('/combat-data/');
      return jsonResponse(payload.status, { error: payload });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getSkillTriggerRule(
      'http://localhost:8080',
      'demo',
      'ezreal_q',
      'missing',
      'token'
    )).rejects.toMatchObject<Partial<ApiRequestError>>({
      name: 'ApiRequestError',
      status: payload.status,
      code: payload.code,
      message: payload.message,
      details: payload.details
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('生命周期条件响应分支', () => {
  const withCondition = (conditionDetail: unknown) => ({ ...detail, conditionGroups: [{ groupKey: 'group', name: '印记条件', sortOrder: 0, conditions: [{ conditionKey: 'mark_present', conditionType: 'LIFECYCLE_CHECK', sortOrder: 0, detail: conditionDetail }] }] });
  const presence = { effectKey: 'mark', subject: 'CURRENT_TARGET', checkKind: 'PRESENT', comparator: null, comparisonValue: null };
  it.each([
    presence,
    { ...presence, subject: null, checkKind: 'ABSENT' },
    { ...presence, checkKind: 'STACKS_COMPARE', comparator: 'GTE', comparisonValue: { kind: 'FIXED', value: 0 } },
    { ...presence, checkKind: 'STACKS_COMPARE', comparator: 'EQ', comparisonValue: { kind: 'PARAMETER', parameterKey: 'stacks' } },
    { ...presence, checkKind: 'STACKS_COMPARE', comparator: 'LT', comparisonValue: { kind: 'FORMULA', formulaKey: 'limit' } }
  ])('严格读取合法生命周期分支 %j', (conditionDetail) => {
    expect(parseSkillTriggerRuleDetail(withCondition(conditionDetail)).conditionGroups[0].conditions[0].detail).toEqual(conditionDetail);
  });
  it.each([
    { ...presence, scope: 'SOURCE_TARGET' }, { ...presence, subject: undefined }, { ...presence, subject: 'OTHER' },
    { ...presence, subject: ['CURRENT_TARGET'] },
    { ...presence, effectKey: '' }, { ...presence, checkKind: 'UNKNOWN' }, { ...presence, comparator: 'EQ' },
    { ...presence, comparisonValue: { kind: 'FIXED', value: 0 } },
    { ...presence, checkKind: 'STACKS_COMPARE', comparator: null },
    { ...presence, checkKind: 'STACKS_COMPARE', comparator: ['GTE'], comparisonValue: { kind: 'FIXED', value: 0 } },
    { ...presence, checkKind: 'STACKS_COMPARE', comparator: 'GTE', comparisonValue: { kind: 'FIXED', value: -1 } },
    { ...presence, checkKind: 'STACKS_COMPARE', comparator: 'GTE', comparisonValue: { kind: 'FIXED', value: 0.5 } },
    { ...presence, checkKind: 'STACKS_COMPARE', comparator: 'GTE', comparisonValue: 'stacks' }
  ])('拒绝字段串用、缺失与非法层数 %j', (conditionDetail) => {
    expect(() => parseSkillTriggerRuleDetail(withCondition(conditionDetail))).toThrow(SkillTriggerRuleProtocolError);
  });
});

describe('来源施放资源消耗响应', () => {
  const withBinding = (bindingDetail: unknown) => ({ ...detail,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'ezreal_q' } },
    actions: [{ ...detail.actions[0], runtimeInputBindings: [{ bindingKey: 'cast_cost', parameterKey: 'source_cost', sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: bindingDetail }] }]
  });
  it('只读取 attributeKey，不复制来源技能或取值字段', () => {
    expect(parseSkillTriggerRuleDetail(withBinding({ attributeKey: 'mana' })).actions[0].runtimeInputBindings[0]).toEqual({
      bindingKey: 'cast_cost', parameterKey: 'source_cost', sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: { attributeKey: 'mana' }
    });
  });
  it.each([null, {}, [], { attributeKey: null }, { attributeKey: '' }, { attributeKey: 0 }, { attributeKey: ['mana'] },
    { attributeKey: 'mana', sourceSkillKey: 'ezreal_q' }, { attributeKey: 'mana', value: 0 }, { attributeKey: 'mana', eventValueKey: 'HIT_INDEX' }, { attributeKey: 'bad-key' }
  ])('拒绝缺失、错误类型及混合明细 %j', (bindingDetail) => {
    expect(() => parseSkillTriggerRuleDetail(withBinding(bindingDetail))).toThrow(SkillTriggerRuleProtocolError);
  });
});

describe('命中目标类别响应', () => {
  const withCategory = (conditionDetail: unknown) => ({ ...detail,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'ezreal_r' } },
    conditionGroups: [{ groupKey: 'targets', name: '命中类别', sortOrder: 0, conditions: [{ conditionKey: 'hit_category', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 0, detail: conditionDetail }] }]
  });
  it.each([['CHAMPION'], ['CHAMPION', 'EPIC_MONSTER', 'MINION', 'NON_EPIC_MONSTER', 'STRUCTURE']])('读取类别数组 %j，不要求比较取值字段', (...categories) => {
    const conditionDetail = { categories };
    expect(parseSkillTriggerRuleDetail(withCategory(conditionDetail)).conditionGroups[0].conditions[0].detail).toEqual(conditionDetail);
  });
  it.each([null, {}, { categories: [] }, { categories: null }, { categories: 'CHAMPION' }, { categories: ['UNKNOWN'] },
    { categories: ['CHAMPION', 'CHAMPION'] }, { categories: [0] }, { categories: [['CHAMPION']] },
    { categories: ['CHAMPION'], subject: 'CURRENT_TARGET' }, { categories: ['CHAMPION'], comparisonValue: null },
    { categories: ['CHAMPION'], comparator: null }, { categories: ['CHAMPION'], scope: 'TARGET' }
  ])('拒绝缺字段、非法数组和多余明细 %j', (conditionDetail) => {
    expect(() => parseSkillTriggerRuleDetail(withCategory(conditionDetail))).toThrow(SkillTriggerRuleProtocolError);
  });
});

describe('技能命中法术护盾事件值响应', () => {
  const valueKey = 'SKILL_HIT_SPELL_SHIELD_BLOCKED';
  const conditionDetail = { eventValueKey: valueKey, comparator: 'EQ', comparisonValue: { kind: 'FIXED', value: 0.5 } };
  const response = (condition: unknown = conditionDetail, binding: unknown = { eventValueKey: valueKey }) => ({ ...detail,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'ezreal_q' } },
    conditionGroups: [{ groupKey: 'unblocked', name: '命中结果', sortOrder: 0, conditions: [{ conditionKey: 'shield', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 0, detail: condition }] }],
    actions: [{ ...detail.actions[0], runtimeInputBindings: [{ bindingKey: 'shield', parameterKey: 'blocked', sourceType: 'EVENT_VALUE', detail: binding }] }]
  });
  it('同时读取条件和绑定，比较取值保留小数', () => {
    const parsed = parseSkillTriggerRuleDetail(response());
    expect(parsed.conditionGroups[0].conditions[0].detail).toEqual(conditionDetail);
    expect(parsed.actions[0].runtimeInputBindings[0].detail).toEqual({ eventValueKey: valueKey });
  });
  it.each([null, [valueKey], 'SKILL_HIT_SHIELD_BLOCKED', 'skill_hit_spell_shield_blocked'])('拒绝非法事件值 %j', (eventValueKey) => {
    expect(() => parseSkillTriggerRuleDetail(response({ ...conditionDetail, eventValueKey }))).toThrow(SkillTriggerRuleProtocolError);
    expect(() => parseSkillTriggerRuleDetail(response(conditionDetail, { eventValueKey }))).toThrow(SkillTriggerRuleProtocolError);
  });
  it('拒绝混合字段和非法比较符，不接受客户端自填阻挡结果', () => {
    for (const extra of [{ subject: 'CURRENT_TARGET' }, { value: 0 }, { comparator: 'UNKNOWN' }]) {
      expect(() => parseSkillTriggerRuleDetail(response({ ...conditionDetail, ...extra }))).toThrow(SkillTriggerRuleProtocolError);
    }
    expect(() => parseSkillTriggerRuleDetail(response(conditionDetail, { eventValueKey: valueKey, value: 1 }))).toThrow(SkillTriggerRuleProtocolError);
  });
});
