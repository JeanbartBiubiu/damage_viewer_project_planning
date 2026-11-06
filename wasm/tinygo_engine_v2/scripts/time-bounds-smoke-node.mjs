// 真实Wasm运行时间边界；原生Go不能单独证明32位采样计数和转换行为。
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createFormulaPhase4Input } from './formula-phase4-input.mjs';
import {
  FRAME_GENERIC_RUN, compileCanonicalSession, instantiateGenericHost, invokeFrame,
  moduleRoot, releaseCanonicalSession, runCanonicalSession, withNodeAuthorization,
} from './generic-abi-host.mjs';

const { values } = parseArgs({ options: { wasm: { type: 'string' } } });
const wasmPath = resolve(moduleRoot, values.wasm ?? 'dist/tinygo_engine_v2.wasm');
const host = await instantiateGenericHost(wasmPath);
const base = createFormulaPhase4Input();
const compiled = compileCanonicalSession(host.exports, base);
const nearMaximum = 2 ** 63 - 2048;

function fixture({ start = 0, duration = 100, first = start, repeat, sampling } = {}) {
  const input = structuredClone(base);
  input.runRequest.initialSnapshot.timeMs = start;
  input.runRequest.stopPolicy = { ...input.runRequest.stopPolicy, durationMs: duration, stopWhenNoEvents: false };
  input.runRequest.driverPlan.entries[0] = { ...input.runRequest.driverPlan.entries[0], firstAtMs: first, ...(repeat ? { repeat } : {}) };
  if (sampling) input.runRequest.sampling = sampling;
  return input;
}

const rejected = [
  { name: 'negative start', options: { start: -1 }, path: 'initialSnapshot.timeMs' },
  { name: 'negative duration', options: { duration: -100 }, path: 'stopPolicy.durationMs' },
  { name: 'overflowing end', options: { start: nearMaximum, duration: 10000 }, path: 'stopPolicy.durationMs' },
  { name: 'past driver', options: { start: 100, first: 0 }, path: 'driverPlan.entries[0].firstAtMs' },
  { name: 'sampling output overflow', options: { duration: 2 ** 32, sampling: { sampleEveryMs: 1, dpsWindowMs: 100, maxSeriesPoints: 3 } }, path: 'sampling' },
];
for (const test of rejected) {
  const input = fixture(test.options);
  const request = withNodeAuthorization({ ...input.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash });
  assert.throws(() => invokeFrame(host.exports, 'engine_run', FRAME_GENERIC_RUN, request), error =>
    error.message.includes('runtime_invariant_failed') && error.message.includes(test.path), test.name);
}

const accepted = [
  { name: 'zero duration', options: { duration: 0 }, hp: 900 },
  { name: 'resumed clock', options: { start: 100 }, hp: 900 },
  { name: 'future driver', options: { first: 101 }, hp: 1000 },
  { name: 'future repeat overflow', options: { first: nearMaximum, repeat: { intervalMs: 10000, maxAttempts: 2 } }, hp: 1000 },
  { name: 'in-window repeat overflow', options: { first: 1, repeat: { intervalMs: nearMaximum, maxAttempts: 2 } }, hp: 900 },
  { name: 'huge dynamic interval', options: { repeat: { intervalFormula: { op: 'const', value: 1e20 }, maxAttempts: 2 } }, hp: 900 },
  { name: 'sampling cursor near maximum', options: { start: nearMaximum, duration: 0, sampling: { sampleEveryMs: 5000, dpsWindowMs: 100, maxSeriesPoints: 3 } }, hp: 900 },
  { name: 'maximum sampling count', options: { duration: 2 ** 31 - 2, sampling: { sampleEveryMs: 1, dpsWindowMs: 100, maxSeriesPoints: 3 } }, hp: 900 },
  { name: 'long run without sampling', options: { duration: 2 ** 32, sampling: { disabled: true } }, hp: 900 },
];
for (const test of accepted) {
  const input = fixture(test.options);
  input.expectedSummarySubset = { targetFinalHp: test.hp };
  const done = runCanonicalSession(host.exports, input, compiled.sessionId, compiled.rulesHash);
  assert.equal(done.summary.durationMs, test.options.duration ?? 100, test.name);
  assert.ok(done.finalSnapshot.timeMs >= (test.options.start ?? 0), test.name);
  if (test.name === 'maximum sampling count') {
    assert.equal(done.seriesSamplingEvidence.requestedPointCount, 2 ** 31 - 1);
    assert.ok(done.seriesSamplingEvidence.effectiveSampleEveryMs > 0);
    assert.ok(done.series.length <= 3);
    assert.equal(done.warnings.find(row => row.code === 'series_downsampled')?.count, 2 ** 31 - 4);
  }
}
releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash);
console.log(JSON.stringify({ wasm: wasmPath, rejected: rejected.length, accepted: accepted.length, released: true }));
