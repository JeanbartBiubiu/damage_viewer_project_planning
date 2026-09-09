import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactRoot = path.resolve(here, '..');
const candidateDir = path.join(artifactRoot, 'hero30-luna-candidate');
const inputDir = path.join(candidateDir, '输入包');
const candidatePath = path.join(candidateDir, '完整候选.json');
const planPath = path.join(candidateDir, '写前请求计划.json');
const versionPath = path.join(candidateDir, '候选版本.json');
const rangePath = path.join(candidateDir, '来源与范围.json');
const sourceValuesPath = path.join(candidateDir, '源值解析.json');
const strictMathPath = path.join(candidateDir, '严格数学.json');
const sourceManifestPath = path.join(candidateDir, '来源哈希汇总.json');
const sourceBindingPath = path.join(inputDir, '来源绑定与当前文本.json');
const inputVersionPath = path.join(inputDir, '输入版本.json');
const protectionPath = path.join(inputDir, '参考资料', '当前10槽保护快照.json');
const reusePath = path.join(inputDir, '参考资料', '公共参数复用清单.json');
const lockPath = path.join(candidateDir, '实际写入锁.json');

const frozen = Object.freeze({
  candidate: '2efb89e7a4698b77b12a438922b1f9c5353460eb711e299039ab613c3cea7e12',
  plan: 'bc33491aefd00be327802161eae24e749ee225d6857951d9ce91164a32b0baf1',
  version: '8e5a0ea472f76af3817a7945dd7cf5fb63e05bc72161ba9b8a33cd05be49ad1c',
  range: 'edb81ec858bf9750687edcfd62bd50e322bb4864b1de489e3956e5f0b83b4678',
  sourceValues: '48c6d6f111005b3c4d5c9eed617f2c842f06e9146aa19fb86e98ddbad6e68c35',
  strictMath: '07a1b8e257236dd3b9389e437de84e8a648a13f27d2c5c3b31fb166b9e7ec826',
  sourceManifest: 'a7a5c855729939e7c55b3f2683d3a7da40eda5a55931f8976d1ef1000365dcf6',
  inputVersion: '20992764ea3f1bd58a9685295db486955b41c7f47fe7f43246366598653a10b5',
  sourceBinding: '398b742c6bac73eb55fe4c17a034b0640163a065e18d75a4225ae80c8b121768',
  protection: '65decb352a57f467bb8d90beccf1e09d86d463688e00d501dccf2c51d54a753c',
  reuse: '6fdfdb1b34a1d293ae014b8e69fd17ccada26a18d82f408a21bd720fd8c9b26d',
  writer: '5d16dab087a98213703decbe7c5175fe9fd63e0015f588706ad44a805a5acce3',
});

if (process.argv.length !== 3 || process.argv[2] !== '--after-apply') {
  throw new Error('用法：node 独立全字段回读.mjs --after-apply');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function writeJson(file, value, flag) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, flag ? { flag } : undefined);
}
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function sha256Value(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
      return { at: `${at}.${key}`, expectedPresent: Object.hasOwn(expected, key), actualPresent: Object.hasOwn(actual, key) };
    }
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
  if (!actual || actual[idField] !== expected[idField]) {
    return { at: `.${idField}`, expected: expected[idField], actual: actual?.[idField] };
  }
  for (const field of Object.keys(expected)) {
    if (!Object.hasOwn(actual, field)) continue;
    const difference = firstDiff(strip(expected[field]), strip(actual[field]), `.${field}`);
    if (difference) return difference;
  }
  return null;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function safeRoute(route) {
  assert(typeof route === 'string' && route.startsWith('/') && !route.includes('://') && !route.includes('..') && !route.includes('#'), `不安全接口路径：${route}`);
}

const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const version = readJson(versionPath);
const range = readJson(rangePath);
const inputVersion = readJson(inputVersionPath);
const protection = readJson(protectionPath);
const reuseList = readJson(reusePath);
const sourceBinding = readJson(sourceBindingPath);
const lockedWrite = readJson(lockPath);
const sourceValues = readJson(sourceValuesPath);
const strictMath = readJson(strictMathPath);
const sourceManifest = readJson(sourceManifestPath);

