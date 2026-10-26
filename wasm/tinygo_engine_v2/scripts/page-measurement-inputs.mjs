import { createFormulaPhase4Input } from './formula-phase4-input.mjs';

const slot = value => ({ base: value, current: value, max: value, resolved: value });
const constant = value => ({ op: 'const', value });

// 固定原生测量输入不代替生产适配机制回归。期望事先按明确操作推导。
function common(key) {
  const input = createFormulaPhase4Input();
  input.name = key;
  input.compileRequest.rulesHash = `rules.page_measurement.${key}`;
  input.runRequest.expectedRulesHash = input.compileRequest.rulesHash;
  input.runRequest.initialSnapshot.rulesHash = input.compileRequest.rulesHash;
  for (let actor = 0; actor < 2; actor++) {
    const attributes = input.compileRequest.combatants[actor].attributes;
    attributes.hp = slot(1000000);
    // 上限必须允许后续+1真正改变数值，不能让写入被初始值100夹回。
    for (let index = 0; index < 48; index++) attributes[`measure_${String(index).padStart(2, '0')}`] = { ...slot(100), max: 1000000 };
    input.runRequest.initialSnapshot.combatants[actor].attributes = structuredClone(attributes);
  }
  input.compileRequest.sharedProviders[0].abilities[0].params.baseDamage = 1;
  input.runRequest.stopPolicy = { durationMs: 1000, stopOnTargetDeath: false, stopWhenNoEvents: false };
  input.runRequest.sampling = { sampleEveryMs: 25, dpsWindowMs: 250, maxSeriesPoints: 100 };
  input.runRequest.driverPlan.entries[0].repeat = { intervalMs: 10, maxAttempts: 100 };
  input.expectedSummarySubset = { sourceDamageDealt: 100, targetFinalHp: 999900, abilityCastCount: 100, abilityAttemptCount: 100 };
  input.expectedFinalAttributeValues = { source: { measure_00: 100, measure_08: 100, measure_16: 100 } };
  return input;
}

const change = (key, amount = 1) => ({ operation: 'attribute_change', target: 'self', attributeKey: key, valuePolicy: 'add', amount: constant(amount) });

export function createPageMeasurementInputs() {
  const health = common('health_only');
  const joint = common('joint_attribute_writes');
  joint.compileRequest.sharedProviders[0].abilities[0].operations.unshift(change('measure_00'), change('measure_08'), change('measure_16'));
  // 三个属性各执行100次+1：100+100=200。
  joint.expectedFinalAttributeValues.source = { measure_00: 200, measure_08: 200, measure_16: 200 };
  const independent = common('independent_attribute_writes');
  const provider = independent.compileRequest.sharedProviders[0];
  provider.abilities = [0, 8, 16].map((index, position) => ({ ...structuredClone(provider.abilities[0]), abilityKey: `write_${position}`, operations: [change(`measure_${String(index).padStart(2, '0')}`), ...structuredClone(provider.abilities[0].operations)] }));
  independent.runRequest.driverPlan.entries = provider.abilities.map((ability, index) => ({ entryKey: `write_${index}`, abilityRef: `source.provider[${provider.providerKey}].ability[${ability.abilityKey}]`, source: 'source', target: 'target', firstAtMs: index * 3, priority: index, repeat: { intervalMs: 30, maxAttempts: 33 } }));
  independent.expectedSummarySubset = { sourceDamageDealt: 99, targetFinalHp: 999901, abilityCastCount: 99, abilityAttemptCount: 99 };
  // 每个独立驱动器各执行33次+1：100+33=133。
  independent.expectedFinalAttributeValues.source = { measure_00: 133, measure_08: 133, measure_16: 133 };

  const expiry = common('effect_expiry_derivation');
  const buffKey = 'status:measure_buff';
  expiry.compileRequest.sharedProviders.push({ providerKey: buffKey, kind: 'status', stableId: 'measure_buff', lifecycle: { durationMs: constant(35), maxStacks: 1, refreshPolicy: 'replace' }, modifiers: [0, 8, 16].map(index => ({ modifierKey: `measure_${index}`, kind: 'attribute', target: `measure_${String(index).padStart(2, '0')}`, valuePolicy: 'add', value: constant(20) })), abilities: [] });
  expiry.compileRequest.sharedProviders[0].abilities[0].operations.unshift({ operation: 'apply_provider', target: 'self', providerDefinitionRef: buffKey });
  expiry.runRequest.driverPlan.entries[0].repeat = { intervalMs: 50, maxAttempts: 20 };
  expiry.expectedSummarySubset = { sourceDamageDealt: 20, targetFinalHp: 999980, abilityCastCount: 20, abilityAttemptCount: 20 };
  return [health, joint, independent, expiry];
}

export function measurementSlotKeys(input) {
  // 只提供可读键候选；槽次序必须从页数诊断产物的实际Layout还原。
  return [...new Set(input.compileRequest.combatants.flatMap(actor => Object.keys(actor.attributes)))].sort();
}
