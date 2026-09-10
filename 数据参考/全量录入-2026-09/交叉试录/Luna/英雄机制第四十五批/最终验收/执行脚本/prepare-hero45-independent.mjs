import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(HERE, "..", "..");
const REVIEW = path.join(WORKSPACE, ".agents", "artifacts", "hero45-independent-review");
const MATH_DIR = path.join(WORKSPACE, ".agents", "artifacts", "hero45-independent-source-math");
const CANDIDATE_DIR = path.join(WORKSPACE, ".agents", "artifacts", "hero45-luna-candidate", "修订一");
const INPUT = path.join(WORKSPACE, ".agents", "artifacts", "hero45-root-entry-20260910");
const WRITE_RUN = path.join(CANDIDATE_DIR, "实际写入", "2026-09-10T02-17-18-870Z");
const CANDIDATE_FILE = path.join(CANDIDATE_DIR, "完整候选.json");
const PLAN_FILE = path.join(CANDIDATE_DIR, "写前请求计划.json");
const ACTUAL_WRITE_FILE = path.join(WRITE_RUN, "执行结果.json");
const PROTECTION_FILE = path.join(INPUT, "参考资料", "当前20槽保护快照.json");
const REUSE_FILE = path.join(INPUT, "参考资料", "公共参数复用清单.json");
const SNAPSHOT_FILE = path.join(REVIEW, "GET复核快照.json");
const REPORT_FILE = path.join(REVIEW, "GET复核报告.json");
const ROUTE_FILE = path.join(REVIEW, "GET复核请求清单.json");
const OVERLAY_FILE = path.join(REVIEW, "GET覆盖候选.json");
const MATH_SCRIPT = path.join(MATH_DIR, "独立数学核算.mjs");
const API_BASE = "http://127.0.0.1:8080/api/admin/games/lol";

const EXPECTED = {
  candidateSha256: "db51da6ae6ba0ab2e5008be49cf667642313e8d56e6499c42e4224bca0130ecb",
  planSha256: "e416d8b6bedadf3bfccaf51a3c68052e4361fe88f8be64661f1dc989dfdf1b05",
  newTotal: 120,
  reusedPublic: 22,
  protectedTotal: 194,
  detailTotal: 142,
  totalGets: 336,
};

const kinds = [
  ["parameters", "parameterKey", "parameters"],
  ["formulas", "formulaKey", "formulas"],
  ["effects", "effectKey", "effects"],
  ["processes", "processKey", "processes"],
  ["internalStates", "stateKey", "internal-states"],
  ["triggerRules", "ruleKey", "trigger-rules"],
];
const kindByName = new Map(kinds.map(item => [item[0], item]));

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => fs.writeFileSync(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
const sha256Bytes = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sha256File = file => sha256Bytes(fs.readFileSync(file));
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (left, right) => isDeepStrictEqual(left, right);
const stripGenerated = value => {
  if (Array.isArray(value)) return value.map(stripGenerated);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["gameId", "skillKey", "createdAt", "updatedAt"].includes(key))
    .map(([key, item]) => [key, stripGenerated(item)]));
};
const statusCounts = rows => rows.reduce((counts, row) => {
  const key = row.status === null ? "NETWORK_ERROR" : String(row.status);
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});
const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};

const candidate = readJson(CANDIDATE_FILE);
const plan = readJson(PLAN_FILE);
const actualWrite = readJson(ACTUAL_WRITE_FILE);
const protection = readJson(PROTECTION_FILE);
const reuseList = readJson(REUSE_FILE);
const candidateSha256 = sha256File(CANDIDATE_FILE);
const planSha256 = sha256File(PLAN_FILE);
const actualWriteSha256 = sha256File(ACTUAL_WRITE_FILE);
const protectionSha256 = sha256File(PROTECTION_FILE);

