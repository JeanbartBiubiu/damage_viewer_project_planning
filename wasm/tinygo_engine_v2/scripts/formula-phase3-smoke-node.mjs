import { createFormulaPhase4Input } from './formula-phase4-input.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  compileCanonicalSession, FRAME_GENERIC_COMPILE, FRAME_GENERIC_RUN,
  instantiateGenericHost, invokeFrame, loadCanonicalFixture, moduleRoot,
  OUTBOX_GENERIC_COMPILE_RESULT, OUTBOX_GENERIC_DONE, releaseCanonicalSession, requireFramePayload, runCanonicalSession
} from './generic-abi-host.mjs';
import { createFormulaPhase3Input } from './formula-phase3-input.mjs';

const artifact = resolve(moduleRoot, process.argv[2] ?? 'target/formula-phase3/tinygo_engine_v2.wasm');
const host = await instantiateGenericHost(artifact);
const exports = host.exports;
const cases = [];
const near = (got, want) => assert.ok(Math.abs(got - want) <= Math.max(1e-9, 1e-12 * Math.max(Math.abs(got), Math.abs(want))), `${got} != ${want}`);
const compile = input => requireFramePayload(invokeFrame(exports, 'engine_compile', FRAME_GENERIC_COMPILE, input.compileRequest), OUTBOX_GENERIC_COMPILE_RESULT, 'compile');
const run = (input, session, request = input.runRequest) => requireFramePayload(invokeFrame(exports, 'engine_run', FRAME_GENERIC_RUN, { ...request, sessionId: session.sessionId, expectedRulesHash: session.rulesHash }), OUTBOX_GENERIC_DONE, 'run');
const fail = (action, code, path) => {
  let report;
  try { report = JSON.stringify(action()); } catch (error) { report = error.message; }
  assert.ok(report.includes(code), `${code} missing: ${report}`);
  if (path) assert.ok(report.includes(path), `${path} missing: ${report}`);
};
const damage = done => done.evidence.items.find(e => e.kind === 'damage').data;
const constantDefinition = value => ({ inputs: [], stages: [{ key: 'output', name: '倍率', expression: { op: 'const', value } }], outputStageKey: 'output' });

// 原固定样例只复用读取，原文件及预期都保持不动。
fail(() => compileCanonicalSession(exports, loadCanonicalFixture()), "missing_damage_type_formula", "sharedProviders[0].abilities[0].operations[0].damageType");
cases.push("原固定输入按新协议拒绝");
const baseline = createFormulaPhase4Input();
const baselineSession = compileCanonicalSession(exports, baseline);
const baselineDone = runCanonicalSession(exports, baseline, baselineSession.sessionId, baselineSession.rulesHash);
assert.equal(baselineDone.summary.targetFinalHp, 900);
releaseCanonicalSession(exports, baselineSession.sessionId, baselineSession.rulesHash);
cases.push('独立显式作者基准900');

for (const stages of [1, 2, 6]) {
  const input = createFormulaPhase3Input({ stages });
  const session = compile(input);
  assert.equal(session.ok, true);
  const done = run(input, session);
  near(done.summary.sourceDamageDealt, 80);
  near(done.summary.targetFinalHp, 950);
  const data = damage(done);
  near(data.resistanceFactor, 2 / 3);
  near(data.shieldAbsorbed, 30);
  near(data.actualHpLoss, 50);
  for (const key of ['resistanceBeforePenetration', 'penetrationPercent', 'penetrationFlat', 'effectiveResistance']) assert.equal(Object.hasOwn(data, key), false);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  cases.push(`${stages}结果倍率与护盾生命`);
}

{
  const input = createFormulaPhase3Input({ damageType: '热伤原键', attributeKey: 'original.defense/key', stages: 6 });
  input.formula.stages.forEach(stage => { stage.name = '改名结果'; });
  const session = compile(input);
  near(run(input, session).summary.targetFinalHp, 950);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  cases.push('原键与展示改名');
}

{
  const input = createFormulaPhase3Input();
  const session = compile(input);
  const missing = structuredClone(input.runRequest);
  delete missing.initialSnapshot.combatants[1].attributes.armor.resolved;
  fail(() => run(input, session, missing), 'FORMULA_MISSING_INPUT', '/rules/damageTypeFormulas/0/formula/stages/0/expression/args/1/inputKey');
  const divided = structuredClone(input.runRequest);
  Object.assign(divided.initialSnapshot.combatants[1].attributes.armor, { base: -100, current: -100, max: -100, resolved: -100 });
  fail(() => run(input, session, divided), 'FORMULA_DIVISION_BY_ZERO', '/rules/damageTypeFormulas/0/formula/stages/1/expression');
  const nullInput = structuredClone(input.runRequest);
  nullInput.initialSnapshot.combatants[1].attributes.armor.resolved = null;
  fail(() => run(input, session, nullInput), 'json_parse_error');
  let summary;
  for (let iteration = 0; iteration < 20; iteration++) {
    const done = run(input, session);
    near(done.summary.targetFinalHp, 950);
    if (iteration === 0) summary = done.summary;
    else assert.deepEqual(done.summary, summary);
  }
  const zero = structuredClone(input.runRequest);
  Object.assign(zero.initialSnapshot.combatants[1].attributes.armor, { base: 0, current: 0, max: 0, resolved: 0 });
  near(run(input, session, zero).summary.targetFinalHp, 910);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  fail(() => run(input, session), 'session_not_found');
  cases.push('缺resolved除0与null失败后同会话20次及合法0释放');
}

