import { describe, expect, it } from 'vitest';
import { skillFormulaDefinition } from '../../../../../tests/fixtures/skillFormulaDefinition';
import { fixedValue, formulaValue, parameterValue } from '../../../../types/numericValue';
import type { SkillEffect } from '../../../../types/skillEffect';
import type { SkillFormula } from '../../../../types/skillFormula';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillTriggerEventSource, SkillTriggerSceneInitialParameterBinding } from '../../../../types/skillTriggerRule';
import {
  allowsSceneInitialParameter, applyEventSwitchCleanup, bindingSummary, createEmptyActionDraft,
  createEmptyBinding, createEmptyBindingDetail, createEmptyConditionDraft, createEmptyGroupDraft,
  createEmptyRuleDraft, evaluateBindingCompleteness, fromDetail, requiredCatalogsForDraft,
  sceneInitialParameterError, shouldKeepDraftOnHttpStatus, sourceValueDomain, switchBindingSourceType,
  toCreateRequest, validateSkillTriggerDraft, type SkillTriggerExecuteEffectActionDraft, type SkillTriggerRuleDraft
} from './triggerRuleForm';

const skillKey = 'unrelated_origin_alpha';
const stamp = { gameId: 'example', skillKey, createdAt: '', updatedAt: '' };
const parameter: SkillParameter = { ...stamp, parameterKey: 'initial_count', name: '机制初值', valueMode: 'RUNTIME_INPUT',
  valueType: 'INTEGER', fixedValue: null, levelValues: null, description: null, sortOrder: 0 };
const binding: SkillTriggerSceneInitialParameterBinding = { bindingKey: 'initial_input', parameterKey: parameter.parameterKey,
  sourceType: 'SCENE_INITIAL_PARAMETER', detail: { minValue: -5, maxValue: 5 } };
const event: SkillTriggerEventSource = { eventType: 'SOURCE_INITIALIZED', detail: {} };
const formula: SkillFormula = { ...stamp, formulaKey: 'initial_bonus', name: '初始化加算', description: null, sortOrder: 0,
  expression: skillFormulaDefinition(skillKey, { nodeType: 'PARAMETER', parameterKey: parameter.parameterKey }) };
