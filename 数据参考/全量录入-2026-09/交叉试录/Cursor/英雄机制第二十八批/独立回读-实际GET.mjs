import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const inputDir = path.join(here, '..', 'hero28-root-entry-20260909');
const apiRoot = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidatePath = path.join(here, '完整候选.json');
const planPath = path.join(here, '请求计划.json');
const versionPath = path.join(here, '候选版本.json');
const manifestPath = path.join(here, '来源哈希汇总.json');
const inputVersionPath = path.join(inputDir, '输入版本.json');
const sourceBindingPath = path.join(inputDir, '来源绑定与当前文本.json');
const protectionPath = path.join(inputDir, '参考资料', '当前10槽保护快照.json');
const reusePath = path.join(inputDir, '参考资料', '公共参数复用清单.json');
const lockPath = path.join(here, '实际写入锁.json');

const frozen = Object.freeze({
  candidate: 'a07d0fa895cfdd6babaeb6c711d5e5b86dbd5a05530933d6d571baeb70aa6c6d',
  plan: '955d4428ec9f0a3b7c6ce571660fff2a156e3b51a98ef799fc4e632d6f932c47',
  sourceRange: '85294c071b70f03f6d682a02999cd0d0fdd59cfbfff57c75f7a581ae8a19a07b',
  inputVersion: '3aa85899a88fdbe932dac837e4af765e36d3df3f9be0cb60a4fb6025a4cb06e4',
  sourceBinding: 'ca0a59262844bee277255af85af7dfdb391caa7306f04746c3ea16a97b208298',
  protection: 'dde9307d285b58959862140432bb113b298bb1405b0e41839bcdd0ddea2a9e5e',
  reuse: 'ebe9578ff2f50f266bb0dd5ff0b2c7cf37b550754b85d52399cc3067bb2b6d96',
});

if (process.argv.length !== 3 || process.argv[2] !== '--after-apply') {
  throw new Error('用法：node 独立回读-实际GET.mjs --after-apply');
}

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

const candidate = readJson(candidatePath);
const plan = readJson(planPath);
const version = readJson(versionPath);
const manifest = readJson(manifestPath);
const inputVersion = readJson(inputVersionPath);
const source = readJson(sourceBindingPath);
const baseline = readJson(protectionPath);
const reuseList = readJson(reusePath);
const lockedWrite = readJson(lockPath);
if (lockedWrite.status !== 'COMPLETED' || lockedWrite.apiWrites !== 84) {
  throw new Error(`业务写入尚未以84项成功完成，当前锁状态=${lockedWrite.status}，apiWrites=${lockedWrite.apiWrites}`);
}
if (!lockedWrite.reportPath || !fs.existsSync(lockedWrite.reportPath)) {
  throw new Error(`业务写入结果不存在：${lockedWrite.reportPath}`);
}
const writeResult = readJson(lockedWrite.reportPath);
if (writeResult.success !== true || writeResult.apiWrites !== 84 || writeResult.counts?.POST !== 84) {
  throw new Error(`业务写入结果未确认84项成功：${JSON.stringify({ success: writeResult.success, apiWrites: writeResult.apiWrites, counts: writeResult.counts })}`);
}

const frozenFiles = [
  ['candidate', candidatePath, frozen.candidate],
  ['plan', planPath, frozen.plan],
  ['sourceRange', path.join(here, '来源与范围.json'), frozen.sourceRange],
  ['inputVersion', inputVersionPath, frozen.inputVersion],
  ['sourceBinding', sourceBindingPath, frozen.sourceBinding],
  ['protection', protectionPath, frozen.protection],
  ['reuse', reusePath, frozen.reuse],
];
for (const [label, file, expected] of frozenFiles) {
  const actual = sha256File(file);
  if (actual !== expected) throw new Error(`冻结文件散列变化：${label}=${actual}，应为${expected}`);
}
if (version.candidateSha256 !== frozen.candidate || version.planSha256 !== frozen.plan || version.sourceRangeSha256 !== frozen.sourceRange) {
  throw new Error('候选版本记录与冻结散列不一致');
}
if (manifest.candidateSha256 !== frozen.candidate || manifest.planSha256 !== frozen.plan || manifest.sourceBindingSha256 !== frozen.sourceBinding) {
  throw new Error('来源哈希汇总与冻结散列不一致');
}
if (candidate.meta?.apiWrites !== 0 || plan.apiWrites !== 0 || inputVersion.apiWrites !== 0 || inputVersion.GETs !== 102) {
  throw new Error('冻结候选或输入版本含业务写入');
}
if (source.clientVersion !== '16.17' || source.officialVersion !== '16.17.1') {
  throw new Error(`来源版本不符：${source.clientVersion}/${source.officialVersion}`);
}
for (const sourceFile of inputVersion.sourceFiles ?? []) {
  const file = path.join(inputDir, sourceFile.path);
  if (sha256File(file) !== sourceFile.sha256) throw new Error(`来源文件散列变化：${sourceFile.path}`);
}

const kinds = [
  { kind: 'parameters', api: 'parameters', id: 'parameterKey' },
  { kind: 'formulas', api: 'formulas', id: 'formulaKey' },
  { kind: 'effects', api: 'effects', id: 'effectKey' },
  { kind: 'processes', api: 'processes', id: 'processKey' },
  { kind: 'internalStates', api: 'internal-states', id: 'stateKey' },
  { kind: 'triggerRules', api: 'trigger-rules', id: 'ruleKey' },
];
const skillKeys = [
  'maokai_p', 'maokai_q', 'maokai_w', 'maokai_e', 'maokai_r',
  'poppy_p', 'poppy_q', 'poppy_w', 'poppy_e', 'poppy_r',
];
if (JSON.stringify(Object.keys(candidate.skills ?? {})) !== JSON.stringify(skillKeys)) throw new Error('候选技能顺序或范围变化');

const collectionRoutes = new Map();
for (const skillKey of skillKeys) {
  for (const item of kinds) collectionRoutes.set(`/skills/${skillKey}/${item.api}`, { skillKey, ...item });
}
const baselineByRoute = new Map();
for (const request of baseline.requests ?? []) {
  if (baselineByRoute.has(request.route)) throw new Error(`保护快照路由重复：${request.route}`);
  baselineByRoute.set(request.route, request);
}
if (baseline.requests.length !== 102) throw new Error(`保护快照应为102项，实际${baseline.requests.length}`);

