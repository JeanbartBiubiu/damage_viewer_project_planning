import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactRoot = path.resolve(here, '..');
const candidateDir = path.join(artifactRoot, 'hero33-luna-candidate', '修订二');
const originalCandidateDir = path.join(artifactRoot, 'hero33-luna-candidate');
const inputDir = path.join(artifactRoot, 'hero33-root-entry-20260910');
const candidatePath = path.join(candidateDir, '完整候选.json');
const planPath = path.join(candidateDir, '写前请求计划.json');
const freezePath = path.join(originalCandidateDir, '文件字节冻结.json');
const originalWriteLockPath = path.join(originalCandidateDir, '实际写入锁.json');
const originalWriteReportPath = path.join(originalCandidateDir, '实际写入', '2026-09-09T18-35-57-801Z', '执行结果.json');
const inputVersionPath = path.join(inputDir, '输入版本.json');
const sourceBindingPath = path.join(inputDir, '来源绑定与当前文本.json');
const protectionPath = path.join(inputDir, '参考资料', '当前20槽保护快照.json');
const reusePath = path.join(inputDir, '参考资料', '公共参数复用清单.json');

const frozen = Object.freeze({
  candidateFile: '841a100c48f51a135dbb6d4457ec5523af2030611cbbac1f2212b388be5a8b4e',
  planFile: '0deb6cea79b44b7f9db2a73a0fedc4d91802f650abcc4703fac3070513acbf52',
  originalCandidateFile: 'f678c8d8c929feef920a97577fa559d404697f1e9d718f78fde70dec6ce90fec',
  originalPlanFile: '5ab6731931844099d267ed52b8474d3bc4701741b9a703387f3ff881bb9bde5d',
  candidateContent: '9d09798406df9fc6e50152211a2611c8fd5d2bead66dabed373d0c6600339a23',
  planContent: 'd5bb6040b51c2c2293706ccc91a4dcd9af9ae80f7a13641562cc3d4886a0519a',
});
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    // 列表接口可能只返回摘要字段；详情接口负责完整字段比较。
    if (!Object.hasOwn(actual, field)) continue;
    const difference = firstDiff(strip(expected[field]), strip(actual[field]), `.${field}`);
    if (difference) return difference;
  }
  return null;
}

function safeRoute(route) {
  assert(typeof route === 'string' && route.startsWith('/') && !route.includes('://') && !route.includes('..') && !route.includes('#'), `不安全接口路径：${route}`);
}

const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const freeze = readJson(freezePath);
const inputVersion = readJson(inputVersionPath);
const sourceBinding = readJson(sourceBindingPath);
const protection = readJson(protectionPath);
const reuseList = readJson(reusePath);

assert(sha256File(candidatePath) === frozen.candidateFile, '修订二候选原始字节散列变化');
assert(sha256File(planPath) === frozen.planFile, '修订二计划原始字节散列变化');
assert(sha256File(path.join(originalCandidateDir, '完整候选.json')) === frozen.originalCandidateFile, '原候选原始字节散列变化');
assert(sha256File(path.join(originalCandidateDir, '写前请求计划.json')) === frozen.originalPlanFile, '原计划原始字节散列变化');
assert(freeze.candidateSha256 === frozen.originalCandidateFile && freeze.planSha256 === frozen.originalPlanFile, '文件字节冻结记录不符');
assert(freeze.historicalContentSha256 === frozen.candidateContent && freeze.historicalPlanContentSha256 === frozen.planContent, '历史内容散列说明不符');
assert(candidate.meta?.candidateSha256 === frozen.candidateContent, '候选内部历史内容散列不符');
assert(candidate.meta?.batch === '英雄机制第三十三批', '候选批次不符');
assert(candidate.meta?.sourceVersion?.clientVersion === '16.17' && candidate.meta?.sourceVersion?.officialVersion === '16.17.1', '候选来源版本不符');
assert(candidate.meta?.apiCalls === 0 && candidate.meta?.businessWrites === 0 && candidate.apiWrites === 0, '候选含业务写入记录');
assert(candidate.counts?.newParameters === 131 && candidate.counts?.newFormulas === 34 && candidate.counts?.newEffects === 1, '候选新增计数不符');
assert(candidate.counts?.newProcesses === 0 && candidate.counts?.newInternalStates === 0 && candidate.counts?.newTriggerRules === 0, '候选含非本批组成');
assert(candidate.counts?.newTotal === 166 && candidate.counts?.reusedPublicParameters === 28 && candidate.counts?.plannedTotalIncludingReused === 194, '候选总计数不符');
assert(Array.isArray(candidate.order) && candidate.order.length === 20 && new Set(candidate.order).size === 20, '技能槽顺序不符');
assert(plan.candidateSha256 === frozen.candidateFile && plan.requestCount === 166 && Array.isArray(plan.requests) && plan.requests.length === 166, '修订二写前计划计数或候选散列不符');
assert(plan.noApiCalls === true && plan.requestCounts?.parameters === 131 && plan.requestCounts?.formulas === 34 && plan.requestCounts?.effects === 1, '写前计划分类不符');
assert(inputVersion.GETs === 200 && inputVersion.apiWrites === 0, '输入包保护计数不符');
assert(sourceBinding.clientVersion === '16.17' && sourceBinding.officialVersion === '16.17.1', '来源绑定版本不符');

