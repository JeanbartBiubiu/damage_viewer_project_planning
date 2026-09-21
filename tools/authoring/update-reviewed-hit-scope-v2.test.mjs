import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tool = 'tools/authoring/update-reviewed-hit-scope-v2.mjs';
const toolPath = path.join(web, tool);
const root = '/skills/scope_test';
const detailRoute = root + '/trigger-rules/actual_hit';
const groups = [{ groupKey: 'champion_target', name: '本轮敌方英雄', sortOrder: 10, conditions: [
  { conditionKey: 'champion_target', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 10, detail: { categories: ['CHAMPION'] } },
  { conditionKey: 'enemy_target', conditionType: 'SKILL_HIT_TARGET_IS_ENEMY', sortOrder: 20, detail: {} }
] }];
const heroGroups = [{ groupKey: 'original_champions', name: '原来的英雄范围', sortOrder: 37, conditions: [
  { conditionKey: 'original_category', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 43,
    detail: { categories: ['CHAMPION'] } }
] }];
const appendEnemy = original => {
  const result = structuredClone(original);
  result[0].conditions.push({ conditionKey: 'enemy_target', conditionType: 'SKILL_HIT_TARGET_IS_ENEMY',
    sortOrder: result[0].conditions[0].sortOrder + 10, detail: {} });
  return result;
};
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let importSequence = 0;

async function fixture(run) {
  const prefix = path.join(web, '数据参考', '.scope-tool-v2-test-');
  const dir = fs.mkdtempSync(prefix);
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value) + '\n');
  fs.writeFileSync(path.join(dir, 'source.txt'), '固定测试资料，不访问业务服务\n');
  const rule = { ruleKey: 'actual_hit', name: '实际命中', description: null, sortOrder: 10,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'scope_test', useKind: null } },
    conditionGroups: [], actions: [{ actionKey: 'damage', name: '伤害', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
      targetContext: 'CURRENT_TARGET', detail: { effectKey: 'damage' }, runtimeInputBindings: [], resultModifiers: [] }],
    perTargetCooldown: null, maxTriggersPerProcess: null };
  const state = { rule, status: 'ENABLED', puts: 0, malformedPutResponse: false,
    lostPutResponse: false, requests: [], extraValues: {}, approvedSha: undefined };
  const summary = () => ({ ruleKey: rule.ruleKey, name: rule.name, description: rule.description,
    sortOrder: rule.sortOrder, eventType: rule.eventSource.eventType, conditionGroupCount: rule.conditionGroups.length,
    actionCount: rule.actions.length, perTargetCooldownEnabled: rule.perTargetCooldown !== null,
    maxTriggersPerProcessEnabled: rule.maxTriggersPerProcess !== null,
    updatedAt: state.puts ? '2026-09-21T01:00:01Z' : '2026-09-21T01:00:00Z' });
  save('01-候选方案.json', { executionMode: 'REVIEWED_API', skillKey: 'scope_test', ruleKey: 'actual_hit',
    conditionGroups: groups, sourceFiles: [{ root: 'web', path: path.relative(web, path.join(dir, 'source.txt')),
      sha256: hash(path.join(dir, 'source.txt')) }] });
  async function invoke(mode) {
    const saved = { argv: process.argv, fetch: globalThis.fetch, log: console.log,
      approved: process.env.DAMAGE_APPROVED_BATCH_SHA };
    const output = [];
    try {
      process.argv = [process.execPath, toolPath, mode, dir];
      console.log = line => output.push(line);
      globalThis.fetch = async (url, options) => {
        const parsed = new URL(url);
        assert.equal(parsed.origin, 'http://127.0.0.1:8080');
        const route = parsed.pathname.replace('/api/admin/games/lol', '');
        state.requests.push({ method: options.method, route });
        assert.equal(options.redirect, 'error');
        if (options.method === 'PUT') {
          assert.equal(route, detailRoute);
          state.puts++;
          const body = JSON.parse(options.body);
          assert.deepEqual({ ...body, conditionGroups: structuredClone(rule.conditionGroups) }, (() => {
            const { ruleKey, ...old } = structuredClone(rule);
            delete old.eventSource.detail.useKind;
            return old;
          })());
          rule.conditionGroups = structuredClone(body.conditionGroups);
          if (state.lostPutResponse) throw new Error('模拟保存后连接断开');
          if (state.malformedPutResponse) return new Response('broken', { status: 200 });
          return Response.json(rule);
        }
        assert.equal(options.method, 'GET', '测试禁止其他写入');
        if (route === root) return Response.json({ skillKey: 'scope_test', status: state.status });
        if (route === detailRoute) return Response.json(rule);
        if (route === root + '/trigger-rules') return Response.json([summary()]);
        if (Object.hasOwn(state.extraValues, route)) return Response.json(state.extraValues[route]);
        assert(['parameters', 'formulas', 'effects', 'processes', 'internal-states'].some(kind => route === root + '/' + kind));
        return Response.json([]);
      };
      if (fs.existsSync(path.join(dir, '02-冻结请求.json'))) process.env.DAMAGE_APPROVED_BATCH_SHA =
        state.approvedSha ?? hash(path.join(dir, '02-冻结请求.json'));
      await import(pathToFileURL(toolPath).href + '?test=' + (++importSequence));
      return output.map(line => JSON.parse(line));
    } finally {
      process.argv = saved.argv;
      globalThis.fetch = saved.fetch;
      console.log = saved.log;
      if (saved.approved === undefined) delete process.env.DAMAGE_APPROVED_BATCH_SHA;
      else process.env.DAMAGE_APPROVED_BATCH_SHA = saved.approved;
    }
  }
  function approve() {
    const required = [tool, '01-候选方案.json', '02-冻结请求.json', '03-来源摘要.json', '04-写入前现值.json'];
    save('05-独立评审.json', { status: 'APPROVED', approvedFiles: Object.fromEntries(
      required.map(name => [name, hash(name === tool ? toolPath : path.join(dir, name))])) });
  }
  try { await run({ state, invoke, approve, read, save, dir }); }
  finally {
    const resolved = path.resolve(dir);
    assert(resolved.startsWith(prefix) && path.dirname(resolved) === path.dirname(prefix));
    fs.rmSync(resolved, { recursive: true });
  }
}

