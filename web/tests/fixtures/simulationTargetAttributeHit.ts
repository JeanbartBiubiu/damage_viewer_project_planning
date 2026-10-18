import { simulationActiveSample } from './simulationActiveSkill';
import { syncSimulationSkillSources } from './simulationSkillSources';
import { fixedValue } from '../../src/types/numericValue';
import type { SkillEffect } from '../../src/types/skillEffect';

export function simulationTargetAttributeHit(skillKey = 'shred_alpha') {
  const snapshot = JSON.parse(JSON.stringify(simulationActiveSample()).replaceAll('sample_active', skillKey)) as ReturnType<typeof simulationActiveSample>;
  const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === skillKey)!;
  configuration.processes[0]!.steps = [{ stepKey: 'now', name: '不占用的即时步骤', stepType: 'IMMEDIATE', detail: {}, occupiesAction: false,
    description: null, sortOrder: 0 }];
  snapshot.target.selectedLevelValues.armor = 30;
  snapshot.target.selectedLevelValues.magic_resistance = 40;
  if (!snapshot.catalogs.attributes.some(row => row.attributeKey === 'magic_resistance')) {
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes.find(row => row.attributeKey === 'armor')!,
      attributeKey: 'magic_resistance', name: '测试魔抗' });
  }
  snapshot.catalogs.modifierZones.push({ gameId: snapshot.gameId, modifierZoneKey: 'target_flat', name: '测试属性平加', domain: 'ATTRIBUTE',
    calculationMode: 'FLAT_ADD', applicationStage: 'ATTRIBUTE_FLAT', description: null, status: 'ENABLED', sortOrder: 0, createdAt: '', updatedAt: '' });
  const hit = configuration.triggerRules.find(row => row.eventSource.eventType === 'SKILL_HIT')!;
  hit.actions[0]!.sortOrder = 30;
  for (const [index, attributeKey] of ['armor', 'magic_resistance'].entries()) {
    const effectKey = `reduce_${attributeKey}`;
    const effect: SkillEffect = { gameId: snapshot.gameId, skillKey, effectKey, name: effectKey, description: null, sortOrder: index,
      createdAt: '', updatedAt: '', lifecycle: { instanceScope: 'SOURCE_TARGET', maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
        durationValue: fixedValue(2000), reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE',
        periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null },
      results: [{ resultKey: 'decrease', name: effectKey, resultType: 'ATTRIBUTE_CHANGE', target: 'TARGET', description: null, sortOrder: 0,
        spellShieldBlockScope: null, valueRule: { value: fixedValue(12), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
        detail: { attributeKey, operation: 'DECREASE', modifierZoneKey: 'target_flat' },
        lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED', reapplicationValueMode: 'REPLACE', periodicExecutionMode: null } }] };
    configuration.effects.push(effect);
    hit.actions.push({ actionKey: `apply_${attributeKey}`, name: effectKey, actionType: 'EXECUTE_EFFECT', targetContext: 'CURRENT_TARGET',
      detail: { effectKey }, runtimeInputBindings: [], resultModifiers: [], sortOrder: (index + 1) * 10 });
  }
  syncSimulationSkillSources(snapshot);
  return { snapshot, configuration };
}
