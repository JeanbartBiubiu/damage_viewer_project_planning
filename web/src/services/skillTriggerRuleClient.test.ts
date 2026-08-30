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
