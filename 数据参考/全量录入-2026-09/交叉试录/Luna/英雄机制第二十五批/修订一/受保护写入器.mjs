import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const inputDir = path.join(path.resolve(here, '..'), '输入包');
const apiRoot = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidatePath = path.join(here, '完整候选.json');
const planPath = path.join(here, '写前请求计划.json');
const sourceValuesPath = path.join(here, '独立源值与算例.json');
const sourceManifestPath = path.join(here, '来源哈希汇总.json');
const inputVersionPath = path.join(inputDir, '输入版本.json');
const sourceBindingPath = path.join(inputDir, '来源绑定与当前文本.json');
const sourceNotePath = path.join(inputDir, '主负责人源值核对说明.md');
const protectionPath = path.join(inputDir, '参考资料', '当前10槽保护快照.json');
const reusePath = path.join(inputDir, '参考资料', '公共参数复用清单.json');

const frozen = Object.freeze({
  candidate: '85ce89e6cead0c7c6b243643ed75a829349d9c7260973643d089cfa6bbc28028',
  plan: 'b22ce20986991a7bf2d3f0db372f2265e3b7f9098e30957722f62c3c112d4cb2',
  sourceValues: 'f973c4092defc937e81465623d5525e3693d0d92c8f1b1d4f0052ff628288055',
  sourceManifest: 'cb6b0911c384a745112b9d880033ab3c0f376528a56d3a4a560e3eeb4f66755e',
  inputVersion: 'e9d0b70006b8f9ae6a6524201154504121be9602a4ec0d290839f650aea2bc12',
  sourceBinding: '21a6cda27054f95e480984e902ba22d4a7c2c045e67a6f9cd90fe999b87d137d',
  sourceNote: 'df459305dadbbc0d78bd891ed5dca4e947b164f623deab6d0cff24ded8ab2ea7',
  protection: '06d0751e2b4b3f77773157df078cbc30894f707e2dd305982e6ed53c041c4878',
  reuse: '142eeaaf6fcfbfde7192e5c1af4d6ab74502cffe58d0ede755e1498d6d6f0604',
});

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) throw new Error('用法：node 受保护写入器.mjs [--apply]');
const apply = args[0] === '--apply';
if (apply) assert.equal(process.env.HERO25_APPLY_CONFIRM, 'CONFIRM_HERO25_COMPONENT_POSTS', 'apply需要明确环境确认');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value, flag = undefined) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, flag ? { flag } : undefined);
}

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['gameId', 'skillKey', 'createdAt', 'updatedAt'].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, strip(child)]));
  }
  return value;
}

