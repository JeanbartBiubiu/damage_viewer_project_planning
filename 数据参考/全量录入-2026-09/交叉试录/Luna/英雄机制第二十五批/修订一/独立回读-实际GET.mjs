import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const inputDir = path.join(path.resolve(here, '..'), '输入包');
const apiRoot = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidatePath = path.join(here, '完整候选.json');
const planPath = path.join(here, '写前请求计划.json');
const sourceValuesPath = path.join(here, '独立源值与算例.json');
const sourceManifestPath = path.join(here, '来源哈希汇总.json');
const inputVersionPath = path.join(inputDir, '输入版本.json');
const sourceBindingPath = path.join(inputDir, '来源绑定与当前文本.json');
const sourceNotePath = path.join(inputDir, '主负责人源值核对说明.md');
const protectionPath = path.join(inputDir, '参考资料', '当前10槽保护快照.json');
const reusePath = path.join(inputDir, '参考资料', '公共参数复用清单.json');
const frozen = Object.freeze({
  candidate: '85ce89e6cead0c7c6b243643ed75a829349d9c7260973643d089cfa6bbc28028',
  plan: 'b22ce20986991a7bf2d3f0db372f2265e3b7f9098e30957722f62c3c112d4cb2',
  sourceValues: 'f973c4092defc937e81465623d5525e3693d0d92c8f1b1d4f0052ff628288055',
  sourceManifest: 'cb6b0911c384a745112b9d880033ab3c0f376528a56d3a4a560e3eeb4f66755e',
  inputVersion: 'e9d0b70006b8f9ae6a6524201154504121be9602a4ec0d290839f650aea2bc12',
  sourceBinding: '21a6cda27054f95e480984e902ba22d4a7c2c045e67a6f9cd90fe999b87d137d',
  sourceNote: 'df459305dadbbc0d78bd891ed5dca4e947b164f623deab6d0cff24ded8ab2ea7',
  protection: '06d0751e2b4b3f77773157df078cbc30894f707e2dd305982e6ed53c041c4878',
  reuse: '142eeaaf6fcfbfde7192e5c1af4d6ab74502cffe58d0ede755e1498d6d6f0604',
});

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== '--after-apply') throw new Error('用法：node 独立回读-实际GET.mjs --after-apply');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return { at, expected, actual };
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return { at, expected, actual };
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDiff(expected[index], actual[index], `${at}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const key of keys) {
    if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) return { at: `${at}.${key}`, expectedPresent: Object.hasOwn(expected, key), actualPresent: Object.hasOwn(actual, key) };
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
  if (!actual || actual[idField] !== expected[idField]) return { at: `.${idField}`, expected: expected[idField], actual: actual?.[idField] };
  for (const field of Object.keys(expected)) {
    if (!Object.hasOwn(actual, field)) continue;
    const difference = firstDiff(strip(expected[field]), strip(actual[field]), `.${field}`);
    if (difference) return difference;
  }
  return null;
}

const frozenFiles = [
  ['candidate', candidatePath, frozen.candidate],
  ['plan', planPath, frozen.plan],
  ['sourceValues', sourceValuesPath, frozen.sourceValues],
  ['sourceManifest', sourceManifestPath, frozen.sourceManifest],
  ['inputVersion', inputVersionPath, frozen.inputVersion],
  ['sourceBinding', sourceBindingPath, frozen.sourceBinding],
  ['sourceNote', sourceNotePath, frozen.sourceNote],
  ['protection', protectionPath, frozen.protection],
  ['reuse', reusePath, frozen.reuse],
];
for (const [label, file, expected] of frozenFiles) {
  const actual = sha256File(file);
  if (actual !== expected) throw new Error(`冻结文件散列变化：${label}=${actual}，应为${expected}`);
}

const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const sourceValues = readJson(sourceValuesPath);
const sourceManifest = readJson(sourceManifestPath);
const inputVersion = readJson(inputVersionPath);
const baseline = readJson(protectionPath);
const reuseList = readJson(reusePath);
if (candidate.meta?.businessWrites !== 0 || candidate.meta?.apiCalls !== 0 || candidate.apiWrites !== 0 || plan.noApiCalls !== true || sourceValues.noWrites !== true) throw new Error('冻结候选或来源文件含业务写入');
for (const source of inputVersion.sourceFiles ?? []) {
  const file = path.join(inputDir, source.path);
  if (sha256File(file) !== source.sha256) throw new Error(`来源文件散列变化：${source.path}`);
}

const kinds = [
  { kind: 'parameters', api: 'parameters', id: 'parameterKey' },
  { kind: 'formulas', api: 'formulas', id: 'formulaKey' },
  { kind: 'effects', api: 'effects', id: 'effectKey' },
  { kind: 'processes', api: 'processes', id: 'processKey' },
  { kind: 'internalStates', api: 'internal-states', id: 'stateKey' },
  { kind: 'triggerRules', api: 'trigger-rules', id: 'ruleKey' },
];
const skillKeys = candidate.order.slice();
const collectionRoutes = new Map();
for (const skillKey of skillKeys) for (const item of kinds) collectionRoutes.set(`/skills/${skillKey}/${item.api}`, { skillKey, ...item });

const candidateEntries = [];
for (const skillKey of skillKeys) {
  const skill = candidate.skills?.[skillKey];
  if (!skill || skill.skillKey !== skillKey) throw new Error(`候选技能缺失：${skillKey}`);
  for (const item of kinds) {
    const values = skill.write?.[item.kind];
    if (!Array.isArray(values)) throw new Error(`候选组成列表缺失：${skillKey}/${item.kind}`);
    const ids = values.map(value => value[item.id]);
    if (ids.some(value => typeof value !== 'string') || new Set(ids).size !== ids.length) throw new Error(`候选组成键缺失或重复：${skillKey}/${item.kind}`);
    for (const body of values) {
      const stableKey = body[item.id];
      candidateEntries.push({ skillKey, kind: item.kind, api: item.api, id: item.id, stableKey, route: `/skills/${skillKey}/${item.api}`, detailRoute: `/skills/${skillKey}/${item.api}/${encodeURIComponent(stableKey)}`, expectedBody: body, expected: '本次新增计划' });
    }
  }
}
if (candidateEntries.length !== 109) throw new Error(`候选新增详情应为109，实际${candidateEntries.length}`);
const countByKind = Object.fromEntries(kinds.map(item => [item.kind, candidateEntries.filter(entry => entry.kind === item.kind).length]));
if (JSON.stringify(countByKind) !== JSON.stringify({ parameters: 76, formulas: 23, effects: 10, processes: 0, internalStates: 0, triggerRules: 0 })) throw new Error(`候选组成计数不符：${JSON.stringify(countByKind)}`);

const baselineByRoute = new Map();
for (const request of baseline.requests ?? []) {
  if (baselineByRoute.has(request.route)) throw new Error(`保护快照路由重复：${request.route}`);
  baselineByRoute.set(request.route, request);
}
if (baseline.requests.length !== 95) throw new Error(`冻结保护GET应为95，实际${baseline.requests.length}`);
const reusedEntries = reuseList.map(item => {
  const detailRoute = `/skills/${item.skillKey}/parameters/${encodeURIComponent(item.parameterKey)}`;
  const request = baselineByRoute.get(detailRoute);
  if (!request || request.status !== 200) throw new Error(`公共复用详情不在保护快照：${detailRoute}`);
  return { skillKey: item.skillKey, kind: 'parameters', api: 'parameters', id: 'parameterKey', stableKey: item.parameterKey, route: `/skills/${item.skillKey}/parameters`, detailRoute, expectedBody: request.data, expected: '复用既有组成' };
});
if (reusedEntries.length !== 7 || new Set(reusedEntries.map(entry => entry.detailRoute)).size !== 7) throw new Error('公共参数复用详情应为7');
const allEntries = candidateEntries.concat(reusedEntries);
if (allEntries.length !== 116) throw new Error('当前详情总数应为116');
const planByKey = new Map();
if (plan.requestCount !== 109 || plan.requests.length !== 109) throw new Error('计划新增请求应为109');
for (const intent of plan.requests) {
  const item = kinds.find(value => value.kind === intent.kind);
  if (!item || intent.method !== 'POST' || intent.route !== `/skills/${intent.skillKey}/${item.api}` || intent.stableKey !== intent.body?.[item.id]) throw new Error(`计划范围或稳定键错误：${JSON.stringify(intent)}`);
  const key = `${intent.skillKey}|${intent.kind}|${intent.stableKey}`;
  if (planByKey.has(key)) throw new Error(`计划重复：${key}`);
  const candidateEntry = candidateEntries.find(entry => `${entry.skillKey}|${entry.kind}|${entry.stableKey}` === key);
  if (!candidateEntry || !equal(candidateEntry.expectedBody, intent.body)) throw new Error(`计划不匹配候选：${key}`);
  planByKey.set(key, intent);
}
if (planByKey.size !== 109 || plan.candidateNewParameterCount !== 76 || plan.currentParameterCountAfterSevenPublicReuse !== 83) throw new Error('计划计数或复用口径错误');
const baselineDetailRoutes = new Set(reusedEntries.map(entry => entry.detailRoute));
const newDetailRoutes = candidateEntries.map(entry => entry.detailRoute);
if (newDetailRoutes.some(route => baselineDetailRoutes.has(route))) throw new Error('新增详情与公共复用详情冲突');
const freshRoutes = [...new Set(baseline.requests.map(request => request.route).concat(newDetailRoutes))];
if (freshRoutes.length !== 204) throw new Error(`独立回读唯一GET应为204，实际${freshRoutes.length}`);

const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const runDir = path.join(here, '独立回读', runId);
fs.mkdirSync(runDir, { recursive: true });
const journalPath = path.join(runDir, '所有GET原始响应.jsonl');
const calls = [];
let sequence = 0;
const failures = [];

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
  if (typeof route !== 'string' || !route.startsWith('/') || route.includes('://') || route.includes('..') || route.includes('#')) throw new Error(`不安全接口路径：${route}`);
}

async function get(route) {
  safeRoute(route);
  const seq = ++sequence;
  appendJournal({ phase: 'BEFORE', seq, method: 'GET', route, at: new Date().toISOString() });
  let result;
  try {
    const response = await fetch(apiRoot + route, {
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.HERO25_API_TOKEN || 'local-entry'}`, Accept: 'application/json' },
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
  const execution = { generatedAt: new Date().toISOString(), mode: '写后独立全量GET', afterApply: true, status: 'STOPPED', complete: false, apiWrites: 0, noBusinessWrites: true, calls: calls.length, methods: { GET: calls.length }, statuses: calls.reduce((out, call) => { const key = String(call.status); out[key] = (out[key] || 0) + 1; return out; }, {}), error: String(error.stack || error), journalPath, frozen: { candidate: frozen.candidate, plan: frozen.plan, sourceValues: frozen.sourceValues, sourceManifest: frozen.sourceManifest } };
  writeJson(path.join(runDir, '执行结果.json'), execution, 'wx');
  console.log(JSON.stringify({ status: execution.status, complete: false, apiWrites: 0, calls: calls.length, output: runDir, error: execution.error }, null, 2));
  process.exitCode = 1;
  throw error;
}