test('无批准或冻结文件漂移时不发送PUT', () => fixture(async f => {
  await f.invoke('prepare');
  await assert.rejects(f.invoke('write'));
  f.approve();
  const frozen = f.read('02-冻结请求.json');
  frozen.request.body.name = '未经批准变化';
  f.save('02-冻结请求.json', frozen);
  await assert.rejects(f.invoke('write'));
  assert.equal(f.state.puts, 0);
}));

test('保护现值漂移时不建立写入记录、不发送PUT', () => fixture(async f => {
  await f.invoke('prepare'); f.approve();
  f.state.rule.description = '其他作者的新说明';
  await assert.rejects(f.invoke('write'));
  assert.equal(f.state.puts, 0);
  assert.equal(fs.existsSync(path.join(f.dir, '06-写入与即时回读.json')), false);
}));

test('现值未变但已有写入尝试记录时也拒绝重放', () => fixture(async f => {
  await f.invoke('prepare'); f.approve();
  f.save('06-写入与即时回读.json', { status: 'ATTEMPT_STARTED' });
  await assert.rejects(f.invoke('write'));
  assert.equal(f.state.puts, 0);
  assert.deepEqual(f.read('06-写入与即时回读.json'), { status: 'ATTEMPT_STARTED' });
}));

test('仅一次PUT修改条件、完整回读通过且再次执行拒绝重放', () => fixture(async f => {
  await f.invoke('prepare'); f.approve();
  assert.equal((await f.invoke('preflight'))[0].businessWrites, 0);
  assert(f.state.requests.every(row => row.method === 'GET'));
  assert.equal((await f.invoke('write'))[0].status, 'PASS');
  assert.equal(f.state.puts, 1);
  assert.deepEqual(f.state.rule.conditionGroups, groups);
  const report = (await f.invoke('readback'))[0];
  assert.equal(report.status, 'PASS');
  assert.equal(report.GETs, 8);
  assert.equal(report.unchangedResponsesIncludingTimestamps, 6);
  await assert.rejects(f.invoke('write'));
  assert.equal(f.state.puts, 1);
}));

