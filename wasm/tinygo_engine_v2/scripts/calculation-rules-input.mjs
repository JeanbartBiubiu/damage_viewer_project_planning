// 独立作者输入由现行从零工厂构造，供 Node 和浏览器专项直接消费。
import { createFormulaPhase4Input } from './formula-phase4-input.mjs';

const slot = value => ({ base: value, current: value, max: value, resolved: value });
const constant = value => ({ op: 'const', value });

function createInput(name) {
  const input = createFormulaPhase4Input();
  input.name = name;
  input.notes = '游戏计算配置专项：完整显式作者声明，不读取旧协议样例或注入默认公式。';
  delete input.expectedSummarySubset;
  delete input.expectedSummary;
  input.compileRequest.schemaHash = 'schema.calculation_rules';
  input.compileRequest.rulesHash = `rules.${name}`;
  input.runRequest.expectedRulesHash = input.compileRequest.rulesHash;
  input.runRequest.initialSnapshot.schemaHash = input.compileRequest.schemaHash;
  input.runRequest.initialSnapshot.rulesHash = input.compileRequest.rulesHash;
  return input;
}

export function createCalculationCriticalInput({ chance = .25, multiplier = 2, minimum = null, overflow = false } = {}) {
  const input = createInput('calculation_critical_explicit');
  const selectedChance = overflow ? 1 : chance;
  const selectedMinimum = overflow ? 1e308 : minimum;
  for (const actors of [input.compileRequest.combatants, input.runRequest.initialSnapshot.combatants]) {
    for (const actor of actors) {
      for (const key of ['crit_chance', 'crit_damage', 'critical_strike_chance', 'critical_strike_damage_bonus_percent']) {
        delete actor.attributes[key];
      }
    }
    actors.find(actor => actor.key === 'source').attributes.hit_probability = slot(selectedChance);
  }
  input.compileRequest.typeCatalog.types.push({ key: 'hit_probability', domain: 'attribute' });
  const damage = {
    operation: 'damage', target: 'target', damageType: 'damage/physical', amount: constant(100), ref: 'explicit_critical_damage',
    critEligible: true,
    critChance: { op: 'read', path: 'source.attr.hit_probability.resolved' },
    critMultiplier: constant(multiplier),
    ...(selectedMinimum === null ? {} : { critMultiplierMin: selectedMinimum }),
  };
  input.compileRequest.sharedProviders[0].abilities[0].operations = overflow
    ? [{ operation: 'shield', target: 'target', shieldRef: 'uncommitted_guard', amount: constant(50) }, damage]
    : [damage];
  return input;
}

export function createCalculationGameDerivationInput() {
  const input = createInput('calculation_game_derivation');
  const formulaKey = 'game/pulse_to_force';
  input.compileRequest.typeCatalog.types.push(...['pulse', 'force'].map(key => ({ key, domain: 'attribute' })));
  for (let index = 0; index < input.compileRequest.combatants.length; index++) {
    const actor = input.compileRequest.combatants[index];
    actor.attributes.pulse = slot(index + 1);
    actor.attributes.force = slot(10);
    input.runRequest.initialSnapshot.combatants.find(row => row.key === actor.key).attributes = structuredClone(actor.attributes);
  }
  input.compileRequest.formulas = [{
    key: formulaKey, scope: 'game', parameters: [],
    expression: {
      inputs: [{ key: 'pulse', binding: { kind: 'attribute', object: 'source', attributeKey: 'pulse', valueKind: 'TOTAL', view: 'current_frame' } }],
      stages: [{ key: 'force', name: '拥有方脉冲派生输出', expression: { op: 'mul', args: [{ op: 'read', inputKey: 'pulse' }, { op: 'const', value: '2' }] } }],
      outputStageKey: 'force',
    },
  }];
  input.compileRequest.rules.attributeDerivations = ['source', 'target'].map(combatantKey => ({
    combatantKey, attributeKey: 'force', valuePolicy: 'set', valueType: 'DECIMAL', value: { op: 'ref', ref: formulaKey },
  }));
  input.compileRequest.sharedProviders[0].abilities[0].operations = [{ operation: 'heal', target: 'source', amount: constant(0) }];
  return input;
}
