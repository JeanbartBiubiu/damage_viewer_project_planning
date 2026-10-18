import { simulationActiveSample } from './simulationActiveSkill';
import { syncSimulationSkillSources } from './simulationSkillSources';
import { fixedValue } from '../../src/types/numericValue';
import type { SkillEffect } from '../../src/types/skillEffect';
import { sceneInitialParameterRequirements, type SceneInitialParameterInput } from '../../src/engine/sceneInitialParameterInput';

export function simulationSceneInitialParameter(skillKey = 'initial_alpha', parameterKey = 'prebattle_count') {
  const snapshot = simulationActiveSample();
  const configuration = snapshot.skillConfigurations[1]!;
  const previous = configuration.skill.skillKey;
  configuration.skill.skillKey = skillKey;
  for (const group of [configuration.processes, configuration.effects]) for (const row of group) row.skillKey = skillKey;
  for (const rule of configuration.triggerRules) {
    if (rule.eventSource.eventType === 'SKILL_USED' || rule.eventSource.eventType === 'SKILL_HIT') rule.eventSource.detail.sourceSkillKey = skillKey;
  }
  snapshot.selection.plannedSkills[0]!.skillKey = skillKey;
  for (const side of ['source', 'target'] as const) {
    const actor = snapshot[side];
    for (const row of actor.attachedSkills) if (row.skillKey === previous) row.skillKey = skillKey;
    for (const row of snapshot.selection[`${side}SkillSettings`]) if (row.skillKey === previous) row.skillKey = skillKey;
    if (!actor.attachedSkills.some(row => row.skillKey === skillKey)) {
      actor.attachedSkills.push({ ...snapshot.source.attachedSkills.find(row => row.skillKey === skillKey)!,
        characterKey: actor.character.characterKey, characterName: actor.character.name });
      snapshot.selection[`${side}SkillSettings`].push({ origin: { kind: 'CHARACTER', characterKey: actor.character.characterKey },
        skillKey, enabled: true, skillLevel: 1 });
    }
  }
  configuration.parameters.push({ gameId: snapshot.gameId, skillKey, parameterKey, name: '战前层数', valueType: 'INTEGER',
    valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null, sortOrder: 0, description: null, createdAt: '', updatedAt: '' });
  configuration.formulas.push({ gameId: snapshot.gameId, skillKey, formulaKey: 'prebattle_bonus', name: '每层双抗', description: null,
    sortOrder: 0, createdAt: '', updatedAt: '', expression: { inputs: [{ key: 'stacks', binding: { kind: 'parameter', skillKey, parameterKey } }],
      stages: [{ key: 'bonus', name: '加成', expression: { op: 'mul', args: [{ op: 'read', inputKey: 'stacks' }, { op: 'const', value: '0.2' }] } }], outputStageKey: 'bonus' } });
  const base = configuration.effects[0]!;
  configuration.effects.push({ ...structuredClone(base), effectKey: 'permanent_resist', name: '战前双抗',
    lifecycle: { durationValue: null, maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1), instanceScope: 'SOURCE',
      reapplicationStackMode: 'KEEP', reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY', periodicIntervalValue: null,
      firstPeriodicExecution: null, endWhenShieldEndsResultKey: null },
    results: ['armor', 'magic_resistance'].map((attributeKey, index) => ({ resultKey: attributeKey, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE',
      sortOrder: index, name: attributeKey, valueRule: { value: { kind: 'FORMULA', formulaKey: 'prebattle_bonus' }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      spellShieldBlockScope: null, lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
        reapplicationValueMode: 'REPLACE', periodicExecutionMode: null }, detail: { attributeKey, operation: 'INCREASE', modifierZoneKey: 'flat' } })) } as SkillEffect);
  const template = configuration.triggerRules[0]!;
  configuration.triggerRules.push({ ...structuredClone(template), ruleKey: 'initialize_resist', eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} },
    actions: [{ actionKey: 'apply_resist', name: '战前初始化', actionType: 'EXECUTE_EFFECT', sortOrder: 0, targetContext: 'EVENT_SOURCE',
      detail: { effectKey: 'permanent_resist' }, resultModifiers: [], runtimeInputBindings: [{ bindingKey: 'prebattle', parameterKey,
        sourceType: 'SCENE_INITIAL_PARAMETER', detail: { minValue: 0, maxValue: 150 } }] }] });
  snapshot.catalogs.modifierZones.push({ gameId: snapshot.gameId, modifierZoneKey: 'flat', name: '属性平加', description: null,
    domain: 'ATTRIBUTE', calculationMode: 'FLAT_ADD', applicationStage: 'ATTRIBUTE_FLAT', sortOrder: 0, status: 'ENABLED', createdAt: '', updatedAt: '' });
  snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes.find(row => row.attributeKey === 'armor')!, attributeKey: 'magic_resistance' });
  snapshot.source.selectedLevelValues.magic_resistance = 20;
  snapshot.target.selectedLevelValues.magic_resistance = 20;
  syncSimulationSkillSources(snapshot);
  const inputs = (source: number, target: number): SceneInitialParameterInput[] => sceneInitialParameterRequirements(snapshot).map(row => ({
    side: row.side, origin: structuredClone(row.origin), skillKey: row.skillKey, parameterKey: row.parameterKey,
    declarationIdentity: row.declarationIdentity, value: row.side === 'source' ? source : target }));
  return { snapshot, configuration, inputs };
}
