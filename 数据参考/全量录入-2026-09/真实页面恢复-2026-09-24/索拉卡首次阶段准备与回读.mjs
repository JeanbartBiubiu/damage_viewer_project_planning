import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// 只读现值及本地批准记录；不执行任何业务写接口。
const here = path.dirname(fileURLToPath(import.meta.url));
const [mode, countText] = process.argv.slice(2);
assert(['prepare', 'readback'].includes(mode));
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const hashFile = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(here, name))).digest('hex');
const baselineName = '索拉卡首次阶段-01-写前现值.json';
const candidate = read('索拉卡R准备/02-三规则首次阶段候选.json');
const previous = read(mode === 'prepare' ? '索拉卡R准备/' + candidate.basisFile : baselineName);
const values = {}, audit = [], token = crypto.randomUUID();
const diagnosticRoute = '/characters/champion_soraka/authoring-check';
const listRoute = '/skills/soraka_r/trigger-rules';
function comparable(route, value) {
  const copy = structuredClone(value);
  if (route === diagnosticRoute) delete copy.checkedAt;
  return copy;
}
function ruleBody(value) {
  const { gameId, skillKey, ruleKey, createdAt, updatedAt, ...body } = structuredClone(value);
  return body;
}
for (const route of Object.keys(previous.values)) {
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  audit.push({ method: 'GET', route, status: response.status });
  assert.equal(response.status, 200, route);
  values[route] = await response.json();
}
if (mode === 'prepare') {
  assert.equal(hashFile('索拉卡R准备/' + candidate.basisFile).toUpperCase(), candidate.basisSha256);
  for (const [route, original] of Object.entries(previous.values)) assert.deepEqual(comparable(route, values[route]), comparable(route, original), '候选生成后变化：' + route);
  const requests = candidate.rules.map(row => {
    const body = ruleBody(values[row.route]);
    assert.equal(body.eventSource.eventType, 'SKILL_USED');
    assert.equal(body.eventSource.detail.sourceSkillKey, 'soraka_r');
    assert.equal(body.eventSource.detail.useKind, 'ACTIVE');
    assert.equal(body.eventSource.detail.castPhase, undefined);
    body.eventSource.detail.castPhase = 'INITIAL';
    assert.deepEqual(body, row.request);
    return { method: 'PUT', route: row.route, body, ruleKey: row.ruleKey };
  });
  write(baselineName, { at: new Date().toISOString(), audit, values, businessWrites: 0 });
  write('索拉卡首次阶段-02-页面批准.json', {
    at: new Date().toISOString(), executionMode: 'PLAYWRIGHT_UI_ONLY', model: 'gpt-6-sol', effort: 'max',
    question: '已有三条使用规则能否通过正常页面明确首次施放资格，并保留治疗前互斥条件和独立成本冷却过程',
    baseline: baselineName, baselineSha256: hashFile(baselineName), requests,
    protected: '仅三条规则的eventSource.detail.castPhase补为INITIAL；其余条件、数值、动作、排序、说明、全部其他组成、角色关系及图片保持',
    simulation: '成功首次施放治疗一次；治疗结算前生命比例低于40%增强，否则普通；过程结束不重复治疗',
    runtimeValidated: false, wholeSkillCompletionChanged: false
  });
  console.log(JSON.stringify({ status: 'APPROVED_UI_ONLY', GETs: audit.length, plannedPageWrites: requests.length, businessWrites: 0 }));
} else {
  const plan = read('索拉卡首次阶段-02-页面批准.json');
  assert.equal(hashFile(plan.baseline), plan.baselineSha256);
  const count = Number(countText);
  assert(Number.isInteger(count) && count >= 1 && count <= plan.requests.length);
  const applied = plan.requests.slice(0, count), changed = new Set(applied.map(row => row.route));
  for (const row of applied) {
    assert.deepEqual(ruleBody(values[row.route]), row.body, row.route);
    for (const key of ['gameId', 'skillKey', 'ruleKey', 'createdAt']) assert.equal(values[row.route][key], previous.values[row.route][key]);
  }
  let protectedResponses = 0;
  for (const [route, original] of Object.entries(previous.values)) {
    if (changed.has(route)) continue;
    const expected = structuredClone(original);
    if (route === listRoute) {
      // 规则详情不返回时间戳，列表独立提供更新时间；仅放行本次已保存规则的该字段。
      for (const row of applied) {
        const beforeRow = expected.find(item => item.ruleKey === row.ruleKey);
        const currentRow = values[route].find(item => item.ruleKey === row.ruleKey);
        assert(beforeRow && currentRow);
        assert(Number.isFinite(Date.parse(currentRow.updatedAt)));
        assert(Date.parse(currentRow.updatedAt) >= Date.parse(beforeRow.updatedAt));
        beforeRow.updatedAt = currentRow.updatedAt;
      }
    } else protectedResponses++;
    assert.deepEqual(comparable(route, values[route]), comparable(route, expected), '保护内容变化：' + route);
  }
  assert.equal(values[diagnosticRoute].conclusions.structure, 'NO_ERRORS');
  write('索拉卡首次阶段-回读-' + count + '.json', { at: new Date().toISOString(), status: 'PASS', completedPageWrites: count,
    audit, values, protectedResponses, volatileFieldsExcluded: ['authoring-check.checkedAt'], businessWrites: 0, runtimeValidated: false });
  console.log(JSON.stringify({ status: 'PASS', GETs: audit.length, completedPageWrites: count, protectedResponses, businessWrites: 0 }));
}
