import { describe, expect, it } from 'vitest';
import type { SkillEffect } from '../../../../types/skillEffect';
import type { SkillFormula } from '../../../../types/skillFormula';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillTriggerEventSource, SkillTriggerSourceCastResourceCostBinding } from '../../../../types/skillTriggerRule';
import { parameterValue, formulaValue } from '../../../../types/numericValue';
import { allowsSourceCastResourceCost, sourceCastResourceCostError } from './sourceCastResourceCost';
import { analyzeEventSwitchImpact, applyEventSwitchCleanup, bindingSummary, createEmptyBinding, createEmptyRuleDraft, evaluateBindingCompleteness, fromDetail, requiredCatalogsForDraft, switchBindingSourceType, toCreateRequest, validateSkillTriggerDraft } from './triggerRuleForm';

const hit: SkillTriggerEventSource = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'q' } };
const binding: SkillTriggerSourceCastResourceCostBinding = { bindingKey: 'cost', parameterKey: 'source_cost', sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: { attributeKey: 'mana' } };
const parameter: SkillParameter = { gameId: 'lol', skillKey: 'w', parameterKey: 'source_cost', name: '来源消耗', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null, levelValues: null, description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
const attributes = [{ attributeKey: 'mana' }];
const effect: SkillEffect = { gameId: 'lol', skillKey: 'w', effectKey: 'refund', name: '退款', description: null, sortOrder: 0, createdAt: '', updatedAt: '', results: [],
  lifecycle: { instanceScope: 'SOURCE', durationValue: parameterValue('source_cost'), maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 }, reapplicationStackMode: 'INCREASE', reapplicationDurationMode: 'KEEP', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null, firstPeriodicExecution: null } };
const draft = () => { const rule = createEmptyRuleDraft(); return { ...rule, ruleKey: 'refund_rule', name: '命中退款', eventSource: hit,
  actions: [{ ...rule.actions[0], name: '退款', detail: { effectKey: 'refund' }, runtimeInputBindings: [binding] }] }; };
const options = { includeRuleKey: true, parameters: [parameter], attributes, effectsByKey: new Map([['refund', effect]]), catalogStates: { effects: 'ready', processes: 'ready', skills: 'ready', parameters: 'ready', attributes: 'ready', formulas: 'ready' } as const };

