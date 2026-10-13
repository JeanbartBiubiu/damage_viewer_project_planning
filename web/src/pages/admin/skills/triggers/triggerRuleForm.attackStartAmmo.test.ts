import { describe, expect, it } from 'vitest';
import { fixedValue } from '../../../../types/numericValue';
import { rebuildInternalStateCheckDetail, valueKindsForInternalState } from './triggerRuleForm';

describe('本次攻击开始弹药条件', () => {
  it('只给技能命中中的弹药提供开始值，不开放普通计数或输入绑定', () => {
    expect(valueKindsForInternalState('AMMO', true)).toEqual(['VALUE', 'ATTACK_START_VALUE']);
    expect(valueKindsForInternalState('AMMO')).toEqual(['VALUE']);
    expect(valueKindsForInternalState('COUNTER', true)).toEqual(['VALUE']);
  });

  it('保留比较符、明确零值与状态完整身份', () => {
    const original = { stateSkillKey: 'configured_attack', stateKey: 'ammo', valueKind: 'VALUE' as const,
      optionKey: null, expectedBoolean: null, comparator: 'EQ' as const, comparisonValue: fixedValue(0) };
    const capture = rebuildInternalStateCheckDetail(original, 'ATTACK_START_VALUE');
    expect(capture).toEqual({ ...original, valueKind: 'ATTACK_START_VALUE' });
    expect(rebuildInternalStateCheckDetail(capture, 'VALUE')).toEqual(original);
  });
});
