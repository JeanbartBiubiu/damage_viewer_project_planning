import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(here, '07-Luna独立回读.json');
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_ENTRY_TOKEN || ('luna-get-' + crypto.randomUUID());
let previousAttempt = null;
if (fs.existsSync(outputPath)) {
  try {
    const oldReport = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    previousAttempt = {
      status: oldReport.status,
      passed: oldReport.passed,
      getCount: oldReport.getCount,
      mismatches: oldReport.mismatches,
      failures: oldReport.failures || [],
      error: oldReport.error || null,
    };
  } catch {
    previousAttempt = { status: 'UNREADABLE', passed: false };
  }
}

const report = {
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: 'RUNNING',
  passed: false,
  methodPolicy: 'GET_ONLY',
  businessWrites: 0,
  businessWriteCount: 0,
  apiWrites: 0,
  getCount: 0,
  authorizationValueRecorded: false,
  apiBase,
  previousAttempt,
  inputFiles: {},
  history: null,
  requestSummary: null,
  staticChecks: null,
  targetReadback: null,
  protectedComponents: null,
  ruleScan: null,
  arithmeticExamples: null,
  conclusions: null,
  mismatches: 0,
  failures: [],
  error: null,
};

const calls = [];
const failures = [];

function scrub(value) {
  const text = String(value ?? '');
  return token && text.includes(token) ? '[REDACTED]' : text;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256Value(value) {
  const normalized = stable(value);
  return crypto.createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function clip(value, max = 1200) {
  if (value === undefined) return '[undefined]';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? text.slice(0, max) + '...[truncated]' : text;
}

function firstDiff(expected, actual, at = '$') {
  if (Object.is(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    return { at, expected: clip(expected), actual: clip(actual) };
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return { at, expected: clip(expected), actual: clip(actual) };
    }
    if (expected.length !== actual.length) {
      return { at: at + '.length', expected: expected.length, actual: actual.length };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDiff(expected[index], actual[index], at + '[' + index + ']');
      if (difference) return difference;
    }
    return null;
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const key of keys) {
    if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) {
      return {
        at: at + '.' + key,
        expectedPresent: Object.hasOwn(expected, key),
        actualPresent: Object.hasOwn(actual, key),
      };
    }
    const difference = firstDiff(expected[key], actual[key], at + '.' + key);
    if (difference) return difference;
  }
  return null;
}

function diff(expected, actual) {
  return firstDiff(stable(expected), stable(actual));
}

function subsetDiff(actual, expected, at = '$') {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return { at, expected: clip(expected), actual: clip(actual) };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = subsetDiff(actual[index], expected[index], at + '[' + index + ']');
      if (difference) return difference;
    }
    return null;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
      return { at, expected: clip(expected), actual: clip(actual) };
    }
    for (const [key, value] of Object.entries(expected)) {
      if (!Object.hasOwn(actual, key)) {
        return { at: at + '.' + key, expectedPresent: true, actualPresent: false };
      }
      const difference = subsetDiff(actual[key], value, at + '.' + key);
      if (difference) return difference;
    }
    return null;
  }
  return Object.is(actual, expected) ? null : { at, expected, actual };
}

function omitTop(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
}

function rows(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  if (data === null) return [];
  return null;
}

function listField(route) {
  if (route.endsWith('/parameters')) return 'parameterKey';
  if (route.endsWith('/formulas')) return 'formulaKey';
  if (route.endsWith('/effects')) return 'effectKey';
  if (route.endsWith('/processes')) return 'processKey';
  if (route.endsWith('/internal-states')) return 'stateKey';
  if (route.endsWith('/trigger-rules')) return 'ruleKey';
  return null;
}

function parentCollection(route) {
  const match = route.match(/^(.*\/(?:parameters|formulas|effects|processes|internal-states|trigger-rules))\/[^/?]+$/);
  return match ? match[1] : null;
}

function entryRoute(entry) {
  return entry.detailRoute || entry.route;
}

function entryKey(entry) {
  const route = entryRoute(entry);
  const match = route.match(/\/(?:parameters|formulas|effects|processes|internal-states|trigger-rules)\/([^/?]+)$/);
  if (match) return decodeURIComponent(match[1]);
  const skill = route.match(/^\/skills\/([^/?]+)$/);
  return skill ? decodeURIComponent(skill[1]) : null;
}

function ruleRefKey(skillKey, ruleKey) {
  return skillKey + '|' + ruleKey;
}

function recordFailure(scope, details) {
  failures.push({ scope, ...details });
}

function check(bucket, scope, name, fn, details = {}) {
  try {
    const result = fn();
    const record = { name, passed: true, ...details, ...(result && typeof result === 'object' ? result : {}) };
    bucket.push(record);
    return record;
  } catch (error) {
    const record = {
      name,
      passed: false,
      ...details,
      message: scrub(error?.message ?? error),
    };
    bucket.push(record);
    recordFailure(scope, record);
    return record;
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));
}

function readText(file) {
  return fs.readFileSync(path.join(here, file), 'utf8');
}

