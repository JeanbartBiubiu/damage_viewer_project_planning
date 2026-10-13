import { authoredCalculationRules } from './simulationCalculationRules';
import { skillFormulaDefinition } from './skillFormulaDefinition';
import type { SimulationSelectedBuild, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import type { SkillEffectResult } from '../../src/types/skillEffect';
import { fixedValue, formulaValue } from '../../src/types/numericValue';

/** 独立作者结构用例，不是正式英雄数据，也不是引擎基准样例副本。 */
export function simulationSample(gameId = 'demo'): SimulationSnapshot {
  const skillKey = 'sample_basic_attack';
  const moment = { momentType: 'PROCESS_START' as const, stepKey: null, failureReason: null };
  const valueRule = (value: NonNullable<SkillEffectResult['valueRule']>['value']) => ({
    value, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null
  });
  const metadata = { createdAt: '', updatedAt: '' };
  const sourceValues = { hp: 650, attack_damage: 60, attack_speed: 0.651, armor: 38 };
  const targetValues = { hp: 590, attack_damage: 53, attack_speed: 0.668, armor: 21 };
  const actor = (key: string, name: string, values: Record<string, number>) => ({
    character: { gameId, characterKey: key, name, description: null, ...metadata },
    attributes: { characterKey: key, minLevel: 1, maxLevel: 1, levelValues: { '1': values } },
    selectedLevelValues: { ...values },
    attachedSkills: [{ gameId, characterKey: key, characterName: name, skillKey, skillName: '样例普攻', skillStatus: 'ENABLED' as const, sortOrder: 0 }],
    selectedEquipment: [], selectedBuilds: [],
    skillSources: [{ origin: { kind: 'CHARACTER' as const, characterKey: key }, skillKey, skillName: '样例普攻',
      skillStatus: 'ENABLED' as const, enabled: true, skillLevel: key === 'actor_a' ? 1 : null,
      enabledRuleKeys: key === 'actor_a' ? ['begin_attack', 'hit_attack'] : [],
      inactiveReason: key === 'actor_a' ? null : 'NO_AUTONOMOUS_ATTACK' as const }]
  });
  const attribute = (attributeKey: string) => ({
    gameId, attributeKey, name: attributeKey, valueType: 'DECIMAL' as const,
    minValue: 0, maxValue: attributeKey === 'critical_strike_chance' ? 1 : null,
    description: null, status: 'ENABLED' as const, sortOrder: 0, ...metadata
  });
  return {
    gameId, selection: { sourceCharacterKey: 'actor_a', sourceLevel: 1, targetCharacterKey: 'actor_b', targetLevel: 1,
      basicAttackSkillKey: skillKey, basicAttackLevel: 1, plannedSkills: [], sourceEquipmentKeys: [], targetEquipmentKeys: [],
      sourceBuildConfigurations: [], targetBuildConfigurations: [], sourceSkillSettings: [], targetSkillSettings: [] },
    source: actor('actor_a', '样例A', sourceValues), target: actor('actor_b', '样例B', targetValues),
    skillConfigurations: [{
      skill: { gameId, skillKey, name: '样例普攻', description: null, maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['basic_attack'], ...metadata },
      parameters: [
        { gameId, skillKey, parameterKey: 'base_multiplier', name: '基础倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 2, levelValues: null, description: null, sortOrder: 0, ...metadata },
        { gameId, skillKey, parameterKey: 'milliseconds', name: '毫秒', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 1000, levelValues: null, description: null, sortOrder: 1, ...metadata }
      ],
      formulas: [
        { gameId, skillKey, formulaKey: 'raw', name: '原始伤害', expression: skillFormulaDefinition('sample_basic_attack', { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'attack_damage', attributeValueKind: 'TOTAL' }), description: null, sortOrder: 0, ...metadata },
        { gameId, skillKey, formulaKey: 'interval', name: '间隔', expression: skillFormulaDefinition('sample_basic_attack', { nodeType: 'OPERATION', operation: 'DIVIDE', operands: [
          { nodeType: 'PARAMETER', parameterKey: 'milliseconds' }, { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'attack_speed', attributeValueKind: 'TOTAL' }
        ] }), description: null, sortOrder: 1, ...metadata },
        { gameId, skillKey, formulaKey: 'multiplier', name: '暴击倍率', expression: skillFormulaDefinition('sample_basic_attack', { nodeType: 'OPERATION', operation: 'ADD', operands: [
          { nodeType: 'PARAMETER', parameterKey: 'base_multiplier' }, { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'critical_strike_damage_bonus_percent', attributeValueKind: 'TOTAL' }
        ] }), description: null, sortOrder: 2, ...metadata }
      ],
      effects: [
        { gameId, skillKey, effectKey: 'start', name: '发起效果', description: null, sortOrder: 0, lifecycle: null, results: [
          { resultKey: 'attack_link', name: '攻击联动', resultType: 'ATTACK_LINK_APPLICATION', target: 'TARGET', description: null, sortOrder: 0,
            valueRule: valueRule(fixedValue(1)), detail: {}, lifecycleBehavior: null, spellShieldBlockScope: null }
        ], ...metadata },
        { gameId, skillKey, effectKey: 'hit', name: '命中效果', description: null, sortOrder: 1, lifecycle: null, results: [
          { resultKey: 'damage', name: '伤害', resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 10,
            valueRule: valueRule(formulaValue('raw')), detail: { damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT',
              critical: { mode: 'SOURCE_CRIT_CHANCE', multiplierValue: formulaValue('multiplier') }, vampQualification: 'RESOLVED', vampOverrides: [] }, lifecycleBehavior: null, spellShieldBlockScope: null },
          { resultKey: 'hit_link', name: '命中联动', resultType: 'HIT_LINK_APPLICATION', target: 'TARGET', description: null, sortOrder: 20,
            valueRule: valueRule(fixedValue(1)), detail: {}, lifecycleBehavior: null, spellShieldBlockScope: null }
        ], ...metadata }
      ],
      processes: [{ gameId, skillKey, processKey: 'attack', name: '发起记录', activationType: 'ACTIVE', description: null, sortOrder: 0,
        steps: [{ stepKey: 'begin', name: '发起记录非命中', description: null, sortOrder: 0, stepType: 'IMMEDIATE', detail: {} }],
        cooldown: { durationValue: formulaValue('interval'), startMoment: moment },
        effectBindings: [{ bindingKey: 'start_link', effectKey: 'start', moment, sortOrder: 0 }], stateOperations: [], ...metadata }],
      internalStates: [],
      triggerRules: [
        { ruleKey: 'begin_attack', name: '开始', description: null, sortOrder: 0, eventSource: { eventType: 'BASIC_ATTACK_START', detail: {} },
          conditionGroups: [], actions: [{ actionKey: 'start_process', name: '启动过程', sortOrder: 0, actionType: 'START_PROCESS', detail: { processKey: 'attack' }, targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }],
          perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null },
        { ruleKey: 'hit_attack', name: '命中', description: null, sortOrder: 1, eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} },
          conditionGroups: [], actions: [{ actionKey: 'hit_effect', name: '命中效果', sortOrder: 0, actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'hit' }, targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }],
          perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null }
      ], baseDigest: 'independent_sample'
    }],
    catalogs: {
      calculationRules: authoredCalculationRules(gameId),
      levelConfig: { gameId, minLevel: 1, maxLevel: 1 },
      attributes: ['hp','attack_damage','attack_speed','armor','critical_strike_chance','critical_strike_damage_bonus_percent','armor_pen_percent','armor_pen_flat','life_steal_percent'].map(attribute),
      skillCategories: [{ gameId, skillCategoryKey: 'basic_attack', name: '普攻', description: null, status: 'ENABLED', sortOrder: 0, ...metadata }],
      damageTypes: [{ type: { gameId, damageTypeKey: 'physics', name: '物理', description: null, status: 'ENABLED', sortOrder: 0, formulaConfigured: true, ...metadata },
        formula: { gameId, damageTypeKey: 'physics', updatedAt: '', formula: {
          inputs: [
            { key: 'resistance', binding: { kind: 'attribute', object: 'target', attributeKey: 'armor', valueKind: 'TOTAL', view: 'current_frame' } },
            { key: 'percent_pen', binding: { kind: 'attribute', object: 'source', attributeKey: 'armor_pen_percent', valueKind: 'TOTAL', view: 'current_frame' } },
            { key: 'flat_pen', binding: { kind: 'attribute', object: 'source', attributeKey: 'armor_pen_flat', valueKind: 'TOTAL', view: 'current_frame' } }
          ],
          stages: [
            { key: 'resistance', name: '穿透前抗性', expression: { op: 'read', inputKey: 'resistance' } },
            { key: 'percent_pen', name: '百分比穿透', expression: { op: 'read', inputKey: 'percent_pen' } },
            { key: 'flat_pen', name: '固定穿透', expression: { op: 'read', inputKey: 'flat_pen' } },
            { key: 'effective', name: '有效抗性', expression: { op: 'ref', stageKey: 'resistance' } },
            { key: 'factor', name: '防御倍率', expression: { op: 'div', args: [
              { op: 'const', value: '100' }, { op: 'add', args: [{ op: 'const', value: '100' }, { op: 'ref', stageKey: 'effective' }] }
            ] } }
          ], outputStageKey: 'factor'
        } }
      }],
      modifierZones: [], statuses: [], vampRules: { rules: [{ vampType: 'LIFE_STEAL', sourceAttributeKey: 'life_steal_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1,
        deliveryKinds: ['BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['basic_attack'] }] }
    }, references: [], snapshotDigest: 'a'.repeat(64), readAt: '2026-10-01T00:00:00Z'
  };
}

export function simulationBuildSample(gameId = 'demo'): SimulationSelectedBuild {
  const metadata = { createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z' };
  const systemKey = 'sample_build';
  const slots = ['first', 'second'].map(slotKey => ({ slotKey, name: slotKey, minimumSelections: 1, maximumSelections: 1, optionKeys: ['sample_option'] }));
  return {
    definition: {
      system: { gameId, systemKey, name: '独立结构构筑', description: null, configurationMode: 'SLOT_SELECTION', sortOrder: 0,
        selectionRules: { groupRoles: [{ roleKey: 'primary', name: '主要', groupKeys: ['sample_group'], minimumGroups: 1, maximumGroups: 1,
          minimumSelectedSlots: 2, maximumSelectedSlots: 2, distinctFromRoleKeys: [],
          slotRules: slots.map(slot => ({ groupKey: 'sample_group', slotKey: slot.slotKey, minimumSelections: 1, maximumSelections: 1 })) }],
        budget: null, prerequisites: [], exclusions: [] }, ...metadata },
      groups: [{ gameId, systemKey, groupKey: 'sample_group', name: '样例分组', description: null, sortOrder: 0, slots, ...metadata }],
      options: [{ gameId, systemKey, optionKey: 'sample_option', name: '样例选项', description: null, maxRank: 1, rankCosts: [0], ...metadata }],
      skillRelations: [{ gameId, systemKey, optionKey: 'sample_option', optionName: '样例选项', skillKey: 'sample_natural', skillName: '待配置自然技能',
        skillStatus: 'ENABLED', activationRank: 1, skillLevelMode: 'FIXED', fixedSkillLevel: 1, sortOrder: 0 }]
    },
    configuration: { systemKey, groupAssignments: [{ roleKey: 'primary', groupKey: 'sample_group' }],
      selections: slots.map(slot => ({ roleKey: 'primary', groupKey: 'sample_group', slotKey: slot.slotKey, optionKey: 'sample_option', rank: 1 })), budgets: {} }
  };
}

export function simulationDefaultSourcesSample(gameId = 'demo'): SimulationSnapshot {
  const snapshot = simulationSample(gameId);
  const skillKey = 'sample_natural';
  const skillName = '待配置自然技能';
  const basic = snapshot.skillConfigurations[0]!;
  snapshot.skillConfigurations.push({ skill: { ...basic.skill, skillKey, name: skillName, maxLevel: 3, skillCategoryKeys: [] },
    parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [], baseDigest: 'independent_natural_configuration' });
  for (const side of ['source', 'target'] as const) {
    const characterKey = snapshot[side].character.characterKey;
    snapshot[side].attachedSkills.push({ gameId, characterKey, characterName: snapshot[side].character.name,
      skillKey, skillName, skillStatus: 'ENABLED', sortOrder: 1 });
    snapshot[side].skillSources.push({ origin: { kind: 'CHARACTER', characterKey }, skillKey, skillName, skillStatus: 'ENABLED',
      enabled: true, skillLevel: null, enabledRuleKeys: [], inactiveReason: 'LEVEL_REQUIRED' });
  }
  snapshot.source.attachedSkills.push({ gameId, characterKey: 'actor_a', characterName: '样例A', skillKey: 'sample_disabled',
    skillName: '全局停用技能', skillStatus: 'DISABLED', sortOrder: 2 });
  snapshot.source.skillSources.push({ origin: { kind: 'CHARACTER', characterKey: 'actor_a' }, skillKey: 'sample_disabled', skillName: '全局停用技能',
    skillStatus: 'DISABLED', enabled: true, skillLevel: null, enabledRuleKeys: [], inactiveReason: 'GLOBAL_DISABLED' });
  snapshot.skillConfigurations.push({ skill: { ...basic.skill, skillKey: 'sample_disabled', name: '全局停用技能', status: 'DISABLED', skillCategoryKeys: [] },
    parameters: [], formulas: [], effects: [], processes: [], internalStates: [], triggerRules: [], baseDigest: 'independent_disabled_configuration' });
  const build = simulationBuildSample(gameId);
  snapshot.source.selectedBuilds.push(build);
  snapshot.selection.sourceBuildConfigurations.push(build.configuration);
  for (const selection of build.configuration.selections) snapshot.source.skillSources.push({
    origin: { kind: 'BUILD_OPTION', systemKey: build.configuration.systemKey, roleKey: selection.roleKey, groupKey: selection.groupKey,
      slotKey: selection.slotKey, optionKey: selection.optionKey }, skillKey, skillName, skillStatus: 'ENABLED', enabled: true,
    skillLevel: 1, enabledRuleKeys: [], inactiveReason: 'CONFIGURATION_INCOMPLETE'
  });
  return snapshot;
}
