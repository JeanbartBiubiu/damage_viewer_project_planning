import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCli, runSkillPlan, sameConfiguration, validatePlan, validateConfiguration } from './apply-skill-plan.mjs';

const SESSION = 'test_session_'.padEnd(43, 's');
const CSRF = 'test_csrf_'.padEnd(43, 'c');
const ORIGIN = 'https://authoring.example.invalid';
const COOKIE = `__Host-damage-maint-session=${SESSION}; __Host-damage-maint-csrf=${CSRF}`;
const BATCH = '0f053196-ddbb-4e83-9a77-818c51b21268';
const ENV = { DAMAGE_AUTHORING_SESSION: SESSION, DAMAGE_AUTHORING_CSRF: CSRF, DAMAGE_AUTHORING_ORIGIN: ORIGIN, DAMAGE_AUTHORING_BATCH: BATCH };
const READ_HEADERS = { Cookie: COOKIE, Origin: ORIGIN, 'X-Damage-Client': 'web' };
const sha = data => createHash('sha256').update(data).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const TYPES = { PARAMETER: ['parameters', 'parameterKey'], FORMULA: ['formulas', 'formulaKey'],
  EFFECT: ['effects', 'effectKey'], PROCESS: ['processes', 'processKey'],
  INTERNAL_STATE: ['internalStates', 'stateKey'], TRIGGER_RULE: ['triggerRules', 'ruleKey'] };

test('过程时点failureReason空值与服务端省略等价，其它业务空值与明确失败原因仍严格比较', () => {
  const expected = configuration();
  expected.processes[0].cooldown = { durationValue: { kind: 'FIXED', value: 1000 },
    startMoment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } };
  expected.processes[0].effectBindings = [{ bindingKey: 'hit', effectKey: 'hit', sortOrder: 0,
    moment: { momentType: 'STEP_EXECUTION', stepKey: 'actual', failureReason: null } }];
  expected.processes[0].stateOperations = [{ operationKey: 'count', stateSkillKey: 'sample_q', stateKey: 'stack',
    moment: { momentType: 'STEP_EXECUTION', stepKey: 'actual', failureReason: null } }];
  const wire = copy(expected);
  delete wire.processes[0].cooldown.startMoment.failureReason;
  delete wire.processes[0].effectBindings[0].moment.failureReason;
  delete wire.processes[0].stateOperations[0].moment.failureReason;
  assert.equal(sameConfiguration(expected, wire), true);
  const invalid = copy(wire);
  invalid.processes[0].cooldown.startMoment.failureReason = 'ACTIVE_CANCELLED';
  assert.equal(sameConfiguration(expected, invalid), false);
  const missingBusiness = copy(wire);
  delete missingBusiness.processes[0].cooldown.startMoment.stepKey;
  assert.equal(sameConfiguration(expected, missingBusiness), false);
  const nestedNull = copy(wire);
  nestedNull.effects[0].results[0].detail.failureReason = null;
  assert.equal(sameConfiguration(expected, nestedNull), false);
});

test('过程时点事件复用DTO的空失败原因可省略，明确值和其它事件明细保持严格', () => {
  const expected=configuration();
  expected.triggerRules[0].eventSource={eventType:'PROCESS_MOMENT',detail:{processKey:'cast',
    moment:{momentType:'PROCESS_COMPLETE',stepKey:null,failureReason:null}}};
  const actual=copy(expected);delete actual.triggerRules[0].eventSource.detail.moment.failureReason;
  assert.equal(sameConfiguration(expected,actual),true);
  const named=copy(actual);named.triggerRules[0].eventSource.detail.moment.failureReason='ACTIVE_CANCELLED';
  assert.equal(sameConfiguration(expected,named),false);
  const missingStep=copy(actual);delete missingStep.triggerRules[0].eventSource.detail.moment.stepKey;
  assert.equal(sameConfiguration(expected,missingStep),false);
  const extra=copy(actual);extra.triggerRules[0].eventSource.detail.failureReason=null;
  assert.equal(sameConfiguration(expected,extra),false);
  const otherEvent=copy(expected);otherEvent.triggerRules[0].eventSource.eventType='SKILL_USED';
  const otherMissing=copy(otherEvent);delete otherMissing.triggerRules[0].eventSource.detail.moment.failureReason;
  assert.equal(sameConfiguration(otherEvent,otherMissing),false);
});

function configuration(skillKey = 'sample_q') {
  const common = { gameId: 'demo', skillKey, name: '独立规则样例', description: null, sortOrder: 0,
    createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z' };
  return { baseDigest: 'a'.repeat(64), skill: { ...common, maxLevel: 5, status: 'ENABLED', skillCategoryKeys: ['active'] },
    parameters: [{ ...common, parameterKey: 'ap_ratio', valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: 0.85000002, levelValues: null }],
    formulas: [{ ...common, formulaKey: 'damage', expression: { inputs: [], stages: [], outputStageKey: 'output',
      updatedAt: 'a real authored JSON property, not server metadata' } }],
    effects: [{ ...common, effectKey: 'hit', lifecycle: null, results: [{ resultKey: 'damage', amount: 123, detail: { createdAt: 'business-data' } }] }],
    processes: [{ ...common, processKey: 'cast', activationType: 'ACTIVE', cooldown: null, steps: [], effectBindings: [], stateOperations: [] }],
    internalStates: [{ ...common, stateKey: 'stack', stateType: 'COUNTER', scope: 'SKILL', detail: { updatedAt: 'business-state', initialValue: 0 } }],
    triggerRules: [{ ruleKey: 'on_used', name: '主动入口', description: null, sortOrder: 1,
      eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: skillKey, useKind: 'ACTIVE' } }, conditionGroups: [],
      actions: [{ actionKey: 'start', name: '开始过程', actionType: 'START_PROCESS', detail: { processKey: 'cast' }, sortOrder: 1,
        targetContext: 'CURRENT_TARGET', runtimeInputBindings: [], resultModifiers: [] }],
      perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null }] };
}