const effect: SkillEffect = { ...stamp, effectKey: 'initial_effect', name: '初始化效果', description: null, sortOrder: 0,
  lifecycle: null, results: [{ resultKey: 'initial_armor', name: '初始护甲', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE',
    description: null, sortOrder: 0, lifecycleBehavior: null, spellShieldBlockScope: null,
    valueRule: { value: formulaValue(formula.formulaKey), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
    detail: { attributeKey: 'armor', operation: 'INCREASE', modifierZoneKey: null } }] };
const action = (): SkillTriggerExecuteEffectActionDraft => ({ ...createEmptyActionDraft([], 'EXECUTE_EFFECT'), name: '初始化',
  targetContext: 'EVENT_SOURCE', detail: { effectKey: effect.effectKey }, runtimeInputBindings: [structuredClone(binding)] });
const draft = (): SkillTriggerRuleDraft => ({ ...createEmptyRuleDraft(), ruleKey: 'initialize_values', name: '初始化规则', eventSource: event, actions: [action()] });
const options = { includeRuleKey: true, skillKey, parameters: [parameter],
  effectsByKey: new Map([[effect.effectKey, effect]]), formulasByKey: new Map([[formula.formulaKey, formula]]),
  catalogStates: { effects: 'ready', processes: 'ready', parameters: 'ready', formulas: 'ready' } as const };
const error = (selected = binding, param = parameter) => sceneInitialParameterError(selected, event, skillKey, action(), [param], effect);

describe('场景显式初值管理表单', () => {
  it('新建上下界留空，切换丢弃旧明细，反向切回也不恢复旧值', () => {
    expect(createEmptyBindingDetail('SCENE_INITIAL_PARAMETER')).toEqual({ minValue: Number.NaN, maxValue: Number.NaN });
    const empty = createEmptyBinding([], 'SCENE_INITIAL_PARAMETER');
    expect(bindingSummary(empty)).toContain('下界未填写 / 上界未填写');
    expect(error({ ...empty, parameterKey: parameter.parameterKey })).toContain('明确填写');
    const snapshot = switchBindingSourceType(binding, 'SCENE_ATTRIBUTE_SNAPSHOT');
    expect(snapshot.detail).toEqual({ subject: 'SOURCE', attributeKey: '', sources: [] });
    const switched = switchBindingSourceType(snapshot, 'SCENE_INITIAL_PARAMETER');
    expect(switched.bindingKey).toBe(binding.bindingKey);
    expect(switched.parameterKey).toBe(binding.parameterKey);
    expect(switched.detail).toEqual({ minValue: Number.NaN, maxValue: Number.NaN });
    expect(switched.detail).not.toHaveProperty('subject');
    expect(switchBindingSourceType(binding, 'SCENE_INITIAL_PARAMETER')).toBe(binding);
  });

  it.each([{ minValue: 0, maxValue: 0 }, { minValue: -5, maxValue: 5 },
    { minValue: -Number.MAX_SAFE_INTEGER, maxValue: Number.MAX_SAFE_INTEGER }])('接受通用整数范围 %j', (range) => {
    const selected = { ...binding, detail: range };
    expect(error(selected)).toBeNull();
    expect(sourceValueDomain(selected)).toBeNull();
    expect(evaluateBindingCompleteness([parameter], [selected])[0].typeCompatible).toBe(true);
    const changed = draft(); changed.actions[0].runtimeInputBindings = [selected];
    expect(validateSkillTriggerDraft(changed, options).ok).toBe(true);
  });

  it('小数边界仅适用于小数参数，整数检查不偷偷取整或钳制', () => {
    const range = { ...binding, detail: { minValue: -.5, maxValue: 1.25 } };
    expect(error(range)).toContain('安全整数');
    expect(error(range, { ...parameter, valueType: 'DECIMAL' })).toBeNull();
    expect(error({ ...binding, detail: { minValue: 0, maxValue: Number.MAX_SAFE_INTEGER + 1 } })).toContain('安全整数');
    expect(error({ ...binding, detail: { minValue: 5, maxValue: -5 } })).toContain('不能大于');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('拒绝非有限边界 %s', (value) => {
    expect(error({ ...binding, detail: { minValue: value, maxValue: 5 } })).toContain('有限数值');
    expect(error({ ...binding, detail: { minValue: -5, maxValue: value } })).toContain('有限数值');
  });

  it('保存回读逐项保留原声明，不添加本场取值，也不需要属性目录', () => {
    const request = toCreateRequest(draft());
    expect(toCreateRequest(fromDetail(request))).toEqual(request);
    expect(request.actions[0].runtimeInputBindings).toEqual([binding]);
    expect(bindingSummary(binding)).toContain('下界-5 / 上界5 / 本场明确填写');
    expect(requiredCatalogsForDraft(draft(), options)).toEqual(expect.arrayContaining(['effects', 'parameters', 'formulas']));
    expect(requiredCatalogsForDraft(draft(), options)).not.toContain('attributes');
    expect(validateSkillTriggerDraft(draft(), options).ok).toBe(true);
    for (const status of [400, 409]) expect(shouldKeepDraftOnHttpStatus(status)).toBe(true);
  });

  it.each([
    { eventType: 'SKILL_USED', detail: { sourceSkillKey: skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
    { eventType: 'BASIC_ATTACK_HIT', detail: {} },
    { eventType: 'LIFECYCLE_MOMENT', detail: { effectKey: effect.effectKey, moment: 'PERIODIC' } }
  ] satisfies SkillTriggerEventSource[])('非初始化入口不暴露来源，失效编辑草稿保留并拒绝保存 %j', (nextEvent) => {
    expect(allowsSceneInitialParameter(nextEvent, skillKey, action())).toBe(false);
    const changed = applyEventSwitchCleanup(draft(), nextEvent);
    expect(changed.actions[0].runtimeInputBindings).toEqual([binding]);
    expect(validateSkillTriggerDraft(changed, options).ok).toBe(false);
  });

  it('只允许同技能实际结果消费，不向过程、错误目标或外技能供值', () => {
    expect(allowsSceneInitialParameter(event, skillKey, action())).toBe(true);
    expect(allowsSceneInitialParameter(event, skillKey, createEmptyActionDraft([], 'START_PROCESS'))).toBe(false);
    expect(allowsSceneInitialParameter(event, skillKey, { ...action(), targetContext: 'CURRENT_TARGET' })).toBe(false);
    expect(sceneInitialParameterError(binding, event, skillKey, action(), [], effect)).toContain('实际消费');
    expect(error(binding, { ...parameter, skillKey: 'different_origin_beta' })).toContain('实际消费');
    expect(error(binding, { ...parameter, valueMode: 'FIXED', fixedValue: 0 })).toContain('实际消费');
    expect(sceneInitialParameterError(binding, event, skillKey, action(), [parameter], { skillKey: 'different_origin_beta' })).toContain('草稿已保留');
    expect(sceneInitialParameterError(binding, event, skillKey, action(), [parameter], undefined)).toContain('草稿已保留');
    const unused = structuredClone(effect);
    if (unused.results[0].resultType !== 'ATTRIBUTE_CHANGE') throw new Error('expected attribute result');
    unused.results[0].valueRule.value = fixedValue(1);
    expect(validateSkillTriggerDraft(draft(), { ...options, effectsByKey: new Map([[effect.effectKey, unused]]) }).ok).toBe(false);
  });

  it('结果未消费但生命周期消费仍拒绝，结果与生命周期同时消费也拒绝', () => {
    for (const resultConsumes of [false, true]) {
      const changed = structuredClone(effect);
      if (changed.results[0].resultType !== 'ATTRIBUTE_CHANGE') throw new Error('expected attribute result');
      if (!resultConsumes) changed.results[0].valueRule.value = fixedValue(1);
      changed.lifecycle = { durationValue: null, maxStacksValue: parameterValue(parameter.parameterKey), applicationStacksValue: fixedValue(1),
        instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'KEEP_REMAINING',
        expiryMode: 'EXPLICIT_ONLY', periodicIntervalValue: null, firstPeriodicExecution: null };
      const result = validateSkillTriggerDraft(draft(), { ...options, effectsByKey: new Map([[changed.effectKey, changed]]) });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.nestedErrors.some((item) => item.message.includes('生命周期读取'))).toBe(true);
    }
  });

  it('条件和兄弟动作不能借同一声明参数', () => {
    const conditional = draft();
    const condition = createEmptyConditionDraft([], 'ATTRIBUTE_COMPARE');
    condition.detail.attributeKey = 'armor'; condition.detail.comparisonValue = parameterValue(parameter.parameterKey);
    conditional.conditionGroups = [{ ...createEmptyGroupDraft([]), name: '条件', conditions: [condition] }];
    expect(validateSkillTriggerDraft(conditional, options).ok).toBe(false);
    const sibling = draft();
    sibling.actions.push({ ...action(), actionKey: 'unbound_sibling', runtimeInputBindings: [] });
    expect(validateSkillTriggerDraft(sibling, options).ok).toBe(false);
  });

  it('重复、多余、外来明细及未加载目录都保留草稿并拒绝保存', () => {
    const original = draft();
    for (const bindings of [[binding, { ...binding, bindingKey: 'duplicate' }], [{ ...binding, parameterKey: 'unused' }],
      [{ ...binding, detail: { ...binding.detail, value: 0 } }], [{ ...binding, detail: { ...binding.detail, defaultValue: 0 } }]]) {
      const changed = draft(); changed.actions[0].runtimeInputBindings = bindings;
      expect(validateSkillTriggerDraft(changed, options).ok).toBe(false);
    }
    for (const state of ['idle', 'loading', 'error'] as const) {
      expect(validateSkillTriggerDraft(original, { ...options, catalogStates: { ...options.catalogStates, effects: state } }).ok).toBe(false);
    }
    expect(original).toEqual(draft());
  });
});
