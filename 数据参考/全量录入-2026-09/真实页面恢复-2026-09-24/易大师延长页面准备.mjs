import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// 只读现值并冻结正常页面候选；不执行业务写接口。
const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const hash = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(here, name))).digest('hex');
const write = (name, value) => fs.writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const candidate = read('易大师R准备/04-复用原候选与保护范围.json');
const oldName = '易大师R准备/' + candidate.baseline.file;
assert.equal(hash(oldName), candidate.baseline.sha256);
const previous = read(oldName), values = {}, audit = [], token = crypto.randomUUID();
for (const [route, expected] of Object.entries(previous.values)) {
  const expectedStatus = previous.audit.find(row => (row.route ?? row.path) === route)?.status;
  assert([200, 404].includes(expectedStatus), route);
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, expectedStatus, route);
  const body = await response.json();
  values[route] = body;
  audit.push({ method: 'GET', route, status: response.status });
  const actual = structuredClone(body), before = structuredClone(expected);
  if (route.endsWith('/authoring-check')) { delete actual.checkedAt; delete before.checkedAt; }
  assert.deepEqual(actual, before, '只读准备后现值变化：' + route);
}
const prefix = '/skills/masteryi_r';
assert.equal(values[prefix + '/parameters/kill_assist_extension_ms'].fixedValue, 7000);
for (const effectKey of ['attack_speed', 'move_speed']) {
  const effect = values[prefix + '/effects/' + effectKey];
  assert.equal(effect.lifecycle.instanceScope, 'SOURCE');
  assert.equal(effect.lifecycle.expiryMode, 'ALL_AT_ONCE');
  assert.equal(effect.lifecycle.durationValue.parameterKey, 'duration_ms');
}
assert.equal(values[prefix + '/parameters/duration_ms'].fixedValue, 7000);
assert.equal(values[prefix + '/effects'].length, 4);
const requests = candidate.requests.map(row => ({ method: row.method, route: row.path, detailRoute: row.detailPath, body: row.body }));
assert.equal(requests.length, 1);
assert.equal(requests[0].method, 'POST');
assert.equal(requests[0].body.results.length, 2);
assert(requests[0].body.results.every(row => row.detail.operation === 'EXTEND_DURATION' && row.target === 'SOURCE'));
write('易大师延长-01-写前现值.json', { at: new Date().toISOString(), audit, values, businessWrites: 0 });
write('易大师延长-02-页面批准.json', {
  at: new Date().toISOString(), executionMode: 'PLAYWRIGHT_UI_ONLY', model: 'gpt-6-luna', effort: 'max',
  question: '作者能否明确区分延长现有实例的剩余时间与刷新完整期限，并保存两个准确目标引用',
  baseline: '易大师延长-01-写前现值.json', baselineSha256: hash('易大师延长-01-写前现值.json'), requests,
  protected: candidate.protected, expectedReferenceAdditions: candidate.expectedReferenceAdditions,
  expectedRelevantReferenceCount: candidate.expectedRelevantReferenceCount,
  verification: candidate.pageAcceptance,
  excluded: candidate.notInScope,
  arithmeticIllustration: { initialMs: 7000, elapsedMs: 2000, extendByMs: 7000, remainingAfterExtendMs: 12000, remainingAfterRefreshMs: 7000, runtimeEvidence: false },
  oldImplementationVerifiedPresent: candidate.implementation,
  runtimeValidated: false, wholeSkillComplete: false
});
console.log(JSON.stringify({ status: 'APPROVED_UI_ONLY', GETs: audit.length, plannedPageWrites: 1, businessWrites: 0 }));
