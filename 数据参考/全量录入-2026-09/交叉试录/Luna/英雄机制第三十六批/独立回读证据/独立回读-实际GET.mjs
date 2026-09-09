import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = 'C:/project/damage_web_dev';
const reviewDir = path.dirname(fileURLToPath(import.meta.url));
const revision = process.env.HERO36_CANDIDATE_REVISION || '修订一';
const candidateDir = path.join(root, '.agents', 'artifacts', 'hero36-luna-candidate', revision);
const inputDir = path.join(root, '.agents', 'artifacts', 'hero36-root-entry-20260910');
const candidatePath = path.join(candidateDir, '完整候选.json');
const planPath = path.join(candidateDir, '写前请求计划.json');
const baselinePath = path.join(inputDir, '参考资料', '当前20槽保护快照.json');
const reusePath = path.join(inputDir, '参考资料', '公共参数复用清单.json');
const expectedCandidateSha = process.env.HERO36_CANDIDATE_SHA256 || '9d278c07710b96dc7d29a91df2160ea34954daccb8cf576a0e72492295cf0313';
const expectedPlanSha = process.env.HERO36_PLAN_SHA256 || '2241e69a53f9538a4135515251f063aa5df4a03120e33163f56648d5471ec91b';
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--after-apply') throw new Error('用法：node 独立回读-实际GET.mjs --after-apply');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const writeJson = (file, value, flag) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, flag ? { flag } : undefined); };
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const stripServer = value => Array.isArray(value)
  ? value.map(stripServer)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !serverFields.has(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stripServer(child)]))
    : value;
