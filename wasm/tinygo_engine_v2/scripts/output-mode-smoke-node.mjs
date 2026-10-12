// 输出模式专项：使用正式通用接口与已有Node宿主，不另建数值计算器。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFormulaPhase4Input } from './formula-phase4-input.mjs';
import {
  compileCanonicalSession, FRAME_GENERIC_RUN, instantiateGenericHost, invokeFrame,
  moduleRoot, releaseCanonicalSession, runCanonicalSession,
} from './generic-abi-host.mjs';

const options = { wasm: resolve(moduleRoot, 'dist/tinygo_engine_v2.wasm'), fixture: null, output: null, iterations: 10 };
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (key === '--wasm') options.wasm = resolve(process.argv[++index]);
  else if (key === '--fixture') options.fixture = resolve(process.argv[++index]);
  else if (key === '--output') options.output = resolve(process.argv[++index]);
  else if (key === '--iterations') options.iterations = Number(process.argv[++index]);
  else throw new Error(`未知参数 ${key}`);
}
assert(Number.isSafeInteger(options.iterations) && options.iterations >= 2);
const fixture = options.fixture ? JSON.parse(readFileSync(options.fixture, 'utf8')) : createFormulaPhase4Input();
const host = await instantiateGenericHost(options.wasm);
const compiled = compileCanonicalSession(host.exports, fixture);
const run = request => runCanonicalSession(host.exports, { ...fixture, runRequest: request }, compiled.sessionId, compiled.rulesHash);
const arrayKeys = ['attackRecords', 'damageRecords', 'mechanicRecords', 'skillActionRecords', 'skillUseRecords', 'healingRecords'];
function equivalent(detailed, summary) {
  assert.equal(Object.hasOwn(detailed, 'outputMode'), false);
  assert.equal(summary.outputMode, 'summary');
  for (const key of ['summary', 'finalSnapshot', 'warnings', 'series', 'seriesSamplingEvidence']) {
    assert.deepEqual(summary[key], detailed[key], `模式改变了${key}`);
  }
  for (const key of arrayKeys) assert.deepEqual(summary[key], [], `汇总模式保留了${key}`);
  assert.deepEqual(summary.evidence, { ...detailed.evidence, items: [] });
  const recording = { ...detailed.recording };
  for (const key of Object.keys(recording)) if (key.startsWith('returned')) recording[key] = 0;
  assert.deepEqual(summary.recording, recording);
}

const detailed = run(fixture.runRequest);
const baseline = JSON.stringify(detailed);
const numericalRequest = { ...fixture.runRequest, sampling: { ...fixture.runRequest.sampling, disabled: true } };
const numericalDetailed = run(numericalRequest);
const summaryRequest = { ...numericalRequest, outputMode: 'summary' };
const summary = run(summaryRequest);
equivalent(numericalDetailed, summary);
assert.deepEqual(summary.series, []);
// 输出模式不隐含关闭采样；原采样与其警告必须保持。
equivalent(detailed, run({ ...fixture.runRequest, outputMode: 'summary' }));
for (let iteration = 0; iteration < options.iterations; iteration++) {
  assert.deepEqual(run(summaryRequest), summary);
  assert.equal(JSON.stringify(run({ ...fixture.runRequest, outputMode: 'detailed' })), baseline);
}

const zeroRequest = { ...numericalRequest, recordBudget: {
  maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0,
  maxSkillActionRecords: 0, maxSkillUseRecords: 0, maxHealingRecords: 0,
} };
equivalent(run(zeroRequest), run({ ...zeroRequest, outputMode: 'summary' }));
for (const mode of ['', null, 'unknown', 3]) {
  assert.throws(() => invokeFrame(host.exports, 'engine_run', FRAME_GENERIC_RUN, {
    ...fixture.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash, outputMode: mode,
  }), /outputMode|bad_request|invalid_request/i);
  assert.deepEqual(run(summaryRequest), summary);
  assert.equal(JSON.stringify(run(fixture.runRequest)), baseline);
}

releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);
assert.throws(() => run(summaryRequest), /session.not.found/i);
const reopened = compileCanonicalSession(host.exports, fixture);
assert.notEqual(reopened.sessionId, compiled.sessionId);
assert.equal(JSON.stringify(runCanonicalSession(host.exports, fixture, reopened.sessionId, reopened.rulesHash)), baseline);
assert.deepEqual(runCanonicalSession(host.exports, { ...fixture, runRequest: summaryRequest }, reopened.sessionId, reopened.rulesHash), summary);
releaseCanonicalSession(host.exports, reopened.sessionId, reopened.rulesHash);
const result = {
  ok: true, wasm: options.wasm, bytes: host.sizeBytes,
  sha256: createHash('sha256').update(readFileSync(options.wasm)).digest('hex'),
  fixture: options.fixture ?? fixture.name, iterations: options.iterations,
  fullResultSha256: createHash('sha256').update(baseline).digest('hex'),
  numericalEquivalent: true, independentSampling: true, budgetEquivalent: true,
  invalidModeRecovery: true, releaseRecompile: true,
  fullResultBytes: Buffer.byteLength(baseline), summaryResultBytes: Buffer.byteLength(JSON.stringify(summary)),
  linearMemoryBytes: host.exports.memory.buffer.byteLength,
};
if (options.output) writeFileSync(options.output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
