import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const inputDir = path.resolve(here, "../hero27-root-entry-20260909");
const apiRoot = "http://127.0.0.1:8080/api/admin/games/lol";
const expectedHashes = Object.freeze({
  candidate: "046f2671121092a906008b6b07909156a90d4bc241e18ce646fc12480f3303cf",
  plan: "562b5c4060671668e4fc9fd116e35cf6c8cedac8c1b96f3ffed9bc2535f57ae9",
  inputVersion: "271c68c8006fb01e407183ad567cd17540db5149fed328130f1e03f4bdc51db6",
  sourceBinding: "37a25d9cf21276968b5c72c9655e93eb7f6b7ceaabbaf451242dccf5fa14180c",
  sourceNote: "78521414b09efd52c639c6dbbc36685d15daf068c68edc57559ecdf7c6c77cfb",
  protection: "29e16b615a90916cb93d40ae463c4deb5fd8138e82eda78bf7442be1bd3012c4",
});

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== "--after-apply") {
  console.error("用法：node 独立回读-实际GET.mjs --after-apply");
  process.exit(2);
}

const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const candidatePath = path.join(here, "完整候选.json");
const planPath = path.join(here, "请求计划.json");
const inputVersionPath = path.join(inputDir, "输入版本.json");
const sourceBindingPath = path.join(inputDir, "来源绑定与当前文本.json");
const sourceNotePath = path.join(inputDir, "主负责人源值核对说明.md");
const protectionPath = path.join(inputDir, "参考资料", "当前10槽保护快照.json");

const frozenFiles = [
  ["candidate", candidatePath, expectedHashes.candidate],
  ["plan", planPath, expectedHashes.plan],
  ["inputVersion", inputVersionPath, expectedHashes.inputVersion],
  ["sourceBinding", sourceBindingPath, expectedHashes.sourceBinding],
  ["sourceNote", sourceNotePath, expectedHashes.sourceNote],
  ["protection", protectionPath, expectedHashes.protection],
];
for (const [label, file, expected] of frozenFiles) {
  const actual = sha256(file);
  if (actual !== expected) throw new Error("冻结文件散列变化：" + label + "，实际 " + actual + "，应为 " + expected);
}

const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const inputVersion = readJson(inputVersionPath);
const sourceBinding = readJson(sourceBindingPath);
const baseline = readJson(protectionPath);

if (candidate.meta?.apiWrites !== 0 || plan.apiWrites !== 0 || inputVersion.apiWrites !== 0) {
  throw new Error("冻结输入已经包含业务写入");
}
if (candidate.meta?.sourceInputSha256 !== expectedHashes.inputVersion) {
  throw new Error("候选来源输入散列不一致");
}
if (!Array.isArray(inputVersion.sourceFiles)) throw new Error("输入版本缺少来源文件散列");
for (const source of inputVersion.sourceFiles) {
  const file = path.join(inputDir, source.path);
  const actual = sha256(file);
  if (actual !== source.sha256) throw new Error("来源文件散列变化：" + source.path);
}

const skillKeys = [
  "gragas_p", "gragas_q", "gragas_w", "gragas_e", "gragas_r",
  "hecarim_p", "hecarim_q", "hecarim_w", "hecarim_e", "hecarim_r",
];
const kinds = [
  { kind: "parameters", api: "parameters", id: "parameterKey" },
  { kind: "formulas", api: "formulas", id: "formulaKey" },
  { kind: "effects", api: "effects", id: "effectKey" },
  { kind: "processes", api: "processes", id: "processKey" },
  { kind: "internalStates", api: "internal-states", id: "stateKey" },
  { kind: "triggerRules", api: "trigger-rules", id: "ruleKey" },
];
const kindByApi = new Map(kinds.map(item => [item.api, item]));
const collectionRoutes = new Map();
for (const skillKey of skillKeys) {
  for (const item of kinds) {
    collectionRoutes.set("/skills/" + skillKey + "/" + item.api, { skillKey, ...item });
  }
}

