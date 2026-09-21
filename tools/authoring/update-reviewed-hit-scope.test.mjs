import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tool = 'tools/authoring/update-reviewed-hit-scope.mjs';
const toolPath = path.join(web, tool);
const root = '/skills/scope_test';
const detailRoute = root + '/trigger-rules/actual_hit';
const groups = [{ groupKey: 'champion_target', name: '本轮敌方英雄', sortOrder: 10, conditions: [
  { conditionKey: 'champion_target', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 10, detail: { categories: ['CHAMPION'] } },
  { conditionKey: 'enemy_target', conditionType: 'SKILL_HIT_TARGET_IS_ENEMY', sortOrder: 20, detail: {} }
] }];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let importSequence = 0;

async function fixture(run) {
  const prefix = path.join(web, '数据参考', '.scope-tool-test-');
  const dir = fs.mkdtempSync(prefix);
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value) + '\n');
  fs.writeFileSync(path.join(dir, 'source.txt'), '固定测试资料，不访问业务服务\n');
  const rule = { ruleKey: 'actual_hit', name: '实际命中', description: null, sortOrder: 10,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'scope_test', useKind: null } },
    conditionGroups: [], actions: [{ actionKey: 'damage', name: '伤害', actionType: 'EXECUTE_EFFECT', sortOrder: 10,
      targetContext: 'CURRENT_TARGET', detail: { effectKey: 'damage' }, runtimeInputBindings: [], resultModifiers: [] }],
    perTargetCooldown: null, maxTriggersPerProcess: null };
  const state = { rule, status: 'ENABLED', puts: 0, malformedPutResponse: false };
  const summary = () => ({ ruleKey: rule.ruleKey, name: rule.name, description: rule.description,
    sortOrder: rule.sortOrder, eventType: rule.eventSource.eventType, conditionGroupCount: rule.conditionGroups.length,
    actionCount: rule.actions.length, perTargetCooldownEnabled: false, maxTriggersPerProcessEnabled: false,
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
        assert.equal(options.redirect, 'error');
        if (options.method === 'PUT') {
          assert.equal(route, detailRoute);
          state.puts++;
          const body = JSON.parse(options.body);
          assert.deepEqual({ ...body, conditionGroups: [] }, (() => {
            const { ruleKey, ...old } = structuredClone(rule);
            delete old.eventSource.detail.useKind;
            return old;
          })());
          rule.conditionGroups = structuredClone(body.conditionGroups);
          if (state.malformedPutResponse) return new Response('broken', { status: 200 });
          return Response.json(rule);
        }
        assert.equal(options.method, 'GET', '测试禁止其他写入');
        if (route === root) return Response.json({ skillKey: 'scope_test', status: state.status });
        if (route === detailRoute) return Response.json(rule);
        if (route === root + '/trigger-rules') return Response.json([summary()]);
        assert(['parameters', 'formulas', 'effects', 'processes', 'internal-states'].some(kind => route === root + '/' + kind));
        return Response.json([]);
      };
      if (fs.existsSync(path.join(dir, '02-冻结请求.json'))) process.env.DAMAGE_APPROVED_BATCH_SHA = hash(path.join(dir, '02-冻结请求.json'));
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
