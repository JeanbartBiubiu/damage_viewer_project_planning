import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactRoot = path.resolve(here, '..');
const candidateDir = path.join(artifactRoot, 'hero29-luna-candidate', '修订二');
const inputDir = path.join(artifactRoot, 'hero29-root-entry-20260909');
const apiRoot = 'http://127.0.0.1:8080/api/admin/games/lol';

const candidatePath = path.join(candidateDir, '完整候选.json');
const planPath = path.join(candidateDir, '请求计划.json');
const rangePath = path.join(candidateDir, '来源与范围.json');
const versionPath = path.join(candidateDir, '候选版本.json');
const sourceBindingPath = path.join(inputDir, '来源绑定与当前文本.json');
const inputVersionPath = path.join(inputDir, '输入版本.json');
const protectionPath = path.join(inputDir, '参考资料', '当前10槽保护快照.json');
const reusePath = path.join(inputDir, '参考资料', '公共参数复用清单.json');
const sourceNotePath = path.join(inputDir, '主负责人源值核对说明.md');
const lockPath = path.join(candidateDir, '实际写入锁.json');
const saveDecisionPath = path.join(candidateDir, '主负责人实际保存决策.json');

const frozen = Object.freeze({
  candidate: '3837264e96ce61ca1cb420a0d37cdadb19d5d3082240f92cff29baff335875b1',
  plan: '162f1637ac59183d198265a5c152d245c7a1b619efef742256f094bd98344eb0',
  range: '821207448fffa37f84ab6e2bcab84a4d7d24d47161fe650d3cf40ba8b43c85e6',
  inputVersion: '85459db3db119841a7950124c3661b7cc5625b7be3b2283fe5e31fc61d66349f',
  sourceBinding: 'f09cf7a5e4f515d89860cf5f05cfd89eb3f2f42b7b19294c906740f6910f6341',
  protection: 'e68afdd8f5b82dea441ac6fed6d2ecd912fc70d0a7b05812a22b695fffb73956',
  reuse: 'ba209b9fedd67c4e00e8f95b6dcba477f1114a96df8755dffafd9f73a2a8d739',
  writer: '1f7155feb8c15937f94cf26c373dafca32fd4a741bcb2f8dfae1ef28feac20c6',
});

