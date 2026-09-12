import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(here, '07-Luna独立回读.json');
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const inputFiles = [
  '01-来源与方案.md',
  '02-冻结请求.json',
  '03-来源快照.json',
  '04-写入前现值.json',
  '05-Cursor独立评审.json',
];
const expectedInputHashes = {
  '01-来源与方案.md': '43e46bbd7d3abff6882b5db8981e0a5fd00fb18dd8851eb4cb6704195a84b805',
  '02-冻结请求.json': '20d72445b6247fe7b7a9344ec2f10b9c26f969ab83edf9660df39731ae503350',
  '03-来源快照.json': 'd81dfdd38ae59345b1dadb28a2f13b2f85de b93b581f21c40e34c0643be8b2b3'.replaceAll(' ', ''),
  '04-写入前现值.json': '87674f4f9d22158b3907a3ca979447db1bc1326ad303acc95b65a0401f1d13f4',
  '05-Cursor独立评审.json': 'a60291040ab11ff692bb0aabe2b5f00a23c57a7945d0fb4581caef993f583c89',
};

const report = {
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: 'RUNNING',
  mode: '写后独立回读；纯 GET',
  methodPolicy: 'GET_ONLY',
  authorizationValueRecorded: false,
  apiBase,
  apiWrites: 0,
  businessWriteCount: 0,
  inputFiles: {},
  staticRoutes: null,
  targetValues: null,
  relationImageChecks: null,
  formulaExamples: null,
  ruleScan: null,
  requestSummary: null,
  failures: [],
  error: null,
};

const calls = [];
const failures = [];

