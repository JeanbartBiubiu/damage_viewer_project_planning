import { describe, expect, it } from 'vitest';
import { emptyGameCalculationDraft, validateGameCalculationDraft } from './gameCalculationForm';
import { equipmentSimulationSample } from '../../../../tests/fixtures/simulationEquipment';
import { classificationCostBindingsSample } from '../../../../tests/fixtures/classificationCostBindings';

describe('计算规则草稿保留与明确作者输入', () => {
  it('新候选无隐含绑定、下限或公式，必须经明确编辑', () => {
    expect(emptyGameCalculationDraft()).toEqual({ criticalChanceAttributeKey: null, criticalMultiplierMin: null,
      attackSpeedAttributeKey: null, basicAttackCategoryKey: null, equipmentPassiveCategoryKey: null,
      ignorableCastCostAttributeKeys: [], attributeDerivations: [] });
  });
  it('完整草稿验证不改写表达式、顺序或十进制原文，非法输入保留用于修复', () => {
    const snapshot = equipmentSimulationSample();
    const draft = structuredClone(snapshot.catalogs.calculationRules.configuration!);
    const before = structuredClone(draft);
    expect(validateGameCalculationDraft(draft, snapshot.catalogs.attributes, snapshot.catalogs.skillCategories)).toEqual(before);
    const broken = { ...draft, criticalMultiplierMin: -1 };
    expect(() => validateGameCalculationDraft(broken, snapshot.catalogs.attributes, snapshot.catalogs.skillCategories)).toThrow('criticalMultiplierMin');
    expect(broken.criticalMultiplierMin).toBe(-1);
    expect(draft).toEqual(before);
  });
  it('真实目录授权两分类与任意数值费用；错误保留草稿和费用原输入顺序', () => {
    const snapshot = classificationCostBindingsSample();
    const draft = structuredClone(snapshot.catalogs.calculationRules.configuration!);
    draft.ignorableCastCostAttributeKeys = ['spell_fee', 'hp'];
    const before = structuredClone(draft);
    expect(validateGameCalculationDraft(draft, snapshot.catalogs.attributes, snapshot.catalogs.skillCategories)).toEqual(before);
    draft.equipmentPassiveCategoryKey = draft.basicAttackCategoryKey;
    expect(() => validateGameCalculationDraft(draft, snapshot.catalogs.attributes, snapshot.catalogs.skillCategories)).toThrow('category_usage_conflict');
    expect(draft.equipmentPassiveCategoryKey).toBe('authored_strike');
    draft.equipmentPassiveCategoryKey = 'authored_item';
    draft.ignorableCastCostAttributeKeys.push('spell_fee');
    expect(() => validateGameCalculationDraft(draft, snapshot.catalogs.attributes, snapshot.catalogs.skillCategories)).toThrow('duplicate_attribute');
    expect(draft.ignorableCastCostAttributeKeys).toEqual(['spell_fee', 'hp', 'spell_fee']);
  });
});