if (process.argv.length !== 3 || process.argv[2] !== '--after-apply') {
  throw new Error('用法：node 修订二独立回读-实际GET.mjs --after-apply');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256Value(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function writeJson(file, value, flag = undefined) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, flag ? { flag } : undefined);
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

function close(a, b, relative = 1e-6) {
  return Number.isFinite(a) && Number.isFinite(b)
    && Math.abs(a - b) <= relative * Math.max(1, Math.abs(a), Math.abs(b));
}

const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const range = readJson(rangePath);
const version = readJson(versionPath);
const sourceBinding = readJson(sourceBindingPath);
const inputVersion = readJson(inputVersionPath);
const baseline = readJson(protectionPath);
const reuseList = readJson(reusePath);
const sourceNote = fs.readFileSync(sourceNotePath, 'utf8');
const lockedWrite = readJson(lockPath);
const saveDecision = readJson(saveDecisionPath);

if (lockedWrite.status !== 'COMPLETED' || lockedWrite.apiWrites !== 97 || lockedWrite.confirmed !== 97) {
  throw new Error(`业务写入未确认97项成功：${JSON.stringify(lockedWrite)}`);
}
if (!lockedWrite.reportPath || !fs.existsSync(lockedWrite.reportPath)) {
  throw new Error(`业务写入结果不存在：${lockedWrite.reportPath}`);
}
const writeResult = readJson(lockedWrite.reportPath);
if (writeResult.success !== true || writeResult.apiWrites !== 97 || writeResult.counts?.POST !== 97) {
  throw new Error(`业务写入结果未确认97项成功：${JSON.stringify({ success: writeResult.success, apiWrites: writeResult.apiWrites, counts: writeResult.counts })}`);
}

const frozenFiles = [
  ['candidate', candidatePath, frozen.candidate],
  ['plan', planPath, frozen.plan],
  ['range', rangePath, frozen.range],
  ['inputVersion', inputVersionPath, frozen.inputVersion],
  ['sourceBinding', sourceBindingPath, frozen.sourceBinding],
  ['protection', protectionPath, frozen.protection],
  ['reuse', reusePath, frozen.reuse],
  ['writer', path.join(candidateDir, '受保护写入器.mjs'), frozen.writer],
];
for (const [label, file, expected] of frozenFiles) {
  const actual = sha256File(file);
  if (actual !== expected) throw new Error(`冻结文件散列变化：${label}=${actual}，应为${expected}`);
}
if (version.candidateSha256 !== frozen.candidate || version.planSha256 !== frozen.plan || version.sourceRangeSha256 !== frozen.range) {
  throw new Error('候选版本记录与修订二冻结散列不一致');
}
if (saveDecision.hashes?.['完整候选.json'] !== frozen.candidate
  || saveDecision.hashes?.['请求计划.json'] !== frozen.plan
  || saveDecision.hashes?.['受保护写入器.mjs'] !== frozen.writer) {
  throw new Error('主负责人保存决策与修订二冻结散列不一致');
}
if (candidate.meta?.apiWrites !== 0 || plan.apiWrites !== 0 || inputVersion.apiWrites !== 0 || inputVersion.GETs !== 99) {
  throw new Error('冻结候选或输入版本含业务写入');
}
if (sourceBinding.clientVersion !== '16.17' || sourceBinding.officialVersion !== '16.17.1') {
  throw new Error(`来源版本不符：${sourceBinding.clientVersion}/${sourceBinding.officialVersion}`);
}
for (const sourceFile of inputVersion.sourceFiles ?? []) {
  const file = path.join(inputDir, sourceFile.path);
  if (!fs.existsSync(file) || sha256File(file) !== sourceFile.sha256) throw new Error(`来源文件散列变化：${sourceFile.path}`);
}

const skills = ['ornn_p', 'ornn_q', 'ornn_w', 'ornn_e', 'ornn_r', 'shen_p', 'shen_q', 'shen_w', 'shen_e', 'shen_r'];
const kinds = [
  { kind: 'parameters', api: 'parameters', id: 'parameterKey' },
  { kind: 'formulas', api: 'formulas', id: 'formulaKey' },
  { kind: 'effects', api: 'effects', id: 'effectKey' },
  { kind: 'processes', api: 'processes', id: 'processKey' },
  { kind: 'internalStates', api: 'internal-states', id: 'stateKey' },
  { kind: 'triggerRules', api: 'trigger-rules', id: 'ruleKey' },
];
const expectedCounts = {
  ornn_p: [6, 4, 0], ornn_q: [8, 1, 1], ornn_w: [13, 4, 1], ornn_e: [8, 1, 1], ornn_r: [11, 2, 1],
  shen_p: [8, 2, 0], shen_q: [15, 3, 1], shen_w: [4, 0, 1], shen_e: [9, 1, 2], shen_r: [0, 0, 0],
};
const candidateEntries = [];
for (const skillKey of skills) {
  const skill = candidate.skills?.[skillKey];
  if (!skill || skill.skillKey !== skillKey) throw new Error(`候选技能缺失：${skillKey}`);
  for (const item of kinds) {
    const values = skill.write?.[item.kind];
    if (!Array.isArray(values)) throw new Error(`候选组成列表缺失：${skillKey}/${item.kind}`);
    const keys = values.map(value => value[item.id]);
    if (keys.some(value => typeof value !== 'string') || new Set(keys).size !== keys.length) {
      throw new Error(`候选组成键缺失或重复：${skillKey}/${item.kind}`);
    }
    for (const body of values) {
      const stableKey = body[item.id];
      candidateEntries.push({
        skillKey, kind: item.kind, api: item.api, id: item.id, stableKey,
        route: `/skills/${skillKey}/${item.api}`,
        detailRoute: `/skills/${skillKey}/${item.api}/${encodeURIComponent(stableKey)}`,
        candidateBody: body,
      });
    }
  }
}
if (candidateEntries.length !== 108) throw new Error(`当前组成应为108，实际${candidateEntries.length}`);
for (const skillKey of skills) {
  const got = kinds.slice(0, 3).map(item => candidateEntries.filter(entry => entry.skillKey === skillKey && entry.kind === item.kind).length);
  if (JSON.stringify(got) !== JSON.stringify(expectedCounts[skillKey])) throw new Error(`组成计数不符：${skillKey}/${got}`);
}

const reuseKeys = new Set();
for (const item of reuseList) {
  const key = `${item.skillKey}|parameters|${item.parameterKey}`;
  if (reuseKeys.has(key)) throw new Error(`公共复用重复：${key}`);
  reuseKeys.add(key);
}
if (reuseKeys.size !== 11) throw new Error(`公共参数复用应为11，实际${reuseKeys.size}`);
const allEntries = candidateEntries.map(entry => ({
  ...entry,
  reused: reuseKeys.has(`${entry.skillKey}|${entry.kind}|${entry.stableKey}`),
}));
const newEntries = allEntries.filter(entry => !entry.reused);
if (newEntries.length !== 97) throw new Error(`新增组成应为97，实际${newEntries.length}`);
if (plan.count !== 97 || !Array.isArray(plan.intents) || plan.intents.length !== 97) throw new Error('请求计划应为97项');
const planByKey = new Map();
for (const intent of plan.intents) {
  const key = `${intent.skillKey}|${intent.kind}|${intent.stableKey}`;
  const item = kinds.find(value => value.kind === intent.kind);
  if (!item || intent.method !== 'POST' || intent.route !== `/skills/${intent.skillKey}/${item.api}`
    || intent.stableKey !== intent.body?.[item.id] || planByKey.has(key)) throw new Error(`计划意图无效或重复：${key}`);
  const match = newEntries.find(entry => `${entry.skillKey}|${entry.kind}|${entry.stableKey}` === key);
  if (!match || !equal(strip(match.candidateBody), strip(intent.body))) throw new Error(`计划与新增候选不一致：${key}`);
  planByKey.set(key, intent);
}
if (planByKey.size !== 97) throw new Error('计划未覆盖全部97项新增组成');
for (const entry of allEntries.filter(value => value.reused)) {
  if (!baseline.requests.some(request => request.route === entry.detailRoute && request.status === 200)) {
    throw new Error(`复用详情不在保护快照：${entry.detailRoute}`);
  }
}

const baselineByRoute = new Map();
for (const request of baseline.requests ?? []) {
  if (baselineByRoute.has(request.route)) throw new Error(`保护快照路由重复：${request.route}`);
  baselineByRoute.set(request.route, request);
}
if (baseline.requests.length !== 99 || baseline.requests.some(request => request.status !== 200)) throw new Error('保护快照应为99条成功GET');
const collectionRoutes = new Map();
for (const skillKey of skills) {
  for (const item of kinds) collectionRoutes.set(`/skills/${skillKey}/${item.api}`, { skillKey, ...item });
}
const protectedListRoutes = baseline.requests.filter(request => collectionRoutes.has(request.route));
if (protectedListRoutes.length !== 60) throw new Error(`保护组成列表应为60，实际${protectedListRoutes.length}`);
const freshRoutes = [...new Set([
  ...baseline.requests.map(request => request.route),
  ...newEntries.map(entry => entry.detailRoute),
])];
if (freshRoutes.length !== 196) throw new Error(`独立唯一GET应为196，实际${freshRoutes.length}`);

const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const runDir = path.join(here, '修订二独立回读', runId);
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

function safeRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.includes('://') || route.includes('..') || route.includes('#')) {
    throw new Error(`不安全接口路径：${route}`);
  }
}

