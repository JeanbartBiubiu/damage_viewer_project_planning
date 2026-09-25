import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2], step = Number(process.argv[3]);
assert(mode === 'prepare' || mode === 'readback' && [1, 2, 3].includes(step));
const read = n => JSON.parse(fs.readFileSync(path.join(here, n), 'utf8'));
const hash = n => crypto.createHash('sha256').update(fs.readFileSync(path.join(here, n))).digest('hex');
const write = (n, v) => fs.writeFileSync(path.join(here, n), JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const sourceFile = '科加斯Q准备/03-最小真实页面候选.json', candidate = read(sourceFile);
const token = crypto.randomUUID(), values = {}, audit = [];
async function get(route, missing = false) {
  const r = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  audit.push({ method: 'GET', route, status: r.status });
  assert(r.status === 200 || missing && r.status === 404, route + ': ' + r.status);
  return values[route] = r.status === 404 ? { http: 404 } : await r.json();
}
const checkRoute = '/characters/champion_chogath/authoring-check';
const lists = ['/statuses', '/skills/chogath_q/effects', '/skills/chogath_q/trigger-rules'];
function withoutCheckTime(v) { const { checkedAt, ...rest } = v; return rest; }
if (mode === 'prepare') {
  const old = read('科加斯Q准备/' + candidate.baseline.file);
  for (const route of Object.keys(old.values)) {
    const value = await get(route);
    assert.deepEqual(route === checkRoute ? withoutCheckTime(value) : value, route === checkRoute ? withoutCheckTime(old.values[route]) : old.values[route], '准备后现值变化：' + route);
  }
  for (const req of candidate.requests) assert.deepEqual(await get(req.detailPath, true), { http: 404 });
  const requests = structuredClone(candidate.requests);
  // SKILL_HIT 新建表单只发 sourceSkillKey；后端读取 DTO 可附加 useKind:null。
  delete requests[2].body.eventSource.detail.useKind;
  write('科加斯击飞-01-写前现值.json', { at: new Date().toISOString(), audit, values, businessWrites: 0 });
  write('科加斯击飞-02-页面批准.json', {
    at: new Date().toISOString(), executionMode: 'PLAYWRIGHT_UI_ONLY', model: 'gpt-6-luna', effort: 'max',
    configuredContext: 600000, acceptedUsableContext: 570000,
    question: '独立击飞状态能否通过目录、无强度持续效果、明确未阻挡且每目标一次的规则完成正常页面表达，并保留正确单位和引用',
    baseline: '科加斯击飞-01-写前现值.json', baselineSha256: hash('科加斯击飞-01-写前现值.json'),
    sourceFile, sourceSha256: hash(sourceFile), requests,
    approvedSimulationBoundary: candidate.suggestedSimulationBoundary,
    expectedReferenceAdditions: candidate.expectedReferenceAdditions,
    protected: candidate.protected,
    acceptance: candidate.pageAcceptance,
    protocolNote: '批准新增SKILL_HIT正文仅sourceSkillKey；独立GET仅允许DTO附加useKind:null，不改变其他语义。',
    sequence: '顺序三笔，每次保存重开后通知主负责人独立回读；获得该笔PASS后继续下一笔。失败或不明先查保存状态。',
    runtimeValidated: false, wholeSkillComplete: false
  });
  console.log(JSON.stringify({ status: 'APPROVED_UI_ONLY', GETs: audit.length, plannedPageWrites: 3, businessWrites: 0 }));
} else {
  const plan = read('科加斯击飞-02-页面批准.json'), before = read(plan.baseline);
  assert.equal(hash(plan.baseline), plan.baselineSha256);
  for (const route of Object.keys(before.values)) await get(route, before.values[route].http === 404);
  const keys = ['statusKey', 'effectKey', 'ruleKey'];
  let protectedResponses = 0;
  for (const [route, old] of Object.entries(before.values)) {
    if (plan.requests.some(r => r.detailPath === route) || lists.includes(route) || route === checkRoute) continue;
    assert.deepEqual(values[route], old, '无关数据变化：' + route); protectedResponses++;
  }
  for (const [i, req] of plan.requests.entries()) {
    const listResponse = values[lists[i]], oldListResponse = before.values[lists[i]], key = keys[i];
    const list = i === 0 ? listResponse.items : listResponse;
    const oldList = i === 0 ? oldListResponse.items : oldListResponse;
    if (i >= step) {
      assert.deepEqual(values[req.detailPath], { http: 404 }, '未授权次序已提前写入');
      assert.deepEqual(listResponse, oldListResponse); continue;
    }
    const { gameId, skillKey, createdAt, updatedAt, ...body } = structuredClone(values[req.detailPath]);
    if (i < 2) {
      assert.equal(gameId, 'lol');
      if (i === 1) assert.equal(skillKey, 'chogath_q');
      assert(Number.isFinite(Date.parse(createdAt)) && Number.isFinite(Date.parse(updatedAt)));
    } else {
      assert.deepEqual([gameId, skillKey, createdAt, updatedAt], [undefined, undefined, undefined, undefined]);
    }
    if (i === 2 && body.eventSource.detail.useKind === null) delete body.eventSource.detail.useKind;
    assert.deepEqual(body, req.body, '已保存正文不符：' + req.detailPath);
    assert.equal(list.length, oldList.length + 1);
    assert.deepEqual(list.filter(x => x[key] !== req.body[key]), oldList, '原列表项目变化：' + lists[i]);
    if (i === 0) {
      assert.equal(listResponse.total, oldListResponse.total + 1);
      assert.deepEqual({ ...listResponse, items: oldList, total: oldListResponse.total }, oldListResponse);
    }
  }
  const check = values[checkRoute], oldCheck = before.values[checkRoute];
  assert.equal(check.conclusions.structure, 'NO_ERRORS');
  for (const ref of oldCheck.references) assert(check.references.some(x => JSON.stringify(x) === JSON.stringify(ref)), '已有引用丢失');
  const additions = plan.expectedReferenceAdditions.filter(x => step >= 3 || step >= 2 && x.sourceType === 'EFFECT');
  const addedReferences = check.references.filter(x => !oldCheck.references.some(y => JSON.stringify(x) === JSON.stringify(y)));
  assert.equal(addedReferences.length, additions.length);
  for (const ref of additions) assert(addedReferences.some(x => Object.entries(ref).every(([k, v]) => x[k] === v)), '新增引用不符：' + ref.fieldPath);
  const qIssues = check.issues.filter(x => x.skillKey === 'chogath_q');
  const newIssues = check.issues.filter(x => !oldCheck.issues.some(y => JSON.stringify(y) === JSON.stringify(x)));
  for (const issue of oldCheck.issues) assert(check.issues.some(x => JSON.stringify(x) === JSON.stringify(issue)), '原检查提示丢失');
  assert.equal(newIssues.length, step === 2 ? 1 : 0);
  assert.deepEqual(check.summary, { ...oldCheck.summary, reviewCount: oldCheck.summary.reviewCount + (step === 2 ? 1 : 0) });
  assert.deepEqual(check.conclusions, oldCheck.conclusions);
  if (step === 2) assert(qIssues.some(x => x.objectKey === 'knockup' && x.code === 'EFFECT_NOT_CONNECTED'));
  if (step === 3) assert(!qIssues.some(x => x.objectKey === 'knockup' && x.code === 'EFFECT_NOT_CONNECTED'));
  write('科加斯击飞-03-独立回读-' + step + '.json', { at: new Date().toISOString(), status: 'PASS', audit, values, protectedResponses,
    addedReferences, confirmedPageWrites: step, businessWrites: 0, runtimeValidated: false, wholeSkillComplete: false });
  console.log(JSON.stringify({ status: 'PASS', step, GETs: audit.length, protectedResponses, addedReferences: addedReferences.length, businessWrites: 0 }));
}