const candidateEntries = [];
for (const skillKey of skillKeys) {
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
      const detailRoute = `/skills/${skillKey}/${item.api}/${encodeURIComponent(stableKey)}`;
      candidateEntries.push({
        skillKey, kind: item.kind, api: item.api, id: item.id, stableKey,
        route: `/skills/${skillKey}/${item.api}`, detailRoute, candidateBody: body,
      });
    }
  }
}
if (candidateEntries.length !== 98) throw new Error(`当前组成详情应为98，实际${candidateEntries.length}`);
const currentByKind = Object.fromEntries(kinds.map(item => [item.kind, candidateEntries.filter(entry => entry.kind === item.kind).length]));
if (JSON.stringify(currentByKind) !== JSON.stringify({ parameters: 74, formulas: 17, effects: 7, processes: 0, internalStates: 0, triggerRules: 0 })) {
  throw new Error(`当前组成计数不符：${JSON.stringify(currentByKind)}`);
}

const reuseKeys = new Set();
for (const item of reuseList) {
  if (item.skillKey === undefined || item.parameterKey === undefined) throw new Error('公共复用项缺少稳定键');
  const detailRoute = `/skills/${item.skillKey}/parameters/${encodeURIComponent(item.parameterKey)}`;
  if (reuseKeys.has(detailRoute)) throw new Error(`公共复用项重复：${detailRoute}`);
  reuseKeys.add(detailRoute);
  const protectedDetail = baselineByRoute.get(detailRoute);
  if (!protectedDetail || protectedDetail.status !== 200) throw new Error(`公共复用详情不在保护快照：${detailRoute}`);
}
if (reuseKeys.size !== 14) throw new Error(`公共参数复用应为14，实际${reuseKeys.size}`);

const allEntries = candidateEntries.map(entry => {
  const protectedDetail = baselineByRoute.get(entry.detailRoute);
  const reused = reuseKeys.has(entry.detailRoute);
  if (reused && (!protectedDetail || protectedDetail.status !== 200)) throw new Error(`复用详情保护缺失：${entry.detailRoute}`);
  return {
    ...entry,
    expected: reused ? '复用既有组成' : '本次新增计划',
    expectedBody: reused ? protectedDetail.data : entry.candidateBody,
  };
});
const newEntries = allEntries.filter(entry => entry.expected === '本次新增计划');
if (newEntries.length !== 84) throw new Error(`新增详情应为84，实际${newEntries.length}`);

const planByKey = new Map();
if (plan.count !== 84 || !Array.isArray(plan.intents) || plan.intents.length !== 84) throw new Error('请求计划应为84项');
for (const intent of plan.intents) {
  const item = kinds.find(value => value.kind === intent.kind);
  if (!item || intent.method !== 'POST' || intent.route !== `/skills/${intent.skillKey}/${item.api}` || intent.stableKey !== intent.body?.[item.id]) {
    throw new Error(`计划范围或稳定键错误：${JSON.stringify(intent)}`);
  }
  const key = `${intent.skillKey}|${intent.kind}|${intent.stableKey}`;
  if (planByKey.has(key)) throw new Error(`计划重复：${key}`);
  const candidateEntry = newEntries.find(entry => `${entry.skillKey}|${entry.kind}|${entry.stableKey}` === key);
  if (!candidateEntry || !equal(candidateEntry.candidateBody, intent.body)) throw new Error(`计划不匹配新增候选：${key}`);
  planByKey.set(key, intent);
}
if (planByKey.size !== 84) throw new Error('计划新增项未覆盖84项');
const planByKind = Object.fromEntries(kinds.map(item => [item.kind, plan.intents.filter(intent => intent.kind === item.kind).length]));
if (JSON.stringify(planByKind) !== JSON.stringify({ parameters: 60, formulas: 17, effects: 7, processes: 0, internalStates: 0, triggerRules: 0 })) {
  throw new Error(`计划组成计数不符：${JSON.stringify(planByKind)}`);
}
const candidateReuseBodyMismatches = [];
for (const entry of allEntries.filter(value => value.expected === '复用既有组成')) {
  const difference = firstDiff(strip(entry.candidateBody), strip(entry.expectedBody));
  if (difference) candidateReuseBodyMismatches.push({ route: entry.detailRoute, difference });
}
if (candidateReuseBodyMismatches.length) throw new Error(`候选复用参数与保护详情不一致：${JSON.stringify(candidateReuseBodyMismatches)}`);

const baselineDetailRoutes = new Set([...reuseKeys]);
const freshRoutes = [...new Set(baseline.requests.map(request => request.route).concat(newEntries.map(entry => entry.detailRoute)))];
if (freshRoutes.length !== 186) throw new Error(`独立唯一GET应为186，实际${freshRoutes.length}`);

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
      headers: { Authorization: `Bearer ${process.env.HERO28_API_TOKEN || 'local-entry'}`, Accept: 'application/json' },
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
    generatedAt: new Date().toISOString(), mode: '写后独立全量GET', afterApply: true, status: 'STOPPED', complete: false,
    apiWrites: 0, noBusinessWrites: true, calls: calls.length, methods: { GET: calls.length },
    statuses: calls.reduce((out, call) => { const key = String(call.status); out[key] = (out[key] || 0) + 1; return out; }, {}),
    error: String(error.stack || error), journalPath, frozen,
  };
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
    const category = expectedCategory(expected.route);
    const record = { route: expected.route, category, expectedStatus: expected.status, actualStatus: actual?.status ?? null, passed: false };
    if (!actual || actual.status !== expected.status) {
      record.reason = '状态码变化';
      protectionFailures.push(record);
      records.push(record);
      continue;
    }
    if (category === '目录') counts.catalogs += 1;
    else if (category === '角色') counts.characters += 1;
    else if (category === '关系') counts.relations += 1;
    else if (category === '主体') counts.subjects += 1;
    else if (category === '图片') counts.images += 1;
    else if (category === '复用详情') counts.reusedDetails += 1;
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
      record.passed = Array.isArray(oldRows) && Array.isArray(actualRows) &&
        new Set(oldKeys).size === oldKeys.length && new Set(actualKeys).size === actualKeys.length &&
        record.unexpected.length === 0 && record.missingOld.length === 0 && record.duplicateKeys.length === 0 &&
        oldDifferences.length === 0 && plannedDifferences.length === 0 && actualRows.length === allowed.size;
    }
    if (!record.passed) protectionFailures.push(record);
    records.push(record);
  }
  if (counts.catalogs !== 4 || counts.characters !== 2 || counts.relations !== 2 || counts.subjects !== 10 || counts.images !== 10 || counts.componentLists !== 60 || counts.reusedDetails !== 14) {
    protectionFailures.push({ reason: '保护分组计数错误', counts });
  }
  return { checked: records.length, passed: records.filter(record => record.passed).length, failures: protectionFailures, records, counts };
}

