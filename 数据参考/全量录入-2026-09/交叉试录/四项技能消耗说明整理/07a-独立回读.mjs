import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const batchDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(batchDir, '../../../../');
const reportPath = path.join(batchDir, '07-独立回读.json');
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const fetchTimeoutMs = 15_000;

if (fs.existsSync(reportPath)) {
  throw new Error('07-独立回读.json already exists; refusing to overwrite');
}

const sha256File = (filePath) =>
  crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const inputPaths = {
  plan: path.join(batchDir, '01-纠错计划.json'),
  freeze: path.join(batchDir, '02-冻结请求.json'),
  sources: path.join(batchDir, '03-来源摘要.json'),
  baseline: path.join(batchDir, '04-写入前现值.json'),
  review: path.join(batchDir, '05-独立评审.json'),
  write: path.join(batchDir, '06-写入与即时回读.json'),
  writer: path.join(repoRoot, 'tools', 'authoring', 'update-reviewed-descriptions.mjs'),
};

const inputSha256 = Object.fromEntries(
  Object.entries(inputPaths).map(([key, filePath]) => [key, sha256File(filePath)]),
);

const plan = readJson(inputPaths.plan);
const freeze = readJson(inputPaths.freeze);
const sources = readJson(inputPaths.sources);
const baseline = readJson(inputPaths.baseline);
const review = readJson(inputPaths.review);
const write = readJson(inputPaths.write);

const failPreflight = (message) => {
  throw new Error(`preflight failed: ${message}`);
};

if (freeze.base !== base) failPreflight(`unexpected base ${freeze.base}`);
if (!Array.isArray(sources) || sources.length === 0) failPreflight('source summary is empty');
if (freeze.sourceSha256 !== inputSha256.sources) failPreflight('source summary SHA mismatch');
if (freeze.baselineSha256 !== inputSha256.baseline) failPreflight('baseline SHA mismatch');
if (!baseline.values || typeof baseline.values !== 'object' || Array.isArray(baseline.values)) {
  failPreflight('baseline values is not an object');
}

const baselinePaths = Object.keys(baseline.values);
const baselineAuditPaths = Array.isArray(baseline.audit)
  ? baseline.audit.map((entry) => entry.path)
  : [];
if (baseline.audit.length !== baselinePaths.length) failPreflight('baseline audit/value count mismatch');
if (baseline.audit.some((entry) => entry.method !== 'GET' || entry.status !== 200)) {
  failPreflight('baseline audit contains a non-200 or non-GET entry');
}
if (
  baselineAuditPaths.length !== baselinePaths.length ||
  new Set(baselineAuditPaths).size !== baselinePaths.length ||
  baselineAuditPaths.some((entry, index) => entry !== baselinePaths[index])
) {
  failPreflight('baseline audit path order does not match values');
}

const expectedRequests = freeze.requests;
if (!Array.isArray(expectedRequests) || expectedRequests.length !== 8) {
  failPreflight('frozen request count is not 8');
}
if (expectedRequests.some((request) => request.method !== 'PUT')) {
  failPreflight('frozen request contains a non-PUT method');
}
if (expectedRequests.some((request) => !request.route.startsWith('/skills/'))) {
  failPreflight('frozen request leaves the skill API');
}

const approvedFiles = {
  ...(review.approvedFiles ?? {}),
  ...(write.approvedFiles ?? {}),
};
const approvedShaChecks = Object.entries(approvedFiles).map(([relativePath, expectedSha256]) => {
  const filePath = relativePath.startsWith('tools/')
    ? path.join(repoRoot, relativePath)
    : path.join(batchDir, relativePath);
  const actualSha256 = sha256File(filePath);
  return {
    path: relativePath,
    expectedSha256,
    actualSha256,
    matches: expectedSha256 === actualSha256,
  };
});
if (approvedShaChecks.some((entry) => !entry.matches)) failPreflight('approved file SHA mismatch');

