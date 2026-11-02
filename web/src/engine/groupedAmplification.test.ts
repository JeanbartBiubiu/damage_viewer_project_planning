import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SkillEffect, SkillEffectResult } from '../types/skillEffect';
import type { ModifierZone } from '../types/modifierZone';
import { fixedValue, parameterValue } from '../types/numericValue';
import { createNumericCompileState } from './numericAdapter';
import { compileTimedDamageAmplification } from './timedDamageAmplificationAdapter';
import { compileTimedAttributeEffect } from './timedAttributeEffectAdapter';
import { compilePersistentResult } from './persistentResultAdapter';
import { permanentModifier } from './simulationPermanentResults';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';
import { parseMechanismCase } from '../../tests/mechanisms/mechanismCase';
import { assembleTriggeredEquipment } from './simulation/sources/equipment';

const metadata = { description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
function fixture(direction: 'DEALT' | 'TAKEN' = 'DEALT') {
  const snapshot = simulationSample('groups');
  const configuration = snapshot.skillConfigurations[0]!;
  const skillKey = configuration.skill.skillKey;
  const zone: ModifierZone = { ...metadata, gameId: 'groups', modifierZoneKey: 'damage_group', name: '同组增幅', status: 'ENABLED',
    domain: 'DAMAGE', calculationMode: 'RATIO_GROUP_ADD', applicationStage: direction === 'DEALT' ? 'DAMAGE_PRE_DEFENSE' : 'DAMAGE_POST_DEFENSE' };
  const result: SkillEffectResult = { description: null, sortOrder: 0, resultKey: 'amplify', name: '增幅', resultType: 'DAMAGE_MODIFIER', target: 'SOURCE',
    spellShieldBlockScope: null, lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED',
      reapplicationValueMode: null, periodicExecutionMode: null },
    valueRule: { value: fixedValue(.2), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
    detail: { modifierZoneKey: zone.modifierZoneKey, operation: 'INCREASE', direction, damageTypeKey: 'physics', deliveryKind: 'ANY', originKind: 'ANY', criticalFilter: 'ANY' } };
  const effect: SkillEffect = { ...metadata, gameId: 'groups', skillKey, effectKey: 'buff', name: '有限增幅',
    lifecycle: { durationValue: fixedValue(1000), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1), instanceScope: 'SOURCE',
      reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null,
      firstPeriodicExecution: null, endWhenShieldEndsResultKey: null }, results: [result] };
  const state = createNumericCompileState({ gameId: 'groups', skillKey, skillLevel: 1, characterLevel: 1,
    parameters: [], formulas: [], formulaNamespace: 'group_tests', bindParameters: false, allowAttributeReads: false, runtimeInputMessage: '必须明确静态输入' });
  snapshot.catalogs.modifierZones.push(zone);
  const context = { snapshot, configuration, source: snapshot.source.skillSources[0]!, side: 'source' as const, formulaNamespace: 'group_tests' };
  return { snapshot, context, effect, result, zone, state, damageTypes: snapshot.catalogs.damageTypes.map(row => row.type) };
}

