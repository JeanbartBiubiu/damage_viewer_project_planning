import { describe, expect, it } from 'vitest';
import { fixedValue, formulaValue, isNumericValue, parameterValue } from '../../../types/numericValue';
import type { SkillParameter } from '../../../types/skillParameter';
import { numericIssuePath, numericValueError, numericValueSummary, staticChargeRangeIsValid } from './numericValueForm';
import { createEmptyInternalStateDraft, validateSkillInternalStateDraft } from './processes/internalStateForm';
import { createEmptyProcessDraft, createEmptyStepDraft, validateSkillProcessDraft } from './processes/processForm';
import { createEmptyEffectDraft, createEmptyResultDraft, validateSkillEffectDraft } from './effects/effectForm';
import { collectExecuteEffectValues, collectStartProcessValues, createEmptyRuleDraft, reachableRuntimeInputParameters, validateSkillTriggerDraft } from './triggers/triggerRuleForm';
import type { SkillEffect } from '../../../types/skillEffect';
import type { SkillProcess } from '../../../types/skillProcess';
import type { SkillInternalState } from '../../../types/skillInternalState';

const parameter = (overrides: Partial<SkillParameter> = {}): SkillParameter => ({
  gameId: 'lol', skillKey: 'q', parameterKey: 'amount', name: '数量', valueType: 'INTEGER', valueMode: 'FIXED',
  fixedValue: 2, levelValues: null, description: null, sortOrder: 0, createdAt: '', updatedAt: '', ...overrides
});

describe('三种取值的严格形状与静态边界', () => {
  it.each([
    'damage', { kind: 'FIXED', value: '0' }, { kind: 'FIXED', value: 0, formulaKey: 'damage' },
    { kind: 'PARAMETER', parameterKey: 'amount', value: 2 }, { kind: 'FORMULA', formulaKey: 'damage', parameterKey: 'amount' },
    { kind: 'FIXED', value: Number.NaN }, { kind: 'FIXED', value: Infinity }, { kind: 'PARAMETER', parameterKey: '' }
  ])('拒绝不完整或混合取值 %j', (value) => expect(isNumericValue(value)).toBe(false));

  it('保留固定0、负数和可选空值；目录失败只阻断相关分支', () => {
    expect(numericValueError(fixedValue(0), { formulas: [], parameters: [] }, { formulasState: 'failed', parametersState: 'failed' })).toBeUndefined();
    expect(numericValueSummary(fixedValue(0))).toBe('0');
    expect(numericValueError(null, {}, { required: false })).toBeUndefined();
    expect(numericValueError(null)).toBeTruthy();
    expect(numericValueError(fixedValue(-2))).toBeUndefined();
    expect(numericValueError(formulaValue('damage'), {}, { formulasState: 'failed' })).toBeTruthy();
    expect(numericValueError(parameterValue('amount'), { parameters: [] })).toBeTruthy();
  });

  it('逐级检查整数与正数要求，不用公式求值器判断公式', () => {
    const parameters = [parameter({ valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { '1': 2, '2': 0 } })];
    expect(numericValueError(parameterValue('amount'), { parameters }, { integer: true, min: 1 })).toBeTruthy();
    expect(numericValueError(parameterValue('amount'), { parameters }, { integer: true, min: 0 })).toBeUndefined();
    expect(numericValueError(parameterValue('amount'), { parameters: [parameter({ valueType: 'DECIMAL', fixedValue: 2 })] }, { integer: true })).toBeTruthy();
    expect(numericValueError(formulaValue('time'), { formulas: [{ formulaKey: 'time' }] }, { integer: true, min: 1 })).toBeUndefined();
  });

  it('在禁止动态输入的位置拒绝直接参数，允许动作消费的动态参数', () => {
    const parameters = [parameter({ valueMode: 'RUNTIME_INPUT', fixedValue: null })];
    expect(numericValueError(parameterValue('amount'), { parameters }, { allowRuntimeInput: false })).toBeTruthy();
    expect(numericValueError(parameterValue('amount'), { parameters })).toBeUndefined();
  });

  it('同等级按对应等级比较，不同等级维度检查全部组合', () => {
    const minimum = parameter({ parameterKey: 'minimum', valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { '1': 1, '2': 5 } });
    const maximum = parameter({ parameterKey: 'maximum', valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { '1': 2, '2': 6 } });
    expect(staticChargeRangeIsValid(parameterValue('minimum'), parameterValue('maximum'), [minimum, maximum])).toBe(true);
    expect(staticChargeRangeIsValid(parameterValue('minimum'), parameterValue('maximum'), [minimum, { ...maximum, valueMode: 'CHARACTER_LEVEL' }])).toBe(false);
    expect(staticChargeRangeIsValid(fixedValue(3), parameterValue('maximum'), [maximum])).toBe(false);
  });

  it('将服务端三选子字段错误保留在对应表单位置', () => {
    expect(numericIssuePath('results[0].valueRule.value.parameterKey')).toBe('results[0].valueRule.value');
    expect(numericIssuePath('steps[0].detail.delayValue.value')).toBe('steps[0].detail.delayValue');
    expect(numericIssuePath('detail.initialValue.kind')).toBe('detail.initialValue');
    expect(numericIssuePath('detail.options[0].initial')).toBe('detail.options[0].initial');
  });
});

