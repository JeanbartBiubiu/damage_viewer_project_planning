import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import { ApiRequestError } from './apiClient';
import { createSkillTriggerRule, getSkillTriggerRule, parseSkillTriggerRuleDetail, SkillTriggerRuleProtocolError } from './skillTriggerRuleClient';

function detail(bindingDetail: unknown, bindingExtra: Record<string, unknown> = {}) {
  return {
    ruleKey: 'initialize_values', name: '初始化', description: null, sortOrder: 0,
    eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, conditionGroups: [],
    actions: [{ actionKey: 'apply_initial', name: '初始化数值', actionType: 'EXECUTE_EFFECT', sortOrder: 0,
      targetContext: 'EVENT_SOURCE', detail: { effectKey: 'initial_effect' }, resultModifiers: [],
      runtimeInputBindings: [{ bindingKey: 'initial_input', parameterKey: 'initial_count',
        sourceType: 'SCENE_INITIAL_PARAMETER', detail: bindingDetail, ...bindingExtra }] }],
    perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
  };
}

describe('场景显式初值客户端协议', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each([{ minValue: 0, maxValue: 0 }, { minValue: -5, maxValue: 5 }, { minValue: -.5, maxValue: 1.25 }])(
    '保留明确范围且不添加默认取值 %j', (range) => {
      const input = detail(range);
      const parsed = parseSkillTriggerRuleDetail(input);
      expect(parsed).toEqual(input);
      expect(parsed.actions[0].runtimeInputBindings[0].detail).toEqual(range);
      expect(parsed.actions[0].runtimeInputBindings[0]).not.toHaveProperty('value');
      expect(parsed.actions[0].runtimeInputBindings[0].detail).not.toHaveProperty('defaultValue');
    }
  );

  it.each([
    undefined, null, [], '', 0, {}, { minValue: 0 }, { maxValue: 1 },
    { minValue: null, maxValue: 1 }, { minValue: 0, maxValue: null },
    { minValue: '0', maxValue: 1 }, { minValue: 0, maxValue: '1' },
    { minValue: false, maxValue: 1 }, { minValue: 0, maxValue: [] },
    { minValue: Number.NaN, maxValue: 1 }, { minValue: 0, maxValue: Number.POSITIVE_INFINITY },
    { minValue: Number.NEGATIVE_INFINITY, maxValue: 1 }, { minValue: 2, maxValue: 1 },
    { minValue: 0, maxValue: 1, value: 0 }, { minValue: 0, maxValue: 1, defaultValue: 0 },
    { minValue: 0, maxValue: 1, resourceKey: 'mana' }, { minValue: 0, maxValue: 1, subject: 'SOURCE' }
  ])('拒绝缺失、强转或其它来源明细 %j', (range) => {
    expect(() => parseSkillTriggerRuleDetail(detail(range))).toThrow(SkillTriggerRuleProtocolError);
  });

  it.each([{ value: 0 }, { defaultValue: 0 }, { bindingKey: '' }, { parameterKey: 'invalid-key' }])(
    '拒绝绑定外来字段与非法标识 %j', (extra) => {
      expect(() => parseSkillTriggerRuleDetail(detail({ minValue: 0, maxValue: 1 }, extra))).toThrow(SkillTriggerRuleProtocolError);
    }
  );

  it('保存与回读沿现行客户端传递原范围', async () => {
    const input = detail({ minValue: -5, maxValue: 5 }) as SkillTriggerRuleDetail;
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent.push(init?.body ? JSON.parse(String(init.body)) : null);
      return new Response(JSON.stringify(input), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const saved = await createSkillTriggerRule('http://localhost:8080', 'example', 'unrelated_skill', 'fixture', input);
    const loaded = await getSkillTriggerRule('http://localhost:8080', 'example', 'unrelated_skill', input.ruleKey, 'fixture');
    expect(saved.data).toEqual(input);
    expect(loaded.data).toEqual(input);
    expect(sent).toEqual([input, null]);
  });

  it.each([400, 409])('后台拒绝 %i 不修改调用方草稿或伪造已保存结果', async (status) => {
    const input = detail({ minValue: 0, maxValue: 5 }) as SkillTriggerRuleDetail;
    const before = structuredClone(input);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'INVALID_BINDING', message: '来源不合法' }),
      { status, headers: { 'Content-Type': 'application/json' } })));
    await expect(createSkillTriggerRule('http://localhost:8080', 'example', 'unrelated_skill', 'fixture', input)).rejects.toBeInstanceOf(ApiRequestError);
    expect(input).toEqual(before);
  });
});