describe('真实目录的分组增幅适配', () => {
  it.each(['DEALT', 'TAKEN'] as const)('永久及有限%s增幅使用真实方向与伤害类型，次数bucket不变', direction => {
    const { context, effect, result, zone, state, damageTypes } = fixture(direction);
    const expected = { kind: 'pipeline', command: 'damage', stage: direction === 'DEALT' ? 'outgoing_pre_mitigation' : 'incoming_post_mitigation',
      channel: 'all_damage', bucket: 'all_instances', multiplierGroupKey: zone.modifierZoneKey, valuePolicy: 'multiply', value: { op: 'const', value: 1.2 },
      condition: { op: 'read', path: 'damage.type.physics' } };
    expect(permanentModifier(context, result, 'result')).toMatchObject(expected);
    const before = structuredClone(effect);
    const timed = compileTimedDamageAmplification(effect, state, [zone], damageTypes, 'actual_source');
    expect(timed.providers[0]!.modifiers[0]).toMatchObject(expected);
    expect(timed.providers[0]).toMatchObject({ lifecycle: { durationMs: { op: 'const', value: 1000 }, maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' } });
    expect(timed.operations[0]).toMatchObject({ operation: 'apply_provider', target: 'self', providerDefinitionRef: timed.providers[0]!.providerKey });
    expect(effect).toEqual(before);
  });

  it('只为新方式扩大目标整体增幅，旧目标乘算仍只接受0至1减少', () => {
    const { effect, zone, state, result } = fixture();
    zone.domain = 'ATTRIBUTE'; zone.applicationStage = 'ATTRIBUTE_PERCENT';
    const attribute: SkillEffectResult = { ...result, resultType: 'ATTRIBUTE_CHANGE', target: 'TARGET',
      lifecycleBehavior: { ...result.lifecycleBehavior!, valueReadMode: 'APPLICATION_SNAPSHOT', reapplicationValueMode: 'REPLACE' },
      valueRule: { ...result.valueRule!, value: fixedValue(1.5) }, detail: { attributeKey: 'armor', operation: 'INCREASE', modifierZoneKey: zone.modifierZoneKey } };
    const authored = { gameId: state.gameId, skillKey: state.skillKey, skillLevel: 1, characterLevel: 1, effectKey: effect.effectKey,
      lifecycle: { ...effect.lifecycle!, instanceScope: 'SOURCE_TARGET' as const }, result: attribute, statuses: [], modifierZones: [zone], source: 'source' as const, target: 'target' as const };
    expect(compilePersistentResult(authored, 'target_group').provider.modifiers![0]).toMatchObject({ stage: 'total', valuePolicy: 'multiply', multiplierGroupKey: zone.modifierZoneKey, value: { op: 'const', value: 2.5 } });
    expect(() => compilePersistentResult({ ...authored, modifierZones: [{ ...zone, calculationMode: 'RATIO_MULTIPLY' }] }, 'legacy')).toThrow('目标整体比例');
    expect(() => compilePersistentResult({ ...authored, result: { ...attribute, detail: { ...attribute.detail, operation: 'DECREASE' } } }, 'decrease')).toThrow();
  });

  it('本技能静态等级参数按所选等级形成增幅，不额外输入运行期值', () => {
    const { effect, result, zone, state, damageTypes } = fixture();
    result.valueRule!.value = parameterValue('ratio');
    state.parameters = [{ ...metadata, gameId: state.gameId, skillKey: state.skillKey, parameterKey: 'ratio', name: '静态比例',
      valueType: 'DECIMAL', valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { '1': .5, '2': 1.5 } }];
    expect(compileTimedDamageAmplification(effect, state, [zone], damageTypes).providers[0]!.modifiers[0]!.value)
      .toEqual({ op: 'const', value: 1.5 });
    state.skillLevel = 2;
    expect(compileTimedDamageAmplification(effect, state, [zone], damageTypes).providers[0]!.modifiers[0]!.value)
      .toEqual({ op: 'const', value: 2.5 });
  });

  it('真实装备命中有限增幅保留父来源身份及生命周期参数的完整消费', () => {
    const file = new URL('../../tests/mechanisms/cases/grouped_equipment_hit_damage.json', import.meta.url);
    const snapshot = parseMechanismCase(readFileSync(file), file.pathname).buildSnapshot();
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_phage')!;
    configuration.parameters.push({ ...metadata, gameId: snapshot.gameId, skillKey: 'lab_phage', parameterKey: 'window', name: '增幅时长',
      valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 1500, levelValues: null });
    configuration.effects[0]!.lifecycle!.durationValue = parameterValue('window');
    const assembled = assembleTriggeredEquipment(snapshot);
    const parent = assembled.providers.find(row => row.kind === 'item')!;
    const dynamic = assembled.providers.find(row => row.kind === 'status')!;
    expect(dynamic.stableId).toBe(parent.stableId);
    expect(dynamic.lifecycle).toMatchObject({ durationMs: { op: 'const', value: 1500 }, maxStacks: 1 });
    expect(dynamic.modifiers![0]).toMatchObject({ multiplierGroupKey: 'out_group', bucket: 'all_instances' });
    const consumedWindow = assembled.coverage.find(row => row.authorPath.endsWith('.parameters.window'));
    expect(consumedWindow).toBeDefined();
    expect(consumedWindow!.note).toBeUndefined();
    expect(assembled.coverage.some(row => row.authorPath === 'catalogs.damageTypes.physics.type')).toBe(true);
  });

  it('自身有限属性及永久属性只在新区域输出组字段，比例0为中性项', () => {
    const { context, effect, zone, state, result } = fixture();
    zone.domain = 'ATTRIBUTE'; zone.applicationStage = 'ATTRIBUTE_PERCENT';
    const attribute: SkillEffectResult = { ...result, resultType: 'ATTRIBUTE_CHANGE', detail: { attributeKey: 'armor', operation: 'INCREASE', modifierZoneKey: zone.modifierZoneKey }, valueRule: { ...result.valueRule!, value: fixedValue(0) } };
    effect.results = [attribute];
    expect(compileTimedAttributeEffect(effect, state, [zone]).provider.modifiers![0]).toMatchObject({ stage: 'total', multiplierGroupKey: zone.modifierZoneKey, valuePolicy: 'multiply', value: { op: 'const', value: 1 } });
    expect(permanentModifier(context, attribute, 'attribute')).toMatchObject({ multiplierGroupKey: zone.modifierZoneKey });
    zone.calculationMode = 'RATIO_MULTIPLY';
    expect(permanentModifier(context, attribute, 'attribute')).not.toHaveProperty('multiplierGroupKey');
  });

  it.each(['direction', 'operation', 'critical', 'filter', 'missing_type', 'zone_stage', 'duplicate', 'foreign', 'invalid_key', 'multiple_results'])(
    '拒绝不完整或未支持的新分组声明：%s', field => {
      const { effect, result, zone, state, damageTypes } = fixture();
      if (result.resultType !== 'DAMAGE_MODIFIER') throw new Error('fixture');
      if (field === 'direction') result.detail.direction = 'TAKEN';
      if (field === 'operation') result.detail.operation = 'DECREASE';
      if (field === 'critical') result.detail.criticalFilter = 'CRITICAL_ONLY';
      if (field === 'filter') result.detail.deliveryKind = 'SKILL';
      if (field === 'missing_type') result.detail.damageTypeKey = null;
      if (field === 'zone_stage') zone.applicationStage = 'ATTRIBUTE_PERCENT';
      if (field === 'foreign') zone.gameId = 'other';
      if (field === 'invalid_key') zone.modifierZoneKey = result.detail.modifierZoneKey = '';
      if (field === 'multiple_results') effect.results.push(structuredClone(result));
      expect(() => compileTimedDamageAmplification(effect, state, field === 'duplicate' ? [zone, zone] : [zone], damageTypes)).toThrow();
    });

  it.each(['negative_raw', 'negative_multiplier', 'runtime_parameter'])(
    '不让裁剪或符号反转伪装为增幅：%s', field => {
      const { effect, result, zone, state, damageTypes } = fixture();
      if (field === 'negative_raw') { result.valueRule!.value = fixedValue(-.2); result.valueRule!.fixedMinValue = 0; }
      if (field === 'negative_multiplier') { result.valueRule!.value = fixedValue(-.2); result.valueRule!.fixedMultiplier = -1; }
      if (field === 'runtime_parameter') {
        result.valueRule!.value = parameterValue('ratio');
        state.parameters = [{ ...metadata, gameId: state.gameId, skillKey: state.skillKey, parameterKey: 'ratio', name: '运行输入', valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null }];
      }
      expect(() => compileTimedDamageAmplification(effect, state, [zone], damageTypes)).toThrow();
    });
});