const candidateEntries = [];
for (const skillKey of skillKeys) {
  const record = candidate.skills?.[skillKey];
  if (!record || record.skillKey !== skillKey) throw new Error("候选技能缺失：" + skillKey);
  for (const item of kinds) {
    const values = record.write?.[item.kind];
    if (!Array.isArray(values)) throw new Error("候选组成列表缺失：" + skillKey + "/" + item.kind);
    const ids = values.map(value => value[item.id]);
    if (ids.some(value => typeof value !== "string") || new Set(ids).size !== ids.length) {
      throw new Error("候选组成键缺失或重复：" + skillKey + "/" + item.kind);
    }
    for (const body of values) {
      const stableKey = body[item.id];
      candidateEntries.push({
        skillKey,
        kind: item.kind,
        api: item.api,
        id: item.id,
        stableKey,
        route: "/skills/" + skillKey + "/" + item.api,
        detailRoute: "/skills/" + skillKey + "/" + item.api + "/" + encodeURIComponent(stableKey),
        body,
      });
    }
  }
}
if (candidateEntries.length !== 113) throw new Error("候选详情数应为113，实际 " + candidateEntries.length);
const countByKind = Object.fromEntries(kinds.map(item => [
  item.kind,
  candidateEntries.filter(entry => entry.kind === item.kind).length,
]));
if (countByKind.parameters !== 85 || countByKind.formulas !== 18 || countByKind.effects !== 10 ||
    countByKind.processes !== 0 || countByKind.internalStates !== 0 || countByKind.triggerRules !== 0) {
  throw new Error("候选组成计数不符：" + JSON.stringify(countByKind));
}
if (!Array.isArray(plan.intents) || plan.count !== 98 || plan.intents.length !== 98) {
  throw new Error("请求计划应有98项");
}
const candidateByKey = new Map(candidateEntries.map(entry => [
  entry.skillKey + "|" + entry.kind + "|" + entry.stableKey,
  entry,
]));
const planByKey = new Map();
for (const intent of plan.intents) {
  const item = kinds.find(value => value.kind === intent.kind);
  if (!item || intent.method !== "POST" || intent.route !== "/skills/" + intent.skillKey + "/" + item.api) {
    throw new Error("请求计划超出冻结组成范围：" + JSON.stringify(intent));
  }
  if (intent.stableKey !== intent.body?.[item.id]) throw new Error("计划稳定键与载荷不一致");
  const key = intent.skillKey + "|" + intent.kind + "|" + intent.stableKey;
  if (planByKey.has(key)) throw new Error("请求计划重复：" + key);
  if (!candidateByKey.has(key)) throw new Error("请求计划不在候选中：" + key);
  if (JSON.stringify(candidateByKey.get(key).body) !== JSON.stringify(intent.body)) {
    throw new Error("计划载荷与候选不一致：" + key);
  }
  planByKey.set(key, intent);
}

const oldDetailRoutes = new Set();
for (const entry of candidateEntries) {
  const route = "/skills/" + entry.skillKey + "/" + entry.api + "/" + encodeURIComponent(entry.stableKey);
  if (!planByKey.has(entry.skillKey + "|" + entry.kind + "|" + entry.stableKey)) oldDetailRoutes.add(route);
}
if (oldDetailRoutes.size !== 15) throw new Error("复用详情数应为15，实际 " + oldDetailRoutes.size);
if (!Array.isArray(baseline.requests) || baseline.requests.length !== 103) {
  throw new Error("保护快照应有103条请求");
}
const baselineByRoute = new Map();
for (const request of baseline.requests) {
  if (baselineByRoute.has(request.route)) throw new Error("保护快照路由重复：" + request.route);
  baselineByRoute.set(request.route, request);
}

const catalogs = ["/attributes", "/skill-categories", "/modifier-zones", "/damage-types"];
const characters = ["/characters/champion_gragas", "/characters/champion_hecarim"];
const relations = [
  "/character-skill-relations?characterKey=champion_gragas",
  "/character-skill-relations?characterKey=champion_hecarim",
];
const subjects = skillKeys.map(skillKey => "/skills/" + skillKey);
const images = skillKeys.map(skillKey => "/skills/" + skillKey + "/representative-image");
const componentLists = skillKeys.flatMap(skillKey =>
  kinds.map(item => "/skills/" + skillKey + "/" + item.api));
if (catalogs.length !== 4 || characters.length !== 2 || relations.length !== 2 ||
    subjects.length !== 10 || images.length !== 10 || componentLists.length !== 60) {
  throw new Error("固定保护分组计数错误");
}
const allDetailRoutes = candidateEntries.map(entry => entry.detailRoute);
if (new Set(allDetailRoutes).size !== 113) throw new Error("候选详情路由重复");
const protectedNonDetailRoutes = baseline.requests
  .map(request => request.route)
  .filter(route => !oldDetailRoutes.has(route));
