import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDamageEventInput } from './formula-phase5-input.mjs';
import { compileCanonicalSession, instantiateGenericHost, releaseCanonicalSession, runCanonicalSession, moduleRoot } from './generic-abi-host.mjs';

const artifact = resolve(moduleRoot, process.argv[2] ?? 'target/formula-phase5/tinygo_engine_v2.wasm');
const host = await instantiateGenericHost(artifact);
const cases = [];
const run = (input, session) => runCanonicalSession(host.exports, input, session.sessionId, session.rulesHash);
const release = session => releaseCanonicalSession(host.exports, session.sessionId, session.rulesHash);
const sourceValue = (done, key) => done.finalSnapshot.combatants.find(row => row.key === 'source').attributes[key].resolved;
for (const mixed of [false, true]) {
  const input = createDamageEventInput({ mixed });
  const session = compileCanonicalSession(host.exports, input);
  const done = run(input, session);
  const events = done.evidence.items.filter(row => row.kind === 'emitted_event' && row.ref === 'event/damage_dealt');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data.damageTypes, mixed ? ['damage/physical', 'heat'] : ['heat']);
  assert.equal(events[0].data.rawAmount, mixed ? 150 : 50);
  assert.equal(events[0].data.mitigatedAmount, mixed ? 100 : 50);
  assert.equal(Object.hasOwn(events[0].data, 'damageType'), !mixed);
  assert.equal(sourceValue(done, 'heat_frames'), 1);
  assert.equal(sourceValue(done, 'physical_frames'), Number(mixed));
  // 原逐笔事件包括明确零倍率这一笔；聚合只含正数贡献。
  assert.equal(sourceValue(done, 'damage_instances'), mixed ? 4 : 3);
  assert.equal(done.finalSnapshot.combatants.find(row => row.key === 'target').attributes.damage_received.resolved, mixed ? 4 : 3);
  const heat = events[0].data.damageBreakdown.at(-1);
  assert.deepEqual(heat, { damageType: 'heat', rawAmount: 50, mitigatedAmount: 50, operationRefs: ['heat_first', 'heat_second'] });
  for (let iteration = 0; iteration < 100; iteration++) assert.deepEqual(run(input, session), done);
  assert.equal(release(session).released, true);
  const recompiled = compileCanonicalSession(host.exports, input);
  assert.deepEqual(run(input, recompiled), done);
  assert.equal(release(recompiled).released, true);
  cases.push({ name: mixed ? '混合帧一次聚合与逐笔监听' : '任意原键重复贡献与零倍率排除', sameSessionRuns: 101, releaseRecompile: true });
}
for (const sameType of [false, true]) {
  const input = createDamageEventInput({ overflow: true, sameType });
  const session = compileCanonicalSession(host.exports, input);
  for (let iteration = 0; iteration < 2; iteration++) assert.throws(() => run(input, session), error => error.message.includes('runtime_invariant_failed') && error.message.includes('operations[1]'));
  const idle = structuredClone(input);
  idle.runRequest.driverPlan.entries = [];
  idle.expectedSummarySubset = { targetFinalHp: 1000, sourceDamageDealt: 0, abilityCastCount: 0 };
  const recovered = run(idle, session);
  assert.equal(recovered.finalSnapshot.combatants.find(row => row.key === 'source').attributes.heat_frames.resolved, 0);
  assert.equal(release(session).released, true);
  cases.push({ name: sameType ? '同键溢出拒绝及同会话恢复' : '混合类型溢出拒绝及同会话恢复', errorCode: 'runtime_invariant_failed' });
}
const directory = resolve(moduleRoot, 'target/formula-phase5');
mkdirSync(directory, { recursive: true });
const summary = { wasm: { path: artifact, bytes: readFileSync(artifact).length, sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex') }, cases };
writeFileSync(resolve(directory, 'node-verification.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