function expectedCategory(route) {
  if (['/attributes', '/skill-categories', '/modifier-zones', '/damage-types'].includes(route)) return '目录';
  if (route.startsWith('/characters/')) return '角色';
  if (route.startsWith('/character-skill-relations?')) return '关系';
  if (route.includes('/representative-image')) return '图片';
  if (/^\/skills\/[^/]+$/.test(route)) return '主体';
  if (collectionRoutes.has(route)) return '六类列表';
  if (baselineDetailRoutes.has(route)) return '复用详情';
  return '其他';
}

function checkProtection() {
  const records = [];
  const protectionFailures = [];
  const counts = { catalogs: 0, characters: 0, relations: 0, subjects: 0, images: 0, componentLists: 0, reusedDetails: 0 };
  for (const expected of baseline.requests) {
    const actual = resultByRoute.get(expected.route);
    const record = { route: expected.route, category: expectedCategory(expected.route), expectedStatus: expected.status, actualStatus: actual?.status ?? null, passed: false };
    if (!actual || actual.status !== expected.status) { record.reason = '状态码变化'; protectionFailures.push(record); records.push(record); continue; }
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
      const planned = plan.requests.filter(intent => intent.route === expected.route);
      const oldKeys = oldRows?.map(row => row?.[collection.id]) ?? [];
      const actualKeys = actualRows?.map(row => row?.[collection.id]) ?? [];
      const allowed = new Set(oldKeys);
      for (const intent of planned) allowed.add(intent.stableKey);
      const oldDifferences = [];
      for (const row of oldRows ?? []) {
        const current = actualRows?.find(value => value?.[collection.id] === row[collection.id]);
        const difference = firstDiff(strip(row), strip(current));
        if (difference) oldDifferences.push({ stableKey: row[collection.id], difference });
      }
      const plannedDifferences = [];
      for (const intent of planned) {
        const current = actualRows?.find(value => value?.[collection.id] === intent.stableKey);
        const difference = listProjectedDiff(intent.body, current, collection.id);
        if (difference) plannedDifferences.push({ stableKey: intent.stableKey, difference });
      }
      record.oldCount = oldRows?.length ?? null;
      record.actualCount = actualRows?.length ?? null;
      record.plannedCount = planned.length;
      record.unexpected = actualKeys.filter(key => !allowed.has(key));
      record.missingOld = oldKeys.filter(key => !actualKeys.includes(key));
      record.duplicateKeys = actualKeys.filter((key, index) => actualKeys.indexOf(key) !== index);
      record.oldDifferences = oldDifferences;
      record.plannedDifferences = plannedDifferences;
      record.passed = Array.isArray(oldRows) && Array.isArray(actualRows) && new Set(oldKeys).size === oldKeys.length && new Set(actualKeys).size === actualKeys.length && record.unexpected.length === 0 && record.missingOld.length === 0 && record.duplicateKeys.length === 0 && oldDifferences.length === 0 && plannedDifferences.length === 0 && actualRows.length === allowed.size;
    }
    if (!record.passed) protectionFailures.push(record);
    records.push(record);
  }
  if (counts.catalogs !== 4 || counts.characters !== 2 || counts.relations !== 2 || counts.subjects !== 10 || counts.images !== 10 || counts.componentLists !== 60 || counts.reusedDetails !== 7) protectionFailures.push({ reason: '保护分组计数错误', counts });
  return { checked: records.length, passed: records.filter(record => record.passed).length, failures: protectionFailures, records, counts };
}

