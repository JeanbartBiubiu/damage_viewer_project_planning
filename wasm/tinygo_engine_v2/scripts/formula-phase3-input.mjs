// 独立构造第三阶段伤害输入；未读取或复制通用基准样例。
const constant = value => ({ op: 'const', value: String(value) });
const read = inputKey => ({ op: 'read', inputKey });
const ref = stageKey => ({ op: 'ref', stageKey });
const binary = (op, left, right) => ({ op, args: [left, right] });

export function createFormulaPhase3Definition({ attributeKey = 'armor', stages = 2 } = {}) {
  const inputs = [{ key: 'defense', binding: { kind: 'attribute', object: 'target', attributeKey, valueKind: 'TOTAL', view: 'current_frame' } }];
  if (stages === 1) return { inputs, stages: [{ key: 'factor', name: '防御倍率', expression: binary('div', constant(100), binary('add', constant(100), read('defense'))) }], outputStageKey: 'factor' };
  if (stages === 2) return { inputs, stages: [
    { key: 'denominator', name: '防御分母', expression: binary('add', constant(100), read('defense')) },
    { key: 'factor', name: '防御倍率', expression: binary('div', constant(100), ref('denominator')) }
  ], outputStageKey: 'factor' };
  if (stages !== 6) throw new Error('stages必须为1、2或6');
  return { inputs, stages: [
    { key: 'factor', name: '最终倍率', expression: ref('ratio') },
    { key: 'unused', name: '未使用结果', expression: binary('div', constant(1), constant(0)) },
    { key: 'resistance', name: '原属性', expression: read('defense') },
    { key: 'denominator', name: '分母', expression: binary('add', ref('resistance'), ref('hundred')) },
    { key: 'hundred', name: '明确常量', expression: constant(100) },
    { key: 'ratio', name: '共同倍率', expression: binary('div', ref('hundred'), ref('denominator')) }
  ], outputStageKey: 'factor' };
}

export function createFormulaPhase3Input({ attributeKey = 'armor', damageType = 'heat', stages = 2, formula = createFormulaPhase3Definition({ attributeKey, stages }) } = {}) {
  const slot = value => ({ base: value, current: value, max: value, resolved: value });
  const schemaHash = 'schema.formula-phase3.heat';
  const rulesHash = 'rules.formula-phase3.heat';
  const providerRef = 'formula_heat';
  const abilityRef = `source.provider[${providerRef}].ability[heat_hit]`;
  const compileRequest = {
    schemaVersion: 'generic-p0', schemaHash, rulesHash,
    typeCatalog: { types: [{ key: damageType, domain: 'damage' }, { key: attributeKey, domain: 'attribute' }], relations: [] },
    combatants: [
      { key: 'source', attributes: { [attributeKey]: slot(0) }, resources: {}, providers: [{ providerRef, definitionRef: providerRef }] },
      { key: 'target', attributes: { hp: slot(1000), [attributeKey]: slot(50) }, resources: {}, providers: [] }
    ],
    sharedProviders: [{ providerKey: providerRef, kind: 'champion', stableId: 'formula_heat', abilities: [{ abilityKey: 'heat_hit', kind: 'active', operations: [{ operation: 'damage', target: 'target', amount: { op: 'const', value: 120 }, damageType }] }] }],
    rules: { operations: [], modifiers: [], listeners: [], triggerRules: [], damageTypeFormulas: [{ damageType, formula }] },
    formulas: [], settings: {}
  };
  const runRequest = {
    sessionId: '', expectedRulesHash: rulesHash,
    initialSnapshot: { schemaHash, rulesHash, timeMs: 0, processInstances: [], useTriggerLedger: [], combatants: compileRequest.combatants.map(c => ({
      key: c.key, attributes: structuredClone(c.attributes), resources: {}, cooldowns: {},
      providers: c.providers.map(p => ({ ...p, source: c.key, owner: c.key, stacks: 1, expireAt: null, state: {} })),
      shields: c.key === 'target' ? [{ shieldRef: 'heat_shield', source: 'target', owner: 'target', remaining: 30, priority: 0, expireAt: null, state: {} }] : [],
      abilityState: {}, providerState: {}, vars: {}
    })) },
    driverPlan: { entries: [{ entryKey: 'heat_once', abilityRef, source: 'source', target: 'target', firstAtMs: 0, priority: 0 }] },
    stopPolicy: { durationMs: 100, stopOnTargetDeath: true, stopWhenNoEvents: true },
    sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 8 }
  };
  return { name: 'formula_phase3_heat', formula, compileRequest, runRequest, expectedSummarySubset: { targetFinalHp: 950, sourceDamageDealt: 80, abilityCastCount: 1 } };
}
