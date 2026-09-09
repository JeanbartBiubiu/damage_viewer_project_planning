import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 独立全量只读回读器。它不导入写入器，也不包含POST分支；用于主负责人实际录入后重新取得完整状态。
const here = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const inputDir = path.join(here, '输入包');
const candidateFile = path.join(here, '完整候选.json');
const planFile = path.join(here, '写前请求计划.json');
const snapshotFile = path.join(inputDir, '参考资料', '当前10槽保护快照.json');
const args = process.argv.slice(2);
if (args.some(arg => !['--expect-present', '--expect-absent'].includes(arg)) || (args.includes('--expect-present') && args.includes('--expect-absent'))) throw new Error('用法：node 独立全量回读.mjs [--expect-present|--expect-absent]');
const expectation = args.includes('--expect-present') ? 'present' : args.includes('--expect-absent') ? 'absent' : 'auto';
const candidate = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
const skills = candidate.order;
const kinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internalStates', 'stateKey'],
  ['triggerRules', 'ruleKey'],
];
const writableKinds = new Set(['parameters', 'formulas', 'effects']);
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const stripServer = value => Array.isArray(value)
  ? value.map(stripServer)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !['gameId', 'skillKey', 'createdAt', 'updatedAt'].includes(key)).sort().map(key => [key, stripServer(value[key])]))
    : value;