async function get(route) {
  safeRoute(route);
  const seq = ++sequence;
  appendJournal({ phase: 'BEFORE', seq, method: 'GET', route, at: new Date().toISOString() });
  let result;
  try {
    const response = await fetch(apiRoot + route, {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.HERO29_API_TOKEN || 'local-entry'}`, Accept: 'application/json' },
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
    generatedAt: new Date().toISOString(), mode: '修订二写后独立全量GET', afterApply: true, status: 'STOPPED', complete: false,
    apiWrites: 0, noBusinessWrites: true, calls: calls.length, methods: { GET: calls.length },
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
  if (allEntries.some(entry => entry.detailRoute === route && entry.reused)) return '复用详情';
  return '新增详情';
}

function checkProtection() {
  const records = [];
  const failures = [];
  const counts = { catalogs: 0, characters: 0, relations: 0, subjects: 0, images: 0, componentLists: 0, reusedDetails: 0 };
  for (const expected of baseline.requests) {
    const actual = resultByRoute.get(expected.route);
    const record = { route: expected.route, category: category(expected.route), expectedStatus: expected.status, actualStatus: actual?.status ?? null, passed: false };
    if (!actual || actual.status !== expected.status) {
      record.reason = '状态码变化';
      failures.push(record);
      records.push(record);
      continue;
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
      const planned = plan.intents.filter(intent => intent.route === expected.route);
      const oldKeys = oldRows?.map(row => row?.[collection.id]) ?? [];
      const actualKeys = actualRows?.map(row => row?.[collection.id]) ?? [];
      const allowed = new Set([...oldKeys, ...planned.map(intent => intent.stableKey)]);
      const oldDifferences = [];
      for (const oldRow of oldRows ?? []) {
        const current = actualRows?.find(row => row?.[collection.id] === oldRow[collection.id]);
        const diff = firstDiff(strip(oldRow), strip(current));
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

const protection = checkProtection();

const detailRecords = [];
const detailFailures = [];
for (const entry of allEntries) {
  const actual = resultByRoute.get(entry.detailRoute);
  const expectedRequest = entry.reused ? baselineByRoute.get(entry.detailRoute) : null;
  const expectedBody = entry.reused ? expectedRequest?.data : entry.candidateBody;
  const diff = actual?.status === 200 ? firstDiff(strip(expectedBody), strip(actual.data)) : { at: '$status', expected: 200, actual: actual?.status ?? null };
  const record = { skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute, expected: entry.reused ? '复用既有组成' : '本次新增', status: actual?.status ?? null, passed: !diff, ...(diff ? { diff } : {}) };
  detailRecords.push(record);
  if (diff) detailFailures.push(record);
}
const detailSummary = {
  checked: detailRecords.length,
  matched: detailRecords.filter(record => record.passed).length,
  failures: detailFailures,
  reusedChecked: detailRecords.filter(record => record.expected === '复用既有组成').length,
  plannedChecked: detailRecords.filter(record => record.expected === '本次新增').length,
};

const actualParameterIndex = new Map();
const actualFormulaIndex = new Map();
const actualEffectIndex = new Map();
for (const entry of allEntries) {
  const actual = resultByRoute.get(entry.detailRoute)?.data;
  if (!actual) continue;
  const key = `${entry.skillKey}/${entry.stableKey}`;
  if (entry.kind === 'parameters') actualParameterIndex.set(key, actual);
  if (entry.kind === 'formulas') actualFormulaIndex.set(key, actual);
  if (entry.kind === 'effects') actualEffectIndex.set(key, actual);
}

const allowedOperations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
const allowedAttributeKinds = new Set(['BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO']);
const formulaDependencies = (node, result = []) => {
  if (!node || typeof node !== 'object') return result;
  if (node.nodeType === 'PARAMETER') result.push({ type: 'parameter', key: node.parameterKey });
  else if (node.nodeType === 'ATTRIBUTE') result.push({ type: 'attribute', key: `${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`, owner: node.attributeOwner, attributeKey: node.attributeKey, kind: node.attributeValueKind });
  else if (node.nodeType === 'OPERATION') for (const child of node.operands ?? []) formulaDependencies(child, result);
  return result;
};
const structural = {
  operationArityFailures: [], parameterReferenceFailures: [], attributeFailures: [],
  runtimeDefaultsFailures: [], integerTypeFailures: [], integerValueFailures: [], negativeTimeFailures: [],
  duplicateKeys: [], forbiddenResultTypes: [], momentRuntimeReferenceFailures: [],
};
const scanActualExpression = (node, skillKey, formulaKey) => {
  if (!node || typeof node !== 'object') { structural.operationArityFailures.push(`${skillKey}/${formulaKey}/empty`); return; }
  if (node.nodeType === 'PARAMETER') {
    if (!actualParameterIndex.has(`${skillKey}/${node.parameterKey}`)) structural.parameterReferenceFailures.push(`${skillKey}/${formulaKey}/${node.parameterKey}`);
    return;
  }
  if (node.nodeType === 'ATTRIBUTE') {
    if (!['SOURCE', 'TARGET'].includes(node.attributeOwner) || !allowedAttributeKinds.has(node.attributeValueKind)) structural.attributeFailures.push(`${skillKey}/${formulaKey}/${JSON.stringify(node)}`);
    return;
  }
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2 || !allowedOperations.has(node.operation)) {
    structural.operationArityFailures.push(`${skillKey}/${formulaKey}/${node.nodeType || 'missing'}`);
    return;
  }
  scanActualExpression(node.operands[0], skillKey, formulaKey);
  scanActualExpression(node.operands[1], skillKey, formulaKey);
};
for (const [key, formula] of actualFormulaIndex) scanActualExpression(formula.expression, key.split('/')[0], key.split('/').slice(1).join('/'));
for (const [key, parameter] of actualParameterIndex) {
  if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) structural.runtimeDefaultsFailures.push(key);
  const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : Object.values(parameter.levelValues ?? {});
  if (parameter.valueType === 'INTEGER' && values.some(value => value !== null && value !== undefined && !Number.isInteger(value))) structural.integerValueFailures.push(key);
  if (parameter.valueType === 'INTEGER' && !['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT'].includes(parameter.valueMode)) structural.integerTypeFailures.push(key);
  if (parameter.parameterKey.endsWith('_ms')) {
    if (parameter.valueType !== 'INTEGER') structural.integerTypeFailures.push(key);
    if (values.some(value => value !== null && value !== undefined && (!Number.isInteger(value) || value < 0))) structural.negativeTimeFailures.push(key);
  }
  if (parameter.valueMode === 'CHARACTER_LEVEL') {
    const levels = Object.keys(parameter.levelValues ?? {}).map(Number).sort((a, b) => a - b);
    if (JSON.stringify(levels) !== JSON.stringify(Array.from({ length: 18 }, (_, index) => index + 1))) structural.integerTypeFailures.push(`${key}/character-level-keys`);
  }
  if (parameter.valueMode === 'SKILL_LEVEL') {
    const levels = Object.keys(parameter.levelValues ?? {}).map(Number).sort((a, b) => a - b);
    if (levels.length < 1 || levels[0] !== 1 || levels.some((value, index) => value !== index + 1) || levels.at(-1) > 5) structural.integerTypeFailures.push(`${key}/skill-level-keys`);
  }
}
for (const [key, effect] of actualEffectIndex) {
  for (const result of effect.results ?? []) {
    if (!['RESOURCE_CHANGE'].includes(result.resultType)) structural.forbiddenResultTypes.push(`${key}/${result.resultType}`);
    if (result.lifecycleBehavior?.moment === 'MOMENT_EVALUATION') {
      const value = result.valueRule?.value;
      if (value?.kind === 'PARAMETER' && actualParameterIndex.get(`${key.split('/')[0]}/${value.parameterKey}`)?.valueMode === 'RUNTIME_INPUT') structural.momentRuntimeReferenceFailures.push(`${key}/${value.parameterKey}`);
      if (value?.kind === 'FORMULA' && actualFormulaIndex.get(`${key.split('/')[0]}/${value.formulaKey}`)) structural.momentRuntimeReferenceFailures.push(`${key}/${value.formulaKey}`);
    }
  }
}

const sourceHeroById = new Map((sourceBinding.heroes ?? []).map(hero => [hero.id, hero]));
const sourceSkill = (skillKey) => {
  const [heroName, slotName] = skillKey.split('_');
  const hero = sourceHeroById.get(heroName === 'ornn' ? 'Ornn' : 'Shen');
  return hero?.skills?.find(skill => skill.slot.toLowerCase() === slotName);
};
const spellOf = skillKey => sourceSkill(skillKey)?.object?.mSpell;
const dataValues = (spell, name) => spell?.DataValues?.find(item => item.name === name)?.values ?? null;
const calculation = (spell, name) => spell?.mSpellCalculations?.[name];
const calcPart = (spell, name, index) => calculation(spell, name)?.mFormulaParts?.[index];
const sourceSkillValue = (spell, name, skillLevel) => {
  const values = dataValues(spell, name);
  if (!values || values[skillLevel] === undefined) throw new Error(`来源值缺失 ${name}[${skillLevel}]`);
  return values[skillLevel];
};
const sourceSkillConst = (spell, name, index = 1) => {
  const values = dataValues(spell, name);
  if (!values || values[index] === undefined) throw new Error(`来源常数缺失 ${name}[${index}]`);
  return values[index];
};
const ornnp = spellOf('ornn_p');
const ornnq = spellOf('ornn_q');
const ornnw = spellOf('ornn_w');
const ornne = spellOf('ornn_e');
const ornnr = spellOf('ornn_r');
const shenp = spellOf('shen_p');
const shenq = spellOf('shen_q');
const shene = spellOf('shen_e');
for (const [key, spell] of Object.entries({ ornnp, ornnq, ornnw, ornne, ornnr, shenp, shenq, shene })) {
  if (!spell) throw new Error(`冻结来源缺少${key}`);
}

const sourceFlatDamage = characterLevel => {
  if (!Number.isInteger(characterLevel) || characterLevel < 1 || characterLevel > 18) throw new Error('角色等级无效');
  const part = calcPart(shenq, 'BaseFlatDamage', 0);
  let value = part.mLevel1Value;
  for (const breakpoint of part.mBreakpoints ?? []) if (characterLevel >= breakpoint.mLevel) value += breakpoint.mAdditionalBonusAtThisLevel;
  return value;
};
const sourceOrnnP = {
  baseAmp: sourceSkillConst(ornnp, 'BaseStatAmp'),
  masterworkAmp: sourceSkillConst(ornnp, 'AdditionalMythicStatAmp'),
};
const sourceShenE = {
  basePart: calcPart(shene, 'TauntDamage', 0),
  bonusHealthPart: calcPart(shene, 'TauntDamage', 1),
  bonusHealthRatio: sourceSkillConst(shene, calcPart(shene, 'TauntDamage', 1)?.mDataValue),
};
if (sourceShenE.bonusHealthPart?.mStat !== 12 || sourceShenE.bonusHealthPart?.mStatFormula !== 2) throw new Error('慎E额外生命来源选择器变化');

function scenario(skillKey, index = 0) {
  const attributes = index === 0 ? {
    SOURCE: { attack_damage: { TOTAL: 200 }, ability_power: { TOTAL: 200 }, hp: { BONUS: 1000 }, magic_resistance: { BONUS: 30 } },
    TARGET: { hp: { TOTAL: 2000 } },
  } : {
    SOURCE: { attack_damage: { TOTAL: 350 }, ability_power: { TOTAL: 450 }, hp: { BONUS: 2000 }, magic_resistance: { BONUS: 50 } },
    TARGET: { hp: { TOTAL: 500 } },
  };
  const result = { attributes, skillLevel: 3, characterLevel: index === 0 ? 10 : 16, runtime: {} };
  if (skillKey === 'ornn_p') result.runtime.ornn_p = { actual_masterwork_count: index === 0 ? 2 : 5, actual_source_hp_before_ornn_passive: index === 0 ? 1000 : 2000, actual_source_armor_before_ornn_passive: index === 0 ? 100 : 200, actual_source_magic_resistance_before_ornn_passive: index === 0 ? 50 : 100 };
  if (skillKey === 'ornn_w') result.runtime.ornn_w = { actual_brittle_extra_magic_ratio: index === 0 ? 0.09 : 0.17 };
  if (skillKey === 'ornn_e') result.runtime.ornn_e = { actual_source_armor_for_ornn_e: index === 0 ? 100 : 200 };
  if (skillKey === 'shen_p') result.runtime.shen_p = { actual_base_shield_value: index === 0 ? 80 : 120 };
  if (skillKey === 'shen_q') result.skillLevel = 3;
  if (skillKey === 'shen_e') result.skillLevel = 3;
  return result;
}

function readRuntimeParameter(skillKey, key, context) {
  const parameter = actualParameterIndex.get(`${skillKey}/${key}`);
  if (!parameter) throw new Error(`实际GET缺少参数 ${skillKey}/${key}`);
  const supplied = context.runtime?.[skillKey]?.[key];
  if (parameter.valueMode === 'RUNTIME_INPUT') {
    if (supplied === undefined) throw new Error(`缺少运行输入 ${skillKey}/${key}`);
    if (parameter.valueType === 'INTEGER' && !Number.isInteger(supplied)) throw new Error(`整数运行输入无效 ${skillKey}/${key}`);
    if (key.endsWith('_ms') && supplied < 0) throw new Error(`毫秒运行输入为负 ${skillKey}/${key}`);
    if (key === 'actual_masterwork_count' && supplied < 0) throw new Error(`杰作数量为负 ${skillKey}/${key}`);
    return supplied;
  }
  if (supplied !== undefined) return supplied;
  if (parameter.valueMode === 'FIXED') return parameter.fixedValue;
  if (parameter.valueMode === 'SKILL_LEVEL') {
    if (!Number.isInteger(context.skillLevel) || context.skillLevel < 1 || context.skillLevel > 5) throw new Error(`技能等级无效 ${skillKey}/${key}`);
    const value = parameter.levelValues?.[String(context.skillLevel)];
    if (value === undefined) throw new Error(`技能等级值缺失 ${skillKey}/${key}`);
    return value;
  }
  if (parameter.valueMode === 'CHARACTER_LEVEL') {
    if (!Number.isInteger(context.characterLevel) || context.characterLevel < 1 || context.characterLevel > 18) throw new Error(`角色等级无效 ${skillKey}/${key}`);
    const value = parameter.levelValues?.[String(context.characterLevel)];
    if (value === undefined) throw new Error(`角色等级值缺失 ${skillKey}/${key}`);
    return value;
  }
  throw new Error(`参数无可用值 ${skillKey}/${key}`);
}

function readAttribute(node, context) {
  const value = context.attributes?.[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
  if (value === undefined) throw new Error(`属性输入缺失 ${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`);
  if (!Number.isFinite(value)) throw new Error(`属性输入非数值 ${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`);
  return value;
}

function evaluateActual(node, skillKey, context) {
  if (node?.nodeType === 'PARAMETER') return readRuntimeParameter(skillKey, node.parameterKey, context);
  if (node?.nodeType === 'ATTRIBUTE') return readAttribute(node, context);
  if (node?.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2 || !allowedOperations.has(node.operation)) throw new Error('实际表达式结构无效');
  const [left, right] = node.operands.map(child => evaluateActual(child, skillKey, context));
  if (node.operation === 'ADD') return left + right;
  if (node.operation === 'SUBTRACT') return left - right;
  if (node.operation === 'MULTIPLY') return left * right;
  if (node.operation === 'DIVIDE') return left / right;
  if (node.operation === 'MIN') return Math.min(left, right);
  if (node.operation === 'MAX') return Math.max(left, right);
  throw new Error(`实际运算无效 ${node.operation}`);
}

function expectedFormulaValue(skillKey, formulaKey, context) {
  const level = context.skillLevel;
  const characterLevel = context.characterLevel;
  const sourceAD = context.attributes.SOURCE.attack_damage.TOTAL;
  const sourceAP = context.attributes.SOURCE.ability_power.TOTAL;
  const targetHP = context.attributes.TARGET.hp.TOTAL;
  if (skillKey === 'ornn_p') {
    const ratio = sourceOrnnP.baseAmp + sourceOrnnP.masterworkAmp * context.runtime.ornn_p.actual_masterwork_count;
    if (formulaKey === 'stat_amplification_ratio') return ratio;
    const base = { bonus_health: 'actual_source_hp_before_ornn_passive', bonus_armor: 'actual_source_armor_before_ornn_passive', bonus_magic_resistance: 'actual_source_magic_resistance_before_ornn_passive' }[formulaKey];
    return ratio * context.runtime.ornn_p[base];
  }
  if (skillKey === 'ornn_q') return sourceSkillValue(ornnq, 'BaseDamage', level) + calcPart(ornnq, 'TotalDamage', 1).mCoefficient * sourceAD;
  if (skillKey === 'ornn_w') {
    const minimum = sourceSkillValue(ornnw, 'MinimumDamagePerTick', level);
    const perTick = Math.max(minimum, sourceSkillValue(ornnw, 'PercentHPPerTick', level) * targetHP);
    const tickCount = sourceSkillValue(ornnw, 'NumberOfTicks', level);
    if (formulaKey === 'minimum_damage_total') return minimum * tickCount;
    if (formulaKey === 'damage_per_tick') return perTick;
    if (formulaKey === 'five_tick_damage_total') return tickCount * perTick;
    if (formulaKey === 'brittle_extra_magic_damage') return context.runtime.ornn_w.actual_brittle_extra_magic_ratio * targetHP;
  }
  if (skillKey === 'ornn_e') return sourceSkillValue(ornne, 'BaseDamage', level) + sourceSkillConst(ornne, 'ArmorRatio') * context.runtime.ornn_e.actual_source_armor_for_ornn_e + sourceSkillConst(ornne, 'MRRatio') * context.attributes.SOURCE.magic_resistance.BONUS;
  if (skillKey === 'ornn_r') {
    const per = sourceSkillValue(ornnr, 'RBaseDamage', level) + sourceSkillConst(ornnr, 'RRatio') * sourceAP;
    return formulaKey === 'magic_damage_per_pass' ? per : 2 * per;
  }
  if (skillKey === 'shen_p') {
    const base = context.runtime.shen_p.actual_base_shield_value + calcPart(shenp, '{58a09e24}', 1).mCoefficient * context.attributes.SOURCE.hp.BONUS;
    return formulaKey === 'default_shield_value' ? base : sourceSkillConst(shenp, 'ShenZedQuestShieldMultiplier') * base;
  }
  if (skillKey === 'shen_q') {
    const points = formulaKey === 'normal_enhanced_attack_magic_damage' ? sourceSkillValue(shenq, 'BasePercentDamage', level) : sourceSkillValue(shenq, 'EnhancedPercentDamage', level);
    const apRatio = formulaKey === 'normal_enhanced_attack_magic_damage' ? calcPart(shenq, 'BasePercentHealth', 1).mCoefficient : calcPart(shenq, 'EmpPercentHealth', 1).mCoefficient;
    const per = sourceFlatDamage(characterLevel) + calculation(shenq, 'BasePercentHealth').mMultiplier.mNumber * (points + apRatio * sourceAP) * targetHP;
    return formulaKey === 'enhanced_attack_magic_damage_total' ? sourceSkillValue(shenq, 'NumEnhancedAttacks', level) * per : per;
  }
  if (skillKey === 'shen_e') return sourceSkillValue(shene, 'BaseDamage', level) + sourceShenE.bonusHealthRatio * context.attributes.SOURCE.hp.BONUS;
  throw new Error(`未知公式 ${skillKey}/${formulaKey}`);
}

const formulaResults = [];
const mathFailures = [];
for (const entry of allEntries.filter(item => item.kind === 'formulas')) {
  const actual = actualFormulaIndex.get(`${entry.skillKey}/${entry.stableKey}`);
  if (!actual) { mathFailures.push({ formula: `${entry.skillKey}/${entry.stableKey}`, reason: '实际GET公式缺失' }); continue; }
  const cases = [];
  for (let index = 0; index < 2; index += 1) {
    const context = scenario(entry.skillKey, index);
    try {
      const actualValue = evaluateActual(actual.expression, entry.skillKey, context);
      const expectedValue = expectedFormulaValue(entry.skillKey, entry.stableKey, context);
      const passed = close(actualValue, expectedValue);
      cases.push({ case: index + 1, actual: actualValue, expected: expectedValue, passed });
      if (!passed) mathFailures.push({ formula: `${entry.skillKey}/${entry.stableKey}`, case: index + 1, reason: '实际表达式与冻结原始树数值不一致', actual: actualValue, expected: expectedValue });
    } catch (error) {
      cases.push({ case: index + 1, passed: false, error: String(error.message || error) });
      mathFailures.push({ formula: `${entry.skillKey}/${entry.stableKey}`, case: index + 1, reason: '实际表达式求值失败', error: String(error.message || error) });
    }
  }
  formulaResults.push({ skillKey: entry.skillKey, formulaKey: entry.stableKey, expressionSource: '实际GET详情响应', actualExpressionSha256: sha256Value(actual.expression), cases });
}

const missingResults = [];
for (const entry of allEntries.filter(item => item.kind === 'formulas')) {
  const actual = actualFormulaIndex.get(`${entry.skillKey}/${entry.stableKey}`);
  if (!actual) continue;
  const dependencies = formulaDependencies(actual.expression).filter(dep => {
    if (dep.type === 'attribute') return true;
    const parameter = actualParameterIndex.get(`${entry.skillKey}/${dep.key}`);
    return parameter?.valueMode === 'RUNTIME_INPUT' || parameter?.valueMode === 'CHARACTER_LEVEL';
  });
  const unique = new Map(dependencies.map(dep => [`${dep.type}:${dep.key}`, dep]));
  for (const dependency of unique.values()) {
    const context = scenario(entry.skillKey, 0);
    if (dependency.type === 'parameter') {
      if (actualParameterIndex.get(`${entry.skillKey}/${dependency.key}`)?.valueMode === 'CHARACTER_LEVEL') delete context.characterLevel;
      else {
        context.runtime[entry.skillKey] = { ...(context.runtime[entry.skillKey] ?? {}) };
        delete context.runtime[entry.skillKey][dependency.key];
      }
    } else {
      delete context.attributes[dependency.owner][dependency.attributeKey][dependency.kind];
    }
    let rejected = false;
    let error = null;
    try { evaluateActual(actual.expression, entry.skillKey, context); } catch (caught) { rejected = true; error = String(caught.message || caught); }
    missingResults.push({ formula: `${entry.skillKey}/${entry.stableKey}`, dependency, rejected, ...(error ? { error } : {}) });
    if (!rejected) mathFailures.push({ formula: `${entry.skillKey}/${entry.stableKey}`, reason: '删除外部输入后实际表达式未拒绝', dependency });
  }
}

const runtimeParameters = [];
for (const [key, parameter] of actualParameterIndex) {
  if (parameter.valueMode !== 'RUNTIME_INPUT') continue;
  const [skillKey, ...parts] = key.split('/');
  const parameterKey = parts.join('/');
  const context = scenario(skillKey, 0);
  context.runtime[skillKey] = { ...(context.runtime[skillKey] ?? {}) };
  delete context.runtime[skillKey][parameterKey];
  let rejected = false;
  let error = null;
  try { readRuntimeParameter(skillKey, parameterKey, context); } catch (caught) { rejected = true; error = String(caught.message || caught); }
  runtimeParameters.push({ skillKey, parameterKey, rejected, ...(error ? { error } : {}) });
  if (!rejected) mathFailures.push({ area: 'runtime-input', reason: '运行输入缺失未拒绝', skillKey, parameterKey });
}

const integerRuntimeRejections = [];
for (const [key, parameter] of actualParameterIndex) {
  if (parameter.valueMode !== 'RUNTIME_INPUT' || parameter.valueType !== 'INTEGER') continue;
  const [skillKey, ...parts] = key.split('/');
  const parameterKey = parts.join('/');
  const context = scenario(skillKey, 0);
  context.runtime[skillKey] = { ...(context.runtime[skillKey] ?? {}), [parameterKey]: 0.5 };
  let rejected = false;
  try { readRuntimeParameter(skillKey, parameterKey, context); } catch { rejected = true; }
  integerRuntimeRejections.push({ skillKey, parameterKey, value: 0.5, rejected });
  if (!rejected) mathFailures.push({ area: 'integer-runtime', reason: '小数整数输入未拒绝', skillKey, parameterKey });
}

const invalidCharacterLevelRejections = [];
for (const value of [0, 19, 1.5]) {
  const context = scenario('shen_q', 0);
  context.characterLevel = value;
  let rejected = false;
  try { readRuntimeParameter('shen_q', 'actual_base_flat_damage', context); } catch { rejected = true; }
  invalidCharacterLevelRejections.push({ value, rejected });
  if (!rejected) mathFailures.push({ area: 'character-level', reason: '非法角色等级未拒绝', value });
}
let negativeMasterworkRejected = false;
try {
  const context = scenario('ornn_p', 0);
  context.runtime.ornn_p.actual_masterwork_count = -1;
  evaluateActual(actualFormulaIndex.get('ornn_p/stat_amplification_ratio').expression, 'ornn_p', context);
} catch {
  negativeMasterworkRejected = true;
}
if (!negativeMasterworkRejected) mathFailures.push({ area: 'masterwork-boundary', reason: '负杰作数量未拒绝' });

const boundaryResults = [];
function boundary(name, actualValue, expectedValue) {
  const passed = close(actualValue, expectedValue);
  boundaryResults.push({ name, actual: actualValue, expected: expectedValue, passed });
  if (!passed) mathFailures.push({ area: 'boundary', name, actual: actualValue, expected: expectedValue });
}
function actualFormulaValue(skillKey, formulaKey, context) {
  const formula = actualFormulaIndex.get(`${skillKey}/${formulaKey}`);
  if (!formula) throw new Error(`实际GET缺少公式 ${skillKey}/${formulaKey}`);
  return evaluateActual(formula.expression, skillKey, context);
}
for (const targetHP of [1, 1000, 100000]) {
  const context = scenario('ornn_w', 0);
  context.attributes.TARGET.hp.TOTAL = targetHP;
  boundary(`ornn_w/damage_per_tick目标生命${targetHP}`, actualFormulaValue('ornn_w', 'damage_per_tick', context), Math.max(sourceSkillValue(ornnw, 'MinimumDamagePerTick', 3), sourceSkillValue(ornnw, 'PercentHPPerTick', 3) * targetHP));
}
for (const count of [0, 1, 13, 50]) {
  const context = scenario('ornn_p', 0);
  context.runtime.ornn_p.actual_masterwork_count = count;
  boundary(`ornn_p/杰作数量${count}`, actualFormulaValue('ornn_p', 'stat_amplification_ratio', context), sourceOrnnP.baseAmp + sourceOrnnP.masterworkAmp * count);
}
{
  const context = scenario('ornn_r', 1);
  boundary('ornn_r/同一敌人两程', actualFormulaValue('ornn_r', 'magic_damage_same_enemy_total', context), 2 * actualFormulaValue('ornn_r', 'magic_damage_per_pass', context));
}
{
  const context = scenario('shen_q', 1);
  boundary('shen_q/三次强化攻击总量', actualFormulaValue('shen_q', 'enhanced_attack_magic_damage_total', context), sourceSkillValue(shenq, 'NumEnhancedAttacks', 3) * actualFormulaValue('shen_q', 'enhanced_attack_magic_damage', context));
}
for (const level of [1, 3, 4, 7, 10, 13, 16, 18]) {
  const context = scenario('shen_q', 0);
  context.characterLevel = level;
  const actualValue = actualFormulaValue('shen_q', 'normal_enhanced_attack_magic_damage', context);
  const expectedValue = sourceFlatDamage(level) + calculation(shenq, 'BasePercentHealth').mMultiplier.mNumber * (sourceSkillValue(shenq, 'BasePercentDamage', 3) + calcPart(shenq, 'BasePercentHealth', 1).mCoefficient * context.attributes.SOURCE.ability_power.TOTAL) * context.attributes.TARGET.hp.TOTAL;
  boundary(`shen_q/角色等级${level}断点`, actualValue, expectedValue);
}
const energyExpected = { 1: 30, 3: 30, 4: 40, 11: 40, 12: 50, 18: 50 };
for (const [levelText, expected] of Object.entries(energyExpected)) {
  const context = scenario('shen_e', 0);
  context.characterLevel = Number(levelText);
  const actualValue = readRuntimeParameter('shen_e', 'actual_energy_refund_on_damage', context);
  boundary(`shen_e/能量回复角色等级${levelText}`, actualValue, expected);
}

const sourceChecks = {
  versions: sourceBinding.clientVersion === '16.17' && sourceBinding.officialVersion === '16.17.1',
  ornnP: sourceOrnnP.baseAmp === dataValues(ornnp, 'BaseStatAmp')[1] && sourceOrnnP.masterworkAmp === dataValues(ornnp, 'AdditionalMythicStatAmp')[1],
  ornnQ: calcPart(ornnq, 'TotalDamage', 1)?.mStat === 2,
  ornnE: calcPart(ornne, 'TotalDamage', 1)?.mStat === 1 && calcPart(ornne, 'TotalDamage', 1)?.mStatFormula === 2 && calcPart(ornne, 'TotalDamage', 2)?.mStat === 6 && calcPart(ornne, 'TotalDamage', 2)?.mStatFormula === 2,
  shenP: calcPart(shenp, '{58a09e24}', 1)?.mStat === 12 && calcPart(shenp, '{58a09e24}', 1)?.mStatFormula === 2,
  shenQ: calculation(shenq, 'BasePercentHealth')?.mMultiplier?.mNumber !== undefined && calcPart(shenq, 'BasePercentHealth', 1)?.mCoefficient !== undefined && calcPart(shenq, 'EmpPercentHealth', 1)?.mCoefficient !== undefined,
  shenE: sourceShenE.bonusHealthPart?.mDataValue === 'BonusHPRatio' && sourceShenE.bonusHealthPart?.mStat === 12 && sourceShenE.bonusHealthPart?.mStatFormula === 2,
  noUnknownDefault: !sourceNote.includes('默认0') || sourceNote.includes('无默认'),
};

const actualMath = {
  source: '实际GET详情响应中的expression/parameter字段；期望值从冻结来源原始树与DataValues独立计算',
  formulas: formulaResults.length,
  formulaCases: formulaResults.reduce((total, result) => total + result.cases.length, 0),
  formulaResults,
  missingDependencyCases: missingResults.length,
  missingRejectedCases: missingResults.filter(result => result.rejected).length,
  missingResults,
  runtimeParameters,
  runtimeInputMissingRejected: runtimeParameters.filter(result => result.rejected).length,
  integerRuntimeRejections,
  invalidCharacterLevelRejections,
  negativeMasterworkRejected,
  boundaryCases: boundaryResults.length,
  boundaryResults,
  sourceChecks,
  structural,
  failures: mathFailures,
  passed: mathFailures.length === 0 && formulaResults.length === 18 && formulaResults.every(result => result.cases.length === 2)
    && missingResults.length === 30 && missingResults.every(result => result.rejected)
    && runtimeParameters.length === 11 && runtimeParameters.every(result => result.rejected)
    && integerRuntimeRejections.length === 5 && integerRuntimeRejections.every(result => result.rejected)
    && invalidCharacterLevelRejections.every(result => result.rejected) && negativeMasterworkRejected
    && Object.values(sourceChecks).every(Boolean),
};

const statuses = calls.reduce((out, call) => { const key = String(call.status); out[key] = (out[key] || 0) + 1; return out; }, {});
const allStatus200 = calls.length === 196 && calls.every(call => call.status === 200);
const protectionPassed = protection.checked === 99 && protection.passed === 99 && protection.failures.length === 0;
const detailsPassed = detailSummary.checked === 108 && detailSummary.matched === 108 && detailSummary.failures.length === 0;
const actualDetails = allEntries.map(entry => ({
  skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute,
  expected: entry.reused ? '复用既有组成' : '本次新增', status: resultByRoute.get(entry.detailRoute)?.status ?? null,
  data: resultByRoute.get(entry.detailRoute)?.data ?? null,
}));
const report = {
  generatedAt: new Date().toISOString(), mode: '修订二写后独立全量GET与实际表达式数学', afterApply: true,
  apiBase: apiRoot, apiWrites: 0, noBusinessWrites: true,
  candidateSha256: sha256File(candidatePath), planSha256: sha256File(planPath), rangeSha256: sha256File(rangePath),
  inputVersionSha256: sha256File(inputVersionPath), sourceBindingSha256: sha256File(sourceBindingPath), protectionSnapshotSha256: sha256File(protectionPath), reuseSha256: sha256File(reusePath), writerSha256: sha256File(path.join(candidateDir, '受保护写入器.mjs')),
  sourceVersions: candidate.meta?.sourceVersions ?? sourceBinding,
  expected: { catalogs: 4, characters: 2, relations: 2, subjects: 10, images: 10, componentLists: 60, protectedRoutes: 99, reusedDetails: 11, plannedNewDetails: 97, componentDetails: 108, uniqueFreshGET: 196, parameters: 82, formulas: 18, effects: 8 },
  actual: { calls: calls.length, uniqueFreshGET: new Set(calls.map(call => call.route)).size, methods: { GET: calls.length }, statuses, allStatus200, journalPath },
  protection: { checked: protection.checked, passed: protection.passed, failures: protection.failures, counts: protection.counts, records: protection.records },
  targetDetails: detailSummary,
  fullBusinessFields: { protectedRoutes: baseline.requests.map(request => ({ route: request.route, category: category(request.route), status: resultByRoute.get(request.route)?.status ?? null, data: resultByRoute.get(request.route)?.data ?? null })), componentDetails: actualDetails },
  actualMath,
  rawResponses: calls,
  writeEvidence: { lockPath, lockedWrite, reportPath: lockedWrite.reportPath, result: { success: writeResult.success, apiWrites: writeResult.apiWrites, counts: writeResult.counts }, saveDecisionPath },
  frozen,
  status: allStatus200 && protectionPassed && detailsPassed && actualMath.passed ? 'PASS' : 'REVISE',
  complete: allStatus200 && protectionPassed && detailsPassed && actualMath.passed,
};
const reportPath = path.join(runDir, '独立全量回读.json');
writeJson(reportPath, report, 'wx');
const execution = {
  generatedAt: report.generatedAt, mode: report.mode, status: report.status, complete: report.complete, apiWrites: 0, noBusinessWrites: true,
  calls: report.actual.calls, methods: report.actual.methods, statuses: report.actual.statuses,
  protection: { checked: report.protection.checked, passed: report.protection.passed },
  targetDetails: { checked: report.targetDetails.checked, matched: report.targetDetails.matched },
  actualMath: { formulas: report.actualMath.formulas, formulaCases: report.actualMath.formulaCases, missingDependencyCases: report.actualMath.missingDependencyCases, missingRejectedCases: report.actualMath.missingRejectedCases, runtimeParameters: report.actualMath.runtimeParameters.length, runtimeInputMissingRejected: report.actualMath.runtimeInputMissingRejected, integerRuntimeRejections: report.actualMath.integerRuntimeRejections.length, invalidCharacterLevelRejections: report.actualMath.invalidCharacterLevelRejections.length, boundaryCases: report.actualMath.boundaryCases, passed: report.actualMath.passed },
  reportPath, journalPath,
};
writeJson(path.join(runDir, '执行结果.json'), execution, 'wx');
console.log(JSON.stringify({ status: report.status, complete: report.complete, apiWrites: 0, calls: report.actual.calls, methods: report.actual.methods, statuses: report.actual.statuses, protection: { checked: report.protection.checked, passed: report.protection.passed }, targetDetails: { checked: report.targetDetails.checked, matched: report.targetDetails.matched }, actualMath: execution.actualMath, output: runDir }, null, 2));
if (!report.complete) process.exitCode = 1;
