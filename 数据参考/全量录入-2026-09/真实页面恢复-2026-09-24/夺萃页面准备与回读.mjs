import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// 仅GET及本地证据；六笔业务变更必须经执行代理的正常页面控件。
const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
assert(['prepare', 'readback'].includes(mode));
const completed = mode === 'readback' ? Number(process.argv[3]) : 0;
assert(Number.isInteger(completed) && completed >= 0 && completed <= 6);
const prefix = '/skills/item_3508_passive';
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = crypto.randomUUID();
const values = {}, audit = [];
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
async function get(route, absent = false) {
  const r = await fetch(base + route, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  audit.push({ method: 'GET', route, status: r.status });
  assert(r.status === 200 || (absent && r.status === 404), route + ': ' + r.status);
  return values[route] = r.status === 404 ? { http: 404 } : await r.json();
}
const kinds = { parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey', processes: 'processKey', 'internal-states': 'stateKey', 'trigger-rules': 'ruleKey' };
await get(prefix);
for (const [kind, key] of Object.entries(kinds)) {
  const list = await get(prefix + '/' + kind);
  assert(Array.isArray(list));
  for (const row of list) await get(prefix + '/' + kind + '/' + row[key]);
}
for (const route of ['/equipment/item_3508', '/equipment/item_3508/representative-image', '/equipment-skill-relations?equipmentKey=item_3508', prefix + '/representative-image', '/vamp-rules']) await get(route);
for (const route of [prefix + '/internal-states/spellblade_ready', prefix + '/internal-states/spellblade_icd', prefix + '/processes/spellblade_consume', prefix + '/trigger-rules/spellblade_arm']) if (!Object.hasOwn(values, route)) await get(route, true);
const strip = value => {
  const { gameId, skillKey, createdAt, updatedAt, ...body } = value;
  return body;
};
if (mode === 'prepare') {
  const old = read('夺萃下一批只读准备.json');
  for (const [route, value] of Object.entries(old.values)) assert.deepEqual(values[route], value, '现值漂移：' + route);
  const candidate = read('夺萃准备/夺萃待击窗口页面候选.json');
  const proposed = structuredClone(candidate['新增请求候选']);
  const states = proposed['内部状态'], process = proposed['过程'], arm = proposed['触发规则'][0];
  arm.conditionGroups = [{
    groupKey: 'cooldown_ready', name: '咒刃内部冷却就绪', sortOrder: 10,
    conditions: [{
      conditionKey: 'cond_1', conditionType: 'INTERNAL_STATE_CHECK', sortOrder: 10,
      detail: { stateKey: 'spellblade_icd', valueKind: 'REMAINING_MS', optionKey: null, expectedBoolean: null, comparator: 'EQ', comparisonValue: { kind: 'FIXED', value: 0 } }
    }]
  }];
  arm.description = '任意主动非普攻技能成功首次施放且咒刃内部冷却就绪时，启动同一待击过程；已有待击刷新完整十秒窗口，不新增次数。命中消费及伤害、回蓝、清待命和冷却只由强化步骤执行。';
  assert.equal(process.activationType, 'ACTIVE');
  assert.equal(process.steps[0].detail.consumeMoment, 'ATTACK_HIT');
  assert(process.effectBindings.every(x => x.sortOrder < 30));
  assert.equal(process.stateOperations.find(x => x.operationKey === 'consume_ready').sortOrder, 30);
  assert.equal(process.stateOperations.find(x => x.operationKey === 'start_icd').sortOrder, 40);
  const parameterRoute = prefix + '/parameters/mana_refund_damage_multiplier';
  const parameter = strip(structuredClone(values[parameterRoute]));
  delete parameter.parameterKey;
  parameter.description = candidate['建议正文']['倍率参数说明'];
  const skill = strip(structuredClone(values[prefix]));
  skill.description = candidate['建议正文']['技能说明'];
  const requests = [
    ...states.map(body => ({ method: 'POST', route: prefix + '/internal-states', detailRoute: prefix + '/internal-states/' + body.stateKey, key: 'stateKey', body })),
    { method: 'POST', route: prefix + '/processes', detailRoute: prefix + '/processes/' + process.processKey, key: 'processKey', body: process },
    { method: 'POST', route: prefix + '/trigger-rules', detailRoute: prefix + '/trigger-rules/' + arm.ruleKey, key: 'ruleKey', body: arm },
    { method: 'PUT', route: parameterRoute, detailRoute: parameterRoute, key: 'parameterKey', body: parameter },
    { method: 'PUT', route: prefix, detailRoute: prefix, key: 'skillKey', body: skill }
  ];
  for (const item of requests.filter(x => x.method === 'POST')) assert.equal(values[item.detailRoute].http, 404);
  write('夺萃-01-写前现值.json', { at: new Date().toISOString(), base, audit, values, businessWrites: 0 });
  write('夺萃-02-页面批准.json', {
    at: new Date().toISOString(), executionMode: 'PLAYWRIGHT_UI_ONLY', model: 'gpt-6-sol', effort: 'max',
    baselineSha256: sha(fs.readFileSync(path.join(here, '夺萃-01-写前现值.json'))),
    question: '单一强化步骤及单启动规则能否在真实页面完整表达刷新、命中消费、目标及冷却，避免重复配置',
    requests, protected: '原参数数值、公式、效果和未核定吸血、装备与技能关系、目录及图片保持；只改两处已批准说明，新增四个组成',
    boundary: '删除了历史候选第二条命中规则及真假双组；本批准不核定原附伤吸血，也不代表整装备运行'
  });
  console.log(JSON.stringify({ status: 'APPROVED_UI_ONLY', GETs: audit.length, plannedPageWrites: requests.length, businessWrites: 0 }));
} else {
  const before = read('夺萃-01-写前现值.json'), plan = read('夺萃-02-页面批准.json');
  assert.equal(sha(fs.readFileSync(path.join(here, '夺萃-01-写前现值.json'))), plan.baselineSha256);
  const applied = plan.requests.slice(0, completed), changed = new Set(applied.map(x => x.detailRoute));
  for (const item of applied) {
    const actual = strip(values[item.detailRoute]);
    const expected = structuredClone(item.body);
    if (item.key === 'processKey') {
      // SkillProcessMoment.failureReason 标注 NON_NULL；合法空原因在GET中省略。
      // 只规范此字段，不忽略stepKey、操作值或其他空值；POST批准正文保持不变。
      for (const row of [...expected.effectBindings, ...expected.stateOperations]) {
        assert.equal(row.moment.failureReason, null);
        delete row.moment.failureReason;
      }
    }
    if (item.method === 'PUT') {
      if (item.key !== 'skillKey') delete actual[item.key];
      for (const field of ['gameId', 'skillKey', 'createdAt']) assert.equal(values[item.detailRoute][field], before.values[item.detailRoute][field], item.detailRoute + '/' + field);
    }
    assert.deepEqual(actual, expected, '正文不一致：' + item.detailRoute);
  }
  let protectedResponses = 0;
  for (const [route, original] of Object.entries(before.values)) {
    if (changed.has(route)) continue;
    const collectionKey = Object.entries(kinds).find(([kind]) => route === prefix + '/' + kind)?.[1];
    const additions = applied.filter(x => x.method === 'POST' && x.route === route);
    const parameterUpdate = route === prefix + '/parameters' && applied.some(x => x.key === 'parameterKey' && x.method === 'PUT');
    if (collectionKey && (additions.length || parameterUpdate)) {
      assert.equal(values[route].length, original.length + additions.length);
      const expected = structuredClone(original);
      if (parameterUpdate) {
        const request = applied.find(x => x.key === 'parameterKey' && x.method === 'PUT');
        const row = expected.find(x => x.parameterKey === 'mana_refund_damage_multiplier');
        row.description = request.body.description;
        row.updatedAt = values[request.detailRoute].updatedAt;
      }
      assert.deepEqual(values[route].filter(row => !additions.some(x => x.body[collectionKey] === row[collectionKey])), expected, '旧列表项变化：' + route);
    } else {
      assert.deepEqual(values[route], original, '保护内容变化：' + route);
      protectedResponses++;
    }
  }
  write(`夺萃-回读-${completed}.json`, { status: 'PASS', at: new Date().toISOString(), completedPageWrites: completed, businessWrites: 0, protectedResponses, audit, values, wholeEquipmentRuntime: false });
  console.log(JSON.stringify({ status: 'PASS', completed, GETs: audit.length, protectedResponses, businessWrites: 0 }));
}