async function fixture(t, { count = 1, patch, get } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'damage-api-plan-test-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}damage-api-plan-test-`));
    await rm(resolved, { recursive: true, force: true });
  });
  const source = path.resolve(directory, 'source.json');
  const sourceBytes = JSON.stringify({ origin: 'independent-test-source', claim: '明确普通主动首次入口' });
  await writeFile(source, sourceBytes);
  const items = Array.from({ length: count }, (_, index) => {
    const skillKey = index ? `sample_q_${index + 1}` : 'sample_q';
    const before = configuration(skillKey);
    const expected = copy(before);
    expected.triggerRules[0].eventSource.detail.castPhase = 'INITIAL';
    const { ruleKey, ...value } = expected.triggerRules[0];
    return { skillKey, before, expected, request: { baseDigest: before.baseDigest,
      changes: [{ objectType: 'TRIGGER_RULE', operation: 'UPDATE', key: ruleKey, value }] },
      sourceEvidence: [{ path: 'source.json', sha256: sha(sourceBytes), note: '独立来源，不是实库数据或作者证据' }] };
  });
  const plan = { schemaVersion: 'skill-configuration-plan-v1', gameId: 'demo', items };
  const current = new Map(items.map(item => [item.skillKey, copy(item.before)]));
  const calls = [];
  const requests = [];
  const getCount = new Map();
  const commit = (skillKey, body) => {
    const state = current.get(skillKey);
    if (body.skill) Object.assign(state.skill, copy(body.skill));
    for (const change of body.changes) {
      const [collection, key] = TYPES[change.objectType];
      const index = state[collection].findIndex(row => row[key] === change.key);
      if (change.operation === 'DELETE') { state[collection].splice(index, 1); continue; }
      const row = { ...(collection === 'triggerRules' ? {} : { gameId: 'demo', skillKey }),
        [key]: change.key, ...copy(change.value) };
      if (change.operation === 'CREATE') state[collection].push(row);
      else state[collection][index] = row;
    }
    for (const [collection, key] of Object.values(TYPES)) state[collection].sort((a, b) =>
      a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
    state.baseDigest = 'b'.repeat(64);
    state.skill.updatedAt = '2026-10-17T01:00:00Z';
    if (state.parameters[0]) state.parameters[0].updatedAt = '2026-10-17T01:00:00Z';
    return copy(state);
  };
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, COOKIE);
      assert.equal(req.headers.origin, ORIGIN);
      assert.equal(req.headers['x-damage-client'], 'web');
      if (req.method === 'PATCH') {
        assert.equal(req.headers['content-type'], 'application/json');
        assert.equal(req.headers['x-csrf-token'], CSRF);
        assert.equal(req.headers['x-damage-maintenance-batch'], BATCH);
      } else assert.equal(req.headers['x-csrf-token'], undefined);
      const match = /^\/api\/admin\/games\/demo\/skills\/([a-z][a-z0-9_]*)\/configuration$/.exec(req.url);
      assert.ok(match, 'only the fixed aggregate endpoint is allowed');
      const skillKey = match[1];
      calls.push(`${req.method}:${skillKey}`);
      const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.method === 'GET') {
        getCount.set(skillKey, (getCount.get(skillKey) ?? 0) + 1);
        return get ? get({ skillKey, sequence: getCount.get(skillKey), current, reply }) : reply(200, current.get(skillKey));
      }
      assert.equal(req.method, 'PATCH');
      let text = '';
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      requests.push({ skillKey, body });
      if (patch) return patch({ skillKey, body, current, reply, commit, res });
      reply(200, commit(skillKey, body));
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  const planPath = path.resolve(directory, 'plan.json');
  const outputDir = path.resolve(directory, 'evidence');
  const savePlan = async () => writeFile(planPath, JSON.stringify(plan));
  await savePlan();
  const run = async (options = {}) => { await savePlan(); return runSkillPlan({ apiBase, planPath, outputDir, env: ENV, ...options }); };
  return { directory, plan, current, calls, requests, commit, run, savePlan, planPath, outputDir, source, apiBase };
}

function subjectUpdate(item, description) {
  const fields = ['name', 'description', 'maxLevel', 'status', 'sortOrder', 'skillCategoryKeys'];
  item.request.skill = Object.fromEntries(fields.map(key => [key, copy(item.before.skill[key])]));
  item.request.skill.description = description;
  item.expected.skill.description = description;
}