function checkDetails() {
  const records = [];
  const detailFailures = [];
  for (const entry of allEntries) {
    const actual = resultByRoute.get(entry.detailRoute);
    const record = { skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute, expected: entry.expected, expectedStatus: 200, actualStatus: actual?.status ?? null, passed: false };
    if (!actual || actual.status !== 200) { record.reason = '详情状态码不符'; detailFailures.push(record); }
    else {
      record.diff = firstDiff(strip(entry.expectedBody), strip(actual.data));
      record.passed = !record.diff;
      if (record.diff) detailFailures.push(record);
    }
    records.push(record);
  }
  return { checked: records.length, matched: records.filter(record => record.passed).length, plannedChecked: records.filter(record => record.expected === '本次新增计划').length, reusedChecked: records.filter(record => record.expected === '复用既有组成').length, failures: detailFailures, records };
}

const protection = checkProtection();
const details = checkDetails();
for (const failure of protection.failures) failures.push({ area: 'protection', ...failure });
for (const failure of details.failures) failures.push({ area: 'details', ...failure });

// 以下求值器只读取实际GET详情里的参数和公式；候选表达式仅用于确定应有的详情路由，不参与实际结果。
const actualParameterIndex = new Map();
const actualFormulaIndex = new Map();
const actualEffectIndex = new Map();
for (const entry of allEntries) {
  const actual = resultByRoute.get(entry.detailRoute)?.data;
  if (!actual) continue;
  if (entry.kind === 'parameters') actualParameterIndex.set(`${entry.skillKey}/${entry.stableKey}`, actual);
  if (entry.kind === 'formulas') actualFormulaIndex.set(`${entry.skillKey}/${entry.stableKey}`, actual);
  if (entry.kind === 'effects') actualEffectIndex.set(`${entry.skillKey}/${entry.stableKey}`, actual);
}

function valueNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`不是有限数值：${label}`);
  return value;
}

function context(skillKey, level, attributes = {}, runtime = {}) {
  return { skillKey, level, attributes, runtime, omitParameters: new Set(), omitAttributes: new Set() };
}

function copyContext(value) {
  return { skillKey: value.skillKey, level: value.level, attributes: value.attributes, runtime: value.runtime, omitParameters: new Set(value.omitParameters), omitAttributes: new Set(value.omitAttributes) };
}

function actualParameterValue(skillKey, parameterKey, ctxValue) {
  const fullKey = `${skillKey}/${parameterKey}`;
  if (ctxValue.omitParameters.has(fullKey)) throw new Error(`缺少参数输入 ${fullKey}`);
  const parameter = actualParameterIndex.get(fullKey);
  if (!parameter) throw new Error(`实际GET缺少参数 ${fullKey}`);
  if (parameter.valueMode === 'FIXED') return valueNumber(parameter.fixedValue, fullKey);
  if (parameter.valueMode === 'SKILL_LEVEL') {
    const levelKey = String(ctxValue.level);
    if (!Object.hasOwn(parameter.levelValues ?? {}, levelKey)) throw new Error(`缺少等级参数输入 ${fullKey}@${levelKey}`);
    return valueNumber(parameter.levelValues[levelKey], `${fullKey}@${levelKey}`);
  }
  if (parameter.valueMode === 'RUNTIME_INPUT') {
    const runtime = ctxValue.runtime?.[skillKey] ?? {};
    if (!Object.hasOwn(runtime, parameterKey)) throw new Error(`缺少运行输入 ${fullKey}`);
    return valueNumber(runtime[parameterKey], fullKey);
  }
  throw new Error(`未知参数模式 ${fullKey}/${parameter.valueMode}`);
}

function actualAttributeValue(node, ctxValue) {
  const key = `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`;
  if (ctxValue.omitAttributes.has(key)) throw new Error(`缺少属性输入 ${key}`);
  const value = ctxValue.attributes?.[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
  if (value === undefined) throw new Error(`缺少属性输入 ${key}`);
  return valueNumber(value, key);
}

function evaluateActual(node, ctxValue, skillKey) {
  if (!node || typeof node !== 'object') throw new Error('实际公式节点为空');
  if (node.nodeType === 'PARAMETER') return actualParameterValue(skillKey, node.parameterKey, ctxValue);
  if (node.nodeType === 'ATTRIBUTE') return actualAttributeValue(node, ctxValue);
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`实际公式不是二元运算：${skillKey}`);
  const left = evaluateActual(node.operands[0], ctxValue, skillKey);
  const right = evaluateActual(node.operands[1], ctxValue, skillKey);
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error(`实际公式运算未实现：${node.operation}`);
  }
}

function sourceValue(skillKey, sourceName, level) {
  const values = sourceValues.candidateSeries?.[`${skillKey}/${sourceName}`] ?? sourceValues.sourceSeries?.[`${skillKey}/${sourceName}`];
  if (!Array.isArray(values) || level < 1 || level > values.length) throw new Error(`独立源值缺少或越界：${skillKey}/${sourceName}@${level}`);
  return valueNumber(values[level - 1], `${skillKey}/${sourceName}@${level}`);
}

