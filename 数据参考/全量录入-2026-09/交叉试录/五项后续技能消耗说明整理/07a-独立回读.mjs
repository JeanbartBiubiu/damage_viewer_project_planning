import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const batchDir = import.meta.dirname;
const repoRoot = path.resolve(batchDir, '../../../..');
const reportPath = path.join(batchDir, '07-独立回读.json');
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const timeoutMs = 30_000;

if (fs.existsSync(reportPath)) throw new Error('07-独立回读.json already exists; refusing to overwrite');

const paths = {
  plan: path.join(batchDir, '01-纠错计划.json'),
  freeze: path.join(batchDir, '02-冻结请求.json'),
  sources: path.join(batchDir, '03-来源摘要.json'),
  baseline: path.join(batchDir, '04-写入前现值.json'),
  review: path.join(batchDir, '05-独立评审.json'),
  write: path.join(batchDir, '06-写入与即时回读.json'),
  executor: path.join(repoRoot, 'tools/authoring/update-reviewed-descriptions-v2.mjs')
};

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sha256File = file => sha256(fs.readFileSync(file));
const plan = readJson(paths.plan);
const freeze = readJson(paths.freeze);
const sources = readJson(paths.sources);
const baseline = readJson(paths.baseline);
const review = readJson(paths.review);
const write = readJson(paths.write);
const inputHashes = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, sha256File(file)]));

const fail = message => { throw new Error(`preflight failed: ${message}`); };
if (freeze.base !== base) fail(`unexpected base ${freeze.base}`);
if (review.status !== 'APPROVED') fail('05 review is not APPROVED');
if (write.status !== 'PASS' || write.businessWritesAttempted !== 9 || !Array.isArray(write.operations) || write.operations.length !== 9 || write.pendingRoute !== null) {
  fail('06 write report is not a completed nine-operation PASS');
}
if (freeze.sourceSha256 !== inputHashes.sources) fail('02.sourceSha256 does not bind 03');
if (freeze.baselineSha256 !== inputHashes.baseline) fail('02.baselineSha256 does not bind 04');
if (baseline.base !== base || baseline.businessWrites !== 0) fail('04 baseline metadata is invalid');
if (!Array.isArray(baseline.audit) || baseline.audit.length !== Object.keys(baseline.values).length) fail('04 audit/value count mismatch');
if (baseline.audit.some(entry => entry.method !== 'GET' || entry.status !== 200)) fail('04 contains non-200/non-GET evidence');

const approvedFileEntries = Object.entries(review.approvedFiles ?? {});
const approvedShaChecks = approvedFileEntries.map(([file, expectedSha256]) => {
  const actualFile = file.startsWith('tools/') ? path.join(repoRoot, file) : path.join(batchDir, file);
  const actualSha256 = sha256File(actualFile);
  return { path: file, expectedSha256, actualSha256, matches: expectedSha256 === actualSha256 };
});
if (approvedShaChecks.some(entry => !entry.matches)) fail('approved file SHA drift');

const sourceShaChecks = sources.map(source => {
  const sourceRoot = source.root === 'web' ? repoRoot : source.root === 'planning' ? path.resolve(repoRoot, '../damage_viewer_project_planning') : null;
  if (!sourceRoot) fail(`unknown source root ${source.root}`);
  const file = path.resolve(sourceRoot, source.path);
  const actualSha256 = sha256File(file);
  return { root: source.root, path: source.path, expectedSha256: source.sha256, actualSha256, matches: source.sha256 === actualSha256 };
});
if (sourceShaChecks.some(entry => !entry.matches)) fail('source SHA drift');

const planByRoute = new Map(plan.changes.map(change => [change.route, change]));
const requestByRoute = new Map(freeze.requests.map(request => [request.route, request]));
if (planByRoute.size !== 9 || requestByRoute.size !== 9 || [...planByRoute.keys()].some(route => !requestByRoute.has(route))) fail('plan/freeze route set mismatch');

const targetDetails = new Map();
const targetLists = new Map();
for (const [route, change] of planByRoute) {
  const segments = route.split('/').filter(Boolean);
  if (segments.length !== 4 || segments[0] !== 'skills' || !['parameters', 'effects'].includes(segments[2])) fail(`unsupported target route ${route}`);
  const collection = segments[2];
  const stableField = collection === 'parameters' ? 'parameterKey' : 'effectKey';
  const listPath = `/skills/${segments[1]}/${collection}`;
  targetDetails.set(route, { route, skillKey: segments[1], collection, stableField, stableKey: segments[3], listPath, expectedDescription: change.description });
  const list = targetLists.get(listPath) ?? { listPath, skillKey: segments[1], collection, stableField, targets: [] };
  list.targets.push({ detailPath: route, stableKey: segments[3], expectedDescription: change.description });
  targetLists.set(listPath, list);
}