describe('来源施放资源消耗绑定', () => {
  it('只保存属性引用，切换来源清除其他明细，聚合保存回读保持一致', () => {
    const changed = switchBindingSourceType(createEmptyBinding([], 'EVENT_VALUE'), 'SOURCE_CAST_RESOURCE_COST');
    expect(changed.detail).toEqual({ attributeKey: '' });
    expect(createEmptyBinding(['bind_1'], 'SOURCE_CAST_RESOURCE_COST').bindingKey).toBe('bind_2');
    const request = toCreateRequest(draft());
    expect(toCreateRequest(fromDetail(request))).toEqual(request);
    expect(request.actions[0].runtimeInputBindings[0]).toEqual(binding);
    expect(bindingSummary(binding)).toContain('来源施放资源消耗 / mana');
    expect(sourceCastResourceCostError(binding, hit, [parameter], attributes, 'ready')).toBeNull();
    expect(validateSkillTriggerDraft(draft(), options).ok).toBe(true);
  });

  it.each([
    { eventType: 'SKILL_HIT', detail: { sourceSkillKey: null } },
    { eventType: 'SKILL_HIT', detail: { sourceSkillKey: '' } },
    { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'q', useKind: 'ACTIVE', castPhase: 'INITIAL' } },
    { eventType: 'BASIC_ATTACK_HIT', detail: {} }
  ] satisfies SkillTriggerEventSource[])('非明确技能命中事件禁止该来源并确认清理 %j', (next) => {
    expect(allowsSourceCastResourceCost(next)).toBe(false);
    expect(sourceCastResourceCostError(binding, next, [parameter], attributes, 'ready')).toContain('已明确来源技能');
    expect(analyzeEventSwitchImpact(draft(), next).summary).toContain('将清除来源施放资源消耗绑定');
    expect(applyEventSwitchCleanup(draft(), next).actions[0].runtimeInputBindings).toEqual([]);
    expect(validateSkillTriggerDraft({ ...draft(), eventSource: next }, options).ok).toBe(false);
  });

  it('改变为另一个明确来源技能仍可复用属性绑定', () => {
    const next: SkillTriggerEventSource = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'e' } };
    expect(analyzeEventSwitchImpact(draft(), next).summary).toBe('');
    expect(applyEventSwitchCleanup(draft(), next).actions[0].runtimeInputBindings).toEqual([binding]);
  });

  it.each(['idle', 'loading', 'error'] as const)('属性目录 %s 时保留草稿并拒绝保存', (state) => {
    const before = structuredClone(draft());
    expect(requiredCatalogsForDraft(before)).toContain('attributes');
    expect(sourceCastResourceCostError(binding, hit, [parameter], attributes, state)).toContain('草稿已保留');
    expect(validateSkillTriggerDraft(before, { ...options, catalogStates: { ...options.catalogStates, attributes: state } }).ok).toBe(false);
    expect(before).toEqual(draft());
  });

  it('未知属性、静态参数、整数参数和不可达参数均拒绝保存', () => {
    expect(sourceCastResourceCostError(binding, hit, [parameter], [], 'ready')).toContain('已存在');
    expect(validateSkillTriggerDraft(draft(), { ...options, attributes: [] }).ok).toBe(false);
    for (const parameters of [[], [{ ...parameter, valueMode: 'FIXED' as const, fixedValue: 1 }], [{ ...parameter, valueType: 'INTEGER' as const }], [{ ...parameter, parameterKey: 'unused' }]]) {
      expect(sourceCastResourceCostError(binding, hit, parameters, attributes, 'ready')).toContain('可达');
      expect(validateSkillTriggerDraft(draft(), { ...options, parameters }).ok).toBe(false);
    }
    expect(evaluateBindingCompleteness([{ ...parameter, valueType: 'INTEGER' }], [binding])[0].typeCompatible).toBe(false);
  });

  it('过程完成与失败可以绑定，互相切换保留，其他过程时点清除', () => {
    const complete: SkillTriggerEventSource = {
      eventType: 'PROCESS_MOMENT',
      detail: { processKey: 'charge_cast', moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } }
    };
    const failure: SkillTriggerEventSource = {
      eventType: 'PROCESS_MOMENT',
      detail: { processKey: 'charge_cast', moment: { momentType: 'PROCESS_FAILURE', stepKey: null, failureReason: null } }
    };
    const start: SkillTriggerEventSource = {
      eventType: 'PROCESS_MOMENT',
      detail: { processKey: 'charge_cast', moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } }
    };
    const processes = [{ processKey: 'charge_cast', activationType: 'ACTIVE' as const }];
    expect(allowsSourceCastResourceCost(complete, processes)).toBe(true);
    expect(allowsSourceCastResourceCost(failure, processes)).toBe(true);
    expect(sourceCastResourceCostError(binding, complete, [parameter], attributes, 'ready', processes, 'ready')).toBeNull();
    const processDraft = { ...draft(), eventSource: complete };
    expect(analyzeEventSwitchImpact(processDraft, failure, null, processes).summary).toBe('');
    expect(applyEventSwitchCleanup(processDraft, failure, null, processes).actions[0].runtimeInputBindings).toEqual([binding]);
    expect(analyzeEventSwitchImpact(processDraft, start, null, processes).summary).toContain('将清除来源施放资源消耗绑定');
    expect(applyEventSwitchCleanup(processDraft, start, null, processes).actions[0].runtimeInputBindings).toEqual([]);
  });

  it('经当前技能公式可达的十进制动态参数也可绑定', () => {
    const formula: SkillFormula = { gameId: 'lol', skillKey: 'w', formulaKey: 'refund_total', name: '退款', description: null, sortOrder: 0, expression: { nodeType: 'PARAMETER', parameterKey: 'source_cost' }, createdAt: '', updatedAt: '' };
    const viaFormula = { ...effect, lifecycle: { ...effect.lifecycle!, durationValue: formulaValue('refund_total') } };
    expect(validateSkillTriggerDraft(draft(), { ...options, effectsByKey: new Map([['refund', viaFormula]]), formulasByKey: new Map([['refund_total', formula]]) }).ok).toBe(true);
  });
});
