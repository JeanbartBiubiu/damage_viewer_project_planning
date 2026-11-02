import { simulationSkillSourceIdentity } from '../../src/services/simulationSkillSourceIdentity';
import { plannedSkillRuleKeys } from '../../src/engine/simulation/sources/description';
import type { SimulationSelection, SimulationSkillOrigin, SimulationSkillSetting, SimulationSkillSource, SimulationSnapshot } from '../../src/types/simulationSnapshot';

const naturalEvents = new Set(['SOURCE_INITIALIZED', 'BASIC_ATTACK_START', 'BASIC_ATTACK_HIT', 'BASIC_ATTACK_RECEIVED',
  'DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN', 'ATTACK_LINK_APPLIED', 'HIT_LINK_APPLIED']);

export function syncSimulationSkillSources(snapshot: SimulationSnapshot): SimulationSnapshot {
  const basicAttackCategoryKey = snapshot.catalogs.calculationRules.configuration?.basicAttackCategoryKey;
  for (const side of ['source', 'target'] as const) {
    const combatant = snapshot[side];
    const previous = new Map(combatant.skillSources.map(source => [simulationSkillSourceIdentity(source.origin, source.skillKey), source]));
    const sources: SimulationSkillSource[] = [];
    const seen = new Set<string>();
    const add = (origin: SimulationSkillOrigin, relation: { skillKey: string; skillName: string; skillStatus: 'ENABLED' | 'DISABLED' }, grantedLevel?: number) => {
      const identity = simulationSkillSourceIdentity(origin, relation.skillKey);
      if (seen.has(identity)) throw new Error(`独立样例重复默认来源：${side} ${identity}`);
      seen.add(identity);
      const configuration = snapshot.skillConfigurations.find(item => item.skill.skillKey === relation.skillKey);
      const setting = snapshot.selection[`${side}SkillSettings`].find(item => simulationSkillSourceIdentity(item.origin, item.skillKey) === identity);
      const selectedAttack = side === 'source' && origin.kind === 'CHARACTER' && relation.skillKey === snapshot.selection.basicAttackSkillKey;
      const skillLevel = selectedAttack ? snapshot.selection.basicAttackLevel : grantedLevel ?? setting?.skillLevel ?? previous.get(identity)?.skillLevel ?? null;
      const enabled = setting?.enabled ?? true;
      const planned = side === 'source' ? snapshot.selection.plannedSkills.find(plan => simulationSkillSourceIdentity(plan.origin, plan.skillKey) === identity) : undefined;
      const plannedRoots = configuration && planned ? plannedSkillRuleKeys(configuration, planned.phaseKinds) : [];
      const rules = configuration?.triggerRules.filter(rule => naturalEvents.has(rule.eventSource.eventType)
        || plannedRoots.includes(rule.ruleKey)) ?? [];
      const inactiveReason = relation.skillStatus === 'DISABLED' ? 'GLOBAL_DISABLED' : !enabled ? 'SCENE_DISABLED' : skillLevel === 0 ? 'UNLEARNED'
        : origin.kind === 'CHARACTER' && basicAttackCategoryKey != null && configuration?.skill.skillCategoryKeys.includes(basicAttackCategoryKey) && !selectedAttack ? 'NO_AUTONOMOUS_ATTACK'
          : !configuration || !rules.length ? configuration?.triggerRules.some(rule => rule.eventSource.eventType === 'SKILL_USED' || rule.eventSource.eventType === 'SKILL_HIT')
            ? 'ACTIVE_DEFERRED' : 'CONFIGURATION_INCOMPLETE'
            : skillLevel === null && configuration.parameters.some(parameter => parameter.valueMode === 'SKILL_LEVEL') ? 'LEVEL_REQUIRED' : null;
      sources.push({ origin, skillKey: relation.skillKey, skillName: relation.skillName, skillStatus: relation.skillStatus, enabled, skillLevel,
        enabledRuleKeys: inactiveReason === null ? rules.map(rule => rule.ruleKey).sort() : [], inactiveReason });
    };
    for (const relation of combatant.attachedSkills) add({ kind: 'CHARACTER', characterKey: combatant.character.characterKey }, relation);
    for (const item of combatant.selectedEquipment) for (const relation of item.attachedSkills) {
      add({ kind: 'EQUIPMENT', equipmentKey: item.equipment.equipmentKey }, relation, 1);
    }
    for (const build of combatant.selectedBuilds) for (const selection of build.configuration.selections) {
      for (const grant of build.definition.skillRelations.filter(relation => relation.optionKey === selection.optionKey && relation.activationRank <= selection.rank)) {
        add({ kind: 'BUILD_OPTION', systemKey: build.configuration.systemKey, roleKey: selection.roleKey, groupKey: selection.groupKey,
          slotKey: selection.slotKey, optionKey: selection.optionKey }, grant, grant.skillLevelMode === 'FIXED' ? grant.fixedSkillLevel! : selection.rank);
      }
    }
    combatant.skillSources = sources;
  }
  return snapshot;
}

export function isolatedCharacterSkillSettings(snapshot: SimulationSnapshot, side: 'source' | 'target'): SimulationSkillSetting[] {
  return snapshot[side].skillSources.filter(source => source.origin.kind === 'CHARACTER' && source.skillStatus === 'ENABLED'
    && !(side === 'source' && source.skillKey === snapshot.selection.basicAttackSkillKey))
    .map(source => ({ origin: source.origin, skillKey: source.skillKey, enabled: false }));
}

export function isolatedSimulationSelection(snapshot: SimulationSnapshot): SimulationSelection {
  return { ...snapshot.selection, sourceSkillSettings: isolatedCharacterSkillSettings(snapshot, 'source'),
    targetSkillSettings: isolatedCharacterSkillSettings(snapshot, 'target') };
}