function checkDetails() {
  const records = [];
  const detailFailures = [];
  for (const entry of allEntries) {
    const actual = resultByRoute.get(entry.detailRoute);
    const record = { skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute, expected: entry.expected, expectedStatus: 200, actualStatus: actual?.status ?? null, passed: false };
    if (!actual || actual.status !== 200) {
      record.reason = '详情状态码不符';
      detailFailures.push(record);
    } else {
      record.diff = firstDiff(strip(entry.expectedBody), strip(actual.data));
      record.passed = !record.diff;
      if (record.diff) detailFailures.push(record);
    }
    records.push(record);
  }
  return {
    checked: records.length,
    matched: records.filter(record => record.passed).length,
    plannedChecked: records.filter(record => record.expected === '本次新增计划').length,
    reusedChecked: records.filter(record => record.expected === '复用既有组成').length,
    failures: detailFailures,
    records,
  };
}

const protection = checkProtection();
const details = checkDetails();
for (const failure of protection.failures) failures.push({ area: 'protection', ...failure });
for (const failure of details.failures) failures.push({ area: 'details', ...failure });

// 公式求值器只读取实际详情 GET 的 expression/parameter 字段；候选表达式不参与数值求解。
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

function context(skillKey, level, attributes, runtime) {
  return { skillKey, level, attributes, runtime, omitParameters: new Set(), omitAttributes: new Set() };
}

function copyContext(value) {
  return {
    skillKey: value.skillKey,
    level: value.level,
    attributes: JSON.parse(JSON.stringify(value.attributes)),
    runtime: JSON.parse(JSON.stringify(value.runtime)),
    omitParameters: new Set(value.omitParameters),
    omitAttributes: new Set(value.omitAttributes),
  };
}

function actualParameterValue(skillKey, parameterKey, ctx) {
  const fullKey = `${skillKey}/${parameterKey}`;
  if (ctx.omitParameters.has(fullKey)) throw new Error(`缺少参数输入 ${fullKey}`);
  const parameter = actualParameterIndex.get(fullKey);
  if (!parameter) throw new Error(`实际GET缺少参数 ${fullKey}`);
  let value;
  if (parameter.valueMode === 'FIXED') value = parameter.fixedValue;
  else if (parameter.valueMode === 'SKILL_LEVEL') value = parameter.levelValues?.[String(ctx.level)];
  else if (parameter.valueMode === 'RUNTIME_INPUT') value = ctx.runtime?.[skillKey]?.[parameterKey];
  else throw new Error(`未知参数模式 ${fullKey}/${parameter.valueMode}`);
  if (value === undefined || value === null) throw new Error(`缺少参数值 ${fullKey}`);
  const number = valueNumber(Number(value), fullKey);
  if (parameter.valueType === 'INTEGER' && !Number.isInteger(number)) throw new Error(`整数参数含小数 ${fullKey}`);
  return number;
}

function actualAttributeValue(node, ctx) {
  const key = `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`;
  if (ctx.omitAttributes.has(key)) throw new Error(`缺少属性输入 ${key}`);
  if (!['SOURCE', 'TARGET'].includes(node.attributeOwner)) throw new Error(`属性所有者未知 ${key}`);
  if (!['BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO'].includes(node.attributeValueKind)) {
    throw new Error(`属性口径未知 ${key}`);
  }
  const value = ctx.attributes?.[node.attributeOwner]?.[node.attributeKey]?.[node.attributeValueKind];
  if (value === undefined || value === null) throw new Error(`缺少属性输入 ${key}`);
  return valueNumber(Number(value), key);
}

function evaluateActual(node, ctx, skillKey) {
  if (!node || typeof node !== 'object') throw new Error('实际公式节点为空');
  if (node.nodeType === 'PARAMETER') return actualParameterValue(skillKey, node.parameterKey, ctx);
  if (node.nodeType === 'ATTRIBUTE') return actualAttributeValue(node, ctx);
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2) {
    throw new Error(`实际公式不是二元运算：${skillKey}`);
  }
  const left = evaluateActual(node.operands[0], ctx, skillKey);
  const right = evaluateActual(node.operands[1], ctx, skillKey);
  switch (node.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE':
      if (right === 0) throw new Error('除数为零');
      return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error(`实际公式运算未实现：${node.operation}`);
  }
}

function sourceSkill(skillKey) {
  const heroId = skillKey.startsWith('maokai_') ? 'Maokai' : 'Poppy';
  const slot = skillKey.slice(-1).toUpperCase();
  const hero = source.heroes?.find(item => item.id === heroId);
  const bound = hero?.skills?.find(item => item.slot === slot);
  const summary = hero?.source?.skills?.find(item => item.slot === slot);
  if (!bound || !summary) throw new Error(`冻结来源技能缺失：${skillKey}`);
  return { hero, bound, summary, spell: bound.object.mSpell };
}

function maxLevel(skillKey) {
  const value = Number(sourceSkill(skillKey).summary.officialMaxRank);
  if (!Number.isInteger(value) || value < 1) throw new Error(`来源最大等级缺失：${skillKey}`);
  return value;
}

function sourceData(skillKey, dataName, rank) {
  const item = sourceSkill(skillKey).spell.DataValues?.find(value => value.name === dataName);
  if (!item || !Array.isArray(item.values)) throw new Error(`来源DataValues缺失：${skillKey}/${dataName}`);
  const value = item.values[rank];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`来源等级值缺失：${skillKey}/${dataName}@${rank}`);
  return value;
}

