import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const options = { directory: resolve('output/phase6a'), wasm: resolve('src/engine/wasm/tinygo_engine_v2.wasm'),
  host: resolve('../wasm/tinygo_engine_v2/scripts/generic-abi-host.mjs'), iterations: 200 };
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (key === '--directory') options.directory = resolve(process.argv[++index]);
  else if (key === '--wasm') options.wasm = resolve(process.argv[++index]);
  else if (key === '--host') options.host = resolve(process.argv[++index]);
  else if (key === '--iterations') options.iterations = Number(process.argv[++index]);
  else throw new Error(`未知参数${key}`);
}
assert(Number.isSafeInteger(options.iterations) && options.iterations >= 1 && options.iterations <= 10000, '需要有限明确重跑次数');
const { instantiateGenericHost, compileCanonicalSession, runCanonicalSession, releaseCanonicalSession, invokeFrame, FRAME_GENERIC_RUN } = await import(pathToFileURL(options.host).href);
const bytes = readFileSync(options.wasm);
const wasm = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const files = readdirSync(options.directory).filter(name => name.endsWith('-compile-run.json')).sort();
assert(files.length > 0, '尚无真实Worker保存的6A请求；不构造替代作者数据');
for (const name of files) {
  const fixture = JSON.parse(readFileSync(resolve(options.directory, name), 'utf8'));
  assert.deepEqual(wasm, { bytes: fixture.wasm.bytes, sha256: fixture.wasm.sha256 }, 'Worker请求与当前Wasm身份不同，须按新产物重跑');
  assert.equal(fixture.runRequest.driverPlan.skillActions.length, 1);
  assert.equal(fixture.runRequest.driverPlan.basicAttack, undefined);
  assert.deepEqual(fixture.runRequest.driverPlan.entries, []);
  const host = await instantiateGenericHost(options.wasm);
  const compiled = compileCanonicalSession(host.exports, fixture);
  const baseline = runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash);
  for (let iteration = 1; iteration < options.iterations; iteration++) {
    assert.deepEqual(runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash), baseline, `${name}同Node会话第${iteration + 1}次完整结果不一致`);
  }
  const variants = [];
  for (const [index, request] of (fixture.runVariants ?? []).entries()) {
    const variantFixture = { ...fixture, runRequest: request };
    const done = runCanonicalSession(host.exports, variantFixture, compiled.sessionId, compiled.rulesHash);
    assert.deepEqual(runCanonicalSession(host.exports, variantFixture, compiled.sessionId, compiled.rulesHash), done);
    variants.push({ index, summary: done.summary, recording: done.recording });
  }
  const withoutRecords = { ...fixture, runRequest: { ...fixture.runRequest, recordBudget: {
    maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0, maxSkillActionRecords: 0, maxSkillUseRecords: 0, maxHealingRecords: 0
  } } };
  const zero = runCanonicalSession(host.exports, withoutRecords, compiled.sessionId, compiled.rulesHash);
  assert.deepEqual(zero.summary, baseline.summary);
  assert.deepEqual(zero.finalSnapshot, baseline.finalSnapshot);
  for (const field of ['skillActionRecords', 'skillUseRecords', 'healingRecords', 'damageRecords']) assert.deepEqual(zero[field], []);
  assert.throws(() => invokeFrame(host.exports, 'engine_run', FRAME_GENERIC_RUN,
    { ...fixture.runRequest, sessionId: compiled.sessionId, expectedRulesHash: 'incorrect_rules_hash' }), /hash_mismatch|expectedRulesHash/i);
  assert.deepEqual(runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash), baseline);
  const release = releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);
  assert.throws(() => invokeFrame(host.exports, 'engine_run', FRAME_GENERIC_RUN,
    { ...fixture.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash }), /session.not.found/i);
  const reopened = compileCanonicalSession(host.exports, fixture);
  assert.notEqual(reopened.sessionId, compiled.sessionId);
  assert.deepEqual(runCanonicalSession(host.exports, fixture, reopened.sessionId, reopened.rulesHash), baseline);
  const secondRelease = releaseCanonicalSession(host.exports, reopened.sessionId, reopened.rulesHash);
  const proof = { ok: true, wasm: { ...wasm, status: fixture.wasm.status }, fixture: name, iterations: options.iterations,
    baselineDigest: createHash('sha256').update(JSON.stringify(baseline)).digest('hex'), summary: baseline.summary,
    variants, zeroRecording: zero.recording, release, secondRelease };
  writeFileSync(resolve(options.directory, name.replace('-compile-run.json', '-node-proof.json')), JSON.stringify(proof, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, fixture: name, iterations: options.iterations, wasm }) + '\n');
}
