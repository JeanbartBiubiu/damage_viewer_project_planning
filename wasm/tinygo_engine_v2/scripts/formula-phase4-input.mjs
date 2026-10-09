// 从零构造第四阶段显式作者基准，不读取或复制旧固定样例。
export function createFormulaPhase4Input() {
  const slot = value => ({ base: value, current: value, max: value, resolved: value });
  const schemaHash = 'schema.generic-p0.example';
  const rulesHash = 'rules.generic_p0_basic_damage';
  const providerRef = 'champion:source_demo';
  const compileRequest = {
    schemaVersion: 'generic-p0', schemaHash, rulesHash,
    typeCatalog: { types: [
      { key: 'combatant/champion', domain: 'combatant' },
      { key: 'provider/champion', domain: 'provider' },
      { key: 'ability/basic_attack', domain: 'ability' },
      { key: 'damage/physical', domain: 'damage' },
      { key: 'event/damage_dealt', domain: 'event' },
      { key: 'event/ability_cast', domain: 'event' },
    ], relations: [] },
    combatants: [
      { key: 'source', types: ['combatant/champion'], attributes: { hp: slot(1000), attack_damage: slot(100), armor: slot(0), magic_resist: slot(0) }, resources: { mana: { current: 200, max: 200 } }, providers: [{ providerRef, definitionRef: providerRef }] },
      { key: 'target', types: ['combatant/champion'], attributes: { hp: slot(1000), attack_damage: slot(50), armor: slot(0), magic_resist: slot(0) }, resources: {}, providers: [] },
    ],
    sharedProviders: [{ providerKey: providerRef, kind: 'champion', stableId: 'source_demo', types: ['provider/champion'], abilities: [{
      abilityKey: 'basic_attack', kind: 'active', types: ['ability/basic_attack'], params: { baseDamage: 100 },
      operations: [{ operation: 'damage', target: 'target', amount: { op: 'read', path: 'ability.param.baseDamage' }, damageType: 'damage/physical' }],
    }] }],
    rules: { operations: [], modifiers: [], listeners: [], triggerRules: [], damageTypeFormulas: [{ damageType: 'damage/physical', formula: {
      inputs: [], stages: [{ key: 'factor', name: '作者明确防御倍率', expression: { op: 'const', value: '1' } }], outputStageKey: 'factor',
    } }] },
    formulas: [], settings: {},
  };
  const runRequest = {
    sessionId: '', expectedRulesHash: rulesHash,
    initialSnapshot: { schemaHash, rulesHash, timeMs: 0, processInstances: [], useTriggerLedger: [], combatants: compileRequest.combatants.map(c => ({
      key: c.key, attributes: structuredClone(c.attributes), resources: structuredClone(c.resources), cooldowns: {},
      providers: c.providers.map(p => ({ ...p, source: c.key, owner: c.key, stacks: 1, expireAt: null, state: {} })),
      shields: [], abilityState: {}, providerState: {}, vars: {},
    })) },
    driverPlan: { entries: [{ entryKey: 'basic_once', abilityRef: `source.provider[${providerRef}].ability[basic_attack]`, source: 'source', target: 'target', firstAtMs: 0, priority: 0 }] },
    stopPolicy: { durationMs: 100, stopOnTargetDeath: true, stopWhenNoEvents: true },
    sampling: { sampleEveryMs: 50, dpsWindowMs: 1000, maxSeriesPoints: 1024 },
  };
  return {
    name: 'formula_phase4_explicit_basic_damage', phase: 'run', compileRequest, runRequest, expectedResultKind: 'done',
    expectedSummarySubset: { targetFinalHp: 900, sourceDamageDealt: 100, abilityCastCount: 1, abilityAttemptCount: 1 },
    notes: '独立作者输入：100原金额乘明确常量1；原固定样例用于旧协议拒绝验证。',
  };
}
