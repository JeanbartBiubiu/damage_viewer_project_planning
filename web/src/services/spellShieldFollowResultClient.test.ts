import { describe, expect, it } from 'vitest';
import { recurveBowConfiguration } from '../../tests/fixtures/simulationTriggeredEquipment';
import { parseSkillEffect } from './skillEffectClient';

const follow = { skillKey: 'armed_skill', effectKey: 'bonus', resultKey: 'damage' };
function effect(reference: unknown = follow, patch: Record<string, unknown> = {}) {
  const source = structuredClone(recurveBowConfiguration().effects[0]!);
  const result = source.results[0]!;
  return { ...source, results: [{ ...result, ...patch, detail: { ...result.detail, spellShieldFollowResult: reference } }] };
}

describe('伤害结果的同次法盾跟随声明', () => {
  it('保留完整可选引用且不为旧结果补字段', () => {
    const parsed = parseSkillEffect(effect());
    expect(parsed.results[0]!.detail).toHaveProperty('spellShieldFollowResult', follow);
    const original = recurveBowConfiguration().effects[0]!;
    expect(parseSkillEffect(original).results[0]!.detail).not.toHaveProperty('spellShieldFollowResult');
  });

  it.each([null, {}, { ...follow, resultKey: '' }, { ...follow, skillKey: ' bad' },
    { ...follow, extra: true }, [follow]])('拒绝不完整或额外引用形状 %j', value => {
    expect(() => parseSkillEffect(effect(value))).toThrow(/spellShieldFollowResult/);
  });

  it('跟随者不能自己提名法盾、改为自身或声明普攻主体', () => {
    expect(() => parseSkillEffect(effect(follow, { spellShieldBlockScope: 'RESULT' }))).toThrow(/spellShieldFollowResult/);
    expect(() => parseSkillEffect(effect(follow, { target: 'SOURCE' }))).toThrow();
    const source = effect();
    Object.assign(source.results[0]!.detail, { attackDamageRole: 'PRIMARY' });
    expect(() => parseSkillEffect(source)).toThrow(/spellShieldFollowResult/);
  });
});