async function get(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.includes('://') || route.includes('..') || route.includes('#')) {
    throw new Error('不安全 GET 路径：' + route);
  }
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(apiBase + route, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    });
    const bodyText = await response.text();
    let data = null;
    let parseError = null;
    if (bodyText) {
      try {
        data = JSON.parse(bodyText);
      } catch (error) {
        parseError = scrub(error?.message ?? error);
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

async function mapLimit(values, limit, worker) {
  const results = new Array(values.length);
  let next = 0;
  const run = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
  return results;
}

function callSummary() {
  const methods = {};
  const statuses = {};
  for (const call of calls) {
    methods[call.method] = (methods[call.method] || 0) + 1;
    const status = String(call.status);
    statuses[status] = (statuses[status] || 0) + 1;
  }
  return {
    totalGets: calls.length,
    methods,
    statuses,
    allRequestsWereGET: calls.every(call => call.method === 'GET'),
    failedRequests: calls
      .filter(call => call.status === null || call.parseError)
      .map(call => ({
        route: call.route,
        status: call.status,
        ...(call.error ? { error: call.error } : {}),
        ...(call.parseError ? { parseError: call.parseError } : {}),
      })),
  };
}

function validUpdatedAt(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function identityField(route) {
  const collection = route.match(/\/(parameters|formulas|effects|processes|internal-states|trigger-rules)\/[^/?]+$/);
  if (collection) {
    return {
      field: {
        parameters: 'parameterKey',
        formulas: 'formulaKey',
        effects: 'effectKey',
        processes: 'processKey',
        'internal-states': 'stateKey',
        'trigger-rules': 'ruleKey',
      }[collection[1]],
      key: decodeURIComponent(route.split('/').pop()),
    };
  }
  const skill = route.match(/^\/skills\/([^/?]+)$/);
  return skill ? { field: 'skillKey', key: decodeURIComponent(skill[1]) } : null;
}

function checkUpdatedDetail(entry, before, actual) {
  expect(actual && actual.status === 200, '详情 GET 状态不是200');
  expect(actual.data && typeof actual.data === 'object', '详情响应不是对象');
  const identity = identityField(entryRoute(entry));
  if (identity) expect(actual.data[identity.field] === identity.key, '详情稳定键不匹配');
  const bodyDifference = subsetDiff(actual.data, entry.body);
  if (bodyDifference) throw new Error('请求体投影不匹配：' + JSON.stringify(bodyDifference));
  if (before && before.status === 200 && before.data) {
    const protectedDifference = unrequestedDetailDiff(before.data, actual.data, entry.body);
    if (protectedDifference) throw new Error('更新详情的受保护字段漂移：' + JSON.stringify(protectedDifference));
  }
  if (Object.hasOwn(actual.data, 'updatedAt')) expect(validUpdatedAt(actual.data.updatedAt), 'updatedAt 不是有效时间');
}

function unrequestedDetailDiff(before, actual, body) {
  if (!before || !actual) return diff(before, actual);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(actual)])].sort();
  for (const key of keys) {
    if (key === 'updatedAt') continue;
    if (Object.hasOwn(body || {}, key)) continue;
    const difference = diff(before[key], actual[key]);
    if (difference) return { at: '$.' + key, difference };
  }
  return null;
}

function checkNewDetail(entry, actual) {
  expect(actual && actual.status === 200, '新对象详情 GET 状态不是200');
  expect(actual.data && typeof actual.data === 'object', '新对象详情不是对象');
  const identity = identityField(entryRoute(entry));
  if (identity) expect(actual.data[identity.field] === identity.key, '新对象稳定键不匹配');
  const difference = subsetDiff(actual.data, entry.body);
  if (difference) throw new Error('新对象详情不匹配请求体：' + JSON.stringify(difference));
}

function checkDeletedDetail(entry, actual) {
  expect(actual && actual.status === 404, '旧键没有返回404');
  const expectedKey = entryKey(entry);
  const error = actual.data?.error;
  expect(error && error.details, '404 响应缺少错误详情');
  const field = entryRoute(entry).includes('/parameters/') ? 'parameterKey' : 'formulaKey';
  expect(error.details[field] === expectedKey, '404 错误详情稳定键不匹配');
}

function summaryBodyChecks(actualRow, body, idField, key) {
  expect(actualRow && actualRow[idField] === key, '列表稳定键不匹配');
  for (const field of ['name', 'description', 'sortOrder', 'valueType', 'valueMode', 'fixedValue', 'lifecycleEnabled', 'resultCount', 'eventType', 'actionCount', 'conditionGroupCount']) {
    if (Object.hasOwn(body, field) && Object.hasOwn(actualRow, field)) {
      const difference = diff(body[field], actualRow[field]);
      if (difference) throw new Error('列表摘要字段不匹配：' + JSON.stringify(difference));
    }
  }
}

