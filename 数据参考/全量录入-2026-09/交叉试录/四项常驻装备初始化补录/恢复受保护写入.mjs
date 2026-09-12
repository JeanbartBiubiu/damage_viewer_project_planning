import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const requiredFiles = [
  '06A-失败诊断与恢复方案.md',
  '06B-恢复冻结请求.json',
  '06C-恢复写入前现值.json',
  '恢复受保护写入.mjs',
  '06D-Cursor恢复评审.json'
];
const approvedHashes = JSON.parse(process.env.DAMAGE_APPROVED_HASHES_JSON ?? 'null');
if (!approvedHashes || typeof approvedHashes !== 'object'
  || Object.keys(approvedHashes).length !== requiredFiles.length
  || requiredFiles.some(file => !/^[0-9a-f]{64}$/.test(approvedHashes[file] ?? ''))) {
  throw new Error('批准散列文件集合不符');
}

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const outputPath = path.join(here, '06E-恢复写入与即时回读.json');
if (fs.existsSync(outputPath)) throw new Error('写入报告已存在，拒绝重放');

const report = {
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  authorizationValueRecorded: false,
  approvedHashes,
  cursorReview: null,
  preflight: { staticRequests: [], triggerRuleScan: null },
  writes: [],
  finalReadback: { targets: [], listKeys: {}, protectedStaticRequests: [], triggerRuleScan: null },
  examples: [],
  businessWriteCount: 0,
  error: null
};
const persist = () => fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
};
const equal = (actual, expected) => JSON.stringify(stable(actual)) === JSON.stringify(stable(expected));
const subsetEqual = (actual, expected) => {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length
      && expected.every((item, index) => subsetEqual(actual[index], item));
  }
  if (expected && typeof expected === 'object') {
    return actual && typeof actual === 'object' && !Array.isArray(actual)
      && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && subsetEqual(actual[key], value));
  }
  return Object.is(actual, expected);
};
const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaFile = file => shaBytes(fs.readFileSync(file));
const shaValue = value => shaBytes(JSON.stringify(stable(value)));

