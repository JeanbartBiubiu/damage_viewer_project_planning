import { describe, expect, it } from 'vitest';
import { emptyGameCalculationDraft, validateGameCalculationDraft } from './gameCalculationForm';
import { equipmentSimulationSample } from '../../../../tests/fixtures/simulationEquipment';

describe('计算规则草稿保留与明确作者输入', () => {
  it('新候选无隐含绑定、下限或公式，必须经明确编辑', () => {
    expect(emptyGameCalculationDraft()).toEqual({ criticalChanceAttributeKey: null, criticalMultiplierMin: null,
      attackSpeedAttributeKey: null, attributeDerivations: [] });
  });
  it('完整草稿验证不改写表达式、顺序或十进制原文，非法输入保留用于修复', () => {
    const snapshot = equipmentSimulationSample();
    const draft = structuredClone(snapshot.catalogs.calculationRules.configuration!);
    const before = structuredClone(draft);
    expect(validateGameCalculationDraft(draft, snapshot.catalogs.attributes)).toEqual(before);
    const broken = { ...draft, criticalMultiplierMin: -1 };
    expect(() => validateGameCalculationDraft(broken, snapshot.catalogs.attributes)).toThrow('criticalMultiplierMin');
    expect(broken.criticalMultiplierMin).toBe(-1);
    expect(draft).toEqual(before);
  });
});