const diff = (expected, actual, at = '$') => {
  if (equal(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return { path: at, expected, actual };
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return { path: at, expected, actual };
    for (let index = 0; index < expected.length; index += 1) { const child = diff(expected[index], actual[index], `${at}[${index}]`); if (child) return child; }
    return null;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    if (!(key in expected) || !(key in actual)) return { path: `${at}.${key}`, expectedPresent: key in expected, actualPresent: key in actual };
    const child = diff(expected[key], actual[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
};
const protectedDiff = (expected, actual) => diff(stripServer(expected), stripServer(actual));
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : null;
const routeIsList = route => /^\/skills\/[^/]+\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/.test(route);
const routeId = route => ({ parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey', processes: 'processKey', 'internal-states': 'stateKey', 'trigger-rules': 'ruleKey' })[route.match(/^\/skills\/[^/]+\/([^/]+)$/)?.[1]];
const routeCategory = route => {
  if (['/attributes', '/skill-categories', '/modifier-zones', '/damage-types'].includes(route)) return '目录';
  if (route.startsWith('/characters/')) return '角色';
  if (route.startsWith('/character-skill-relations?')) return '关系';
  if (route.includes('/representative-image')) return '图片';
  if (/^\/skills\/[^/]+$/.test(route)) return '主体';
  if (routeIsList(route)) return '六类列表';
  if (/^\/skills\/[^/]+\/parameters\/[^/]+$/.test(route)) return '已有详情';
  return '新增详情';
};
const entryKey = (skillKey, kind, stableKey) => `${skillKey}|${kind}|${stableKey}`;
const candidateEntries = [];
for (const skillKey of skills) for (const [kind, id] of kinds) for (const body of candidate.skills?.[skillKey]?.write?.[kind] ?? []) if (writableKinds.has(kind)) candidateEntries.push({ skillKey, kind, id, stableKey: body[id], baseRoute: `/skills/${skillKey}/${kind === 'internalStates' ? 'internal-states' : kind === 'triggerRules' ? 'trigger-rules' : kind}`, detailRoute: `/skills/${skillKey}/${kind === 'internalStates' ? 'internal-states' : kind === 'triggerRules' ? 'trigger-rules' : kind}/${encodeURIComponent(body[id])}`, body });
const candidateByKey = new Map(candidateEntries.map(entry => [entryKey(entry.skillKey, entry.kind, entry.stableKey), entry]));
const baselineByRoute = new Map((snapshot.requests ?? []).map(request => [request.route, request]));
if (baselineByRoute.size !== 101 || candidateEntries.length !== 78 || plan.requestCount !== 78) throw new Error(`冻结数量不符 baseline=${baselineByRoute.size} candidate=${candidateEntries.length} plan=${plan.requestCount}`);
const baselineRoutes = [...baselineByRoute.keys()];
const freshRoutes = [...new Set([...baselineRoutes, ...candidateEntries.map(entry => entry.detailRoute)])];
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputDir = path.join(here, '独立回读', runId);
fs.mkdirSync(outputDir, { recursive: true });
const journalFile = path.join(outputDir, '全部GET原始响应.jsonl');
const calls = [];
const append = value => fs.appendFileSync(journalFile, `${JSON.stringify(value)}\n`, 'utf8');
async function get(route) {
  if (!route.startsWith('/') || route.includes('://') || route.includes('..') || route.includes('#')) throw new Error(`非法只读路径 ${route}`);
  const sequence = calls.length + 1;
  append({ phase: '请求前', sequence, method: 'GET', route, at: new Date().toISOString() });
  let result;
  try {
    const response = await fetch(apiBase + route, { method: 'GET', headers: { Authorization: `Bearer ${process.env.HERO26_API_TOKEN ?? 'local-entry'}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const text = await response.text();
    let data = null;
    let parseError = null;
    if (text.length) { try { data = JSON.parse(text); } catch (error) { parseError = String(error.message ?? error); } }
    result = { sequence, method: 'GET', route, status: response.status, data, ...(parseError ? { parseError, responseBytes: Buffer.byteLength(text), responseSha256: sha256(text) } : {}), at: new Date().toISOString() };
  } catch (error) {
    result = { sequence, method: 'GET', route, status: null, data: null, error: `${error.name ?? 'Error'}: ${error.message ?? error}`, at: new Date().toISOString() };
  }
  calls.push(result);
  append({ phase: '请求后', ...result });
  return result;
}
const responses = new Map();
for (const route of freshRoutes) responses.set(route, await get(route));

const baselineRecords = [];
const baselineFailures = [];
const counts = { catalogs: 0, characters: 0, relations: 0, subjects: 0, images: 0, lists: 0, existingDetails: 0 };
for (const expected of snapshot.requests ?? []) {
  const actual = responses.get(expected.route);
  const category = routeCategory(expected.route);
  const record = { route: expected.route, category, expectedStatus: expected.status, actualStatus: actual?.status ?? null, passed: false };
  if (category === '目录') counts.catalogs += 1;
  else if (category === '角色') counts.characters += 1;
  else if (category === '关系') counts.relations += 1;
  else if (category === '主体') counts.subjects += 1;
  else if (category === '图片') counts.images += 1;
  else if (category === '六类列表') counts.lists += 1;
  else if (category === '已有详情') counts.existingDetails += 1;
  if (!actual || actual.status !== expected.status) record.difference = { path: '$.status', expected: expected.status, actual: actual?.status ?? null };
  else if (!routeIsList(expected.route)) record.difference = protectedDiff(expected.data, actual.data);
  else {
    const id = routeId(expected.route);
    const oldRows = rows(expected.data) ?? [];
    const actualRows = rows(actual.data) ?? [];
    const planned = candidateEntries.filter(entry => entry.baseRoute === expected.route);
    const oldIds = oldRows.map(row => row?.[id]);
    const actualIds = actualRows.map(row => row?.[id]);
    const presentPlanned = planned.filter(entry => actualIds.includes(entry.stableKey));
    const allowedIds = new Set([...oldIds, ...planned.map(entry => entry.stableKey)]);
    record.oldCount = oldRows.length;
    record.actualCount = actualRows.length;
    record.plannedCount = planned.length;
    record.presentPlannedCount = presentPlanned.length;
    record.missingOld = oldIds.filter(value => !actualIds.includes(value));
    record.unexpected = actualIds.filter(value => !allowedIds.has(value));
    record.duplicateKeys = actualIds.filter((value, index) => actualIds.indexOf(value) !== index);
    record.oldDifferences = oldRows.flatMap(row => { const actualRow = actualRows.find(value => value?.[id] === row?.[id]); const difference = protectedDiff(row, actualRow); return difference ? [{ stableKey: row?.[id], difference }] : []; });
    record.plannedDifferences = presentPlanned.flatMap(entry => { const actualRow = actualRows.find(value => value?.[id] === entry.stableKey); const differences = Object.entries(entry.body).flatMap(([key, value]) => Object.hasOwn(actualRow ?? {}, key) && !equal(stripServer(value), stripServer(actualRow[key])) ? [{ key, expected: value, actual: actualRow[key] }] : []); return differences.length ? [{ stableKey: entry.stableKey, differences }] : []; });
    const expectedEnvelope = expected.data && typeof expected.data === 'object' && !Array.isArray(expected.data) ? { ...expected.data } : null;
    const actualEnvelope = actual.data && typeof actual.data === 'object' && !Array.isArray(actual.data) ? { ...actual.data } : null;
    let envelopeDifference = null;
    if (expectedEnvelope && actualEnvelope) {
      delete expectedEnvelope.items; delete actualEnvelope.items; delete expectedEnvelope.data; delete actualEnvelope.data;
      if (typeof expectedEnvelope.total === 'number') expectedEnvelope.total += presentPlanned.length;
      envelopeDifference = diff(stripServer(expectedEnvelope), stripServer(actualEnvelope));
    }
    record.envelopeDifference = envelopeDifference;
    record.passed = record.missingOld.length === 0 && record.unexpected.length === 0 && record.duplicateKeys.length === 0 && record.oldDifferences.length === 0 && record.plannedDifferences.length === 0 && !envelopeDifference && actualRows.length === oldRows.length + presentPlanned.length;
  }
  if (!routeIsList(expected.route) && actual && actual.status === expected.status) record.passed = !record.difference;
  if (!record.passed) baselineFailures.push(record);
  baselineRecords.push(record);
}
if (!equal(counts, { catalogs: 4, characters: 2, relations: 2, subjects: 10, images: 10, lists: 60, existingDetails: 13 })) baselineFailures.push({ reason: '保护分组数量错误', expected: { catalogs: 4, characters: 2, relations: 2, subjects: 10, images: 10, lists: 60, existingDetails: 13 }, actual: counts });

const candidateRecords = [];
const candidateFailures = [];
for (const entry of candidateEntries) {
  const actual = responses.get(entry.detailRoute);
  const present = actual?.status === 200;
  const expectedStatus = expectation === 'present' ? 200 : expectation === 'absent' ? 404 : present ? 200 : 404;
  const record = { skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute, expectedStatus, actualStatus: actual?.status ?? null, present, passed: false };
  if (!actual || actual.status !== expectedStatus) record.difference = { path: '$.status', expected: expectedStatus, actual: actual?.status ?? null };
  else if (present) record.difference = protectedDiff(entry.body, actual.data);
  record.passed = Boolean(actual && actual.status === expectedStatus && (!present || !record.difference));
  if (!record.passed) candidateFailures.push(record);
  candidateRecords.push(record);
}
const presentCount = candidateRecords.filter(record => record.present).length;
const missingCount = candidateRecords.length - presentCount;
const state = presentCount === candidateRecords.length ? 'allPresent' : missingCount === candidateRecords.length ? 'allMissing' : 'partial';
if (expectation === 'present' && state !== 'allPresent') candidateFailures.push({ reason: '要求全部新增组件存在', presentCount, missingCount });
if (expectation === 'absent' && state !== 'allMissing') candidateFailures.push({ reason: '要求全部新增组件缺失', presentCount, missingCount });

fs.writeFileSync(path.join(outputDir, '保护回读.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), mode: '独立fresh-GET', expectation, responses: Object.fromEntries(baselineRoutes.map(route => [route, responses.get(route)])), counts, checked: baselineRecords.length, passed: baselineFailures.length === 0, records: baselineRecords, failures: baselineFailures }, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(outputDir, '候选组件回读.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), mode: '独立fresh-GET', expectation, candidateEntries, responses: Object.fromEntries(candidateEntries.map(entry => [entry.detailRoute, responses.get(entry.detailRoute)])), state, presentCount, missingCount, checked: candidateRecords.length, passed: candidateFailures.length === 0, records: candidateRecords, failures: candidateFailures }, null, 2)}\n`, 'utf8');
const report = { generatedAt: new Date().toISOString(), runId, status: baselineFailures.length === 0 && candidateFailures.length === 0 ? '独立全量GET通过' : '独立全量GET发现差异', mode: '独立fresh-GET', expectation, apiBase, candidateSha256: sha256File(candidateFile), planSha256: sha256File(planFile), baselineSnapshotSha256: sha256File(snapshotFile), counts: { GET: calls.length, baselineRoutes: baselineRoutes.length, candidateDetailRoutes: candidateEntries.length, totalFreshGET: freshRoutes.length, ...counts, candidateDetailsPresent: presentCount, candidateDetailsMissing: missingCount }, baseline: { checked: baselineRecords.length, passed: baselineRecords.filter(record => record.passed).length, failures: baselineFailures.length }, candidates: { checked: candidateRecords.length, passed: candidateRecords.filter(record => record.passed).length, failures: candidateFailures.length, state }, apiWrites: 0, noBusinessWrites: true, passed: baselineFailures.length === 0 && candidateFailures.length === 0, outputDir };
fs.writeFileSync(path.join(outputDir, '执行结果.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