test('普攻伤害角色保留真实字符串，普通伤害省略；空值、数字、未知和非伤害拒绝', () => {
  const source = configuration();
  const result = source.effects[0].results[0];
  result.resultType = 'DAMAGE';
  assert.doesNotThrow(() => validateConfiguration(source, 'demo', source.skill.skillKey));
  for (const role of ['PRIMARY', 'REPLACE_PRIMARY']) {
    result.detail.attackDamageRole = role;
    assert.doesNotThrow(() => validateConfiguration(source, 'demo', source.skill.skillKey));
    assert.equal(result.detail.attackDamageRole, role);
  }
  for (const role of [null, 0, 1, {}, [], true, 'primary', 'UNKNOWN']) {
    result.detail.attackDamageRole = role;
    assert.throws(() => validateConfiguration(source, 'demo', source.skill.skillKey), /attackDamageRole/);
  }
  result.detail.attackDamageRole = 'PRIMARY';
  result.resultType = 'HEALING';
  assert.throws(() => validateConfiguration(source, 'demo', source.skill.skillKey), /attackDamageRole/);
});

function withProcessTransportFields(configuration) {
  const process = configuration.processes[0];
  process.steps = ['first', 'second'].map((stepKey, sortOrder) => ({ stepKey, name: stepKey, description: null,
    sortOrder, stepType: 'IMMEDIATE', detail: {} }));
  process.effectBindings = ['first', 'second'].map((stepKey, sortOrder) => ({ bindingKey: stepKey, effectKey: 'hit', sortOrder,
    moment: { momentType: 'STEP_EXECUTION', stepKey, failureReason: null } }));
  process.stateOperations = [{ operationKey: 'count', name: '计数', stateSkillKey: configuration.skill.skillKey,
    stateKey: 'stack', operation: 'SET', value: { kind: 'FIXED', value: 0 }, optionKey: null, sortOrder: 0,
    moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } }];
  return configuration;
}
function processTransportRead(configuration) {
  const wire = copy(configuration);
  for (const process of wire.processes) {
    for (const step of process.steps) if (!own(step, 'occupiesAction')) step.occupiesAction = null;
    for (const row of [...process.effectBindings, ...process.stateOperations]) if (row.moment.failureReason === null) delete row.moment.failureReason;
  }
  return wire;
}

test('传输形状组合：两处步骤占用省略转null和三处失败原因null转省略须同义', () => {
  const expected = withProcessTransportFields(configuration());
  const wire = processTransportRead(expected);
  const original = copy(expected);
  assert.equal(sameConfiguration(expected, wire), true);
  assert.equal(sameConfiguration(wire, expected), true);
  assert.deepEqual(expected, original);
});

test('传输形状投影：同义空值expected必须通过完整PATCH投影校验', async t => {
  const f = await fixture(t);
  const item = f.plan.items[0];
  withProcessTransportFields(item.before);
  item.expected = processTransportRead(withProcessTransportFields(item.expected));
  assert.doesNotThrow(() => validatePlan(f.plan));
});

test('传输形状已落地：新摘要的同义完整回读只跳过，不能重放PATCH', async t => {
  const f = await fixture(t);
  const item = f.plan.items[0];
  withProcessTransportFields(item.before); withProcessTransportFields(item.expected);
  const landed = processTransportRead(item.expected); landed.baseDigest = 'c'.repeat(64);
  f.current.set(item.skillKey, landed);
  const result = await f.run({ apply: true });
  assert.equal(result.passed, true);
  assert.equal(result.items[0].status, 'skipped-already-applied');
  assert.equal(result.items[0].landed, true);
  assert.equal(result.patchCount, 0);
  assert.deepEqual(f.calls, ['GET:sample_q']);
  assert.equal(f.requests.length, 0);
});

test('同义before守护保留原请求和顺序，默认只读不会因步骤空值误报漂移', async t => {
  const f = await fixture(t);
  const item = f.plan.items[0];
  withProcessTransportFields(item.before); withProcessTransportFields(item.expected);
  f.current.set(item.skillKey, processTransportRead(item.before));
  const original = copy(f.plan);
  const result = await f.run();
  assert.equal(result.passed, true);
  assert.equal(result.items[0].status, 'dry-run-ready');
  assert.equal(result.patchCount, 0);
  assert.deepEqual(f.calls, ['GET:sample_q']);
  assert.deepEqual(f.plan, original);
});

test('过程UPDATE写入投影与expected复用同义比较，冻结请求不被补字段', async t => {
  const f = await fixture(t);
  const item = f.plan.items[0];
  withProcessTransportFields(item.before);
  item.expected = copy(item.before); item.expected.processes[0].name = '明确修订';
  const wire = processTransportRead(item.expected).processes[0];
  const value = Object.fromEntries(Object.entries(wire).filter(([key]) => !['gameId', 'skillKey', 'processKey', 'createdAt', 'updatedAt'].includes(key)));
  item.request.changes = [{ objectType: 'PROCESS', operation: 'UPDATE', key: wire.processKey, value }];
  const original = copy(f.plan);
  assert.doesNotThrow(() => validatePlan(f.plan));
  assert.deepEqual(f.plan, original);
});