if (protectedNonDetailRoutes.length !== 88) {
  throw new Error("去除15条重叠详情后保护路由应为88，实际 " + protectedNonDetailRoutes.length);
}
const freshRoutes = [...protectedNonDetailRoutes, ...allDetailRoutes];
if (new Set(freshRoutes).size !== 201) throw new Error("去重后的GET路由应为201");

const stamp = new Date().toISOString().replaceAll(":", "-");
const runDir = path.join(here, "独立回读", stamp);
fs.mkdirSync(runDir, { recursive: true });
const journalPath = path.join(runDir, "所有GET原始响应.jsonl");
const calls = [];
const failures = [];
let sequence = 0;
const token = process.env.HERO27_API_TOKEN || "local-entry";

function appendJournal(value) {
  const descriptor = fs.openSync(journalPath, "a");
  try {
    fs.writeSync(descriptor, JSON.stringify(value) + "\n", undefined, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function checkRoute(route) {
  if (typeof route !== "string" || !route.startsWith("/") ||
      route.includes("://") || route.includes("..") || route.includes("#")) {
    throw new Error("不安全接口路径：" + route);
  }
}

async function get(route) {
  checkRoute(route);
  const seq = ++sequence;
  const startedAt = new Date().toISOString();
  appendJournal({ phase: "BEFORE", seq, method: "GET", route, at: startedAt });
  let result;
  try {
    const response = await fetch(apiRoot + route, {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });
    const bodyText = await response.text();
    let data = null;
    let parseError = null;
    if (bodyText.length > 0) {
      try {
        data = JSON.parse(bodyText);
      } catch (error) {
        parseError = String(error.message || error);
      }
    }
    result = {
      seq,
      method: "GET",
      route,
      status: response.status,
      data,
      ...(parseError ? { parseError, bodyText } : {}),
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    result = {
      seq,
      method: "GET",
      route,
      status: null,
      data: null,
      error: String(error.message || error),
      finishedAt: new Date().toISOString(),
    };
  }
  appendJournal({ phase: "AFTER", ...result });
  calls.push(result);
  return result;
}

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value)
      .filter(key => !["gameId", "skillKey", "createdAt", "updatedAt"].includes(key))
      .sort()
      .map(key => [key, clean(value[key])]));
  }
  return value;
}

function firstDiff(expected, actual, at = "$") {
  if (Object.is(expected, actual)) return null;
  if (expected === null || actual === null ||
      typeof expected !== "object" || typeof actual !== "object") {
    return { at, expected, actual };
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      return { at, expected, actual };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const found = firstDiff(expected[index], actual[index], at + "[" + index + "]");
      if (found) return found;
    }
    return null;
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const key of keys) {
    if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) {
      return {
        at: at + "." + key,
        expectedPresent: Object.hasOwn(expected, key),
        actualPresent: Object.hasOwn(actual, key),
      };
    }
    const found = firstDiff(expected[key], actual[key], at + "." + key);
    if (found) return found;
  }
  return null;
}

function rows(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return null;
}

function listProjectedDiff(expectedBody, actualRow, idField) {
  if (!actualRow || actualRow[idField] !== expectedBody[idField]) {
    return { at: "." + idField, expected: expectedBody[idField], actual: actualRow?.[idField] };
  }
  for (const field of Object.keys(expectedBody)) {
    if (!Object.hasOwn(actualRow, field)) continue;
    const found = firstDiff(clean(expectedBody[field]), clean(actualRow[field]), "." + field);
    if (found) return found;
  }
  return null;
}

const resultByRoute = new Map();
for (const route of freshRoutes) {
  const response = await get(route);
  resultByRoute.set(route, response);
}

const protectionRecords = [];
const protectionFailures = [];
const detailRecords = [];
const detailFailures = [];

function addProtectionFailure(record) {
  protectionFailures.push(record);
}