function scrub(value) {
  const text = String(value ?? '');
  return token && text.includes(token) ? '[REDACTED]' : text;
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function sha256Value(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
}

function firstDiff(expected, actual, at = '$') {
  if (Object.is(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    return { at, expected, actual };
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      return { at, expected, actual };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDiff(expected[index], actual[index], `${at}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const key of keys) {
    if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) {
      return {
        at: `${at}.${key}`,
        expectedPresent: Object.hasOwn(expected, key),
        actualPresent: Object.hasOwn(actual, key),
      };
    }
    const difference = firstDiff(expected[key], actual[key], `${at}.${key}`);
    if (difference) return difference;
  }
  return null;
}

function subsetDiff(actual, expected, at = '$') {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return { at, expected, actual };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = subsetDiff(actual[index], expected[index], `${at}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
      return { at, expected, actual };
    }
    for (const [key, value] of Object.entries(expected)) {
      if (!Object.hasOwn(actual, key)) return { at: `${at}.${key}`, expectedPresent: true, actualPresent: false };
      const difference = subsetDiff(actual[key], value, `${at}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return Object.is(actual, expected) ? null : { at, expected, actual };
}

function recordFailure(scope, record) {
  const failure = { scope, ...record };
  failures.push(failure);
  return failure;
}

function evaluate(bucket, scope, name, fn, details = {}) {
  try {
    fn();
    const record = { name, passed: true, ...details };
    bucket.push(record);
    return record;
  } catch (error) {
    const record = { name, passed: false, message: scrub(error?.message ?? error), ...details };
    bucket.push(record);
    recordFailure(scope, record);
    return record;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));
}

function rows(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return null;
}

function collectionIdField(route) {
  if (route.endsWith('/parameters')) return 'parameterKey';
  if (route.endsWith('/formulas')) return 'formulaKey';
  if (route.endsWith('/effects')) return 'effectKey';
  if (route.endsWith('/processes')) return 'processKey';
  if (route.endsWith('/internal-states')) return 'stateKey';
  if (route.endsWith('/trigger-rules')) return 'ruleKey';
  return null;
}

function parentCollectionRoute(route) {
  const match = route.match(/^(.*\/(?:parameters|formulas|effects|processes|internal-states|trigger-rules))\/[^/?]+$/);
  return match ? match[1] : null;
}

function entryDetailRoute(entry) {
  return entry.detailRoute ?? entry.route;
}

function entryStableKey(entry) {
  if (entry.method === 'POST') return entry.body?.ruleKey;
  const match = entryDetailRoute(entry).match(/\/(?:parameters|formulas|effects|processes|internal-states|trigger-rules)\/([^/?]+)$/);
  if (match) return decodeURIComponent(match[1]);
  const skill = entryDetailRoute(entry).match(/^\/skills\/([^/?]+)$/);
  return skill ? decodeURIComponent(skill[1]) : null;
}

function targetIdentityDiff(route, actual, entry) {
  if (!actual || typeof actual !== 'object') return { at: '$', expected: entry.body, actual };
  const skill = route.match(/^\/skills\/([^/?]+)$/);
  if (skill && actual.skillKey !== decodeURIComponent(skill[1])) {
    return { at: '$.skillKey', expected: decodeURIComponent(skill[1]), actual: actual.skillKey };
  }
  const component = route.match(/\/(parameters|formulas|effects|processes|internal-states|trigger-rules)\/([^/?]+)$/);
  if (component) {
    const field = {
      parameters: 'parameterKey',
      formulas: 'formulaKey',
      effects: 'effectKey',
      processes: 'processKey',
      'internal-states': 'stateKey',
      'trigger-rules': 'ruleKey',
    }[component[1]];
    const expectedKey = decodeURIComponent(component[2]);
    if (actual[field] !== expectedKey) return { at: `$.${field}`, expected: expectedKey, actual: actual[field] };
  }
  return subsetDiff(actual, entry.body);
}

function projectedDiff(actualRow, body, idField, stableKey) {
  if (!actualRow || actualRow[idField] !== stableKey) {
    return { at: `.${idField}`, expected: stableKey, actual: actualRow?.[idField] };
  }
  for (const [key, value] of Object.entries(body ?? {})) {
    if (!Object.hasOwn(actualRow, key)) continue;
    const difference = firstDiff(value, actualRow[key], `.${key}`);
    if (difference) return difference;
  }
  return null;
}

function collectionDiff(route, beforeData, actualData, entries) {
  const beforeRows = rows(beforeData);
  const actualRows = rows(actualData);
  const idField = collectionIdField(route);
  if (!beforeRows || !actualRows || !idField) return { at: '$', reason: '列表响应结构无法核对' };

  const beforeKeys = beforeRows.map(row => row?.[idField]);
  const actualKeys = actualRows.map(row => row?.[idField]);
  if (beforeKeys.some(key => typeof key !== 'string') || actualKeys.some(key => typeof key !== 'string')) {
    return { at: `$.${idField}`, reason: '列表稳定键缺失或类型错误', expected: beforeKeys, actual: actualKeys };
  }
  if (new Set(beforeKeys).size !== beforeKeys.length || new Set(actualKeys).size !== actualKeys.length) {
    return { at: `$.${idField}`, reason: '列表稳定键重复', expected: beforeKeys, actual: actualKeys };
  }

  const plannedByKey = new Map(entries.map(entry => [entryStableKey(entry), entry]));
  const allowedKeys = new Set(beforeKeys);
  for (const entry of entries) {
    const stableKey = entryStableKey(entry);
    if (entry.method === 'POST') allowedKeys.add(stableKey);
    else if (!beforeKeys.includes(stableKey)) {
      return { at: `$.${idField}`, reason: '更新目标不在写前列表', expected: stableKey, actual: beforeKeys };
    }
  }
  const missing = [...allowedKeys].filter(key => !actualKeys.includes(key));
  const unexpected = actualKeys.filter(key => !allowedKeys.has(key));
  if (missing.length || unexpected.length || actualKeys.length !== allowedKeys.size) {
    return { at: `$.${idField}`, reason: '列表项集合变化', expected: [...allowedKeys], actual: actualKeys, missing, unexpected };
  }

  const beforeByKey = new Map(beforeRows.map(row => [row[idField], row]));
  const actualByKey = new Map(actualRows.map(row => [row[idField], row]));
  for (const [key, beforeRow] of beforeByKey) {
    const actualRow = actualByKey.get(key);
    const planned = plannedByKey.get(key);
    const difference = planned
      ? projectedDiff(actualRow, planned.body, idField, key)
      : firstDiff(beforeRow, actualRow, '$');
    if (difference) return { stableKey: key, difference };
  }
  for (const entry of entries.filter(item => item.method === 'POST')) {
    const key = entryStableKey(entry);
    const difference = projectedDiff(actualByKey.get(key), entry.body, idField, key);
    if (difference) return { stableKey: key, difference };
  }
  if (!Array.isArray(actualData) && Object.hasOwn(actualData, 'total') && actualData.total !== actualRows.length) {
    return { at: '$.total', expected: actualRows.length, actual: actualData.total };
  }
  return null;
}

function validateRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.includes('://') || route.includes('..') || route.includes('#')) {
    throw new Error(`不安全接口路径：${route}`);
  }
}

async function request(method, route) {
  if (method !== 'GET') throw new Error(`只允许 GET 请求，收到 ${String(method)} ${route}`);
  validateRoute(route);
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(apiBase + route, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
    });
    const bodyText = await response.text();
    let data = null;
    let parseError = null;
    if (bodyText) {
      try {
        data = JSON.parse(bodyText);
      } catch (error) {
        parseError = scrub(error?.message ?? error);
        data = { parseError: true, responseBytes: Buffer.byteLength(bodyText) };
      }
    }
    const result = {
      method: 'GET',
      route,
      status: response.status,
      data,
      ...(parseError ? { parseError } : {}),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    calls.push(result);
    return result;
  } catch (error) {
    const result = {
      method: 'GET',
      route,
      status: null,
      data: null,
      error: scrub(error?.message ?? error),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    calls.push(result);
    return result;
  }
}

const get = route => request('GET', route);

async function mapLimit(values, limit, work) {
  const results = new Array(values.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await work(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function callSummary() {
  const methods = {};
  const statuses = {};
  for (const call of calls) {
    methods[call.method] = (methods[call.method] ?? 0) + 1;
    const status = String(call.status);
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
  return {
    totalGets: calls.length,
    methods,
    statuses,
    allRequestsWereGET: calls.every(call => call.method === 'GET'),
    failedRequests: calls.filter(call => call.status === null || call.parseError).map(call => ({
      route: call.route,
      status: call.status,
      ...(call.error ? { error: call.error } : {}),
      ...(call.parseError ? { parseError: call.parseError } : {}),
    })),
  };
}

function persist() {
  report.failures = failures;
  report.requestSummary = callSummary();
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function checkInputFiles() {
  const hashes = {};
  for (const file of inputFiles) {
    const actual = sha256File(path.join(here, file));
    hashes[file] = actual;
    const expected = expectedInputHashes[file];
    if (!expected) throw new Error(`缺少输入文件批准散列：${file}`);
    assert.equal(actual, expected, `${file} 散列漂移`);
  }
  report.inputFiles.hashes = hashes;
}

function checkFrozenInputs(frozen, source, baseline, review, planText) {
  assert(planText.includes('星界驱驰'));
  assert(planText.includes('万世催化石'));
  assert.equal(frozen.planRevision, 1);
  assert.equal(frozen.plannedWrites, 9);
  assert.equal(frozen.writes.length, 9);
  assert.equal(frozen.writes.filter(entry => entry.method === 'PUT').length, 6);
  assert.equal(frozen.writes.filter(entry => entry.method === 'POST').length, 3);
  assert.equal(frozen.capability?.verdict, 'READY');
  assert.equal(frozen.capability?.reviewedPlanRevision, 1);
  assert.equal(source.methodPolicy, 'LOCAL_FILES_AND_GET_ONLY');
  assert.equal(source.authorizationValueRecorded, false);
  assert.equal(baseline.methodPolicy, 'GET_ONLY');
  assert.equal(baseline.authorizationValueRecorded, false);
  assert.equal(baseline.businessWrites, 0);
  assert.equal(baseline.staticRequests.length, 44);
  assert.equal(baseline.triggerRuleScan.skillCount, 1062);
  assert.equal(baseline.triggerRuleScan.ruleCount, 87);
  assert.equal(baseline.triggerRuleScan.targetCategoryConditionCount, 5);
  assert.equal(baseline.triggerRuleScan.damageRuleCount, 3);
  assert.equal(baseline.triggerRuleScan.damageRulesWithTargetCategoryCount, 0);
  assert.equal(baseline.triggerRuleScan.rules.length, 87);
  assert.equal(review.resultStatus, 'finished');
  assert.equal(review.verdict, 'READY');
  assert.equal(review.reviewedPlanRevision, 1);
  assert.equal(review.writeAllowlistAudit?.runDeltaCount, 0);
  assert.equal(review.writeAllowlistAudit?.outsideScopeCount, 0);
  assert.equal(review.writeAllowlistAudit?.runDeltaOutsideScopeCount, 0);
  assert.equal(review.toolEvents?.allTerminalCallsCompleted, true);
  assert.equal(review.toolEvents?.anyTruncated, false);
  assert.equal(review.apiWrites, 0);
  assert.deepEqual(source.acceptedFacts?.item_4629, {
    damageTypeKeys: ['magic', 'real'],
    targetCategory: 'CHAMPION',
    moveSpeed: 20,
    durationMs: 4000,
  });
  assert.deepEqual(source.acceptedFacts?.item_3803, {
    eventType: 'DAMAGE_TAKEN',
    sourceCategory: 'CHAMPION',
    eventValueKey: 'RAW_DAMAGE',
    restoreRatio: 0.1,
  });
}

const expectedTargetRoutes = [
  '/skills/item_4629_passive',
  '/skills/item_4629_passive/effects/spelldance_move_speed',
  '/skills/item_4629_passive/trigger-rules/on_magic_damage_dealt_to_champion',
  '/skills/item_4629_passive/trigger-rules/on_real_damage_dealt_to_champion',
  '/skills/item_3803_passive',
  '/skills/item_3803_passive/parameters/damage_input',
  '/skills/item_3803_passive/formulas/mana_restore_from_damage',
  '/skills/item_3803_passive/effects/mana_from_hero_damage',
  '/skills/item_3803_passive/trigger-rules/on_damage_taken_from_champion_restore_mana',
];

async function main() {
  checkInputFiles();
  const planText = fs.readFileSync(path.join(here, '01-来源与方案.md'), 'utf8');
  const frozen = readJson('02-冻结请求.json');
  const source = readJson('03-来源快照.json');
  const baseline = readJson('04-写入前现值.json');
  const review = readJson('05-Cursor独立评审.json');
  checkFrozenInputs(frozen, source, baseline, review, planText);
  report.inputFiles.planRevision = frozen.planRevision;
  report.inputFiles.baseline = {
    staticRoutes: baseline.staticRequests.length,
    skillCount: baseline.triggerRuleScan.skillCount,
    ruleCount: baseline.triggerRuleScan.ruleCount,
    targetCategoryConditionCount: baseline.triggerRuleScan.targetCategoryConditionCount,
    damageRuleCount: baseline.triggerRuleScan.damageRuleCount,
  };

  const targetEntries = frozen.writes.map(entry => ({ ...entry, detailRoute: entryDetailRoute(entry) }));
  const targetByRoute = new Map();
  for (const entry of targetEntries) {
    if (!['PUT', 'POST'].includes(entry.method)) throw new Error(`冻结请求含不支持方法：${entry.method}`);
    if (targetByRoute.has(entry.detailRoute)) throw new Error(`冻结目标路由重复：${entry.detailRoute}`);
    targetByRoute.set(entry.detailRoute, entry);
  }
  assert.deepEqual([...targetByRoute.keys()].sort(), [...expectedTargetRoutes].sort());

  const staticExpectedByRoute = new Map();
  for (const expected of baseline.staticRequests) {
    assert.equal(expected.method, 'GET', `写前静态路由不是 GET：${expected.route}`);
    if (staticExpectedByRoute.has(expected.route)) throw new Error(`写前静态路由重复：${expected.route}`);
    staticExpectedByRoute.set(expected.route, expected);
  }
  const collectionTargets = new Map();
  for (const entry of targetEntries) {
    const collectionRoute = entry.method === 'POST' ? entry.route : parentCollectionRoute(entry.detailRoute);
    if (!collectionRoute) continue;
    const idField = collectionIdField(collectionRoute);
    const stableKey = entryStableKey(entry);
    if (!idField || typeof stableKey !== 'string') throw new Error(`无法确定目标列表稳定键：${entry.detailRoute}`);
    const list = collectionTargets.get(collectionRoute) ?? [];
    list.push(entry);
    collectionTargets.set(collectionRoute, list);
  }

  const staticResponses = await mapLimit([...staticExpectedByRoute.keys()], 12, get);
  const staticByRoute = new Map(staticResponses.map(response => [response.route, response]));
  const staticRouteChecks = [];
  for (const expected of staticExpectedByRoute.values()) {
    const actual = staticByRoute.get(expected.route);
    const target = targetByRoute.get(expected.route);
    const targetCollection = collectionTargets.get(expected.route);
    let difference = null;
    let category = '静态保护';
    let expectedStatus = expected.status;
    if (target) {
      category = '目标详情';
      expectedStatus = 200;
      if (!actual || actual.status !== expectedStatus) difference = { at: '$.status', expected: expectedStatus, actual: actual?.status ?? null };
      else difference = targetIdentityDiff(expected.route, actual.data, target);
    } else if (targetCollection) {
      category = '目标列表及保护';
      expectedStatus = 200;
      if (!actual || actual.status !== expectedStatus) difference = { at: '$.status', expected: expectedStatus, actual: actual?.status ?? null };
      else difference = collectionDiff(expected.route, expected.data, actual.data, targetCollection);
    } else if (!actual || actual.status !== expectedStatus) {
      difference = { at: '$.status', expected: expectedStatus, actual: actual?.status ?? null };
    } else {
      difference = firstDiff(expected.data, actual.data);
    }
    const record = {
      route: expected.route,
      category,
      expectedStatus,
      actualStatus: actual?.status ?? null,
      passed: !difference,
      ...(difference ? { difference } : {}),
    };
    staticRouteChecks.push(record);
    if (!record.passed) recordFailure('staticRoutes', record);
  }
  report.staticRoutes = {
    expected: staticExpectedByRoute.size,
    checked: staticRouteChecks.length,
    passed: staticRouteChecks.filter(record => record.passed).length,
    failures: staticRouteChecks.filter(record => !record.passed),
    records: staticRouteChecks,
  };

  const targetValueRecords = targetEntries.map(entry => {
    const actual = staticByRoute.get(entry.detailRoute);
    const difference = !actual || actual.status !== 200
      ? { at: '$.status', expected: 200, actual: actual?.status ?? null }
      : targetIdentityDiff(entry.detailRoute, actual.data, entry);
    const record = {
      method: entry.method,
      route: entry.route,
      detailRoute: entry.detailRoute,
      status: actual?.status ?? null,
      passed: !difference,
      data: actual?.data ?? null,
      ...(difference ? { difference } : {}),
    };
    if (!record.passed) recordFailure('targetValues', record);
    return record;
  });
  report.targetValues = {
    expected: 9,
    checked: targetValueRecords.length,
    passed: targetValueRecords.filter(record => record.passed).length,
    records: targetValueRecords,
  };

  const relationImageRoutes = [
    '/equipment-skill-relations?equipmentKey=item_4629',
    '/equipment-skill-relations?equipmentKey=item_3803',
    '/skills/item_4629_passive/representative-image',
    '/skills/item_3803_passive/representative-image',
  ];
  const relationImageChecks = relationImageRoutes.map(route => {
    const expected = staticExpectedByRoute.get(route);
    const actual = staticByRoute.get(route);
    const difference = !expected || !actual || actual.status !== expected.status
      ? { at: '$.status', expected: expected?.status ?? 200, actual: actual?.status ?? null }
      : firstDiff(expected.data, actual.data);
    const record = { route, expectedStatus: expected?.status ?? 200, actualStatus: actual?.status ?? null, passed: !difference, ...(difference ? { difference } : {}) };
    if (!record.passed) recordFailure('relationImageChecks', record);
    return record;
  });
  report.relationImageChecks = {
    expected: relationImageRoutes.length,
    checked: relationImageChecks.length,
    passed: relationImageChecks.filter(record => record.passed).length,
    records: relationImageChecks,
  };

  const skillsResponse = await get('/skills');
  let skillKeys = [];
  const skillListCheck = [];
  evaluate(skillListCheck, 'skillScan', '技能目录返回1062项且总数一致', () => {
    assert.equal(skillsResponse.status, 200);
    assert(Array.isArray(skillsResponse.data?.items));
    assert.equal(skillsResponse.data.items.length, skillsResponse.data.total);
    assert.equal(skillsResponse.data.items.length, 1062);
    skillKeys = skillsResponse.data.items.map(item => item.skillKey);
    assert(skillKeys.every(key => typeof key === 'string' && key.length > 0));
    assert.equal(new Set(skillKeys).size, skillKeys.length);
  }, { status: skillsResponse.status });
  if (skillKeys.length === 0 && Array.isArray(skillsResponse.data?.items)) {
    skillKeys = [...new Set(skillsResponse.data.items.map(item => item.skillKey).filter(key => typeof key === 'string'))];
  }

  const uniqueSkillKeys = [...new Set(skillKeys)].sort((a, b) => a.localeCompare(b));
  const ruleListResponses = await mapLimit(uniqueSkillKeys, 24, async skillKey => {
    const route = `/skills/${encodeURIComponent(skillKey)}/trigger-rules`;
    return { skillKey, response: await get(route) };
  });
  const ruleListChecks = [];
  const ruleRefs = [];
  for (const item of ruleListResponses) {
    const list = rows(item.response.data);
    const record = {
      skillKey: item.skillKey,
      route: item.response.route,
      status: item.response.status,
      count: Array.isArray(list) ? list.length : null,
      passed: item.response.status === 200 && Array.isArray(list),
    };
    if (!record.passed) {
      record.reason = '规则列表未返回200数组';
      recordFailure('ruleLists', record);
    } else {
      for (const row of list) {
        if (typeof row?.ruleKey !== 'string' || row.ruleKey.length === 0) {
          record.passed = false;
          record.reason = '规则列表含缺失稳定键';
          recordFailure('ruleLists', record);
          break;
        }
        ruleRefs.push({ skillKey: item.skillKey, ruleKey: row.ruleKey });
      }
    }
    ruleListChecks.push(record);
  }

  const ruleRefKey = item => `${item.skillKey}|${item.ruleKey}`;
  const refCounts = new Map();
  for (const ref of ruleRefs) refCounts.set(ruleRefKey(ref), (refCounts.get(ruleRefKey(ref)) ?? 0) + 1);
  const duplicateRuleRefs = [...refCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  if (duplicateRuleRefs.length) recordFailure('ruleLists', { name: '规则引用无重复', passed: false, duplicateRuleRefs });
  const uniqueRuleRefs = [...new Map(ruleRefs.map(ref => [ruleRefKey(ref), ref])).values()];

  const ruleDetailResponses = await mapLimit(uniqueRuleRefs, 24, async ref => {
    const route = `/skills/${encodeURIComponent(ref.skillKey)}/trigger-rules/${encodeURIComponent(ref.ruleKey)}`;
    return { ...ref, response: await get(route) };
  });
  const actualRuleByKey = new Map(ruleDetailResponses.map(item => [ruleRefKey(item), item]));
  const baselineRuleByKey = new Map(baseline.triggerRuleScan.rules.map(item => [ruleRefKey(item), item]));
  const newRuleEntries = targetEntries.filter(entry => entry.method === 'POST');
  const newRuleByKey = new Map(newRuleEntries.map(entry => {
    const skillMatch = entry.route.match(/^\/skills\/([^/?]+)\/trigger-rules$/);
    const ref = { skillKey: decodeURIComponent(skillMatch[1]), ruleKey: entry.body.ruleKey };
    return [ruleRefKey(ref), { entry, ...ref }];
  }));
  const ruleDetailChecks = [];
  let existingRulesMatched = 0;
  let newRulesMatched = 0;
  for (const item of ruleDetailResponses) {
    const key = ruleRefKey(item);
    const baselineRule = baselineRuleByKey.get(key);
    const newRule = newRuleByKey.get(key);
    let difference = null;
    let expectedKind = 'unexpected';
    if (baselineRule) {
      expectedKind = 'existing';
      if (item.response.status !== 200) difference = { at: '$.status', expected: 200, actual: item.response.status };
      else difference = firstDiff(baselineRule.data, item.response.data);
      if (!difference) existingRulesMatched += 1;
    } else if (newRule) {
      expectedKind = 'new';
      if (item.response.status !== 200) difference = { at: '$.status', expected: 200, actual: item.response.status };
      else difference = subsetDiff(item.response.data, newRule.entry.body);
      if (!difference) newRulesMatched += 1;
    } else {
      difference = { at: '$', reason: '规则不在写前87条或冻结新增3条中' };
    }
    const record = {
      skillKey: item.skillKey,
      ruleKey: item.ruleKey,
      kind: expectedKind,
      status: item.response.status,
      passed: !difference,
      data: item.response.data,
      ...(difference ? { difference } : {}),
    };
    ruleDetailChecks.push(record);
    if (!record.passed) recordFailure('ruleDetails', record);
  }

  const actualKeys = new Set(uniqueRuleRefs.map(ruleRefKey));
  const baselineKeys = new Set(baselineRuleByKey.keys());
  const newKeys = new Set(newRuleByKey.keys());
  const missingExistingRuleKeys = [...baselineKeys].filter(key => !actualKeys.has(key));
  const actualAddedRuleKeys = [...actualKeys].filter(key => !baselineKeys.has(key));
  const unexpectedAddedRuleKeys = actualAddedRuleKeys.filter(key => !newKeys.has(key));
  const missingNewRuleKeys = [...newKeys].filter(key => !actualKeys.has(key));
  evaluate(ruleListChecks, 'ruleScan', '新增规则集合恰为冻结的3条', () => {
    assert.equal(actualAddedRuleKeys.length, 3);
    assert.deepEqual([...actualAddedRuleKeys].sort(), [...newKeys].sort());
  }, { actualAddedRuleKeys, unexpectedAddedRuleKeys, missingNewRuleKeys });

  const validRuleDetails = ruleDetailResponses
    .filter(item => item.response.status === 200 && item.response.data && typeof item.response.data === 'object')
    .map(item => ({ skillKey: item.skillKey, ruleKey: item.ruleKey, data: item.response.data }));
  const categoryConditionCount = validRuleDetails.reduce((count, item) => count + (item.data.conditionGroups ?? [])
    .flatMap(group => group.conditions ?? [])
    .filter(condition => condition.conditionType === 'TARGET_CATEGORY_CHECK').length, 0);
  const damageEventTypes = new Set(['DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN']);
  const damageRules = validRuleDetails.filter(item => damageEventTypes.has(item.data.eventSource?.eventType));
  const damageRulesWithCategory = damageRules.filter(item => (item.data.conditionGroups ?? [])
    .flatMap(group => group.conditions ?? [])
    .some(condition => condition.conditionType === 'TARGET_CATEGORY_CHECK'));
  const ruleCountChecks = [];
  evaluate(ruleCountChecks, 'ruleScan', '全量规则计数满足90/8/6/3', () => {
    assert.equal(uniqueSkillKeys.length, 1062);
    assert.equal(ruleListResponses.length, 1062);
    assert.equal(uniqueRuleRefs.length, 90);
    assert.equal(categoryConditionCount, 8);
    assert.equal(damageRules.length, 6);
    assert.equal(damageRulesWithCategory.length, 3);
  }, {
    skillCount: uniqueSkillKeys.length,
    listGetCount: ruleListResponses.length,
    detailGetCount: ruleDetailResponses.length,
    ruleCount: uniqueRuleRefs.length,
    targetCategoryConditionCount: categoryConditionCount,
    damageRuleCount: damageRules.length,
    damageRulesWithTargetCategoryCount: damageRulesWithCategory.length,
  });
  evaluate(ruleCountChecks, 'ruleScan', '既有87条规则逐条与04完全一致', () => {
    assert.equal(baselineRuleByKey.size, 87);
    assert.equal(existingRulesMatched, 87);
    assert.equal(missingExistingRuleKeys.length, 0);
  }, { expected: 87, matched: existingRulesMatched, missingExistingRuleKeys });
  evaluate(ruleCountChecks, 'ruleScan', '新增3条规则详情均与冻结载荷一致', () => {
    assert.equal(newRulesMatched, 3);
    assert.equal(missingNewRuleKeys.length, 0);
  }, { expected: 3, matched: newRulesMatched, missingNewRuleKeys });

  const detailByKey = new Map(ruleDetailResponses.map(item => [ruleRefKey(item), item.response]));
  const semanticRuleChecks = [];
  const semanticSpecs = [
    {
      key: 'item_4629_passive|on_magic_damage_dealt_to_champion',
      eventType: 'DAMAGE_DEALT',
      damageTypeKey: 'magic',
      effectKey: 'spelldance_move_speed',
    },
    {
      key: 'item_4629_passive|on_real_damage_dealt_to_champion',
      eventType: 'DAMAGE_DEALT',
      damageTypeKey: 'real',
      effectKey: 'spelldance_move_speed',
    },
    {
      key: 'item_3803_passive|on_damage_taken_from_champion_restore_mana',
      eventType: 'DAMAGE_TAKEN',
      damageTypeKey: null,
      effectKey: 'mana_from_hero_damage',
      rawDamageBinding: true,
    },
  ];
  for (const spec of semanticSpecs) {
    evaluate(semanticRuleChecks, 'targetRules', spec.key, () => {
      const response = detailByKey.get(spec.key);
      assert.equal(response?.status, 200);
      const rule = response.data;
      assert.equal(rule.eventSource?.eventType, spec.eventType);
      assert.equal(rule.eventSource?.detail?.damageTypeKey, spec.damageTypeKey);
      const categoryConditions = (rule.conditionGroups ?? [])
        .flatMap(group => group.conditions ?? [])
        .filter(condition => condition.conditionType === 'TARGET_CATEGORY_CHECK');
      assert.equal(categoryConditions.length, 1);
      assert.deepEqual(categoryConditions[0].detail, { categories: ['CHAMPION'] });
      assert.equal(rule.actions?.length, 1);
      const action = rule.actions[0];
      assert.equal(action.actionType, 'EXECUTE_EFFECT');
      assert.equal(action.targetContext, 'CURRENT_TARGET');
      assert.equal(action.detail?.effectKey, spec.effectKey);
      assert.equal(rule.perTargetCooldown, null);
      assert.equal(rule.maxTriggersPerProcess, null);
      if (spec.rawDamageBinding) {
        assert.deepEqual(action.runtimeInputBindings, [{
          bindingKey: 'bind_raw_damage',
          parameterKey: 'damage_input',
          sourceType: 'EVENT_VALUE',
          detail: { eventValueKey: 'RAW_DAMAGE' },
        }]);
      } else {
        assert.deepEqual(action.runtimeInputBindings, []);
      }
    });
  }

  const targetDataByRoute = new Map(targetValueRecords.map(record => [record.detailRoute, record.data]));
  const formulaChecks = [];
  const ratioRoute = '/skills/item_3803_passive/parameters/mana_restore_ratio_from_damage';
  const rawInputRoute = '/skills/item_3803_passive/parameters/damage_input';
  const moveSpeedRoute = '/skills/item_4629_passive/parameters/move_speed_bonus';
  const durationRoute = '/skills/item_4629_passive/parameters/move_speed_duration_ms';
  const formulaRoute = '/skills/item_3803_passive/formulas/mana_restore_from_damage';
  const ratioData = staticByRoute.get(ratioRoute)?.data;
  const rawInputData = targetDataByRoute.get(rawInputRoute);
  const moveSpeedData = staticByRoute.get(moveSpeedRoute)?.data;
  const durationData = staticByRoute.get(durationRoute)?.data;
  const formulaData = targetDataByRoute.get(formulaRoute);
  const formulaExamples = {
    rawDamage: 100,
    restoreRatio: ratioData?.fixedValue ?? null,
    expectedMana: 10,
    actualMana: typeof ratioData?.fixedValue === 'number' ? 100 * ratioData.fixedValue : null,
    moveSpeed: moveSpeedData?.fixedValue ?? null,
    durationMs: durationData?.fixedValue ?? null,
    formulaKey: formulaData?.formulaKey ?? null,
  };
  evaluate(formulaChecks, 'formulaExamples', 'RAW_DAMAGE 100按10%回蓝为10', () => {
    assert.equal(ratioData?.fixedValue, 0.1);
    assert.equal(rawInputData?.valueMode, 'RUNTIME_INPUT');
    assert.equal(rawInputData?.valueType, 'DECIMAL');
    assert.equal(rawInputData?.fixedValue, null);
    assert.equal(100 * ratioData.fixedValue, 10);
    assert.equal(formulaData?.expression?.nodeType, 'OPERATION');
    assert.equal(formulaData?.expression?.operation, 'MULTIPLY');
    assert.deepEqual(formulaData?.expression?.operands, [
      { nodeType: 'PARAMETER', parameterKey: 'damage_input' },
      { nodeType: 'PARAMETER', parameterKey: 'mana_restore_ratio_from_damage' },
    ]);
  }, formulaExamples);
  evaluate(formulaChecks, 'formulaExamples', '星界驱驰固定20点移速且持续4000毫秒', () => {
    assert.equal(moveSpeedData?.fixedValue, 20);
    assert.equal(durationData?.fixedValue, 4000);
  }, formulaExamples);

  report.formulaExamples = {
    ...formulaExamples,
    checks: formulaChecks,
  };
  report.ruleScan = {
    expected: {
      skillCount: 1062,
      existingRuleCount: 87,
      newRuleCount: 3,
      totalRuleCount: 90,
      targetCategoryConditionCount: 8,
      damageRuleCount: 6,
      damageRulesWithTargetCategoryCount: 3,
    },
    actual: {
      skillCount: uniqueSkillKeys.length,
      listGetCount: ruleListResponses.length,
      detailGetCount: ruleDetailResponses.length,
      ruleCount: uniqueRuleRefs.length,
      existingRulesMatched,
      newRulesMatched,
      targetCategoryConditionCount: categoryConditionCount,
      damageRuleCount: damageRules.length,
      damageRulesWithTargetCategoryCount: damageRulesWithCategory.length,
      sha256: sha256Value(validRuleDetails.sort((a, b) => ruleRefKey(a).localeCompare(ruleRefKey(b)))),
    },
    listChecks: ruleListChecks,
    countChecks: ruleCountChecks,
    semanticChecks: semanticRuleChecks,
    detailChecks: ruleDetailChecks,
  };

  report.status = failures.length === 0 ? 'PASS' : 'FAILED';
  report.completedAt = new Date().toISOString();
  persist();
  const summary = {
    status: report.status,
    authorizationValueRecorded: false,
    apiWrites: 0,
    totalGets: report.requestSummary.totalGets,
    staticRoutes: `${report.staticRoutes.passed}/${report.staticRoutes.checked}`,
    targetValues: `${report.targetValues.passed}/${report.targetValues.checked}`,
    relationImageChecks: `${report.relationImageChecks.passed}/${report.relationImageChecks.checked}`,
    rules: report.ruleScan.actual,
    failures: failures.length,
    output: outputPath,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  report.status = 'FAILED';
  report.error = { message: scrub(error?.message ?? error) };
  report.completedAt = new Date().toISOString();
  persist();
  process.stderr.write(`${JSON.stringify({ status: report.status, apiWrites: 0, error: report.error.message })}\n`);
  process.exitCode = 1;
}
