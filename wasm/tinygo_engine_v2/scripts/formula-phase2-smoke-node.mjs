import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  compileCanonicalSession,
  instantiateGenericHost,
  loadCanonicalFixture,
  moduleRoot,
  releaseCanonicalSession,
  runCanonicalSession
} from './generic-abi-host.mjs';

const artifact = resolve(moduleRoot, process.argv[2] ?? 'target/formula-phase2/tinygo_engine_v2.wasm');
const fixture = loadCanonicalFixture();
const host = await instantiateGenericHost(artifact);
const compiled = compileCanonicalSession(host.exports, fixture);
let expected;
for (let iteration = 0; iteration < 20; iteration++) {
  const done = runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash);
  if (iteration === 0) expected = done.summary;
  else assert.deepEqual(done.summary, expected, `同会话第${iteration + 1}次结果不一致`);
}
assert.equal(releaseCanonicalSession(host.exports, compiled.sessionId, compiled.rulesHash).released, true);
assert.throws(() => runCanonicalSession(host.exports, fixture, compiled.sessionId, compiled.rulesHash), /session_not_found/);
assert.equal(host.exports.memory.buffer.byteLength, 256 * 1024 * 1024);
console.log(JSON.stringify({ artifact, sizeBytes: host.sizeBytes, memoryBytes: host.exports.memory.buffer.byteLength, repeatedRuns: 20, targetFinalHp: expected.targetFinalHp, result: 'pass', boundary: '正式Wasm原固定样例，不是新作者协议或浏览器工作线程' }));
