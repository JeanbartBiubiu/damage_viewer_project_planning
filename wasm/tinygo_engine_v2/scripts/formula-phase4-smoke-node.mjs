import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFormulaPhase4Input } from './formula-phase4-input.mjs';
import { createFormulaPhase3Input } from './formula-phase3-input.mjs';
import {
  CANONICAL_FIXTURE_PATH, compileCanonicalSession, FRAME_GENERIC_RUN, instantiateGenericHost,
  invokeFrame, loadCanonicalFixture, moduleRoot, releaseCanonicalSession, runCanonicalSession,
} from './generic-abi-host.mjs';

const artifact = resolve(moduleRoot, process.argv[2] ?? 'target/formula-phase4/tinygo_engine_v2.wasm');
const host = await instantiateGenericHost(artifact);
const exports = host.exports;
const cases = [];
const compile = input => compileCanonicalSession(exports, input);
const run = (input, session) => runCanonicalSession(exports, input, session.sessionId, session.rulesHash);
const release = session => releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
const expectError = (fn, code, path, ref) => assert.throws(fn, error => {
  assert.ok(error.message.includes(code), error.message);
  if (path) assert.ok(error.message.includes(path), error.message);
  if (ref) assert.ok(error.message.includes(ref), error.message);
  return true;
});

assert.equal(createHash('sha256').update(readFileSync(CANONICAL_FIXTURE_PATH)).digest('hex'), 'cf597916d5200bc4f5c4328fd15bb2dd0eb5c8c521a77fc815a4dfd4704fda05');
expectError(() => compile(loadCanonicalFixture()), 'missing_damage_type_formula', 'sharedProviders[0].abilities[0].operations[0].damageType', 'damage/physical');
cases.push('原输入字节保护及新协议明确拒绝');

{
  const input = createFormulaPhase4Input();
  const session = compile(input);
  assert.equal(run(input, session).summary.targetFinalHp, 900);
  release(session);
  cases.push('独立作者100乘常量1与900编译运行释放');
}

for (const raw of [0, 100]) {
  const input = createFormulaPhase4Input();
  input.compileRequest.sharedProviders[0].abilities[0].params.baseDamage = raw;
  input.compileRequest.rules.damageTypeFormulas = [];
  expectError(() => compile(input), 'missing_damage_type_formula', 'sharedProviders[0].abilities[0].operations[0].damageType', 'damage/physical');
}
cases.push('零金额与非零金额同样需要作者定义');

for (const [raw, factor] of [[0, '1'], [100, '0'], [100, '1']]) {
  const input = createFormulaPhase4Input();
  input.compileRequest.sharedProviders[0].abilities[0].params.baseDamage = raw;
  input.compileRequest.rules.damageTypeFormulas[0].formula.stages[0].expression.value = factor;
  const session = compile(input);
  const expected = raw * Number(factor);
  input.expectedSummarySubset = { targetFinalHp: 1000 - expected, sourceDamageDealt: expected, abilityCastCount: 1 };
  const done = run(input, session);
  const data = done.evidence.items.find(item => item.kind === 'damage').data;
  assert.equal(data.resistanceFactor, Number(factor));
  for (const key of ['resistanceBeforePenetration', 'penetrationPercent', 'penetrationFlat', 'effectiveResistance']) assert.equal(Object.hasOwn(data, key), false);
  release(session);
}
cases.push('明确常量0和1及零金额真实倍率证据');

{
  const input = createFormulaPhase4Input();
  input.compileRequest.typeCatalog.types.push({ key: 'unused.original/type', domain: 'damage' });
  const session = compile(input);
  assert.equal(run(input, session).summary.targetFinalHp, 900);
  release(session);
  input.compileRequest.sharedProviders[0].abilities[0].operations = [];
  input.compileRequest.typeCatalog.types = input.compileRequest.typeCatalog.types.filter(item => item.domain !== 'damage');
  input.compileRequest.rules.damageTypeFormulas = [];
  input.expectedSummarySubset = { targetFinalHp: 1000, sourceDamageDealt: 0 };
  const empty = compile(input);
  run(input, empty);
  release(empty);
  cases.push('未使用目录缺定义与无伤害空目录允许预检');
}

{
  const input = createFormulaPhase4Input();
  input.compileRequest.sharedProviders[0].abilities[0].operations[0].damageType = 'outside.original/key';
  expectError(() => compile(input), 'unknown_type_key', 'sharedProviders[0].abilities[0].operations[0].damageType', 'outside.original/key');
  cases.push('未知目录仍保留未知原键错误');
}

{
  const input = createFormulaPhase4Input();
  const originalKey = 'damage/任意原键.with/slash';
  input.compileRequest.typeCatalog.types.find(item => item.domain === 'damage').key = originalKey;
  input.compileRequest.rules.damageTypeFormulas[0].damageType = originalKey;
  input.compileRequest.sharedProviders[0].abilities[0].operations[0].damageType = originalKey;
  const session = compile(input);
  const done = run(input, session);
  assert.equal(done.evidence.items.find(item => item.kind === 'damage').data.damageType, originalKey);
  release(session);
  cases.push('任意完整原键有共同定义即可结算');
}

{
  const input = createFormulaPhase3Input({ attributeKey: 'original.defense/arbitrary', damageType: 'custom.original' });
  const session = compile(input);
  const valid = run(input, session);
  const bad = structuredClone(input.runRequest);
  delete bad.initialSnapshot.combatants[1].attributes['original.defense/arbitrary'].resolved;
  expectError(() => invokeFrame(exports, 'engine_run', FRAME_GENERIC_RUN, { ...bad, sessionId: session.sessionId, expectedRulesHash: session.rulesHash }), 'FORMULA_MISSING_INPUT');
  for (let index = 0; index < 20; index++) assert.deepEqual(run(input, session), valid);
  release(session);
  cases.push('真实共同缺输入错误及同会话失败后20次完整相同结果');
}

assert.equal(exports.memory.buffer.byteLength, 256 * 1024 * 1024);
console.log(JSON.stringify({ result: 'pass', artifact, bytes: host.sizeBytes, sha256: createHash('sha256').update(host.bytes).digest('hex'), memoryBytes: exports.memory.buffer.byteLength, cases,
  boundary: '原生Node最终Wasm专项；运行计划损坏与帧回滚由Go故障注入证明，浏览器与真实服务另行验收' }));