const hashFiles = [
  ['candidate', candidatePath, frozen.candidate],
  ['plan', planPath, frozen.plan],
  ['version', versionPath, frozen.version],
  ['range', rangePath, frozen.range],
  ['sourceValues', sourceValuesPath, frozen.sourceValues],
  ['strictMath', strictMathPath, frozen.strictMath],
  ['sourceManifest', sourceManifestPath, frozen.sourceManifest],
  ['inputVersion', inputVersionPath, frozen.inputVersion],
  ['sourceBinding', sourceBindingPath, frozen.sourceBinding],
  ['protection', protectionPath, frozen.protection],
  ['reuse', reusePath, frozen.reuse],
  ['writer', path.join(candidateDir, '受保护写入器.mjs'), frozen.writer],
];
for (const [label, file, expected] of hashFiles) assert(sha256File(file) === expected, `冻结文件散列变化：${label}`);
assert(candidate.meta?.batch === '英雄机制第三十批', '候选批次不符');
assert(candidate.meta?.apiCalls === 0 && candidate.meta?.businessWrites === 0 && candidate.apiWrites === 0, '候选含业务调用记录');
assert(plan.noApiCalls === true, '计划不是只读计划');
assert(version.candidateSha256 === frozen.candidate && version.requestPlanSha256 === frozen.plan, '候选版本散列不符');
assert(sourceBinding.clientVersion === '16.17' && sourceBinding.officialVersion === '16.17.1', '来源版本不符');
assert(inputVersion.apiWrites === 0 && inputVersion.GETs === 96, '输入包GET/写入计数不符');
for (const sourceFile of inputVersion.sourceFiles ?? []) {
  const file = path.join(inputDir, sourceFile.path);
  assert(fs.existsSync(file) && sha256File(file) === sourceFile.sha256, `来源文件散列变化：${sourceFile.path}`);
}
assert(lockedWrite.status === 'COMPLETED' && lockedWrite.apiWrites === 86 && lockedWrite.confirmed === 86, `业务写入未确认86项成功：${JSON.stringify(lockedWrite)}`);
assert(lockedWrite.reportPath && fs.existsSync(lockedWrite.reportPath), '业务写入执行结果不存在');
const writeResult = readJson(lockedWrite.reportPath);
assert(writeResult.success === true && writeResult.apiWrites === 86 && writeResult.counts?.POST === 86, '业务写入结果未确认86项成功');

const skills = candidate.order;
const kinds = [
  { kind: 'parameters', api: 'parameters', id: 'parameterKey' },
  { kind: 'formulas', api: 'formulas', id: 'formulaKey' },
  { kind: 'effects', api: 'effects', id: 'effectKey' },
  { kind: 'processes', api: 'processes', id: 'processKey' },
  { kind: 'internalStates', api: 'internal-states', id: 'stateKey' },
  { kind: 'triggerRules', api: 'trigger-rules', id: 'ruleKey' },
];
const collectionRoutes = new Map();
for (const skillKey of skills) for (const item of kinds) collectionRoutes.set(`/skills/${skillKey}/${item.api}`, { skillKey, ...item });
assert(Array.isArray(plan.requests) && plan.requests.length === 86 && plan.requestCount === 86, '计划应为86项');
assert(JSON.stringify(plan.requestCounts) === JSON.stringify({ parameters: 64, formulas: 20, effects: 2, processes: 0, internalStates: 0, triggerRules: 0 }), '计划分类计数不符');
const planByRoute = new Map();
const plannedDetails = [];
for (const intent of plan.requests) {
  const item = kinds.find(value => value.kind === intent.kind);
  assert(item && intent.method === 'POST' && intent.route === `/skills/${intent.skillKey}/${item.api}`, `计划接口无效：${intent.sequence}`);
  assert(typeof intent.detailRoute === 'string' && intent.detailRoute === `/skills/${intent.route.split('/').slice(2).join('/')}/${encodeURIComponent(intent.stableKey)}`, `计划详情路径无效：${intent.sequence}`);
  assert(intent.body?.[item.id] === intent.stableKey, `计划稳定键不符：${intent.sequence}`);
  assert(!planByRoute.has(intent.detailRoute), `计划详情重复：${intent.detailRoute}`);
  planByRoute.set(intent.detailRoute, intent);
  plannedDetails.push(intent);
}
assert(plannedDetails.length === 86, '新增详情计划不是86项');

