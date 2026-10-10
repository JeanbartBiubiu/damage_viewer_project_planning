import type { GameCalculationRulesResponse } from '../../src/types/gameCalculationRules';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';

/** 独立作者数据；不由装配器、接口解析器或加载器补入。 */
export function authoredCalculationRules(gameId: string): GameCalculationRulesResponse {
  return { gameId, baseDigest: 'c'.repeat(64), configuration: {
    criticalChanceAttributeKey: 'critical_strike_chance', criticalMultiplierMin: 1, attackSpeedAttributeKey: 'attack_speed', attributeDerivations: []
  } };
}
export function authorEquipmentSpeedRule(snapshot: SimulationSnapshot) {
  snapshot.catalogs.calculationRules.configuration!.attributeDerivations = [{ ruleKey: 'authored_speed_yield', attributeKey: 'attack_speed',
    valuePolicy: 'set', activationAttributeKeys: ['bonus_attack_speed_percent'], formula: {
      inputs: [
        { key: 'base_speed', binding: { kind: 'attribute', object: 'source', attributeKey: 'attack_speed', valueKind: 'BASE', view: 'current_frame' } },
        { key: 'yield_ratio', binding: { kind: 'attribute', object: 'source', attributeKey: 'attack_speed_ratio', valueKind: 'TOTAL', view: 'current_frame' } },
        { key: 'bonus_speed', binding: { kind: 'attribute', object: 'source', attributeKey: 'bonus_attack_speed_percent', valueKind: 'BONUS', view: 'current_frame' } }
      ], stages: [{ key: 'output', name: '作者有效速度', expression: { op: 'add', args: [{ op: 'read', inputKey: 'base_speed' },
        { op: 'mul', args: [{ op: 'read', inputKey: 'yield_ratio' }, { op: 'read', inputKey: 'bonus_speed' }] }] } }], outputStageKey: 'output'
    } }];
  return snapshot;
}