const baselinePaths = Object.keys(baseline.values);
const targetDetailPaths = new Set(targetDetails.keys());
const targetListPaths = new Set(targetLists.keys());
const unchangedPaths = baselinePaths.filter(route => !targetDetailPaths.has(route) && !targetListPaths.has(route));
if (targetDetailPaths.size !== 9 || targetListPaths.size !== 9 || unchangedPaths.length !== 86) fail('expected 9 detail, 9 list, 86 unchanged paths');

function sameValue(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  if (typeof left !== 'object') return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameValue(left[key], right[key]));
}
function compareExcept(expected, actual, ignoredKeys) {
  const differences = [];
  if (!expected || !actual || Array.isArray(expected) || Array.isArray(actual)) return ['$'];
  const leftKeys = Object.keys(expected).filter(key => !ignoredKeys.has(key)).sort();
  const rightKeys = Object.keys(actual).filter(key => !ignoredKeys.has(key)).sort();
  if (!sameValue(leftKeys, rightKeys)) differences.push('$keys');
  for (const key of leftKeys) if (!sameValue(expected[key], actual[key])) differences.push(`$.${key}`);
  return differences;
}
function validIso(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }

const bearer = `Bearer ${crypto.randomUUID()}`;
const audit = [];
const actualValues = {};
const failures = [];
for (let index = 0; index < baselinePaths.length; index += 1) {
  const route = baselinePaths[index];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let bytes = Buffer.alloc(0);
  try {
    response = await fetch(base + route, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: bearer },
      redirect: 'error',
      signal: controller.signal
    });
    bytes = Buffer.from(await response.arrayBuffer());
    const entry = {
      requestIndex: index + 1,
      method: 'GET',
      path: route,
      status: response.status,
      contentType: response.headers.get('content-type'),
      ok: response.ok,
      rawBodyLength: bytes.length,
      responseSha256: sha256(bytes)
    };
    if (!response.ok) {
      audit.push(entry);
      failures.push({ path: route, category: 'HTTP', reasons: [`HTTP_${response.status}`] });
      continue;
    }
    try {
      const value = JSON.parse(bytes.toString('utf8'));
      audit.push(entry);
      actualValues[route] = value;
    } catch {
      audit.push({ ...entry, ok: false, error: 'INVALID_JSON' });
      failures.push({ path: route, category: 'JSON', reasons: ['INVALID_JSON'] });
    }
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_FAILED';
    audit.push({ requestIndex: index + 1, method: 'GET', path: route, status: null, contentType: null, ok: false, rawBodyLength: bytes.length, responseSha256: sha256(bytes), error: reason });
    failures.push({ path: route, category: 'FETCH', reasons: [reason] });
  } finally {
    clearTimeout(timer);
  }
}

const targetDetailsEvidence = [];
const targetListsEvidence = [];
for (const route of baselinePaths) {
  if (failures.some(failure => failure.path === route)) continue;
  const expected = baseline.values[route];
  const actual = actualValues[route];
  const detail = targetDetails.get(route);
  if (detail) {
    const reasons = compareExcept(expected, actual, new Set(['description', 'updatedAt']));
    if (actual.description !== detail.expectedDescription) reasons.push('description_not_approved');
    if (actual.createdAt !== expected.createdAt) reasons.push('createdAt_changed');
    if (!validIso(actual.updatedAt)) reasons.push('updatedAt_invalid');
    if (actual.updatedAt === expected.updatedAt || Date.parse(actual.updatedAt) <= Date.parse(expected.updatedAt)) reasons.push('updatedAt_not_advanced');
    targetDetailsEvidence.push({ path: route, stableKey: detail.stableKey, descriptionMatchesApproved: actual.description === detail.expectedDescription, createdAtUnchanged: actual.createdAt === expected.createdAt, updatedAtChanged: actual.updatedAt !== expected.updatedAt, updatedAtValid: validIso(actual.updatedAt), updatedAtAfterBaseline: validIso(actual.updatedAt) && Date.parse(actual.updatedAt) > Date.parse(expected.updatedAt) });
    if (reasons.length) failures.push({ path: route, category: 'TARGET_DETAIL', reasons });
    continue;
  }
  const list = targetLists.get(route);
  if (list) {
    const reasons = [];
    if (!Array.isArray(expected) || !Array.isArray(actual)) reasons.push('list_not_array');
    else {
      if (expected.length !== actual.length) reasons.push('list_length_changed');
      const expectedKeys = expected.map(row => row?.[list.stableField]);
      const actualKeys = actual.map(row => row?.[list.stableField]);
      if (!sameValue(expectedKeys, actualKeys)) reasons.push('stable_key_sequence_changed');
      for (let i = 0; i < Math.min(expected.length, actual.length); i += 1) {
        const target = list.targets.find(item => item.stableKey === actual[i]?.[list.stableField]);
        if (!target) {
          if (!sameValue(expected[i], actual[i])) reasons.push(`[${i}]other_row_changed`);
          continue;
        }
        const rowReasons = compareExcept(expected[i], actual[i], new Set(['description', 'updatedAt']));
        if (actual[i].description !== target.expectedDescription) rowReasons.push(`[${i}]description_not_approved`);
        if (actual[i].createdAt !== expected[i].createdAt) rowReasons.push(`[${i}]createdAt_changed`);
        if (!validIso(actual[i].updatedAt)) rowReasons.push(`[${i}]updatedAt_invalid`);
        const detailValue = actualValues[target.detailPath];
        if (!detailValue || actual[i].description !== detailValue.description) rowReasons.push(`[${i}]description_detail_mismatch`);
        if (!detailValue || actual[i].updatedAt !== detailValue.updatedAt) rowReasons.push(`[${i}]updatedAt_detail_mismatch`);
        reasons.push(...rowReasons);
      }
      for (const target of list.targets) {
        const indexes = actualKeys.map((key, i) => key === target.stableKey ? i : -1).filter(i => i >= 0);
        if (indexes.length !== 1) reasons.push(`${target.stableKey}_missing_or_duplicated`);
      }
    }
    targetListsEvidence.push({ path: route, targets: list.targets.map(target => ({ stableKey: target.stableKey, detailPath: target.detailPath, descriptionMatchesDetail: actualValues[route]?.find(row => row?.[list.stableField] === target.stableKey)?.description === actualValues[target.detailPath]?.description, updatedAtMatchesDetail: actualValues[route]?.find(row => row?.[list.stableField] === target.stableKey)?.updatedAt === actualValues[target.detailPath]?.updatedAt })) });
    if (reasons.length) failures.push({ path: route, category: 'TARGET_LIST', reasons });
    continue;
  }
  if (!sameValue(expected, actual)) failures.push({ path: route, category: 'UNCHANGED', reasons: ['structural_difference'] });
}

