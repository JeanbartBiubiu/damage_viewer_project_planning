import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactRoot = path.resolve(here, '..');
const candidateDir = path.join(artifactRoot, 'hero32-luna-candidate');
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
const protectionPath = path.join(inputDir, '参考资料', '当前20槽保护快照.json');
const reusePath = path.join(inputDir, '参考资料', '公共参数复用清单.json');
const lockPath = path.join(candidateDir, '实际写入锁.json');

const frozen = Object.freeze({
  candidate: '57f2ca0fcc9b7f29fb8c9df4c93f3d4fe1b474254839a285f08f7f6a1a4e886d',
  plan: '4250c6cf97965f7f83fa64f89089487f52ede37f83adcb2df15c0051a97e9c46',
  version: '584d82d6e3926f7e80c32f60b1470106d9427ce8a3edd824f02bd180232cf8a4',
  range: '737347ed845fba549fd7d7948ebf8b1fa2daa79a483164db4b1d643c84e23c7d',
  sourceValues: '72474e8cad1f7b9eb929f18d2a243c25c56acd3507604de542ac8f7efedc18f9',
  strictMath: '273762d3d9b3104dcce398ca2c2145aafc727ffd2d2507f7d659e604970eac37',
  sourceManifest: '74a322d6b4914c4ee54b5cba09bdffb89adf0917276512b220d0f85c79262b34',
  inputVersion: '08d40948c9bcd29b2acb2d235563dba3957606dca0ba2a564d4d3a8c717de7e4',
  sourceBinding: 'd56f5c20188d75dfffbdae773017a189b53162ed649e90f913febbfbe6c0a657',
  protection: 'e5b0bb32f613f06dd395208ac6d571013ace347ea34cfd04ec570ce9b4221583',
  reuse: 'c991eddfa5bf955dadf0d1e37c0ca4acc8c6addfb35a01b2e00ff395fd6df94f',
  writer: '45d5bb3dd99800e768bb2519d50e9ba462fa1168976822c7225d2d2ae88f985e',
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
assert(candidate.meta?.batch === '英雄机制第三十二批', '候选批次不符');
assert(candidate.meta?.apiCalls === 0 && candidate.meta?.businessWrites === 0 && candidate.apiWrites === 0, '候选含业务调用记录');
assert(plan.noApiCalls === true, '计划不是只读计划');
assert(version.candidateSha256 === frozen.candidate && version.requestPlanSha256 === frozen.plan, '候选版本散列不符');
assert(sourceBinding.clientVersion === '16.17' && sourceBinding.officialVersion === '16.17.1', '来源版本不符');
assert(inputVersion.apiWrites === 0 && inputVersion.GETs === 201, '输入包GET/写入计数不符');
for (const sourceFile of inputVersion.sourceFiles ?? []) {
  const file = path.join(inputDir, sourceFile.path);
  assert(fs.existsSync(file) && sha256File(file) === sourceFile.sha256, `来源文件散列变化：${sourceFile.path}`);
}
assert(lockedWrite.status === 'COMPLETED' && lockedWrite.apiWrites === 206 && lockedWrite.confirmed === 206, `业务写入未确认206项成功：${JSON.stringify(lockedWrite)}`);
assert(lockedWrite.reportPath && fs.existsSync(lockedWrite.reportPath), '业务写入执行结果不存在');
const writeResult = readJson(lockedWrite.reportPath);
assert(writeResult.success === true && writeResult.apiWrites === 206 && writeResult.counts?.POST === 206, '业务写入结果未确认206项成功');

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
assert(Array.isArray(plan.requests) && plan.requests.length === 206 && plan.requestCount === 206, '计划应为206项');
assert(JSON.stringify(plan.requestCounts) === JSON.stringify({ parameters: 164, formulas: 41, effects: 1, processes: 0, internalStates: 0, triggerRules: 0 }), '计划分类计数不符');
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
assert(plannedDetails.length === 206, '新增详情计划不是206项');

assert(Array.isArray(protection.requests) && protection.requests.length === 201 && protection.GETs === 201, '保护快照应为201条GET');
assert(protection.requests.every(request => request.status === 200), '保护快照存在非200请求');
const baselineByRoute = new Map();
for (const request of protection.requests) {
  assert(!baselineByRoute.has(request.route), `保护快照路由重复：${request.route}`);
  baselineByRoute.set(request.route, request);
}
const protectedLists = protection.requests.filter(request => collectionRoutes.has(request.route));
assert(protectedLists.length === 120, `保护组成列表应为120，实际${protectedLists.length}`);
const reusedDetails = [];
for (const item of reuseList) {
  const detailRoute = `/skills/${item.skillKey}/parameters/${encodeURIComponent(item.parameterKey)}`;
  const baseline = baselineByRoute.get(detailRoute);
  assert(baseline?.status === 200, `复用详情不在保护快照：${detailRoute}`);
  reusedDetails.push({ skillKey: item.skillKey, kind: 'parameters', stableKey: item.parameterKey, api: 'parameters', id: 'parameterKey', detailRoute, candidateBody: baseline.data, reused: true });
}
assert(reusedDetails.length === 29 && new Set(reusedDetails.map(value => value.detailRoute)).size === 29, '复用详情应为29项');
const allDetails = [
  ...reusedDetails,
  ...plannedDetails.map(intent => ({ skillKey: intent.skillKey, kind: intent.kind, stableKey: intent.stableKey, api: intent.route.split('/').at(-1), id: kinds.find(value => value.kind === intent.kind).id, detailRoute: intent.detailRoute, candidateBody: intent.body, reused: false })),
];
assert(allDetails.length === 235 && new Set(allDetails.map(value => value.detailRoute)).size === 235, '当前详情应为235项');
const freshRoutes = [...new Set([...protection.requests.map(request => request.route), ...plannedDetails.map(intent => intent.detailRoute)])];
assert(freshRoutes.length === 407, `独立唯一GET应为407，实际${freshRoutes.length}`);

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
      headers: { Authorization: `Bearer ${process.env.HERO32_API_TOKEN || 'local-entry'}`, Accept: 'application/json' },
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
    generatedAt: new Date().toISOString(), mode: '第三十二批写后独立全字段GET', afterApply: true,
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
const allStatus200 = calls.length === 407 && new Set(calls.map(call => call.route)).size === 407 && calls.every(call => call.method === 'GET' && call.status === 200);
const protectionPassed = protectionResult.checked === 201 && protectionResult.passed === 201 && protectionResult.failures.length === 0;
const detailsPassed = detailResult.checked === 235 && detailResult.matched === 235 && detailResult.reusedChecked === 29 && detailResult.plannedChecked === 206 && detailResult.failures.length === 0;
const actualDetails = allDetails.map(entry => ({
  skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute,
  expected: entry.reused ? '复用既有组成' : '本批新增', status: resultByRoute.get(entry.detailRoute)?.status ?? null,
  data: resultByRoute.get(entry.detailRoute)?.data ?? null,
}));
const report = {
  generatedAt: new Date().toISOString(),
  mode: '第三十二批写后独立全字段GET回读',
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
    protectedRoutes: 201, protectedLists: 120, protectedCatalogs: 4, protectedCharacters: 4,
    protectedRelations: 4, protectedSubjects: 20, protectedImages: 20, reusedDetails: 29,
    plannedNewDetails: 206, componentDetails: 235, uniqueFreshGET: 407,
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


