import { describe, expect, it } from 'vitest';
import type { Attribute } from '../../../types/attribute';
import type { SkillCategory } from '../../../types/skillCategory';
import { createGameVampRuleDraft, validateGameVampRules, type GameVampRuleDraft } from './gameVampForm';

const attributes = [
  { attributeKey: 'omnivamp_percent', valueType: 'DECIMAL' },
  { attributeKey: 'integer_value', valueType: 'INTEGER' }
] as Attribute[];
const categories = [{ skillCategoryKey: 'common' }] as SkillCategory[];
const rule: GameVampRuleDraft = { ...createGameVampRuleDraft('OMNIVAMP'), sourceAttributeKey: 'omnivamp_percent',
  defaultEfficiency: 0, deliveryKinds: ['SKILL'], originKinds: ['DIRECT'], skillCategoryKeys: ['common'] };

describe('游戏吸血规则草稿', () => {
  it('新增草稿不编造比例属性、效率或资格，显式零可保存', () => {
    expect(createGameVampRuleDraft('LIFE_STEAL')).toMatchObject({ sourceAttributeKey: '', defaultEfficiency: undefined,
      deliveryKinds: [], originKinds: [], skillCategoryKeys: [] });
    expect(validateGameVampRules([rule], attributes, categories)).toEqual({ ok: true, value: { rules: [rule] } });
  });
  it.each([
    { ...rule, defaultEfficiency: undefined }, { ...rule, defaultEfficiency: -0.1 },
    { ...rule, sourceAttributeKey: 'integer_value' }, { ...rule, sourceAttributeKey: 'missing' },
    { ...rule, deliveryKinds: [] }, { ...rule, originKinds: ['DIRECT', 'DIRECT'] },
    { ...rule, skillCategoryKeys: ['missing'] }
  ] as GameVampRuleDraft[])('不完整或失效引用保留为错误 %j', (draft) => {
    expect(validateGameVampRules([draft], attributes, categories).ok).toBe(false);
  });
  it('完整集合拒绝重复类型，并按固定顺序写入', () => {
    expect(validateGameVampRules([rule, rule], attributes, categories).ok).toBe(false);
    const result = validateGameVampRules([rule, { ...rule, vampType: 'LIFE_STEAL' }], attributes, categories);
    expect(result.ok && result.value.rules.map((item) => item.vampType)).toEqual(['LIFE_STEAL', 'OMNIVAMP']);
  });
});
