import type { SkillConfiguration } from '../../src/types/skillConfiguration';
import type { SkillEffectDamageModifierResult } from '../../src/types/skillEffect';
import { triggeredEquipmentSimulationSample, recurveBowConfiguration } from './simulationTriggeredEquipment';
import { syncSimulationSkillSources } from './simulationSkillSources';

export function cappedPhysicalReductionSample(side: 'source' | 'target' = 'target', maintenance = false) {
  const snapshot = triggeredEquipmentSimulationSample([], []);
  const key = 'lab_capped_physical';
  const configuration = JSON.parse(JSON.stringify(recurveBowConfiguration()).replaceAll('item_1043_passive', key)) as SkillConfiguration;
  configuration.skill.maxLevel = 5;
  configuration.parameters = [];
  configuration.formulas = [];
  const effect = configuration.effects[0]!;
  effect.lifecycle = { durationValue: null, maxStacksValue: { kind: 'FIXED', value: 1 }, applicationStacksValue: { kind: 'FIXED', value: 1 },
    instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP', reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY',
    periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null };
  const result: SkillEffectDamageModifierResult = { resultKey: 'flat', name: '分支平减', description: null, sortOrder: 10,
    resultType: 'DAMAGE_MODIFIER', target: 'SOURCE', spellShieldBlockScope: null,
    valueRule: { value: { kind: 'FIXED', value: 13 }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
    detail: { modifierZoneKey: 'lab_capped_pre', direction: 'TAKEN', operation: 'DECREASE', damageTypeKey: 'physics',
      deliveryKind: 'ANY', originKind: 'ANY', criticalFilter: 'ANY', condition: null, maximumReductionRatioValue: { kind: 'FIXED', value: 0.5 } },
    lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED', reapplicationValueMode: null, periodicExecutionMode: null } };
  effect.results = [result];
  const init = configuration.triggerRules[0]!;
  init.eventSource = { eventType: 'SOURCE_INITIALIZED', detail: {} };
  init.conditionGroups = [];
  init.actions[0]!.targetContext = 'EVENT_SOURCE';
  if (maintenance) {
    const restore = structuredClone(effect);
    restore.effectKey = 'received_cooldown'; restore.lifecycle = null;
    restore.results = [{ resultKey: 'reduce', name: '750毫秒', description: null, sortOrder: 10, resultType: 'COOLDOWN_CHANGE',
      target: 'SOURCE', spellShieldBlockScope: null, lifecycleBehavior: null,
      valueRule: { value: { kind: 'FIXED', value: 750 }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
      detail: { operation: 'REDUCE', affectedSkillScope: { mode: 'SKILLS', skillKeys: [key], skillCategoryKeys: [] } } }];
    configuration.effects.push(restore);
    const rule = structuredClone(init); rule.ruleKey = 'received'; rule.eventSource = { eventType: 'BASIC_ATTACK_RECEIVED', detail: {} };
    rule.actions[0]!.detail = { effectKey: restore.effectKey }; rule.actions[0]!.targetContext = 'CURRENT_TARGET';
    configuration.triggerRules.push(rule);
  }
  snapshot.catalogs.modifierZones.push({ ...snapshot.catalogs.modifierZones[0]!, modifierZoneKey: 'lab_capped_pre',
    gameId: snapshot.gameId, name: '承受伤害防御前平加', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
    domain: 'DAMAGE', calculationMode: 'FLAT_ADD', applicationStage: 'DAMAGE_PRE_DEFENSE', status: 'ENABLED' });
  for (const attributeKey of ['armor', 'magic_resistance']) if (!snapshot.catalogs.attributes.some(a => a.attributeKey === attributeKey))
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey });
  snapshot.skillConfigurations.push(configuration);
  snapshot[side].attachedSkills.push({ ...snapshot[side].attachedSkills[0]!, skillKey: key, skillName: '完整合成物理平减', sortOrder: 40 });
  snapshot.selection[`${side}SkillSettings`].push({ origin: { kind: 'CHARACTER', characterKey: snapshot[side].character.characterKey },
    skillKey: key, enabled: true, skillLevel: 5 });
  syncSimulationSkillSources(snapshot);
  const source = snapshot[side].skillSources.find(s => s.skillKey === key)!;
  return { snapshot, configuration, result, effect, source, side };
}

export function useOwnerBonusFormula(input: ReturnType<typeof cappedPhysicalReductionSample>) {
  const { configuration, result, snapshot } = input;
  configuration.formulas.push({ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, formulaKey: 'points', name: '当前拥有者BONUS',
    description: null, sortOrder: 0, createdAt: '', updatedAt: '', expression: { inputs: [{ key: 'armor',
      binding: { kind: 'attribute', object: 'source', view: 'current_frame', attributeKey: 'armor', valueKind: 'BONUS' } }],
      stages: [{ key: 'output', name: '当前点数', expression: { op: 'add', args: [{ op: 'const', value: '5' },
        { op: 'mul', args: [{ op: 'const', value: '0.03' }, { op: 'read', inputKey: 'armor' }] }] } }], outputStageKey: 'output' } });
  result.valueRule.value = { kind: 'FORMULA', formulaKey: 'points' };
}