for (const expectedRequest of baseline.requests) {
  const actual = resultByRoute.get(expectedRequest.route);
  const record = {
    route: expectedRequest.route,
    expectedStatus: expectedRequest.status,
    actualStatus: actual?.status ?? null,
    category: "主体或目录",
    passed: false,
  };
  if (!actual) {
    record.reason = "未取得实际响应";
    addProtectionFailure(record);
    protectionRecords.push(record);
    continue;
  }
  if (actual.status !== expectedRequest.status) {
    record.reason = "状态码变化";
    record.diff = { expected: expectedRequest.status, actual: actual.status };
    addProtectionFailure(record);
    protectionRecords.push(record);
    continue;
  }
  const collection = collectionRoutes.get(expectedRequest.route);
  if (!collection) {
    const difference = firstDiff(clean(expectedRequest.data), clean(actual.data));
    record.diff = difference;
    record.passed = !difference;
    if (difference) addProtectionFailure(record);
    protectionRecords.push(record);
    continue;
  }
  record.category = "六类组成列表";
  const oldRows = rows(expectedRequest.data);
  const actualRows = rows(actual.data);
  if (!oldRows || !actualRows) {
    record.reason = "列表响应不是数组或items/data列表";
    addProtectionFailure(record);
    protectionRecords.push(record);
    continue;
  }
  const ids = actualRows.map(row => row?.[collection.id]);
  if (ids.some(value => typeof value !== "string") || new Set(ids).size !== ids.length) {
    record.reason = "实际列表存在缺失或重复稳定键";
    record.actualKeys = ids;
    addProtectionFailure(record);
    protectionRecords.push(record);
    continue;
  }
  const oldKeys = oldRows.map(row => row?.[collection.id]);
  const planned = plan.intents.filter(intent => intent.route === expectedRequest.route);
  const allowed = new Set(oldKeys);
  if (oldKeys.some(value => typeof value !== "string") || new Set(oldKeys).size !== oldKeys.length) {
    record.reason = "冻结列表存在缺失或重复稳定键";
    addProtectionFailure(record);
    protectionRecords.push(record);
    continue;
  }
  for (const intent of planned) allowed.add(intent.stableKey);
  const unexpected = ids.filter(value => !allowed.has(value));
  const missingOld = oldKeys.filter(value => !ids.includes(value));
  const duplicatePlanned = planned.filter(intent => oldKeys.includes(intent.stableKey));
  const oldDifferences = [];
  for (const oldRow of oldRows) {
    const current = actualRows.find(row => row?.[collection.id] === oldRow[collection.id]);
    const difference = firstDiff(clean(oldRow), clean(current));
    if (difference) oldDifferences.push({ stableKey: oldRow[collection.id], difference });
  }
  const plannedDifferences = [];
  for (const intent of planned) {
    const current = actualRows.find(row => row?.[collection.id] === intent.stableKey);
    if (!current) continue;
    const difference = listProjectedDiff(intent.body, current, collection.id);
    if (difference) plannedDifferences.push({ stableKey: intent.stableKey, difference });
  }
  record.oldCount = oldRows.length;
  record.actualCount = actualRows.length;
  record.plannedCount = planned.length;
  record.unexpected = unexpected;
  record.missingOld = missingOld;
  record.duplicatePlanned = duplicatePlanned.map(intent => intent.stableKey);
  record.oldDifferences = oldDifferences;
  record.plannedDifferences = plannedDifferences;
  record.passed = actualRows.length === allowed.size &&
    unexpected.length === 0 && missingOld.length === 0 &&
    duplicatePlanned.length === 0 && oldDifferences.length === 0 &&
    plannedDifferences.length === 0;
  if (!record.passed) addProtectionFailure(record);
  protectionRecords.push(record);
}

for (const entry of candidateEntries) {
  const actual = resultByRoute.get(entry.detailRoute);
  const key = entry.skillKey + "|" + entry.kind + "|" + entry.stableKey;
  const intent = planByKey.get(key);
  const expectedBody = intent?.body ?? entry.body;
  const record = {
    skillKey: entry.skillKey,
    kind: entry.kind,
    stableKey: entry.stableKey,
    route: entry.detailRoute,
    expected: intent ? "本次新增计划" : "复用既有组成",
    status: actual?.status ?? null,
    passed: false,
  };
  if (!actual || actual.status !== 200) {
    record.reason = "目标详情未返回200";
    detailFailures.push(record);
  } else {
    const difference = firstDiff(clean(expectedBody), clean(actual.data));
    record.diff = difference;
    record.passed = !difference;
    if (difference) detailFailures.push(record);
  }
  detailRecords.push(record);
}

