import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { compileCanonicalSession, FRAME_GENERIC_COMPILE, FRAME_GENERIC_RUN, instantiateGenericHost, invokeFrame, loadCanonicalFixture, moduleRoot, OUTBOX_GENERIC_COMPILE_RESULT, OUTBOX_GENERIC_DONE, releaseCanonicalSession, requireFramePayload, runCanonicalSession } from './generic-abi-host.mjs';
import { createFormulaPhase3BDefinition, createFormulaPhase3BInput, createFormulaPhase3BTwoInstances, createFormulaPhase3BDerivationInput } from './formula-phase3b-input.mjs';

const artifact = resolve(moduleRoot, process.argv[2] ?? 'target/formula-phase3b/tinygo_engine_v2.wasm');
const host = await instantiateGenericHost(artifact);
const exports = host.exports;
const cases = [];
const compile = input => requireFramePayload(invokeFrame(exports, 'engine_compile', FRAME_GENERIC_COMPILE, input.compileRequest), OUTBOX_GENERIC_COMPILE_RESULT, 'compile');
const run = (input, session, request = input.runRequest) => requireFramePayload(invokeFrame(exports, 'engine_run', FRAME_GENERIC_RUN, { ...request, sessionId: session.sessionId, expectedRulesHash: session.rulesHash }), OUTBOX_GENERIC_DONE, 'run');
const fail = (action, code, path) => { let report; try { report = JSON.stringify(action()); } catch (error) { report = error.message; } assert.ok(report.includes(code), report); if (path) assert.ok(report.includes(path), report); };
const constant = value => ({ op: 'const', value: String(value) });

const canonical = loadCanonicalFixture();
const baseline = compileCanonicalSession(exports, canonical);
assert.equal(runCanonicalSession(exports, canonical, baseline.sessionId, baseline.rulesHash).summary.targetFinalHp, 900);
releaseCanonicalSession(exports, baseline.sessionId, baseline.rulesHash);
cases.push('原固定样例900');

for (const stages of [2, 6]) {
  const input = createFormulaPhase3BInput({ expression: createFormulaPhase3BDefinition({ stages }) });
  const session = compile(input);
  assert.equal(session.ok, true);
  assert.equal(session.metadata.approvedStaticValues[input.programKey], 120);
  assert.ok(JSON.stringify(input.compileRequest).includes('1.200'));
  const done = run(input, session);
  assert.equal(done.summary.targetFinalHp, 950);
  assert.equal(done.summary.sourceDamageDealt, 80);
  assert.equal(done.evidence.items.find(e => e.kind === 'damage').data.shieldAbsorbed, 30);
  for (const key of Object.keys(session.metadata.approvedStaticValues)) assert.ok(input.compileRequest.formulas.some(formula => formula.key === key));
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  cases.push(`${stages}局部结果完整引用惰性与静态批准`);
}

{
  const input = createFormulaPhase3BTwoInstances();
  const session = compile(input);
  assert.equal(session.metadata.approvedStaticValues[input.programKey], 120);
  assert.equal(session.metadata.approvedStaticValues[input.secondProgramKey], 240);
  const done = run(input, session);
  assert.equal(done.summary.targetFinalHp, 950);
  assert.equal(done.summary.sourceFinalHp, 870);
  assert.equal(done.summary.targetDamageDealt, 160);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  cases.push('同技能两个挂载等级与实际反向来源隔离');
}

for (const [name, change, code] of [
  ['旧树', f => { f.expression = { op: 'const', value: 120 }; }, 'FORMULA_INVALID_STRUCTURE'],
  ['漏选值', f => { delete f.parameters[0].value; }, 'FORMULA_INVALID_STRUCTURE'],
  ['null值', f => { f.parameters[0].value = null; }, 'json_parse_error'],
  ['错误模式', f => { f.parameters[0].valueMode = 'GUESS'; }, 'FORMULA_INVALID_STRUCTURE'],
  ['计算时默认值', f => { f.parameters[0].valueMode = 'RUNTIME_INPUT'; }, 'FORMULA_INVALID_STRUCTURE'],
  ['外国同名', f => { f.expression.inputs[0].binding.skillKey = 'foreign'; }, 'FORMULA_UNKNOWN_BINDING'],
  ['未使用越权', f => { f.expression.inputs.push({ key: 'unused', binding: { kind: 'context', contextKey: 'unsafe' } }); }, 'FORMULA_UNKNOWN_BINDING'],
  ['目录重复', f => { f.parameters.push(structuredClone(f.parameters[0])); }, 'FORMULA_DUPLICATE_KEY']
]) { const input = createFormulaPhase3BInput(); change(input.compileRequest.formulas[0]); fail(() => compile(input), code); cases.push(name); }