for (const sourceFile of inputVersion.sourceFiles ?? []) {
  const file = path.join(inputDir, sourceFile.path);
  assert(!path.relative(inputDir, file).startsWith('..'), `来源文件越界：${sourceFile.path}`);
  assert(fs.existsSync(file) && sha256File(file) === sourceFile.sha256, `来源文件散列变化：${sourceFile.path}`);
}

const kinds = [
  { kind: 'parameters', api: 'parameters', id: 'parameterKey' },
  { kind: 'formulas', api: 'formulas', id: 'formulaKey' },
  { kind: 'effects', api: 'effects', id: 'effectKey' },
  { kind: 'processes', api: 'processes', id: 'processKey' },
  { kind: 'internalStates', api: 'internal-states', id: 'stateKey' },
  { kind: 'triggerRules', api: 'trigger-rules', id: 'ruleKey' },
];
const kindByName = new Map(kinds.map((item) => [item.kind, item]));
const collectionRoutes = new Map();
for (const skillKey of candidate.order) {
  for (const item of kinds) collectionRoutes.set(`/skills/${skillKey}/${item.api}`, { skillKey, ...item });
}

const candidateByDetail = new Map();
for (const skillKey of candidate.order) {
  const write = candidate.skills?.[skillKey]?.write;
  assert(write, `候选缺少技能写入结构：${skillKey}`);
  for (const item of kinds) {
    for (const body of write[item.kind] ?? []) {
      const stableKey = body?.[item.id];
      assert(typeof stableKey === 'string' && stableKey.length > 0, `候选稳定键无效：${skillKey}/${item.kind}`);
      const route = `/skills/${skillKey}/${item.api}`;
      const detailRoute = `${route}/${encodeURIComponent(stableKey)}`;
      assert(!candidateByDetail.has(detailRoute), `候选详情重复：${detailRoute}`);
      candidateByDetail.set(detailRoute, { skillKey, kind: item.kind, api: item.api, id: item.id, stableKey, route, detailRoute, candidateBody: body, reused: false });
    }
  }
}
assert(candidateByDetail.size === 166, `候选新增详情应为166项，实际${candidateByDetail.size}`);

