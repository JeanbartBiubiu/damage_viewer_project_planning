import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const options = { directory: resolve('output/phase6b'), wasm: resolve('src/engine/wasm/tinygo_engine_v2.wasm'),
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
assert(files.length > 0, '尚无实际Worker保存的请求；不构造替代作者数据');
const semanticRun = request => {
  const { recordBudget, sampling, ...semantics } = request;
  return semantics;
};
for (const name of files) {
  const fixture = JSON.parse(readFileSync(resolve(options.directory, name), 'utf8'));
  if (process.env.SIMULATION_EXPECTED_WASM_SHA256) assert.equal(wasm.sha256, process.env.SIMULATION_EXPECTED_WASM_SHA256.toLowerCase());
  assert.deepEqual(wasm, { bytes: fixture.wasm.bytes, sha256: fixture.wasm.sha256 }, 'Worker请求与当前Wasm身份不同，须按新产物重跑');
  assert(fixture.runRequest.driverPlan.skillActions.length >= 1 && fixture.runRequest.driverPlan.skillActions.length <= 64);
  const earlier = new Map();
  const ordered = [...fixture.runRequest.driverPlan.skillActions].sort((left, right) => left.firstAtMs - right.firstAtMs || left.sortOrder - right.sortOrder
    || (left.instructionKey < right.instructionKey ? -1 : left.instructionKey > right.instructionKey ? 1 : 0));
  for (const action of ordered) {
    assert(['INITIAL', 'CHARGE_RELEASE', 'RECAST', 'CANCEL'].includes(action.action));
    if (action.action === 'INITIAL') assert.equal(action.parentInstructionKey, null);
    else {
      const parent = earlier.get(action.parentInstructionKey);
      assert(parent && parent.action === 'INITIAL' && parent.bindingKey === action.bindingKey && parent.source === action.source
        && parent.target === action.target && parent.skillKey === action.skillKey, '控制必须关联完整排序中更早的同源同目标原首次');
      assert.deepEqual(action.hitBindings, [], '控制不得改写原首次预设');
    }
    assert(!earlier.has(action.instructionKey));
    earlier.set(action.instructionKey, action);
  }
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
    if (JSON.stringify(semanticRun(request)) === JSON.stringify(semanticRun(fixture.runRequest))) {
      assert.deepEqual(done.summary, baseline.summary, '记录或采样变体不得改变完整累计');
      assert.deepEqual(done.finalSnapshot, baseline.finalSnapshot, '记录或采样变体不得改变完整过程、段与占用历史');
    }
    variants.push({ index, summary: done.summary, recording: done.recording });
  }
  const withoutRecords = { ...fixture, runRequest: { ...fixture.runRequest, recordBudget: {
    maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0, maxSkillActionRecords: 0, maxSkillUseRecords: 0, maxHealingRecords: 0
  } } };
  const zero = runCanonicalSession(host.exports, withoutRecords, compiled.sessionId, compiled.rulesHash);
  assert.deepEqual(zero.summary, baseline.summary);
  assert.deepEqual(zero.finalSnapshot, baseline.finalSnapshot);
  for (const field of ['attackRecords', 'mechanicRecords', 'skillActionRecords', 'skillUseRecords', 'healingRecords', 'damageRecords']) assert.deepEqual(zero[field], []);
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
    evidenceKind: name.startsWith('real-') ? 'real_configuration' : 'independent_construct', baselineDigest: createHash('sha256').update(JSON.stringify(baseline)).digest('hex'), summary: baseline.summary,
    variants, zeroRecording: zero.recording, release, secondRelease };
  writeFileSync(resolve(options.directory, name.replace('-compile-run.json', '-node-proof.json')), JSON.stringify(proof, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, fixture: name, iterations: options.iterations, wasm }) + '\n');
}