const firstDiff = (expected, actual, at = '$') => {
  if (isDeepStrictEqual(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return { at, expected, actual };
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return { at, expected, actual };
    for (let index = 0; index < expected.length; index += 1) { const child = firstDiff(expected[index], actual[index], `${at}[${index}]`); if (child) return child; }
    return null;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    if (!(key in expected) || !(key in actual)) return { at: `${at}.${key}`, expectedPresent: key in expected, actualPresent: key in actual, expected: expected[key], actual: actual[key] };
    const child = firstDiff(expected[key], actual[key], `${at}.${key}`); if (child) return child;
  }
  return null;
};
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : Array.isArray(value?.data?.items) ? value.data.items : null;

const candidateBytes = fs.readFileSync(candidatePath);
const planBytes = fs.readFileSync(planPath);
const candidate = JSON.parse(candidateBytes);
const plan = JSON.parse(planBytes);
const baseline = readJson(baselinePath);
const reuseList = readJson(reusePath);
const candidateSha = sha(candidatePath);
const planSha = sha(planPath);
if (candidateSha !== expectedCandidateSha) throw new Error(`候选散列不符：${candidateSha}，期待${expectedCandidateSha}`);
if (planSha !== expectedPlanSha) throw new Error(`计划散列不符：${planSha}，期待${expectedPlanSha}`);
if (candidate.meta?.businessWrites !== 0 || candidate.meta?.apiCalls !== 0 || candidate.meta?.tokenStored !== false || candidate.apiWrites !== 0) throw new Error('候选含业务写入标记');
if (candidate.meta?.sourceVersion?.clientVersion !== '16.17' || candidate.meta?.sourceVersion?.officialVersion !== '16.17.1') throw new Error('来源版本不符');

const skills = candidate.order.slice();
const kinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
const kindByName = new Map(kinds.map(item => [item[0], item]));
const collectionRoutes = new Map();
for (const skillKey of skills) for (const [kind, idField, api] of kinds) collectionRoutes.set(`/skills/${skillKey}/${api}`, { skillKey, kind, idField });
const candidateEntries = [];
for (const skillKey of skills) {
  const block = candidate.skills?.[skillKey];
  if (!block || block.skillKey !== skillKey) throw new Error(`候选技能缺失：${skillKey}`);
  for (const [kind, idField, api] of kinds) {
    const values = block.write?.[kind];
    if (!Array.isArray(values)) throw new Error(`候选六类字段缺失：${skillKey}/${kind}`);
    const ids = values.map(item => item?.[idField]);
    if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error(`候选键缺失或重复：${skillKey}/${kind}`);
    for (const body of values) candidateEntries.push({ skillKey, kind, idField, api, stableKey: body[idField], route: `/skills/${skillKey}/${api}`, detailRoute: `/skills/${skillKey}/${api}/${encodeURIComponent(body[idField])}`, expectedBody: body, expected: '本批新增' });
  }
}
const newCount = candidateEntries.length;
if (newCount !== 160) throw new Error(`候选新增总数不符：${newCount}`);
const baselineByRoute = new Map();
for (const item of baseline.requests ?? []) { if (baselineByRoute.has(item.route)) throw new Error(`保护路由重复：${item.route}`); baselineByRoute.set(item.route, item); }
if (baseline.requests?.length !== 202) throw new Error(`保护基线应为202项，实际${baseline.requests?.length}`);
const reusedEntries = reuseList.map(item => {
  const detailRoute = `/skills/${item.skillKey}/parameters/${encodeURIComponent(item.parameterKey)}`;
  const frozen = baselineByRoute.get(detailRoute);
  if (!frozen || frozen.status !== 200) throw new Error(`复用参数不在保护详情：${detailRoute}`);
  return { skillKey: item.skillKey, kind: 'parameters', idField: 'parameterKey', api: 'parameters', stableKey: item.parameterKey, route: `/skills/${item.skillKey}/parameters`, detailRoute, expectedBody: frozen.data, expected: '既有公共复用' };
});
if (reusedEntries.length !== 30 || new Set(reusedEntries.map(item => item.detailRoute)).size !== 30) throw new Error('复用参数应为30项');
const allEntries = [...candidateEntries, ...reusedEntries];
if (allEntries.length !== 190 || new Set(allEntries.map(item => item.detailRoute)).size !== 190) throw new Error('最终详情应为160项新增加30项复用');
if (plan.requestCount !== 160 || plan.requests?.length !== 160) throw new Error('计划应为160项新增');
const candidateEntryByKey = new Map(candidateEntries.map(item => [`${item.skillKey}|${item.kind}|${item.stableKey}`, item]));
for (const intent of plan.requests) {
  const kind = kindByName.get(intent.kind);
  const entry = candidateEntryByKey.get(`${intent.skillKey}|${intent.kind}|${intent.stableKey}`);
  if (!kind || intent.method !== 'POST' || intent.route !== `/skills/${intent.skillKey}/${kind[2]}` || intent.stableKey !== intent.body?.[kind[1]] || !entry || !isDeepStrictEqual(entry.expectedBody, intent.body)) throw new Error(`计划与候选不匹配：${intent.skillKey}/${intent.kind}/${intent.stableKey}`);
}

function latestWriterEvidence() {
  const explicit = process.env.HERO36_WRITE_RESULT;
  const files = explicit ? [path.resolve(explicit)] : [];
  const actualDir = path.join(candidateDir, '实际写入');
  if (!explicit && fs.existsSync(actualDir)) {
    const stack = [actualDir];
    while (stack.length) { const current = stack.pop(); for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const item = path.join(current, entry.name); if (entry.isDirectory()) stack.push(item); else if (entry.name === '执行结果.json') files.push(item); } }
  }
  const parsed = files.map(file => { try { return { file, mtimeMs: fs.statSync(file).mtimeMs, data: readJson(file) }; } catch { return null; } }).filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const lockPath = path.join(candidateDir, '实际写入锁.json');
  const lock = fs.existsSync(lockPath) ? readJson(lockPath) : null;
  const result = parsed[0] ?? null;
  const resultSuccess = result?.data?.success === true || result?.data?.status === 'COMPLETED' || result?.data?.complete === true;
  const confirmed = Number(result?.data?.confirmed ?? result?.data?.created ?? result?.data?.apiWrites ?? 0);
  if (!result || lock?.status !== 'COMPLETED' || !resultSuccess || confirmed < newCount) throw new Error(`未发现完成的第36批实际写入证据；需锁COMPLETED且确认${newCount}项，当前=${JSON.stringify({ result: result?.file, resultSuccess, confirmed, lock: lock?.status })}`);
  return { resultPath: result.file, resultSha256: sha(result.file), lockPath, lock, result: result.data };
}
const writerEvidence = latestWriterEvidence();