function sourceCalculation(skillKey, calculation) {
  const value = sourceSkill(skillKey).spell.mSpellCalculations?.[calculation];
  if (!value) throw new Error(`来源计算树缺失：${skillKey}/${calculation}`);
  return value;
}

function sourcePart(skillKey, calculation, index) {
  const parts = sourceCalculation(skillKey, calculation).mFormulaParts;
  if (!Array.isArray(parts) || !parts[index]) throw new Error(`来源计算树分段缺失：${skillKey}/${calculation}/${index}`);
  return parts[index];
}

function sourceCoefficient(skillKey, calculation, index = 1) {
  const value = Number(sourcePart(skillKey, calculation, index).mCoefficient);
  if (!Number.isFinite(value)) throw new Error(`来源系数缺失：${skillKey}/${calculation}/${index}`);
  return value;
}

function sourceSeries(skillKey, dataName, level = maxLevel(skillKey)) {
  return Array.from({ length: level }, (_, index) => sourceData(skillKey, dataName, index + 1));
}

const rawSourceEvidence = {
  dataValues: {
    'maokai_q/BaseDamage': sourceSeries('maokai_q', 'BaseDamage'),
    'maokai_q/APRatio': sourceSeries('maokai_q', 'APRatio'),
    'maokai_q/BasePercentHealth': sourceSeries('maokai_q', 'BasePercentHealth'),
    'maokai_w/BaseDamage': sourceSeries('maokai_w', 'BaseDamage'),
    'maokai_r/BaseDamage': sourceSeries('maokai_r', 'BaseDamage'),
    'poppy_q/BaseDamageValue': sourceSeries('poppy_q', 'BaseDamageValue'),
    'poppy_q/HealthDamagePercent': sourceSeries('poppy_q', 'HealthDamagePercent'),
    'poppy_q/BaseMoveSpeedMod': sourceSeries('poppy_q', 'BaseMoveSpeedMod'),
    'poppy_w/PassiveResistPercent': sourceSeries('poppy_w', 'PassiveResistPercent'),
    'poppy_w/DamageValue': sourceSeries('poppy_w', 'DamageValue'),
    'poppy_e/BaseDamageValue': sourceSeries('poppy_e', 'BaseDamageValue'),
    'poppy_r/BaseDamage': sourceSeries('poppy_r', 'BaseDamage'),
    'poppy_r/SnapCastDamageRatio': sourceSeries('poppy_r', 'SnapCastDamageRatio'),
  },
  coefficients: {
    'maokai_w/TotalDamage[1]': sourceCoefficient('maokai_w', 'TotalDamage'),
    'maokai_r/TotalDamage[1]': sourceCoefficient('maokai_r', 'TotalDamage'),
    'poppy_q/BaseDamage[1]': sourceCoefficient('poppy_q', 'BaseDamage'),
    'poppy_q/MoveSpeedMod[1]': sourceCoefficient('poppy_q', 'MoveSpeedMod'),
    'poppy_w/InterruptDamage[1]': sourceCoefficient('poppy_w', 'InterruptDamage'),
    'poppy_e/TackleDamage[1]': sourceCoefficient('poppy_e', 'TackleDamage'),
    'poppy_r/Damage[1]': sourceCoefficient('poppy_r', 'Damage'),
  },
  sourceVersion: { client: source.clientVersion, official: source.officialVersion },
};

function scenario(high) {
  const attributes = {
    SOURCE: {
      hp: { TOTAL: high ? 5200 : 3500, BONUS: high ? 1800 : 700 },
      ability_power: { TOTAL: high ? 315 : 173 },
      attack_damage: { BONUS: high ? 130 : 75 },
    },
    TARGET: { hp: { TOTAL: high ? 4100 : 2600 } },
  };
  return {
    id: high ? 'B-高等级与高属性' : 'A-一级与基础属性',
    attributes,
    runtime: {
      maokai_p: { actual_passive_heal_ratio: high ? 0.08 : 0.04 },
      poppy_p: { actual_shield_ratio_by_character_level: high ? 0.2 : 0.11 },
      poppy_w: {
        actual_source_armor_before_passive: high ? 250 : 100,
        actual_source_magic_resistance_before_passive: high ? 180 : 80,
      },
    },
    level: high ? 5 : 1,
  };
}

function scenarioFor(skillKey, high) {
  const item = scenario(high);
  item.skillKey = skillKey;
  item.level = Math.min(item.level, maxLevel(skillKey));
  item.omitParameters = new Set();
  item.omitAttributes = new Set();
  return item;
}

