import { describe, expect, it } from 'vitest';
import { equipmentSimulationSample } from '../../tests/fixtures/simulationEquipment';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffect } from '../types/skillEffect';
import type { CompileRequest } from '../types/genericEngine';
import { permanentModifier, validatePermanentEffect, type PermanentResultContext } from './simulationPermanentResults';
import { hasDynamicSpeedDependency } from './simulationCalculationRules';

function sample() {
  const snapshot = equipmentSimulationSample();
  const source = { ...snapshot.source.skillSources[0]!, skillKey: 'lab_health_bonus', skillLevel: 1 };
  const metadata = { gameId: snapshot.gameId, skillKey: source.skillKey, name: '缺血收益', description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
  const configuration: SkillConfiguration = { skill: { ...snapshot.skillConfigurations[0]!.skill, skillKey: source.skillKey }, parameters: [],
    formulas: [{ ...metadata, formulaKey: 'amount', expression: { inputs: [
      { key: 'health', binding: { kind: 'attribute', object: 'source', view: 'current_frame', attributeKey: 'hp', valueKind: 'CURRENT' } },
      { key: 'maximum', binding: { kind: 'attribute', object: 'source', view: 'current_frame', attributeKey: 'hp', valueKind: 'MAX' } }
    ], stages: [{ key: 'out', name: '两倍损失生命比例', expression: { op: 'mul', args: [{ op: 'const', value: '2' }, { op: 'sub', args: [{ op: 'const', value: '1' }, { op: 'div', args: [{ op: 'read', inputKey: 'health' }, { op: 'read', inputKey: 'maximum' }] }] }] } }], outputStageKey: 'out' } }],
    effects: [], processes: [], internalStates: [], triggerRules: [], baseDigest: 'a'.repeat(64) };
  const zone = { ...snapshot.catalogs.modifierZones[0]!, gameId: snapshot.gameId, modifierZoneKey: 'lab_flat', domain: 'ATTRIBUTE' as const,
    calculationMode: 'FLAT_ADD' as const, applicationStage: 'ATTRIBUTE_FLAT' as const, status: 'ENABLED' as const };
  snapshot.catalogs.modifierZones.push(zone);
  const effect: SkillEffect = { ...metadata, effectKey: 'persistent', lifecycle: { instanceScope: 'SOURCE', expiryMode: 'EXPLICIT_ONLY',
    durationValue: null, maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 },
    reapplicationStackMode: 'KEEP', reapplicationDurationMode: null, periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null },
  results: [{ resultKey: 'bonus', name: '实时收益', description: null, sortOrder: 0, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', spellShieldBlockScope: null,
    lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null },
    detail: { attributeKey: 'bonus_attack_speed_percent', operation: 'INCREASE', modifierZoneKey: 'lab_flat' },
    valueRule: { value: { kind: 'FORMULA', formulaKey: 'amount' }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null } }] };
  configuration.effects.push(effect);
  const context: PermanentResultContext = { snapshot, configuration, source, side: 'source', formulaNamespace: 'health-passive' };
  return { snapshot, context, configuration, effect, result: effect.results[0]! };
}

describe('永久拥有者生命驱动的普通加算', () => {
  it('完整共同公式保留实时读取，零基础输出仍使用add且不占派生', () => {
    const { context, effect, result } = sample();
    validatePermanentEffect(effect, 'life', context);
    const modifier = permanentModifier(context, result, 'result');
    expect(modifier).toMatchObject({ kind: 'attribute', target: 'self.attr.bonus_attack_speed_percent', valuePolicy: 'add' });
    expect('combatantKey' in modifier).toBe(false);
    expect(JSON.stringify(modifier.value)).toContain('health-passive/levels/1/1/amount');
  });
  it.each(['target', 'other_attribute', 'output', 'runtime', 'integer', 'snapshot'] as const)('拒绝不在拥有者生命范围的%s声明', kind => {
    const { context, result, configuration, snapshot } = sample();
    const formula = configuration.formulas[0]!.expression;
    if (kind === 'target') (formula.inputs[0]!.binding as { object: string }).object = 'target';
    if (kind === 'other_attribute') (formula.inputs[0]!.binding as { attributeKey: string }).attributeKey = 'armor';
    if (kind === 'output') (formula.inputs[0]!.binding as { attributeKey: string }).attributeKey = 'bonus_attack_speed_percent';
    if (kind === 'runtime') formula.inputs.push({ key: 'unprovided', binding: { kind: 'parameter', skillKey: 'lab_health_bonus', parameterKey: 'unprovided' } });
    if (kind === 'integer') snapshot.catalogs.attributes.find(row => row.attributeKey === 'bonus_attack_speed_percent')!.valueType = 'INTEGER';
    if (kind === 'snapshot') result.lifecycleBehavior!.valueReadMode = 'APPLICATION_SNAPSHOT';
    expect(() => permanentModifier(context, result, 'result')).toThrow();
  });
  it('动态攻速只承认实际挂载初始化的生命加算，悬空定义与静态加算不放宽检查', () => {
    const formula = sample().configuration.formulas[0]!;
    const input: CompileRequest = { schemaVersion: 'generic-p0', schemaHash: 'h', rulesHash: 'r', typeCatalog: { types: [], relations: [] },
      combatants: [{ key: 'source', attributes: {}, resources: {}, providers: [{ providerRef: 'root', definitionRef: 'root' }] },
        { key: 'target', attributes: {}, resources: {}, providers: [] }],
      sharedProviders: [{ providerKey: 'root', stableId: 'root', kind: 'character', listeners: [{ listenerKey: 'init',
        eventMatcher: { all: ['event/source_initialized', 'event/source_owner'] }, maxTriggersPerEvent: 1,
        operations: [{ operation: 'apply_provider', target: 'self', providerRef: 'effect', providerDefinitionRef: 'effect' }] }] },
      { providerKey: 'effect', stableId: 'effect', kind: 'status', modifiers: [{ modifierKey: 'speed', kind: 'attribute', target: 'self.attr.tempo',
        valuePolicy: 'add', value: { op: 'ref', ref: 'health' } }] }],
      formulas: [{ key: 'health', scope: 'skill', skillKey: 'lab_health_bonus', expression: formula.expression, parameters: [] }], rules: {} };
    expect(hasDynamicSpeedDependency(input, 'source', 'tempo')).toBe(true);
    expect(hasDynamicSpeedDependency(input, 'target', 'tempo')).toBe(false);
    input.sharedProviders![0]!.listeners = [];
    expect(hasDynamicSpeedDependency(input, 'source', 'tempo')).toBe(false);
    input.sharedProviders![0]!.listeners = [{ listenerKey: 'init', eventMatcher: { all: ['event/source_initialized', 'event/source_owner'] },
      operations: [{ operation: 'apply_provider', target: 'self', providerDefinitionRef: 'effect' }] }];
    input.sharedProviders![1]!.modifiers![0]!.value = { op: 'const', value: 1 };
    expect(hasDynamicSpeedDependency(input, 'source', 'tempo')).toBe(false);
  });
});