ensure(candidateSha256 === EXPECTED.candidateSha256, `候选散列不符：${candidateSha256}`);
ensure(planSha256 === EXPECTED.planSha256, `计划散列不符：${planSha256}`);
ensure(actualWrite.success === true, "实际保存结果不是成功状态");
ensure(actualWrite.apiWrites === EXPECTED.newTotal, `实际保存POST数量异常：${actualWrite.apiWrites}`);
ensure(actualWrite.counts?.POST === EXPECTED.newTotal, `实际保存POST计数异常：${actualWrite.counts?.POST}`);
ensure(actualWrite.final?.details?.matched === EXPECTED.detailTotal, "实际保存最终详情计数异常");
ensure(candidate.counts?.newTotal === EXPECTED.newTotal, "候选新建总数异常");
ensure(candidate.counts?.plannedTotalIncludingReused === EXPECTED.detailTotal, "候选含复用总数异常");
ensure(plan.requestCount === EXPECTED.newTotal && plan.requests.length === EXPECTED.newTotal, "计划请求数量异常");
ensure(protection.requests.length === EXPECTED.protectedTotal, "冻结保护请求数量异常");
ensure(reuseList.length === EXPECTED.reusedPublic, "公共复用数量异常");
const recheckOnly = process.argv.includes("--recheck");
ensure(recheckOnly || !fs.existsSync(SNAPSHOT_FILE), `已有GET快照，拒绝重复请求：${SNAPSHOT_FILE}`);
ensure(fs.existsSync(MATH_SCRIPT), `缺少独立数学脚本：${MATH_SCRIPT}`);

const plannedByKey = new Map();
for (const intent of plan.requests) {
  ensure(intent.method === "POST", `计划出现非POST：${intent.route}`);
  const kind = kindByName.get(intent.kind);
  ensure(kind, `计划类型未知：${intent.kind}`);
  const [, id, apiName] = kind;
  ensure(intent.route === `/skills/${intent.skillKey}/${apiName}`, `计划路由异常：${intent.route}`);
  ensure(intent.stableKey === intent.body?.[id], `计划稳定键不一致：${intent.route}/${intent.stableKey}`);
  const key = `${intent.route}/${intent.stableKey}`;
  ensure(!plannedByKey.has(key), `计划稳定键重复：${key}`);
  plannedByKey.set(key, intent);
}

const newEntries = [];
for (const skillKey of candidate.order) {
  const write = candidate.skills[skillKey]?.write;
  ensure(write, `缺少技能写入区：${skillKey}`);
  for (const [collectionName, idField, apiName] of kinds) {
    const items = write[collectionName];
    ensure(Array.isArray(items), `候选集合不是数组：${skillKey}/${collectionName}`);
    for (const body of items) {
      const stableKey = body[idField];
      const route = `/skills/${skillKey}/${apiName}`;
      ensure(typeof stableKey === "string" && stableKey.length > 0, `候选稳定键为空：${route}`);
      const intent = plannedByKey.get(`${route}/${stableKey}`);
      ensure(intent && equal(intent.body, body), `候选与计划不一致：${route}/${stableKey}`);
      newEntries.push({
        skillKey,
        kind: collectionName,
        idField,
        apiName,
        stableKey,
        route,
        detail: `${route}/${stableKey}`,
        body,
      });
    }
  }
}
ensure(newEntries.length === EXPECTED.newTotal, `候选新建项数量异常：${newEntries.length}`);
ensure(newEntries.every(item => plannedByKey.has(`${item.route}/${item.stableKey}`)), "存在未进入计划的新建项");

const baselineDetailByRoute = new Map();
for (const request of protection.requests) {
  if (/^\/skills\/[a-z]+_[pqwer]\/parameters\/[^/]+$/.test(request.route)) {
    ensure(!baselineDetailByRoute.has(request.route), `保护快照详情重复：${request.route}`);
    baselineDetailByRoute.set(request.route, request);
  }
}
const publicEntries = reuseList.map(item => {
  const detail = `/skills/${item.skillKey}/parameters/${item.parameterKey}`;
  const baseline = baselineDetailByRoute.get(detail);
  ensure(baseline?.status === 200, `公共复用不在保护快照：${detail}`);
  return {
    skillKey: item.skillKey,
    kind: "parameters",
    idField: "parameterKey",
    apiName: "parameters",
    stableKey: item.parameterKey,
    route: `/skills/${item.skillKey}/parameters`,
    detail,
    body: baseline.data,
    reused: true,
  };
});
ensure(publicEntries.length === EXPECTED.reusedPublic, "公共详情路由数量异常");

