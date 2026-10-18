import { simulationSample } from './simulationSnapshot';
import { syncSimulationSkillSources } from './simulationSkillSources';
import { skillFormulaDefinition } from './skillFormulaDefinition';
import { fixedValue, formulaValue } from '../../src/types/numericValue';
import type { SkillConfiguration } from '../../src/types/skillConfiguration';

/** 异名独立作者向量；所有0及上下界均为测试显式值，不是英雄默认资料。 */
export function simulationBasicAttackContribution(authorKey = 'extra_alpha', parentKey = 'attack_alpha', chance = 0) {
  const snapshot = JSON.parse(JSON.stringify(simulationSample()).replaceAll('sample_basic_attack', parentKey)) as ReturnType<typeof simulationSample>;
  const base = snapshot.skillConfigurations[0]!;
  Object.assign(snapshot.source.selectedLevelValues, { critical_strike_chance: chance, critical_strike_damage_bonus_percent: .25,
    armor_pen_flat: 0, armor_pen_percent: 0, life_steal_percent: 0 });
  const metadata = { gameId: snapshot.gameId, skillKey: authorKey, description: null, createdAt: '', updatedAt: '', sortOrder: 0 };
  const configuration: SkillConfiguration = {
    skill: { ...base.skill, skillKey: authorKey, name: authorKey, maxLevel: 2, skillCategoryKeys: ['passive'] },
    parameters: [{ ...metadata, parameterKey: 'factor', name: '附加比例', valueType: 'DECIMAL', valueMode: 'SKILL_LEVEL',
      fixedValue: null, levelValues: { '1': .1, '2': .2 } },
    { ...metadata, parameterKey: 'base_multiplier', name: '与父同名的作者倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 3, levelValues: null }],
    formulas: [{ ...metadata, formulaKey: 'extra', name: '独立作者伤害', expression: skillFormulaDefinition(authorKey,
      { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [{ nodeType: 'PARAMETER', parameterKey: 'factor' },
        { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'attack_damage', attributeValueKind: 'TOTAL' }] }) },
    { ...metadata, formulaKey: 'critical', name: '独立作者暴击', expression: skillFormulaDefinition(authorKey,
      { nodeType: 'OPERATION', operation: 'ADD', operands: [{ nodeType: 'PARAMETER', parameterKey: 'base_multiplier' },
        { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'critical_strike_damage_bonus_percent', attributeValueKind: 'TOTAL' }] }) }],
    effects: [{ ...metadata, effectKey: 'extra', name: '附加组成', lifecycle: null, results: [{ resultKey: 'damage', name: '真实伤害',
      resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 0, spellShieldBlockScope: null, lifecycleBehavior: null,
      valueRule: { value: formulaValue('extra'), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      detail: { damageTypeKey: 'pure', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT',
        critical: { mode: 'SOURCE_CRIT_CHANCE', multiplierValue: formulaValue('critical') }, vampQualification: 'RESOLVED', vampOverrides: [] } }] }],
    processes: [], internalStates: [], triggerRules: [{ ruleKey: 'hit', name: '父命中组成', description: null, sortOrder: 0,
      eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }, conditionGroups: [], perTargetCooldown: null,
      maxTriggersPerProcess: null, oncePerUse: null, actions: [{ actionKey: 'apply', name: '追加组成', sortOrder: 0,
        actionType: 'EXECUTE_EFFECT', targetContext: 'CURRENT_TARGET', detail: { effectKey: 'extra' }, runtimeInputBindings: [], resultModifiers: [] }] }],
    baseDigest: 'independent_' + authorKey
  };
  snapshot.skillConfigurations.push(configuration);
  snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'passive', name: '自然被动' });
  const physical = snapshot.catalogs.damageTypes[0]!;
  snapshot.catalogs.damageTypes.push({ type: { ...physical.type, damageTypeKey: 'pure', name: '独立无抗性伤害' },
    formula: { ...physical.formula!, damageTypeKey: 'pure', formula: { inputs: [], stages: [{ key: 'factor', name: '明确倍率1',
      expression: { op: 'const', value: '1' } }], outputStageKey: 'factor' } } });
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[0]!, skillKey: authorKey, skillName: authorKey, sortOrder: 1 });
  snapshot.selection.sourceSkillSettings.push({ origin: { kind: 'CHARACTER', characterKey: snapshot.selection.sourceCharacterKey },
    skillKey: authorKey, enabled: true, skillLevel: 2 });
  syncSimulationSkillSources(snapshot);
  return { snapshot, configuration, fixed: fixedValue };
}
