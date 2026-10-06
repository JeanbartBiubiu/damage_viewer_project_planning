import { describe, expect, it } from 'vitest';
import { simulationComplexSample } from '../../../../../tests/fixtures/simulationComplexSkills';
import { fixedValue } from '../../../../types/numericValue';
import { allowsChargeHitValue } from './chargeHitContext';
import { allowedEventValuesFor, analyzeEventSwitchImpact, applyEventSwitchCleanup, fromDetail, validateSkillTriggerDraft } from './triggerRuleForm';

function sample() {
  const snapshot = simulationComplexSample('CHARGE');
  const configuration = snapshot.skillConfigurations[1]!;
  const hit = configuration.triggerRules.find(rule => rule.eventSource.eventType === 'SKILL_HIT')!;
  const context = { skillKey: configuration.skill.skillKey, processes: configuration.processes, rules: configuration.triggerRules };
  const draft = fromDetail(hit, context.skillKey);
  const options = { includeRuleKey: true, skillKey: context.skillKey, parameters: configuration.parameters,
    effectsByKey: new Map(configuration.effects.map(effect => [effect.effectKey, effect])),
    formulasByKey: new Map(configuration.formulas.map(formula => [formula.formulaKey, formula])),
    processesByKey: new Map(context.processes.map(process => [process.processKey, process])), triggerRules: context.rules,
    damageTypesByKey: new Map(snapshot.catalogs.damageTypes.map(type => [type.damageTypeKey, type])) };
  return { context, draft, options };
}

describe('管理表单真实同源蓄力命中上下文', () => {
  it('完整首次与释放声明使原命中动作和条件可绑定真实充能值，缺上下文仍拒绝', () => {
    const { context, draft, options } = sample();
    draft.conditionGroups = [{ groupKey: 'charge_condition', name: '真实充能', sortOrder: '0', conditions: [{
      conditionKey: 'duration', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: '0',
      detail: { eventValueKey: 'CHARGE_DURATION_MS', comparator: 'GTE', comparisonValue: fixedValue(0) }
    }] }];
    expect(allowedEventValuesFor(draft.eventSource, null, context)).toContain('CHARGE_DURATION_MS');
    expect(validateSkillTriggerDraft(draft, options)).toMatchObject({ ok: true });
    const validation = validateSkillTriggerDraft(draft, { ...options, triggerRules: undefined });
    expect(validation.ok).toBe(false);
    expect(validation.nestedErrors.filter(error => error.path.includes('eventValueKey'))).toHaveLength(2);
  });

  it.each(['missing_initial', 'missing_release', 'wrong_process', 'wrong_step', 'foreign_source', 'ordinary_step'] as const)(
    '真实声明不完整或不属于该命中时拒绝：%s', kind => {
      const { context, draft } = sample();
      if (kind === 'missing_initial') context.rules = context.rules.filter(rule => rule.eventSource.eventType !== 'SKILL_USED'
        || rule.eventSource.detail.castPhase !== 'INITIAL');
      if (kind === 'missing_release') context.rules = context.rules.filter(rule => rule.ruleKey !== 'release_cast');
      if (kind === 'wrong_process') context.processes[0]!.processKey = 'foreign';
      if (kind === 'wrong_step') context.processes[0]!.steps[1]!.stepKey = 'foreign';
      if (kind === 'foreign_source' && draft.eventSource.eventType === 'SKILL_HIT') draft.eventSource.detail.sourceSkillKey = 'foreign';
      if (kind === 'ordinary_step') context.processes[0]!.steps[1] = { ...context.processes[0]!.steps[1]!, stepType: 'IMMEDIATE', detail: {} };
      expect(allowsChargeHitValue(draft.eventSource, context)).toBe(false);
      expect(allowedEventValuesFor(draft.eventSource, 'CHARGE', context)).not.toContain('CHARGE_DURATION_MS');
    });

  it('明确最大自动释放不要求额外释放根，仍要求同源首次真实过程', () => {
    const { context, draft, options } = sample();
    const step = context.processes[0]!.steps[1]!;
    if (step.stepType !== 'CHARGE') throw new Error('样例步骤不符');
    step.detail.releaseAtMaximum = true;
    context.rules = context.rules.filter(rule => rule.ruleKey !== 'release_cast');
    expect(allowsChargeHitValue(draft.eventSource, context)).toBe(true);
    expect(validateSkillTriggerDraft(draft, { ...options, triggerRules: context.rules }).ok).toBe(true);
    context.rules = [];
    expect(allowsChargeHitValue(draft.eventSource, context)).toBe(false);
  });

  it.each([false, null, 'true', 1])('没有释放根时，最大释放政策%s不能替代明确布尔true', policy => {
    const { context, draft } = sample();
    context.rules = context.rules.filter(rule => rule.ruleKey !== 'release_cast');
    Object.assign(context.processes[0]!.steps[1]!.detail, { releaseAtMaximum: policy });
    expect(allowsChargeHitValue(draft.eventSource, context)).toBe(false);
  });

  it('事件切换只保留仍有效的同源充能绑定，切换外来技能明确清理', () => {
    const { context, draft } = sample();
    expect(analyzeEventSwitchImpact(draft, draft.eventSource, null, context.processes, context).summary).toBe('');
    const foreign = { eventType: 'SKILL_HIT' as const, detail: { sourceSkillKey: 'foreign' } };
    expect(analyzeEventSwitchImpact(draft, foreign, null, context.processes, context).summary).toBeTruthy();
    expect(applyEventSwitchCleanup(draft, foreign, null, context.processes, context).actions[0]!.runtimeInputBindings).toEqual([]);
    expect(draft.actions[0]!.runtimeInputBindings).toHaveLength(1);
  });
});
