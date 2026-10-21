import { describe, expect, it } from 'vitest';
import { fixedValue } from '../types/numericValue';
import type { SkillTriggerEventSource, SkillTriggerRuleDetail } from '../types/skillTriggerRule';
import { parseSkillTriggerRuleDetail, SkillTriggerRuleProtocolError } from './skillTriggerRuleClient';

const selectedShield = () => ({ skillKey: 'guard', effectKey: 'own_shield', resultKey: 'shield' });

function rule(): SkillTriggerRuleDetail {
  return {
    ruleKey: 'shield_starts_wait', name: '自身盾受损起计', description: null, sortOrder: 10,
    eventSource: { eventType: 'DAMAGE_TAKEN', detail: {
      sourceSkillKey: null, damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY'
    } },
    conditionGroups: [{ groupKey: 'first_own_shield', name: '自身盾实际吸收', sortOrder: 10,
      conditions: [{ conditionKey: 'absorbed', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 10,
        detail: { eventValueKey: 'SHIELD_ABSORBED', shieldResult: selectedShield(), comparator: 'GT', comparisonValue: fixedValue(0) } }] }],
    actions: [], perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null
  };
}

function detail(input: SkillTriggerRuleDetail): Record<string, unknown> {
  return input.conditionGroups[0]!.conditions[0]!.detail as unknown as Record<string, unknown>;
}

describe('指定自身盾吸收量的管理响应协议', () => {
  it('完整保留三段结果身份、合法0比较及输入对象', () => {
    const input = rule(), before = structuredClone(input);
    const parsed = parseSkillTriggerRuleDetail(input);
    expect(parsed).toEqual(before);
    expect(detail(parsed).shieldResult).toEqual({ skillKey: 'guard', effectKey: 'own_shield', resultKey: 'shield' });
    expect(detail(parsed).comparisonValue).toEqual(fixedValue(0));
    expect(input).toEqual(before);
  });

  it.each(['DAMAGE_TAKEN', 'DAMAGE_DEALT'] as const)('省略选择器时保留%s原总吸收条件，不补造引用', eventType => {
    const input = rule();
    input.eventSource = { ...input.eventSource, eventType } as SkillTriggerEventSource;
    delete detail(input).shieldResult;
    const parsed = parseSkillTriggerRuleDetail(input);
    expect(parsed).toEqual(input);
    expect(detail(parsed)).not.toHaveProperty('shieldResult');
  });

  it.each<[string, unknown]>([
    ['null', null], ['undefined', undefined], ['空对象', {}], ['数组', []], ['字符串', 'own_shield'],
    ['布尔值', true], ['缺技能', { effectKey: 'own_shield', resultKey: 'shield' }],
    ['缺效果', { skillKey: 'guard', resultKey: 'shield' }], ['缺结果', { skillKey: 'guard', effectKey: 'own_shield' }],
    ['多字段', { ...selectedShield(), owner: 'source' }],
    ['空技能', { ...selectedShield(), skillKey: '' }], ['空效果', { ...selectedShield(), effectKey: '' }],
    ['空结果', { ...selectedShield(), resultKey: '' }],
    ['非字符串技能', { ...selectedShield(), skillKey: 1 }],
    ['null效果', { ...selectedShield(), effectKey: null }],
    ['非字符串结果', { ...selectedShield(), resultKey: false }],
    ['非法技能键', { ...selectedShield(), skillKey: 'OtherGuard' }],
    ['非法效果键', { ...selectedShield(), effectKey: 'own/shield' }],
    ['非法结果键', { ...selectedShield(), resultKey: 'shield-1' }],
    ['键前后空白', { ...selectedShield(), resultKey: ' shield ' }],
    ['键过长', { ...selectedShield(), effectKey: 'a'.repeat(65) }]
  ])('拒绝损坏选择器：%s', (_name, value) => {
    const input = rule();
    detail(input).shieldResult = value;
    expect(() => parseSkillTriggerRuleDetail(input)).toThrow(SkillTriggerRuleProtocolError);
    expect(() => parseSkillTriggerRuleDetail(input)).toThrow('shieldResult');
  });

  it.each(['ACTUAL_HP_LOSS', 'POST_DEFENSE_DAMAGE', 'RAW_DAMAGE', 'KILLED'] as const)(
    '其它事件值%s不能夹带自身盾选择器', eventValueKey => {
      const input = rule();
      detail(input).eventValueKey = eventValueKey;
      expect(() => parseSkillTriggerRuleDetail(input)).toThrow('shieldResult');
    }
  );

  it.each<[string, unknown]>([
    ['DAMAGE_DEALT', { sourceSkillKey: null, damageTypeKey: null, deliveryKind: 'ANY', originKind: 'ANY' }],
    ['BASIC_ATTACK_HIT', {}], ['SKILL_HIT', { sourceSkillKey: null }], ['SOURCE_INITIALIZED', {}]
  ])('非受伤事件%s拒绝选择器，而不是丢弃后继续解析', (eventType, eventDetail) => {
    const input = rule();
    input.eventSource = { eventType, detail: eventDetail } as SkillTriggerEventSource;
    expect(() => parseSkillTriggerRuleDetail(input)).toThrow('shieldResult');
    expect(input.conditionGroups[0]!.conditions[0]!.detail).toHaveProperty('shieldResult', selectedShield());
  });

  it('仍拒绝事件值明细的未知同级字段', () => {
    const input = rule();
    detail(input).unexpected = true;
    expect(() => parseSkillTriggerRuleDetail(input)).toThrow('detail.conditionGroups[0].conditions[0].detail');
  });
});