const plannedDetails = [];
const plannedByDetail = new Map();
const plannedListIntents = new Map();
for (const intent of plan.requests) {
  const item = kindByName.get(intent.kind);
  assert(item && intent.method === 'POST', `计划请求无效：${intent.sequence}`);
  const route = `/skills/${intent.skillKey}/${item.api}`;
  const detailRoute = `${route}/${encodeURIComponent(intent.stableKey)}`;
  assert(intent.route === route && intent.detailRoute === detailRoute, `计划路径无效：${intent.sequence}`);
  assert(intent.body?.[item.id] === intent.stableKey, `计划稳定键无效：${intent.sequence}`);
  const candidateEntry = candidateByDetail.get(detailRoute);
  assert(candidateEntry && equal(candidateEntry.candidateBody, intent.body), `计划与候选不一致：${detailRoute}`);
  assert(!plannedByDetail.has(detailRoute), `计划详情重复：${detailRoute}`);
  const entry = { skillKey: intent.skillKey, kind: intent.kind, api: item.api, id: item.id, stableKey: intent.stableKey, route, detailRoute, candidateBody: intent.body, reused: false, sequence: intent.sequence };
  plannedDetails.push(entry);
  plannedByDetail.set(detailRoute, entry);
  if (!plannedListIntents.has(route)) plannedListIntents.set(route, []);
  plannedListIntents.get(route).push(intent);
}
assert(plannedDetails.length === 166 && plannedByDetail.size === 166, '计划新增详情应为166项');

const baselineByRoute = new Map();
for (const request of protection.requests ?? []) {
  assert(request.status === 200 && typeof request.route === 'string' && !baselineByRoute.has(request.route), `保护快照无效或重复：${request.route}`);
  baselineByRoute.set(request.route, request);
}
assert(protection.GETs === 200 && baselineByRoute.size === 200, '保护路径应为200条');
const protectedLists = protection.requests.filter((request) => collectionRoutes.has(request.route));
assert(protectedLists.length === 120, `保护组成列表应为120条，实际${protectedLists.length}`);

const reusedDetails = [];
for (const item of reuseList) {
  const detailRoute = `/skills/${item.skillKey}/parameters/${encodeURIComponent(item.parameterKey)}`;
  const baseline = baselineByRoute.get(detailRoute);
  assert(baseline?.status === 200 && !plannedByDetail.has(detailRoute), `复用详情不在保护快照或与新增重叠：${detailRoute}`);
  reusedDetails.push({ skillKey: item.skillKey, kind: 'parameters', api: 'parameters', id: 'parameterKey', stableKey: item.parameterKey, route: `/skills/${item.skillKey}/parameters`, detailRoute, candidateBody: baseline.data, reused: true });
}
assert(reusedDetails.length === 28 && new Set(reusedDetails.map((entry) => entry.detailRoute)).size === 28, '复用参数应为28项');
const allDetails = [...reusedDetails, ...plannedDetails];
assert(allDetails.length === 194 && new Set(allDetails.map((entry) => entry.detailRoute)).size === 194, '最终组成详情应为194项');
const freshRoutes = [...new Set([...protection.requests.map((request) => request.route), ...plannedDetails.map((entry) => entry.detailRoute)])];
assert(freshRoutes.length === 366, `独立唯一GET应为366条，实际${freshRoutes.length}`);

function findCompletedWrite() {
  const explicit = process.env.HERO33_LOCK_PATH ? [process.env.HERO33_LOCK_PATH] : [path.join(candidateDir, '实际写入锁.json')];
  const candidates = [...new Set(explicit.map((file) => path.resolve(file)))];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const lock = readJson(file);
    if (lock.status === 'COMPLETED') return { path: file, lock };
  }
  throw new Error(`166项业务写入锁尚未COMPLETED：${candidates.join(',')}`);
}

assert(fs.existsSync(originalWriteLockPath) && fs.existsSync(originalWriteReportPath), '首轮业务写入证据不存在');
const originalWriteLock = readJson(originalWriteLockPath);
const originalWriteResult = readJson(originalWriteReportPath);
assert(originalWriteLock.status === 'STOPPED' && originalWriteLock.apiWrites === 154 && originalWriteLock.confirmed === 154, `首轮应为154项成功后停止：${JSON.stringify(originalWriteLock)}`);
assert(originalWriteResult.success === false && originalWriteResult.apiWrites === 154 && originalWriteResult.confirmed === 154 && originalWriteResult.counts?.POST === 155, '首轮154成功及1拒绝证据不符');

const completedWrite = findCompletedWrite();
assert(completedWrite.lock.apiWrites === 12 && completedWrite.lock.confirmed === 12, `修订二恢复写入锁计数不符：${JSON.stringify(completedWrite.lock)}`);
assert(completedWrite.lock.reportPath && fs.existsSync(completedWrite.lock.reportPath), '写入执行结果不存在');
const writeResult = readJson(completedWrite.lock.reportPath);
assert(writeResult.success === true && writeResult.apiWrites === 12 && writeResult.confirmed === 12 && writeResult.counts?.POST === 12, '修订二恢复写入结果未确认12项POST成功');