const attrsA = { SOURCE: { hp: { CURRENT: 1250, TOTAL: 3000, BONUS: 1750, MISSING: 1750 }, ability_power: { TOTAL: 50 }, attack_damage: { BONUS: 110, TOTAL: 160 } }, TARGET: { hp: { CURRENT: 200, TOTAL: 1000, BONUS: 0, MISSING: 800 } } };
const attrsB = { SOURCE: { hp: { CURRENT: 1777, TOTAL: 4200, BONUS: 2423, MISSING: 2423 }, ability_power: { TOTAL: 275 }, attack_damage: { BONUS: 325, TOTAL: 405 } }, TARGET: { hp: { CURRENT: 2200, TOTAL: 5000, BONUS: 0, MISSING: 2800 } } };
const formulaCases = {
  'drmundo_p/health_loss_amount': [
    { name: '当前生命1250', context: context('drmundo_p', 1, attrsA), expected: c => sourceValue('drmundo_p', 'CurrentHealthLoss', 1) * c.attributes.SOURCE.hp.CURRENT },
    { name: '当前生命1777', context: context('drmundo_p', 1, attrsB), expected: c => sourceValue('drmundo_p', 'CurrentHealthLoss', 1) * c.attributes.SOURCE.hp.CURRENT },
  ],
  'drmundo_p/max_health_gain_amount': [
    { name: '最大生命3000', context: context('drmundo_p', 1, attrsA), expected: c => sourceValue('drmundo_p', 'MaxHealthGain', 1) * c.attributes.SOURCE.hp.TOTAL },
    { name: '最大生命4200', context: context('drmundo_p', 1, attrsB), expected: c => sourceValue('drmundo_p', 'MaxHealthGain', 1) * c.attributes.SOURCE.hp.TOTAL },
  ],
  'drmundo_p/max_health_regen_amount': [
    { name: '等级外供比例004', context: context('drmundo_p', 1, attrsA, { drmundo_p: { max_health_regen_ratio: 0.004 } }), expected: c => 0.004 * c.attributes.SOURCE.hp.TOTAL },
    { name: '等级外供比例005', context: context('drmundo_p', 1, attrsB, { drmundo_p: { max_health_regen_ratio: 0.005 } }), expected: c => 0.005 * c.attributes.SOURCE.hp.TOTAL },
  ],
  'drmundo_q/magic_damage': [
    { name: '一级低于最低值', context: context('drmundo_q', 1, attrsA), expected: c => Math.max(sourceValue('drmundo_q', 'MinimumDamage', 1), sourceValue('drmundo_q', 'CurrentHealthDamage', 1) * c.attributes.TARGET.hp.CURRENT) },
    { name: '五级高于最低值', context: context('drmundo_q', 5, attrsB), expected: c => Math.max(sourceValue('drmundo_q', 'MinimumDamage', 5), sourceValue('drmundo_q', 'CurrentHealthDamage', 5) * c.attributes.TARGET.hp.CURRENT) },
  ],
  'drmundo_q/health_refund_on_champion_monster': [
    { name: '一级生命代价', context: context('drmundo_q', 1, attrsA), expected: () => sourceValue('drmundo_q', 'HealthRefundOnHitChampionMonsterPercent', 1) * sourceValue('drmundo_q', 'HealthCost', 1) },
    { name: '五级生命代价', context: context('drmundo_q', 5, attrsB), expected: () => sourceValue('drmundo_q', 'HealthRefundOnHitChampionMonsterPercent', 1) * sourceValue('drmundo_q', 'HealthCost', 5) },
  ],
  'drmundo_w/health_cost': [
    { name: '一级当前生命', context: context('drmundo_w', 1, attrsA), expected: c => sourceValue('drmundo_w', 'CurrentHealthCost', 1) * c.attributes.SOURCE.hp.CURRENT },
    { name: '五级当前生命', context: context('drmundo_w', 5, attrsB), expected: c => sourceValue('drmundo_w', 'CurrentHealthCost', 1) * c.attributes.SOURCE.hp.CURRENT },
  ],
  'drmundo_w/damage_per_second': [
    { name: '一级每秒显示倍率', context: context('drmundo_w', 1, attrsA), expected: c => sourceValue('drmundo_w', 'DamagePerTick', 1) * 4 },
    { name: '五级每秒显示倍率', context: context('drmundo_w', 5, attrsB), expected: c => sourceValue('drmundo_w', 'DamagePerTick', 5) * 4 },
  ],
  'drmundo_w/initial_gray_health_storage': [
    { name: '首段比例百分之80', context: context('drmundo_w', 1, attrsA, { drmundo_w: { gray_health_initial_storage_ratio: 0.8, initial_damage_taken: 100 } }), expected: c => 0.8 * c.runtime.drmundo_w.initial_damage_taken },
    { name: '首段比例百分之95', context: context('drmundo_w', 5, attrsB, { drmundo_w: { gray_health_initial_storage_ratio: 0.95, initial_damage_taken: 250 } }), expected: c => 0.95 * c.runtime.drmundo_w.initial_damage_taken },
  ],
  'drmundo_w/subsequent_gray_health_storage': [
    { name: '后续伤害200', context: context('drmundo_w', 1, attrsA, { drmundo_w: { subsequent_damage_taken: 200 } }), expected: c => sourceValue('drmundo_w', 'GrayHealthStorage', 1) * c.runtime.drmundo_w.subsequent_damage_taken },
    { name: '后续伤害500', context: context('drmundo_w', 5, attrsB, { drmundo_w: { subsequent_damage_taken: 500 } }), expected: c => sourceValue('drmundo_w', 'GrayHealthStorage', 1) * c.runtime.drmundo_w.subsequent_damage_taken },
  ],
  'drmundo_w/hero_gray_health_restore_amount': [
    { name: '英雄命中灰色生命300', context: context('drmundo_w', 1, attrsA, { drmundo_w: { stored_gray_health: 300 } }), expected: c => c.runtime.drmundo_w.stored_gray_health },
    { name: '英雄命中灰色生命640', context: context('drmundo_w', 5, attrsB, { drmundo_w: { stored_gray_health: 640 } }), expected: c => c.runtime.drmundo_w.stored_gray_health },
  ],
  'drmundo_w/nonhero_gray_health_restore_amount': [
    { name: '非英雄命中灰色生命300', context: context('drmundo_w', 1, attrsA, { drmundo_w: { stored_gray_health: 300 } }), expected: c => 0.5 * c.runtime.drmundo_w.stored_gray_health },
    { name: '非英雄命中灰色生命640', context: context('drmundo_w', 5, attrsB, { drmundo_w: { stored_gray_health: 640 } }), expected: c => 0.5 * c.runtime.drmundo_w.stored_gray_health },
  ],
  'drmundo_w/recast_magic_damage': [
    { name: '一级额外生命1750', context: context('drmundo_w', 1, attrsA), expected: c => 20 + 0.07 * c.attributes.SOURCE.hp.BONUS },
    { name: '五级额外生命2423', context: context('drmundo_w', 5, attrsB), expected: c => 80 + 0.07 * c.attributes.SOURCE.hp.BONUS },
  ],
  'drmundo_e/additional_physical_damage': [
    { name: '一级额外生命1750', context: context('drmundo_e', 1, attrsA), expected: c => 5 + 0.05 * c.attributes.SOURCE.hp.BONUS },
    { name: '五级额外生命2423', context: context('drmundo_e', 5, attrsB), expected: c => 45 + 0.05 * c.attributes.SOURCE.hp.BONUS },
  ],
  'drmundo_e/passive_bonus_attack_damage': [
    { name: '一级总生命3000', context: context('drmundo_e', 1, attrsA), expected: c => 0.01 * sourceValue('drmundo_e', 'HealthToADRatio', 1) * c.attributes.SOURCE.hp.TOTAL },
    { name: '五级总生命4200', context: context('drmundo_e', 5, attrsB), expected: c => 0.01 * sourceValue('drmundo_e', 'HealthToADRatio', 5) * c.attributes.SOURCE.hp.TOTAL },
  ],
  'drmundo_e/maximum_additional_damage_endpoint': [
    { name: '一级完整额外伤害乘一点四', context: context('drmundo_e', 1, attrsA), expected: c => (5 + 0.05 * c.attributes.SOURCE.hp.BONUS) * 1.4 },
    { name: '五级完整额外伤害乘一点四', context: context('drmundo_e', 5, attrsB), expected: c => (45 + 0.05 * c.attributes.SOURCE.hp.BONUS) * 1.4 },
  ],
  'drmundo_r/nearby_champion_effect_multiplier': [
    { name: '一级附近一名不增幅', context: context('drmundo_r', 1, attrsA, { drmundo_r: { nearby_enemy_champion_count: 1 } }), expected: () => 1 },
    { name: '三级附近一名增幅', context: context('drmundo_r', 3, attrsB, { drmundo_r: { nearby_enemy_champion_count: 1 } }), expected: () => 1.05 },
  ],
  'drmundo_r/missing_health_max_health_gain_amount': [
    { name: '一级实际已损失生命基准500', context: context('drmundo_r', 1, attrsA, { drmundo_r: { missing_health_gain_basis: 500, nearby_enemy_champion_count: 1 } }), expected: c => 0.15 * c.runtime.drmundo_r.missing_health_gain_basis },
    { name: '三级实际已损失生命基准1100且附近一名', context: context('drmundo_r', 3, attrsB, { drmundo_r: { missing_health_gain_basis: 1100, nearby_enemy_champion_count: 1 } }), expected: c => 0.25 * c.runtime.drmundo_r.missing_health_gain_basis * 1.05 },
  ],
  'drmundo_r/max_health_regeneration_amount': [
    { name: '一级实际最大生命基准3000', context: context('drmundo_r', 1, attrsA, { drmundo_r: { max_health_regeneration_basis: 3000, nearby_enemy_champion_count: 0 } }), expected: c => 0.2 * c.runtime.drmundo_r.max_health_regeneration_basis },
    { name: '三级实际最大生命基准4200且附近一名', context: context('drmundo_r', 3, attrsB, { drmundo_r: { max_health_regeneration_basis: 4200, nearby_enemy_champion_count: 1 } }), expected: c => 0.6 * c.runtime.drmundo_r.max_health_regeneration_basis * 1.05 },
  ],
  'tryndamere_p/crit_chance_from_fury': [
    { name: '零怒气', context: context('tryndamere_p', 1, attrsA, { tryndamere_p: { current_fury: 0 } }), expected: c => 0.005 * c.runtime.tryndamere_p.current_fury },
    { name: '八十怒气非满值', context: context('tryndamere_p', 1, attrsB, { tryndamere_p: { current_fury: 80 } }), expected: c => 0.005 * c.runtime.tryndamere_p.current_fury },
  ],
  'tryndamere_q/base_heal': [
    { name: '一级法强50', context: context('tryndamere_q', 1, attrsA, { tryndamere_q: { actual_fury_consumed: 0 } }), expected: c => sourceValue('tryndamere_q', 'BaseHealing', 1) + 0.3 * c.attributes.SOURCE.ability_power.TOTAL },
    { name: '五级法强275', context: context('tryndamere_q', 5, attrsB, { tryndamere_q: { actual_fury_consumed: 35 } }), expected: c => sourceValue('tryndamere_q', 'BaseHealing', 5) + 0.3 * c.attributes.SOURCE.ability_power.TOTAL },
  ],
  'tryndamere_q/heal_per_fury': [
    { name: '一级法强50', context: context('tryndamere_q', 1, attrsA, { tryndamere_q: { actual_fury_consumed: 0 } }), expected: c => sourceValue('tryndamere_q', 'BonusHealPerFury', 1) + 0.012 * c.attributes.SOURCE.ability_power.TOTAL },
    { name: '五级法强275', context: context('tryndamere_q', 5, attrsB, { tryndamere_q: { actual_fury_consumed: 35 } }), expected: c => sourceValue('tryndamere_q', 'BonusHealPerFury', 5) + 0.012 * c.attributes.SOURCE.ability_power.TOTAL },
  ],
  'tryndamere_q/active_heal_amount': [
    { name: '零实际怒气', context: context('tryndamere_q', 1, attrsA, { tryndamere_q: { actual_fury_consumed: 0 } }), expected: c => (sourceValue('tryndamere_q', 'BaseHealing', 1) + 0.3 * c.attributes.SOURCE.ability_power.TOTAL) + (sourceValue('tryndamere_q', 'BonusHealPerFury', 1) + 0.012 * c.attributes.SOURCE.ability_power.TOTAL) * c.runtime.tryndamere_q.actual_fury_consumed },
    { name: '三十五实际怒气', context: context('tryndamere_q', 5, attrsB, { tryndamere_q: { actual_fury_consumed: 35 } }), expected: c => (sourceValue('tryndamere_q', 'BaseHealing', 5) + 0.3 * c.attributes.SOURCE.ability_power.TOTAL) + (sourceValue('tryndamere_q', 'BonusHealPerFury', 5) + 0.012 * c.attributes.SOURCE.ability_power.TOTAL) * c.runtime.tryndamere_q.actual_fury_consumed },
  ],
  'tryndamere_e/physical_damage': [
    { name: '一级额外攻击力110法强50', context: context('tryndamere_e', 1, attrsA), expected: c => sourceValue('tryndamere_e', 'Damage', 1) + sourceValue('tryndamere_e', 'ADRatio', 1) * c.attributes.SOURCE.attack_damage.BONUS + sourceValue('tryndamere_e', 'APRatio', 1) * c.attributes.SOURCE.ability_power.TOTAL },
    { name: '五级额外攻击力325法强275', context: context('tryndamere_e', 5, attrsB), expected: c => sourceValue('tryndamere_e', 'Damage', 5) + sourceValue('tryndamere_e', 'ADRatio', 1) * c.attributes.SOURCE.attack_damage.BONUS + sourceValue('tryndamere_e', 'APRatio', 1) * c.attributes.SOURCE.ability_power.TOTAL },
  ],
};