test('明确占用布尔、非空失败原因、其它业务差异和未知字段不能被空值规范隐藏', () => {
  const expected = withProcessTransportFields(configuration());
  const cases = [
    ['占用false', value => { value.processes[0].steps[0].occupiesAction = false; }],
    ['占用true', value => { value.processes[0].steps[0].occupiesAction = true; }],
    ['占用非空错误类型', value => { value.processes[0].steps[0].occupiesAction = 0; }],
    ['效果失败原因', value => { value.processes[0].effectBindings[0].moment.failureReason = 'ACTIVE_CANCELLED'; }],
    ['状态失败原因', value => { value.processes[0].stateOperations[0].moment.failureReason = 'CONTROLLED'; }],
    ['其它业务数值', value => { value.parameters[0].fixedValue = 0.85; }],
    ['未知步骤字段', value => { value.processes[0].steps[0].unexpected = null; }],
    ['明细同名占用字段', value => { value.processes[0].steps[0].detail.occupiesAction = null; }],
    ['明细同名失败字段', value => { value.processes[0].steps[0].detail.failureReason = null; }],
    ['时点未知字段', value => { value.processes[0].stateOperations[0].moment.unexpected = null; }],
    ['步骤排序', value => { value.processes[0].steps.reverse(); }]
  ];
  for (const [label, mutate] of cases) {
    const wire = processTransportRead(expected); mutate(wire);
    assert.equal(sameConfiguration(expected, wire), false, label);
  }
  const explicitFalse = processTransportRead(expected); explicitFalse.processes[0].steps[0].occupiesAction = false;
  const explicitTrue = copy(explicitFalse); explicitTrue.processes[0].steps[0].occupiesAction = true;
  assert.equal(sameConfiguration(explicitFalse, explicitTrue), false);
});

test('投影与同义before守护仍拒绝明确业务和未知嵌套差异，不能写入', async t => {
  for (const mutate of [value => { value.processes[0].steps[0].occupiesAction = false; },
    value => { value.processes[0].effectBindings[0].moment.failureReason = 'ACTIVE_CANCELLED'; },
    value => { value.processes[0].steps[0].unexpected = null; }]) {
    const f = await fixture(t);
    const item = f.plan.items[0];
    withProcessTransportFields(item.before); withProcessTransportFields(item.expected);
    const invalidPlan = copy(f.plan); mutate(invalidPlan.items[0].expected);
    assert.throws(() => validatePlan(invalidPlan), /PATCH投影不一致/);
    const drifted = processTransportRead(item.before); mutate(drifted); f.current.set(item.skillKey, drifted);
    const result = await f.run();
    assert.equal(result.passed, false);
    assert.equal(result.items[0].status, 'blocked-drift');
    assert.equal(result.patchCount, 0);
    assert.deepEqual(f.calls, ['GET:sample_q']);
    assert.equal(f.requests.length, 0);
  }
});

test('完整主体与组成同一次摘要保护PATCH，独立回读并保留未改字段', async t => {
  const f = await fixture(t);
  subjectUpdate(f.plan.items[0], '最多储存4枚，修正资料说明');
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, true);
  assert.equal(summary.patchCount, 1);
  assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);
  assert.equal(f.current.get('sample_q').skill.description, '最多储存4枚，修正资料说明');
  assert.equal(f.current.get('sample_q').parameters[0].fixedValue, 0.85000002);
  assert.deepEqual(f.requests[0].body.skill, f.plan.items[0].request.skill);
  assert.equal((await f.run({ apply: true })).patchCount, 0);
});

test('仅修正主体可使用空组成列表，完整未改组成仍逐项回读', async t => {
  const f = await fixture(t);
  f.plan.items[0].expected = copy(f.plan.items[0].before);
  f.plan.items[0].request.changes = [];
  subjectUpdate(f.plan.items[0], '明确修正主体资料');
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, true);
  assert.equal(summary.patchCount, 1);
  assert.deepEqual(f.current.get('sample_q').processes, f.plan.items[0].before.processes);
});

for (const [name, mutate] of [
  ['主体身份只读', item => { item.request.skill.skillKey = item.skillKey; }],
  ['主体服务时间只读', item => { item.request.skill.updatedAt = 'untrusted'; }],
  ['主体缺分类字段', item => { delete item.request.skill.skillCategoryKeys; }],
  ['主体预期夹带最大等级', item => { item.expected.skill.maxLevel = 6; }]
]) test(`${name}在传输前拒绝，0读取0写入`, async t => {
  const f = await fixture(t);
  subjectUpdate(f.plan.items[0], '明确修正主体资料');
  mutate(f.plan.items[0]);
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, false);
  assert.equal(summary.patchCount, 0);
  assert.deepEqual(f.calls, []);
});

async function evidenceContents(directory) {
  const pieces = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.resolve(directory, entry.name);
    if (entry.isDirectory()) pieces.push(...await evidenceContents(file));
    else pieces.push(await readFile(file, 'utf8'));
  }
  return pieces;
}