const routeRecord = route => {
  const value = resultByRoute.get(route);
  return value ? { route, status: value.status, data: value.data, ...(value.error ? { error: value.error } : {}) } :
    { route, status: null, data: null, error: "未取得实际响应" };
};
const categoryRecords = routes => routes.map(routeRecord);
const componentDetailData = detailRecords.map((record, index) => {
  const entry = candidateEntries[index];
  const actual = resultByRoute.get(entry.detailRoute);
  return {
    skillKey: entry.skillKey,
    kind: entry.kind,
    stableKey: entry.stableKey,
    route: entry.detailRoute,
    status: actual?.status ?? null,
    data: actual?.data ?? null,
    expected: record.expected,
    stableMatch: record.passed,
    diff: record.diff ?? null,
  };
});

const statusCounts = calls.reduce((out, call) => {
  const status = String(call.status);
  out[status] = (out[status] || 0) + 1;
  return out;
}, {});
const methodCounts = calls.reduce((out, call) => {
  out[call.method] = (out[call.method] || 0) + 1;
  return out;
}, {});
const allStatus200 = calls.length === 201 && calls.every(call => call.status === 200);
const protectionPassed = protectionFailures.length === 0 && protectionRecords.length === 103;
const detailsMatched = detailFailures.length === 0 && detailRecords.length === 113;
const report = {
  generatedAt: new Date().toISOString(),
  mode: "写后独立全量GET",
  afterApply: true,
  apiBase: apiRoot,
  apiWrites: 0,
  candidateSha256: sha256(candidatePath),
  planSha256: sha256(planPath),
  inputVersionSha256: sha256(inputVersionPath),
  sourceBindingSha256: sha256(sourceBindingPath),
  sourceNoteSha256: sha256(sourceNotePath),
  protectionSnapshotSha256: sha256(protectionPath),
  sourceVersions: {
    client: sourceBinding.clientVersion,
    official: sourceBinding.officialVersion,
  },
  expected: {
    catalogs: 4,
    characters: 2,
    relations: 2,
    subjects: 10,
    images: 10,
    componentLists: 60,
    componentDetails: 113,
    protectedRoutes: 103,
    protectedNonDetailFreshGET: 88,
    protectedDetailOverlap: 15,
    plannedNewDetails: 98,
    reusedExistingDetails: 15,
    uniqueFreshGET: 201,
    formulas: 18,
    parameters: 85,
    effects: 10,
  },
  actual: {
    calls: calls.length,
    uniqueFreshGET: new Set(calls.map(call => call.route)).size,
    methods: methodCounts,
    statuses: statusCounts,
    allStatus200,
    journalPath,
  },
  protection: {
    checked: protectionRecords.length,
    passed: protectionRecords.filter(record => record.passed).length,
    failures: protectionFailures,
    records: protectionRecords,
  },
  targetDetails: {
    expected: 113,
    checked: detailRecords.length,
    matched: detailRecords.filter(record => record.passed).length,
    plannedChecked: detailRecords.filter(record => record.expected === "本次新增计划").length,
    reusedChecked: detailRecords.filter(record => record.expected === "复用既有组成").length,
    failures: detailFailures,
    records: detailRecords,
  },
  fullBusinessFields: {
    catalogs: categoryRecords(catalogs),
    characters: categoryRecords(characters),
    relations: categoryRecords(relations),
    subjects: categoryRecords(subjects),
    images: categoryRecords(images),
    componentLists: categoryRecords(componentLists),
    componentDetails: componentDetailData,
  },
  rawResponses: calls,
  failures,
  status: allStatus200 && protectionPassed && detailsMatched ? "PASS" : "REVISE",
  complete: allStatus200 && protectionPassed && detailsMatched,
};

const reportPath = path.join(runDir, "独立全量回读.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
fs.writeFileSync(path.join(runDir, "执行结果.json"), JSON.stringify({
  generatedAt: report.generatedAt,
  mode: report.mode,
  status: report.status,
  complete: report.complete,
  apiWrites: 0,
  calls: report.actual.calls,
  methods: report.actual.methods,
  statuses: report.actual.statuses,
  protection: { checked: report.protection.checked, passed: report.protection.passed },
  targetDetails: { checked: report.targetDetails.checked, matched: report.targetDetails.matched },
  reportPath,
  journalPath,
}, null, 2) + "\n", { flag: "wx" });

console.log(JSON.stringify({
  status: report.status,
  complete: report.complete,
  apiWrites: 0,
  calls: report.actual.calls,
  methods: report.actual.methods,
  statuses: report.actual.statuses,
  protection: { checked: report.protection.checked, passed: report.protection.passed },
  targetDetails: { checked: report.targetDetails.checked, matched: report.targetDetails.matched },
  output: runDir,
}, null, 2));
if (!report.complete) process.exitCode = 1;