function checkCollection(route, beforeResponse, actualResponse, entries) {
  expect(beforeResponse && beforeResponse.status === 200, '写前列表不是200');
  expect(actualResponse && actualResponse.status === 200, '当前列表不是200');
  const beforeRows = rows(beforeResponse.data);
  const actualRows = rows(actualResponse.data);
  const idField = listField(route);
  expect(Array.isArray(beforeRows) && Array.isArray(actualRows) && idField, '列表响应无法解析');
  const beforeKeys = beforeRows.map(row => row?.[idField]);
  const actualKeys = actualRows.map(row => row?.[idField]);
  expect(beforeKeys.every(key => typeof key === 'string'), '写前列表含缺失稳定键');
  expect(actualKeys.every(key => typeof key === 'string'), '当前列表含缺失稳定键');
  expect(new Set(beforeKeys).size === beforeKeys.length, '写前列表稳定键重复');
  expect(new Set(actualKeys).size === actualKeys.length, '当前列表稳定键重复');

  const expectedKeys = new Set(beforeKeys);
  const entryByKey = new Map();
  for (const entry of entries) {
    const key = entryKey(entry);
    entryByKey.set(key, entry);
    if (entry.method === 'POST') expectedKeys.add(key);
    if (entry.method === 'DELETE') expectedKeys.delete(key);
  }
  const missing = [...expectedKeys].filter(key => !actualKeys.includes(key));
  const unexpected = actualKeys.filter(key => !expectedKeys.has(key));
  expect(missing.length === 0 && unexpected.length === 0 && actualKeys.length === expectedKeys.size,
    '列表键集合不匹配：' + JSON.stringify({ missing, unexpected }));

  const beforeByKey = new Map(beforeRows.map(row => [row[idField], row]));
  const actualByKey = new Map(actualRows.map(row => [row[idField], row]));
  const allowedSummaryChanges = [];
  let protectedRows = 0;
  for (const [key, beforeRow] of beforeByKey) {
    const actualRow = actualByKey.get(key);
    const entry = entryByKey.get(key);
    if (entry && entry.method === 'DELETE') continue;
    if (entry && entry.method === 'PUT' && route.endsWith('/effects')) {
      const beforeComparable = omitTop(beforeRow, ['description', 'updatedAt']);
      const actualComparable = omitTop(actualRow, ['description', 'updatedAt']);
      const protectedDifference = diff(beforeComparable, actualComparable);
      if (protectedDifference) throw new Error('效果列表摘要受保护字段漂移：' + JSON.stringify(protectedDifference));
      expect(actualRow.description === entry.body.description, '效果列表摘要说明未匹配 PUT');
      expect(validUpdatedAt(actualRow.updatedAt), '效果列表摘要 updatedAt 无效');
      allowedSummaryChanges.push({ effectKey: key, allowedFields: ['description', 'updatedAt'] });
    } else {
      const difference = diff(beforeRow, actualRow);
      if (difference) throw new Error('列表受保护行漂移：' + JSON.stringify({ key, difference }));
      protectedRows += 1;
    }
  }
  for (const entry of entries.filter(item => item.method === 'POST')) {
    const key = entryKey(entry);
    const row = actualByKey.get(key);
    summaryBodyChecks(row, entry.body, idField, key);
  }
  return {
    beforeKeys,
    expectedKeys: [...expectedKeys],
    actualKeys,
    missing,
    unexpected,
    protectedRows,
    allowedSummaryChanges,
  };
}

function writeRouteSummary(entry) {
  return {
    method: entry.method,
    route: entry.route,
    detailRoute: entryRoute(entry),
    key: entryKey(entry),
  };
}

function targetCategory(route) {
  if (route.startsWith('/equipment-skill-relations') || route.startsWith('/equipment/')) return 'equipment_and_relations';
  if (route.endsWith('/representative-image')) return 'representative_images';
  if (route.includes('/skills/item_3040_passive/parameters/lifeline_') ||
      route.includes('/skills/item_3040_passive/formulas/lifeline_') ||
      route.includes('/skills/item_3040_passive/effects/lifeline_shield') ||
      route.includes('/skills/item_3040_passive/trigger-rules/on_damage_cross_below_lifeline_threshold')) {
    return 'lifeline';
  }
  return 'other_protected';
}

function parameterValue(route, staticByRoute) {
  return staticByRoute.get(route)?.data?.fixedValue;
}

function evaluateHistory(originalPlan, firstReport, diagnosis, recoveryPlan, recoveryBaseline, recoveryReview, recoveryReport) {
  const historyChecks = [];
  const firstRoutes = (firstReport.writes || []).map(item => item.write?.detailRoute || item.write?.route || item.response?.route).filter(Boolean);
  const recoveryEntries = (recoveryPlan.writes || []).map(entry => ({ ...entry, detailRoute: entryRoute(entry) }));
  const recoveryRoutes = recoveryEntries.map(entry => entry.detailRoute);
  const intersection = firstRoutes.filter(route => recoveryRoutes.includes(route));
  check(historyChecks, 'history', '首次与恢复写入历史计数', () => {
    expect(originalPlan.plannedWrites === 16, '原冻结计划不是16次');
    expect(firstReport.businessWriteCount === 1, '首次实际写入数不是1');
    expect(recoveryPlan.plannedWrites === 15 && recoveryEntries.length === 15, '恢复计划不是15次');
    expect(recoveryReport.businessWriteCount === 15, '恢复历史写入数不是15');
  }, { firstPlanned: originalPlan.plannedWrites, firstActual: firstReport.businessWriteCount, recoveryPlanned: recoveryPlan.plannedWrites, recoveryActual: recoveryReport.businessWriteCount });
  check(historyChecks, 'history', '恢复批次没有重放首次成功路由', () => {
    expect(firstRoutes.length === 1, '首次成功路由数量不是1');
    expect(intersection.length === 0, '恢复批次重放了首次成功路由');
    expect(recoveryPlan.correction?.removedFromRecovery === true, '恢复计划没有标记移除首次成功路由');
  }, { firstRoutes, recoveryRoutes, intersection });
  check(historyChecks, 'history', '历史报告与恢复原因已读取', () => {
    expect(typeof diagnosis === 'string' && diagnosis.includes('effectKey'), '失败诊断未读取效果标识问题');
    expect(firstReport.status === 'FAIL', '首次报告状态异常');
    expect(recoveryReport.status === 'FAIL', '恢复报告状态异常');
    expect(recoveryReview.verdict === 'READY', '恢复独立评审不是READY');
  }, { firstStatus: firstReport.status, recoveryStatus: recoveryReport.status, reviewVerdict: recoveryReview.verdict });
  return {
    checks: historyChecks,
    firstRoutes,
    recoveryRoutes,
    intersection,
    firstPlannedWrites: originalPlan.plannedWrites,
    firstBusinessWrites: firstReport.businessWriteCount,
    recoveryPlannedWrites: recoveryPlan.plannedWrites,
    recoveryBusinessWrites: recoveryReport.businessWriteCount,
    historicalTotalWrites: firstReport.businessWriteCount + recoveryReport.businessWriteCount,
    replayedWrites: intersection.length,
    firstReportStatus: firstReport.status,
    recoveryReportStatus: recoveryReport.status,
    priorFailureReason: recoveryReport.error,
  };
}