assert(Array.isArray(protection.requests) && protection.requests.length === 96 && protection.GETs === 96, '保护快照应为96条GET');
assert(protection.requests.every(request => request.status === 200), '保护快照存在非200请求');
const baselineByRoute = new Map();
for (const request of protection.requests) {
  assert(!baselineByRoute.has(request.route), `保护快照路由重复：${request.route}`);
  baselineByRoute.set(request.route, request);
}
const protectedLists = protection.requests.filter(request => collectionRoutes.has(request.route));
assert(protectedLists.length === 60, `保护组成列表应为60，实际${protectedLists.length}`);
const reusedDetails = [];
for (const item of reuseList) {
  const detailRoute = `/skills/${item.skillKey}/parameters/${encodeURIComponent(item.parameterKey)}`;
  const baseline = baselineByRoute.get(detailRoute);
  assert(baseline?.status === 200, `复用详情不在保护快照：${detailRoute}`);
  reusedDetails.push({ skillKey: item.skillKey, kind: 'parameters', stableKey: item.parameterKey, api: 'parameters', id: 'parameterKey', detailRoute, candidateBody: baseline.data, reused: true });
}
assert(reusedDetails.length === 8 && new Set(reusedDetails.map(value => value.detailRoute)).size === 8, '复用详情应为8项');
const allDetails = [
  ...reusedDetails,
  ...plannedDetails.map(intent => ({ skillKey: intent.skillKey, kind: intent.kind, stableKey: intent.stableKey, api: intent.route.split('/').at(-1), id: kinds.find(value => value.kind === intent.kind).id, detailRoute: intent.detailRoute, candidateBody: intent.body, reused: false })),
];
assert(allDetails.length === 94 && new Set(allDetails.map(value => value.detailRoute)).size === 94, '当前详情应为94项');
const freshRoutes = [...new Set([...protection.requests.map(request => request.route), ...plannedDetails.map(intent => intent.detailRoute)])];
assert(freshRoutes.length === 182, `独立唯一GET应为182，实际${freshRoutes.length}`);