const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const runDir = path.join(here, '实际回读', runId);
fs.mkdirSync(runDir, { recursive: true });
const journalPath = path.join(runDir, '所有GET原始响应.jsonl');
const calls = [];
let sequence = 0;
function journal(value) {
  const fd = fs.openSync(journalPath, 'a');
  try { fs.writeSync(fd, `${JSON.stringify(value)}\n`, undefined, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
async function get(route) {
  safeRoute(route);
  const seq = ++sequence;
  journal({ phase: 'BEFORE', seq, method: 'GET', route, at: new Date().toISOString() });
  let result;
  try {
    const response = await fetch(`${apiBase}${route}`, { method: 'GET', headers: { Authorization: `Bearer ${process.env.HERO33_API_TOKEN || 'local-entry'}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const text = await response.text();
    let data = null;
    let parseError = null;
    if (text.length) {
      try { data = JSON.parse(text); } catch (error) { parseError = String(error.message || error); }
    }
    result = { seq, method: 'GET', route, status: response.status, data, ...(parseError ? { parseError, bodyText: text } : {}), finishedAt: new Date().toISOString() };
  } catch (error) {
    result = { seq, method: 'GET', route, status: null, data: null, error: String(error.message || error), finishedAt: new Date().toISOString() };
  }
  journal({ phase: 'AFTER', ...result });
  calls.push(result);
  if (result.status === null || result.parseError) throw new Error(`GET失败，停止回读：${route}，${result.error || result.parseError}`);
  if (result.status !== 200) throw new Error(`GET状态异常，停止回读：${route}，状态=${result.status}`);
  return result;
}

function category(route) {
  if (['/attributes', '/skill-categories', '/modifier-zones', '/damage-types'].includes(route)) return '目录';
  if (route.startsWith('/characters/')) return '角色';
  if (route.startsWith('/character-skill-relations?')) return '关系';
  if (route.includes('/representative-image')) return '图片';
  if (/^\/skills\/[^/]+$/.test(route)) return '主体';
  if (collectionRoutes.has(route)) return '六类列表';
  if (reusedDetails.some((entry) => entry.detailRoute === route)) return '复用详情';
  return '新增详情';
}

const resultByRoute = new Map();
let reportWritten = false;
function statuses() {
  return calls.reduce((out, call) => { const key = String(call.status); out[key] = (out[key] || 0) + 1; return out; }, {});
}
function stop(error) {
  if (reportWritten) return;
  const execution = { generatedAt: new Date().toISOString(), mode: '第三十三批写后独立全字段GET回读', afterApply: true, status: 'STOPPED', complete: false, apiWrites: 0, noBusinessWrites: true, calls: calls.length, methods: { GET: calls.length }, statuses: statuses(), error: String(error?.stack || error), journalPath, frozen, writeEvidence: { lockPath: completedWrite.path, lock: completedWrite.lock } };
  writeJson(path.join(runDir, '执行结果.json'), execution, 'wx');
  reportWritten = true;
  console.log(JSON.stringify({ status: execution.status, complete: false, apiWrites: 0, calls: calls.length, output: runDir, error: execution.error }, null, 2));
}

function checkProtection() {
  const records = [];
  const failures = [];
  const counts = { catalogs: 0, characters: 0, relations: 0, subjects: 0, images: 0, componentLists: 0, reusedDetails: 0 };
  for (const expected of protection.requests) {
    const actual = resultByRoute.get(expected.route);
    const record = { route: expected.route, category: category(expected.route), expectedStatus: expected.status, actualStatus: actual?.status ?? null, passed: false };
    if (!actual || actual.status !== expected.status) { record.reason = '状态码变化'; records.push(record); failures.push(record); continue; }
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
      const planned = plannedListIntents.get(expected.route) ?? [];
      const oldKeys = oldRows?.map((row) => row?.[collection.id]) ?? [];
      const actualKeys = actualRows?.map((row) => row?.[collection.id]) ?? [];
      const allowed = new Set([...oldKeys, ...planned.map((intent) => intent.stableKey)]);
      const oldDifferences = [];
      for (const oldRow of oldRows ?? []) {
        const current = actualRows?.find((row) => row?.[collection.id] === oldRow[collection.id]);
        const diff = listProjectedDiff(oldRow, current, collection.id);
        if (diff) oldDifferences.push({ stableKey: oldRow[collection.id], diff });
      }
      const plannedDifferences = [];
      for (const intent of planned) {
        const current = actualRows?.find((row) => row?.[collection.id] === intent.stableKey);
        const diff = listProjectedDiff(intent.body, current, collection.id);
        if (diff) plannedDifferences.push({ stableKey: intent.stableKey, diff });
      }
      record.oldCount = oldRows?.length ?? null;
      record.actualCount = actualRows?.length ?? null;
      record.plannedCount = planned.length;
      record.unexpected = actualKeys.filter((key) => !allowed.has(key));
      record.missingOld = oldKeys.filter((key) => !actualKeys.includes(key));
      record.missingPlanned = planned.map((intent) => intent.stableKey).filter((key) => !actualKeys.includes(key));
      record.duplicateKeys = actualKeys.filter((key, index) => actualKeys.indexOf(key) !== index);
      record.oldDifferences = oldDifferences;
      record.plannedDifferences = plannedDifferences;
      record.passed = Array.isArray(oldRows) && Array.isArray(actualRows)
        && new Set(oldKeys).size === oldKeys.length && new Set(actualKeys).size === actualKeys.length
        && record.unexpected.length === 0 && record.missingOld.length === 0 && record.missingPlanned.length === 0
        && record.duplicateKeys.length === 0 && oldDifferences.length === 0 && plannedDifferences.length === 0;
    }
    records.push(record);
    if (!record.passed) failures.push(record);
  }
  return { checked: records.length, passed: records.filter((record) => record.passed).length, failures, records, counts };
}

function checkDetails() {
  const records = [];
  const failures = [];
  for (const entry of allDetails) {
    const actual = resultByRoute.get(entry.detailRoute);
    const diff = actual?.status === 200 ? firstDiff(strip(entry.candidateBody), strip(actual.data)) : { at: '$status', expected: 200, actual: actual?.status ?? null };
    const record = { skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute, expected: entry.reused ? '复用既有组成' : '本批新增', reused: entry.reused, status: actual?.status ?? null, passed: !diff, ...(diff ? { diff } : {}) };
    records.push(record);
    if (diff) failures.push(record);
  }
  return { checked: records.length, matched: records.filter((record) => record.passed).length, failures, reusedChecked: records.filter((record) => record.reused).length, plannedChecked: records.filter((record) => !record.reused).length, records };
}

try {
  for (const route of freshRoutes) resultByRoute.set(route, await get(route));
  const protectionResult = checkProtection();
  const detailResult = checkDetails();
  const actualDetails = allDetails.map((entry) => ({ skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute, expected: entry.reused ? '复用既有组成' : '本批新增', status: resultByRoute.get(entry.detailRoute)?.status ?? null, data: resultByRoute.get(entry.detailRoute)?.data ?? null }));
  const allStatus200 = calls.length === 366 && new Set(calls.map((call) => call.route)).size === 366 && calls.every((call) => call.method === 'GET' && call.status === 200);
  const protectionPassed = protectionResult.checked === 200 && protectionResult.passed === 200 && protectionResult.failures.length === 0;
  const detailsPassed = detailResult.checked === 194 && detailResult.matched === 194 && detailResult.reusedChecked === 28 && detailResult.plannedChecked === 166 && detailResult.failures.length === 0;
  const report = {
    generatedAt: new Date().toISOString(), mode: '第三十三批写后独立全字段GET回读', afterApply: true, apiBase, apiWrites: 0, noBusinessWrites: true,
    methodology: '确认166项业务写入锁为COMPLETED且执行结果全201后，按200条冻结保护GET和166项最终新增详情逐条独立GET；目录、四角色、四关系、20主体、20图片、120条六类组成列表、28项公共参数复用详情与166项新增详情均保留完整响应。列表保留旧行并核对本批计划投影字段，详情执行去除易变字段后的完整字段比对。本报告只做GET回读，不包含公式数学验收。',
    hashes: { candidateFileSha256: sha256File(candidatePath), planFileSha256: sha256File(planPath), originalCandidateFileSha256: sha256File(path.join(originalCandidateDir, '完整候选.json')), originalPlanFileSha256: sha256File(path.join(originalCandidateDir, '写前请求计划.json')), candidateHistoricalContentSha256: candidate.meta.candidateSha256, historicalPlanContentSha256: freeze.historicalPlanContentSha256, planDeclaredCandidateFileSha256: plan.candidateSha256, byteFreezeSha256: sha256File(freezePath), inputVersionSha256: sha256File(inputVersionPath), sourceBindingSha256: sha256File(sourceBindingPath), protectionSnapshotSha256: sha256File(protectionPath), reuseSha256: sha256File(reusePath) },
    sourceVersion: candidate.meta.sourceVersion,
    expected: { protectedRoutes: 200, protectedLists: 120, protectedCatalogs: 4, protectedCharacters: 4, protectedRelations: 4, protectedSubjects: 20, protectedImages: 20, reusedDetails: 28, plannedNewDetails: 166, componentDetails: 194, uniqueFreshGET: 366 },
    actual: { calls: calls.length, uniqueFreshGET: new Set(calls.map((call) => call.route)).size, methods: { GET: calls.length }, statuses: statuses(), allStatus200, journalPath },
    protection: protectionResult, details: detailResult,
    fullBusinessFields: { protectedRoutes: protection.requests.map((request) => ({ route: request.route, category: category(request.route), status: resultByRoute.get(request.route)?.status ?? null, data: resultByRoute.get(request.route)?.data ?? null })), componentDetails: actualDetails },
    rawResponses: calls,
    writeEvidence: {
      firstRun: { lockPath: originalWriteLockPath, lock: originalWriteLock, reportPath: originalWriteReportPath, reportSha256: sha256File(originalWriteReportPath), result: { success: originalWriteResult.success, apiWrites: originalWriteResult.apiWrites, confirmed: originalWriteResult.confirmed, counts: originalWriteResult.counts } },
      recoveryRun: { lockPath: completedWrite.path, lock: completedWrite.lock, reportPath: completedWrite.lock.reportPath, reportSha256: sha256File(completedWrite.lock.reportPath), result: { success: writeResult.success, apiWrites: writeResult.apiWrites, confirmed: writeResult.confirmed, counts: writeResult.counts } },
      cumulativeSuccessfulPosts: 166,
      cumulativeRejectedPosts: 1,
    },
    frozen,
    status: allStatus200 && protectionPassed && detailsPassed ? 'PASS' : 'REVISE', complete: allStatus200 && protectionPassed && detailsPassed,
  };
  const reportPath = path.join(runDir, '独立全量回读.json');
  writeJson(reportPath, report, 'wx');
  const execution = { generatedAt: report.generatedAt, mode: report.mode, afterApply: true, status: report.status, complete: report.complete, apiWrites: 0, noBusinessWrites: true, calls: report.actual.calls, methods: report.actual.methods, statuses: report.actual.statuses, protection: { checked: report.protection.checked, passed: report.protection.passed }, details: { checked: report.details.checked, matched: report.details.matched, reusedChecked: report.details.reusedChecked, plannedChecked: report.details.plannedChecked }, reportPath, journalPath, writeEvidence: report.writeEvidence };
  writeJson(path.join(runDir, '执行结果.json'), execution, 'wx');
  reportWritten = true;
  console.log(JSON.stringify({ status: report.status, complete: report.complete, apiWrites: 0, calls: report.actual.calls, statuses: report.actual.statuses, protection: execution.protection, details: execution.details, output: runDir }, null, 2));
  if (!report.complete) process.exitCode = 1;
} catch (error) {
  stop(error);
  process.exitCode = 1;
  throw error;
}