test('单一英雄组保留组名、标识、排序、原条件以及规则全部其他字段', () => fixture(async f => {
  f.state.rule.conditionGroups = structuredClone(heroGroups);
  f.state.rule.name = '已有命中入口';
  f.state.rule.description = '原说明不得变化';
  f.state.rule.sortOrder = 45;
  f.state.rule.perTargetCooldown = { durationParameterKey: 'cooldown' };
  f.state.rule.maxTriggersPerProcess = { maxTriggers: 3 };
  const original = structuredClone(f.state.rule);
  const plan = f.read('01-候选方案.json');
  plan.conditionGroups = appendEnemy(heroGroups); f.save('01-候选方案.json', plan);
  await f.invoke('prepare'); f.approve();
  const frozen = f.read('02-冻结请求.json');
  assert.deepEqual(frozen.request.expectedReadback, { ...original, conditionGroups: appendEnemy(heroGroups) });
  assert.deepEqual(frozen.request.body.conditionGroups[0].conditions[0], original.conditionGroups[0].conditions[0]);
  assert.equal((await f.invoke('preflight'))[0].status, 'PASS');
  assert(f.state.requests.every(row => row.method === 'GET'));
  assert.equal((await f.invoke('write'))[0].status, 'PASS');
  assert.deepEqual(f.state.rule, { ...original, conditionGroups: appendEnemy(heroGroups) });
  assert.equal(f.read('04-写入前现值.json').values[root + '/trigger-rules'][0].conditionGroupCount, 1);
  assert.equal((await f.invoke('readback'))[0].status, 'PASS');
  assert.equal(f.state.puts, 1);
}));

const unsafeGroups = [
  ['多组', [heroGroups[0], { ...heroGroups[0], groupKey: 'another_group' }]],
  ['重复组标识', [heroGroups[0], heroGroups[0]]],
  ['已有敌方条件', appendEnemy(heroGroups)],
  ['空条件组', [{ ...heroGroups[0], conditions: [] }]],
  ['其他条件', [{ ...heroGroups[0], conditions: [{ ...heroGroups[0].conditions[0], conditionType: 'SKILL_HIT_TARGET_IS_ENEMY', detail: {} }] }]],
  ['重复条件标识', [{ ...heroGroups[0], conditions: [heroGroups[0].conditions[0], heroGroups[0].conditions[0]] }]],
  ['英雄以外的筛选', [{ ...heroGroups[0], conditions: [{ ...heroGroups[0].conditions[0], detail: { categories: ['CHAMPION', 'MINION'] } }] }]],
  ['条件标识碰撞', [{ ...heroGroups[0], conditions: [{ ...heroGroups[0].conditions[0], conditionKey: 'enemy_target' }] }]],
  ['无效组标识', [{ ...heroGroups[0], groupKey: 'invalid key' }]],
  ['无效条件标识', [{ ...heroGroups[0], conditions: [{ ...heroGroups[0].conditions[0], conditionKey: 'invalid key' }] }]],
  ['非整数排序', [{ ...heroGroups[0], conditions: [{ ...heroGroups[0].conditions[0], sortOrder: 1.5 }] }]],
  ['排序溢出', [{ ...heroGroups[0], conditions: [{ ...heroGroups[0].conditions[0], sortOrder: Number.MAX_SAFE_INTEGER }] }]]
];
for (const [name, original] of unsafeGroups) test(name + '在冻结前拒绝', () => fixture(async f => {
  f.state.rule.conditionGroups = structuredClone(original);
  const plan = f.read('01-候选方案.json');
  plan.conditionGroups = structuredClone(original); f.save('01-候选方案.json', plan);
  await assert.rejects(f.invoke('prepare'));
  assert.equal(f.state.puts, 0);
  assert(f.state.requests.every(row => row.method === 'GET'));
  assert.equal(fs.existsSync(path.join(f.dir, '02-冻结请求.json')), false);
}));

test('计划不能更名、重排或替换已有英雄组和原条件', () => fixture(async f => {
  f.state.rule.conditionGroups = structuredClone(heroGroups);
  const plan = f.read('01-候选方案.json');
  for (const change of [
    group => { group.name = '新名称'; },
    group => { group.groupKey = 'replacement_group'; },
    group => { group.sortOrder = 10; },
    group => { group.conditions[0].conditionKey = 'replacement_condition'; },
    group => { group.conditions[0].detail.categories = ['MINION']; },
    group => { group.conditions[1].detail = { extra: true }; }
  ]) {
    plan.conditionGroups = appendEnemy(heroGroups); change(plan.conditionGroups[0]);
    f.save('01-候选方案.json', plan);
    await assert.rejects(f.invoke('prepare'), /方案必须完整保留/);
  }
  assert.equal(f.state.puts, 0);
  assert.equal(fs.existsSync(path.join(f.dir, '02-冻结请求.json')), false);
}));