const detailEntries = [...newEntries, ...publicEntries];
const detailRouteSet = new Set(detailEntries.map(item => item.detail));
ensure(detailRouteSet.size === EXPECTED.detailTotal, "最终详情路由不唯一");
const collectionRoutes = new Map();
for (const skillKey of candidate.order) {
  for (const [collectionName, idField, apiName] of kinds) {
    collectionRoutes.set(`/skills/${skillKey}/${apiName}`, { skillKey, kind: collectionName, idField, apiName });
  }
}

const plannedForCollection = new Map();
for (const intent of plan.requests) {
  if (!plannedForCollection.has(intent.route)) plannedForCollection.set(intent.route, []);
  plannedForCollection.get(intent.route).push(intent);
}

const ensureOutputDirs = () => {
  fs.mkdirSync(REVIEW, { recursive: true });
  fs.mkdirSync(MATH_DIR, { recursive: true });
};

const getJson = async (route, index, phase) => {
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(`${API_BASE}${route}`, {
      method: "GET",
      headers: { Authorization: "Bearer local-entry", Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString("utf8");
    let data = null;
    let parseError = null;
    try {
      data = JSON.parse(text);
    } catch (error) {
      parseError = error.message;
    }
    return {
      index,
      phase,
      route,
      method: "GET",
      startedAt,
      finishedAt: new Date().toISOString(),
      status: response.status,
      ok: response.ok,
      bodyByteLength: bytes.length,
      bodySha256: sha256Bytes(bytes),
      parseError,
      data,
    };
  } catch (error) {
    return {
      index,
      phase,
      route,
      method: "GET",
      startedAt,
      finishedAt: new Date().toISOString(),
      status: null,
      ok: false,
      bodyByteLength: 0,
      bodySha256: null,
      parseError: error.message,
      data: null,
    };
  }
};

const compareProtection = (rows, plannedAfter) => {
  const failures = [];
  const mismatches = [];
  let collectionCount = 0;
  for (let index = 0; index < protection.requests.length; index += 1) {
    const expected = protection.requests[index];
    const actual = rows[index];
    if (!actual || actual.status !== expected.status) {
      failures.push({ route: expected.route, expectedStatus: expected.status, actualStatus: actual?.status ?? null, actualError: actual?.parseError ?? null });
      continue;
    }
    const collection = collectionRoutes.get(expected.route);
    if (!collection) {
      if (!equal(actual.data, expected.data)) mismatches.push({ route: expected.route, reason: "非集合保护响应变化", expectedSha256: sha256Bytes(Buffer.from(JSON.stringify(expected.data), "utf8")), actualSha256: sha256Bytes(Buffer.from(JSON.stringify(actual.data), "utf8")) });
      continue;
    }
    collectionCount += 1;
    if (!Array.isArray(expected.data) || !Array.isArray(actual.data)) {
      mismatches.push({ route: expected.route, reason: "集合响应不是数组" });
      continue;
    }
    const expectedOld = new Map(expected.data.map(item => [item[collection.idField], item]));
    const planned = plannedForCollection.get(expected.route) || [];
    const allowed = new Set([...expectedOld.keys(), ...(plannedAfter ? planned.map(item => item.stableKey) : [])]);
    if (actual.data.length !== allowed.size) mismatches.push({ route: expected.route, reason: "集合长度异常", expectedLength: allowed.size, actualLength: actual.data.length });
    for (const previous of expected.data) {
      const current = actual.data.find(item => item[collection.idField] === previous[collection.idField]);
      if (!current || !equal(current, previous)) mismatches.push({ route: expected.route, stableKey: previous[collection.idField], reason: "冻结旧项发生变化" });
    }
    for (const intent of planned) {
      const current = actual.data.find(item => item[collection.idField] === intent.stableKey);
      if (!current) mismatches.push({ route: expected.route, stableKey: intent.stableKey, reason: "保存后集合缺少新项" });
    }
    for (const current of actual.data) if (!allowed.has(current[collection.idField])) mismatches.push({ route: expected.route, stableKey: current[collection.idField], reason: "集合出现未授权项" });
  }
  return { checked: rows.length, collectionCount, failures, mismatches };
};

const compareDetails = rows => {
  const failures = [];
  const mismatches = [];
  const byRoute = new Map(rows.map(row => [row.route, row]));
  for (const entry of detailEntries) {
    const actual = byRoute.get(entry.detail);
    if (!actual || actual.status !== 200) {
      failures.push({ route: entry.detail, expectedStatus: 200, actualStatus: actual?.status ?? null, actualError: actual?.parseError ?? null });
      continue;
    }
    const expected = entry.reused ? entry.body : entry.body;
    if (!equal(stripGenerated(actual.data), stripGenerated(expected))) {
      mismatches.push({ route: entry.detail, stableKey: entry.stableKey, kind: entry.kind, reason: entry.reused ? "公共复用详情与冻结值不一致" : "最终详情与候选计划不一致", expected: stripGenerated(expected), actual: stripGenerated(actual.data) });
    }
  }
  return { checked: rows.length, failures, mismatches, byRoute };
};

const makeOverlay = detailsByRoute => {
  const overlay = clone(candidate);
  const replacements = [];
  for (const entry of newEntries) {
    const record = detailsByRoute.get(entry.detail);
    ensure(record?.status === 200 && record.data && typeof record.data === "object", `无法覆盖候选：${entry.detail}`);
    const list = overlay.skills[entry.skillKey].write[entry.kind];
    const index = list.findIndex(item => item[entry.idField] === entry.stableKey);
    ensure(index >= 0, `候选中找不到待覆盖项：${entry.detail}`);
    const value = stripGenerated(record.data);
    list[index] = value;
    replacements.push({ route: entry.detail, skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, apiBodySha256: sha256Bytes(Buffer.from(JSON.stringify(record.data), "utf8")), overlayBodySha256: sha256Bytes(Buffer.from(JSON.stringify(value), "utf8")) });
  }
  ensure(replacements.length === EXPECTED.newTotal, `候选覆盖数量异常：${replacements.length}`);
  return { overlay, replacements };
};

const main = async () => {
  ensureOutputDirs();
  const existingSnapshot = recheckOnly ? readJson(SNAPSHOT_FILE) : null;
  const protectedRows = existingSnapshot?.protectedBaseline || [];
  const detailRows = existingSnapshot?.finalDetails || [];
  if (!recheckOnly) {
    for (let index = 0; index < protection.requests.length; index += 1) {
      protectedRows.push(await getJson(protection.requests[index].route, index + 1, "protected-baseline"));
    }
    for (let index = 0; index < detailEntries.length; index += 1) {
      detailRows.push(await getJson(detailEntries[index].detail, index + 1, "final-detail"));
    }
  }
  ensure(protectedRows.length === EXPECTED.protectedTotal, `保护GET数量异常：${protectedRows.length}`);
  ensure(detailRows.length === EXPECTED.detailTotal, `详情GET数量异常：${detailRows.length}`);
  const protectionCheck = compareProtection(protectedRows, true);
  const detailCheck = compareDetails(detailRows);
  const detailByRoute = detailCheck.byRoute;
  const overlayResult = makeOverlay(detailByRoute);
  writeJson(OVERLAY_FILE, overlayResult.overlay);

  const snapshot = existingSnapshot || {
    generatedAt: new Date().toISOString(),
    batch: candidate.meta.batch,
    revision: candidate.meta.revision,
    apiBase: API_BASE,
    method: "GET",
    candidateSha256,
    planSha256,
    actualWriteSha256,
    protectionSha256,
    expectedCounts: { protectedBaseline: EXPECTED.protectedTotal, finalDetails: EXPECTED.detailTotal, totalGETs: EXPECTED.totalGets },
    protectedBaseline: protectedRows,
    finalDetails: detailRows,
    overlay: { file: path.relative(HERE, OVERLAY_FILE), sha256: sha256File(OVERLAY_FILE), replacementCount: overlayResult.replacements.length, replacements: overlayResult.replacements },
  };
  if (!existingSnapshot) writeJson(SNAPSHOT_FILE, snapshot);

  const routePlan = {
    generatedAt: snapshot.generatedAt,
    method: "GET",
    apiBase: API_BASE,
    protectedBaselineCount: protectedRows.length,
    finalDetailCount: detailRows.length,
    totalCount: protectedRows.length + detailRows.length,
    protectedBaselineRoutes: protection.requests.map(item => item.route),
    finalDetailRoutes: detailEntries.map(item => ({ route: item.detail, skillKey: item.skillKey, kind: item.kind, stableKey: item.stableKey, reused: Boolean(item.reused) })),
  };
  writeJson(ROUTE_FILE, routePlan);

  const report = {
    generatedAt: snapshot.generatedAt,
    reportType: "第45批独立GET复核",
    batch: candidate.meta.batch,
    revision: candidate.meta.revision,
    sourcePolicy: "固定客户端16.17、官方资料16.17.1；只读本地8080接口；不执行POST、PUT、DELETE、数据库、浏览器或Git。",
    frozenEvidence: {
      candidateFile: path.relative(HERE, CANDIDATE_FILE),
      candidateSha256,
      expectedCandidateSha256: EXPECTED.candidateSha256,
      planFile: path.relative(HERE, PLAN_FILE),
      planSha256,
      expectedPlanSha256: EXPECTED.planSha256,
      actualWriteFile: path.relative(HERE, ACTUAL_WRITE_FILE),
      actualWriteSha256,
      actualWriteCounts: actualWrite.counts,
      actualWriteSuccess: actualWrite.success,
      protectionSha256,
    },
    counts: {
      newItems: newEntries.length,
      newParameters: newEntries.filter(item => item.kind === "parameters").length,
      newFormulas: newEntries.filter(item => item.kind === "formulas").length,
      newEffects: newEntries.filter(item => item.kind === "effects").length,
      newProcesses: newEntries.filter(item => item.kind === "processes").length,
      newInternalStates: newEntries.filter(item => item.kind === "internalStates").length,
      newTriggerRules: newEntries.filter(item => item.kind === "triggerRules").length,
      reusedPublic: publicEntries.length,
      protectedBaselineGETs: protectedRows.length,
      finalDetailGETs: detailRows.length,
      totalGETs: protectedRows.length + detailRows.length,
    },
    protectedBaseline: {
      statusCounts: statusCounts(protectedRows),
      checked: protectionCheck.checked,
      collectionCount: protectionCheck.collectionCount,
      failureCount: protectionCheck.failures.length,
      mismatchCount: protectionCheck.mismatches.length,
      failures: protectionCheck.failures,
      mismatches: protectionCheck.mismatches,
    },
    finalDetails: {
      statusCounts: statusCounts(detailRows),
      checked: detailCheck.checked,
      failureCount: detailCheck.failures.length,
      mismatchCount: detailCheck.mismatches.length,
      failures: detailCheck.failures,
      mismatches: detailCheck.mismatches,
    },
    candidateReplacement: {
      sourceCandidateWasNotModified: true,
      overlayFile: path.relative(HERE, OVERLAY_FILE),
      overlaySha256: sha256File(OVERLAY_FILE),
      newItemsExpected: EXPECTED.newTotal,
      newItemsReplacedFromFinalGET: overlayResult.replacements.length,
      missingReplacementCount: EXPECTED.newTotal - overlayResult.replacements.length,
      publicDetailsUsedFromFinalGET: publicEntries.length,
    },
    restrictions: {
      getOnlyCalls: protectedRows.length + detailRows.length,
      postCalls: 0,
      putCalls: 0,
      deleteCalls: 0,
      extraMathGETs: 0,
      browserCalls: 0,
      databaseCalls: 0,
      gitWrites: 0,
    },
    snapshotFile: path.relative(HERE, SNAPSHOT_FILE),
    routePlanFile: path.relative(HERE, ROUTE_FILE),
    statusPass: candidateSha256 === EXPECTED.candidateSha256
      && planSha256 === EXPECTED.planSha256
      && protectedRows.length === EXPECTED.protectedTotal
      && detailRows.length === EXPECTED.detailTotal
      && protectedRows.length + detailRows.length === EXPECTED.totalGets
      && protectionCheck.failures.length === 0
      && protectionCheck.mismatches.length === 0
      && detailCheck.failures.length === 0
      && detailCheck.mismatches.length === 0
      && overlayResult.replacements.length === EXPECTED.newTotal,
  };
  writeJson(REPORT_FILE, report);

  const reportSha256 = sha256File(REPORT_FILE);
  const snapshotSha256 = sha256File(SNAPSHOT_FILE);
  const routePlanSha256 = sha256File(ROUTE_FILE);
  const overlaySha256 = sha256File(OVERLAY_FILE);
  writeJson(path.join(REVIEW, "文件散列.json"), {
    generatedAt: new Date().toISOString(),
    files: {
      "GET复核报告.json": { sha256: reportSha256, byteSize: fs.statSync(REPORT_FILE).size },
      "GET复核快照.json": { sha256: snapshotSha256, byteSize: fs.statSync(SNAPSHOT_FILE).size },
      "GET复核请求清单.json": { sha256: routePlanSha256, byteSize: fs.statSync(ROUTE_FILE).size },
      "GET覆盖候选.json": { sha256: overlaySha256, byteSize: fs.statSync(OVERLAY_FILE).size },
    },
    counts: report.counts,
  });

  const mathRun = spawnSync(process.execPath, [MATH_SCRIPT], { cwd: HERE, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  writeJson(path.join(REVIEW, "数学执行摘要.json"), {
    generatedAt: new Date().toISOString(),
    node: process.execPath,
    mathScript: path.relative(HERE, MATH_SCRIPT),
    status: mathRun.status,
    signal: mathRun.signal,
    stdout: mathRun.stdout,
    stderr: mathRun.stderr,
    extraMathGETs: 0,
  });
  const reviewManifestFile = path.join(REVIEW, "文件散列.json");
  const reviewManifest = readJson(reviewManifestFile);
  const mathReportFile = path.join(MATH_DIR, "独立数学报告.json");
  const mathScriptFile = path.join(MATH_DIR, "独立数学核算.mjs");
  reviewManifest.files["独立数学核算.mjs"] = { sha256: sha256File(mathScriptFile), byteSize: fs.statSync(mathScriptFile).size };
  reviewManifest.files["独立数学报告.json"] = { sha256: sha256File(mathReportFile), byteSize: fs.statSync(mathReportFile).size };
  reviewManifest.files["数学执行摘要.json"] = { sha256: sha256File(path.join(REVIEW, "数学执行摘要.json")), byteSize: fs.statSync(path.join(REVIEW, "数学执行摘要.json")).size };
  writeJson(reviewManifestFile, reviewManifest);
  if (mathRun.status !== 0) process.exitCode = 1;
  console.log(JSON.stringify({
    statusPass: report.statusPass && mathRun.status === 0,
    getReport: path.relative(HERE, REPORT_FILE),
    getSnapshot: path.relative(HERE, SNAPSHOT_FILE),
    mathReport: path.relative(HERE, path.join(MATH_DIR, "独立数学报告.json")),
    counts: report.counts,
    reportSha256,
    snapshotSha256,
    mathExitCode: mathRun.status,
  }, null, 2));
};

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
