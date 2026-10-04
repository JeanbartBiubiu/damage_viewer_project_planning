import type { SkillConfiguration } from '../../src/types/skillConfiguration';
import type { SkillEffectResult } from '../../src/types/skillEffect';
import { equipmentSimulationSample } from './simulationEquipment';

export function permanentEquipmentSimulationSample(sourceKeys: string[] = [], targetKeys: string[] = []) {
  const snapshot = equipmentSimulationSample(sourceKeys, targetKeys);
  const basic = snapshot.skillConfigurations[0]!;
  const metadata = { createdAt: '', updatedAt: '' };
  snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'passive' });
  for (const side of ['source', 'target'] as const) for (const item of snapshot[side].selectedEquipment) {
    const equipmentKey = item.equipment.equipmentKey;
    if (equipmentKey !== 'item_3065' && equipmentKey !== 'item_3110') continue;
    const skillKey = `${equipmentKey}_passive`;
    item.attributes.attributeValues = equipmentKey === 'item_3065' ? { hp: 400 } : { armor: 75 };
    item.attachedSkills = [{ gameId: 'lol', equipmentKey, equipmentName: item.equipment.name, skillKey,
      skillName: '独立常驻结构用例', skillStatus: 'ENABLED', sortOrder: 0 }];
    if (snapshot.skillConfigurations.some(row => row.skill.skillKey === skillKey)) continue;
    const configuration: SkillConfiguration = { ...structuredClone(basic),
      skill: { ...basic.skill, skillKey, name: '独立常驻结构用例', skillCategoryKeys: ['passive'] },
      parameters: [{ ...basic.parameters[0]!, skillKey, parameterKey: 'ratio', fixedValue: equipmentKey === 'item_3065' ? .25 : .2 }],
      formulas: [], processes: [], internalStates: [], effects: [], triggerRules: [] };
    const common = { name: '结构用例结果', target: 'SOURCE' as const, description: null, sortOrder: 0,
      spellShieldBlockScope: null, valueRule: { value: { kind: 'PARAMETER' as const, parameterKey: 'ratio' }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
      lifecycleBehavior: { moment: 'PERSISTENT' as const, valueReadMode: 'APPLICATION_SNAPSHOT' as const,
        stackValueMode: 'SHARED' as const, reapplicationValueMode: 'REPLACE' as const, periodicExecutionMode: null } };
    const results: SkillEffectResult[] = equipmentKey === 'item_3065' ? [
      { ...common, resultKey: 'received_heal', resultType: 'HEALING_MODIFIER', detail: { direction: 'RECEIVED', healingKind: 'ANY', operation: 'INCREASE', modifierZoneKey: 'received_heal' } },
      { ...common, resultKey: 'received_shield', resultType: 'SHIELD_RECEIVED_MODIFIER', detail: { operation: 'INCREASE', modifierZoneKey: 'received_shield' } }
    ] : [{ ...common, resultKey: 'aura', resultType: 'ATTRIBUTE_CHANGE', target: 'TARGET', detail: { attributeKey: 'attack_speed', operation: 'DECREASE', modifierZoneKey: 'aura' } }];
    for (const result of results) {
      configuration.effects.push({ gameId: 'lol', skillKey, effectKey: result.resultKey, name: result.name, description: null, sortOrder: 0, ...metadata,
        lifecycle: { durationValue: null, maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 },
          instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY',
          periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null }, results: [result] });
      configuration.triggerRules.push({ ruleKey: `initialize_${result.resultKey}`, name: result.name, description: null, sortOrder: 0,
        eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, conditionGroups: [], perTargetCooldown: null,
        maxTriggersPerProcess: null, oncePerUse: null, actions: [{ actionKey: result.resultKey, name: result.name, sortOrder: 0, actionType: 'EXECUTE_EFFECT',
          targetContext: 'EVENT_SOURCE', detail: { effectKey: result.resultKey }, runtimeInputBindings: [], resultModifiers: [] }] });
      snapshot.catalogs.modifierZones.push({ gameId: 'lol', modifierZoneKey: result.resultKey, name: result.name,
        domain: result.resultType === 'ATTRIBUTE_CHANGE' ? 'ATTRIBUTE' : result.resultType === 'HEALING_MODIFIER' ? 'HEALING' : 'SHIELD', calculationMode: 'RATIO_ADD',
        applicationStage: result.resultType === 'ATTRIBUTE_CHANGE' ? 'ATTRIBUTE_PERCENT' : result.resultType === 'HEALING_MODIFIER' ? 'HEALING_RESULT' : 'SHIELD_RESULT',
        description: null, status: 'ENABLED', sortOrder: 0, ...metadata });
    }
    snapshot.skillConfigurations.push(configuration);
  }
  return snapshot;
}
