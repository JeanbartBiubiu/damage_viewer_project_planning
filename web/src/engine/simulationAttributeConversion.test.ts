import { approveSnapshotFixture, compileFixtureWithNative } from '../../tests/fixtures/nativeFormulaProof';
import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import { describe, expect, it } from 'vitest';
import { attributeConversionSample as sample } from '../../tests/fixtures/simulationAttributeConversion';
import type { SkillEffectAttributeChangeResult } from '../types/skillEffect';
import { formulaValue } from '../types/numericValue';
import { assembleSimulation as raw_assembleSimulation, inspectSimulationSnapshot as raw_inspectSimulationSnapshot } from './simulationAdapter';

function assemble(scene = sample()) {
  const input = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(scene.snapshot).requirements) if (row.storedValue === undefined) input[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(scene.snapshot, input, { source: 650, target: 590 });
}

describe('5C作者常驻转换只映射一次属性派生', () => {
  it('静态共同公式转换使用原生核定literal，并能进入正式原生编译', () => {
    const scene = sample();
    scene.configuration.formulas.push({ ...scene.configuration.formulas[0]!, formulaKey: 'static_speed',
      expression: skillFormulaDefinition(scene.configuration.skill.skillKey, { nodeType: 'PARAMETER', parameterKey: 'saved_speed' }) });
    scene.configuration.effects[0]!.results = scene.configuration.effects[0]!.results.filter(row => row.resultKey !== 'converted_damage');
    scene.configuration.effects[0]!.results[0]!.valueRule!.value = formulaValue('static_speed');
    const prepared = assemble(scene);
    expect(prepared.compileRequest.rules.attributeDerivations!.map(row => row.value)).toEqual([{ op: 'const', value: .7 }, { op: 'const', value: .7 }]);
    const result = compileFixtureWithNative(prepared.compileRequest);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it('每侧最多攻速加攻击力，攻击力乘在普通修正之后而非再次平加', () => {
    const prepared = assemble();
    const derivations = prepared.compileRequest.rules.attributeDerivations!;
    expect(derivations).toHaveLength(4);
    expect(derivations.filter(row => row.attributeKey === 'attack_speed').map(row => row.value)).toEqual([{ op: 'const', value: .7 }, { op: 'const', value: .7 }]);
    expect(derivations.filter(row => row.attributeKey === 'attack_damage').every(row => row.valuePolicy === 'multiply' && row.value.op === 'add')).toBe(true);
    expect(derivations.filter(row => row.attributeKey === 'attack_damage').map(row => row.skillKey)).toEqual(['saved_attribute_conversion', 'saved_attribute_conversion']);
    expect(prepared.compileRequest.sharedProviders!.flatMap(provider => provider.modifiers ?? []).filter(modifier => modifier.target === 'self.attr.attack_damage')).toHaveLength(2);
    expect(prepared.coverage.filter(row => row.compiledPath.startsWith('rules.attributeDerivations['))).toHaveLength(4);
    expect(JSON.stringify(derivations)).not.toContain('attack_damage.resolved');
  });
  it('装备额外攻速保留供转换读取，覆盖攻速不生成普通攻速派生也不要求收益系数', () => {
    const scene = sample();
    scene.snapshot.selection.sourceEquipmentKeys = ['item_1042'];
    scene.snapshot.source.selectedEquipment.push({ equipment: { gameId: 'lol', equipmentKey: 'item_1042', name: '短剑', description: null, createdAt: '', updatedAt: '' },
      attributes: { equipmentKey: 'item_1042', attributeValues: { bonus_attack_speed_percent: .12 } }, attachedSkills: [] });
    const prepared = assemble(scene);
    expect(inspectSimulationSnapshot(scene.snapshot).requirements.some(row => row.attribute.attributeKey === 'attack_speed_ratio')).toBe(false);
    expect(prepared.compileRequest.rules.attributeDerivations!.filter(row => row.combatantKey === 'source' && row.attributeKey === 'attack_speed')).toHaveLength(1);
    expect(prepared.equipmentOrigins[0]!.attributeValues.bonus_attack_speed_percent).toBe(.12);
    expect(JSON.stringify(prepared.compileRequest.formulas)).toContain('bonus_attack_speed_percent');
    expect(prepared.compileRequest.formulas!.filter(formula => formula.key.endsWith('/conversion_ratio')).every(formula => formula.expression.inputs.some(input => input.binding.kind === 'attribute' && input.binding.object === 'source' && input.binding.attributeKey === 'bonus_attack_speed_percent' && input.binding.valueKind === 'TOTAL'))).toBe(true);
  });
  it.each(['attack_damage', 'attack_speed'])('拒绝依赖%s自身或其它派生总值', attributeKey => {
    const scene = sample();
    scene.configuration.formulas[0]!.expression = skillFormulaDefinition('saved_attribute_conversion', { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey, attributeValueKind: 'TOTAL' });
    expect(() => inspectSimulationSnapshot(scene.snapshot)).toThrow(/回读/);
  });
  it('固定攻速快照只接受明确等级静态值，不把属性动态读取冒充快照', () => {
    const dynamic = sample();
    dynamic.configuration.effects[0]!.results[0]!.valueRule!.value = formulaValue('conversion_ratio');
    expect(() => inspectSimulationSnapshot(dynamic.snapshot)).toThrow(/明确等级与静态配置/);
    const wrongMode = sample();
    wrongMode.configuration.effects[0]!.results[0]!.lifecycleBehavior!.valueReadMode = 'MOMENT_EVALUATION';
    expect(() => inspectSimulationSnapshot(wrongMode.snapshot)).toThrow(/固定攻速使用施加快照/);
  });
  it('拒绝重复输出、未知覆盖输出、攻击力快照转换、缺等级或必要不支持分支', () => {
    const duplicate = sample();
    duplicate.configuration.effects[0]!.results.push({ ...structuredClone(duplicate.configuration.effects[0]!.results[0]!), resultKey: 'duplicate_speed' });
    expect(() => inspectSimulationSnapshot(duplicate.snapshot)).toThrow(/一个派生输出/);
    const wrong = sample(); (wrong.configuration.effects[0]!.results[0]! as SkillEffectAttributeChangeResult).detail.attributeKey = 'armor';
    expect(() => inspectSimulationSnapshot(wrong.snapshot)).toThrow(/首批仅开放/);
    const frozen = sample(); frozen.configuration.effects[0]!.results[1]!.lifecycleBehavior!.valueReadMode = 'APPLICATION_SNAPSHOT';
    expect(() => inspectSimulationSnapshot(frozen.snapshot)).toThrow(/实时求值/);
    const missing = sample(); missing.snapshot.selection.sourceLevel = 3;
    expect(() => inspectSimulationSnapshot(missing.snapshot)).toThrow(/levelValues.3/);
    const mandatory = sample(); mandatory.configuration.effects[0]!.results.push({ ...mandatory.configuration.effects[0]!.results[0]!, resultKey: 'mandatory', resultType: 'DAMAGE' } as never);
    expect(() => inspectSimulationSnapshot(mandatory.snapshot)).toThrow(/完整常驻结果/);
  });
});

const assembleSimulation = (...args: Parameters<typeof raw_assembleSimulation>): ReturnType<typeof raw_assembleSimulation> => { approveSnapshotFixture(args[0]); return raw_assembleSimulation(...args); };
const inspectSimulationSnapshot = (...args: Parameters<typeof raw_inspectSimulationSnapshot>): ReturnType<typeof raw_inspectSimulationSnapshot> => { approveSnapshotFixture(args[0]); return raw_inspectSimulationSnapshot(...args); };