for (const value of ['0', '-1']) {
  const input = createFormulaPhase3Input({ formula: constantDefinition(value) });
  const session = compile(input);
  if (value === '0') near(run(input, session).summary.targetFinalHp, 1000);
  else fail(() => run(input, session), 'FORMULA_INVALID_OUTPUT', '/rules/damageTypeFormulas/0/formula/stages/0/expression');
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  cases.push(value === '0' ? '0倍率' : '负倍率');
}

for (const [field, value] of [['object', 'owner'], ['view', 'event_snapshot'], ['valueKind', 'MAX'], ['attributeKey', 'undeclared']]) {
  const input = createFormulaPhase3Input();
  input.formula.inputs[0].binding[field] = value;
  fail(() => compile(input), 'FORMULA_UNKNOWN_BINDING', '/rules/damageTypeFormulas/0/formula/inputs/0/binding');
  cases.push(`越权${field}`);
}

{
  const input = createFormulaPhase3Input();
  input.formula.inputs[0].binding.valueKind = 'BASE';
  const session = compile(input);
  delete input.runRequest.initialSnapshot.combatants[1].attributes.armor.base;
  fail(() => run(input, session), 'FORMULA_MISSING_INPUT');
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  cases.push('缺base');
}

{
  const input = createFormulaPhase3Input();
  const op = input.compileRequest.sharedProviders[0].abilities[0].operations[0];
  Object.assign(op, { critEligible: true, critChance: { op: 'const', value: 0.5 }, critMultiplier: { op: 'const', value: 2 } });
  const session = compile(input);
  const done = run(input, session);
  near(done.summary.targetFinalHp, 910);
  near(damage(done).normalPartPostResistance, 40);
  near(damage(done).critPartPostResistance, 80);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  cases.push('普通暴击共同倍率');
}

{
  const input = createFormulaPhase3Input();
  input.compileRequest.typeCatalog.types.push({ key: 'heat', domain: 'attribute' });
  input.compileRequest.typeCatalog.types.push({ key: 'event/damage_instance', domain: 'event' });
  input.compileRequest.combatants[0].attributes.armor.max = 1000;
  input.runRequest.initialSnapshot.combatants[0].attributes.armor.max = 1000;
  input.compileRequest.rules.listeners = [{ listenerKey: 'scoped_heat', eventMatcher: { all: ['event/damage_instance', 'heat'] }, operations: [{ operation: 'attribute_change', target: 'source', attributeKey: 'armor', amount: { op: 'const', value: 10 } }] }];
  input.compileRequest.sharedProviders[0].modifiers = [{ modifierKey: 'raw_heat', kind: 'pipeline', command: 'damage', channel: 'all_damage', stage: 'outgoing_pre_mitigation', bucket: 'all_instances', priority: 0, valuePolicy: 'multiply', value: { op: 'const', value: 2 }, condition: { op: 'read', path: 'damage.type.heat' } }];
  const session = compile(input);
  const done = run(input, session);
  near(done.summary.targetFinalHp, 870);
  near(done.finalSnapshot.combatants[0].attributes.armor.resolved, 10);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
  cases.push('同名伤害属性与原键条件');
}

for (const collision of [false, true]) {
  const input = createFormulaPhase3Input();
  input.compileRequest.typeCatalog.types.push({ key: 'event/damage_instance', domain: 'event' });
  if (collision) input.compileRequest.typeCatalog.types.push({ key: 'event/damage_instance', domain: 'attribute' });
  input.compileRequest.combatants[0].attributes.armor.max = 1000;
  input.runRequest.initialSnapshot.combatants[0].attributes.armor.max = 1000;
  input.compileRequest.rules.listeners = [{ listenerKey: 'builtin_event', eventMatcher: { all: ['event/damage_instance', 'heat'] }, operations: [{ operation: 'attribute_change', target: 'source', attributeKey: 'armor', amount: { op: 'const', value: 10 } }] }];
  const session = compile(input);
  const done = run(input, session);
  near(done.summary.targetFinalHp, 950);
  near(done.finalSnapshot.combatants[0].attributes.armor.resolved, 10);
  assert.equal(done.evidence.items.filter(e => e.kind === 'emitted_event' && e.ref === 'event/damage_instance').length, 1);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
}
cases.push('明确事件与同名属性真实触发对照');