function leafNodes(node, result = []) {
  if (node.nodeType === 'PARAMETER') result.push({ type: 'PARAMETER', key: node.parameterKey });
  else if (node.nodeType === 'ATTRIBUTE') result.push({ type: 'ATTRIBUTE', key: `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`, node });
  else if (node.nodeType === 'OPERATION') for (const child of node.operands ?? []) leafNodes(child, result);
  else throw new Error(`实际表达式节点未知：${node.nodeType}`);
  return result;
}

const formulaResults = [];
const rejectionResults = [];
const runtimeInputRejections = [];
const mathFailures = [];
const formulaEntries = allEntries.filter(entry => entry.kind === 'formulas');
if (formulaEntries.length !== 23 || actualFormulaIndex.size !== 23) mathFailures.push({ reason: '实际公式数量不为23', expected: 23, actual: actualFormulaIndex.size });
for (const entry of formulaEntries) {
  const key = `${entry.skillKey}/${entry.stableKey}`;
  const actualFormula = actualFormulaIndex.get(key);
  const examples = formulaCases[key];
  if (!actualFormula || !examples || examples.length !== 2) {
    mathFailures.push({ key, reason: '实际公式或两组算例缺失' });
    continue;
  }
  const evaluated = [];
  for (const example of examples) {
    try {
      const actual = evaluateActual(actualFormula.expression, example.context, entry.skillKey);
      const expected = valueNumber(example.expected(example.context), `${key}/${example.name}/expected`);
      const passed = Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected));
      evaluated.push({ name: example.name, level: example.context.level, expected, actual, passed });
      if (!passed) mathFailures.push({ key, name: example.name, reason: '实际表达式数值不符', expected, actual });
    } catch (error) {
      evaluated.push({ name: example.name, level: example.context.level, error: String(error.message || error), passed: false });
      mathFailures.push({ key, name: example.name, reason: '实际表达式求值失败', error: String(error.message || error) });
    }
  }
  formulaResults.push({ skillKey: entry.skillKey, formulaKey: entry.stableKey, actualExpressionSha256: sha256Value(actualFormula.expression), expressionSource: '实际GET详情响应', cases: evaluated });
  let leaves = [];
  try { leaves = leafNodes(actualFormula.expression); } catch (error) { mathFailures.push({ key, reason: '实际表达式叶节点扫描失败', error: String(error.message || error) }); }
  const firstLeaf = leaves[0];
  if (firstLeaf) {
    const missingContext = copyContext(examples[0].context);
    if (firstLeaf.type === 'PARAMETER') missingContext.omitParameters.add(`${entry.skillKey}/${firstLeaf.key}`);
    else missingContext.omitAttributes.add(firstLeaf.key);
    let rejected = false;
    let error = null;
    try { evaluateActual(actualFormula.expression, missingContext, entry.skillKey); } catch (caught) { rejected = true; error = String(caught.message || caught); }
    if (!rejected) mathFailures.push({ key, reason: '首个输入缺值未拒绝', removed: firstLeaf });
    rejectionResults.push({ skillKey: entry.skillKey, formulaKey: entry.stableKey, removed: firstLeaf, rejected, error });
    const runtimeKeys = [...new Set(leaves.filter(leaf => leaf.type === 'PARAMETER' && actualParameterIndex.get(`${entry.skillKey}/${leaf.key}`)?.valueMode === 'RUNTIME_INPUT').map(leaf => leaf.key))];
    for (const runtimeKey of runtimeKeys) {
      const runtimeContext = copyContext(examples[0].context);
      runtimeContext.omitParameters.add(`${entry.skillKey}/${runtimeKey}`);
      let runtimeRejected = false;
      let runtimeError = null;
      try { evaluateActual(actualFormula.expression, runtimeContext, entry.skillKey); } catch (caught) { runtimeRejected = true; runtimeError = String(caught.message || caught); }
      if (!runtimeRejected) mathFailures.push({ key, reason: '运行输入缺值未拒绝', parameterKey: runtimeKey });
      runtimeInputRejections.push({ skillKey: entry.skillKey, formulaKey: entry.stableKey, parameterKey: runtimeKey, rejected: runtimeRejected, error: runtimeError });
    }
  }
}

