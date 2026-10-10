import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  instantiateGenericHost, invokeFrame, requireFramePayload,
  FRAME_GENERIC_COMPILE, FRAME_GENERIC_RUN, FRAME_GENERIC_RELEASE_SESSION,
  OUTBOX_GENERIC_COMPILE_RESULT, OUTBOX_GENERIC_DONE, OUTBOX_GENERIC_RELEASE_RESULT,
} from '../../wasm/tinygo_engine_v2/scripts/generic-abi-host.mjs';

// 只重放最终浏览器导出的真实请求；不读取底本、不补目录或公式。
const artifacts = process.argv.slice(2);
assert.ok(artifacts.length, '请传入最终浏览器导出的工作线程证据 JSON 路径');
const wasmPath = fileURLToPath(new URL('../src/engine/wasm/tinygo_engine_v2.wasm', import.meta.url));
const wasm = readFileSync(wasmPath);
const identity = { bytes: wasm.length, sha256: createHash('sha256').update(wasm).digest('hex') };
const host = await instantiateGenericHost(wasmPath);
const invoke = (name, kind, payload, responseKind) =>
  requireFramePayload(invokeFrame(host.exports, name, kind, payload), responseKind, name);
const reports = [];
for (const artifact of artifacts) {
  const saved = JSON.parse(readFileSync(resolve(artifact), 'utf8'));
  assert.deepEqual({ bytes: saved.wasm.bytes, sha256: saved.wasm.sha256 }, identity, '证据必须对应最终前端产物');
  const compileRequest = saved.compileRequest ?? saved.result?.prepared?.compileRequest;
  const runRequest = saved.runRequest ?? saved.result?.request ?? saved.result?.runRequest;
  const expected = saved.runResult ?? saved.result?.baseline ?? saved.result?.done;
  assert.ok(compileRequest && runRequest && expected, '缺少实际编译、运行请求或浏览器完整结果');
  const compile = () => {
    const compiled = invoke('engine_compile', FRAME_GENERIC_COMPILE, compileRequest, OUTBOX_GENERIC_COMPILE_RESULT);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.errors));
    assert.equal(compiled.rulesHash, compileRequest.rulesHash);
    return compiled;
  };
  const run = session => invoke('engine_run', FRAME_GENERIC_RUN,
    { ...runRequest, sessionId: session.sessionId }, OUTBOX_GENERIC_DONE);
  const release = session => {
    const released = invoke('engine_release_session', FRAME_GENERIC_RELEASE_SESSION,
      { sessionId: session.sessionId, expectedRulesHash: compileRequest.rulesHash }, OUTBOX_GENERIC_RELEASE_RESULT);
    assert.equal(released.released, true);
    return released;
  };
  const session = compile();
  for (let index = 0; index < 20; index++) assert.deepEqual(run(session), expected, 'Node 与浏览器完整结果必须一致');
  assert.throws(() => invoke('engine_run', FRAME_GENERIC_RUN,
    { ...runRequest, sessionId: session.sessionId, expectedRulesHash: 'phase4.invalid.rules' }, OUTBOX_GENERIC_DONE), /hash_mismatch/);
  assert.deepEqual(run(session), expected, '错误摘要后同会话应保持原结果');
  const firstRelease = release(session);
  assert.throws(() => run(session), /session_not_found/);
  const recompiled = compile();
  assert.deepEqual(run(recompiled), expected, '释放后重编译仍应保持完整结果');
  const finalRelease = release(recompiled);
  reports.push({ artifact: resolve(artifact), repeatedRuns: 20, summary: expected.summary, firstRelease, finalRelease });
}
const report = { wasm: identity, inputSource: '最终浏览器完整原请求', formulaInjection: false, reports };
writeFileSync(process.env.FORMULA_PHASE4_REPLAY_REPORT || 'output/formula-phase4-browser-replay.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