function sourceExpected(skillKey, formulaKey, ctx) {
  const rank = ctx.level;
  const ap = ctx.attributes.SOURCE.ability_power.TOTAL;
  const bonusAd = ctx.attributes.SOURCE.attack_damage.BONUS;
  const sourceHp = ctx.attributes.SOURCE.hp.TOTAL;
  const sourceBonusHp = ctx.attributes.SOURCE.hp.BONUS;
  const targetHp = ctx.attributes.TARGET.hp.TOTAL;
  switch (`${skillKey}/${formulaKey}`) {
    case 'maokai_p/healing_total':
      return ctx.runtime.maokai_p.actual_passive_heal_ratio * sourceHp;
    case 'maokai_q/magic_damage':
      return sourceData('maokai_q', 'BaseDamage', rank) + sourceData('maokai_q', 'APRatio', rank) * ap + sourceData('maokai_q', 'BasePercentHealth', rank) * targetHp;
    case 'maokai_w/magic_damage':
      return sourceData('maokai_w', 'BaseDamage', rank) + sourceCoefficient('maokai_w', 'TotalDamage') * ap;
    case 'maokai_r/magic_damage':
      return sourceData('maokai_r', 'BaseDamage', rank) + sourceCoefficient('maokai_r', 'TotalDamage') * ap;
    case 'poppy_p/shield_value':
      return ctx.runtime.poppy_p.actual_shield_ratio_by_character_level * sourceHp;
    case 'poppy_q/physical_damage_per_hit':
      return sourceData('poppy_q', 'BaseDamageValue', rank) + sourceCoefficient('poppy_q', 'BaseDamage') * bonusAd + sourceData('poppy_q', 'HealthDamagePercent', rank) / 100 * targetHp;
    case 'poppy_q/physical_damage_same_target_total':
      return 2 * (sourceData('poppy_q', 'BaseDamageValue', rank) + sourceCoefficient('poppy_q', 'BaseDamage') * bonusAd + sourceData('poppy_q', 'HealthDamagePercent', rank) / 100 * targetHp);
    case 'poppy_q/slow_ratio':
      return sourceData('poppy_q', 'BaseMoveSpeedMod', rank) + sourceCoefficient('poppy_q', 'MoveSpeedMod') * sourceBonusHp;
    case 'poppy_w/passive_bonus_armor':
      return sourceData('poppy_w', 'PassiveResistPercent', rank) * ctx.runtime.poppy_w.actual_source_armor_before_passive;
    case 'poppy_w/passive_bonus_armor_low_health':
      return sourceData('poppy_w', 'PassiveResistPercent', rank) * 2 * ctx.runtime.poppy_w.actual_source_armor_before_passive;
    case 'poppy_w/passive_bonus_magic_resistance':
      return sourceData('poppy_w', 'PassiveResistPercent', rank) * ctx.runtime.poppy_w.actual_source_magic_resistance_before_passive;
    case 'poppy_w/passive_bonus_magic_resistance_low_health':
      return sourceData('poppy_w', 'PassiveResistPercent', rank) * 2 * ctx.runtime.poppy_w.actual_source_magic_resistance_before_passive;
    case 'poppy_w/interrupt_magic_damage':
      return sourceData('poppy_w', 'DamageValue', rank) + sourceCoefficient('poppy_w', 'InterruptDamage') * ap;
    case 'poppy_e/tackle_physical_damage':
      return sourceData('poppy_e', 'BaseDamageValue', rank) + sourceCoefficient('poppy_e', 'TackleDamage') * bonusAd;
    case 'poppy_e/wall_collision_total_physical_damage':
      return 2 * (sourceData('poppy_e', 'BaseDamageValue', rank) + sourceCoefficient('poppy_e', 'TackleDamage') * bonusAd);
    case 'poppy_r/full_physical_damage':
      return sourceData('poppy_r', 'BaseDamage', rank) + sourceCoefficient('poppy_r', 'Damage') * bonusAd;
    case 'poppy_r/snap_physical_damage':
      return sourceData('poppy_r', 'SnapCastDamageRatio', rank) * (sourceData('poppy_r', 'BaseDamage', rank) + sourceCoefficient('poppy_r', 'Damage') * bonusAd);
    default: throw new Error(`没有冻结来源独立期望：${skillKey}/${formulaKey}`);
  }
}

function leafDependencies(node, result = []) {
  if (!node || typeof node !== 'object') throw new Error('实际表达式节点为空');
  if (node.nodeType === 'PARAMETER') result.push({ type: 'PARAMETER', key: node.parameterKey });
  else if (node.nodeType === 'ATTRIBUTE') result.push({ type: 'ATTRIBUTE', key: `${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`, node });
  else if (node.nodeType === 'OPERATION') {
    for (const child of node.operands ?? []) leafDependencies(child, result);
  } else throw new Error(`实际表达式节点未知：${node.nodeType}`);
  return [...new Map(result.map(item => [`${item.type}/${item.key}`, item])).values()];
}

const formulaResults = [];
const rejectionResults = [];
const runtimeInputRejections = [];
const runtimeParameterChecks = [];
const mathFailures = [];
const formulaEntries = allEntries.filter(entry => entry.kind === 'formulas');
if (formulaEntries.length !== 17 || actualFormulaIndex.size !== 17) mathFailures.push({ reason: '实际公式数量不为17', actual: actualFormulaIndex.size });
for (const entry of formulaEntries) {
  const key = `${entry.skillKey}/${entry.stableKey}`;
  const actualFormula = actualFormulaIndex.get(key);
  if (!actualFormula?.expression) {
    mathFailures.push({ key, reason: '实际GET详情缺少expression' });
    continue;
  }
  const cases = [scenarioFor(entry.skillKey, false), scenarioFor(entry.skillKey, true)];
  const caseResults = [];
  for (const testCase of cases) {
    try {
      const actual = evaluateActual(actualFormula.expression, testCase, entry.skillKey);
      const expected = sourceExpected(entry.skillKey, entry.stableKey, testCase);
      const tolerance = 1e-6 * Math.max(1, Math.abs(actual), Math.abs(expected));
      const passed = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
      const record = { caseId: testCase.id, level: testCase.level, expected, actual, tolerance, passed };
      caseResults.push(record);
      if (!passed) mathFailures.push({ key, reason: '实际表达式数值不符', ...record });
    } catch (error) {
      const record = { caseId: testCase.id, level: testCase.level, passed: false, error: String(error.message || error) };
      caseResults.push(record);
      mathFailures.push({ key, reason: '实际表达式求值失败', ...record });
    }
  }
  formulaResults.push({
    skillKey: entry.skillKey,
    formulaKey: entry.stableKey,
    expressionSource: '实际GET详情响应',
    actualExpressionSha256: sha256Value(actualFormula.expression),
    actualExpression: actualFormula.expression,
    cases: caseResults,
  });
  let dependencies = [];
  try { dependencies = leafDependencies(actualFormula.expression); } catch (error) {
    mathFailures.push({ key, reason: '依赖扫描失败', error: String(error.message || error) });
  }
  const baseCase = cases[0];
  for (const dependency of dependencies) {
    const missing = copyContext(baseCase);
    if (dependency.type === 'PARAMETER') missing.omitParameters.add(`${entry.skillKey}/${dependency.key}`);
    else missing.omitAttributes.add(dependency.key);
    let rejected = false;
    let error = null;
    try { evaluateActual(actualFormula.expression, missing, entry.skillKey); } catch (caught) { rejected = true; error = String(caught.message || caught); }
    const item = { skillKey: entry.skillKey, formulaKey: entry.stableKey, dependency, rejected, error };
    rejectionResults.push(item);
    if (!rejected) mathFailures.push({ ...item, reason: '缺值未拒绝' });
  }
}