const boundaryResults = [];
function boundary(name, passed, detail) {
  boundaryResults.push({ name, passed, detail });
  if (!passed) mathFailures.push({ area: 'boundary', name, detail });
}
function actualFormulaValue(skillKey, formulaKey, level, attributes = {}, runtime = {}) {
  const actual = actualFormulaIndex.get(`${skillKey}/${formulaKey}`);
  if (!actual) throw new Error(`实际GET缺少公式 ${skillKey}/${formulaKey}`);
  return evaluateActual(actual.expression, context(skillKey, level, attributes, runtime), skillKey);
}
try {
  const eA = actualFormulaValue('drmundo_e', 'maximum_additional_damage_endpoint', 1, attrsA);
  const eB = actualFormulaValue('drmundo_e', 'maximum_additional_damage_endpoint', 5, attrsB);
  boundary('drmundo_e/一级完整额外伤害最高端点', Math.abs(eA - 129.5) <= 1e-9, `结果=${eA}`);
  boundary('drmundo_e/五级完整额外伤害最高端点', Math.abs(eB - 232.61) <= 1e-9, `结果=${eB}`);
  boundary('drmundo_e/70%阈值仅来源', !actualParameterIndex.has('drmundo_e/max_missing_health_threshold_ratio'), '实际详情不含阈值参数');
  const r1 = actualFormulaValue('drmundo_r', 'nearby_champion_effect_multiplier', 1, {}, { drmundo_r: { nearby_enemy_champion_count: 1 } });
  const r2 = actualFormulaValue('drmundo_r', 'nearby_champion_effect_multiplier', 2, {}, { drmundo_r: { nearby_enemy_champion_count: 1 } });
  const r0 = actualFormulaValue('drmundo_r', 'nearby_champion_effect_multiplier', 3, {}, { drmundo_r: { nearby_enemy_champion_count: 0 } });
  const rOne = actualFormulaValue('drmundo_r', 'nearby_champion_effect_multiplier', 3, {}, { drmundo_r: { nearby_enemy_champion_count: 1 } });
  const rOver = actualFormulaValue('drmundo_r', 'nearby_champion_effect_multiplier', 3, {}, { drmundo_r: { nearby_enemy_champion_count: 2 } });
  boundary('drmundo_r/一级附近一名不增幅', Math.abs(r1 - 1) <= 1e-9, `结果=${r1}`);
  boundary('drmundo_r/二级附近一名不增幅', Math.abs(r2 - 1) <= 1e-9, `结果=${r2}`);
  boundary('drmundo_r/三级附近数量0', Math.abs(r0 - 1) <= 1e-9, `结果=${r0}`);
  boundary('drmundo_r/三级附近数量1', Math.abs(rOne - 1.05) <= 1e-9, `结果=${rOne}`);
  boundary('drmundo_r/三级附近数量超过1封顶', Math.abs(rOver - 1.05) <= 1e-9, `结果=${rOver}`);
  const rGain = actualFormulaValue('drmundo_r', 'missing_health_max_health_gain_amount', 3, {}, { drmundo_r: { missing_health_gain_basis: 1100, nearby_enemy_champion_count: 1 } });
  const rRegen = actualFormulaValue('drmundo_r', 'max_health_regeneration_amount', 3, {}, { drmundo_r: { max_health_regeneration_basis: 4200, nearby_enemy_champion_count: 1 } });
  boundary('drmundo_r/两个阶段基准分别外供', Math.abs(rGain - 288.75) <= 1e-9 && Math.abs(rRegen - 2646) <= 1e-9, `获得最大生命=${rGain},持续恢复=${rRegen}`);
  boundary('drmundo_r/击杀延长仅来源', !actualParameterIndex.has('drmundo_r/takedown_duration_extension_ms'), '实际详情不含击杀延长参数');
  const thresholdSource = sourceValues.revisionEvidence.removedSourceOnly.find(item => item.skillKey === 'drmundo_e' && item.sourceName === 'MaxMissingHealthThreshold');
  const takedownSource = sourceValues.revisionEvidence.removedSourceOnly.find(item => item.skillKey === 'drmundo_r' && item.sourceName === 'TakedownDurationExtension');
  boundary('来源保留E阈值事实', Array.isArray(thresholdSource?.rawValues) && thresholdSource.rawValues.length > 1 && Math.abs(thresholdSource.rawValues[1] - 0.7) <= 1e-6, `来源=${JSON.stringify(thresholdSource?.rawValues)}`);
  boundary('来源保留R击杀延长事实', Array.isArray(takedownSource?.rawValues) && takedownSource.rawValues.length > 1 && Math.abs(takedownSource.rawValues[1] - 2) <= 1e-9, `来源=${JSON.stringify(takedownSource?.rawValues)}`);
} catch (error) {
  mathFailures.push({ area: 'boundary', reason: '实际边界求值失败', error: String(error.stack || error) });
}

