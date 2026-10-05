import { describe, expect, it } from 'vitest';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffectAttributeChangeResult } from '../types/skillEffect';
import { fixedValue, formulaValue, parameterValue } from '../types/numericValue';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';

function sample() {
  const snapshot = simulationSample('lol');
  const basic = snapshot.skillConfigurations[0]!;
  const skillKey = 'saved_attribute_conversion';
  const result = (resultKey: string, attributeKey: string, operation: 'INCREASE' | 'SET', modifierZoneKey: string | null,
    value: NonNullable<SkillEffectAttributeChangeResult['valueRule']>['value']): SkillEffectAttributeChangeResult => ({
    resultKey, name: resultKey, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', detail: { attributeKey, operation, modifierZoneKey },
    sortOrder: 0, description: null, spellShieldBlockScope: null,
    valueRule: { value, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null }, lifecycleBehavior: {
      moment: 'PERSISTENT', valueReadMode: operation === 'SET' ? 'APPLICATION_SNAPSHOT' : 'MOMENT_EVALUATION',
      stackValueMode: 'SHARED', reapplicationValueMode: operation === 'SET' ? 'REPLACE' : null, periodicExecutionMode: null
    }
  });
  const configuration: SkillConfiguration = { ...structuredClone(basic), skill: { ...basic.skill, skillKey, skillCategoryKeys: [] },
    parameters: [{ ...basic.parameters[0]!, skillKey, parameterKey: 'saved_speed', fixedValue: null, valueMode: 'CHARACTER_LEVEL', levelValues: { '1': .7, '2': .8 } }],
    formulas: [{ ...basic.formulas[0]!, skillKey, formulaKey: 'conversion_ratio', expression: { nodeType: 'OPERATION', operation: 'ADD', operands: [
      { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'bonus_attack_speed_percent', attributeValueKind: 'TOTAL' },
      { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'critical_strike_chance', attributeValueKind: 'TOTAL' }
    ] } }], processes: [], internalStates: [],
    effects: [{ ...basic.effects[0]!, skillKey, effectKey: 'permanent', lifecycle: { instanceScope: 'SOURCE', expiryMode: 'EXPLICIT_ONLY',
      durationValue: null, maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1), reapplicationStackMode: 'KEEP',
      reapplicationDurationMode: null, periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null }, results: [
      result('fixed_speed', 'attack_speed', 'SET', null, parameterValue('saved_speed')),
      result('converted_damage', 'attack_damage', 'INCREASE', 'ratio_multiply', formulaValue('conversion_ratio')),
      result('ordinary_damage', 'attack_damage', 'INCREASE', 'flat_add', fixedValue(7))
    ] }], triggerRules: [{ ...basic.triggerRules[0]!, ruleKey: 'initialize', eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} },
      actions: [{ ...basic.triggerRules[1]!.actions[0]!, actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'permanent' }, targetContext: 'EVENT_SOURCE' }] }]
  };
  snapshot.skillConfigurations.push(configuration);
  snapshot.catalogs.modifierZones.push(...(['ratio_multiply', 'flat_add'] as const).map(key => ({ gameId: 'lol', modifierZoneKey: key,
    name: key, status: 'ENABLED' as const, domain: 'ATTRIBUTE' as const, calculationMode: key === 'ratio_multiply' ? 'RATIO_MULTIPLY' as const : 'FLAT_ADD' as const,
    applicationStage: key === 'ratio_multiply' ? 'ATTRIBUTE_PERCENT' as const : 'ATTRIBUTE_FLAT' as const, description: null, sortOrder: 0, createdAt: '', updatedAt: '' })));
  snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'bonus_attack_speed_percent' });
  for (const side of ['source', 'target'] as const) {
    snapshot[side].selectedLevelValues.bonus_attack_speed_percent = 0;
    snapshot[side].selectedLevelValues.critical_strike_chance = .25;
    snapshot[side].attachedSkills.push({ ...snapshot[side].attachedSkills[0]!, skillKey });
    snapshot[side].skillSources.push({ origin: { kind: 'CHARACTER', characterKey: snapshot[side].character.characterKey }, skillKey,
      skillName: configuration.skill.name, skillStatus: 'ENABLED', enabled: true, skillLevel: 1, enabledRuleKeys: ['initialize'], inactiveReason: null });
  }
  return { snapshot, configuration };
}
function assemble(scene = sample()) {
  const input = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(scene.snapshot).requirements) if (row.storedValue === undefined) input[row.side][row.attribute.attributeKey] = 0;
  return assembleSimulation(scene.snapshot, input, { source: 650, target: 590 });
}

describe('5C作者常驻转换只映射一次属性派生', () => {
  it('每侧最多攻速加攻击力，攻击力乘在普通修正之后而非再次平加', () => {
    const prepared = assemble();
    const derivations = prepared.compileRequest.rules.attributeDerivations!;
    expect(derivations).toHaveLength(4);
    expect(derivations.filter(row => row.attributeKey === 'attack_speed').map(row => row.value)).toEqual([{ op: 'const', value: .7 }, { op: 'const', value: .7 }]);
    expect(derivations.filter(row => row.attributeKey === 'attack_damage').every(row => row.valuePolicy === 'multiply' && row.value.op === 'add')).toBe(true);
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
    expect(JSON.stringify(prepared.compileRequest.rules.attributeDerivations)).toContain('source.attr.bonus_attack_speed_percent.resolved');
  });
  it.each(['attack_damage', 'attack_speed'])('拒绝依赖%s自身或其它派生总值', attributeKey => {
    const scene = sample();
    scene.configuration.formulas[0]!.expression = { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey, attributeValueKind: 'TOTAL' };
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