const statusCounts = {};
for (const entry of audit) {
  const key = entry.status === null || entry.status === undefined ? 'FETCH_FAILED' : String(entry.status);
  statusCounts[key] = (statusCounts[key] ?? 0) + 1;
}
const exactUnchangedCount = unchangedPaths.filter(route => !failures.some(failure => failure.path === route)).length;
const report = {
  schemaVersion: 'authoring.independent-readback.v1',
  generatedAt: new Date().toISOString(),
  status: failures.length === 0 && Object.keys(actualValues).length === baselinePaths.length ? 'PASS' : 'FAIL',
  endpoint: base,
  requestMethod: 'GET',
  methodsUsed: ['GET'],
  businessWrites: 0,
  scriptPath: '数据参考/全量录入-2026-09/交叉试录/五项后续技能消耗说明整理/07a-独立回读.mjs',
  scriptSha256: sha256File(path.join(batchDir, '07a-独立回读.mjs')),
  preflight: {
    reviewStatus: review.status,
    writeStatus: write.status,
    writeBusinessWritesAttempted: write.businessWritesAttempted,
    freezeSourceSha256Matches: freeze.sourceSha256 === inputHashes.sources,
    freezeBaselineSha256Matches: freeze.baselineSha256 === inputHashes.baseline,
    approvedShaChecks,
    sourceShaChecks,
    baselinePathCount: baselinePaths.length,
    baselineAuditCount: baseline.audit.length
  },
  counts: {
    requestedGETs: baselinePaths.length,
    completedGETs: audit.length,
    successfulJSONResponses: Object.keys(actualValues).length,
    statusCounts,
    targetDetailPaths: targetDetailPaths.size,
    targetListPaths: targetListPaths.size,
    changedDetailPass: targetDetailsEvidence.filter(item => item.descriptionMatchesApproved && item.createdAtUnchanged && item.updatedAtValid && item.updatedAtAfterBaseline).length,
    changedListPass: targetListsEvidence.filter(item => item.targets.every(target => target.descriptionMatchesDetail && target.updatedAtMatchesDetail)).length,
    unchangedPathsExpected: unchangedPaths.length,
    unchangedPathsPass: exactUnchangedCount,
    failureCount: failures.length
  },
  targetDetailEvidence: targetDetailsEvidence,
  targetListEvidence: targetListsEvidence,
  unchangedPathCount: unchangedPaths.length,
  failures,
  values: actualValues,
  audit
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, requestedGETs: report.counts.requestedGETs, completedGETs: report.counts.completedGETs, successfulJSONResponses: report.counts.successfulJSONResponses, changedDetailPass: report.counts.changedDetailPass, changedListPass: report.counts.changedListPass, unchangedPathsPass: report.counts.unchangedPathsPass, unchangedPathsExpected: report.counts.unchangedPathsExpected, businessWrites: report.businessWrites, scriptSha256: report.scriptSha256, failureCount: failures.length }));
if (report.status !== 'PASS') process.exitCode = 1;