function firstDiff(expected, actual, at = '$') {
  if (equal(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return { at, expected, actual };
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return { at, expected, actual };
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDiff(expected[index], actual[index], `${at}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const key of keys) {
    if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) return { at: `${at}.${key}`, expectedPresent: Object.hasOwn(expected, key), actualPresent: Object.hasOwn(actual, key) };
    const difference = firstDiff(expected[key], actual[key], `${at}.${key}`);
    if (difference) return difference;
  }
  return null;
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.data)) return value.data;
  return null;
}

function listProjectedDiff(expected, actual, idField) {
  if (!actual || actual[idField] !== expected[idField]) return { at: `.${idField}`, expected: expected[idField], actual: actual?.[idField] };
  for (const field of Object.keys(expected)) {
    if (!Object.hasOwn(actual, field)) continue;
    const difference = firstDiff(strip(expected[field]), strip(actual[field]), `.${field}`);
    if (difference) return difference;
  }
  return null;
}

for (const [label, file, expected] of [
  ['candidate', candidatePath, frozen.candidate],
  ['plan', planPath, frozen.plan],
  ['sourceValues', sourceValuesPath, frozen.sourceValues],
  ['sourceManifest', sourceManifestPath, frozen.sourceManifest],
  ['inputVersion', inputVersionPath, frozen.inputVersion],
  ['sourceBinding', sourceBindingPath, frozen.sourceBinding],
  ['sourceNote', sourceNotePath, frozen.sourceNote],
  ['protection', protectionPath, frozen.protection],
  ['reuse', reusePath, frozen.reuse],
]) {
  const actual = sha256File(file);
  if (actual !== expected) throw new Error(`冻结文件散列变化：${label}=${actual}，应为${expected}`);
}

const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const sourceValues = readJson(sourceValuesPath);
const sourceManifest = readJson(sourceManifestPath);
const inputVersion = readJson(inputVersionPath);
const baseline = readJson(protectionPath);
const reuseList = readJson(reusePath);
assert.equal(candidate.meta?.businessWrites, 0, '候选已含业务写入');
assert.equal(candidate.meta?.apiCalls, 0, '候选已含业务调用');
assert.equal(candidate.apiWrites, 0, '候选已含业务写入');
assert.equal(plan.noApiCalls, true, '计划不是零写入计划');
assert.equal(sourceValues.noWrites, true, '源值摘要不是零写入摘要');
assert.equal(candidate.revision, 'hero25-source-v1-candidate-revision-1');
assert.equal(candidate.revisionDetails?.originalCandidateSha256, '138db432d3e380d7b46222916f84d3ee6101a3fd79dde77704d82675a52a1228');
for (const source of inputVersion.sourceFiles ?? []) {
  const file = path.join(inputDir, source.path);
  if (sha256File(file) !== source.sha256) throw new Error(`来源文件散列变化：${source.path}`);
}

const kinds = [
  { kind: 'parameters', api: 'parameters', id: 'parameterKey' },
  { kind: 'formulas', api: 'formulas', id: 'formulaKey' },
  { kind: 'effects', api: 'effects', id: 'effectKey' },
  { kind: 'processes', api: 'processes', id: 'processKey' },
  { kind: 'internalStates', api: 'internal-states', id: 'stateKey' },
  { kind: 'triggerRules', api: 'trigger-rules', id: 'ruleKey' },
];
const skillKeys = candidate.order.slice();
const kindByApi = new Map(kinds.map(item => [item.api, item]));
const collectionRoutes = new Map();
for (const skillKey of skillKeys) for (const item of kinds) collectionRoutes.set(`/skills/${skillKey}/${item.api}`, { skillKey, ...item });

const candidateEntries = [];
for (const skillKey of skillKeys) {
  const skill = candidate.skills?.[skillKey];
  if (!skill || skill.skillKey !== skillKey) throw new Error(`候选技能缺失：${skillKey}`);
  for (const item of kinds) {
    const values = skill.write?.[item.kind];
    if (!Array.isArray(values)) throw new Error(`候选组成列表缺失：${skillKey}/${item.kind}`);
    const ids = values.map(value => value[item.id]);
    if (ids.some(value => typeof value !== 'string') || new Set(ids).size !== ids.length) throw new Error(`候选组成键缺失或重复：${skillKey}/${item.kind}`);
    for (const body of values) {
      const stableKey = body[item.id];
      candidateEntries.push({ skillKey, kind: item.kind, api: item.api, id: item.id, stableKey, route: `/skills/${skillKey}/${item.api}`, detailRoute: `/skills/${skillKey}/${item.api}/${encodeURIComponent(stableKey)}`, body, expected: '本次新增计划' });
    }
  }
}
const countByKind = Object.fromEntries(kinds.map(item => [item.kind, candidateEntries.filter(entry => entry.kind === item.kind).length]));
assert.deepEqual(countByKind, { parameters: 76, formulas: 23, effects: 10, processes: 0, internalStates: 0, triggerRules: 0 });
assert.equal(candidateEntries.length, 109);

const baselineByRoute = new Map();
for (const request of baseline.requests ?? []) {
  if (baselineByRoute.has(request.route)) throw new Error(`保护快照路由重复：${request.route}`);
  baselineByRoute.set(request.route, request);
}
assert.equal(baseline.requests.length, 95, '冻结保护GET应为95');
const reusedEntries = reuseList.map(item => {
  const detailRoute = `/skills/${item.skillKey}/parameters/${encodeURIComponent(item.parameterKey)}`;
  const request = baselineByRoute.get(detailRoute);
  if (!request || request.status !== 200) throw new Error(`公共复用详情不在保护快照：${detailRoute}`);
  return {
    skillKey: item.skillKey,
    kind: 'parameters',
    api: 'parameters',
    id: 'parameterKey',
    stableKey: item.parameterKey,
    route: `/skills/${item.skillKey}/parameters`,
    detailRoute,
    body: request.data,
    expected: '复用既有组成',
  };
});
assert.equal(reusedEntries.length, 7);
assert.equal(new Set(reusedEntries.map(entry => entry.detailRoute)).size, 7);
const allEntries = candidateEntries.concat(reusedEntries);
assert.equal(allEntries.length, 116);
const candidateByKey = new Map(candidateEntries.map(entry => [`${entry.skillKey}|${entry.kind}|${entry.stableKey}`, entry]));
const planByKey = new Map();
assert.equal(plan.requestCount, 109);
assert.equal(plan.requests.length, 109);
for (const intent of plan.requests) {
  const item = kinds.find(value => value.kind === intent.kind);
  if (!item || intent.method !== 'POST' || intent.route !== `/skills/${intent.skillKey}/${item.api}`) throw new Error(`计划超出候选范围：${JSON.stringify(intent)}`);
  if (intent.stableKey !== intent.body?.[item.id]) throw new Error(`计划稳定键与载荷不一致：${intent.stableKey}`);
  const key = `${intent.skillKey}|${intent.kind}|${intent.stableKey}`;
  if (planByKey.has(key) || !candidateByKey.has(key)) throw new Error(`计划重复或不在候选：${key}`);
  if (!equal(candidateByKey.get(key).body, intent.body)) throw new Error(`计划载荷与候选不一致：${key}`);
  planByKey.set(key, intent);
}
assert.equal(planByKey.size, 109);
assert.equal(plan.requestCounts.parameters, 76);
assert.equal(plan.requestCounts.formulas, 23);
assert.equal(plan.requestCounts.effects, 10);
assert.equal(plan.candidateNewParameterCount, 76);
assert.equal(plan.currentParameterCountAfterSevenPublicReuse, 83);
assert.deepEqual(plan.reusedPublicParameters, reuseList);

const baselineDetailRoutes = new Set(reusedEntries.map(entry => entry.detailRoute));
const freshNewDetailRoutes = candidateEntries.map(entry => entry.detailRoute);
if (freshNewDetailRoutes.some(route => baselineDetailRoutes.has(route))) throw new Error('新增详情与公共复用详情冲突');
const freshRoutes = [...new Set(baseline.requests.map(request => request.route).concat(freshNewDetailRoutes))];
assert.equal(freshRoutes.length, 204, '去重后的保护与新增详情GET应为204');

function scanExpression(node, skillKey, formulaKey, failures) {
  if (!node || typeof node !== 'object') throw new Error(`公式节点为空：${skillKey}/${formulaKey}`);
  if (node.nodeType === 'PARAMETER') {
    if (!candidate.skills[skillKey].write.parameters.some(item => item.parameterKey === node.parameterKey)) failures.push(`参数引用不存在:${skillKey}/${formulaKey}/${node.parameterKey}`);
    return;
  }
  if (node.nodeType === 'ATTRIBUTE') {
    if (!['SOURCE', 'TARGET'].includes(node.attributeOwner)) failures.push(`属性所有者非法:${skillKey}/${formulaKey}`);
    if (!['BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO'].includes(node.attributeValueKind)) failures.push(`属性口径非法:${skillKey}/${formulaKey}/${node.attributeValueKind}`);
    return;
  }
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2 || !['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(node.operation)) {
    failures.push(`运算节点非法:${skillKey}/${formulaKey}`);
    return;
  }
  scanExpression(node.operands[0], skillKey, formulaKey, failures);
  scanExpression(node.operands[1], skillKey, formulaKey, failures);
}
const expressionFailures = [];
const integerTypeFailures = [];
const integerValueFailures = [];
const negativeTimeFailures = [];
const runtimeDefaultFailures = [];
for (const entry of candidateEntries) {
  if (entry.kind === 'formulas') scanExpression(entry.body.expression, entry.skillKey, entry.stableKey, expressionFailures);
  if (entry.kind === 'parameters') {
    const parameter = entry.body;
    if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) runtimeDefaultFailures.push(`${entry.skillKey}/${parameter.parameterKey}`);
    const integerRequired = parameter.parameterKey.endsWith('_ms') || ['current_fury', 'actual_fury_consumed', 'nearby_enemy_champion_count', 'ticks_per_second', 'minimum_health', 'attack_fury_gain', 'critical_attack_fury_gain', 'kill_unit_fury_gain', 'fury_decay_per_second', 'champion_fury_gain', 'fury_gain'].includes(parameter.parameterKey);
    if (integerRequired && parameter.valueType !== 'INTEGER') integerTypeFailures.push(`${entry.skillKey}/${parameter.parameterKey}`);
    if (integerRequired) {
      const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : [];
      if (values.some(value => !Number.isInteger(value))) integerValueFailures.push(`${entry.skillKey}/${parameter.parameterKey}`);
      if (parameter.parameterKey.endsWith('_ms') && values.some(value => value < 0)) negativeTimeFailures.push(`${entry.skillKey}/${parameter.parameterKey}`);
    }
  }
}
if (expressionFailures.length || integerTypeFailures.length || integerValueFailures.length || negativeTimeFailures.length || runtimeDefaultFailures.length) throw new Error(`候选结构预检失败：${JSON.stringify({ expressionFailures, integerTypeFailures, integerValueFailures, negativeTimeFailures, runtimeDefaultFailures })}`);

const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputDir = path.join(here, apply ? '实际写入' : '只读预检', runId);
fs.mkdirSync(outputDir, { recursive: true });
const journalPath = path.join(outputDir, '全部请求流水.jsonl');
const lockPath = path.join(here, '实际写入锁.json');
let lockAcquired = false;
const execution = {
  runId,
  mode: apply ? 'apply' : 'readonly',
  candidateSha256: frozen.candidate,
  planSha256: frozen.plan,
  sourceValuesSha256: frozen.sourceValues,
  sourceManifestSha256: frozen.sourceManifest,
  writerSha256: sha256File(fileURLToPath(import.meta.url)),
  apiWrites: 0,
  confirmed: 0,
  calls: [],
  preflight: null,
  final: null,
  success: false,
};

function journal(value) {
  const descriptor = fs.openSync(journalPath, 'a');
  try {
    fs.writeSync(descriptor, `${JSON.stringify(value)}\n`, undefined, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function safeRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.includes('://') || route.includes('..') || route.includes('#')) throw new Error(`不安全接口路径：${route}`);
}

async function request(route, method = 'GET', body = undefined) {
  safeRoute(route);
  if (method !== 'GET') {
    assert.equal(apply, true, '只读模式禁止业务写入');
    assert.equal(method, 'POST');
    assert(plan.requests.some(item => item.route === route && equal(item.body, body)), `POST不在冻结计划：${route}`);
  }
  const sequence = execution.calls.length + 1;
  journal({ phase: 'BEFORE', sequence, method, route, ...(body === undefined ? {} : { body }), at: new Date().toISOString() });
  let result;
  try {
    const response = await fetch(apiRoot + route, {
      method,
      headers: { Authorization: `Bearer ${process.env.HERO25_API_TOKEN || 'local-entry'}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let data = null;
    let parseError = null;
    if (text.length) {
      try { data = JSON.parse(text); } catch (error) { parseError = String(error.message || error); }
    }
    result = { sequence, method, route, status: response.status, data, ...(parseError ? { parseError, text } : {}), finishedAt: new Date().toISOString() };
  } catch (error) {
    result = { sequence, method, route, status: null, data: null, error: String(error.message || error), finishedAt: new Date().toISOString() };
  }
  journal({ phase: 'AFTER', ...result });
  execution.calls.push(result);
  if (result.status === null) throw new Error(`${method} GET/POST网络失败 ${route}: ${result.error}`);
  return result;
}

async function fetchUniqueRoutes(routes) {
  const resultByRoute = new Map();
  for (const route of [...new Set(routes)]) resultByRoute.set(route, await request(route));
  return resultByRoute;
}

function expectedCategory(route) {
  if (['/attributes', '/skill-categories', '/modifier-zones', '/damage-types'].includes(route)) return '目录';
  if (route.startsWith('/characters/')) return '角色';
  if (route.startsWith('/character-skill-relations?')) return '关系';
  if (route.includes('/representative-image')) return '图片';
  if (/^\/skills\/[^/]+$/.test(route)) return '主体';
  if (collectionRoutes.has(route)) return '六类列表';
  if (baselineDetailRoutes.has(route)) return '复用详情';
  return '其他';
}

function checkProtection(resultByRoute, after) {
  const records = [];
  const failures = [];
  const collectionCounts = { catalogs: 0, characters: 0, relations: 0, subjects: 0, images: 0, componentLists: 0, reusedDetails: 0 };
  for (const expected of baseline.requests) {
    const actual = resultByRoute.get(expected.route);
    const record = { route: expected.route, category: expectedCategory(expected.route), expectedStatus: expected.status, actualStatus: actual?.status ?? null, passed: false };
    if (!actual || actual.status !== expected.status) {
      record.reason = '状态码变化或未取得实际响应';
      failures.push(record);
      records.push(record);
      continue;
    }
    if (record.category === '复用详情') collectionCounts.reusedDetails += 1;
    else if (record.category === '目录') collectionCounts.catalogs += 1;
    else if (record.category === '角色') collectionCounts.characters += 1;
    else if (record.category === '关系') collectionCounts.relations += 1;
    else if (record.category === '主体') collectionCounts.subjects += 1;
    else if (record.category === '图片') collectionCounts.images += 1;
    const collection = collectionRoutes.get(expected.route);
    if (!collection) {
      record.diff = firstDiff(strip(expected.data), strip(actual.data));
      record.passed = !record.diff;
    } else {
      collectionCounts.componentLists += 1;
      const oldRows = rows(expected.data);
      const actualRows = rows(actual.data);
      const planned = after ? plan.requests.filter(item => item.route === expected.route) : [];
      const oldKeys = oldRows?.map(row => row?.[collection.id]) ?? [];
      const actualKeys = actualRows?.map(row => row?.[collection.id]) ?? [];
      const allowed = new Set(oldKeys);
      for (const intent of planned) allowed.add(intent.stableKey);
      const oldDifferences = [];
      for (const row of oldRows ?? []) {
        const current = actualRows?.find(value => value?.[collection.id] === row[collection.id]);
        const difference = firstDiff(strip(row), strip(current));
        if (difference) oldDifferences.push({ stableKey: row[collection.id], difference });
      }
      const plannedDifferences = [];
      for (const intent of planned) {
        const current = actualRows?.find(value => value?.[collection.id] === intent.stableKey);
        const difference = listProjectedDiff(intent.body, current, collection.id);
        if (difference) plannedDifferences.push({ stableKey: intent.stableKey, difference });
      }
      record.oldCount = oldRows?.length ?? null;
      record.actualCount = actualRows?.length ?? null;
      record.plannedCount = planned.length;
      record.unexpected = actualKeys.filter(key => !allowed.has(key));
      record.missingOld = oldKeys.filter(key => !actualKeys.includes(key));
      record.duplicateKeys = actualKeys.filter((key, index) => actualKeys.indexOf(key) !== index);
      record.oldDifferences = oldDifferences;
      record.plannedDifferences = plannedDifferences;
      record.passed = Array.isArray(oldRows) && Array.isArray(actualRows) && new Set(oldKeys).size === oldKeys.length && new Set(actualKeys).size === actualKeys.length && record.unexpected.length === 0 && record.missingOld.length === 0 && record.duplicateKeys.length === 0 && oldDifferences.length === 0 && plannedDifferences.length === 0 && actualRows.length === allowed.size;
    }
    if (!record.passed) failures.push(record);
    records.push(record);
  }
  if (collectionCounts.catalogs !== 4 || collectionCounts.characters !== 2 || collectionCounts.relations !== 2 || collectionCounts.subjects !== 10 || collectionCounts.images !== 10 || collectionCounts.componentLists !== 60 || collectionCounts.reusedDetails !== 7) {
    failures.push({ reason: '保护分组计数错误', collectionCounts });
  }
  return { checked: records.length, passed: records.filter(record => record.passed).length, failures, records, collectionCounts, after };
}

function checkDetails(resultByRoute, after) {
  const records = [];
  const failures = [];
  for (const entry of allEntries) {
    const actual = resultByRoute.get(entry.detailRoute);
    const record = { skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute, expected: entry.expected, expectedStatus: after || entry.expected === '复用既有组成' ? 200 : 404, actualStatus: actual?.status ?? null, passed: false };
    if (!actual || actual.status !== record.expectedStatus) {
      record.reason = '详情状态码不符';
      failures.push(record);
    } else if (record.expectedStatus === 200) {
      record.diff = firstDiff(strip(entry.body), strip(actual.data));
      record.passed = !record.diff;
      if (record.diff) failures.push(record);
    } else {
      record.passed = true;
    }
    records.push(record);
  }
  return { checked: records.length, passed: records.filter(record => record.passed).length, failures, records, newDetails: records.filter(record => record.expected === '本次新增计划').length, reusedDetails: records.filter(record => record.expected === '复用既有组成').length, after };
}

function savePreflight(resultByRoute, protection, details) {
  writeJson(path.join(outputDir, '写前保护.json'), {
    generatedAt: new Date().toISOString(),
    mode: execution.mode,
    baselineRequests: baseline.requests,
    responses: baseline.requests.map(request => resultByRoute.get(request.route)),
    protection,
    apiWrites: 0,
    noBusinessWrites: true,
  });
  writeJson(path.join(outputDir, '写前组件现值.json'), {
    generatedAt: new Date().toISOString(),
    mode: execution.mode,
    expectedDetails: allEntries,
    responses: allEntries.map(entry => ({ ...entry, response: resultByRoute.get(entry.detailRoute) })),
    details,
    apiWrites: 0,
    noBusinessWrites: true,
  });
}

function saveExecution() {
  execution.finishedAt = new Date().toISOString();
  execution.counts = {
    GET: execution.calls.filter(call => call.method === 'GET').length,
    POST: execution.calls.filter(call => call.method === 'POST').length,
    statuses: execution.calls.reduce((out, call) => { const key = String(call.status); out[key] = (out[key] || 0) + 1; return out; }, {}),
  };
  writeJson(path.join(outputDir, '执行结果.json'), { ...execution, noBusinessWrites: execution.apiWrites === 0 });
}

function createWriteLock(status) {
  writeJson(lockPath, {
    runId,
    status,
    candidateSha256: frozen.candidate,
    planSha256: frozen.plan,
    apiWrites: execution.apiWrites,
    confirmed: execution.confirmed,
    reportPath: path.join(outputDir, '执行结果.json'),
  }, 'wx');
  lockAcquired = true;
}

async function bestEffortDetailProbe(route) {
  try { return await request(route); } catch (error) { return { status: null, error: String(error.message || error), route, method: 'GET' }; }
}

try {
  const firstResponses = await fetchUniqueRoutes(freshRoutes);
  const protection = checkProtection(firstResponses, false);
  const details = checkDetails(firstResponses, false);
  execution.preflight = { uniqueFreshGET: firstResponses.size, protection, details };
  savePreflight(firstResponses, protection, details);
  if (protection.failures.length || details.failures.length) throw new Error(`写前只读预检失败：${JSON.stringify({ protection: protection.failures.slice(0, 3), details: details.failures.slice(0, 3) })}`);

  if (apply) {
    createWriteLock('STARTED');
    fs.mkdirSync(path.join(outputDir, '写前意图'), { recursive: true });
    for (let index = 0; index < plan.requests.length; index += 1) {
      const intent = plan.requests[index];
      const detailRoute = `${intent.route}/${encodeURIComponent(intent.stableKey)}`;
      const before = await request(detailRoute);
      if (before.status !== 404) {
        const probe = before.status === 200 ? before : await bestEffortDetailProbe(detailRoute);
        throw new Error(`写前详情不是404，停止写分支：${detailRoute}，状态=${before.status}，核对=${JSON.stringify(probe)}`);
      }
      writeJson(path.join(outputDir, '写前意图', `${String(index + 1).padStart(3, '0')}.json`), { sequence: index + 1, intent, before }, 'wx');
      const posted = await request(intent.route, 'POST', intent.body);
      if (posted.status !== 201) {
        const probe = await bestEffortDetailProbe(detailRoute);
        throw new Error(`POST状态异常，停止写分支且不重放：${detailRoute}，状态=${posted.status}，写后核对=${JSON.stringify(probe)}`);
      }
      execution.apiWrites += 1;
      const after = await request(detailRoute);
      if (after.status !== 200 || firstDiff(strip(intent.body), strip(after.data))) throw new Error(`POST后详情不匹配，停止写分支：${detailRoute}`);
      execution.confirmed += 1;
      writeJson(lockPath, { runId, status: 'RUNNING', candidateSha256: frozen.candidate, planSha256: frozen.plan, apiWrites: execution.apiWrites, confirmed: execution.confirmed, reportPath: path.join(outputDir, '执行结果.json') });
    }
    const finalResponses = await fetchUniqueRoutes(freshRoutes);
    const finalProtection = checkProtection(finalResponses, true);
    const finalDetails = checkDetails(finalResponses, true);
    execution.final = { uniqueFreshGET: finalResponses.size, protection: finalProtection, details: finalDetails };
    writeJson(path.join(outputDir, '写后保护.json'), { generatedAt: new Date().toISOString(), responses: baseline.requests.map(request => finalResponses.get(request.route)), protection: finalProtection, apiWrites: execution.apiWrites, noBusinessWrites: false });
    writeJson(path.join(outputDir, '最终全量组件现值.json'), { generatedAt: new Date().toISOString(), expectedDetails: allEntries, responses: allEntries.map(entry => ({ ...entry, response: finalResponses.get(entry.detailRoute) })), details: finalDetails, apiWrites: execution.apiWrites, noBusinessWrites: false });
    if (finalProtection.failures.length || finalDetails.failures.length) throw new Error(`写后保护或详情校验失败：${JSON.stringify({ protection: finalProtection.failures.slice(0, 3), details: finalDetails.failures.slice(0, 3) })}`);
    writeJson(lockPath, { runId, status: 'COMPLETED', candidateSha256: frozen.candidate, planSha256: frozen.plan, apiWrites: execution.apiWrites, confirmed: execution.confirmed, reportPath: path.join(outputDir, '执行结果.json') });
  }
  execution.success = true;
} catch (error) {
  execution.error = String(error.stack || error);
  if (apply && lockAcquired) {
    try { writeJson(lockPath, { runId, status: 'STOPPED', candidateSha256: frozen.candidate, planSha256: frozen.plan, apiWrites: execution.apiWrites, confirmed: execution.confirmed, reportPath: path.join(outputDir, '执行结果.json'), error: execution.error }); } catch {}
  }
  process.exitCode = 1;
} finally {
  saveExecution();
  console.log(JSON.stringify({
    mode: execution.mode,
    success: execution.success,
    apiWrites: execution.apiWrites,
    confirmed: execution.confirmed,
    counts: execution.counts,
    preflight: execution.preflight ? { uniqueFreshGET: execution.preflight.uniqueFreshGET, protection: { checked: execution.preflight.protection.checked, passed: execution.preflight.protection.passed }, details: { checked: execution.preflight.details.checked, passed: execution.preflight.details.passed } } : null,
    final: execution.final ? { uniqueFreshGET: execution.final.uniqueFreshGET, protection: { checked: execution.final.protection.checked, passed: execution.final.protection.passed }, details: { checked: execution.final.details.checked, passed: execution.final.details.passed } } : null,
    output: outputDir,
    noBusinessWrites: execution.apiWrites === 0,
    error: execution.error,
  }, null, 2));
}
