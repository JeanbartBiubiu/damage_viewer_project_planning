import { describe, expect, it } from 'vitest';
import { equipmentSimulationSample } from '../../tests/fixtures/simulationEquipment';
import { assembleGameAttributeDerivations, changedAttributes, simulationCriticalBinding, hasDynamicSpeedDependency } from './simulationCalculationRules';
import { validateSimulationAttributeDerivations } from './simulationAttributeConversion';
import { selectFormulaProofScope } from './approvedFormulaValues';

describe('作者绑定与真实改变集合，不按属性名生成计算式', () => {
  it('完整重命名概率、速度、收益与加成输入，仍透传原公式而不解释算术', () => {
    const snapshot = equipmentSimulationSample(['item_1042']);
    const configuration = snapshot.catalogs.calculationRules.configuration!;
    const mapping = { attack_speed: 'saved_tempo', attack_speed_ratio: 'saved_yield', bonus_attack_speed_percent: 'saved_extra', critical_strike_chance: 'saved_odds' } as Record<string, string>;
    for (const attribute of snapshot.catalogs.attributes) attribute.attributeKey = mapping[attribute.attributeKey] ?? attribute.attributeKey;
    configuration.criticalChanceAttributeKey = 'saved_odds'; configuration.attackSpeedAttributeKey = 'saved_tempo';
    const rule = configuration.attributeDerivations[0]!; rule.attributeKey = 'saved_tempo'; rule.activationAttributeKeys = ['saved_extra'];
    for (const input of rule.formula.inputs) if (input.binding.kind === 'attribute') input.binding.attributeKey = mapping[input.binding.attributeKey] ?? input.binding.attributeKey;
    const changed = changedAttributes(); changed.source.add('saved_extra');
    const assembled = assembleGameAttributeDerivations(snapshot, changed, []);
    expect(assembled.derivations).toEqual([{ combatantKey: 'source', attributeKey: 'saved_tempo', valuePolicy: 'set', valueType: 'DECIMAL',
      value: { op: 'ref', ref: 'game/lol/authored_speed_yield/source/attribute_derivation' } }]);
    expect(assembled.formulas[0]).toEqual({ key: 'game/lol/authored_speed_yield/source/attribute_derivation', scope: 'game', parameters: [], expression: rule.formula });
    expect(simulationCriticalBinding(snapshot, false, 'critical')).toEqual({ critChance: { op: 'read', path: 'source.attr.saved_odds.resolved' }, critMultiplierMin: 1 });
  });
  it('替换完整作者公式只替换程序，真正读取依赖不被误算为激活；双方来源隔离', () => {
    const snapshot = equipmentSimulationSample();
    snapshot.catalogs.calculationRules.configuration!.attributeDerivations[0]!.formula = { inputs: [], stages: [{ key: 'custom', name: '作者常量', expression: { op: 'const', value: '2.5' } }], outputStageKey: 'custom' };
    const changed = changedAttributes(); changed.source.add('attack_speed_ratio');
    expect(assembleGameAttributeDerivations(snapshot, changed, []).derivations).toHaveLength(0);
    changed.target.add('bonus_attack_speed_percent');
    const assembled = assembleGameAttributeDerivations(snapshot, changed, []);
    expect(assembled.derivations[0]!.combatantKey).toBe('target');
    expect(assembled.formulas[0]!.expression.stages[0]!.expression).toEqual({ op: 'const', value: '2.5' });
  });
  it('未读取的完整声明只校验授权，不要求场景供值；未知或停用声明仍拒绝', () => {
    const snapshot = equipmentSimulationSample();
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'unused_probe' });
    const rule = snapshot.catalogs.calculationRules.configuration!.attributeDerivations[0]!;
    rule.formula = { inputs: [{ key: 'unused', binding: { kind: 'attribute', object: 'source', attributeKey: 'unused_probe', valueKind: 'TOTAL', view: 'current_frame' } }],
      stages: [{ key: 'constant', name: '常量输出', expression: { op: 'const', value: '2' } }], outputStageKey: 'constant' };
    const changed = changedAttributes(); changed.source.add('bonus_attack_speed_percent');
    const assembled = assembleGameAttributeDerivations(snapshot, changed, []);
    expect(assembled.required.source).toEqual(new Set(['attack_speed']));
    expect(assembled.formulas[0]!.expression).toEqual(rule.formula);
    snapshot.catalogs.attributes.find(row => row.attributeKey === 'unused_probe')!.status = 'DISABLED';
    expect(() => assembleGameAttributeDerivations(snapshot, changed, [])).toThrow(/FORMULA_UNKNOWN_BINDING/);
    snapshot.catalogs.attributes = snapshot.catalogs.attributes.filter(row => row.attributeKey !== 'unused_probe');
    expect(() => assembleGameAttributeDerivations(snapshot, changed, [])).toThrow(/FORMULA_UNKNOWN_BINDING/);
  });
  it('实际来源输出替代同侧游戏规则，另一侧仍按自己配置激活，来源竞争拒绝', () => {
    selectFormulaProofScope('game-override', true);
    const snapshot = equipmentSimulationSample(); const changed = changedAttributes();
    changed.source.add('bonus_attack_speed_percent'); changed.target.add('bonus_attack_speed_percent');
    const source = { combatantKey: 'source' as const, skillKey: 'saved_conversion', attributeKey: 'attack_speed', valuePolicy: 'set' as const, valueType: 'DECIMAL' as const, value: { op: 'const', value: 3 } };
    const game = assembleGameAttributeDerivations(snapshot, changed, [source]);
    expect(game.derivations.map(row => row.combatantKey)).toEqual(['target']);
    expect(() => validateSimulationAttributeDerivations([source, { ...source, skillKey: 'competing_skill' }])).toThrow('一个');
    validateSimulationAttributeDerivations([source, ...game.derivations]);
  });
  it('零下限与不设下限保持不同；FORCED不要求概率绑定，来源概率缺绑定拒绝', () => {
    const snapshot = equipmentSimulationSample();
    const configuration = snapshot.catalogs.calculationRules.configuration!;
    configuration.criticalMultiplierMin = 0;
    expect(simulationCriticalBinding(snapshot, true, 'critical').critMultiplierMin).toBe(0);
    configuration.criticalMultiplierMin = null; configuration.criticalChanceAttributeKey = null;
    expect(simulationCriticalBinding(snapshot, true, 'critical')).toEqual({ critChance: { op: 'const', value: 1 } });
    expect(() => simulationCriticalBinding(snapshot, false, 'critical')).toThrow('概率属性绑定');
  });
  it('动态等待识别真实重命名依赖、实际拥有方及读值口径，不用属性名称判断', () => {
    const input = { schemaVersion: 'generic-p0', schemaHash: 'dynamic', rulesHash: 'dynamic', typeCatalog: { types: [], relations: [] },
      combatants: [{ key: 'source' as const, attributes: {}, resources: {}, providers: [{ providerRef: 'source_state', definitionRef: 'source_state' }] },
        { key: 'target' as const, attributes: {}, resources: {}, providers: [{ providerRef: 'target_state', definitionRef: 'target_state' }] }],
      sharedProviders: [{ providerKey: 'source_state', stableId: 'source_state', kind: 'character', initialStateSchema: { layers: 0 },
        modifiers: [{ modifierKey: 'varying', kind: 'attribute', target: 'self.attr.saved_yield', value: { op: 'const', value: 1 } }] }],
      formulas: [{ key: 'saved_dynamic_speed', scope: 'game' as const, parameters: [] as [], expression: {
        inputs: [{ key: 'yield', binding: { kind: 'attribute' as const, object: 'source' as const, attributeKey: 'saved_yield', valueKind: 'TOTAL' as const, view: 'current_frame' as const } }],
        stages: [{ key: 'output', name: '输出', expression: { op: 'read' as const, inputKey: 'yield' } }], outputStageKey: 'output' } }],
      rules: { attributeDerivations: [{ combatantKey: 'source' as const, attributeKey: 'saved_tempo', valuePolicy: 'set' as const, valueType: 'DECIMAL' as const, value: { op: 'ref', ref: 'saved_dynamic_speed' } }] } };
    expect(hasDynamicSpeedDependency(input, 'source', 'saved_tempo')).toBe(true);
    input.sharedProviders[0]!.providerKey = 'target_state'; input.sharedProviders[0]!.stableId = 'target_state';
    expect(hasDynamicSpeedDependency(input, 'source', 'saved_tempo')).toBe(false);
    input.sharedProviders[0]!.modifiers[0]!.target = 'opponent.attr.saved_yield';
    expect(hasDynamicSpeedDependency(input, 'source', 'saved_tempo')).toBe(true);
    input.formulas[0]!.expression.inputs[0]!.binding.valueKind = 'BASE' as 'TOTAL';
    expect(hasDynamicSpeedDependency(input, 'source', 'saved_tempo')).toBe(false);
  });
});
