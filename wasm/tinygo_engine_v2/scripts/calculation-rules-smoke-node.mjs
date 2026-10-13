import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCalculationCriticalInput, createCalculationGameDerivationInput } from './calculation-rules-input.mjs';
import { compileCanonicalSession, instantiateGenericHost, moduleRoot, releaseCanonicalSession, runCanonicalSession } from './generic-abi-host.mjs';

const args = process.argv.slice(2);
if (args[0] === '--wasm' && !args[1]) throw new Error('--wasm需要明确产物路径');
const artifact = resolve(moduleRoot, (args[0] === '--wasm' ? args[1] : args[0]) ?? 'target/calculation-rules/tinygo_engine_v2.wasm');
const host = await instantiateGenericHost(artifact);
const run = (input, session) => runCanonicalSession(host.exports, input, session.sessionId, session.rulesHash);
const release = session => releaseCanonicalSession(host.exports, session.sessionId, session.rulesHash);
const actor = (done, key) => done.finalSnapshot.combatants.find(row => row.key === key);
const cases = [];

for (const scenario of [
  { chance: .25, multiplier: 2, minimum: null, damage: 125 },
  { chance: 0, multiplier: 2, minimum: null, damage: 100 },
  { chance: 1, multiplier: .5, minimum: null, damage: 50 },
  { chance: 1, multiplier: .5, minimum: 0, damage: 50 },
  { chance: 1, multiplier: .5, minimum: 1, damage: 100 },
  { chance: 1, multiplier: .5, minimum: 2.5, damage: 250 },
]) {
  const input = createCalculationCriticalInput(scenario);
  const operation = input.compileRequest.sharedProviders[0].abilities[0].operations[0];
  assert.equal(Object.hasOwn(operation, 'critMultiplierMin'), scenario.minimum !== null);
  if (scenario.minimum === 0) assert.equal(operation.critMultiplierMin, 0);
  for (const combatant of [...input.compileRequest.combatants, ...input.runRequest.initialSnapshot.combatants]) {
    for (const oldKey of ['crit_chance', 'crit_damage', 'critical_strike_chance', 'critical_strike_damage_bonus_percent']) {
      assert.equal(Object.hasOwn(combatant.attributes, oldKey), false);
    }
  }
  assert.equal(Object.hasOwn(input, 'expectedSummarySubset'), false);
  const session = compileCanonicalSession(host.exports, input);
  const done = run(input, session);
  assert.equal(done.summary.sourceDamageDealt, scenario.damage);
  assert.equal(done.summary.targetFinalHp, 1000 - scenario.damage);
  assert.equal(actor(done, 'target').attributes.hp.current, 1000 - scenario.damage);
  assert.equal(release(session).released, true);
  cases.push({ name: '重命名概率与明确倍率下限', ...scenario, targetFinalHp: done.summary.targetFinalHp });
}

for (const missing of ['critChance', 'critMultiplier', 'both']) {
  const input = createCalculationCriticalInput();
  const operation = input.compileRequest.sharedProviders[0].abilities[0].operations[0];
  if (missing !== 'critMultiplier') delete operation.critChance;
  if (missing !== 'critChance') delete operation.critMultiplier;
  const path = `sharedProviders[0].abilities[0].operations[0].${missing === 'both' ? 'critChance' : 'critMultiplier'}`;
  assert.throws(() => compileCanonicalSession(host.exports, input), error => error.message.includes('missing_required_field') && error.message.includes(path));
  cases.push({ name: '暴击输入缺少成对声明', missing, errorCode: 'missing_required_field', path });
}

for (const changedDefinition of [false, true]) {
  const input = createCalculationGameDerivationInput();
  const named = input.compileRequest.formulas[0];
  assert.equal(named.scope, 'game');
  assert.equal(Object.hasOwn(named, 'skillKey'), false);
  assert.deepEqual(named.parameters, []);
  if (changedDefinition) {
    named.expression = {
      inputs: [], stages: [{ key: 'force', name: '作者重新声明完整常量公式', expression: { op: 'const', value: '7' } }], outputStageKey: 'force',
    };
  }
  const authored = JSON.stringify(input.compileRequest);
  const session = compileCanonicalSession(host.exports, input);
  const done = run(input, session);
  const expected = changedDefinition ? [7, 7] : [2, 4];
  assert.deepEqual(['source', 'target'].map(key => actor(done, key).attributes.force.resolved), expected);
  assert.equal(JSON.stringify(input.compileRequest), authored);
  assert.equal(release(session).released, true);
  cases.push({ name: changedDefinition ? '完整更换作者公式无需更换引擎' : '游戏公式按真实拥有方读SOURCE输入', outputs: expected });
}

{
  const input = createCalculationCriticalInput({ overflow: true });
  const session = compileCanonicalSession(host.exports, input);
  const path = 'sharedProviders[0].abilities[0].operations[1].critMultiplier';
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.throws(() => run(input, session), error => error.message.includes('runtime_invariant_failed') && error.message.includes(path));
  }
  const source = input.runRequest.initialSnapshot.combatants.find(row => row.key === 'source');
  source.attributes.hit_probability = { base: 0, current: 0, max: 0, resolved: 0 };
  let recovered;
  for (let iteration = 0; iteration < 100; iteration++) {
    const done = run(input, session);
    assert.equal(done.summary.sourceDamageDealt, 100);
    assert.equal(done.summary.targetFinalHp, 950);
    assert.equal(actor(done, 'target').attributes.hp.current, 950);
    assert.equal(actor(done, 'target').shields.length, 0);
    if (recovered) assert.deepEqual(done, recovered);
    else recovered = done;
  }
  assert.equal(release(session).released, true);
  const recompiled = compileCanonicalSession(host.exports, input);
  const done = run(input, recompiled);
  assert.deepEqual(done.summary, recovered.summary);
  assert.deepEqual(done.finalSnapshot, recovered.finalSnapshot);
  assert.equal(release(recompiled).released, true);
  cases.push({ name: '暴击溢出两次拒绝后同会话100次恢复与释放重编', errorCode: 'runtime_invariant_failed', path,
    failedRuns: 2, recoveredRuns: 100, releaseRecompile: true, sourceDamageDealt: 100, targetFinalHp: 950 });
}

const bytes = readFileSync(artifact);
console.log(JSON.stringify({ wasm: { path: artifact, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, cases }, null, 2));
