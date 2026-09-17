import { describe, expect, it } from 'vitest';
import { fixedValue, formulaValue, parameterValue } from '../../../../types/numericValue';
import type { SkillEffect, SkillEffectLifecycleInstanceScope } from '../../../../types/skillEffect';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillTriggerLifecycleCheckDetail, SkillTriggerRuleDetail } from '../../../../types/skillTriggerRule';
import { changeLifecycleCheckKind, changeLifecycleEffect, lifecycleConditionEffects, lifecycleConditionError } from './lifecycleCondition';
import { analyzeEventSwitchImpact, applyEventSwitchCleanup, collectDirectFormulaKeys, createEmptyConditionDraft, createEmptyRuleDraft, fromDetail, requiredCatalogsForDraft, toCreateRequest, validateSkillTriggerDraft } from './triggerRuleForm';

const mark = (scope: SkillEffectLifecycleInstanceScope = 'SOURCE_TARGET'): SkillEffect => ({
  gameId: 'lol', skillKey: 'w', effectKey: 'mark', name: '印记', description: null, sortOrder: 0, createdAt: '', updatedAt: '', results: [],
  lifecycle: { instanceScope: scope, durationValue: null, maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
    reapplicationStackMode: 'INCREASE', reapplicationDurationMode: 'KEEP', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null, firstPeriodicExecution: null }
});
const present: SkillTriggerLifecycleCheckDetail = { effectKey: 'mark', subject: 'CURRENT_TARGET', checkKind: 'PRESENT', comparator: null, comparisonValue: null };
const stacks = (comparisonValue = fixedValue(0)): SkillTriggerLifecycleCheckDetail => ({ ...present, checkKind: 'STACKS_COMPARE', comparator: 'GTE', comparisonValue });
const parameter = (overrides: Partial<SkillParameter> = {}): SkillParameter => ({
  gameId: 'lol', skillKey: 'w', parameterKey: 'count', name: '层数', valueMode: 'FIXED', valueType: 'INTEGER', fixedValue: 0,
  levelValues: null, description: null, sortOrder: 0, createdAt: '', updatedAt: '', ...overrides
});
const rule = (detail: SkillTriggerLifecycleCheckDetail) => ({
  ...createEmptyRuleDraft(), ruleKey: 'detonate', name: '引爆',
  conditionGroups: [{ draftId: 'marked-draft', groupKey: 'marked', name: '存在印记', sortOrder: '0', conditions: [{ ...createEmptyConditionDraft([], 'LIFECYCLE_CHECK'), detail }] }],
  actions: [{ ...createEmptyRuleDraft().actions[0], name: '执行' }]
});

