import { simulationSample } from './simulationSnapshot';
import type { SkillConfiguration } from '../../src/types/skillConfiguration';
import type { SkillTriggerRuleDetail } from '../../src/types/skillTriggerRule';
import { fixedValue } from '../../src/types/numericValue';
import { assembleSimulation, inspectSimulationSnapshot } from '../../src/engine/simulationAdapter';

export function preparedActiveSample(healing = false) {
  const snapshot = simulationActiveSample(healing);
  const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
  return { snapshot, prepared: assembleSimulation(snapshot, attributes, { source: 250, target: 500 }) };
}

export function simulationActiveSample(healing = false) {
  const snapshot = simulationSample();
  const basic = snapshot.skillConfigurations[0]!;
  const skillKey = 'sample_active';
  const origin = { kind: 'CHARACTER' as const, characterKey: snapshot.source.character.characterKey };
  snapshot.selection.basicAttackSkillKey = null;
  snapshot.selection.basicAttackLevel = null;
  snapshot.selection.plannedSkills = [{ origin, skillKey, skillLevel: 1, phaseKinds: ['INITIAL'] }];
  snapshot.selection.sourceSkillSettings.push({ origin, skillKey, enabled: true, skillLevel: 1 });
  snapshot.source.skillSources[0]!.enabledRuleKeys = [];
  snapshot.source.skillSources[0]!.inactiveReason = 'NO_AUTONOMOUS_ATTACK';
  const initial: SkillTriggerRuleDetail = { ...structuredClone(basic.triggerRules[0]!), ruleKey: 'first_cast',
    eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
    actions: [{ ...structuredClone(basic.triggerRules[0]!.actions[0]!), actionType: 'START_PROCESS', detail: { processKey: 'cast' } }] };
  const configuration: SkillConfiguration = { ...structuredClone(basic),
    skill: { ...basic.skill, skillKey, name: '独立单段主动', skillCategoryKeys: ['active'] }, parameters: [], formulas: [],
    processes: [{ ...structuredClone(basic.processes[0]!), skillKey, processKey: 'cast', effectBindings: [],
      cooldown: { durationValue: fixedValue(1000), startMoment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } },
      steps: [{ stepKey: 'delay', name: '有限延时', description: null, sortOrder: 0, occupiesAction: true, stepType: 'DELAY', detail: { delayValue: fixedValue(100) } }] }],
    effects: [], triggerRules: [initial], baseDigest: 'active_independent_sample' };
  if (!healing) {
    const damage = structuredClone(basic.effects[1]!.results[0]!);
    if (damage.resultType !== 'DAMAGE') throw new Error('独立样例需要伤害结果');
    damage.detail.deliveryKind = 'SKILL';
    damage.detail.critical = { mode: 'DISALLOWED', multiplierValue: null };
    damage.valueRule!.value = fixedValue(100);
    configuration.effects.push({ ...basic.effects[1]!, skillKey, results: [damage] });
    configuration.triggerRules.push({ ...structuredClone(basic.triggerRules[1]!),
      eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: skillKey } } });
  } else {
    for (const [index, comparator, amount] of [[0, 'GTE', 40], [1, 'LT', 60]] as const) {
      const effectKey = `heal_${index}`;
      configuration.effects.push({ ...basic.effects[0]!, skillKey, effectKey,
        results: [{ resultKey: 'heal', name: '自身治疗', resultType: 'DIRECT_HEAL', target: 'SOURCE', description: null, sortOrder: 0,
          valueRule: { value: fixedValue(amount), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
          detail: {}, lifecycleBehavior: null, spellShieldBlockScope: null }] });
      configuration.triggerRules.push({ ...structuredClone(initial), ruleKey: effectKey, sortOrder: index + 1,
        conditionGroups: [{ groupKey: 'hp', name: '原始生命门槛', sortOrder: 0,
          conditions: [{ conditionKey: 'threshold', conditionType: 'ATTRIBUTE_COMPARE', sortOrder: 0,
            detail: { subject: 'SOURCE', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO', comparator, comparisonValue: fixedValue(0.4) } }] }],
        actions: [{ actionKey: 'heal', name: '直接治疗', actionType: 'EXECUTE_EFFECT', sortOrder: 0, targetContext: 'CURRENT_TARGET',
          detail: { effectKey }, runtimeInputBindings: [], resultModifiers: [] }] });
    }
  }
  snapshot.skillConfigurations.push(configuration);
  snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'active', name: '主动' });
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[0]!, skillKey, skillName: configuration.skill.name });
  snapshot.source.skillSources.push({ origin, skillKey, skillName: configuration.skill.name, skillStatus: 'ENABLED', enabled: true,
    skillLevel: 1, enabledRuleKeys: configuration.triggerRules.map(rule => rule.ruleKey).sort(), inactiveReason: null });
  return snapshot;
}