const runtimeUsed = new Set();
for (const [key, formula] of actualFormulaIndex) {
  const skillKey = key.split('/')[0];
  for (const dependency of leafDependencies(formula.expression)) {
    if (dependency.type !== 'PARAMETER') continue;
    const parameter = actualParameterIndex.get(`${skillKey}/${dependency.key}`);
    if (parameter?.valueMode === 'RUNTIME_INPUT') runtimeUsed.add(`${skillKey}/${dependency.key}`);
  }
}
for (const fullKey of runtimeUsed) {
  const [skillKey, ...rest] = fullKey.split('/');
  const parameterKey = rest.join('/');
  const missing = scenarioFor(skillKey, false);
  missing.omitParameters.add(fullKey);
  let rejected = false;
  let error = null;
  try { actualParameterValue(skillKey, parameterKey, missing); } catch (caught) { rejected = true; error = String(caught.message || caught); }
  runtimeInputRejections.push({ skillKey, parameterKey, rejected, error });
  if (!rejected) mathFailures.push({ reason: '公式使用的运行输入缺值未拒绝', skillKey, parameterKey });
}
for (const [fullKey, parameter] of actualParameterIndex) {
  if (parameter.valueMode !== 'RUNTIME_INPUT') continue;
  const [skillKey, ...rest] = fullKey.split('/');
  const parameterKey = rest.join('/');
  const missing = scenarioFor(skillKey, false);
  missing.omitParameters.add(fullKey);
  let rejectedMissing = false;
  let missingError = null;
  try { actualParameterValue(skillKey, parameterKey, missing); } catch (caught) { rejectedMissing = true; missingError = String(caught.message || caught); }
  const item = { skillKey, parameterKey, valueType: parameter.valueType, rejectedMissing, missingError };
  if (parameter.valueType === 'INTEGER') {
    const fractional = scenarioFor(skillKey, false);
    fractional.runtime[skillKey] ??= {};
    fractional.runtime[skillKey][parameterKey] = 0.5;
    let rejectedFractional = false;
    let fractionalError = null;
    try { actualParameterValue(skillKey, parameterKey, fractional); } catch (caught) { rejectedFractional = true; fractionalError = String(caught.message || caught); }
    item.rejectedFractional = rejectedFractional;
    item.fractionalError = fractionalError;
    if (!rejectedFractional) mathFailures.push({ reason: '整数运行输入未拒绝小数', skillKey, parameterKey });
  }
  runtimeParameterChecks.push(item);
  if (!rejectedMissing) mathFailures.push({ reason: '运行输入缺值未拒绝', skillKey, parameterKey });
}

function actualFormulaValue(skillKey, formulaKey, high, mutate = undefined) {
  const formula = actualFormulaIndex.get(`${skillKey}/${formulaKey}`);
  if (!formula?.expression) throw new Error(`实际GET缺少公式 ${skillKey}/${formulaKey}`);
  const ctx = scenarioFor(skillKey, high);
  if (mutate) mutate(ctx);
  return evaluateActual(formula.expression, ctx, skillKey);
}

const boundaryResults = [];
function boundary(name, actual, expected, detail = {}) {
  const tolerance = 1e-6 * Math.max(1, Math.abs(actual), Math.abs(expected));
  const passed = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  const record = { name, actual, expected, tolerance, passed, ...detail };
  boundaryResults.push(record);
  if (!passed) mathFailures.push({ area: 'boundary', ...record });
}
for (const high of [false, true]) {
  const perHit = actualFormulaValue('poppy_q', 'physical_damage_per_hit', high);
  const total = actualFormulaValue('poppy_q', 'physical_damage_same_target_total', high);
  boundary(`波比Q同一目标两次总量/${high ? '高等级' : '一级'}`, total, perHit * 2, { perHit, hitCount: actualParameterIndex.get('poppy_q/hit_count_same_target')?.fixedValue });
  const armor = actualFormulaValue('poppy_w', 'passive_bonus_armor', high);
  const armorLow = actualFormulaValue('poppy_w', 'passive_bonus_armor_low_health', high);
  boundary(`波比W低生命护甲端点/${high ? '高等级' : '一级'}`, armorLow, armor * 2, { armor, threshold: actualParameterIndex.get('poppy_w/passive_low_health_threshold_ratio')?.fixedValue });
  const mr = actualFormulaValue('poppy_w', 'passive_bonus_magic_resistance', high);
  const mrLow = actualFormulaValue('poppy_w', 'passive_bonus_magic_resistance_low_health', high);
  boundary(`波比W低生命魔抗端点/${high ? '高等级' : '一级'}`, mrLow, mr * 2, { mr });
  const full = actualFormulaValue('poppy_r', 'full_physical_damage', high);
  const snap = actualFormulaValue('poppy_r', 'snap_physical_damage', high);
  boundary(`波比R未蓄力半伤/${high ? '高等级' : '一级'}`, snap, full * 0.5, { full, ratio: actualParameterIndex.get('poppy_r/snap_cast_damage_ratio')?.fixedValue });
  const tackle = actualFormulaValue('poppy_e', 'tackle_physical_damage', high);
  const wall = actualFormulaValue('poppy_e', 'wall_collision_total_physical_damage', high);
  boundary(`波比E撞墙同目标两次/${high ? '高等级' : '一级'}`, wall, tackle * 2, { tackle, hitCount: actualParameterIndex.get('poppy_e/wall_hit_count')?.fixedValue });
}
const slowLow = actualFormulaValue('poppy_q', 'slow_ratio', false, ctx => { ctx.attributes.SOURCE.hp.BONUS = 700; });
const slowHigh = actualFormulaValue('poppy_q', 'slow_ratio', false, ctx => { ctx.attributes.SOURCE.hp.BONUS = 1800; });
boundary('波比Q额外生命输入改变减速', slowHigh - slowLow, sourceCoefficient('poppy_q', 'MoveSpeedMod') * (1800 - 700), { slowLow, slowHigh });
const maokaiQLow = actualFormulaValue('maokai_q', 'magic_damage', false);
const maokaiQHigh = actualFormulaValue('maokai_q', 'magic_damage', true);
boundary('茂凯Q目标最大生命与等级端点变化', maokaiQHigh - maokaiQLow, sourceExpected('maokai_q', 'magic_damage', scenarioFor('maokai_q', true)) - sourceExpected('maokai_q', 'magic_damage', scenarioFor('maokai_q', false)), { maokaiQLow, maokaiQHigh });
boundary('波比Q同目标延迟为1000毫秒', actualParameterIndex.get('poppy_q/delay_between_hits_ms')?.fixedValue, 1000);
boundary('波比Q同目标次数为2', actualParameterIndex.get('poppy_q/hit_count_same_target')?.fixedValue, 2);
boundary('波比E撞墙次数为2', actualParameterIndex.get('poppy_e/wall_hit_count')?.fixedValue, 2);
boundary('波比W低生命阈值为0.4', actualParameterIndex.get('poppy_w/passive_low_health_threshold_ratio')?.fixedValue, 0.4);
boundary('波比W低生命倍数为2', actualParameterIndex.get('poppy_w/passive_low_health_multiplier')?.fixedValue, 2);

