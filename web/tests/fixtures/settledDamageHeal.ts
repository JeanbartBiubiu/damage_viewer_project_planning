import { recurveBowConfiguration, triggeredEquipmentSimulationSample } from './simulationTriggeredEquipment';
import { syncSimulationSkillSources } from './simulationSkillSources';
import type { SkillConfiguration } from '../../src/types/skillConfiguration';

/** 合成作者图；不注入核定值，不调用编译或运行器。 */
export function settledDamageHealSample() {
  const snapshot = triggeredEquipmentSimulationSample([], []);
  snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'common', name: '合成普通主动技能' });
  const metadata = { gameId: snapshot.gameId, skillKey: 'authored_spell_damage', description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
  const spell: SkillConfiguration = {
    skill: { ...metadata, name: '合成真实主动伤害来源', maxLevel: 1, status: 'ENABLED', skillCategoryKeys: ['common'] },
    parameters: [], formulas: [], internalStates: [], baseDigest: 'synthetic_spell_source',
    effects: [{ ...metadata, effectKey: 'hit', name: '真实接触伤害', lifecycle: null, results: [{
      ...recurveBowConfiguration().effects[0]!.results[0]!, resultKey: 'damage', resultType: 'DAMAGE', target: 'TARGET',
      detail: { damageTypeKey: 'physics', deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: [] },
      valueRule: { value: { kind: 'FIXED', value: 200 }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }
    }] }],
    processes: [{ ...metadata, processKey: 'cast', name: '合成250毫秒真实施放', activationType: 'ACTIVE',
      cooldown: { durationValue: { kind: 'FIXED', value: 10000 }, startMoment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } },
      effectBindings: [], stateOperations: [], steps: [{ stepKey: 'cast_time', name: '真实延迟', description: null, sortOrder: 0,
        stepType: 'DELAY', detail: { delayValue: { kind: 'FIXED', value: 250 } }, occupiesAction: true }] }],
    triggerRules: [{ ruleKey: 'initial', name: '首次施放', description: null, sortOrder: 0,
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: metadata.skillKey, useKind: 'ACTIVE', castPhase: 'INITIAL' } },
      conditionGroups: [], perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null,
      actions: [{ actionKey: 'start', name: '启动真实过程', actionType: 'START_PROCESS', targetContext: 'CURRENT_TARGET', detail: { processKey: 'cast' },
        runtimeInputBindings: [], resultModifiers: [], sortOrder: 0 }] },
    { ruleKey: 'hit', name: '真实命中', description: null, sortOrder: 1,
      eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: metadata.skillKey } }, conditionGroups: [],
      perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null,
      actions: [{ actionKey: 'damage', name: '执行伤害', actionType: 'EXECUTE_EFFECT', targetContext: 'CURRENT_TARGET', detail: { effectKey: 'hit' },
        runtimeInputBindings: [], resultModifiers: [], sortOrder: 0 }] }]
  };
  snapshot.skillConfigurations.push(spell);
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[0]!, skillKey: spell.skill.skillKey, skillName: spell.skill.name });
  const spellOrigin = { kind: 'CHARACTER' as const, characterKey: snapshot.source.character.characterKey };
  snapshot.selection.sourceSkillSettings.push({ origin: spellOrigin, skillKey: spell.skill.skillKey, enabled: true, skillLevel: 1 });
  snapshot.selection.plannedSkills.push({ origin: spellOrigin, skillKey: spell.skill.skillKey, skillLevel: 1, phaseKinds: ['INITIAL'] });
  const skillKey = 'authored_settled_restore';
  const configuration = recurveBowConfiguration();
  configuration.skill.gameId = snapshot.gameId;
  configuration.skill.skillKey = skillKey;
  configuration.skill.name = '本笔金额自身恢复合成来源';
  for (const row of [...configuration.parameters, ...configuration.effects]) { row.skillKey = skillKey; row.gameId = snapshot.gameId; }
  const parameter = configuration.parameters[0]!;
  parameter.parameterKey = 'heal_percent_points'; parameter.fixedValue = 18;
  configuration.parameters.push({ ...parameter, parameterKey: 'settled_amount', name: '本次动作真实金额',
    valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null, sortOrder: 20 });
  configuration.formulas = [{ gameId: snapshot.gameId, skillKey, formulaKey: 'heal_amount', name: '本笔金额乘原百分数',
    description: null, sortOrder: 0, createdAt: '', updatedAt: '', expression: {
      inputs: [
        { key: 'amount', binding: { kind: 'parameter', skillKey, parameterKey: 'settled_amount' } },
        { key: 'ratio', binding: { kind: 'parameter', skillKey, parameterKey: 'heal_percent_points' } }
      ], stages: [{ key: 'output', name: '百分比自身治疗', expression: { op: 'div', args: [
        { op: 'mul', args: [{ op: 'read', inputKey: 'amount' }, { op: 'read', inputKey: 'ratio' }] },
        { op: 'const', value: '100' }
      ] } }], outputStageKey: 'output'
    } }];
  const effect = configuration.effects[0]!; effect.effectKey = 'heal_self';
  effect.results = [{ ...effect.results[0]!, resultKey: 'heal', resultType: 'DIRECT_HEAL', target: 'SOURCE', detail: {},
    lifecycleBehavior: null, spellShieldBlockScope: null,
    valueRule: { value: { kind: 'FORMULA', formulaKey: 'heal_amount' }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null } }];
  const rule = configuration.triggerRules[0]!; rule.ruleKey = 'on_settled_damage';
  rule.eventSource = { eventType: 'DAMAGE_DEALT', detail: { sourceSkillKey: null, damageTypeKey: null, deliveryKind: 'SKILL', originKind: 'ANY' } };
  rule.conditionGroups = [{ groupKey: 'champion', name: '真实唯一英雄对手', sortOrder: 0,
    conditions: [{ conditionKey: 'champion', conditionType: 'TARGET_CATEGORY_CHECK', detail: { categories: ['CHAMPION'] }, sortOrder: 0 }] }];
  const action = rule.actions[0]!;
  if (action.actionType !== 'EXECUTE_EFFECT') throw new Error('合成治疗动作需要效果执行');
  action.actionKey = 'restore_self'; action.detail = { effectKey: effect.effectKey };
  action.runtimeInputBindings = [{ bindingKey: 'read_settled_amount', parameterKey: 'settled_amount', sourceType: 'EVENT_VALUE', detail: { eventValueKey: 'POST_DEFENSE_DAMAGE' } }];
  snapshot.skillConfigurations.push(configuration);
  const actor = snapshot.source;
  actor.attachedSkills.push({ gameId: snapshot.gameId, characterKey: actor.character.characterKey, characterName: actor.character.name,
    skillKey, skillName: configuration.skill.name, skillStatus: 'ENABLED', sortOrder: 10 });
  snapshot.selection.sourceSkillSettings.push({ origin: { kind: 'CHARACTER', characterKey: actor.character.characterKey }, skillKey, skillLevel: 1, enabled: true });
  syncSimulationSkillSources(snapshot);
  return { snapshot, configuration, rule, action, effect, parameterKey: 'settled_amount' };
}

