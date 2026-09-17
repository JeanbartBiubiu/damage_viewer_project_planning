import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const planPath = path.join(here, '06B-恢复冻结请求.json');
const baselinePath = path.join(here, '06C-恢复写入前现值.json');
if (fs.existsSync(planPath) || fs.existsSync(baselinePath)) throw new Error('恢复冻结文件已存在，拒绝覆盖');

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
};
const equal = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const subsetEqual = (actual, expected) => {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length
      && expected.every((item, index) => subsetEqual(actual[index], item));
  }
  if (expected && typeof expected === 'object') {
    return actual && typeof actual === 'object'
      && Object.entries(expected).every(([key, value]) => subsetEqual(actual[key], value));
  }
  return Object.is(actual, expected);
};
const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(JSON.stringify(stable(value)));
const shaFile = file => shaBytes(fs.readFileSync(file));
const readJson = file => JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));

let getCount = 0;
async function get(route, expectedStatus = 200) {
  getCount += 1;
  const response = await fetch(base + route, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assert.equal(response.status, expectedStatus, `读取状态不符：${route}`);
  return { method: 'GET', route, status: response.status, data };
}

async function mapLimit(values, limit, work) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await work(values[index], index);
    }
  }));
  return results;
}

const original = readJson('02-冻结请求.json');
const originalBaseline = readJson('04-写入前现值.json');
const firstReview = readJson('05-Cursor独立评审.json');
const failure = readJson('06-写入与即时回读.json');
assert.equal(original.planRevision, 1);
assert.equal(original.writes.length, 16);
assert.equal(firstReview.verdict, 'READY');
assert.equal(failure.status, 'FAIL');
assert.equal(failure.businessWriteCount, 1);
assert.equal(failure.writes.length, 1);
assert.equal(failure.writes[0].write.route, original.writes[0].route);
assert.equal(failure.writes[0].response.status, 200);
assert.equal(failure.writes[0].immediateReadback.status, 200);
assert(subsetEqual(failure.writes[0].immediateReadback.data, original.writes[0].body));

const writes = original.writes.slice(1).map(write => {
  const corrected = structuredClone(write);
  if (corrected.method === 'PUT' && corrected.route.includes('/effects/')) delete corrected.body.effectKey;
  return corrected;
});
assert.equal(writes.length, 15);
assert.equal(writes.filter(item => item.method === 'PUT').length, 6);
assert.equal(writes.filter(item => item.method === 'POST').length, 7);
assert.equal(writes.filter(item => item.method === 'DELETE').length, 2);
for (const write of writes.filter(item => item.method === 'PUT' && item.route.includes('/effects/'))) {
  assert(!Object.hasOwn(write.body, 'effectKey'), `效果更新体仍含标识：${write.route}`);
}

for (const source of original.sources) assert.equal(shaFile(source.path), source.sha256, `来源散列漂移：${source.path}`);

const staticRequests = [];
for (const expected of originalBaseline.staticRequests) {
  const actual = await get(expected.route, expected.status);
  staticRequests.push(actual);
  if (expected.route === original.writes[0].route) {
    assert(subsetEqual(actual.data, original.writes[0].body), '已成功的第一项发生漂移');
  } else {
    assert(equal(actual.data, expected.data), `首次失败后出现范围外漂移：${expected.route}`);
  }
}

const skillsResponse = await get('/skills');
assert(Array.isArray(skillsResponse.data?.items));
assert.equal(skillsResponse.data.items.length, skillsResponse.data.total);
const allSkillKeys = skillsResponse.data.items.map(item => item.skillKey).sort();
assert.equal(allSkillKeys.length, 1062, '技能总数漂移');
const ruleLists = await mapLimit(allSkillKeys, 24, async skillKey => {
  const response = await get(`/skills/${encodeURIComponent(skillKey)}/trigger-rules`);
  assert(Array.isArray(response.data));
  return { skillKey, rules: response.data };
});
const summaries = ruleLists.flatMap(item => item.rules.map(entry => ({ skillKey: item.skillKey, ruleKey: entry.ruleKey })));
const ruleDetails = await mapLimit(summaries, 24, async item => {
  const response = await get(`/skills/${encodeURIComponent(item.skillKey)}/trigger-rules/${encodeURIComponent(item.ruleKey)}`);
  return { ...item, data: response.data };
});
ruleDetails.sort((left, right) => left.skillKey.localeCompare(right.skillKey) || left.ruleKey.localeCompare(right.ruleKey));
assert.equal(ruleDetails.length, 90, '恢复前触发规则总数漂移');
assert(equal(ruleDetails, originalBaseline.triggerRuleScan.rules), '首次失败后触发规则集合漂移');

const diagnosisHash = shaFile(path.join(here, '06A-失败诊断与恢复方案.md'));
const failedReportHash = shaFile(path.join(here, '06-写入与即时回读.json'));
assert.equal(failedReportHash, '0cb773810d8a623755e16005b4f06347be018465e77e37dcda3a49abad3502c7');

const recoveryPlan = {
  planRevision: 2,
  recoveryOfPlanRevision: 1,
  plannedWrites: writes.length,
  methodCounts: { PUT: 6, POST: 7, DELETE: 2 },
  diagnosisSha256: diagnosisHash,
  failedReportSha256: failedReportHash,
  originalApprovedHashes: firstReview.approvedHashes,
  sources: original.sources,
  correction: {
    alreadyCompletedRoute: original.writes[0].route,
    removedFromRecovery: true,
    effectUpdateBodyRule: 'PUT 效果请求体删除路径中已固定的 effectKey',
    correctedEffectRoutes: writes
      .filter(item => item.method === 'PUT' && item.route.includes('/effects/'))
      .map(item => item.route)
  },
  writes,
  replacementSafety: original.replacementSafety,
  excluded: original.excluded
};
fs.writeFileSync(planPath, JSON.stringify(recoveryPlan, null, 2) + '\n', { flag: 'wx' });

const baseline = {
  capturedAt: new Date().toISOString(),
  methodPolicy: 'GET_ONLY',
  authorizationValueRecorded: false,
  businessWrites: 0,
  getCount,
  recoveredPartialState: {
    completedWriteCount: 1,
    completedRoute: original.writes[0].route,
    completedBody: original.writes[0].body
  },
  staticRequests,
  triggerRuleScan: {
    skillCount: allSkillKeys.length,
    listGetCount: allSkillKeys.length,
    detailGetCount: ruleDetails.length,
    ruleCount: ruleDetails.length,
    sourceInitializedRuleCount: ruleDetails.filter(item => item.data.eventSource.eventType === 'SOURCE_INITIALIZED').length,
    sha256: shaValue(ruleDetails),
    rules: ruleDetails
  }
};
fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx' });

const hashes = Object.fromEntries([
  '06A-失败诊断与恢复方案.md',
  '06B-恢复冻结请求.json',
  '06C-恢复写入前现值.json'
].map(file => [file, shaFile(path.join(here, file))]));
console.log(JSON.stringify({
  status: 'PASS',
  getCount,
  businessWrites: 0,
  ruleCount: ruleDetails.length,
  sourceInitializedRuleCount: baseline.triggerRuleScan.sourceInitializedRuleCount,
  plannedWrites: writes.length,
  hashes
}, null, 2));
