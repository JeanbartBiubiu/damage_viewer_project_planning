import { describe, expect, it } from 'vitest';
import { fixedValue, parameterValue } from '../../../../types/numericValue';
import type { SkillEffect, SkillEffectLifecycleInstanceScope } from '../../../../types/skillEffect';
import type { SkillParameter } from '../../../../types/skillParameter';
import type { SkillTriggerEventValueCompareDetail, SkillTriggerRuleDetail } from '../../../../types/skillTriggerRule';
import { ownShieldAbsorptionResults, shieldAbsorptionConditionError } from './shieldAbsorptionCondition';
import {
  analyzeEventSwitchImpact, applyEventSwitchCleanup, createEmptyConditionDraft, createEmptyEventSource,
  fromDetail, patchEventValueCompareDetail, toCreateRequest, toUpdateRequest, validateSkillTriggerDraft,
  type SkillTriggerEventValueCompareConditionDraft
} from './triggerRuleForm';

const selectedShield = () => ({ skillKey: 'guard', effectKey: 'own_shield', resultKey: 'shield' });
const selectedDetail = (): SkillTriggerEventValueCompareDetail => ({
  eventValueKey: 'SHIELD_ABSORBED', shieldResult: selectedShield(), comparator: 'GT', comparisonValue: fixedValue(0)
});

function shieldEffect(): SkillEffect {
  return {
    gameId: 'mechanism_lab', skillKey: 'guard', effectKey: 'own_shield', name: '自身关联盾', description: null,
    sortOrder: 10, createdAt: '', updatedAt: '',
    lifecycle: { instanceScope: 'SOURCE', durationValue: null, maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
      reapplicationStackMode: 'KEEP', reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY',
      periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: 'shield' },
    results: [{ resultKey: 'shield', name: '普通盾', resultType: 'NORMAL_SHIELD', target: 'SOURCE', description: null,
      sortOrder: 10, lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
        reapplicationValueMode: 'REPLACE', periodicExecutionMode: null }, spellShieldBlockScope: null,
      valueRule: { value: fixedValue(100), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
      detail: { absorbedDamageTypeKey: null, decayMode: 'NONE' } }]
  };
}

function changedEffect(change: (effect: SkillEffect) => void): SkillEffect {
  const effect = shieldEffect(); change(effect); return effect;
}

function rule(): SkillTriggerRuleDetail {
  return {
    ruleKey: 'shield_starts_wait', name: '自身盾受损起计', description: null, sortOrder: 10,
    eventSource: { eventType: 'DAMAGE_TAKEN', detail: {
      sourceSkillKey: null, damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY'
    } },
    conditionGroups: [{ groupKey: 'first_own_shield', name: '自身盾实际吸收', sortOrder: 10,
      conditions: [{ conditionKey: 'absorbed', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 10, detail: selectedDetail() }] }],
    actions: [{ actionKey: 'apply', name: '执行自身盾', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
      targetContext: 'CURRENT_TARGET', detail: { effectKey: 'own_shield' }, runtimeInputBindings: [], resultModifiers: [] }],
    perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
  };
}

function validate(detail = rule(), effects: SkillEffect[] = [shieldEffect()], skillKey: string | undefined = 'guard') {
  return validateSkillTriggerDraft(fromDetail(detail), { includeRuleKey: true, skillKey,
    effectsByKey: new Map(effects.map(effect => [effect.effectKey, effect])) });
}

function selectorErrors(detail: SkillTriggerRuleDetail, effects: SkillEffect[] = [shieldEffect()], skillKey: string | undefined = 'guard') {
  const result = validate(detail, effects, skillKey);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.nestedErrors.filter(error => error.path.endsWith('.detail.shieldResult'));
}

