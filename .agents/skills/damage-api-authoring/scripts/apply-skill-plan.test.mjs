import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCli, runSkillPlan, sameConfiguration, validatePlan } from './apply-skill-plan.mjs';

const TOKEN = 'independent-local-credential-not-for-evidence';
const ENV = { DAMAGE_AUTHORING_TOKEN: TOKEN };
const sha = data => createHash('sha256').update(data).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));

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
    for (const change of body.changes) {
      const index = state.triggerRules.findIndex(rule => rule.ruleKey === change.key);
      state.triggerRules[index] = { ruleKey: change.key, ...copy(change.value) };
    }
    state.baseDigest = 'b'.repeat(64);
    state.skill.updatedAt = '2026-10-17T01:00:00Z';
    state.parameters[0].updatedAt = '2026-10-17T01:00:00Z';
    return copy(state);
  };
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, `Bearer ${TOKEN}`);
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

async function evidenceContents(directory) {
  const pieces = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.resolve(directory, entry.name);
    if (entry.isDirectory()) pieces.push(...await evidenceContents(file));
    else pieces.push(await readFile(file, 'utf8'));
  }
  return pieces;
}

test('默认dry-run只读取；完整输入和证据落在新attempt目录，令牌不进入证据', async t => {
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
  for (const text of await evidenceContents(summary.attemptDir)) assert.ok(!text.includes(TOKEN));
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

test('明确4xx停批并留回读，响应反射令牌与headers不进入任何证据', async t => {
  const f = await fixture(t, { count: 2, patch({ reply }) { reply(400, { error: { code: '400.VALIDATION',
    message: `拒绝 Bearer ${TOKEN}`, details: { headers: { Authorization: `Bearer ${TOKEN}` }, adminToken: TOKEN } } }); } });
  const summary = await f.run({ apply: true });
  assert.equal(summary.passed, false);
  assert.equal(summary.items[0].status, 'blocked-http-rejection');
  assert.equal(summary.patchCount, 1);
  assert.deepEqual(f.calls, ['GET:sample_q', 'PATCH:sample_q', 'GET:sample_q']);
  for (const text of await evidenceContents(summary.attemptDir)) {
    assert.ok(!text.includes(TOKEN));
    assert.ok(!/"(?:headers|Authorization|adminToken)"/.test(text));
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
    headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(1000)
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
  ['未知写入根字段', plan => { plan.items[0].request.skill = { name: '夹带主体修改' }; }],
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

test('仅从环境读取令牌，危险基址和无来源计划在任何传输前被拒绝', async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.run({ env: {} }), /DAMAGE_AUTHORING_TOKEN/);
  await assert.rejects(() => f.run({ apiBase: 'http://user:pass@127.0.0.1:8080' }), /api-base/);
  assert.deepEqual(f.calls, []);
  const emptySource = copy(f.plan);
  emptySource.items[0].sourceEvidence = [];
  assert.throws(() => validatePlan(emptySource), /冻结来源/);
});