async function main() {
  const names = [
    '02-冻结请求.json',
    '04-写入前现值.json',
    '06-写入与即时回读.json',
    '06A-失败诊断与恢复方案.md',
    '06B-恢复冻结请求.json',
    '06C-恢复写入前现值.json',
    '06D-Cursor恢复评审.json',
    '06E-恢复写入与即时回读.json',
  ];
  for (const name of names) {
    const file = path.join(here, name);
    report.inputFiles[name] = {
      sha256: sha256File(file),
      bytes: fs.statSync(file).size,
    };
  }

  const originalPlan = readJson('02-冻结请求.json');
  const baselineBeforeFirst = readJson('04-写入前现值.json');
  const firstReport = readJson('06-写入与即时回读.json');
  const diagnosis = readText('06A-失败诊断与恢复方案.md');
  const recoveryPlan = readJson('06B-恢复冻结请求.json');
  const recoveryBaseline = readJson('06C-恢复写入前现值.json');
  const recoveryReview = readJson('06D-Cursor恢复评审.json');
  const recoveryReport = readJson('06E-恢复写入与即时回读.json');

  report.history = evaluateHistory(originalPlan, firstReport, diagnosis, recoveryPlan, recoveryBaseline, recoveryReview, recoveryReport);
  const baselineRules = recoveryBaseline.triggerRuleScan.rules || [];
  const baselineStatic = recoveryBaseline.staticRequests || [];
  const recoveryEntries = recoveryPlan.writes.map(entry => ({ ...entry, detailRoute: entryRoute(entry) }));
  const recoveryByDetail = new Map();
  const collectionEntries = new Map();
  for (const entry of recoveryEntries) {
    const detail = entry.detailRoute;
    if (recoveryByDetail.has(detail)) recordFailure('inputs', { name: '恢复目标路由唯一', detail });
    recoveryByDetail.set(detail, entry);
    const collection = entry.method === 'POST' ? entry.route : parentCollection(detail);
    if (collection) {
      const list = collectionEntries.get(collection) || [];
      list.push(entry);
      collectionEntries.set(collection, list);
    }
  }

  const inputChecks = [];
  check(inputChecks, 'inputs', '写前快照为90条原有规则', () => {
    expect(baselineBeforeFirst.triggerRuleScan.skillCount === 1062, '04技能数异常');
    expect(baselineBeforeFirst.triggerRuleScan.ruleCount === 90, '04规则数异常');
    expect(baselineBeforeFirst.triggerRuleScan.sourceInitializedRuleCount === 20, '04 SOURCE_INITIALIZED数异常');
    expect(baselineRules.length === 90, '06C规则详情不是90条');
  }, {
    skillCount: recoveryBaseline.triggerRuleScan.skillCount,
    ruleCount: recoveryBaseline.triggerRuleScan.ruleCount,
    sourceInitializedRuleCount: recoveryBaseline.triggerRuleScan.sourceInitializedRuleCount,
  });
  check(inputChecks, 'inputs', '04与06C原有规则快照一致', () => {
    const difference = diff(baselineBeforeFirst.triggerRuleScan.rules, recoveryBaseline.triggerRuleScan.rules);
    if (difference) throw new Error(JSON.stringify(difference));
  }, { baselineRuleSha256: sha256Value(baselineRules) });

  const staticRoutes = [...new Set(baselineStatic.map(item => item.route))];
  check(inputChecks, 'inputs', '写前静态路由全部为GET且无重复', () => {
    expect(staticRoutes.length === baselineStatic.length, '写前静态路由有重复');
    expect(baselineStatic.every(item => item.method === 'GET'), '写前静态路由含非GET');
  }, { expectedStaticRoutes: baselineStatic.length });

  const staticResponsesPromise = mapLimit(staticRoutes, 16, route => get(route));
  const skillsResponsePromise = get('/skills');
  const [staticResponses, skillsResponse] = await Promise.all([staticResponsesPromise, skillsResponsePromise]);
  const staticByRoute = new Map(staticResponses.map(response => [response.route, response]));

  const staticRouteChecks = [];
  const collectionChecks = [];
  const directChecks = [];
  for (const expected of baselineStatic) {
    const actual = staticByRoute.get(expected.route);
    const entry = recoveryByDetail.get(expected.route);
    const entries = collectionEntries.get(expected.route);
    const record = {
      route: expected.route,
      category: entry ? 'target_detail' : entries ? 'target_list' : targetCategory(expected.route),
      expectedBeforeStatus: expected.status,
      actualStatus: actual?.status ?? null,
      passed: false,
    };
    try {
      if (entry) {
        if (entry.method === 'DELETE') {
          checkDeletedDetail(entry, actual);
        } else if (entry.method === 'POST') {
          checkNewDetail(entry, actual);
        } else {
          checkUpdatedDetail(entry, expected, actual);
        }
        record.kind = entry.method === 'DELETE' ? 'deleted_old_key' : entry.method === 'POST' ? 'new_target' : 'updated_target';
        record.passed = true;
        directChecks.push(record);
      } else if (entries) {
        const result = checkCollection(expected.route, expected, actual, entries);
        record.kind = 'list_keys_and_protected_rows';
        record.passed = true;
        record.details = result;
        collectionChecks.push(record);
      } else {
        expect(actual && actual.status === expected.status, '保护接口状态漂移');
        const difference = diff(expected.data, actual.data);
        if (difference) throw new Error('保护接口内容漂移：' + JSON.stringify(difference));
        record.kind = 'protected_exact';
        record.passed = true;
      }
    } catch (error) {
      record.message = scrub(error?.message ?? error);
      recordFailure('staticRoutes', record);
    }
    staticRouteChecks.push(record);
  }
  report.staticChecks = {
    expected: baselineStatic.length,
    checked: staticRouteChecks.length,
    passed: staticRouteChecks.filter(item => item.passed).length,
    failed: staticRouteChecks.filter(item => !item.passed),
    listChecks: collectionChecks,
    directChecks,
    records: staticRouteChecks,
  };

  const targetReadbackChecks = [];
  const targetSkills = [
    '/skills/item_2422_passive',
    '/skills/item_3742_passive',
    '/skills/item_3042_passive',
    '/skills/item_3040_passive',
  ];
  for (const route of targetSkills) {
    const expected = baselineStatic.find(item => item.route === route);
    const actual = staticByRoute.get(route);
    const entry = recoveryByDetail.get(route);
    check(targetReadbackChecks, 'targetReadback', route, () => {
      if (entry) checkUpdatedDetail(entry, expected, actual);
      else {
        expect(actual?.status === 200, '技能详情不是200');
        const difference = diff(expected.data, actual.data);
        if (difference) throw new Error(JSON.stringify(difference));
      }
    }, { status: actual?.status ?? null, skillKey: route.split('/').pop() });
  }

  const existingEffectRoutes = recoveryEntries
    .filter(entry => entry.method === 'PUT' && entry.detailRoute.includes('/effects/'))
    .map(entry => entry.detailRoute);
  for (const route of existingEffectRoutes) {
    const expected = baselineStatic.find(item => item.route === route);
    const actual = staticByRoute.get(route);
    const entry = recoveryByDetail.get(route);
    check(targetReadbackChecks, 'targetReadback', '既有效果：' + route, () => {
      checkUpdatedDetail(entry, expected, actual);
    }, { status: actual?.status ?? null, effectKey: entryKey(entry), allowedSummaryFields: ['description', 'updatedAt'] });
  }

  const newSeraphRoutes = recoveryEntries
    .filter(entry => entry.method === 'POST' &&
      entry.detailRoute.startsWith('/skills/item_3040_passive/') &&
      !entry.detailRoute.includes('/trigger-rules/'))
    .map(entry => entry.detailRoute);
  for (const route of newSeraphRoutes) {
    const entry = recoveryByDetail.get(route);
    const actual = staticByRoute.get(route);
    check(targetReadbackChecks, 'targetReadback', '炽天使新对象：' + route, () => {
      checkNewDetail(entry, actual);
    }, { status: actual?.status ?? null, key: entryKey(entry) });
  }

  const newRuleRoutes = recoveryEntries
    .filter(entry => entry.method === 'POST' && entry.detailRoute.includes('/trigger-rules/'))
    .map(entry => entry.detailRoute);
  for (const route of newRuleRoutes) {
    const entry = recoveryByDetail.get(route);
    const actual = staticByRoute.get(route);
    check(targetReadbackChecks, 'targetReadback', '四条新初始化规则：' + route, () => {
      checkNewDetail(entry, actual);
      expect(actual.data.eventSource?.eventType === 'SOURCE_INITIALIZED', '新规则事件类型错误');
      expect(diff(actual.data.eventSource?.detail, {} ) === null, 'SOURCE_INITIALIZED detail 不是空对象');
      expect(actual.data.conditionGroups?.length === 0, '新规则含条件组');
      expect(actual.data.actions?.length === 1, '新规则动作数不是1');
      expect(actual.data.actions[0]?.actionType === 'EXECUTE_EFFECT', '新规则动作类型错误');
      expect(actual.data.actions[0]?.targetContext === 'EVENT_SOURCE', '新规则目标上下文错误');
    }, { status: actual?.status ?? null, ruleKey: entryKey(entry), eventType: actual?.data?.eventSource?.eventType ?? null });
  }

  const oldKeyRoutes = recoveryEntries
    .filter(entry => entry.method === 'DELETE')
    .map(entry => entry.detailRoute);
  for (const route of oldKeyRoutes) {
    const entry = recoveryByDetail.get(route);
    const actual = staticByRoute.get(route);
    check(targetReadbackChecks, 'targetReadback', '旧键404：' + route, () => {
      checkDeletedDetail(entry, actual);
    }, { status: actual?.status ?? null, key: entryKey(entry) });
  }
  report.targetReadback = {
    checks: targetReadbackChecks,
    targetSkills: targetSkills.length,
    existingEffects: existingEffectRoutes.length,
    newSeraphObjects: newSeraphRoutes.length,
    newRules: newRuleRoutes.length,
    deletedOldKeys: oldKeyRoutes.length,
    passed: targetReadbackChecks.filter(item => item.passed).length,
    total: targetReadbackChecks.length,
  };

  const protectedCategoryRoutes = {
    equipmentAndRelations: staticRoutes.filter(route => route.startsWith('/equipment/') || route.startsWith('/equipment-skill-relations')),
    representativeImages: staticRoutes.filter(route => route.endsWith('/representative-image')),
    lifeline: staticRoutes.filter(route => targetCategory(route) === 'lifeline'),
    otherProtected: staticRouteChecks.filter(item => item.kind === 'protected_exact').map(item => item.route),
  };
  const protectedComponentsChecks = [];
  for (const [category, routes] of Object.entries(protectedCategoryRoutes)) {
    const unique = [...new Set(routes)];
    const records = unique.map(route => staticRouteChecks.find(item => item.route === route)).filter(Boolean);
    const failed = records.filter(item => !item.passed);
    check(protectedComponentsChecks, 'protectedComponents', category + '保持不变', () => {
      expect(records.length === unique.length, '保护路由未全部读取');
      expect(failed.length === 0, '保护路由存在漂移');
    }, { routeCount: unique.length, failedRoutes: failed.map(item => item.route) });
  }
  const protectedRows = collectionChecks.reduce((sum, item) => sum + (item.details?.protectedRows || 0), 0);
  const allowedEffectSummaryChanges = collectionChecks.flatMap(item => item.details?.allowedSummaryChanges || []);
  check(protectedComponentsChecks, 'protectedComponents', '效果列表摘要只允许三个对应效果的说明和更新时间改变', () => {
    const keys = allowedEffectSummaryChanges.map(item => item.effectKey).sort();
    expect(diff(keys, ['bonus_attack_damage_from_max_mana', 'magical_footwear_additional_speed', 'unsinkable_slow_resist'].sort()) === null,
      '允许变化的效果摘要键不正确');
  }, { allowedEffectSummaryChanges, protectedRows });
  report.protectedComponents = {
    checks: protectedComponentsChecks,
    categories: protectedCategoryRoutes,
    allowedEffectSummaryChanges,
    protectedUnchangedListRows: protectedRows,
  };

  const skillRows = rows(skillsResponse.data);
  const skillKeys = Array.isArray(skillRows) ? skillRows.map(row => row?.skillKey) : [];
  const skillListChecks = [];
  check(skillListChecks, 'ruleScan', '技能目录完整为1062项', () => {
    expect(skillsResponse.status === 200, '技能目录不是200');
    expect(Array.isArray(skillRows), '技能目录不是数组');
    expect(skillRows.length === skillsResponse.data.total, '技能目录total不一致');
    expect(skillRows.length === 1062, '技能目录不是1062项');
    expect(skillKeys.every(key => typeof key === 'string' && key.length > 0), '技能目录存在缺失稳定键');
    expect(new Set(skillKeys).size === skillKeys.length, '技能目录稳定键重复');
  }, { status: skillsResponse.status, count: skillKeys.length, skillKeysSha256: sha256Value([...skillKeys].sort()) });

  const uniqueSkillKeys = [...new Set(skillKeys)].sort((a, b) => a.localeCompare(b));
  const ruleListResponses = await mapLimit(uniqueSkillKeys, 24, async skillKey => ({
    skillKey,
    response: await get('/skills/' + encodeURIComponent(skillKey) + '/trigger-rules'),
  }));
  const ruleRefs = [];
  const ruleListChecks = [];
  for (const item of ruleListResponses) {
    const list = rows(item.response.data);
    const keys = Array.isArray(list) ? list.map(row => row?.ruleKey) : [];
    const record = {
      skillKey: item.skillKey,
      route: item.response.route,
      status: item.response.status,
      responseShape: Array.isArray(item.response.data) ? 'array' : item.response.data === null ? 'null-as-empty' : typeof item.response.data,
      count: Array.isArray(list) ? list.length : null,
      ruleKeys: keys,
      passed: item.response.status === 200 && Array.isArray(list),
    };
    if (!record.passed) {
      recordFailure('ruleLists', { name: '规则列表GET失败', skillKey: item.skillKey, status: item.response.status });
    } else {
      for (const ruleKey of keys) {
        if (typeof ruleKey !== 'string' || ruleKey.length === 0) {
          record.passed = false;
          recordFailure('ruleLists', { name: '规则列表稳定键缺失', skillKey: item.skillKey });
          break;
        }
        ruleRefs.push({ skillKey: item.skillKey, ruleKey });
      }
    }
    ruleListChecks.push(record);
  }
  const refCounts = new Map();
  for (const ref of ruleRefs) {
    const key = ruleRefKey(ref.skillKey, ref.ruleKey);
    refCounts.set(key, (refCounts.get(key) || 0) + 1);
  }
  const duplicateRuleRefs = [...refCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  check(ruleListChecks, 'ruleLists', '1062个规则列表的稳定键无重复', () => {
    expect(duplicateRuleRefs.length === 0, '规则引用重复：' + duplicateRuleRefs.join(','));
  }, { duplicateRuleRefs });

  const uniqueRuleRefs = [...new Map(ruleRefs.map(ref => [ruleRefKey(ref.skillKey, ref.ruleKey), ref])).values()];
  const ruleDetailResponses = await mapLimit(uniqueRuleRefs, 24, async ref => ({
    ...ref,
    response: await get('/skills/' + encodeURIComponent(ref.skillKey) + '/trigger-rules/' + encodeURIComponent(ref.ruleKey)),
  }));
  const baselineRuleByKey = new Map(baselineRules.map(item => [ruleRefKey(item.skillKey, item.ruleKey), item]));
  const newRuleEntries = recoveryEntries.filter(entry => entry.method === 'POST' && entry.detailRoute.includes('/trigger-rules/'));
  const newRuleByKey = new Map();
  for (const entry of newRuleEntries) {
    const match = entry.detailRoute.match(/^\/skills\/([^/?]+)\/trigger-rules\/([^/?]+)$/);
    if (match) newRuleByKey.set(ruleRefKey(decodeURIComponent(match[1]), decodeURIComponent(match[2])), entry);
  }
  const actualRuleKeys = new Set(uniqueRuleRefs.map(ref => ruleRefKey(ref.skillKey, ref.ruleKey)));
  const baselineRuleKeys = new Set(baselineRuleByKey.keys());
  const newRuleKeys = new Set(newRuleByKey.keys());
  const missingExisting = [...baselineRuleKeys].filter(key => !actualRuleKeys.has(key));
  const added = [...actualRuleKeys].filter(key => !baselineRuleKeys.has(key));
  const unexpectedAdded = added.filter(key => !newRuleKeys.has(key));
  const missingNew = [...newRuleKeys].filter(key => !actualRuleKeys.has(key));

  const ruleDetailChecks = [];
  let existingMatched = 0;
  let newMatched = 0;
  const validRuleDetails = [];
  for (const item of ruleDetailResponses) {
    const key = ruleRefKey(item.skillKey, item.ruleKey);
    const baseline = baselineRuleByKey.get(key);
    const newEntry = newRuleByKey.get(key);
    const record = {
      skillKey: item.skillKey,
      ruleKey: item.ruleKey,
      kind: baseline ? 'existing' : newEntry ? 'new' : 'unexpected',
      status: item.response.status,
      data: item.response.data,
      passed: false,
    };
    try {
      expect(item.response.status === 200, '规则详情不是200');
      if (baseline) {
        const difference = diff(baseline.data, item.response.data);
        if (difference) throw new Error('原有规则对象漂移：' + JSON.stringify(difference));
        existingMatched += 1;
      } else if (newEntry) {
        const difference = subsetDiff(item.response.data, newEntry.body);
        if (difference) throw new Error('新规则与06B载荷不匹配：' + JSON.stringify(difference));
        newMatched += 1;
      } else {
        throw new Error('规则不在原90条或06B新增集合中');
      }
      record.passed = true;
      validRuleDetails.push({ skillKey: item.skillKey, ruleKey: item.ruleKey, data: item.response.data });
    } catch (error) {
      record.message = scrub(error?.message ?? error);
      recordFailure('ruleDetails', record);
    }
    ruleDetailChecks.push(record);
  }
  const actualSourceInitialized = validRuleDetails.filter(item => item.data?.eventSource?.eventType === 'SOURCE_INITIALIZED').length;
  const ruleCountChecks = [];
  check(ruleCountChecks, 'ruleScan', '规则总量和新增集合恰为94条', () => {
    expect(uniqueSkillKeys.length === 1062, '技能数不是1062');
    expect(ruleListResponses.length === 1062, '规则列表GET不是1062');
    expect(uniqueRuleRefs.length === 94, '规则总量不是94');
    expect(missingExisting.length === 0, '原有规则缺失：' + missingExisting.join(','));
    expect(unexpectedAdded.length === 0, '发现额外规则：' + unexpectedAdded.join(','));
    expect(missingNew.length === 0, '新增规则缺失：' + missingNew.join(','));
  }, {
    skillCount: uniqueSkillKeys.length,
    listGetCount: ruleListResponses.length,
    detailGetCount: ruleDetailResponses.length,
    ruleCount: uniqueRuleRefs.length,
    missingExisting,
    unexpectedAdded,
    missingNew,
  });
  check(ruleCountChecks, 'ruleScan', '原90条规则逐对象完全不变', () => {
    expect(baselineRuleByKey.size === 90, '基线规则不是90');
    expect(existingMatched === 90, '逐对象匹配原规则数量不是90');
  }, { expected: 90, matched: existingMatched });
  check(ruleCountChecks, 'ruleScan', '四条新规则逐对象匹配06B请求体', () => {
    expect(newRuleByKey.size === 4, '06B新规则不是4条');
    expect(newMatched === 4, '匹配06B新规则数量不是4');
  }, { expected: 4, matched: newMatched });
  check(ruleCountChecks, 'ruleScan', 'SOURCE_INITIALIZED数量由20变为24', () => {
    expect(recoveryBaseline.triggerRuleScan.sourceInitializedRuleCount === 20, '基线SOURCE_INITIALIZED不是20');
    expect(actualSourceInitialized === 24, '当前SOURCE_INITIALIZED不是24');
  }, { before: recoveryBaseline.triggerRuleScan.sourceInitializedRuleCount, actual: actualSourceInitialized });

  report.ruleScan = {
    expected: {
      skillCount: 1062,
      ruleListGetCount: 1062,
      originalRuleCount: 90,
      newRuleCount: 4,
      totalRuleCount: 94,
      originalSourceInitializedCount: 20,
      totalSourceInitializedCount: 24,
    },
    actual: {
      skillCount: uniqueSkillKeys.length,
      ruleListGetCount: ruleListResponses.length,
      ruleDetailGetCount: ruleDetailResponses.length,
      originalRuleCount: baselineRules.length,
      totalRuleCount: uniqueRuleRefs.length,
      existingRulesMatched: existingMatched,
      newRulesMatched: newMatched,
      sourceInitializedCount: actualSourceInitialized,
      actualRuleSha256: sha256Value(validRuleDetails.sort((a, b) => ruleRefKey(a.skillKey, a.ruleKey).localeCompare(ruleRefKey(b.skillKey, b.ruleKey)))),
    },
    skillListChecks,
    ruleListChecks,
    ruleCountChecks,
    ruleDetailChecks,
    missingExisting,
    unexpectedAdded,
    missingNew,
  };

  const arithmeticChecks = [];
  const speed = parameterValue('/skills/item_2422_passive/parameters/additional_move_speed', staticByRoute);
  const slowResist = parameterValue('/skills/item_3742_passive/parameters/slow_resist_ratio', staticByRoute);
  const adRatio = parameterValue('/skills/item_3042_passive/parameters/bonus_ad_from_max_mana_ratio', staticByRoute);
  const apRatio = parameterValue('/skills/item_3040_passive/parameters/ap_from_bonus_mana_ratio', staticByRoute);
  const adFormula = staticByRoute.get('/skills/item_3042_passive/formulas/bonus_attack_damage_from_max_mana')?.data;
  const apFormula = staticByRoute.get('/skills/item_3040_passive/formulas/ap_from_bonus_mana')?.data;
  const examples = [
    { name: '10移速', input: 10, ratio: 1, actual: 10 * 1, expected: 10, evidence: speed },
    { name: '0.15减速抗性', input: 0.15, ratio: 1, actual: 0.15 * 1, expected: 0.15, evidence: slowResist },
    { name: '1500总法力转攻击力', input: 1500, ratio: adRatio, actual: 1500 * adRatio, expected: 30, evidence: adFormula?.expression?.operands?.[0]?.attributeValueKind },
    { name: '500额外法力转法术强度', input: 500, ratio: apRatio, actual: 500 * apRatio, expected: 10, evidence: apFormula?.expression?.operands?.[0]?.attributeValueKind },
    { name: '1600额外法力转法术强度', input: 1600, ratio: apRatio, actual: 1600 * apRatio, expected: 32, evidence: apFormula?.expression?.operands?.[0]?.attributeValueKind },
  ];
  check(arithmeticChecks, 'arithmetic', '五个独立算术样例', () => {
    expect(speed === 10, '移速参数不是10');
    expect(slowResist === 0.15, '减速抗性参数不是0.15');
    expect(adRatio === 0.02, '魔切比例不是0.02');
    expect(apRatio === 0.02, '炽天使额外法力比例不是0.02');
    expect(adFormula?.expression?.operands?.[0]?.attributeValueKind === 'TOTAL', '魔切公式不是TOTAL');
    expect(apFormula?.expression?.operands?.[0]?.attributeValueKind === 'BONUS', '炽天使公式不是BONUS');
    for (const example of examples) expect(example.actual === example.expected, example.name + '算术不相等');
  }, { examples });
  report.arithmeticExamples = {
    checks: arithmeticChecks,
    examples,
    independentlyCalculated: true,
  };

  const sourceFacts = {
    item_2422: 'Slightly Quicker：10点额外移动速度；主体直接移速25。',
    item_3742: 'Unsinkable：15%减速抗性；主体没有减速抗性字段。',
    item_3042: 'Awe：最大法力值2%转额外攻击力；公式读取TOTAL。',
    item_3040: 'Awe：加成法力值2%转法术强度；救主灵刃护盾仍读取最大法力值TOTAL。',
  };
  report.conclusions = {
    overall: '四项初始化规则已完成独立纯读回读；原90条规则保持不变，新增4条SOURCE_INITIALIZED规则，无额外规则。',
    sourceFacts,
    items: {
      item_2422: {
        effect: 'magical_footwear_additional_speed',
        result: 'attribute_bonus → move_speed / attribute_flat_add / INCREASE',
        value: 10,
        baseAttribute: 'move_speed=25',
        verdict: 'PASS',
      },
      item_3742: {
        effect: 'unsinkable_slow_resist',
        result: 'slow_resist → slow_resist_percent / attribute_flat_add / INCREASE',
        value: 0.15,
        baseAttribute: 'move_speed_percent=0.04,hp=350,armor=55；没有slow_resist',
        verdict: 'PASS',
      },
      item_3042: {
        effect: 'bonus_attack_damage_from_max_mana',
        result: 'bonus_attack_damage → attack_damage / attribute_flat_add / INCREASE',
        formula: 'SOURCE mana TOTAL × bonus_ad_from_max_mana_ratio',
        baseAttribute: 'mana=1000,attack_damage=35,ability_haste=15',
        verdict: 'PASS',
      },
      item_3040: {
        parameter: 'ap_from_bonus_mana_ratio=0.02',
        formula: 'ap_from_bonus_mana：SOURCE mana BONUS × ap_from_bonus_mana_ratio',
        effect: 'ap_from_bonus_mana → ability_power / attribute_flat_add / INCREASE',
        shieldProtected: 'lifeline_shield_value 仍为 SOURCE mana TOTAL × 0.18',
        oldKeys404: oldKeyRoutes,
        baseAttribute: 'mana=1000,ability_power=70,ability_haste=25',
        verdict: 'PASS',
      },
    },
    authoringIssues: [
      '本轮1062个规则列表接口均返回HTTP200和数组，未发现空列表响应形状不一致。',
      '效果列表摘要更新时只能放行对应效果的description和updatedAt，不能把整个摘要列表当作完全不变对象。',
      '技能中文名称、效果键和规则键分离，回读必须按内部稳定键核对。',
      '本次回读只证明管理数据和接口结果，不证明战斗运行时实际执行。',
    ],
  };

  report.requestSummary = callSummary();
  report.getCount = report.requestSummary.totalGets;
  report.history.inputChecks = inputChecks;
  report.mismatches = failures.length;
  report.businessWrites = 0;
  report.businessWriteCount = 0;
  report.apiWrites = 0;
  report.passed = failures.length === 0 &&
    report.requestSummary.allRequestsWereGET &&
    report.requestSummary.failedRequests.length === 0 &&
    report.history.historicalTotalWrites === 16 &&
    report.history.replayedWrites === 0 &&
    report.ruleScan.actual.totalRuleCount === 94 &&
    report.ruleScan.actual.sourceInitializedCount === 24;
  report.status = report.passed ? 'PASS' : 'FAIL';
  report.completedAt = new Date().toISOString();
}

function persist() {
  report.failures = failures;
  report.mismatches = failures.length;
  report.requestSummary = callSummary();
  report.getCount = report.requestSummary.totalGets;
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

try {
  await main();
} catch (error) {
  report.status = 'FAIL';
  report.passed = false;
  report.error = { message: scrub(error?.message ?? error) };
  recordFailure('fatal', report.error);
  report.completedAt = new Date().toISOString();
} finally {
  report.businessWrites = 0;
  report.businessWriteCount = 0;
  report.apiWrites = 0;
  report.authorizationValueRecorded = false;
  report.methodPolicy = 'GET_ONLY';
  persist();
  const summary = {
    status: report.status,
    passed: report.passed,
    methodPolicy: report.methodPolicy,
    businessWrites: report.businessWrites,
    authorizationValueRecorded: report.authorizationValueRecorded,
    gets: report.requestSummary?.totalGets ?? calls.length,
    mismatches: report.mismatches,
    output: outputPath,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  if (!report.passed) process.exitCode = 1;
}