describe('自身盾吸收结果的管理选择与校验', () => {
  it('只列出当前技能的自身唯一关联盾，并且不修改目录', () => {
    const own = shieldEffect(), foreign = { ...shieldEffect(), skillKey: 'another_guard', effectKey: 'other_shield' };
    const effects = [foreign, own], before = structuredClone(effects);
    expect(ownShieldAbsorptionResults(effects, 'guard')).toEqual([{ effect: own, result: own.results[0] }]);
    expect(shieldAbsorptionConditionError(selectedDetail(), 'DAMAGE_TAKEN', 'guard', effects)).toBeNull();
    expect(effects).toEqual(before);
  });

  it('关联盾附带既有静态属性时仍可选择，不误排除盾上护甲', () => {
    const effect = shieldEffect();
    effect.results.push({ resultKey: 'armor', name: '关联护甲', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description: null,
      sortOrder: 20, lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
        reapplicationValueMode: 'REPLACE', periodicExecutionMode: null }, spellShieldBlockScope: null,
      valueRule: { value: fixedValue(20), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
      detail: { attributeKey: 'armor', operation: 'INCREASE', modifierZoneKey: 'attribute_flat' } });
    expect(ownShieldAbsorptionResults([effect], 'guard').map(row => row.result.resultKey)).toEqual(['shield']);
    expect(shieldAbsorptionConditionError(selectedDetail(), 'DAMAGE_TAKEN', 'guard', [effect])).toBeNull();
  });

  it.each<SkillEffectLifecycleInstanceScope>(['SKILL', 'TARGET', 'SOURCE_TARGET'])('排除错误实例范围%s', scope => {
    const effect = changedEffect(value => { value.lifecycle!.instanceScope = scope; });
    expect(ownShieldAbsorptionResults([effect], 'guard')).toEqual([]);
    expect(shieldAbsorptionConditionError(selectedDetail(), 'DAMAGE_TAKEN', 'guard', [effect])).not.toBeNull();
  });

  it.each<[string, (effect: SkillEffect) => void]>([
    ['没有生命周期', effect => { effect.lifecycle = null; }],
    ['盾作用于目标', effect => { effect.results[0]!.target = 'TARGET'; }],
    ['没有普通盾', effect => { effect.results = []; }],
    ['同一效果有两面普通盾', effect => { effect.results.push({ ...structuredClone(effect.results[0]!), resultKey: 'other' }); }],
    ['终止结果缺失', effect => { effect.lifecycle!.endWhenShieldEndsResultKey = null; }],
    ['终止结果不是该盾', effect => { effect.lifecycle!.endWhenShieldEndsResultKey = 'other'; }],
    ['明确多层', effect => { effect.lifecycle!.maxStacksValue = fixedValue(2); }],
    ['明确一次施加多层', effect => { effect.lifecycle!.applicationStacksValue = fixedValue(2); }],
    ['普通盾不是持续结果', effect => { effect.results[0]!.lifecycleBehavior!.moment = 'APPLICATION'; }],
    ['非施加快照', effect => { effect.results[0]!.lifecycleBehavior!.valueReadMode = 'MOMENT_EVALUATION'; }],
    ['非共享盾值', effect => { effect.results[0]!.lifecycleBehavior!.stackValueMode = 'PER_STACK'; }],
    ['不覆盖重施值', effect => { effect.results[0]!.lifecycleBehavior!.reapplicationValueMode = null; }],
    ['带周期模式', effect => { effect.results[0]!.lifecycleBehavior!.periodicExecutionMode = 'ONCE_PER_ACTIVE_STACK'; }]
  ])('拒绝不符合自身单层关联盾的目录：%s', (_name, mutate) => {
    const effect = changedEffect(mutate);
    expect(ownShieldAbsorptionResults([effect], 'guard')).toEqual([]);
    expect(shieldAbsorptionConditionError(selectedDetail(), 'DAMAGE_TAKEN', 'guard', [effect])).not.toBeNull();
  });

  it('已知等级参数逐值核单层，不能只看当前级或第一个值', () => {
    const effect = changedEffect(value => { value.lifecycle!.maxStacksValue = parameterValue('layers'); });
    const parameter: SkillParameter = { gameId: 'mechanism_lab', skillKey: 'guard', parameterKey: 'layers',
      name: '层数', valueType: 'INTEGER', valueMode: 'SKILL_LEVEL', fixedValue: null,
      levelValues: { '1': 1, '2': 1 }, description: null, sortOrder: 10, createdAt: '', updatedAt: '' };
    expect(ownShieldAbsorptionResults([effect], 'guard', [parameter])).toHaveLength(1);
    expect(shieldAbsorptionConditionError(selectedDetail(), 'DAMAGE_TAKEN', 'guard', [effect], [parameter])).toBeNull();
    const multiple = { ...parameter, levelValues: { '1': 1, '2': 2 } };
    expect(ownShieldAbsorptionResults([effect], 'guard', [multiple])).toEqual([]);
    expect(shieldAbsorptionConditionError(selectedDetail(), 'DAMAGE_TAKEN', 'guard', [effect], [multiple])).not.toBeNull();
    const result = validateSkillTriggerDraft(fromDetail(rule()), { includeRuleKey: true, skillKey: 'guard',
      effectsByKey: new Map([['own_shield', effect]]), parameters: [multiple] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.nestedErrors.some(error => error.path.endsWith('.detail.shieldResult'))).toBe(true);
  });

  it('外技能、未知技能上下文、未知效果和未知结果均不能充当自身盾', () => {
    const foreign = { ...selectedDetail(), shieldResult: { ...selectedShield(), skillKey: 'another_guard' } };
    expect(shieldAbsorptionConditionError(foreign, 'DAMAGE_TAKEN', 'guard', [shieldEffect()])).toContain('当前技能');
    expect(shieldAbsorptionConditionError(selectedDetail(), 'DAMAGE_TAKEN', undefined, [shieldEffect()])).toContain('当前技能');
    for (const patch of [{ effectKey: 'missing' }, { resultKey: 'missing' }]) {
      expect(shieldAbsorptionConditionError({ ...selectedDetail(), shieldResult: { ...selectedShield(), ...patch } },
        'DAMAGE_TAKEN', 'guard', [shieldEffect()])).not.toBeNull();
    }
    expect(shieldAbsorptionConditionError(selectedDetail(), 'DAMAGE_TAKEN', 'guard', [])).not.toBeNull();
  });

  it.each<[string, unknown]>([
    ['null', null], ['undefined', undefined], ['空对象', {}], ['数组', []],
    ['不完整', { skillKey: 'guard', effectKey: 'own_shield' }],
    ['额外字段', { ...selectedShield(), source: 'source' }], ['非法键', { ...selectedShield(), resultKey: 'Shield' }]
  ])('helper拒绝损坏的选择器：%s', (_name, shieldResult) => {
    const detail = { ...selectedDetail(), shieldResult } as unknown as SkillTriggerEventValueCompareDetail;
    expect(shieldAbsorptionConditionError(detail, 'DAMAGE_TAKEN', 'guard', [shieldEffect()])).not.toBeNull();
  });

  it('省略选择器沿用原总量条件，受伤限定仅约束显式自身选择器', () => {
    const detail = selectedDetail(); delete detail.shieldResult;
    expect(shieldAbsorptionConditionError(detail, 'DAMAGE_TAKEN', 'guard', [])).toBeNull();
    expect(shieldAbsorptionConditionError(detail, 'DAMAGE_DEALT', 'guard', [])).toBeNull();
    expect(shieldAbsorptionConditionError(selectedDetail(), 'DAMAGE_DEALT', 'guard', [shieldEffect()])).not.toBeNull();
    expect(shieldAbsorptionConditionError({ ...selectedDetail(), eventValueKey: 'ACTUAL_HP_LOSS' },
      'DAMAGE_TAKEN', 'guard', [shieldEffect()])).not.toBeNull();
  });
});

describe('自身盾事件值的草稿往返与切换', () => {
  const condition = (): SkillTriggerEventValueCompareConditionDraft => ({
    ...createEmptyConditionDraft([], 'EVENT_VALUE_COMPARE'), detail: selectedDetail()
  });

  it('切换事件值删除选择器且不修改原条件，再切回来不默认选择盾', () => {
    const original = condition(), before = structuredClone(original);
    const hp = patchEventValueCompareDetail(original, { eventValueKey: 'ACTUAL_HP_LOSS' });
    expect(hp.detail).not.toHaveProperty('shieldResult');
    expect(hp.detail.comparisonValue).toEqual(fixedValue(0));
    expect(original).toEqual(before);
    expect(patchEventValueCompareDetail(hp, { eventValueKey: 'SHIELD_ABSORBED' }).detail).not.toHaveProperty('shieldResult');
  });

  it('同一事件值修改比较数值保留选择器，明确移除后省略而不是发undefined', () => {
    const original = condition();
    const changed = patchEventValueCompareDetail(original, { comparator: 'GTE', comparisonValue: fixedValue(10) });
    expect(changed.detail).toEqual({ ...selectedDetail(), comparator: 'GTE', comparisonValue: fixedValue(10) });
    expect(patchEventValueCompareDetail(changed, { shieldResult: undefined }).detail).not.toHaveProperty('shieldResult');
    expect(original.detail).toEqual(selectedDetail());
  });

  it('完整详情到草稿、创建、更新及重开保留选择器', () => {
    const input = rule(), before = structuredClone(input), draft = fromDetail(input, 'guard');
    expect(toCreateRequest(draft)).toEqual(before);
    expect(toUpdateRequest(draft)).toEqual(Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'ruleKey')));
    expect(toCreateRequest(fromDetail(toCreateRequest(draft), 'guard'))).toEqual(before);
    expect(input).toEqual(before);
    expect(validate(input).ok).toBe(true);
  });

  it('切成仍支持总吸收的伤害发出事件时，提示并移除指定自身盾条件', () => {
    const draft = fromDetail(rule()), before = structuredClone(draft), next = createEmptyEventSource('DAMAGE_DEALT');
    expect(analyzeEventSwitchImpact(draft, next).summary).toContain('指定自身盾吸收事实');
    expect(applyEventSwitchCleanup(draft, next).conditionGroups).toEqual([]);
    expect(draft).toEqual(before);
  });

  it('事件切换只删除不适用的自身盾条件，保留同组合法总量条件', () => {
    const detail = rule(), total = structuredClone(detail.conditionGroups[0]!.conditions[0]!);
    total.conditionKey = 'total';
    if (total.conditionType !== 'EVENT_VALUE_COMPARE') throw new Error('测试条件类型错误');
    delete total.detail.shieldResult;
    detail.conditionGroups[0]!.conditions.push(total);
    const draft = fromDetail(detail), next = createEmptyEventSource('DAMAGE_DEALT');
    const cleaned = applyEventSwitchCleanup(draft, next);
    expect(cleaned.conditionGroups[0]!.conditions.map(row => row.conditionKey)).toEqual(['total']);
    expect(draft.conditionGroups[0]!.conditions).toHaveLength(2);
    expect(analyzeEventSwitchImpact(draft, createEmptyEventSource('DAMAGE_TAKEN')).summary).not.toContain('指定自身盾');
  });

  it('整份草稿校验要求明确当前技能和真实盾引用，并返回精确字段路径', () => {
    const unknownSkill = validateSkillTriggerDraft(fromDetail(rule()), { includeRuleKey: true,
      effectsByKey: new Map([['own_shield', shieldEffect()]]) });
    expect(unknownSkill.ok).toBe(false);
    if (!unknownSkill.ok) expect(unknownSkill.nestedErrors.some(error => error.path ===
      'conditionGroups[0].conditions[0].detail.shieldResult')).toBe(true);
    expect(selectorErrors(rule(), [shieldEffect()], 'another_guard')[0]?.message).toContain('当前技能');
    const missing = rule();
    const first = missing.conditionGroups[0]!.conditions[0]!;
    if (first.conditionType !== 'EVENT_VALUE_COMPARE') throw new Error('测试条件类型错误');
    first.detail.shieldResult!.resultKey = 'missing';
    expect(selectorErrors(missing)[0]?.path).toBe('conditionGroups[0].conditions[0].detail.shieldResult');
    expect(selectorErrors(rule(), [changedEffect(effect => { effect.lifecycle!.instanceScope = 'TARGET'; })])).toHaveLength(1);
    const wrongEvent = rule(); wrongEvent.eventSource = createEmptyEventSource('DAMAGE_DEALT');
    expect(selectorErrors(wrongEvent)).toHaveLength(1);
  });
});
