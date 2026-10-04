import type { SkillConfiguration } from '../../src/types/skillConfiguration';
import type { SkillEffectVampQualification } from '../../src/types/skillEffect';
import { equipmentSimulationSample } from './simulationEquipment';

export function recurveBowConfiguration(qualification: SkillEffectVampQualification = 'RESOLVED'): SkillConfiguration {
  const gameId = 'lol';
  const skillKey = 'item_1043_passive';
  const metadata = { createdAt: '', updatedAt: '' };
  return {
    skill: { gameId, skillKey, name: '独立反曲之弓触发结构用例', description: null, status: 'ENABLED',
      maxLevel: 1, skillCategoryKeys: ['passive'], sortOrder: 0, ...metadata },
    parameters: [{ gameId, skillKey, parameterKey: 'on_hit_damage', name: '独立明确伤害参数', description: null,
      valueType: 'INTEGER', valueMode: 'FIXED', fixedValue: 15, levelValues: null, sortOrder: 10, ...metadata }],
    formulas: [], processes: [], internalStates: [],
    effects: [{ gameId, skillKey, effectKey: 'on_hit_damage', name: '独立即时附伤效果', description: null,
      sortOrder: 10, lifecycle: null, ...metadata, results: [{ resultKey: 'on_hit_damage', name: '独立已核定伤害',
        resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 10,
        lifecycleBehavior: null, spellShieldBlockScope: null,
        valueRule: { value: { kind: 'PARAMETER', parameterKey: 'on_hit_damage' }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
        detail: { damageTypeKey: 'physics', deliveryKind: 'BASIC_ATTACK', originKind: 'DIRECT',
          critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: qualification,
          vampOverrides: qualification === 'RESOLVED' ? [{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE',
            basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiencyValue: { kind: 'FIXED', value: 1 } }] : [] }
      }] }],
    triggerRules: [{ ruleKey: 'resolve_on_basic_attack_hit', name: '独立拥有方命中监听', description: null, sortOrder: 10,
      eventSource: { eventType: 'BASIC_ATTACK_HIT', detail: {} }, conditionGroups: [],
      perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null,
      actions: [{ actionKey: 'execute_on_hit_damage', name: '立即执行附伤', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
        targetContext: 'CURRENT_TARGET', detail: { effectKey: 'on_hit_damage' }, runtimeInputBindings: [], resultModifiers: [] }]
    }],
    baseDigest: 'independent_triggered_equipment_sample'
  };
}

export function triggeredEquipmentSimulationSample(
  sourceKeys: string[] = ['item_1043'], targetKeys: string[] = [], qualification: SkillEffectVampQualification = 'RESOLVED'
) {
  const snapshot = equipmentSimulationSample(sourceKeys, targetKeys);
  const metadata = { createdAt: '', updatedAt: '' };
  snapshot.catalogs.skillCategories.push({ gameId: 'lol', skillCategoryKey: 'passive', name: '独立被动分类',
    description: null, status: 'ENABLED', sortOrder: 1, ...metadata });
  const defense = snapshot.catalogs.damageTypes[0]!.formula.formula;
  defense.effectiveResistance = { nodeType: 'OPERATION', operation: 'MAX', operands: [
    { nodeType: 'FIXED', value: 0 },
    { nodeType: 'OPERATION', operation: 'SUBTRACT', operands: [
      { nodeType: 'OPERATION', operation: 'MULTIPLY', operands: [
        { nodeType: 'STAGE_RESULT', stageKey: 'RESISTANCE_BEFORE_PENETRATION' },
        { nodeType: 'OPERATION', operation: 'SUBTRACT', operands: [
          { nodeType: 'FIXED', value: 1 }, { nodeType: 'STAGE_RESULT', stageKey: 'PENETRATION_PERCENT' }
        ] }
      ] },
      { nodeType: 'STAGE_RESULT', stageKey: 'PENETRATION_FLAT' }
    ] }
  ] };
  for (const side of ['source', 'target'] as const) {
    for (const item of snapshot[side].selectedEquipment) {
      if (item.equipment.equipmentKey !== 'item_1043') continue;
      item.equipment.name = '独立反曲之弓结构用例';
      item.attributes.attributeValues = { bonus_attack_speed_percent: .15 };
      item.attachedSkills = [{ gameId: 'lol', equipmentKey: 'item_1043', equipmentName: item.equipment.name,
        skillKey: 'item_1043_passive', skillName: '独立反曲之弓触发结构用例', skillStatus: 'ENABLED', sortOrder: 0 }];
      if (!snapshot.skillConfigurations.some(row => row.skill.skillKey === 'item_1043_passive')) {
        snapshot.skillConfigurations.push(recurveBowConfiguration(qualification));
      }
    }
  }
  return snapshot;
}