if (
  review.status !== 'APPROVED' ||
  review.requestedModel !== 'gpt-5.6-luna' ||
  review.reasoningEffort !== 'max' ||
  review.networkRequestsDuringReview !== 0 ||
  review.fileWritesDuringReview !== 0
) {
  failPreflight('review approval fields are incomplete or changed');
}
if (
  write.status !== 'PASS' ||
  write.businessWritesAttempted !== 8 ||
  !Array.isArray(write.operations) ||
  write.operations.length !== 8 ||
  write.pendingRoute !== null
) {
  failPreflight('authoring write-flow fields are incomplete or changed');
}

const targetDetails = new Map();
const targetLists = new Map();
for (const request of expectedRequests) {
  const segments = request.route.split('/').filter(Boolean);
  if (segments.length !== 4 || segments[0] !== 'skills') {
    failPreflight(`unsupported frozen route ${request.route}`);
  }
  const collection = segments[2];
  const stableKey = segments[3];
  if (collection !== 'parameters' && collection !== 'effects') {
    failPreflight(`unsupported frozen collection ${collection}`);
  }
  const listPath = `/skills/${segments[1]}/${collection}`;
  if (targetDetails.has(request.route) || targetLists.has(listPath)) {
    failPreflight(`duplicate target route ${request.route}`);
  }
  targetDetails.set(request.route, {
    request,
    skillKey: segments[1],
    collection,
    stableKey,
    stableField: collection === 'parameters' ? 'parameterKey' : 'effectKey',
    listPath,
    expectedDescription: request.expectedReadback?.description,
  });
  targetLists.set(listPath, {
    detailPath: request.route,
    skillKey: segments[1],
    collection,
    stableKey,
    stableField: collection === 'parameters' ? 'parameterKey' : 'effectKey',
    expectedDescription: request.expectedReadback?.description,
  });
}

const targetDetailPaths = new Set(targetDetails.keys());
const targetListPaths = new Set(targetLists.keys());
const unchangedPaths = baselinePaths.filter(
  (entry) => !targetDetailPaths.has(entry) && !targetListPaths.has(entry),
);

const readStartedAt = new Date().toISOString();
const bearer = `Bearer ${crypto.randomUUID()}`;
const results = new Array(baselinePaths.length);
let nextIndex = 0;