test('英雄条件冻结后发生同组漂移时写入前拒绝', () => fixture(async f => {
  f.state.rule.conditionGroups = structuredClone(heroGroups);
  const plan = f.read('01-候选方案.json');
  plan.conditionGroups = appendEnemy(heroGroups); f.save('01-候选方案.json', plan);
  await f.invoke('prepare'); f.approve();
  f.state.rule.conditionGroups[0].name = '其他作者的新组名';
  await assert.rejects(f.invoke('preflight'), /写前原组成漂移/);
  await assert.rejects(f.invoke('write'), /写前原组成漂移/);
  assert.equal(f.state.puts, 0);
  assert.equal(fs.existsSync(path.join(f.dir, '06-写入与即时回读.json')), false);
}));

test('独立回读比较全部原组成及其时间戳', () => fixture(async f => {
  f.state.extraValues[root + '/parameters'] = [{ parameterKey: 'power', name: '威力' }];
  f.state.extraValues[root + '/parameters/power'] = { parameterKey: 'power', name: '威力', fixedValue: 30,
    createdAt: '2026-09-20T01:00:00Z', updatedAt: '2026-09-20T01:00:00Z' };
  await f.invoke('prepare'); f.approve(); await f.invoke('write');
  const report = (await f.invoke('readback'))[0];
  assert.equal(report.GETs, 9);
  assert.equal(report.unchangedResponsesIncludingTimestamps, 7);
  f.state.extraValues[root + '/parameters/power'].updatedAt = '2026-09-21T01:00:00Z';
  await assert.rejects(f.invoke('readback'), /原组成含时间戳变化/);
  assert.equal(f.state.puts, 1);
}));

test('来源漂移、工具批准摘要不符和冻结环境摘要不符均不发送PUT', () => fixture(async f => {
  await f.invoke('prepare'); f.approve();
  const sourcePath = path.join(f.dir, 'source.txt'), originalSource = fs.readFileSync(sourcePath);
  fs.appendFileSync(sourcePath, '来源变化');
  await assert.rejects(f.invoke('write'), /来源漂移/);
  fs.writeFileSync(sourcePath, originalSource);
  const review = f.read('05-独立评审.json');
  review.approvedFiles[tool] = '0'.repeat(64); f.save('05-独立评审.json', review);
  await assert.rejects(f.invoke('write'), /批准文件漂移/);
  f.approve(); f.state.approvedSha = '0'.repeat(64);
  await assert.rejects(f.invoke('write'));
  assert.equal(f.state.puts, 0);
  assert.equal(fs.existsSync(path.join(f.dir, '06-写入与即时回读.json')), false);
}));

test('保存后响应未知时保留尝试记录并拒绝重放或认定独立回读成功', () => fixture(async f => {
  f.state.rule.conditionGroups = structuredClone(heroGroups);
  const plan = f.read('01-候选方案.json');
  plan.conditionGroups = appendEnemy(heroGroups); f.save('01-候选方案.json', plan);
  await f.invoke('prepare'); f.approve(); f.state.lostPutResponse = true;
  await assert.rejects(f.invoke('write'), /模拟保存后连接断开/);
  const journal = f.read('06-写入与即时回读.json');
  assert.equal(journal.status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
  assert.equal(journal.businessWritesAttempted, 1);
  assert.equal(journal.responseStatus, undefined);
  assert.deepEqual(f.state.rule.conditionGroups, appendEnemy(heroGroups));
  await assert.rejects(f.invoke('write'));
  await assert.rejects(f.invoke('readback'));
  assert.equal(f.state.puts, 1);
}));

test('保存响应损坏仍记录实际200状态，禁止重放并可先读取现状', () => fixture(async f => {
  await f.invoke('prepare'); f.approve(); f.state.malformedPutResponse = true;
  await assert.rejects(f.invoke('write'));
  const journal = f.read('06-写入与即时回读.json');
  assert.equal(journal.responseStatus, 200);
  assert.equal(journal.status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
  assert(journal.audit.some(row => row.method === 'PUT' && row.status === 200));
  assert.deepEqual(f.state.rule.conditionGroups, groups);
  await assert.rejects(f.invoke('write'));
  assert.equal(f.state.puts, 1);
}));