describe('表单按使用位置校验取值', () => {
  it('计数上限可0，弹药上限须正整数，恢复时间允许正小数', () => {
    const counter = { ...createEmptyInternalStateDraft(), stateKey: 'counter', name: '计数', initialValue: fixedValue(0), maxValue: fixedValue(0) };
    const options = { includeStateKey: true, catalog: { formulas: [] }, catalogLoadState: { formulas: 'failed' as const } };
    const saved = validateSkillInternalStateDraft(counter, options);
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    if (saved.ok) expect(saved.normalized.detail).toEqual({ initialValue: fixedValue(0), maxValue: fixedValue(0) });
    const ammo = { ...createEmptyInternalStateDraft('AMMO'), stateKey: 'ammo', name: '弹药', initialValue: fixedValue(0), maxValue: fixedValue(0), recoveryIntervalValue: fixedValue(0.5) };
    expect(validateSkillInternalStateDraft(ammo, options).ok).toBe(false);
    expect(validateSkillInternalStateDraft({ ...ammo, maxValue: fixedValue(2) }, options).ok).toBe(true);
    expect(validateSkillInternalStateDraft({ ...ammo, maxValue: fixedValue(2.5) }, options).ok).toBe(false);
  });

  it('固定数值结果不依赖公式目录，按新shape保存', () => {
    const draft = { ...createEmptyEffectDraft(), effectKey: 'heal', name: '治疗', results: [{
      ...createEmptyResultDraft('DIRECT_HEAL'), resultKey: 'heal', name: '治疗', value: fixedValue(0)
    }] };
    const result = validateSkillEffectDraft(draft, { includeEffectKey: true, catalogLoadState: { formulas: 'failed' } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.normalized.results[0].valueRule?.value).toEqual(fixedValue(0));
  });

  it('步骤允许小数延迟，拒绝小数次数、零间隔和倒置的静态蓄力范围', () => {
    const validate = (step: ReturnType<typeof createEmptyStepDraft>, parameters?: SkillParameter[]) => validateSkillProcessDraft({
      ...createEmptyProcessDraft(), processKey: 'cast', name: '施放', steps: [{ ...step, stepKey: 'step', name: '步骤' }],
      effectBindings: [{ bindingKey: 'hit', effectKey: 'hit', momentType: 'STEP_EXECUTION', stepKey: 'step', sortOrder: '0', originalBindingKey: null }]
    }, { includeProcessKey: true, parameters });
    expect(validate({ ...createEmptyStepDraft('DELAY'), delayValue: fixedValue(0.5) }).ok).toBe(true);
    expect(validate({ ...createEmptyStepDraft('MULTI_HIT'), repeatCountValue: fixedValue(2.5), intervalValue: null }).ok).toBe(false);
    expect(validate({ ...createEmptyStepDraft('PERIODIC'), repeatCountValue: fixedValue(2), intervalValue: fixedValue(0) }).ok).toBe(false);
    expect(validate({ ...createEmptyStepDraft('CHARGE'), minimumChargeValue: parameterValue('amount'), maximumChargeValue: fixedValue(1) }, [parameter()]).ok).toBe(false);
  });

  it('每目标冷却必须大于0，阈值位置禁止直接动态参数', () => {
    const draft = { ...createEmptyRuleDraft(), ruleKey: 'guard', name: '保护', perTargetCooldownEnabled: true, perTargetCooldownDurationValue: fixedValue(0) };
    const result = validateSkillTriggerDraft(draft, { includeRuleKey: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.nestedErrors).toContainEqual({ path: 'perTargetCooldown.durationValue', message: '此处数值必须大于 0。' });
    const health = validateSkillTriggerDraft({ ...draft, perTargetCooldownDurationValue: fixedValue(0.5), eventSource: {
      eventType: 'HEALTH_THRESHOLD_CROSSED', detail: { subject: 'SOURCE', attributeKey: 'hp', direction: 'DOWNWARD', thresholdValue: parameterValue('amount') }
    } }, { includeRuleKey: true, parameters: [parameter({ valueMode: 'RUNTIME_INPUT', fixedValue: null })] });
    expect(health.ok).toBe(false);
    if (!health.ok) expect(health.nestedErrors.some((item) => item.path === 'eventSource.detail.thresholdValue' && item.message.includes('计算时传入'))).toBe(true);
  });
});

it('动态输入闭包同时收集直接取值、公式、效果及状态初始化，去重且不收集未启动冷却', () => {
  const effect = { lifecycle: null, results: [{ valueRule: { value: parameterValue('direct') }, detail: {} }] } as SkillEffect;
  const process = { cooldown: null, steps: [{ detail: { delayValue: formulaValue('computed') } }], effectBindings: [{ effectKey: 'hit' }],
    stateOperations: [{ stateKey: 'ammo', operation: 'CONSUME', value: fixedValue(1) }, { stateKey: 'cooldown', operation: 'START', value: null }]
  } as SkillProcess;
  const ammo = { stateType: 'AMMO', detail: { initialValue: parameterValue('initial'), maxValue: parameterValue('maximum'), recoveryIntervalValue: parameterValue('recovery') } } as SkillInternalState;
  const cooldown = { stateType: 'INTERNAL_COOLDOWN', detail: { durationValue: parameterValue('cooldown') } } as SkillInternalState;
  const values = [...collectExecuteEffectValues(effect), ...collectStartProcessValues(process, new Map([['hit', effect]]), new Map([['ammo', ammo], ['cooldown', cooldown]]))];
  const parameters = ['direct', 'computed_input', 'initial', 'maximum', 'recovery', 'cooldown', 'unused'].map((parameterKey) => parameter({ parameterKey, valueMode: 'RUNTIME_INPUT', fixedValue: null }));
  const formulas = new Map([['computed', { expression: { nodeType: 'PARAMETER', parameterKey: 'computed_input' } } as import('../../../types/skillFormula').SkillFormula]]);
  expect(reachableRuntimeInputParameters(values, formulas, parameters).map((item) => item.parameterKey)).toEqual(['direct', 'computed_input', 'initial', 'maximum', 'recovery', 'cooldown']);
});
