import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tool = 'tools/authoring/update-reviewed-damage-vamp-v2.mjs';
const toolPath = path.join(web, tool);
const root = '/skills/vamp_test', route = root + '/effects/hit';
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
let sequence = 0;
async function fixture(run, damageTypeKey = 'physics') {
  const prefix = path.join(web, '数据参考', '.vamp-tool-test-'), dir = fs.mkdtempSync(prefix);
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value) + '\n');
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  fs.writeFileSync(path.join(dir, 'source.txt'), '固定测试来源\n');
  const groups = [{ groupKey: 'champion_target', name: '本轮敌方英雄', sortOrder: 10, conditions: [
    { conditionKey: 'champion_target', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 10, detail: { categories: ['CHAMPION'] } },
    { conditionKey: 'enemy_target', conditionType: 'SKILL_HIT_TARGET_IS_ENEMY', sortOrder: 20, detail: {} }
  ] }];
  const original = { gameId: 'lol', skillKey: 'vamp_test', effectKey: 'hit', name: '普通伤害', description: '旧说明',
    sortOrder: 10, lifecycle: null, createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z', results: [
      { resultKey: 'damage', name: '伤害', resultType: 'DAMAGE', target: 'TARGET', description: null, sortOrder: 10,
        lifecycleBehavior: null, spellShieldBlockScope: 'RESULT',
        valueRule: { value: { kind: 'FIXED', value: 100 }, fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null },
        detail: { damageTypeKey, deliveryKind: 'SKILL', originKind: 'DIRECT', critical: { mode: 'DISALLOWED', multiplierValue: null }, vampRules: [] } }
    ] };
  const rule = { ruleKey: 'actual_hit', eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'vamp_test', useKind: null } },
    conditionGroups: groups, actions: [{ actionType: 'EXECUTE_EFFECT', targetContext: 'CURRENT_TARGET', detail: { effectKey: 'hit' } }] };
  const state = { effect: structuredClone(original), rule, extraRules: [], processes: [], puts: 0, malformed: false };
  save('01-纠错计划.json', { changes: [{ skillKey: 'vamp_test', effectKey: 'hit', resultKey: 'damage', route,
    damageTypeKey, scopeRuleKey: 'actual_hit', description: '明确全能吸血资格' }],
    sourceFiles: [{ root: 'web', path: path.relative(web, path.join(dir, 'source.txt')), sha256: hash(path.join(dir, 'source.txt')) }] });
  async function invoke(mode) {
    const old = { argv: process.argv, fetch: globalThis.fetch, log: console.log, approved: process.env.DAMAGE_APPROVED_BATCH_SHA };
    const output = [];
    try {
      process.argv = [process.execPath, toolPath, mode, dir];
      console.log = line => output.push(JSON.parse(line));
      globalThis.fetch = async (url, options) => {
        const parsed = new URL(url); assert.equal(parsed.origin, 'http://127.0.0.1:8080');
        const p = parsed.pathname.replace('/api/admin/games/lol', '');
        assert.equal(options.redirect, 'error');
        if (options.method === 'PUT') {
          assert.equal(p, route); state.puts++;
          state.effect = { ...state.effect, ...JSON.parse(options.body), updatedAt: '2026-09-21T00:00:01Z' };
          return state.malformed ? new Response('broken', { status: 200 }) : Response.json(state.effect);
        }
        assert.equal(options.method, 'GET');
        if (p === root) return Response.json({ skillKey: 'vamp_test', status: 'ENABLED' });
        if (p === route) return Response.json(state.effect);
        if (p === root + '/effects') {
          const { results, lifecycle, ...meta } = state.effect;
          return Response.json([{ ...meta, resultCount: results.length, lifecycleEnabled: !!lifecycle }]);
        }
        if (p === root + '/trigger-rules') return Response.json([state.rule, ...state.extraRules].map(x => ({ ruleKey: x.ruleKey })));
        if (p.startsWith(root + '/trigger-rules/')) return Response.json([state.rule, ...state.extraRules].find(x => p.endsWith('/' + x.ruleKey)));
        if (p === root + '/processes') return Response.json(state.processes);
        if (p.startsWith(root + '/processes/')) return Response.json(state.processes.find(x => p.endsWith('/' + x.processKey)));
        assert(['parameters', 'formulas', 'internal-states'].some(kind => p === root + '/' + kind));
        return Response.json([]);
      };
      if (fs.existsSync(path.join(dir, '02-冻结请求.json'))) process.env.DAMAGE_APPROVED_BATCH_SHA = hash(path.join(dir, '02-冻结请求.json'));
      await import(pathToFileURL(toolPath).href + '?test=' + (++sequence));
      return output;
    } finally {
      process.argv = old.argv; globalThis.fetch = old.fetch; console.log = old.log;
      if (old.approved === undefined) delete process.env.DAMAGE_APPROVED_BATCH_SHA;
      else process.env.DAMAGE_APPROVED_BATCH_SHA = old.approved;
    }
  }
  function approve() {
    const required = [tool, '01-纠错计划.json', '02-冻结请求.json', '03-来源摘要.json', '04-写入前现值.json'];
    save('05-独立评审.json', { status: 'APPROVED', approvedFiles: Object.fromEntries(required.map(name => [name, hash(name === tool ? toolPath : path.join(dir, name))])) });
  }
  try { await run({ state, original, invoke, approve, read, save, dir }); }
  finally {
    const resolved = path.resolve(dir); assert(resolved.startsWith(prefix) && path.dirname(resolved) === path.dirname(prefix));
    fs.rmSync(resolved, { recursive: true });
  }
}