{
  const input = createFormulaPhase3BInput();
  input.compileRequest.sharedProviders[0].skillKey = 'foreign';
  fail(() => compile(input), 'unknown_ref', 'skillKey');
  cases.push('独立供值器能力归属');
}

{
  const input = createFormulaPhase3BInput();
  const f = input.compileRequest.formulas[0];
  f.parameters[0] = { parameterKey: 'basis', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL' };
  f.expression.stages = [{ key: 'output', name: '惰性条件', expression: { op: 'if', args: [constant(0), { op: 'read', inputKey: 'basis' }, constant(120)] } }];
  const session = compile(input);
  assert.equal(Object.hasOwn(session.metadata.approvedStaticValues ?? {}, input.programKey), false);
  assert.equal(run(input, session).summary.targetFinalHp, 950);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  f.expression.stages[0].expression.args[0] = constant(1);
  const selected = compile(input);
  fail(() => run(input, selected), 'FORMULA_MISSING_INPUT', '/args/1/inputKey');
  fail(() => run(input, selected), 'FORMULA_MISSING_INPUT');
  releaseCanonicalSession(exports, selected.sessionId, selected.rulesHash);
  cases.push('条件两支静态依赖与实际分支惰性缺值');
}

{
  const input = createFormulaPhase3BInput();
  const f = input.compileRequest.formulas[0];
  f.expression.inputs.push({ key: 'unused', binding: { kind: 'parameter', skillKey: f.skillKey, parameterKey: 'runtime' } });
  f.parameters.push({ parameterKey: 'runtime', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL' });
  f.expression.stages.push({ key: 'unused', name: '动态未用', expression: { op: 'div', args: [{ op: 'read', inputKey: 'unused' }, constant(0)] } });
  const session = compile(input);
  assert.equal(session.metadata.approvedStaticValues[input.programKey], 120);
  assert.equal(run(input, session).summary.targetFinalHp, 950);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  cases.push('未read声明保留授权并不增加动作供值');
}

{
  const input = createFormulaPhase3BInput();
  input.compileRequest.combatants[0].resources.mana = { current: 200, max: 200 };
  input.runRequest.initialSnapshot.combatants[0].resources.mana = { current: 200, max: 200 };
  input.compileRequest.formulas.push({ key: 'gate', skillKey: 'formula_phase3b_probe', parameters: [], expression: {
    inputs: [{ key: 'divisor', binding: { kind: 'attribute', object: 'source', attributeKey: 'armor', valueKind: 'TOTAL', view: 'current_frame' } }],
    stages: [{ key: 'cost', name: '成本', expression: { op: 'div', args: [constant(60), { op: 'read', inputKey: 'divisor' }] } }], outputStageKey: 'cost'
  } });
  input.compileRequest.sharedProviders[0].abilities[0].cost = { resourceKey: 'mana', amount: { op: 'ref', ref: 'gate' } };
  const session = compile(input);
  fail(() => run(input, session), 'FORMULA_DIVISION_BY_ZERO', '/formulas/1/expression/stages/0/expression');
  Object.assign(input.runRequest.initialSnapshot.combatants[0].attributes.armor, { base: 1, current: 1, max: 1, resolved: 1 });
  let prior;
  for (let i = 0; i < 20; i++) { const done = run(input, session); assert.equal(done.summary.targetFinalHp, 950); assert.equal(done.finalSnapshot.combatants[0].resources.mana.current, 140); if (prior) assert.deepEqual(done.summary, prior); prior = done.summary; }
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  fail(() => run(input, session), 'session_not_found');
  cases.push('资源门禁共同错误与同会话失败后20次运行释放');
}

{
  const input = createFormulaPhase3BInput();
  const ref = { op: 'ref', ref: input.programKey };
  input.compileRequest.sharedProviders[0].initialStateSchema = { count: { valueType: 'integer', defaultValue: ref, maxValue: ref, durationMs: ref } };
  input.compileRequest.sharedProviders[0].lifecycle = { maxStacks: ref, tickIntervalMs: ref };
  const session = compile(input);
  assert.equal(session.metadata.approvedStaticValues[input.programKey], 120);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  input.compileRequest.sharedProviders[0].initialStateSchema.count.maxValue = 119;
  fail(() => compile(input), 'missing_required_field', 'maxValue');
  input.compileRequest.sharedProviders[0].initialStateSchema.count.maxValue = { ...ref, extra: 0 };
  fail(() => compile(input), 'formula_type_error', 'maxValue');
  cases.push('静态字段原生共同引用冻结与初值上限严格形状');
}

for (const failure of [false, true]) {
  const input = createFormulaPhase3BInput();
  const skillKey = input.compileRequest.formulas[0].skillKey;
  const namedRuntime = (key, source) => ({ key, skillKey, parameters: [{ parameterKey: 'runtime', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', runtimeSource: source }], expression: {
    inputs: [{ key: 'runtime', binding: { kind: 'parameter', skillKey, parameterKey: 'runtime' } }],
    stages: [{ key: 'output', name: '实际使用输入', expression: { op: 'read', inputKey: 'runtime' } }], outputStageKey: 'output'
  } });
  input.compileRequest.formulas.push(namedRuntime('charge', { kind: 'use_charge_duration' }), namedRuntime('actual', { kind: 'process_actual_cost', resourceKey: 'mana' }));
  const provider = input.compileRequest.sharedProviders[0];
  const moment = (momentType, stepKey = null) => ({ momentType, stepKey, failureReason: null });
  const runtimeRef = ref => ({ op: 'ref', ref });
  const number = value => ({ op: 'const', value });
  const refund = { operation: 'resource_change', target: 'self', resourceKey: 'mana', amount: runtimeRef('actual') };
  provider.processes = [{ processKey: 'p', skillKey, steps: [{ stepKey: 'charge', stepType: 'CHARGE', minimumChargeMs: number(100), maximumChargeMs: number(500), releaseAtMaximum: false }], costs: [{ resourceKey: 'mana', amount: number(60) }], cooldown: null, momentOperations: [
    { moment: moment('STEP_EXECUTION', 'charge'), operations: [{ operation: 'damage', target: 'target', damageType: 'heat', amount: runtimeRef('charge') }] },
    { moment: moment('PROCESS_COMPLETE'), operations: [refund] }, { moment: moment('PROCESS_FAILURE'), operations: [refund] }
  ] }];
  provider.abilities = [
    { abilityKey: 'start', skillKey, kind: 'active', processControl: { processKey: 'p', action: 'INITIAL' } },
    { abilityKey: 'release', skillKey, kind: 'active', processControl: { processKey: 'p', action: 'CHARGE_RELEASE', stepKey: 'charge' } },
    { abilityKey: 'cancel', skillKey, kind: 'active', processControl: { processKey: 'p', action: 'CANCEL', failureReason: 'ACTIVE_CANCELLED' } }
  ];
  input.compileRequest.combatants[0].resources.mana = { current: 200, max: 200 };
  input.runRequest.initialSnapshot.combatants[0].resources.mana = { current: 200, max: 200 };
  const action = failure ? 'cancel' : 'release';
  input.runRequest.driverPlan.entries = [
    { entryKey: 'start', abilityRef: 'source.provider[formula_heat].ability[start]', source: 'source', target: 'target', firstAtMs: 0 },
    { entryKey: action, abilityRef: `source.provider[formula_heat].ability[${action}]`, source: 'source', target: 'target', firstAtMs: 300 }
  ];
  input.runRequest.skillUses = [{ useKey: 'use', source: 'source', skillKey, historyState: 'complete' }];
  input.runRequest.processCommandFacts = [{ driverEntryKey: 'start', useRef: 'use' }, { driverEntryKey: action, useRef: 'use' }];
  input.runRequest.stopPolicy.durationMs = 600;
  const session = compile(input);
  const done = run(input, session);
  assert.equal(done.summary.targetFinalHp, failure ? 1000 : 830);
  assert.equal(done.finalSnapshot.combatants[0].resources.mana.current, 200);
  assert.equal(done.finalSnapshot.processInstances[0].actualCosts.mana, 60);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  cases.push(failure ? '过程实际失败成本供值和退款' : '实际300ms蓄力完成与已提交60成本');
}

{
  const input = createFormulaPhase3BDerivationInput();
  const originalBindings = structuredClone(input.compileRequest.formulas[1].expression.inputs);
  const session = compile(input);
  for (const [sourceHP, targetHP, raw, targetAD] of [[800, 600, 295, 225], [900, 500, 285, 230]]) {
    const request = structuredClone(input.runRequest);
    Object.assign(request.initialSnapshot.combatants[0].attributes.hp, { current: sourceHP, resolved: sourceHP });
    Object.assign(request.initialSnapshot.combatants[1].attributes.hp, { current: targetHP, resolved: targetHP });
    const done = run(input, session, request);
    const expectedHP = targetHP - (raw * 100 / 130 - 30);
    const expectedSourceAD = ((20 + expectedHP / 100) / 10 + .35) * 100;
    assert.ok(Math.abs(done.summary.targetFinalHp - expectedHP) < 1e-9);
    assert.ok(Math.abs(done.finalSnapshot.combatants[0].attributes.attack_damage.resolved - expectedSourceAD) < 1e-9);
    assert.ok(Math.abs(done.finalSnapshot.combatants[1].attributes.attack_damage.resolved - targetAD) < 1e-9);
    assert.equal(done.evidence.items.find(row => row.kind === 'damage').data.rawAmount, raw);
  }
  assert.deepEqual(input.compileRequest.formulas[1].expression.inputs, originalBindings);
  const missing = structuredClone(input.runRequest);
  delete missing.initialSnapshot.combatants[0].attributes.hp.current;
  fail(() => run(input, session, missing), 'FORMULA_MISSING_INPUT', '"combatantKey":"target"');
  assert.equal(run(input, session).evidence.items.find(row => row.kind === 'damage').data.rawAmount, 295);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  cases.push('双方动态作者派生按拥有方读取防御与对手生命，内部读取保持战斗侧，前序写入和失败重试');
}

for (const skillKey of ['', 'foreign']) {
  const input = createFormulaPhase3BDerivationInput();
  input.compileRequest.rules.attributeDerivations[0].skillKey = skillKey;
  fail(() => compile(input), 'unknown_ref', 'rules.attributeDerivations[0].value');
}
cases.push('作者派生缺归属及外国技能拒绝');

{
  const input = createFormulaPhase3BDerivationInput();
  input.compileRequest.formulas[1].expression.inputs[0].binding.attributeKey = 'attack_damage';
  fail(() => compile(input), 'formula_type_error', 'rules.attributeDerivations[0].value');
  const dynamic = createFormulaPhase3BDerivationInput();
  dynamic.compileRequest.formulas[1] = { key: 'owner_dynamic', skillKey: dynamic.compileRequest.formulas[0].skillKey,
    parameters: [{ parameterKey: 'input', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL' }], expression: {
      inputs: [{ key: 'input', binding: { kind: 'parameter', skillKey: dynamic.compileRequest.formulas[0].skillKey, parameterKey: 'input' } }],
      stages: [{ key: 'out', name: '计算时读取', expression: { op: 'read', inputKey: 'input' } }], outputStageKey: 'out'
    }
  };
  fail(() => compile(dynamic), 'formula_type_error', 'rules.attributeDerivations[0].value');
  cases.push('拥有方映射后的派生输出回读和计算时参数拒绝');
}

{
  const input = createFormulaPhase3BDerivationInput();
  input.compileRequest.rules.attributeDerivations = [
    { combatantKey: 'source', attributeKey: 'attack_speed', value: { op: 'const', value: 2 } },
    { combatantKey: 'target', attributeKey: 'attack_damage', valuePolicy: 'multiply', value: { op: 'div', args: [{ op: 'read', path: 'source.attr.armor.base' }, { op: 'const', value: 10 }] } }
  ];
  input.compileRequest.sharedProviders[0].abilities[0].operations = [{ operation: 'heal', target: 'source', amount: { op: 'const', value: 0 } }];
  const session = compile(input);
  const done = run(input, session);
  assert.equal(done.finalSnapshot.combatants[0].attributes.attack_speed.resolved, 2);
  assert.equal(done.finalSnapshot.combatants[1].attributes.attack_damage.resolved, 50);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  cases.push('无作者归属的原内部派生保持字面值与全局来源语义');
}

assert.equal(exports.memory.buffer.byteLength, 256 * 1024 * 1024);
console.log(JSON.stringify({ artifact, sizeBytes: host.sizeBytes, sha256: createHash('sha256').update(host.bytes).digest('hex'), memoryBytes: exports.memory.buffer.byteLength, cases, result: 'pass', boundary: '独立技能专项及原固定样例；HTTP、数据库和浏览器Worker由主负责人分别验收' }));
