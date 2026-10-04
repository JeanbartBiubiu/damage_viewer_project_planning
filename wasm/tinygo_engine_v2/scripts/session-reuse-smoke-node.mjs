import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  compileCanonicalSession, FRAME_GENERIC_RUN, instantiateGenericHost, invokeFrame,
  loadCanonicalFixture, moduleRoot, releaseCanonicalSession, runCanonicalSession
} from './generic-abi-host.mjs';

const options = { wasm: resolve(moduleRoot, 'dist/tinygo_engine_v2.wasm'), fixture: null, output: null, iterations: 100 };
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (key === '--wasm') options.wasm = resolve(process.argv[++index]);
  else if (key === '--fixture') options.fixture = resolve(process.argv[++index]);
  else if (key === '--output') options.output = resolve(process.argv[++index]);
  else if (key === '--iterations') options.iterations = Number(process.argv[++index]);
  else throw new Error(`Unknown option ${key}`);
}
assert(Number.isSafeInteger(options.iterations) && options.iterations >= 2);
const fixture = options.fixture ? JSON.parse(readFileSync(options.fixture, 'utf8')) : loadCanonicalFixture();
assert(fixture.compileRequest && fixture.runRequest);
const host = await instantiateGenericHost(options.wasm);
const compiled = compileCanonicalSession(host.exports, fixture);
const baseline = runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash);
const timings = [];
for (let iteration = 1; iteration <= options.iterations; iteration++) {
  const start = performance.now();
  const done = runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash);
  timings.push(performance.now() - start);
  assert.deepEqual(done, baseline, `Same-session output differs at run ${iteration}`);
}
const variants = [];
for (const [index, request] of (fixture.runVariants ?? []).entries()) {
  const variantFixture = { ...fixture, runRequest: request };
  const done = runCanonicalSession(host.exports, variantFixture, compiled.sessionId, compiled.rulesHash);
  assert.deepEqual(runCanonicalSession(host.exports, variantFixture, compiled.sessionId, compiled.rulesHash), done,
    `Same-session variant differs at ${index}`);
  variants.push({ index, requestedDurationMs: request.stopPolicy?.durationMs, durationMs: done.summary.durationMs });
}
const truncatedFixture = { ...fixture, runRequest: { ...fixture.runRequest,
  recordBudget: { maxAttackRecords: 0, maxDamageRecords: 0 } } };
const truncated = runCanonicalSession(host.exports, truncatedFixture, compiled.sessionId, compiled.rulesHash);
assert.deepEqual(truncated.summary, baseline.summary);
assert.deepEqual(truncated.finalSnapshot, baseline.finalSnapshot);
assert.equal(truncated.attackRecords.length, 0);
assert.equal(truncated.damageRecords.length, 0);
const rejectedRequest = { ...fixture.runRequest, sessionId: compiled.sessionId, expectedRulesHash: 'invalid_reuse_probe_hash' };
assert.throws(() => invokeFrame(host.exports, 'engine_run', FRAME_GENERIC_RUN, rejectedRequest), /hash_mismatch|expectedRulesHash/i);
assert.deepEqual(runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash), baseline);
const firstRelease = releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);
assert.throws(() => invokeFrame(host.exports, 'engine_run', FRAME_GENERIC_RUN,
  { ...fixture.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash }), /session.not.found/i);
const recompiled = compileCanonicalSession(host.exports, fixture);
assert.notEqual(recompiled.sessionId, compiled.sessionId);
const reopened = runCanonicalSession(host.exports, fixture, recompiled.sessionId, recompiled.rulesHash);
assert.deepEqual(reopened, baseline);
const secondRelease = releaseCanonicalSession(host.exports, recompiled.sessionId, recompiled.rulesHash);
const sorted = [...timings].sort((left, right) => left - right);
const result = { ok: true, wasm: options.wasm, fixture: options.fixture ?? fixture.name, bytes: host.sizeBytes,
  iterations: options.iterations, linearMemoryBytes: host.exports.memory.buffer.byteLength,
  meanMs: timings.reduce((total, value) => total + value, 0) / timings.length,
  p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], variants, firstRelease, secondRelease,
  hitCount: baseline.summary.basicAttack?.hitCount, sourceDamage: baseline.summary.sourceDamageDealt,
  targetFinalHp: baseline.summary.targetFinalHp };
if (options.output) writeFileSync(options.output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