test('默认dry-run只读取；完整输入和证据落在新attempt目录，会话与防伪值不进入证据', async t => {
  const f = await fixture(t);
  const summary = await f.run();
  assert.equal(summary.passed, true);
  assert.equal(summary.mode, 'dry-run');
  assert.equal(summary.timeoutMs, 60000);
  assert.equal(summary.patchCount, 0);
  assert.equal(summary.items[0].status, 'dry-run-ready');
  assert.deepEqual(f.calls, ['GET:sample_q']);
  assert.deepEqual(f.requests, []);
  assert.equal(JSON.parse(await readFile(path.resolve(summary.attemptDir, '0001-sample_q/request.json'), 'utf8')).baseDigest, f.plan.items[0].before.baseDigest);
  for (const text of await evidenceContents(summary.attemptDir)) {
    assert.ok(!text.includes(SESSION));
    assert.ok(!text.includes(CSRF));
  }
  const second = await f.run();
  assert.notEqual(second.attemptDir, summary.attemptDir);
  assert.equal(await readFile(path.resolve(summary.attemptDir, 'summary.json'), 'utf8'), `${JSON.stringify(summary, null, 2)}\n`);
});

test('成功只PATCH一次，独立GET确认整个expected，不变字段和原AP比例保持；重跑跳过', async t => {
  const f = await fixture(t);
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, true);
  assert.equal(summary.items[0].status, 'applied');
  assert.equal(summary.patchCount, 1);
  assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);
  const current = f.current.get('sample_q');
  assert.equal(current.parameters[0].fixedValue, 0.85000002);
  assert.deepEqual(current.processes, f.plan.items[0].before.processes);
  assert.deepEqual(current.effects, f.plan.items[0].before.effects);
  assert.equal(sameConfiguration(current, f.plan.items[0].expected), true);
  assert.equal(own(f.requests[0].body.changes[0].value, 'ruleKey'), false);
  const rerun = await f.run({ apply: true });
  assert.equal(rerun.passed, true);
  assert.equal(rerun.items[0].status, 'skipped-already-applied');
  assert.equal(rerun.patchCount, 0);
  assert.equal(f.requests.length, 1);
});
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function allObjectChanges(item) {
  item.request.changes = [];
  item.expected = copy(item.before);
  for (const [type, [collection, key]] of Object.entries(TYPES)) {
    const original = item.before[collection][0];
    const { gameId: _game, skillKey: _skill, createdAt: _created, updatedAt: _updated, ...created } = copy(original);
    created[key] = 'aaa_new_entry';
    const { [key]: _key, ...updated } = copy(created);
    updated.name = '原对象明确修改';
    item.request.changes.push({ objectType: type, operation: 'UPDATE', key: original[key], value: updated });
    item.request.changes.push({ objectType: type, operation: 'CREATE', key: created[key], value: created });
    item.expected[collection] = [{ ...original, ...copy(updated) },
      { ...(collection === 'triggerRules' ? {} : { gameId: item.before.skill.gameId, skillKey: item.skillKey }), ...copy(created) }];
    item.expected[collection].sort((a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
  }
}

test('六种组成的新增与修改同一摘要保护PATCH，完整独立回读并可跳过重跑', async t => {
  const f = await fixture(t);
  allObjectChanges(f.plan.items[0]);
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, true, JSON.stringify(summary.error));
  assert.equal(summary.patchCount, 1);
  assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);
  assert.equal(f.requests[0].body.changes.length, 12);
  assert.equal(sameConfiguration(f.current.get('sample_q'), f.plan.items[0].expected), true);
  const rerun = await f.run({ apply: true });
  assert.equal(rerun.passed, true);
  assert.equal(rerun.patchCount, 0);
  assert.equal(f.requests.length, 1);
});

function allObjectDeletes(item) {
  item.request.changes = [];
  item.expected = copy(item.before);
  for (const [objectType, [collection, keyField]] of Object.entries(TYPES)) {
    item.request.changes.push({ objectType, operation: 'DELETE', key: item.before[collection][0][keyField], value: null });
    item.expected[collection] = [];
  }
}

test('六种组成删除采用同一次保护保存和完整回读，结果已落地时跳过重放', async t => {
  const f = await fixture(t);
  allObjectDeletes(f.plan.items[0]);
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, true, JSON.stringify(summary.error));
  assert.equal(summary.patchCount, 1);
  assert.equal(f.requests[0].body.changes.length, 6);
  assert.equal(sameConfiguration(f.current.get('sample_q'), f.plan.items[0].expected), true);
  const repeated = await f.run({ apply: true });
  assert.equal(repeated.passed, true);
  assert.equal(repeated.patchCount, 0);
  assert.equal(f.requests.length, 1);
});

test('删除保存响应不明先独立回读确认，不重放DELETE', async t => {
  const f = await fixture(t, { patch({ skillKey, body, commit, res }) { commit(skillKey, body); res.destroy(); } });
  allObjectDeletes(f.plan.items[0]);
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, true, JSON.stringify(summary.error));
  assert.equal(summary.items[0].status, 'applied-confirmed-after-uncertain');
  assert.equal(f.requests.length, 1);
});

for (const [name, mutate] of [
  ['DELETE不存在', item => { item.request.changes[0].key = 'missing_key'; }],
  ['DELETE夹带对象', item => { item.request.changes[0].value = {}; }],
  ['DELETE缺失value', item => { delete item.request.changes[0].value; }],
  ['DELETE重复对象', item => { item.request.changes.push(copy(item.request.changes[0])); }],
  ['DELETE预期未移除', item => { item.expected.effects = copy(item.before.effects); }],
  ['DELETE预期额外丢失', item => { item.expected.skill.description = '未声明修改'; }]
]) test(`${name}在任何读取或写入前拒绝`, async t => {
  const f = await fixture(t);
  allObjectDeletes(f.plan.items[0]);
  mutate(f.plan.items[0]);
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.requests.length, 0);
});