describe('生命周期条件范围与取值', () => {
  it.each(['SKILL', 'SOURCE', 'TARGET', 'SOURCE_TARGET'] as const)('%s 按目标效果范围决定主体，不复制范围', (scope) => {
    const effect = mark(scope);
    const changed = changeLifecycleEffect(present, effect);
    expect(changed.subject).toBe(scope === 'SKILL' || scope === 'SOURCE' ? null : 'CURRENT_TARGET');
    expect(changed).not.toHaveProperty('scope');
    expect(lifecycleConditionError(changed, effect, ['SOURCE', 'CURRENT_TARGET'])).toBeNull();
    const invalid = { ...changed, subject: changed.subject === null ? 'CURRENT_TARGET' as const : null };
    expect(lifecycleConditionError(invalid, effect, ['SOURCE', 'CURRENT_TARGET'])?.field).toBe('subject');
  });

  it('候选仅当前技能有生命周期的效果，缺失或跨技能引用不允许确认', () => {
    const effect = mark();
    expect(lifecycleConditionEffects([effect, { ...effect, skillKey: 'q' }, { ...effect, lifecycle: null }], 'w')).toEqual([effect]);
    expect(lifecycleConditionError(present, undefined, ['CURRENT_TARGET'])?.field).toBe('effectKey');
    expect(lifecycleConditionError(present, { ...effect, lifecycle: null }, ['CURRENT_TARGET'])?.field).toBe('effectKey');
    expect(lifecycleConditionError(present, effect, ['CURRENT_TARGET'], {}, {}, 'q')?.field).toBe('effectKey');
  });

  it('切换为存在或不存在清除比较字段，切换范围清除不适用主体', () => {
    for (const kind of ['PRESENT', 'ABSENT'] as const) {
      expect(changeLifecycleCheckKind(stacks(), kind)).toEqual({ ...present, checkKind: kind });
    }
    expect(changeLifecycleEffect(stacks(), mark('SKILL'))).toEqual({ ...stacks(), subject: null });
    expect(changeLifecycleCheckKind(present, 'STACKS_COMPARE').comparisonValue).toEqual(fixedValue(Number.NaN));
  });

  it.each([-1, 0.5])('拒绝固定层数 %s，允许固定0', (value) => {
    expect(lifecycleConditionError(stacks(fixedValue(value)), mark(), ['CURRENT_TARGET'])?.field).toBe('comparisonValue');
    expect(lifecycleConditionError(stacks(), mark(), ['CURRENT_TARGET'])).toBeNull();
  });

  it('逐级检查静态参数，禁止直接运行时参数与错误声明', () => {
    for (const value of [parameter({ valueMode: 'RUNTIME_INPUT', fixedValue: null }), parameter({ valueType: 'DECIMAL' }),
      parameter({ valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { '1': 0, '2': -1 } })]) {
      expect(lifecycleConditionError(stacks(parameterValue('count')), mark(), ['CURRENT_TARGET'], { parameters: [value] })?.field).toBe('comparisonValue');
    }
    expect(lifecycleConditionError(stacks(parameterValue('count')), mark(), ['CURRENT_TARGET'], { parameters: [parameter()] })).toBeNull();
  });

  it('没有事件来源的事件禁止该主体，并沿现有切事件确认清理', () => {
    const draft = rule({ ...present, subject: 'EVENT_SOURCE' });
    const next = { eventType: 'SKILL_USED', detail: { skillKey: null } } as const;
    expect(analyzeEventSwitchImpact(draft, next).clearsEventSourceRefs).toBe(true);
    expect(applyEventSwitchCleanup(draft, next).conditionGroups[0].conditions[0].detail).toMatchObject({ subject: 'CURRENT_TARGET' });
    expect(lifecycleConditionError({ ...present, subject: 'EVENT_SOURCE' }, mark(), ['SOURCE', 'CURRENT_TARGET'])?.field).toBe('subject');
  });
});

describe('生命周期条件聚合草稿', () => {
  it.each([present, { ...present, checkKind: 'ABSENT' } as const, stacks(parameterValue('count'))])('三分支保存回读保留空值和新取值', (detail) => {
    const request = toCreateRequest(rule(detail));
    const reopened = fromDetail({ ...request, createdAt: '', updatedAt: '' } as SkillTriggerRuleDetail);
    expect(toCreateRequest(reopened)).toEqual(request);
    expect(reopened.conditionGroups[0].conditions[0].detail).toEqual(detail);
  });

  it('存在条件只读实例，不将生命周期自身取值加入动作动态依赖；层数比较禁止经公式动态输入', () => {
    const effect = mark();
    effect.lifecycle!.durationValue = parameterValue('count');
    expect(requiredCatalogsForDraft(rule(present), { effectsByKey: new Map([['mark', effect]]) })).not.toContain('parameters');
    const draft = rule(stacks(formulaValue('computed')));
    expect(collectDirectFormulaKeys(draft)).toEqual(['computed']);
    const validation = validateSkillTriggerDraft(draft, { includeRuleKey: true, skillKey: 'w', effectsByKey: new Map([['mark', effect]]), parameters: [parameter({ valueMode: 'RUNTIME_INPUT', fixedValue: null })],
      formulasByKey: new Map([['computed', { expression: { nodeType: 'PARAMETER', parameterKey: 'count' }, formulaKey: 'computed' } as import('../../../../types/skillFormula').SkillFormula]]) });
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.nestedErrors.some((item) => item.message.includes('不能引用计算时传入参数'))).toBe(true);
  });

  it('删除旧条件后默认新键不会复用基线旧键', () => {
    expect(createEmptyConditionDraft(['cond_1'], 'LIFECYCLE_CHECK').conditionKey).toBe('cond_2');
  });
});