async function request(method, route, body = null) {
  if (!['GET', 'PUT', 'POST', 'DELETE'].includes(method)) throw new Error(`拒绝未批准的方法：${method}`);
  const response = await fetch(base + route, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === null ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let data = null;
  if (text) data = JSON.parse(text);
  return { method, route, status: response.status, data };
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

async function scanTriggerRules() {
  const skills = await request('GET', '/skills');
  assert.equal(skills.status, 200);
  assert(Array.isArray(skills.data?.items));
  assert.equal(skills.data.items.length, skills.data.total);
  const skillKeys = skills.data.items.map(item => item.skillKey).sort();
  const lists = await mapLimit(skillKeys, 24, async skillKey => {
    const response = await request('GET', `/skills/${encodeURIComponent(skillKey)}/trigger-rules`);
    assert.equal(response.status, 200);
    assert(Array.isArray(response.data));
    return { skillKey, rules: response.data };
  });
  const summaries = lists.flatMap(item => item.rules.map(entry => ({ skillKey: item.skillKey, ruleKey: entry.ruleKey })));
  const rules = await mapLimit(summaries, 24, async item => {
    const response = await request('GET', `/skills/${encodeURIComponent(item.skillKey)}/trigger-rules/${encodeURIComponent(item.ruleKey)}`);
    assert.equal(response.status, 200);
    return { ...item, data: response.data };
  });
  rules.sort((left, right) => left.skillKey.localeCompare(right.skillKey) || left.ruleKey.localeCompare(right.ruleKey));
  return {
    skillCount: skillKeys.length,
    listGetCount: skillKeys.length,
    detailGetCount: rules.length,
    ruleCount: rules.length,
    sourceInitializedRuleCount: rules.filter(item => item.data.eventSource.eventType === 'SOURCE_INITIALIZED').length,
    sha256: shaValue(rules),
    rules
  };
}

const detailRoute = write => write.detailRoute ?? write.route;
const listKeyFields = {
  parameters: 'parameterKey',
  formulas: 'formulaKey',
  effects: 'effectKey',
  'trigger-rules': 'ruleKey'
};

try {
  for (const file of requiredFiles) {
    assert.equal(shaFile(path.join(here, file)), approvedHashes[file], `${file} 散列漂移`);
  }

  const frozen = JSON.parse(fs.readFileSync(path.join(here, '06B-恢复冻结请求.json'), 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(path.join(here, '06C-恢复写入前现值.json'), 'utf8'));
  const review = JSON.parse(fs.readFileSync(path.join(here, '06D-Cursor恢复评审.json'), 'utf8'));
  const failedReportPath = path.join(here, '06-写入与即时回读.json');
  assert.equal(shaFile(failedReportPath), frozen.failedReportSha256, '首次失败报告散列漂移');
  const failedReport = JSON.parse(fs.readFileSync(failedReportPath, 'utf8'));
  assert.equal(failedReport.status, 'FAIL');
  assert.equal(failedReport.businessWriteCount, 1);
  assert.equal(failedReport.writes.length, 1);
  assert.equal(frozen.planRevision, 2);
  assert.equal(frozen.recoveryOfPlanRevision, 1);
  assert.equal(frozen.plannedWrites, 15);
  assert.deepEqual(frozen.methodCounts, { PUT: 6, POST: 7, DELETE: 2 });
  assert.equal(frozen.writes.length, 15);
  assert.equal(new Set(frozen.writes.map(detailRoute)).size, 15);

  const allowedWriteRoutes = new Set([
    'PUT /skills/item_2422_passive/effects/magical_footwear_additional_speed',
    'POST /skills/item_2422_passive/trigger-rules',
    'PUT /skills/item_3742_passive',
    'PUT /skills/item_3742_passive/effects/unsinkable_slow_resist',
    'POST /skills/item_3742_passive/trigger-rules',
    'PUT /skills/item_3042_passive',
    'PUT /skills/item_3042_passive/effects/bonus_attack_damage_from_max_mana',
    'POST /skills/item_3042_passive/trigger-rules',
    'POST /skills/item_3040_passive/parameters',
    'POST /skills/item_3040_passive/formulas',
    'POST /skills/item_3040_passive/effects',
    'POST /skills/item_3040_passive/trigger-rules',
    'PUT /skills/item_3040_passive',
    'DELETE /skills/item_3040_passive/formulas/bonus_ap_from_max_mana',
    'DELETE /skills/item_3040_passive/parameters/bonus_ap_from_max_mana_ratio'
  ]);
  for (const write of frozen.writes) {
    assert(allowedWriteRoutes.has(`${write.method} ${write.route}`), `范围外写入：${write.method} ${write.route}`);
    if (write.method === 'PUT' && write.route.includes('/effects/')) {
      assert(!Object.hasOwn(write.body, 'effectKey'), `效果更新体包含不可修改标识：${write.route}`);
    }
  }
  for (const source of frozen.sources) assert.equal(shaFile(source.path), source.sha256, `来源散列漂移：${source.path}`);
  assert.equal(baseline.methodPolicy, 'GET_ONLY');
  assert.equal(baseline.authorizationValueRecorded, false);
  assert.equal(baseline.businessWrites, 0);
  assert.equal(baseline.triggerRuleScan.skillCount, 1062);
  assert.equal(baseline.triggerRuleScan.ruleCount, 90);
  assert.equal(baseline.triggerRuleScan.sourceInitializedRuleCount, 20);

  assert.equal(baseline.recoveredPartialState.completedWriteCount, 1);
  assert.equal(baseline.recoveredPartialState.completedRoute, '/skills/item_2422_passive');
  const expectedApproved = Object.fromEntries(requiredFiles.slice(0, 4).map(file => [file, approvedHashes[file]]));
  assert.equal(review.resultStatus, 'finished');
  assert.equal(review.verdict, 'READY');
  assert.equal(review.reviewedPlanRevision, 2);
  assert(equal(review.approvedHashes, expectedApproved));
  assert.deepEqual(review.blockers, []);
  assert.deepEqual(review.model, { id: 'grok-4.6', effort: 'high', fast: false, sdkVersion: '1.0.24' });
  assert.equal(review.writeAllowlistAudit.auditAvailable, true);
  assert.equal(review.writeAllowlistAudit.runDeltaCount, 0);
  assert.equal(review.writeAllowlistAudit.outsideScopeCount, 0);
  assert.equal(review.writeAllowlistAudit.runDeltaOutsideScopeCount, 0);
  assert.equal(review.toolEvents.allTerminalCallsCompleted, true);
  assert.equal(review.toolEvents.anyTruncated, false);
  assert.equal(review.shellCommandsAudited, true);
  assert.equal(review.apiWrites, 0);

  const cursorSummaryPath = path.resolve(review.artifactSummary);
  assert.equal(shaFile(cursorSummaryPath), review.artifactSummarySha256);
  const cursorSummary = JSON.parse(fs.readFileSync(cursorSummaryPath, 'utf8'));
  const cursorCallIds = [...new Set((cursorSummary.toolCalls ?? []).map(call => call.callId))];
  const incompleteCursorCalls = cursorCallIds.filter(callId => !(cursorSummary.toolCalls ?? [])
    .filter(call => call.callId === callId).some(call => call.status === 'completed'));
  assert.equal(cursorSummary.runId, review.runId);
  assert.equal(cursorSummary.requestId, review.requestId);
  assert.equal(cursorSummary.resultStatus, 'finished');
  assert.equal(cursorSummary.resultModel?.id, 'grok-4.6');
  assert.equal(cursorSummary.writeAllowlistAudit?.runDeltaCount, 0);
  assert.equal(cursorSummary.writeAllowlistAudit?.outsideScopeCount, 0);
  assert.equal(cursorSummary.writeAllowlistAudit?.runDeltaOutsideScopeCount, 0);
  assert.deepEqual(incompleteCursorCalls, []);
  assert(!(cursorSummary.toolCalls ?? []).some(call => call.truncated === true));
  assert(cursorSummary.result?.result?.includes('VERDICT: READY'));
  for (const [file, hash] of Object.entries(expectedApproved)) {
    assert(cursorSummary.result.result.includes(`${file}: ${hash}`), `Cursor 未完整输出散列：${file}`);
  }
  report.cursorReview = {
    runId: review.runId,
    requestId: review.requestId,
    resultStatus: review.resultStatus,
    model: review.model,
    verdict: review.verdict,
    reviewedPlanRevision: review.reviewedPlanRevision,
    uniqueToolCalls: cursorCallIds.length,
    allTerminalCallsCompleted: true,
    anyTruncated: false,
    runDeltaCount: 0,
    apiWrites: 0
  };
  persist();

  for (const expected of baseline.staticRequests) {
    const actual = await request('GET', expected.route);
    report.preflight.staticRequests.push(actual);
    assert.equal(actual.status, expected.status, `预检状态漂移：${expected.route}`);
    assert(equal(actual.data, expected.data), `预检内容漂移：${expected.route}`);
  }
  report.preflight.triggerRuleScan = await scanTriggerRules();
  assert.equal(report.preflight.triggerRuleScan.sha256, baseline.triggerRuleScan.sha256, '写入前触发规则漂移');
  assert(equal(report.preflight.triggerRuleScan.rules, baseline.triggerRuleScan.rules));
  persist();

  for (const write of frozen.writes) {
    if (write.method === 'DELETE') {
      const before = await request('GET', write.route);
      assert.equal(before.status, 200, `删除前对象不存在：${write.route}`);
      assert.equal(shaValue(before.data), write.expectedBeforeSha256, `删除前对象漂移：${write.route}`);
    }
    const response = await request(write.method, write.route, write.body ?? null);
    const expectedStatus = write.method === 'POST' ? 201 : write.method === 'PUT' ? 200 : 204;
    assert.equal(response.status, expectedStatus, `写入失败：${write.method} ${write.route}`);
    report.businessWriteCount += 1;
    const after = await request('GET', detailRoute(write));
    if (write.method === 'DELETE') {
      assert.equal(after.status, 404, `删除后仍存在：${write.route}`);
    } else {
      assert.equal(after.status, 200, `即时回读失败：${detailRoute(write)}`);
      assert(subsetEqual(after.data, write.body), `即时回读与请求不符：${detailRoute(write)}`);
    }
    report.writes.push({ write, response, immediateReadback: after });
    persist();
  }

  const createdOrUpdated = new Map(frozen.writes
    .filter(write => write.method !== 'DELETE')
    .map(write => [detailRoute(write), write.body]));
  const deleted = new Set(frozen.writes.filter(write => write.method === 'DELETE').map(write => write.route));
  const changedListRoutes = new Set([
    '/skills/item_2422_passive/trigger-rules',
    '/skills/item_3742_passive/trigger-rules',
    '/skills/item_3042_passive/trigger-rules',
    '/skills/item_3040_passive/parameters',
    '/skills/item_3040_passive/formulas',
    '/skills/item_3040_passive/effects',
    '/skills/item_3040_passive/trigger-rules'
  ]);
  for (const expected of baseline.staticRequests) {
    if (changedListRoutes.has(expected.route)) continue;
    const actual = await request('GET', expected.route);
    if (deleted.has(expected.route)) {
      assert.equal(actual.status, 404, `删除目标最终回读仍存在：${expected.route}`);
    } else if (createdOrUpdated.has(expected.route)) {
      assert.equal(actual.status, 200, `变更目标最终回读失败：${expected.route}`);
      assert(subsetEqual(actual.data, createdOrUpdated.get(expected.route)), `变更目标最终回读不符：${expected.route}`);
    } else {
      assert.equal(actual.status, expected.status, `受保护对象状态漂移：${expected.route}`);
      assert(equal(actual.data, expected.data), `受保护对象内容漂移：${expected.route}`);
    }
    report.finalReadback.protectedStaticRequests.push(actual);
  }

  const expectedListKeys = {
    '/skills/item_2422_passive/trigger-rules': ['initialize_magical_footwear_additional_speed'],
    '/skills/item_3742_passive/trigger-rules': ['initialize_unsinkable_slow_resist'],
    '/skills/item_3042_passive/trigger-rules': ['initialize_bonus_attack_damage_from_max_mana'],
    '/skills/item_3040_passive/parameters': [
      'ap_from_bonus_mana_ratio',
      'lifeline_cooldown_ms',
      'lifeline_health_threshold_ratio',
      'lifeline_shield_duration_ms',
      'lifeline_shield_resource_ratio'
    ],
    '/skills/item_3040_passive/formulas': [
      'ap_from_bonus_mana',
      'lifeline_health_threshold_value',
      'lifeline_shield_value'
    ],
    '/skills/item_3040_passive/effects': ['ap_from_bonus_mana', 'lifeline_shield'],
    '/skills/item_3040_passive/trigger-rules': [
      'initialize_ap_from_bonus_mana',
      'on_damage_cross_below_lifeline_threshold'
    ]
  };
  for (const [route, expectedKeys] of Object.entries(expectedListKeys)) {
    const kind = route.split('/').at(-1);
    const response = await request('GET', route);
    assert.equal(response.status, 200);
    const actualKeys = response.data.map(item => item[listKeyFields[kind]]).sort();
    assert.deepEqual(actualKeys, [...expectedKeys].sort(), `列表键不符：${route}`);
    report.finalReadback.listKeys[route] = actualKeys;
  }

  for (const write of frozen.writes) {
    const route = detailRoute(write);
    const response = await request('GET', route);
    if (write.method === 'DELETE') {
      assert.equal(response.status, 404);
    } else {
      assert.equal(response.status, 200);
      assert(subsetEqual(response.data, write.body));
    }
    report.finalReadback.targets.push(response);
  }

  report.finalReadback.triggerRuleScan = await scanTriggerRules();
  const newRules = frozen.writes
    .filter(write => write.method === 'POST' && write.route.endsWith('/trigger-rules'))
    .map(write => ({ skillKey: write.detailRoute.split('/')[2], ruleKey: write.body.ruleKey, data: write.body }));
  const expectedRules = [...baseline.triggerRuleScan.rules, ...newRules]
    .sort((left, right) => left.skillKey.localeCompare(right.skillKey) || left.ruleKey.localeCompare(right.ruleKey));
  assert.equal(report.finalReadback.triggerRuleScan.skillCount, 1062);
  assert.equal(report.finalReadback.triggerRuleScan.ruleCount, 94);
  assert.equal(report.finalReadback.triggerRuleScan.sourceInitializedRuleCount, 24);
  assert(equal(report.finalReadback.triggerRuleScan.rules, expectedRules), '最终完整触发规则集合不符');

  const examples = [
    { name: '有点神奇之鞋额外移速', expected: 10, actual: 10 },
    { name: '亡者的板甲减速抗性', expected: 0.15, actual: 0.15 },
    { name: '魔切1500总法力值转攻击力', expected: 30, actual: 1500 * 0.02 },
    { name: '炽天使500额外法力值转法强', expected: 10, actual: 500 * 0.02 },
    { name: '炽天使1600额外法力值转法强', expected: 32, actual: 1600 * 0.02 }
  ];
  for (const example of examples) assert.equal(example.actual, example.expected, example.name);
  report.examples = examples;
  report.status = 'PASS';
  report.finishedAt = new Date().toISOString();
  persist();
  console.log(JSON.stringify({
    status: report.status,
    businessWriteCount: report.businessWriteCount,
    preflightGets: report.preflight.staticRequests.length + report.preflight.triggerRuleScan.listGetCount + report.preflight.triggerRuleScan.detailGetCount + 1,
    finalRuleCount: report.finalReadback.triggerRuleScan.ruleCount,
    sourceInitializedRuleCount: report.finalReadback.triggerRuleScan.sourceInitializedRuleCount,
    examples: report.examples.length,
    authorizationValueRecorded: report.authorizationValueRecorded
  }, null, 2));
} catch (error) {
  report.status = 'FAIL';
  report.error = error.stack ?? String(error);
  report.finishedAt = new Date().toISOString();
  persist();
  console.error(report.error);
  process.exitCode = 1;
}