test('新组成保存结果不明也只回读，不重放CREATE', async t => {
  const f = await fixture(t, { patch({ skillKey, body, commit, res }) { commit(skillKey, body); res.destroy(); } });
  allObjectChanges(f.plan.items[0]);
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, true);
  assert.equal(summary.items[0].status, 'applied-confirmed-after-uncertain');
  assert.equal(f.requests.length, 1);
});

for (const [name, mutate] of [
  ['CREATE已存在', item => { item.request.changes[1].key = item.before.parameters[0].parameterKey; }],
  ['CREATE值键不匹配', item => { item.request.changes[1].value.parameterKey = 'different_key'; }],
  ['UPDATE不存在', item => { item.request.changes[0].key = 'missing_key'; }],
  ['只读字段夹带', item => { item.request.changes[3].value.gameId = 'other'; }],
  ['缺完整组成字段', item => { delete item.request.changes[4].value.lifecycle; }]
]) test(`${name}在首次传输前拒绝`, async t => {
  const f = await fixture(t);
  allObjectChanges(f.plan.items[0]);
  mutate(f.plan.items[0]);
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, false);
  assert.equal(summary.patchCount, 0);
  assert.deepEqual(f.calls, []);
});

test('基线摘要漂移即停止，0PATCH且保留实际GET', async t => {
  const f = await fixture(t);
  f.current.get('sample_q').baseDigest = 'c'.repeat(64);
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, false);
  assert.equal(summary.items[0].status, 'blocked-drift');
  assert.equal(summary.patchCount, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(JSON.parse(await readFile(path.resolve(summary.attemptDir, '0001-sample_q/before.json'), 'utf8')).baseDigest, 'c'.repeat(64));
});

test('摘要未变也比较完整业务；嵌套createdAt/updatedAt不当成服务时间忽略', async t => {
  const f = await fixture(t);
  f.current.get('sample_q').formulas[0].expression.updatedAt = 'changed authored JSON';
  f.current.get('sample_q').effects[0].results[0].detail.createdAt = 'changed business data';
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, false);
  assert.equal(summary.items[0].status, 'blocked-drift');
  assert.equal(f.requests.length, 0);
  const onlyMetadata = copy(f.plan.items[0].before);
  onlyMetadata.baseDigest = 'd'.repeat(64);
  onlyMetadata.skill.updatedAt = 'new time';
  onlyMetadata.parameters[0].createdAt = 'new service time';
  assert.equal(sameConfiguration(onlyMetadata, f.plan.items[0].before), true);
});

test('写响应丢失后只独立GET，已落地即确认成功，无重发', async t => {
  const f = await fixture(t, { patch({ skillKey, body, commit, res }) { commit(skillKey, body); res.destroy(); } });
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, true);
  assert.equal(summary.patchCount, 1);
  assert.equal(summary.items[0].status, 'applied-confirmed-after-uncertain');
  assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);
  assert.equal(f.requests.length, 1);
});

test('500已提交靠独立GET确认；500未提交则停批，不向后续对象写入', async t => {
  const applied = await fixture(t, { patch({ skillKey, body, commit, reply }) { commit(skillKey, body); reply(500, { error: { code: '500.AFTER_COMMIT' } }); } });
  const recovered = await applied.run({ apply: true });
  assert.equal(recovered.passed, true);
  assert.equal(recovered.items[0].status, 'applied-confirmed-after-uncertain');
  assert.equal(applied.requests.length, 1);
  const failed = await fixture(t, { count: 2, patch({ reply }) { reply(500, { error: { code: '500.NO_COMMIT' } }); } });
  const stopped = await failed.run({ apply: true });
  assert.equal(stopped.passed, false);
  assert.equal(stopped.items[0].status, 'blocked-unconfirmed');
  assert.equal(stopped.items.length, 2);
  assert.equal(stopped.items[1].status, 'not-attempted');
  assert.equal(JSON.parse(await readFile(path.resolve(stopped.attemptDir, '0002-sample_q_2/status.json'), 'utf8')).status, 'not-attempted');
  assert.deepEqual(failed.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);
});

test('明确4xx停批并留回读，响应反射会话与防伪值不进入任何证据', async t => {
  const f = await fixture(t, { count: 2, patch({ reply }) { reply(400, { error: { code: '400.VALIDATION',
    message: `拒绝 ${COOKIE} X-CSRF-Token=${CSRF}`, details: { headers: { Cookie: COOKIE },
      sessionCookie: SESSION, csrfToken: CSRF, DAMAGE_AUTHORING_SESSION: SESSION, DAMAGE_AUTHORING_CSRF: CSRF } } }); } });
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, false);
  assert.equal(summary.items[0].status, 'blocked-http-rejection');
  assert.equal(summary.patchCount, 1);
  assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);
  for (const text of await evidenceContents(summary.attemptDir)) {
    assert.ok(!text.includes(SESSION));
    assert.ok(!text.includes(CSRF));
    assert.ok(!/"(?:headers|sessionCookie|csrfToken|DAMAGE_AUTHORING_SESSION|DAMAGE_AUTHORING_CSRF)"/.test(text));
  }
});