const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const runDir = path.join(here, '实际回读', runId);
fs.mkdirSync(runDir, { recursive: true });
const journalPath = path.join(runDir, '所有GET原始响应.jsonl');
const calls = [];
let sequence = 0;
function appendJournal(value) {
  const descriptor = fs.openSync(journalPath, 'a');
  try {
    fs.writeSync(descriptor, `${JSON.stringify(value)}\n`, undefined, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
async function get(route) {
  safeRoute(route);
  const seq = ++sequence;
  appendJournal({ phase: 'BEFORE', seq, method: 'GET', route, at: new Date().toISOString() });
  let result;
  try {
    const response = await fetch('http://127.0.0.1:8080/api/admin/games/lol' + route, {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.HERO30_API_TOKEN || 'local-entry'}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    const bodyText = await response.text();
    let data = null;
    let parseError = null;
    if (bodyText.length) {
      try { data = JSON.parse(bodyText); } catch (error) { parseError = String(error.message || error); }
    }
    result = { seq, method: 'GET', route, status: response.status, data, ...(parseError ? { parseError, bodyText } : {}), finishedAt: new Date().toISOString() };
  } catch (error) {
    result = { seq, method: 'GET', route, status: null, data: null, error: String(error.message || error), finishedAt: new Date().toISOString() };
  }
  appendJournal({ phase: 'AFTER', ...result });
  calls.push(result);
  if (result.status === null || result.parseError) throw new Error(`GET失败，停止回读：${route}，${result.error || result.parseError}`);
  if (result.status !== 200) throw new Error(`GET状态异常，停止回读：${route}，状态=${result.status}`);
  return result;
}
const resultByRoute = new Map();
try {
  for (const route of freshRoutes) resultByRoute.set(route, await get(route));
} catch (error) {
  const execution = {
    generatedAt: new Date().toISOString(), mode: '第三十批写后独立全字段GET', afterApply: true,
    status: 'STOPPED', complete: false, apiWrites: 0, noBusinessWrites: true,
    calls: calls.length, methods: { GET: calls.length },
    statuses: calls.reduce((out, call) => { const key = String(call.status); out[key] = (out[key] || 0) + 1; return out; }, {}),
    error: String(error.stack || error), journalPath, frozen,
  };
  writeJson(path.join(runDir, '执行结果.json'), execution, 'wx');
  console.log(JSON.stringify({ status: execution.status, complete: false, apiWrites: 0, calls: calls.length, output: runDir, error: execution.error }, null, 2));
  process.exitCode = 1;
  throw error;
}

function category(route) {
  if (['/attributes', '/skill-categories', '/modifier-zones', '/damage-types'].includes(route)) return '目录';
  if (route.startsWith('/characters/')) return '角色';
  if (route.startsWith('/character-skill-relations?')) return '关系';
  if (route.includes('/representative-image')) return '图片';
  if (/^\/skills\/[^/]+$/.test(route)) return '主体';
  if (collectionRoutes.has(route)) return '六类列表';
  if (reusedDetails.some(entry => entry.detailRoute === route)) return '复用详情';
  return '新增详情';
}
function checkProtection() {
  const records = [];
  const failures = [];
  const counts = { catalogs: 0, characters: 0, relations: 0, subjects: 0, images: 0, componentLists: 0, reusedDetails: 0 };
  for (const expected of protection.requests) {
    const actual = resultByRoute.get(expected.route);
    const record = { route: expected.route, category: category(expected.route), expectedStatus: expected.status, actualStatus: actual?.status ?? null, passed: false };
    if (!actual || actual.status !== expected.status) {
      record.reason = '状态码变化';
      failures.push(record); records.push(record); continue;
    }
    if (record.category === '目录') counts.catalogs += 1;
    else if (record.category === '角色') counts.characters += 1;
    else if (record.category === '关系') counts.relations += 1;
    else if (record.category === '主体') counts.subjects += 1;
    else if (record.category === '图片') counts.images += 1;
    else if (record.category === '复用详情') counts.reusedDetails += 1;
    const collection = collectionRoutes.get(expected.route);
    if (!collection) {
      record.diff = firstDiff(strip(expected.data), strip(actual.data));
      record.passed = !record.diff;
    } else {
      counts.componentLists += 1;
      const oldRows = rows(expected.data);
      const actualRows = rows(actual.data);
      const planned = plannedDetails.filter(intent => intent.route === expected.route);
      const oldKeys = oldRows?.map(row => row?.[collection.id]) ?? [];
      const actualKeys = actualRows?.map(row => row?.[collection.id]) ?? [];
      const allowed = new Set([...oldKeys, ...planned.map(intent => intent.stableKey)]);
      const oldDifferences = [];
      for (const oldRow of oldRows ?? []) {
        const current = actualRows?.find(row => row?.[collection.id] === oldRow[collection.id]);
        const diff = listProjectedDiff(oldRow, current, collection.id);
        if (diff) oldDifferences.push({ stableKey: oldRow[collection.id], diff });
      }
      const plannedDifferences = [];
      for (const intent of planned) {
        const current = actualRows?.find(row => row?.[collection.id] === intent.stableKey);
        const diff = listProjectedDiff(intent.body, current, collection.id);
        if (diff) plannedDifferences.push({ stableKey: intent.stableKey, diff });
      }
      record.oldCount = oldRows?.length ?? null;
      record.actualCount = actualRows?.length ?? null;
      record.plannedCount = planned.length;
      record.unexpected = actualKeys.filter(key => !allowed.has(key));
      record.missingOld = oldKeys.filter(key => !actualKeys.includes(key));
      record.duplicateKeys = actualKeys.filter((key, index) => actualKeys.indexOf(key) !== index);
      record.oldDifferences = oldDifferences;
      record.plannedDifferences = plannedDifferences;
      record.passed = Array.isArray(oldRows) && Array.isArray(actualRows)
        && new Set(oldKeys).size === oldKeys.length && new Set(actualKeys).size === actualKeys.length
        && record.unexpected.length === 0 && record.missingOld.length === 0 && record.duplicateKeys.length === 0
        && oldDifferences.length === 0 && plannedDifferences.length === 0;
    }
    if (!record.passed) failures.push(record);
    records.push(record);
  }
  return { checked: records.length, passed: records.filter(record => record.passed).length, failures, records, counts };
}
const protectionResult = checkProtection();

const detailRecords = [];
const detailFailures = [];
for (const entry of allDetails) {
  const actual = resultByRoute.get(entry.detailRoute);
  const diff = actual?.status === 200 ? firstDiff(strip(entry.candidateBody), strip(actual.data)) : { at: '$status', expected: 200, actual: actual?.status ?? null };
  const record = { skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute, expected: entry.reused ? '复用既有组成' : '本批新增', status: actual?.status ?? null, passed: !diff, ...(diff ? { diff } : {}) };
  detailRecords.push(record);
  if (diff) detailFailures.push(record);
}
const detailResult = {
  checked: detailRecords.length,
  matched: detailRecords.filter(record => record.passed).length,
  failures: detailFailures,
  reusedChecked: detailRecords.filter(record => record.expected === '复用既有组成').length,
  plannedChecked: detailRecords.filter(record => record.expected === '本批新增').length,
};

const statuses = calls.reduce((out, call) => { const key = String(call.status); out[key] = (out[key] || 0) + 1; return out; }, {});
const allStatus200 = calls.length === 182 && new Set(calls.map(call => call.route)).size === 182 && calls.every(call => call.method === 'GET' && call.status === 200);
const protectionPassed = protectionResult.checked === 96 && protectionResult.passed === 96 && protectionResult.failures.length === 0;
const detailsPassed = detailResult.checked === 94 && detailResult.matched === 94 && detailResult.reusedChecked === 8 && detailResult.plannedChecked === 86 && detailResult.failures.length === 0;
const actualDetails = allDetails.map(entry => ({
  skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute,
  expected: entry.reused ? '复用既有组成' : '本批新增', status: resultByRoute.get(entry.detailRoute)?.status ?? null,
  data: resultByRoute.get(entry.detailRoute)?.data ?? null,
}));
const report = {
  generatedAt: new Date().toISOString(),
  mode: '第三十批写后独立全字段GET回读',
  afterApply: true,
  apiBase: 'http://127.0.0.1:8080/api/admin/games/lol',
  apiWrites: 0,
  noBusinessWrites: true,
  methodology: '按冻结保护快照和写前请求计划逐条执行GET；保护对象、主体、图片、角色、关系、六类列表和详情均保留完整响应；列表仅核对旧行及本批计划行包含的字段，详情执行完整字段比对；本报告不包含数学验收。',
  hashes: {
    candidateSha256: sha256File(candidatePath),
    planSha256: sha256File(planPath),
    versionSha256: sha256File(versionPath),
    rangeSha256: sha256File(rangePath),
    sourceValuesSha256: sha256File(sourceValuesPath),
    strictMathSha256: sha256File(strictMathPath),
    sourceManifestSha256: sha256File(sourceManifestPath),
    inputVersionSha256: sha256File(inputVersionPath),
    sourceBindingSha256: sha256File(sourceBindingPath),
    protectionSnapshotSha256: sha256File(protectionPath),
    reuseSha256: sha256File(reusePath),
    writerSha256: sha256File(path.join(candidateDir, '受保护写入器.mjs')),
  },
  sourceVersion: candidate.meta.sourceVersion,
  expected: {
    protectedRoutes: 96, protectedLists: 60, protectedCatalogs: 4, protectedCharacters: 2,
    protectedRelations: 2, protectedSubjects: 10, protectedImages: 10, reusedDetails: 8,
    plannedNewDetails: 86, componentDetails: 94, uniqueFreshGET: 182,
  },
  actual: { calls: calls.length, uniqueFreshGET: new Set(calls.map(call => call.route)).size, methods: { GET: calls.length }, statuses, allStatus200, journalPath },
  protection: protectionResult,
  details: detailResult,
  fullBusinessFields: { protectedRoutes: protection.requests.map(request => ({ route: request.route, category: category(request.route), status: resultByRoute.get(request.route)?.status ?? null, data: resultByRoute.get(request.route)?.data ?? null })), componentDetails: actualDetails },
  rawResponses: calls,
  writeEvidence: { lockPath, lockedWrite, reportPath: lockedWrite.reportPath, result: { success: writeResult.success, apiWrites: writeResult.apiWrites, confirmed: writeResult.confirmed, counts: writeResult.counts } },
  frozen,
  status: allStatus200 && protectionPassed && detailsPassed ? 'PASS' : 'REVISE',
  complete: allStatus200 && protectionPassed && detailsPassed,
};
const reportPath = path.join(runDir, '独立全量回读.json');
writeJson(reportPath, report, 'wx');
const execution = {
  generatedAt: report.generatedAt, mode: report.mode, status: report.status, complete: report.complete,
  apiWrites: 0, noBusinessWrites: true, calls: report.actual.calls, methods: report.actual.methods, statuses: report.actual.statuses,
  protection: { checked: report.protection.checked, passed: report.protection.passed },
  details: { checked: report.details.checked, matched: report.details.matched, reusedChecked: report.details.reusedChecked, plannedChecked: report.details.plannedChecked },
  reportPath, journalPath,
};
writeJson(path.join(runDir, '执行结果.json'), execution, 'wx');
console.log(JSON.stringify({ status: report.status, complete: report.complete, apiWrites: 0, calls: report.actual.calls, methods: report.actual.methods, statuses: report.actual.statuses, protection: { checked: report.protection.checked, passed: report.protection.passed }, details: execution.details, output: runDir }, null, 2));
if (!report.complete) process.exitCode = 1;