const structural = { operationNodes: 0, operationArityFailures: [], parameterReferenceFailures: [], attributeFailures: [], integerTypeFailures: [], integerValueFailures: [], negativeTimeFailures: [], runtimeDefaultsFailures: [], duplicateParameterKeys: [], forbiddenResultTypes: [], momentRuntimeReferenceFailures: [] };
function scanActualExpression(node, skillKey, formulaKey) {
  if (!node || typeof node !== 'object') { structural.operationArityFailures.push(`${skillKey}/${formulaKey}/empty`); return; }
  if (node.nodeType === 'PARAMETER') { if (!actualParameterIndex.has(`${skillKey}/${node.parameterKey}`)) structural.parameterReferenceFailures.push(`${skillKey}/${formulaKey}/${node.parameterKey}`); return; }
  if (node.nodeType === 'ATTRIBUTE') { if (!['SOURCE', 'TARGET'].includes(node.attributeOwner)) structural.attributeFailures.push(`${skillKey}/${formulaKey}/owner`); if (!['BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO'].includes(node.attributeValueKind)) structural.attributeFailures.push(`${skillKey}/${formulaKey}/${node.attributeValueKind}`); return; }
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2 || !['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(node.operation)) { structural.operationArityFailures.push(`${skillKey}/${formulaKey}`); return; }
  structural.operationNodes += 1; scanActualExpression(node.operands[0], skillKey, formulaKey); scanActualExpression(node.operands[1], skillKey, formulaKey);
}
function expressionHasRuntime(node, skillKey) {
  if (!node || typeof node !== 'object') return false;
  if (node.nodeType === 'PARAMETER') return actualParameterIndex.get(`${skillKey}/${node.parameterKey}`)?.valueMode === 'RUNTIME_INPUT';
  return node.nodeType === 'OPERATION' && node.operands.some(child => expressionHasRuntime(child, skillKey));
}
for (const [key, actual] of actualFormulaIndex) scanActualExpression(actual.expression, key.split('/')[0], key.split('/').slice(1).join('/'));
for (const [key, parameter] of actualParameterIndex) {
  if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) structural.runtimeDefaultsFailures.push(key);
  const parameterKey = key.split('/').slice(1).join('/');
  const integerRequired = parameterKey.endsWith('_ms') || ['current_fury', 'actual_fury_consumed', 'nearby_enemy_champion_count', 'ticks_per_second', 'minimum_health', 'attack_fury_gain', 'critical_attack_fury_gain', 'kill_unit_fury_gain', 'fury_decay_per_second', 'champion_fury_gain', 'fury_gain'].includes(parameterKey);
  if (integerRequired && parameter.valueType !== 'INTEGER') structural.integerTypeFailures.push(key);
  if (integerRequired) {
    const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : [];
    if (values.some(value => !Number.isInteger(value))) structural.integerValueFailures.push(key);
    if (parameterKey.endsWith('_ms') && values.some(value => value < 0)) structural.negativeTimeFailures.push(key);
  }
}
for (const [key, effect] of actualEffectIndex) {
  for (const result of effect.results ?? []) {
    if (['DAMAGE', 'DIRECT_HEAL', 'MOMENT'].includes(result.resultType)) structural.forbiddenResultTypes.push(`${key}/${result.resultType}`);
    if (result.lifecycleBehavior?.moment === 'MOMENT_EVALUATION') {
      const value = result.valueRule?.value;
      if (value?.kind === 'PARAMETER' && actualParameterIndex.get(`${key.split('/')[0]}/${value.parameterKey}`)?.valueMode === 'RUNTIME_INPUT') structural.momentRuntimeReferenceFailures.push(`${key}/${value.parameterKey}`);
      if (value?.kind === 'FORMULA' && expressionHasRuntime(actualFormulaIndex.get(`${key.split('/')[0]}/${value.formulaKey}`)?.expression, key.split('/')[0])) structural.momentRuntimeReferenceFailures.push(`${key}/${value.formulaKey}`);
    }
  }
}
const tryndWSlow = actualEffectIndex.get('tryndamere_w/flee_slow');
boundary('tryndamere_w/移动速度属性口径', tryndWSlow?.results?.[0]?.detail?.attributeKey === 'move_speed_percent' && tryndWSlow?.results?.[0]?.detail?.modifierZoneKey === 'attribute_flat_add', '实际GET详情保留比例属性和attribute_flat_add载荷');
boundary('无MOMENT_EVALUATION运行输入间接引用', structural.momentRuntimeReferenceFailures.length === 0, `问题=${JSON.stringify(structural.momentRuntimeReferenceFailures)}`);
boundary('实际GET全字段细节数量', actualParameterIndex.size === 83 && actualFormulaIndex.size === 23 && actualEffectIndex.size === 10, `参数=${actualParameterIndex.size},公式=${actualFormulaIndex.size},效果=${actualEffectIndex.size}`);
if (Object.values(structural).some(value => Array.isArray(value) && value.length)) mathFailures.push({ area: 'structural', structural });