const structural = {
  operationNodes: 0,
  operationArityFailures: [],
  parameterReferenceFailures: [],
  attributeFailures: [],
  integerTypeFailures: [],
  integerValueFailures: [],
  negativeTimeFailures: [],
  runtimeDefaultsFailures: [],
  duplicateParameterKeys: [],
  forbiddenResultTypes: [],
  effectResultTypeFailures: [],
  momentRuntimeReferenceFailures: [],
};
function scanActualExpression(node, skillKey, formulaKey) {
  if (!node || typeof node !== 'object') { structural.operationArityFailures.push(`${skillKey}/${formulaKey}/empty`); return; }
  if (node.nodeType === 'PARAMETER') {
    if (!actualParameterIndex.has(`${skillKey}/${node.parameterKey}`)) structural.parameterReferenceFailures.push(`${skillKey}/${formulaKey}/${node.parameterKey}`);
    return;
  }
  if (node.nodeType === 'ATTRIBUTE') {
    if (!['SOURCE', 'TARGET'].includes(node.attributeOwner) || !['BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO'].includes(node.attributeValueKind)) {
      structural.attributeFailures.push(`${skillKey}/${formulaKey}/${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}`);
    }
    return;
  }
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2 || !['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX'].includes(node.operation)) {
    structural.operationArityFailures.push(`${skillKey}/${formulaKey}`);
    return;
  }
  structural.operationNodes += 1;
  scanActualExpression(node.operands[0], skillKey, formulaKey);
  scanActualExpression(node.operands[1], skillKey, formulaKey);
}
function expressionHasRuntime(node, skillKey) {
  if (!node || typeof node !== 'object') return false;
  if (node.nodeType === 'PARAMETER') return actualParameterIndex.get(`${skillKey}/${node.parameterKey}`)?.valueMode === 'RUNTIME_INPUT';
  return node.nodeType === 'OPERATION' && (node.operands ?? []).some(child => expressionHasRuntime(child, skillKey));
}
for (const [key, formula] of actualFormulaIndex) {
  const separator = key.indexOf('/');
  scanActualExpression(formula.expression, key.slice(0, separator), key.slice(separator + 1));
}
for (const [fullKey, parameter] of actualParameterIndex) {
  const separator = fullKey.indexOf('/');
  const parameterKey = fullKey.slice(separator + 1);
  if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) structural.runtimeDefaultsFailures.push(fullKey);
  const integerRequired = parameterKey.endsWith('_ms') || ['hit_count_same_target', 'wall_hit_count'].includes(parameterKey);
  if (integerRequired && parameter.valueType !== 'INTEGER') structural.integerTypeFailures.push(fullKey);
  if (integerRequired) {
    const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : [];
    if (values.some(value => !Number.isInteger(Number(value)))) structural.integerValueFailures.push(fullKey);
    if (parameterKey.endsWith('_ms') && values.some(value => Number(value) < 0)) structural.negativeTimeFailures.push(fullKey);
  }
}
for (const [fullKey, effect] of actualEffectIndex) {
  const skillKey = fullKey.slice(0, fullKey.indexOf('/'));
  for (const result of effect.results ?? []) {
    if (['DAMAGE', 'DIRECT_HEAL', 'MOMENT'].includes(result.resultType)) structural.forbiddenResultTypes.push(`${fullKey}/${result.resultType}`);
    if (result.resultType !== 'RESOURCE_CHANGE') structural.effectResultTypeFailures.push(`${fullKey}/${result.resultKey}/${result.resultType}`);
    if (result.lifecycleBehavior?.moment === 'MOMENT_EVALUATION') {
      const value = result.valueRule?.value;
      if (value?.kind === 'PARAMETER' && actualParameterIndex.get(`${skillKey}/${value.parameterKey}`)?.valueMode === 'RUNTIME_INPUT') structural.momentRuntimeReferenceFailures.push(`${fullKey}/${value.parameterKey}`);
      if (value?.kind === 'FORMULA' && expressionHasRuntime(actualFormulaIndex.get(`${skillKey}/${value.formulaKey}`)?.expression, skillKey)) structural.momentRuntimeReferenceFailures.push(`${fullKey}/${value.formulaKey}`);
    }
  }
}
if (Object.values(structural).some(value => Array.isArray(value) && value.length)) mathFailures.push({ area: 'structural', structural });