const readOne = async (index) => {
  const relativePath = baselinePaths[index];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetch(`${base}${relativePath}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: bearer,
      },
      redirect: 'error',
      signal: controller.signal,
    });
    const status = response.status;
    const contentType = response.headers.get('content-type');
    if (status !== 200) {
      results[index] = {
        path: relativePath,
        status,
        contentType,
        ok: false,
        error: `HTTP_${status}`,
      };
      return;
    }
    const body = await response.text();
    try {
      results[index] = {
        path: relativePath,
        status,
        contentType,
        ok: true,
        value: JSON.parse(body),
      };
    } catch {
      results[index] = {
        path: relativePath,
        status,
        contentType,
        ok: false,
        error: 'INVALID_JSON',
      };
    }
  } catch (error) {
    results[index] = {
      path: relativePath,
      status: null,
      contentType: null,
      ok: false,
      error: error?.name === 'AbortError' ? 'TIMEOUT' : 'FETCH_FAILED',
    };
  } finally {
    clearTimeout(timer);
  }
};

const workerCount = Math.min(4, baselinePaths.length);
await Promise.all(
  Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= baselinePaths.length) return;
      await readOne(index);
    }
  }),
);

const readFinishedAt = new Date().toISOString();
const actualValues = {};
for (const result of results) {
  if (result.ok) actualValues[result.path] = result.value;
}

const sameValue = (left, right) => {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => sameValue(value, right[index]));
  }
  if (typeof left !== 'object') return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
    return false;
  }
  return leftKeys.every((key) => sameValue(left[key], right[key]));
};

const collectDifferences = (expected, actual, currentPath, differences, limit = 30) => {
  if (differences.length >= limit) return;
  if (sameValue(expected, actual)) return;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      differences.push(currentPath);
      return;
    }
    if (expected.length !== actual.length) differences.push(`${currentPath}.length`);
    const length = Math.min(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      collectDifferences(expected[index], actual[index], `${currentPath}[${index}]`, differences, limit);
      if (differences.length >= limit) return;
    }
    return;
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      if (!(key in expected) || !(key in actual)) {
        differences.push(`${currentPath}.${key}`);
      } else {
        collectDifferences(expected[key], actual[key], `${currentPath}.${key}`, differences, limit);
      }
      if (differences.length >= limit) return;
    }
    return;
  }
  differences.push(currentPath);
};

const compareObjectExcept = (expected, actual, ignoredKeys) => {
  const differences = [];
  if (!expected || !actual || Array.isArray(expected) || Array.isArray(actual)) {
    differences.push('$');
    return differences;
  }
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (expectedKeys.length !== actualKeys.length || expectedKeys.some((key, index) => key !== actualKeys[index])) {
    differences.push('$keys');
  }
  for (const key of expectedKeys) {
    if (ignoredKeys.has(key)) continue;
    if (!(key in actual)) {
      differences.push(`$.${key}`);
      continue;
    }
    collectDifferences(expected[key], actual[key], `$.${key}`, differences);
  }
  return differences;
};

const pathResult = new Map(results.map((result) => [result.path, result]));
const differences = [];
const targetChangeEvidence = [];
const listDetailParity = [];
const passedExactPaths = [];
const passedAllowedDetailPaths = [];
const passedAllowedListPaths = [];

for (const relativePath of baselinePaths) {
  const baselineValue = baseline.values[relativePath];
  const result = pathResult.get(relativePath);
  if (!result?.ok) {
    differences.push({ path: relativePath, category: 'HTTP_OR_JSON', reasons: [result?.error ?? 'NOT_READ'] });
    continue;
  }
  const actualValue = result.value;
  const detailTarget = targetDetails.get(relativePath);
  if (detailTarget) {
    const reasons = compareObjectExcept(baselineValue, actualValue, new Set(['description', 'updatedAt']));
    const expectedDescription = detailTarget.expectedDescription;
    if (actualValue.description !== expectedDescription) reasons.push('$.description_expected_readback');
    if (actualValue.createdAt !== baselineValue.createdAt) reasons.push('$.createdAt_changed');
    targetChangeEvidence.push({
      path: relativePath,
      kind: 'detail',
      stableKey: detailTarget.stableKey,
      descriptionChanged: baselineValue.description !== actualValue.description,
      updatedAtChanged: baselineValue.updatedAt !== actualValue.updatedAt,
      createdAtUnchanged: baselineValue.createdAt === actualValue.createdAt,
      expectedDescriptionMatched: actualValue.description === expectedDescription,
    });
    if (reasons.length > 0) differences.push({ path: relativePath, category: 'TARGET_DETAIL', reasons });
    else passedAllowedDetailPaths.push(relativePath);
    continue;
  }
  const listTarget = targetLists.get(relativePath);
  if (listTarget) {
    const reasons = [];
    if (!Array.isArray(baselineValue) || !Array.isArray(actualValue)) {
      reasons.push('list_not_array');
    } else {
      if (baselineValue.length !== actualValue.length) reasons.push('list_length_changed');
      const baselineKeys = baselineValue.map((row) => row?.[listTarget.stableField]);
      const actualKeys = actualValue.map((row) => row?.[listTarget.stableField]);
      if (!sameValue(baselineKeys, actualKeys)) reasons.push('stable_key_sequence_changed');
      const targetIndexes = actualKeys
        .map((key, index) => (key === listTarget.stableKey ? index : -1))
        .filter((index) => index >= 0);
      if (targetIndexes.length !== 1) reasons.push('target_stable_key_missing_or_duplicated');
      const length = Math.min(baselineValue.length, actualValue.length);
      for (let index = 0; index < length; index += 1) {
        const baselineRow = baselineValue[index];
        const actualRow = actualValue[index];
        if (actualKeys[index] === listTarget.stableKey) {
          reasons.push(
            ...compareObjectExcept(baselineRow, actualRow, new Set(['description', 'updatedAt'])).map(
              (reason) => `[${index}]${reason}`,
            ),
          );
          if (actualRow?.description !== listTarget.expectedDescription) {
            reasons.push(`[${index}].description_expected_readback`);
          }
          if (actualRow?.createdAt !== baselineRow?.createdAt) reasons.push(`[${index}].createdAt_changed`);
          targetChangeEvidence.push({
            path: relativePath,
            kind: 'list_row',
            stableKey: listTarget.stableKey,
            descriptionChanged: baselineRow?.description !== actualRow?.description,
            updatedAtChanged: baselineRow?.updatedAt !== actualRow?.updatedAt,
            createdAtUnchanged: baselineRow?.createdAt === actualRow?.createdAt,
            expectedDescriptionMatched: actualRow?.description === listTarget.expectedDescription,
          });
        } else if (!sameValue(baselineRow, actualRow)) {
          reasons.push(`[${index}]other_row_changed`);
        }
      }
      const detailResult = pathResult.get(listTarget.detailPath);
      const targetRow = targetIndexes.length === 1 ? actualValue[targetIndexes[0]] : null;
      const detailValue = detailResult?.ok ? detailResult.value : null;
      const parity = {
        listPath: relativePath,
        detailPath: listTarget.detailPath,
        descriptionMatchesDetail: targetRow?.description === detailValue?.description,
        updatedAtMatchesDetail: targetRow?.updatedAt === detailValue?.updatedAt,
      };
      listDetailParity.push(parity);
      if (!parity.descriptionMatchesDetail) reasons.push('target_description_detail_list_mismatch');
      if (!parity.updatedAtMatchesDetail) reasons.push('target_updatedAt_detail_list_mismatch');
    }
    if (reasons.length > 0) differences.push({ path: relativePath, category: 'TARGET_LIST', reasons });
    else passedAllowedListPaths.push(relativePath);
    continue;
  }
  const pathDifferences = [];
  collectDifferences(baselineValue, actualValue, '$', pathDifferences);
  if (pathDifferences.length > 0) {
    differences.push({ path: relativePath, category: 'UNCHANGED', reasons: pathDifferences });
  } else {
    passedExactPaths.push(relativePath);
  }
}

const successfulJsonCount = results.filter((result) => result?.ok).length;
const httpStatusCounts = {};
for (const result of results) {
  const key = result?.status === null || result?.status === undefined ? 'FETCH_FAILED' : String(result.status);
  httpStatusCounts[key] = (httpStatusCounts[key] ?? 0) + 1;
}

const detailPathsWithResults = baselinePaths.filter((entry) => /\/effects\/[^/]+$/.test(entry));
const numericDetailPaths = baselinePaths.filter((entry) => /\/(parameters|effects)\/[^/]+$/.test(entry));
const effectResultsUnchanged = detailPathsWithResults.every((relativePath) => {
  const result = pathResult.get(relativePath);
  return result?.ok && sameValue(baseline.values[relativePath]?.results, result.value?.results);
});
const numericFieldsUnchanged = numericDetailPaths.every((relativePath) => {
  const result = pathResult.get(relativePath);
  if (!result?.ok) return false;
  const reasons = compareObjectExcept(
    baseline.values[relativePath],
    result.value,
    new Set(['description', 'updatedAt']),
  );
  return reasons.length === 0;
});
const existingSelfCastRulePaths = baselinePaths.filter(
  (entry) => /\/trigger-rules\/[^/]+$/.test(entry) && /\/on_used_self_/.test(entry),
);
const existingSelfCastRulesUnchanged = existingSelfCastRulePaths.every(
  (relativePath) => pathResult.get(relativePath)?.ok && sameValue(baseline.values[relativePath], pathResult.get(relativePath).value),
);
const newUseCostAndCooldownPaths = baselinePaths.filter(
  (entry) =>
    /\/processes\/use_cost_and_cooldown$/.test(entry) ||
    /\/trigger-rules\/on_used_cost_and_cooldown$/.test(entry),
);
const newUseCostAndCooldownUnchanged = newUseCostAndCooldownPaths.every(
  (relativePath) => pathResult.get(relativePath)?.ok && sameValue(baseline.values[relativePath], pathResult.get(relativePath).value),
);

const redactForReport = (value) => {
  if (Array.isArray(value)) return value.map((entry) => redactForReport(entry));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/(token|password|secret|cookie|authorization|bearer)/i.test(key)) continue;
    result[key] = redactForReport(entry);
  }
  return result;
};

const report = {
  generatedAt: new Date().toISOString(),
  status: differences.length === 0 && successfulJsonCount === baselinePaths.length ? 'PASS' : 'FAIL',
  endpoint: base,
  requestMethod: 'GET',
  requestAuth: 'temporary_non_empty_bearer',
  requestConfig: {
    requestedModel: review.requestedModel,
    reasoningEffort: review.reasoningEffort,
  },
  preflight: {
    planTitle: plan.title,
    baselinePathCount: baselinePaths.length,
    baselineAuditCount: baseline.audit.length,
    freezeSourceShaMatches: freeze.sourceSha256 === inputSha256.sources,
    freezeBaselineShaMatches: freeze.baselineSha256 === inputSha256.baseline,
    reviewStatus: review.status,
    reviewNetworkRequests: review.networkRequestsDuringReview,
    reviewFileWrites: review.fileWritesDuringReview,
    writeStatus: write.status,
    businessWritesAttempted: write.businessWritesAttempted,
    writeOperationCount: write.operations.length,
    pendingRoute: write.pendingRoute,
    approvedShaChecks,
  },
  read: {
    startedAt: readStartedAt,
    finishedAt: readFinishedAt,
    attemptedGetCount: baselinePaths.length,
    successfulJsonCount,
    httpStatusCounts,
    audit: results.map(({ path: relativePath, status, contentType, ok, error }) => ({
      method: 'GET',
      path: relativePath,
      status,
      contentType,
      ok,
      ...(error ? { error } : {}),
    })),
  },
  comparison: {
    baselinePathCount: baselinePaths.length,
    actualReadPathCount: successfulJsonCount,
    targetDetailPathCount: targetDetailPaths.size,
    targetListPathCount: targetListPaths.size,
    unchangedPathCount: unchangedPaths.length,
    passedExactPathCount: passedExactPaths.length,
    passedAllowedDetailPathCount: passedAllowedDetailPaths.length,
    passedAllowedListPathCount: passedAllowedListPaths.length,
    differenceCount: differences.length,
    differences,
    targetChangeEvidence,
    listDetailParity,
  },
  invariants: {
    effectResultsUnchanged,
    effectResultPathCount: detailPathsWithResults.length,
    numericFieldsUnchanged,
    numericDetailPathCount: numericDetailPaths.length,
    existingSelfCastRulesUnchanged,
    existingSelfCastRulePathCount: existingSelfCastRulePaths.length,
    newUseCostAndCooldownProcessAndRulesUnchanged: newUseCostAndCooldownUnchanged,
    newUseCostAndCooldownPathCount: newUseCostAndCooldownPaths.length,
  },
  inputSha256,
  values: redactForReport(actualValues),
};

const reportJson = `${JSON.stringify(report, null, 2)}\n`;
const reportFd = fs.openSync(reportPath, 'wx');
try {
  fs.writeFileSync(reportFd, reportJson, 'utf8');
} finally {
  fs.closeSync(reportFd);
}

console.log(
  JSON.stringify({
    status: report.status,
    attemptedGetCount: baselinePaths.length,
    successfulJsonCount,
    differenceCount: differences.length,
    reportPath,
    reportSha256: sha256File(reportPath),
  }),
);