const categoryRoutes = {
  catalogs: ['/attributes', '/skill-categories', '/modifier-zones', '/damage-types'],
  characters: baseline.requests.filter(request => request.route.startsWith('/characters/')).map(request => request.route),
  relations: baseline.requests.filter(request => request.route.startsWith('/character-skill-relations?')).map(request => request.route),
  subjects: skillKeys.map(skillKey => `/skills/${skillKey}`),
  images: skillKeys.map(skillKey => `/skills/${skillKey}/representative-image`),
  componentLists: skillKeys.flatMap(skillKey => kinds.map(item => `/skills/${skillKey}/${item.api}`)),
};
const routeRecords = routes => routes.map(route => ({ route, status: resultByRoute.get(route)?.status ?? null, data: resultByRoute.get(route)?.data ?? null }));
const statusCounts = calls.reduce((out, call) => { const key = String(call.status); out[key] = (out[key] || 0) + 1; return out; }, {});
const actualMath = {
  source: '实际GET详情响应中的expression/parameter字段；没有读取候选表达式求值',
  formulas: formulaResults.length,
  formulaCases: formulaResults.reduce((total, item) => total + item.cases.length, 0),
  rejectionCases: rejectionResults.length,
  runtimeInputRejectionCases: runtimeInputRejections.length,
  boundaryCases: boundaryResults.length,
  failures: mathFailures,
  formulaResults,
  rejectionResults,
  runtimeInputRejections,
  boundaryResults,
  structural,
  passed: mathFailures.length === 0 && formulaResults.length === 23 && rejectionResults.length === 23,
};
const protectionPassed = protection.failures.length === 0 && protection.checked === 95 && protection.passed === 95;
const detailsPassed = details.failures.length === 0 && details.checked === 116 && details.matched === 116;
const allStatus200 = calls.length === 204 && calls.every(call => call.status === 200);
const report = {
  generatedAt: new Date().toISOString(),
  mode: '写后独立全量GET与实际表达式数学',
  afterApply: true,
  apiBase: apiRoot,
  apiWrites: 0,
  candidateSha256: sha256File(candidatePath),
  planSha256: sha256File(planPath),
  sourceValuesSha256: sha256File(sourceValuesPath),
  sourceManifestSha256: sha256File(sourceManifestPath),
  inputVersionSha256: sha256File(inputVersionPath),
  sourceBindingSha256: sha256File(sourceBindingPath),
  sourceNoteSha256: sha256File(sourceNotePath),
  protectionSnapshotSha256: sha256File(protectionPath),
  reuseSha256: sha256File(reusePath),
  sourceVersions: candidate.meta?.sourceVersion,
  expected: { catalogs: 4, characters: 2, relations: 2, subjects: 10, images: 10, componentLists: 60, protectedRoutes: 95, reusedDetails: 7, plannedNewDetails: 109, componentDetails: 116, uniqueFreshGET: 204, parameters: 83, formulas: 23, effects: 10 },
  actual: { calls: calls.length, uniqueFreshGET: new Set(calls.map(call => call.route)).size, methods: { GET: calls.length }, statuses: statusCounts, allStatus200, journalPath },
  protection: { checked: protection.checked, passed: protection.passed, failures: protection.failures, records: protection.records },
  targetDetails: { expected: 116, checked: details.checked, matched: details.matched, plannedChecked: details.plannedChecked, reusedChecked: details.reusedChecked, failures: details.failures, records: details.records },
  fullBusinessFields: { catalogs: routeRecords(categoryRoutes.catalogs), characters: routeRecords(categoryRoutes.characters), relations: routeRecords(categoryRoutes.relations), subjects: routeRecords(categoryRoutes.subjects), images: routeRecords(categoryRoutes.images), componentLists: routeRecords(categoryRoutes.componentLists), componentDetails: allEntries.map(entry => ({ skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute, expected: entry.expected, status: resultByRoute.get(entry.detailRoute)?.status ?? null, data: resultByRoute.get(entry.detailRoute)?.data ?? null })) },
  actualMath,
  rawResponses: calls,
  failures,
  status: allStatus200 && protectionPassed && detailsPassed && actualMath.passed ? 'PASS' : 'REVISE',
  complete: allStatus200 && protectionPassed && detailsPassed && actualMath.passed,
};
const reportPath = path.join(runDir, '独立全量回读.json');
report.noBusinessWrites = true;
writeJson(reportPath, report, 'wx');
writeJson(path.join(runDir, '执行结果.json'), { generatedAt: report.generatedAt, mode: report.mode, status: report.status, complete: report.complete, apiWrites: 0, noBusinessWrites: true, calls: report.actual.calls, methods: report.actual.methods, statuses: report.actual.statuses, protection: { checked: report.protection.checked, passed: report.protection.passed }, targetDetails: { checked: report.targetDetails.checked, matched: report.targetDetails.matched }, actualMath: { formulas: report.actualMath.formulas, formulaCases: report.actualMath.formulaCases, rejectionCases: report.actualMath.rejectionCases, runtimeInputRejectionCases: report.actualMath.runtimeInputRejectionCases, boundaryCases: report.actualMath.boundaryCases, passed: report.actualMath.passed }, reportPath, journalPath }, 'wx');
console.log(JSON.stringify({ status: report.status, complete: report.complete, apiWrites: 0, calls: report.actual.calls, methods: report.actual.methods, statuses: report.actual.statuses, protection: { checked: report.protection.checked, passed: report.protection.passed }, targetDetails: { checked: report.targetDetails.checked, matched: report.targetDetails.matched }, actualMath: { formulas: report.actualMath.formulas, formulaCases: report.actualMath.formulaCases, rejectionCases: report.actualMath.rejectionCases, runtimeInputRejectionCases: report.actualMath.runtimeInputRejectionCases, boundaryCases: report.actualMath.boundaryCases, passed: report.actualMath.passed }, output: runDir }, null, 2));
if (!report.complete) process.exitCode = 1;