const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const runDir = path.join(reviewDir, '实际回读', runId);
const journalPath = path.join(runDir, '所有GET原始响应.jsonl');
fs.mkdirSync(runDir, { recursive: true });
const runLockPath = path.join(runDir, '运行锁.json');
writeJson(runLockPath, { runId, startedAt: new Date().toISOString(), mode: '写后独立全字段GET', candidateSha256: candidateSha, planSha256: planSha, apiWrites: 0, status: 'RUNNING' }, 'wx');
const calls = [];
const resultByRoute = new Map();
const failures = [];
const append = value => { const fd = fs.openSync(journalPath, 'a'); try { fs.writeSync(fd, `${JSON.stringify(value)}\n`, undefined, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
const safeRoute = route => { if (typeof route !== 'string' || !route.startsWith('/') || route.includes('://') || route.includes('..') || route.includes('#')) throw new Error(`非法GET路径：${route}`); };
async function get(route) {
  safeRoute(route);
  const seq = calls.length + 1;
  append({ phase: 'BEFORE', seq, method: 'GET', route, at: new Date().toISOString() });
  let record;
  try {
    const response = await fetch(`${candidate.meta.apiBase}${route}`, { method: 'GET', headers: { Authorization: `Bearer ${process.env.HERO36_API_TOKEN || 'local-entry'}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const text = await response.text();
    let data = null; let parseError = null;
    if (text.length) { try { data = JSON.parse(text); } catch (error) { parseError = String(error.message || error); } }
    record = { seq, method: 'GET', route, status: response.status, data, ...(parseError ? { parseError, responseBytes: Buffer.byteLength(text), responseSha256: crypto.createHash('sha256').update(text).digest('hex') } : {}), finishedAt: new Date().toISOString() };
  } catch (error) { record = { seq, method: 'GET', route, status: null, data: null, error: String(error.stack || error), finishedAt: new Date().toISOString() }; }
  append({ phase: 'AFTER', ...record }); calls.push(record); resultByRoute.set(route, record);
  if (record.status !== 200 || record.parseError) throw new Error(`GET失败并停止：${route} status=${record.status ?? 'network'} ${record.parseError || record.error || ''}`);
  return record;
}

const listComparisons = [];
const protectedComparisons = [];
const categories = { catalogs: 0, characters: 0, relations: 0, subjects: 0, images: 0, componentLists: 0, reusedDetails: 0 };
const categoryOf = route => {
  if (['/attributes', '/skill-categories', '/modifier-zones', '/damage-types'].includes(route)) return 'catalogs';
  if (route.startsWith('/characters/')) return 'characters';
  if (route.startsWith('/character-skill-relations?')) return 'relations';
  if (route.includes('/representative-image')) return 'images';
  if (/^\/skills\/[^/]+$/.test(route)) return 'subjects';
  if (collectionRoutes.has(route)) return 'componentLists';
  if (reusedEntries.some(item => item.detailRoute === route)) return 'reusedDetails';
  return 'unknown';
};
const projectedListDiff = (expected, actual, idField) => {
  if (!actual || actual[idField] !== expected[idField]) return { at: `.${idField}`, expected: expected[idField], actual: actual?.[idField] };
  for (const key of Object.keys(expected)) if (key in actual) { const difference = firstDiff(stripServer(expected[key]), stripServer(actual[key]), `.${key}`); if (difference) return difference; }
  return null;
};

try {
  for (const frozen of baseline.requests) {
    const actual = await get(frozen.route);
    const category = categoryOf(frozen.route); categories[category] = (categories[category] ?? 0) + 1;
    const record = { route: frozen.route, category, expectedStatus: frozen.status, actualStatus: actual.status, passed: false };
    const collection = collectionRoutes.get(frozen.route);
    if (!collection) { record.diff = firstDiff(stripServer(frozen.data), stripServer(actual.data)); record.passed = actual.status === frozen.status && !record.diff; }
    else {
      const oldRows = rows(frozen.data) ?? []; const actualRows = rows(actual.data) ?? []; const planned = plan.requests.filter(item => item.route === frozen.route);
      const oldKeys = oldRows.map(item => item?.[collection.idField]); const actualKeys = actualRows.map(item => item?.[collection.idField]);
      const allowed = new Set([...oldKeys, ...planned.map(item => item.stableKey)]);
      const oldDifferences = oldRows.map(item => ({ id: item[collection.idField], diff: firstDiff(stripServer(item), stripServer(actualRows.find(row => row?.[collection.idField] === item[collection.idField]))) })).filter(item => item.diff);
      const plannedDifferences = planned.map(item => ({ id: item.stableKey, diff: projectedListDiff(item.body, actualRows.find(row => row?.[collection.idField] === item.stableKey), collection.idField) })).filter(item => item.diff);
      record.oldCount = oldRows.length; record.actualCount = actualRows.length; record.plannedCount = planned.length; record.unexpected = actualKeys.filter(id => !allowed.has(id)); record.missingOld = oldKeys.filter(id => !actualKeys.includes(id)); record.duplicateKeys = actualKeys.filter((id, index) => actualKeys.indexOf(id) !== index); record.oldDifferences = oldDifferences; record.plannedDifferences = plannedDifferences;
      record.passed = Array.isArray(rows(frozen.data)) || Array.isArray(frozen.data) || Array.isArray(frozen.data?.items) ? actualRows.length === allowed.size && record.unexpected.length === 0 && record.missingOld.length === 0 && record.duplicateKeys.length === 0 && oldDifferences.length === 0 && plannedDifferences.length === 0 : false;
    }
    if (!record.passed) failures.push({ area: '保护', ...record });
    record.passed = record.passed && actual.status === frozen.status;
    protectedComparisons.push(record);
  }
  const protectionExpectedCounts = { catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, componentLists: 120, reusedDetails: 30 };
  for (const [key, value] of Object.entries(protectionExpectedCounts)) if (categories[key] !== value) failures.push({ area: '保护分组计数', category: key, expected: value, actual: categories[key] });
  for (const entry of allEntries) {
    const actual = await get(entry.detailRoute);
    const difference = firstDiff(stripServer(entry.expectedBody), stripServer(actual.data));
    const record = { skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute, expected: entry.expected, expectedStatus: 200, actualStatus: actual.status, diff: difference, passed: actual.status === 200 && !difference };
    if (!record.passed) failures.push({ area: '详情', ...record });
    listComparisons.push(record);
  }
} catch (error) {
  failures.push({ area: '执行', error: String(error.stack || error) });
}

const statusCounts = calls.reduce((out, item) => { const key = String(item.status); out[key] = (out[key] ?? 0) + 1; return out; }, {});
const allStatus200 = calls.length === 392 && calls.every(item => item.status === 200);
const protectionPassed = protectedComparisons.length === 202 && protectedComparisons.every(item => item.passed) && Object.entries({ catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, componentLists: 120, reusedDetails: 30 }).every(([key, value]) => categories[key] === value);
const detailsPassed = listComparisons.length === 190 && listComparisons.every(item => item.passed);
const complete = failures.length === 0 && allStatus200 && protectionPassed && detailsPassed;
const execution = { generatedAt: new Date().toISOString(), runId, status: complete ? 'PASS' : 'REVISE', complete, mode: '写后独立全字段GET', apiBase: candidate.meta.apiBase, apiWrites: 0, noBusinessWrites: true, candidateSha256: candidateSha, planSha256: planSha, writerEvidence, expected: { protectionRoutes: 202, newDetails: 160, reusedDetails: 30, allDetails: 190, calls: 392, categories: { catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, componentLists: 120, reusedDetails: 30 } }, actual: { calls: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: statusCounts, protectionRoutes: protectedComparisons.length, protectionPassed: protectedComparisons.filter(item => item.passed).length, newDetails: listComparisons.filter(item => item.expected === '本批新增').length, reusedDetails: listComparisons.filter(item => item.expected === '既有公共复用').length, details: listComparisons.length, detailsPassed: listComparisons.filter(item => item.passed).length }, protection: { categories, records: protectedComparisons }, details: listComparisons, failures, rawResponses: calls, journalPath, finishedAt: new Date().toISOString() };
writeJson(path.join(runDir, '独立保护对象.json'), { records: protectedComparisons, categories });
writeJson(path.join(runDir, '独立全量GET.json'), execution);
writeJson(path.join(runDir, '执行结果.json'), { generatedAt: execution.generatedAt, runId, status: execution.status, complete, apiWrites: 0, noBusinessWrites: true, calls: calls.length, statuses: statusCounts, protectionRoutes: protectedComparisons.length, protectionPassed: protectedComparisons.filter(item => item.passed).length, details: listComparisons.length, detailsPassed: listComparisons.filter(item => item.passed).length, candidateSha256: candidateSha, planSha256: planSha, reportPath: path.join(runDir, '独立全量GET.json'), journalPath });
writeJson(runLockPath, { runId, startedAt: JSON.parse(fs.readFileSync(runLockPath, 'utf8')).startedAt, finishedAt: execution.finishedAt, mode: execution.mode, candidateSha256: candidateSha, planSha256: planSha, apiWrites: 0, status: execution.status });
console.log(JSON.stringify({ status: execution.status, complete, calls: calls.length, methods: execution.actual.methods, statuses: statusCounts, protectionRoutes: protectedComparisons.length, protectionPassed: protectedComparisons.filter(item => item.passed).length, details: listComparisons.length, detailsPassed: listComparisons.filter(item => item.passed).length, failures: failures.length, output: runDir }, null, 2));
if (!complete) process.exitCode = 1;