for (const kind of ['physics', 'magic']) test(`${kind}只补全能吸血和说明，保留数值和护盾，完整回读通过`, () => fixture(async f => {
  await f.invoke('prepare'); f.approve(); await f.invoke('write');
  const expected = structuredClone(f.original); expected.description = '明确全能吸血资格'; expected.updatedAt = f.state.effect.updatedAt;
  expected.results[0].detail.vampRules = [{ vampType: 'OMNIVAMP', basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiencyValue: { kind: 'FIXED', value: 1 } }];
  assert.deepEqual(f.state.effect, expected);
  assert.equal((await f.invoke('readback'))[0].status, 'PASS');
  await assert.rejects(f.invoke('write')); assert.equal(f.state.puts, 1);
}, kind));

test('缺英雄范围、额外直接入口和过程挂接分别阻止准备', async () => {
  for (const variant of ['unscoped', 'extra', 'process']) await fixture(async f => {
    if (variant === 'unscoped') f.state.rule.conditionGroups = [];
    if (variant === 'extra') f.state.extraRules = [{ ...f.state.rule, ruleKey: 'another' }];
    if (variant === 'process') f.state.processes = [{ processKey: 'cast', effectBindings: [{ effectKey: 'hit' }] }];
    await assert.rejects(f.invoke('prepare')); assert.equal(f.state.puts, 0);
  });
});

test('实际类型与冻结计划不同或来源变化时阻止准备', async () => {
  for (const variant of ['type', 'source']) await fixture(async f => {
    if (variant === 'type') f.state.effect.results[0].detail.damageTypeKey = 'real';
    else fs.writeFileSync(path.join(f.dir, 'source.txt'), '新来源');
    await assert.rejects(f.invoke('prepare')); assert.equal(f.state.puts, 0);
  });
});

test('响应损坏保留实际200和尝试，后续禁止重放', () => fixture(async f => {
  await f.invoke('prepare'); f.approve(); f.state.malformed = true;
  await assert.rejects(f.invoke('write'));
  const journal = f.read('06-写入与即时回读.json');
  assert.equal(journal.pendingResponseStatus, 200);
  assert(journal.audit.some(x => x.method === 'PUT' && x.status === 200));
  assert.equal(journal.status, 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY');
  await assert.rejects(f.invoke('write')); assert.equal(f.state.puts, 1);
}));