test('PATCH响应体超时只GET恢复；未提交时停批，已提交时确认，两个分支都不重发', async t => {
  for (const committed of [false, true]) {
    const f = await fixture(t, { patch({ skillKey, body, commit, res }) {
      if (committed) commit(skillKey, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      // 响应体永不结束，触发真正的AbortSignal超时；不伪造恢复GET。
    } });
    const summary = await f.run({ apply: true, timeoutMs: 200 });
    assert.equal(summary.passed, committed);
    assert.equal(summary.items[0].status, committed ? 'applied-confirmed-after-uncertain' : 'blocked-unconfirmed');
    assert.equal(summary.patchCount, 1);
    assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);
  }
});

test('超时回读旧值即停；迟提交经调用方独立回读后，显式重跑只跳过且累计仅一次PATCH', async t => {
  let lateCommit;
  const f = await fixture(t, { patch({ skillKey, body, commit, res }) {
    lateCommit = () => commit(skillKey, body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.flushHeaders();
    // 服务端操作尚未提交，响应体也不结束；第一次恢复GET只能看到旧配置。
  } });
  const stopped = await f.run({ apply: true, timeoutMs: 200 });
  assert.equal(stopped.passed, false);
  assert.equal(stopped.items[0].status, 'blocked-unconfirmed');
  assert.equal(stopped.items[0].landed, false);
  assert.equal(stopped.patchCount, 1);
  assert.equal(sameConfiguration(f.current.get('sample_q'), f.plan.items[0].before), true);
  assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);

  // 这是调用方确认迟提交之后的新一次调用；脚本自身没有等待、循环或重放写入。
  lateCommit();
  const readback = await fetch(`${f.apiBase}/api/admin/games/demo/skills/sample_q/configuration`, {
    headers: READ_HEADERS, signal: AbortSignal.timeout(1000)
  });
  assert.equal(readback.status, 200);
  const independentlyRead = await readback.json();
  assert.equal(sameConfiguration(independentlyRead, f.plan.items[0].expected), true);
  await writeFile(path.resolve(stopped.attemptDir, 'late-independent-readback.json'), JSON.stringify(independentlyRead));
  const rerun = await f.run({ apply: true });
  assert.equal(rerun.passed, true);
  assert.equal(rerun.items[0].status, 'skipped-already-applied');
  assert.equal(rerun.patchCount, 0);
  assert.notEqual(rerun.attemptDir, stopped.attemptDir);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q', 'GET:sample_q', 'GET:sample_q']);
  assert.equal(JSON.parse(await readFile(path.resolve(stopped.attemptDir, 'summary.json'), 'utf8')).items[0].status, 'blocked-unconfirmed');
});

test('CLI超时默认60秒，接受边界和显式值，拒绝越界、小数、指数、缺值与重复参数', () => {
  const required = ['--api-base', 'http://127.0.0.1:8080', '--plan', 'plan.json', '--output-dir', 'evidence'];
  assert.equal(parseCli(required).timeoutMs, 60000);
  for (const value of ['1000', '90000', '300000']) {
    const parsed = parseCli([...required, '--timeout-ms', value, '--apply']);
    assert.equal(parsed.timeoutMs, Number(value));
    assert.equal(parsed.apply, true);
  }
  for (const value of ['999', '300001', '9007199254740992', '1000.5', '-1000', '1e3', 'NaN', '']) {
    assert.throws(() => parseCli([...required, '--timeout-ms', value]), /args/);
  }
  assert.throws(() => parseCli([...required, '--timeout-ms']), /args/);
  assert.throws(() => parseCli([...required, '--timeout-ms', '1000', '--timeout-ms', '2000']), /args/);
});

test('PATCH成功响应异常也要独立回读并停批，不能让异常契约蒙混通过', async t => {
  const f = await fixture(t, { count: 2, patch({ skillKey, body, commit, reply }) { commit(skillKey, body); reply(200, { ok: true }); } });
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, false);
  assert.equal(summary.items[0].landed, true);
  assert.equal(summary.items[0].status, 'blocked-response-contract');
  assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);
});

for (const [name, mutate] of [
  ['不完整主体修改', plan => { plan.items[0].request.skill = { name: '夹带主体修改' }; }],
  ['未知写入根字段', plan => { plan.items[0].request.unexpected = {}; }],
  ['UPDATE值携带ruleKey', plan => { plan.items[0].request.changes[0].value.ruleKey = 'on_used'; }],
  ['DELETE不支持', plan => { plan.items[0].request.changes[0].operation = 'DELETE'; }],
  ['expected夹带参数改动', plan => { plan.items[0].expected.parameters[0].fixedValue = 0.85; }],
  ['重复技能', plan => { plan.items.push(copy(plan.items[0])); }],
  ['重复规则', plan => { plan.items[0].request.changes.push(copy(plan.items[0].request.changes[0])); }],
  ['伪造基线摘要', plan => { plan.items[0].request.baseDigest = 'f'.repeat(64); }],
  ['缺少完整组成', plan => { delete plan.items[0].before.processes; }],
  ['URL路径逃逸键', plan => { plan.items[0].skillKey = '../other'; }],
  ['来源摘要不符', plan => { plan.items[0].sourceEvidence[0].sha256 = '0'.repeat(64); }]
]) test(`${name}：整批静态核对失败，0读取0写入`, async t => {
  const f = await fixture(t);
  mutate(f.plan);
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, false);
  assert.equal(summary.patchCount, 0);
  assert.deepEqual(f.calls, []);
});

