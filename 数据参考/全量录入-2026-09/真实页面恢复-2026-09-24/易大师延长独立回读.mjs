import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// 只在执行代理确认正常页面已保存后运行；全部业务请求均为 GET。
const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const plan = read('易大师延长-02-页面批准.json'), before = read(plan.baseline);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(here, plan.baseline))).digest('hex'), plan.baselineSha256);
const request = plan.requests[0], prefix = '/skills/masteryi_r', checkRoute = '/characters/champion_masteryi/authoring-check';
const values = {}, audit = [], token = crypto.randomUUID();
for (const route of Object.keys(before.values)) {
  const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
    method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  assert.equal(response.status, 200, route);
  values[route] = await response.json();
  audit.push({ method: 'GET', route, status: response.status });
}
const { gameId, skillKey, createdAt, updatedAt, ...body } = values[request.detailRoute];
assert.equal(gameId, 'lol'); assert.equal(skillKey, 'masteryi_r');
assert(Number.isFinite(Date.parse(createdAt))); assert(Number.isFinite(Date.parse(updatedAt)));
assert.deepEqual(body, request.body, '新增效果与页面批准不一致');
let protectedResponses = 0;
for (const [route, original] of Object.entries(before.values)) {
  if ([request.detailRoute, request.route, checkRoute].includes(route)) continue;
  assert.deepEqual(values[route], original, '保护现值变化：' + route);
  protectedResponses++;
}
const list = values[request.route], oldList = before.values[request.route];
assert.equal(list.length, oldList.length + 1);
assert.deepEqual(list.filter(row => row.effectKey !== body.effectKey), oldList);
const added = list.find(row => row.effectKey === body.effectKey);
assert.equal(added.resultCount, 2); assert.equal(added.lifecycleEnabled, false);
for (const key of ['effectKey', 'name', 'description', 'sortOrder']) assert.equal(added[key], body[key]);
assert.equal(added.createdAt, createdAt); assert.equal(added.updatedAt, updatedAt);

const check = structuredClone(values[checkRoute]), oldCheck = structuredClone(before.values[checkRoute]);
assert.equal(check.conclusions.structure, 'NO_ERRORS');
delete check.checkedAt; delete oldCheck.checkedAt;
const isNewSource = row => row.sourceSkillKey === 'masteryi_r' && row.sourceKey === body.effectKey && row.sourceType === 'EFFECT';
const newReferences = check.references.filter(isNewSource);
const fields = ['sourceSkillKey', 'sourceType', 'sourceKey', 'fieldPath', 'targetSkillKey', 'targetType', 'targetKey', 'targetSubKey'];
const sorted = rows => rows.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const identity = row => Object.fromEntries(fields.map(key => [key, row[key]]));
assert.deepEqual(sorted(newReferences.map(identity)), sorted(plan.expectedReferenceAdditions.map(identity)));
assert.equal(check.references.filter(row => row.sourceSkillKey === 'masteryi_r').length, plan.expectedRelevantReferenceCount);
for (const reference of newReferences) {
  assert.equal(reference.location.skillKey, 'masteryi_r');
  assert.equal(reference.location.objectKey, body.effectKey);
  assert.equal(reference.location.objectType, 'EFFECT');
}
check.references = sorted(check.references.filter(row => !isNewSource(row)));
oldCheck.references = sorted(oldCheck.references);
const newIssues = check.issues.filter(row => row.skillKey === 'masteryi_r' && row.objectKey === body.effectKey);
assert.equal(newIssues.length, 1);
assert.equal(newIssues[0].code, 'EFFECT_NOT_CONNECTED');
assert.equal(newIssues[0].severity, 'REVIEW');
assert.equal(newIssues[0].objectType, 'EFFECT');
check.issues = sorted(check.issues.filter(row => !newIssues.includes(row)));
oldCheck.issues = sorted(oldCheck.issues);
oldCheck.skills.find(row => row.skillKey === 'masteryi_r').effectCount++;
oldCheck.summary.reviewCount++;
assert.deepEqual(check, oldCheck, '录入检查出现范围外变化');

const output = { at: new Date().toISOString(), status: 'PASS', audit, values, protectedResponses,
  preservedRelevantReferences: plan.expectedRelevantReferenceCount - newReferences.length, newReferences: newReferences.length,
  newUnconnectedReview: true, confirmedPageWrites: 1, businessWrites: 0, runtimeValidated: false, wholeSkillComplete: false };
fs.writeFileSync(path.join(here, '易大师延长-03-独立回读.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: 'PASS', GETs: audit.length, protectedResponses, preservedRelevantReferences: output.preservedRelevantReferences, newReferences: newReferences.length, businessWrites: 0 }));