for (const collision of [false, true]) {
  const input = createFormulaPhase3Input();
  input.compileRequest.typeCatalog.types.push({ key: 'ability/basic_attack', domain: 'ability' }, { key: 'cast_origin/champion', domain: 'cast_origin' });
  if (collision) input.compileRequest.typeCatalog.types.push({ key: 'ability/basic_attack', domain: 'attribute' }, { key: 'cast_origin/champion', domain: 'attribute' });
  Object.assign(input.compileRequest.sharedProviders[0].abilities[0], { types: ['ability/basic_attack'], castOrigin: 'champion' });
  input.compileRequest.sharedProviders[0].modifiers = [{ modifierKey: 'builtin_ability', kind: 'pipeline', command: 'damage', channel: 'basic_damage', stage: 'outgoing_pre_mitigation', bucket: 'all_instances', priority: 0, valuePolicy: 'multiply', value: { op: 'const', value: 2 }, condition: { op: 'read', path: 'damage.cast_origin.champion' } }];
  const session = compile(input);
  const done = run(input, session);
  near(done.summary.targetFinalHp, 870);
  near(done.summary.sourceDamageDealt, 160);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
}
cases.push('明确普攻能力及施放来源与同名属性实际乘区对照');

for (const collision of [false, true]) {
  const input = createFormulaPhase3Input();
  input.compileRequest.typeCatalog.types.push({ key: 'ability/spell', domain: 'ability' }, { key: 'provider/spell_shield', domain: 'provider' }, { key: 'event/skill_hit', domain: 'event' }, { key: 'event/spell_shield_blocked', domain: 'event' });
  if (collision) input.compileRequest.typeCatalog.types.push({ key: 'ability/spell', domain: 'attribute' }, { key: 'provider/spell_shield', domain: 'attribute' }, { key: 'event/spell_shield_blocked', domain: 'attribute' });
  Object.assign(input.compileRequest.sharedProviders[0].abilities[0], { types: ['ability/spell'], skillKey: 'phase3_spell', operations: [{
    operation: 'resolve_skill_hit', target: 'target', skillHit: { skillKey: 'phase3_spell', candidates: [{
      candidateKey: 'heat', effectOccurrenceKey: 'heat_effect', effectKey: 'heat_effect', resultKey: 'heat_result',
      semantic: { resultType: 'DAMAGE', target: 'TARGET', moment: 'INSTANT' }, spellShieldBlockScope: 'SKILL', participationCondition: null,
      eventValueConditions: [{ key: 'blocked', comparator: 'eq', value: { op: 'const', value: 0 } }],
      operations: [{ operation: 'damage', target: 'target', damageType: 'heat', amount: { op: 'const', value: 120 } }]
    }] }
  }] });
  input.compileRequest.sharedProviders.push({ providerKey: 'shield:spell', kind: 'status', stableId: 'spell_shield', types: ['provider/spell_shield'], lifecycle: { durationMs: { op: 'const', value: 5000 }, maxStacks: 1, refreshPolicy: 'replace' }, listeners: [{ listenerKey: 'consume', eventMatcher: { all: ['event/spell_shield_blocked'] }, operations: [{ operation: 'expire_provider', target: 'self', providerRefFromEvent: true }] }] });
  input.compileRequest.combatants[1].providers = [{ providerRef: 'spell_shield', definitionRef: 'shield:spell' }];
  input.runRequest.initialSnapshot.combatants[1].providers = [{ providerRef: 'spell_shield', definitionRef: 'shield:spell', source: 'target', owner: 'target', stacks: 1, expireAt: 5000, state: {} }];
  input.runRequest.skillUses = [{ useKey: 'phase3_use', source: 'source', skillKey: 'phase3_spell', historyState: 'complete' }];
  input.runRequest.skillHitFacts = [{ driverEntryKey: 'heat_once', useRef: 'phase3_use' }];
  const session = compile(input);
  const done = run(input, session);
  near(done.summary.targetFinalHp, 1000);
  near(done.summary.sourceDamageDealt, 0);
  assert.equal(done.finalSnapshot.combatants[1].providers.length, 0);
  assert.equal(done.evidence.items.filter(e => e.kind === 'emitted_event' && e.ref === 'event/spell_shield_blocked').length, 1);
  releaseCanonicalSession(exports, session.sessionId, session.rulesHash);
}
cases.push('明确法术护盾供值器与同名属性真实阻挡消费对照');

assert.equal(exports.memory.buffer.byteLength, 256 * 1024 * 1024);
console.log(JSON.stringify({ artifact, sizeBytes: host.sizeBytes, sha256: createHash('sha256').update(host.bytes).digest('hex'), memoryBytes: exports.memory.buffer.byteLength, cases, result: 'pass', boundary: '最终正式Wasm独立输入及原固定样例；不代表管理HTTP数据库或浏览器Worker验收' }));