test('第二对象来源异常也在首次PATCH前被发现', async t => {
  const f = await fixture(t, { count: 2 });
  f.plan.items[1].sourceEvidence[0].path = 'missing-source.json';
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, false);
  assert.equal(summary.patchCount, 0);
  assert.deepEqual(f.calls, []);
});

test('完整GET出现额外根字段或缺字段会阻断；不拿部分对象作比较', async t => {
  const f = await fixture(t, { get({ current, skillKey, reply }) { reply(200, { ...current.get(skillKey), extraResponse: true }); } });
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, false);
  assert.equal(summary.items[0].status, 'blocked-read');
  assert.equal(f.requests.length, 0);
});

test('回读失败时只有一次PATCH，保留不确定结果并停批', async t => {
  const f = await fixture(t, { count: 2, get({ current, skillKey, sequence, reply }) {
    return sequence > 1 ? reply(503, { error: { code: '503.READBACK' } }) : reply(200, current.get(skillKey));
  } });
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, false);
  assert.equal(summary.items[0].status, 'blocked-readback');
  assert.equal(summary.patchCount, 1);
  assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);
});

test('仅从环境读取会话，危险基址和无来源计划在任何传输前被拒绝', async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.run({ env: {} }), /DAMAGE_AUTHORING_SESSION/);
  await assert.rejects(() => f.run({ apiBase: 'http://user:pass@127.0.0.1:8080' }), /api-base/);
  assert.deepEqual(f.calls, []);
  const emptySource = copy(f.plan);
  emptySource.items[0].sourceEvidence = [];
  assert.throws(() => validatePlan(emptySource), /冻结来源/);
});

test('缺少或非法会话、防伪值与来源在创建证据和传输前拒绝，旧令牌不能替代', async t => {
  const f = await fixture(t);
  const invalid = [
    {}, { DAMAGE_AUTHORING_TOKEN: 'obsolete-test-value' },
    { ...ENV, DAMAGE_AUTHORING_SESSION: undefined }, { ...ENV, DAMAGE_AUTHORING_SESSION: 'short' },
    { ...ENV, DAMAGE_AUTHORING_SESSION: `${SESSION}\r\nX-Injected: value` },
    { ...ENV, DAMAGE_AUTHORING_CSRF: undefined }, { ...ENV, DAMAGE_AUTHORING_CSRF: 'invalid value' },
    { ...ENV, DAMAGE_AUTHORING_ORIGIN: undefined },
    ...['null', 'file:///tmp/test', 'http:example.invalid', 'https://user:pass@example.invalid',
      'https://example.invalid/path', 'https://example.invalid/path/..', 'https://example.invalid?query',
      'https://example.invalid?', 'https://example.invalid#fragment', 'https://example.invalid#',
      ' https://example.invalid', 'https://example.invalid\r\nX-Injected: value'].map(origin => ({ ...ENV, DAMAGE_AUTHORING_ORIGIN: origin }))
  ];
  for (const env of invalid) await assert.rejects(() => f.run({ env }), /DAMAGE_AUTHORING_(?:SESSION|CSRF|ORIGIN)/);
  assert.deepEqual(f.calls, []);
  await assert.rejects(() => readdir(f.outputDir), { code: 'ENOENT' });
});

test('合法来源只保留规范化来源地址', async t => {
  const f = await fixture(t);
  const summary = await f.run({ env: { ...ENV, DAMAGE_AUTHORING_ORIGIN: `${ORIGIN}/` }, apply: true });
  assert.equal(summary.passed, true);
  assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);
});

test('维护会话过期或维护批次被拒绝时只尝试一次写入，独立回读后停批', async t => {
  for (const status of [401, 403]) {
    const f = await fixture(t, { count: 2, patch({ reply }) { reply(status, { error: { code: `AUTH.${status}` } }); } });
    const summary = await f.run({ apply: true });
    assert.equal(summary.passed, false);
    assert.equal(summary.items[0].status, 'blocked-http-rejection');
    assert.equal(summary.items[1].status, 'not-attempted');
    assert.equal(summary.patchCount, 1);
    assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);
  }
});

test('正式写入缺少有效维护批次时在请求前拒绝', async t => {
  const f = await fixture(t);
  for (const batch of [undefined, '', 'not-a-batch']) {
    await assert.rejects(() => f.run({ env: { ...ENV, DAMAGE_AUTHORING_BATCH: batch }, apply: true }), /DAMAGE_AUTHORING_BATCH/);
  }
  assert.deepEqual(f.calls, []);
});

test('传输异常反射两个凭据时摘要与证据都不包含秘密值', async t => {
  const f = await fixture(t);
  const summary = await f.run({ fetchImpl: async () => { throw new Error(`transport ${SESSION} ${CSRF}`); } });
  assert.equal(summary.passed, false);
  assert.equal(summary.patchCount, 0);
  for (const text of [JSON.stringify(summary), ...await evidenceContents(summary.attemptDir)]) {
    assert.ok(!text.includes(SESSION));
    assert.ok(!text.includes(CSRF));
  }
});
