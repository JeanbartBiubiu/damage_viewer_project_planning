import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = 'C:/project/damage_web_dev';
const reviewDir = path.dirname(fileURLToPath(import.meta.url));
const revision = process.env.HERO50_CANDIDATE_REVISION || '修订二';
const candidateDir = path.join(root, '.agents', 'artifacts', 'hero50-luna-candidate', revision);
const inputDir = path.join(root, '.agents', 'artifacts', 'hero50-root-entry-20260910');
const candidatePath = path.join(candidateDir, '完整候选.json');
const planPath = path.join(candidateDir, '请求计划.json');
const baselinePath = path.join(inputDir, '参考资料', '当前20槽保护快照.json');
const reusePath = path.join(inputDir, '参考资料', '公共参数复用清单.json');
const expectedCandidateSha = process.env.HERO50_CANDIDATE_SHA256 || '0ce76bd47383a74900ed3c2b6e3a7a070c3608c741c30016595ecad0b56b5dba';
const expectedPlanSha = process.env.HERO50_PLAN_SHA256 || '403cf72c8dc50c1e203d1a5fdf1fccb8b0b4a6253e9c19865095909af12ba69f';
if (JSON.parse(fs.readFileSync(path.join(root,'.agents','artifacts','hero50-root-execution','实际写入锁.json'))).status !== 'COMPLETED') throw new Error('实际保存未完成，不启动独立GET');
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
if (candidate.meta?.sourceVersion?.build !== '16.17.8104348+branch.releases-16-17.content.release') throw new Error('来源构建不符');

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
if (newCount !== 170) throw new Error(`候选新增总数不符：${newCount}`);
const baselineByRoute = new Map();
for (const item of baseline.requests ?? []) { if (baselineByRoute.has(item.route)) throw new Error(`保护路由重复：${item.route}`); baselineByRoute.set(item.route, item); }
if (baseline.requests?.length !== 292) throw new Error(`保护基线应为292项，实际${baseline.requests?.length}`);
const reusedEntries = baseline.requests.flatMap(item => {
  const match=item.route.match(/^\/skills\/([^/]+)\/(parameters|formulas|effects|processes|internal-states|trigger-rules)\/([^/]+)$/);
  if(!match)return [];
  const[,skillKey,api,stableKey]=match;
  const[kind,idField]=kinds.find(x=>x[2]===api);
  if(!skills.includes(skillKey)||item.status!==200)throw new Error('旧组成详情不符: '+item.route);
  return [{skillKey,kind,idField,api,stableKey,route:'/skills/'+skillKey+'/'+api,detailRoute:item.route,expectedBody:item.data,expected:'既有完整组成保护'}];
});
if(reuseList.length!==26||reuseList.some(x=>!reusedEntries.some(e=>e.skillKey===x.skillKey&&e.kind==='parameters'&&e.stableKey===x.parameterKey)))throw new Error('26公共参数必须包含在120旧组成内');
if (reusedEntries.length !== 120 || new Set(reusedEntries.map(item => item.detailRoute)).size !== 120) throw new Error('受保护旧组成应为120项');
const allEntries = [...candidateEntries, ...reusedEntries];
if (allEntries.length !== 290 || new Set(allEntries.map(item => item.detailRoute)).size !== 290) throw new Error('最终详情应为170项新增加120项既有组成');
if (plan.requestCount !== 170 || plan.requests?.length !== 170) throw new Error('计划应为170项新增');
const candidateEntryByKey = new Map(candidateEntries.map(item => [`${item.skillKey}|${item.kind}|${item.stableKey}`, item]));
for (const intent of plan.requests) {
  const kind = kindByName.get(intent.kind);
  const entry = candidateEntryByKey.get(`${intent.skillKey}|${intent.kind}|${intent.stableKey}`);
  if (!kind || intent.method !== 'POST' || intent.route !== `/skills/${intent.skillKey}/${kind[2]}` || intent.stableKey !== intent.body?.[kind[1]] || !entry || !isDeepStrictEqual(entry.expectedBody, intent.body)) throw new Error(`计划与候选不匹配：${intent.skillKey}/${intent.kind}/${intent.stableKey}`);
}

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
    const response = await fetch(`${candidate.meta.apiBase}${route}`, { method: 'GET', headers: { Authorization: `Bearer ${process.env.HERO50_API_TOKEN || 'local-entry'}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
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
  const protectionExpectedCounts = { catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, componentLists: 120, reusedDetails: 120 };
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
const allStatus200 = calls.length === 582 && calls.every(item => item.status === 200);
const protectionPassed = protectedComparisons.length === 292 && protectedComparisons.every(item => item.passed) && Object.entries({ catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, componentLists: 120, reusedDetails: 120 }).every(([key, value]) => categories[key] === value);
const detailsPassed = listComparisons.length === 290 && listComparisons.every(item => item.passed);
const complete = failures.length === 0 && allStatus200 && protectionPassed && detailsPassed;
const execution = { generatedAt: new Date().toISOString(), runId, status: complete ? 'PASS' : 'REVISE', complete, mode: '实际写入后独立全量GET', apiBase: candidate.meta.apiBase, apiWrites: 0, noBusinessWrites: true, candidateSha256: candidateSha, planSha256: planSha, expected: { protectionRoutes: 292, newDetails: 170, reusedDetails: 120, allDetails: 290, calls: 582, categories: { catalogs: 4, characters: 4, relations: 4, subjects: 20, images: 20, componentLists: 120, reusedDetails: 120 } }, actual: { calls: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: statusCounts, protectionRoutes: protectedComparisons.length, protectionPassed: protectedComparisons.filter(item => item.passed).length, newDetails: listComparisons.filter(item => item.expected === '本批新增').length, reusedDetails: listComparisons.filter(item => item.expected === '既有完整组成保护').length, details: listComparisons.length, detailsPassed: listComparisons.filter(item => item.passed).length }, protection: { categories, records: protectedComparisons }, details: listComparisons, failures, rawResponses: calls, journalPath, finishedAt: new Date().toISOString() };
writeJson(path.join(runDir, '独立保护对象.json'), { records: protectedComparisons, categories });
writeJson(path.join(runDir, '独立全量GET.json'), execution);
writeJson(path.join(runDir, '执行结果.json'), { generatedAt: execution.generatedAt, runId, status: execution.status, complete, apiWrites: 0, noBusinessWrites: true, calls: calls.length, statuses: statusCounts, protectionRoutes: protectedComparisons.length, protectionPassed: protectedComparisons.filter(item => item.passed).length, details: listComparisons.length, detailsPassed: listComparisons.filter(item => item.passed).length, candidateSha256: candidateSha, planSha256: planSha, reportPath: path.join(runDir, '独立全量GET.json'), journalPath });
writeJson(runLockPath, { runId, startedAt: JSON.parse(fs.readFileSync(runLockPath, 'utf8')).startedAt, finishedAt: execution.finishedAt, mode: execution.mode, candidateSha256: candidateSha, planSha256: planSha, apiWrites: 0, status: execution.status });
console.log(JSON.stringify({ status: execution.status, complete, calls: calls.length, methods: execution.actual.methods, statuses: statusCounts, protectionRoutes: protectedComparisons.length, protectionPassed: protectedComparisons.filter(item => item.passed).length, details: listComparisons.length, detailsPassed: listComparisons.filter(item => item.passed).length, failures: failures.length, output: runDir }, null, 2));
if (!complete) process.exitCode = 1;
