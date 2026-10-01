import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import type { SkillEffectResult } from '../../src/types/skillEffect';
import { fixedValue, formulaValue } from '../../src/types/numericValue';

/** 独立作者结构用例，不是正式英雄数据，也不是引擎基准样例副本。 */
export function simulationSample(): SimulationSnapshot {
  const gameId = 'demo';
  const skillKey = 'sample_basic_attack';
  const moment = { momentType: 'PROCESS_START' as const, stepKey: null, failureReason: null };
  const valueRule = (value: SkillEffectResult['valueRule'] extends infer V ? NonNullable<V>['value'] : never) => ({
    value, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null
  });
  const metadata = { createdAt: '', updatedAt: '' };
  const sourceValues = { hp: 650, attack_damage: 60, attack_speed: 0.651, armor: 38 };
  const targetValues = { hp: 590, attack_damage: 53, attack_speed: 0.668, armor: 21 };
  const actor = (key: string, name: string, values: Record<string, number>) => ({
    character: { gameId, characterKey: key, name, description: null, ...metadata },
    attributes: { characterKey: key, minLevel: 1, maxLevel: 1, levelValues: { '1': values } },
    selectedLevelValues: { ...values },
    attachedSkills: [{ gameId, characterKey: key, characterName: name, skillKey, skillName: '样例普攻', skillStatus: 'ENABLED' as const, sortOrder: 0 }]
  });
  const attribute = (attributeKey: string) => ({
    gameId, attributeKey, name: attributeKey, valueType: 'DECIMAL' as const,
    minValue: 0, maxValue: attributeKey === 'critical_strike_chance' ? 1 : null,
    description: null, status: 'ENABLED' as const, sortOrder: 0, ...metadata
  });
  return {
    gameId, selection: { sourceCharacterKey: 'actor_a', sourceLevel: 1, targetCharacterKey: 'actor_b', targetLevel: 1,
      basicAttackSkillKey: skillKey, basicAttackLevel: 1 }, source: actor('actor_a', '样例A', sourceValues), target: actor('actor_b', '样例B', targetValues),
    skillConfigurations: [{
      skill: { gameId, skillKey, name: '样例普攻', description: null, maxLevel: 1, status: 'ENABLED', sortOrder: 0, skillCategoryKeys: ['basic_attack'], ...metadata },
      parameters: [
        { gameId, skillKey, parameterKey: 'base_multiplier', name: '基础倍率', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 2, levelValues: null, description: null, sortOrder: 0, ...metadata },
        { gameId, skillKey, parameterKey: 'milliseconds', name: '毫秒', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 1000, levelValues: null, description: null, sortOrder: 1, ...metadata }
      ],
      formulas: [
        { gameId, skillKey, formulaKey: 'raw', name: '原始伤害', expression: { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'attack_damage', attributeValueKind: 'TOTAL' }, description: null, sortOrder: 0, ...metadata },
        { gameId, skillKey, formulaKey: 'interval', name: '间隔', expression: { nodeType: 'OPERATION', operation: 'DIVIDE', operands: [
          { nodeType: 'PARAMETER', parameterKey: 'milliseconds' }, { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'attack_speed', attributeValueKind: 'TOTAL' }
        ] }, description: null, sortOrder: 1, ...metadata },
        { gameId, skillKey, formulaKey: 'multiplier', name: '暴击倍率', expression: { nodeType: 'OPERATION', operation: 'ADD', operands: [
          { nodeType: 'PARAMETER', parameterKey: 'base_multiplier' }, { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'critical_strike_damage_bonus_percent', attributeValueKind: 'TOTAL' }
        ] }, description: null, sortOrder: 2, ...metadata }
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
      levelConfig: { gameId, minLevel: 1, maxLevel: 1 },
      attributes: ['hp','attack_damage','attack_speed','armor','critical_strike_chance','critical_strike_damage_bonus_percent','armor_pen_percent','armor_pen_flat','life_steal_percent'].map(attribute),
      skillCategories: [{ gameId, skillCategoryKey: 'basic_attack', name: '普攻', description: null, status: 'ENABLED', sortOrder: 0, ...metadata }],
      damageTypes: [{ type: { gameId, damageTypeKey: 'physics', name: '物理', description: null, status: 'ENABLED', sortOrder: 0, formulaConfigured: true, ...metadata },
        formula: { gameId, damageTypeKey: 'physics', updatedAt: '', formula: {
          resistanceBeforePenetration: { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'armor', attributeValueKind: 'TOTAL' },
          penetrationPercent: { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'armor_pen_percent', attributeValueKind: 'TOTAL' },
          penetrationFlat: { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'armor_pen_flat', attributeValueKind: 'TOTAL' },
          effectiveResistance: { nodeType: 'STAGE_RESULT', stageKey: 'RESISTANCE_BEFORE_PENETRATION' },
          resistanceFactor: { nodeType: 'OPERATION', operation: 'DIVIDE', operands: [
            { nodeType: 'FIXED', value: 100 }, { nodeType: 'OPERATION', operation: 'ADD', operands: [
              { nodeType: 'FIXED', value: 100 }, { nodeType: 'STAGE_RESULT', stageKey: 'EFFECTIVE_RESISTANCE' }
            ] }
          ] }
        } }
      }],
      modifierZones: [], statuses: [], vampRules: { rules: [{ vampType: 'LIFE_STEAL', sourceAttributeKey: 'life_steal_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE', defaultEfficiency: 1,
        deliveryKinds: ['BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['basic_attack'] }] }
    }, references: [], snapshotDigest: 'a'.repeat(64), readAt: '2026-10-01T00:00:00Z'
  };
}