const statusCounts = calls.reduce((out, call) => { const key = String(call.status); out[key] = (out[key] || 0) + 1; return out; }, {});
const actualMath = {
  source: '实际GET详情响应中的expression/parameter字段；来源期望独立读取冻结客户端16.17绑定的原始DataValues与计算树系数，不读取候选表达式求值。',
  formulas: formulaResults.length,
  formulaCases: formulaResults.reduce((total, item) => total + item.cases.length, 0),
  rejectionCases: rejectionResults.length,
  rejectedMissingValues: rejectionResults.filter(item => item.rejected).length,
  runtimeInputRejectionCases: runtimeInputRejections.length,
  runtimeInputRejected: runtimeInputRejections.filter(item => item.rejected).length,
  runtimeParameterChecks: runtimeParameterChecks.length,
  runtimeMissingRejected: runtimeParameterChecks.filter(item => item.rejectedMissing).length,
  boundaryCases: boundaryResults.length,
  boundaryPassed: boundaryResults.filter(item => item.passed).length,
  failures: mathFailures,
  rawSourceEvidence,
  formulaResults,
  rejectionResults,
  runtimeInputRejections,
  runtimeParameterChecks,
  boundaryResults,
  structural,
  passed: mathFailures.length === 0 && formulaResults.length === 17 && formulaResults.every(item => item.cases.length === 2) && rejectionResults.every(item => item.rejected),
};
const protectionPassed = protection.failures.length === 0 && protection.checked === 102 && protection.passed === 102;
const detailsPassed = details.failures.length === 0 && details.checked === 98 && details.matched === 98;
const allStatus200 = calls.length === 186 && new Set(calls.map(call => call.route)).size === 186 && calls.every(call => call.status === 200);
const categoryRoutes = {
  catalogs: ['/attributes', '/skill-categories', '/modifier-zones', '/damage-types'],
  characters: baseline.requests.filter(request => request.route.startsWith('/characters/')).map(request => request.route),
  relations: baseline.requests.filter(request => request.route.startsWith('/character-skill-relations?')).map(request => request.route),
  subjects: skillKeys.map(skillKey => `/skills/${skillKey}`),
  images: skillKeys.map(skillKey => `/skills/${skillKey}/representative-image`),
  componentLists: skillKeys.flatMap(skillKey => kinds.map(item => `/skills/${skillKey}/${item.api}`)),
};
const routeRecords = routes => routes.map(route => ({ route, status: resultByRoute.get(route)?.status ?? null, data: resultByRoute.get(route)?.data ?? null }));
const report = {
  generatedAt: new Date().toISOString(),
  mode: '写后独立全量GET与实际表达式数学',
  afterApply: true,
  apiBase: apiRoot,
  apiWrites: 0,
  noBusinessWrites: true,
  frozen,
  candidateSha256: sha256File(candidatePath),
  planSha256: sha256File(planPath),
  versionSha256: sha256File(versionPath),
  manifestSha256: sha256File(manifestPath),
  inputVersionSha256: sha256File(inputVersionPath),
  sourceBindingSha256: sha256File(sourceBindingPath),
  protectionSnapshotSha256: sha256File(protectionPath),
  reuseSha256: sha256File(reusePath),
  writeResultPath: lockedWrite.reportPath,
  writeResult: { success: writeResult.success, apiWrites: writeResult.apiWrites, calls: writeResult.calls?.length, finishedAt: writeResult.finishedAt },
  expected: {
    catalogs: 4, characters: 2, relations: 2, subjects: 10, images: 10, componentLists: 60,
    protectedRoutes: 102, reusedDetails: 14, plannedNewDetails: 84, componentDetails: 98, uniqueFreshGET: 186,
    currentByKind, newByKind: planByKind,
  },
  actual: { calls: calls.length, uniqueFreshGET: new Set(calls.map(call => call.route)).size, methods: { GET: calls.length }, statuses: statusCounts, allStatus200, journalPath },
  protection: { checked: protection.checked, passed: protection.passed, failures: protection.failures, counts: protection.counts, records: protection.records },
  targetDetails: { expected: 98, checked: details.checked, matched: details.matched, plannedChecked: details.plannedChecked, reusedChecked: details.reusedChecked, failures: details.failures, records: details.records },
  fullBusinessFields: {
    catalogs: routeRecords(categoryRoutes.catalogs),
    characters: routeRecords(categoryRoutes.characters),
    relations: routeRecords(categoryRoutes.relations),
    subjects: routeRecords(categoryRoutes.subjects),
    images: routeRecords(categoryRoutes.images),
    componentLists: routeRecords(categoryRoutes.componentLists),
    componentDetails: allEntries.map(entry => ({ skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute, expected: entry.expected, status: resultByRoute.get(entry.detailRoute)?.status ?? null, data: resultByRoute.get(entry.detailRoute)?.data ?? null })),
  },
  actualMath,
  rawResponses: calls,
  failures,
  status: allStatus200 && protectionPassed && detailsPassed && actualMath.passed ? 'PASS' : 'REVISE',
  complete: allStatus200 && protectionPassed && detailsPassed && actualMath.passed,
};
writeJson(path.join(runDir, '独立全量回读.json'), report, 'wx');
writeJson(path.join(runDir, '执行结果.json'), {
  generatedAt: report.generatedAt, mode: report.mode, status: report.status, complete: report.complete,
  apiWrites: 0, noBusinessWrites: true, calls: report.actual.calls, methods: report.actual.methods, statuses: report.actual.statuses,
  protection: { checked: report.protection.checked, passed: report.protection.passed },
  targetDetails: { checked: report.targetDetails.checked, matched: report.targetDetails.matched },
  actualMath: {
    formulas: report.actualMath.formulas, formulaCases: report.actualMath.formulaCases, rejectionCases: report.actualMath.rejectionCases,
    rejectedMissingValues: report.actualMath.rejectedMissingValues, runtimeInputRejectionCases: report.actualMath.runtimeInputRejectionCases,
    runtimeInputRejected: report.actualMath.runtimeInputRejected, boundaryCases: report.actualMath.boundaryCases, boundaryPassed: report.actualMath.boundaryPassed,
    passed: report.actualMath.passed,
  },
  reportPath: path.join(runDir, '独立全量回读.json'), journalPath,
}, 'wx');
console.log(JSON.stringify({
  status: report.status, complete: report.complete, apiWrites: 0, calls: report.actual.calls, methods: report.actual.methods, statuses: report.actual.statuses,
  protection: { checked: report.protection.checked, passed: report.protection.passed, counts: report.protection.counts },
  targetDetails: { checked: report.targetDetails.checked, matched: report.targetDetails.matched },
  actualMath: { formulas: report.actualMath.formulas, formulaCases: report.actualMath.formulaCases, rejectionCases: report.actualMath.rejectionCases, rejectedMissingValues: report.actualMath.rejectedMissingValues, runtimeInputRejectionCases: report.actualMath.runtimeInputRejectionCases, boundaryCases: report.actualMath.boundaryCases, boundaryPassed: report.actualMath.boundaryPassed, passed: report.actualMath.passed },
  output: runDir,
}, null, 2));
if (!report.complete) process.exitCode = 1;
