import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLANNING_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const DATA_ROOT = path.join(PLANNING_ROOT, '数据参考', '全量录入-2026-09');
const API_ROOT = process.env.DV_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol';
const API_TOKEN = process.env.GEAR18_API_TOKEN || 'local-entry';
const CANDIDATE_PATH = path.join(HERE, '最终候选.json');
const REQUEST_PATH = path.join(HERE, '最终请求.json');
const SOURCE_PATH = path.join(HERE, '冻结来源.json');
const BEFORE_PATH = path.join(HERE, '写前现值.json');
const HASH_PATH = path.join(HERE, '冻结哈希.json');
const LOCK_PATH = path.join(HERE, '最终写入完成.lock.json');
const RESULT_PATH = path.join(HERE, '实际录入结果.json');
const NUMERIC_PATH = path.join(HERE, '独立实值核算.json');
const EXPERIENCE_PATH = path.join(HERE, '体验报告.md');
const EXPECTED_CANDIDATE_SHA = '4863b2119fd7f154d188d207f4b6e465d3719146f35dd1cc2bfb047e4b294a2b';
const EXPECTED_REQUEST_SHA = '6f2aa8e960114cd8f3068ff2d3bda96a840aa242c32e5f635b2529bc6cd4891c';
const EXPECTED_SOURCE_SHA = '98d14396062ef2189cf364faf863f4d2ee62481dff9dacbaf4641fa9663c0492';
const EXPECTED_BEFORE_SHA = 'd21a71991758032112009478a123761e1d0628fb660c59f2c26d13ba2c947250';
const EXPECTED_ORIGINAL_CANDIDATE_SHA = '03214a9b07e56fecf40f1731853aa4a543d90d185ca4c604b5c06174d115108c';
const ORIGINAL_CANDIDATE_PATH = path.join(HERE, '完整候选.json');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw new Error('只允许默认只读预检或显式 --apply');
const APPLY = args.includes('--apply');

const expectedEquipmentKeys = [
  'item_3036', 'item_3179', 'item_3302', 'item_3742', 'item_4005',
  'item_4645', 'item_6631', 'item_6662', 'item_6694', 'item_6697'
];
const componentKinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules']
];
const totalsExpected = {
  equipment: 10, skills: 10, parameters: 52, formulas: 8, effects: 0,
  processes: 0, internalStates: 0, triggerRules: 0, relations: 10,
  representativeImages: 10
};

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const bytesOf = file => fs.readFileSync(file);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha256 = file => sha256(bytesOf(file));
const same = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

function normalize(value, key = '') {
  if (Array.isArray(value)) {
    const values = value.map(item => normalize(item));
    return key === 'skillCategoryKeys' ? values.sort() : values;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v, k)]));
  }
  return value;
}

function differences(expected, actual, currentPath = '', rows = []) {
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    rows.push({ path: currentPath, expected, actual, equal: Object.is(expected, actual) });
    return rows;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      rows.push({ path: currentPath, expected, actual, equal: false });
      return rows;
    }
    rows.push({ path: `${currentPath}.length`, expected: expected.length, actual: actual.length, equal: expected.length === actual.length });
    for (let i = 0; i < Math.max(expected.length, actual.length); i += 1) differences(expected[i], actual[i], `${currentPath}[${i}]`, rows);
    return rows;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    differences(expected[key], actual[key], currentPath ? `${currentPath}.${key}` : key, rows);
  }
  return rows;
}

function stripServerFields(value, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = { ...value };
  for (const key of ['gameId', 'createdAt', 'updatedAt']) delete result[key];
  if (kind !== 'skill' && kind !== 'relation') delete result.skillKey;
  return result;
}

function listItems(response, route) {
  if (!response.ok) throw new Error(`${route} HTTP ${response.status}`);
  const items = Array.isArray(response.data) ? response.data : response.data?.items;
  if (!Array.isArray(items)) throw new Error(`列表结构不符：${route}`);
  if (response.data?.total != null && Number(response.data.total) !== items.length) throw new Error(`列表未完整读取：${route}`);
  return items;
}

function relationExpected(object) {
  return {
    ...object.apiPayload.relation,
    equipmentName: object.equipmentName,
    skillName: object.apiPayload.skill.name,
    skillStatus: object.apiPayload.skill.status
  };
}

function imageCore(data) {
  const image = data && Object.hasOwn(data, 'image') ? data.image : data;
  if (!image || typeof image !== 'object') return null;
  return { imageKey: image.imageKey, enabled: image.enabled };
}

function expectedBody(object, request) {
  if (request.kind === 'skill') return object.apiPayload.skill;
  if (request.kind === 'parameters') return object.apiPayload.parameters.find(item => item.parameterKey === request.body.parameterKey);
  if (request.kind === 'formulas') return object.apiPayload.formulas.find(item => item.formulaKey === request.body.formulaKey);
  if (request.kind === 'relation') return object.apiPayload.relation;
  if (request.kind === 'image') return object.apiPayload.representativeImage;
  return undefined;
}

function readRouteFor(object, request) {
  const skillPath = `/skills/${encodeURIComponent(object.skillKey)}`;
  if (request.kind === 'skill') return skillPath;
  if (request.kind === 'parameters') return `${skillPath}/parameters/${encodeURIComponent(request.body.parameterKey)}`;
  if (request.kind === 'formulas') return `${skillPath}/formulas/${encodeURIComponent(request.body.formulaKey)}`;
  if (request.kind === 'effects') return `${skillPath}/effects/${encodeURIComponent(request.body.effectKey)}`;
  if (request.kind === 'processes') return `${skillPath}/processes/${encodeURIComponent(request.body.processKey)}`;
  if (request.kind === 'internalStates') return `${skillPath}/internal-states/${encodeURIComponent(request.body.stateKey)}`;
  if (request.kind === 'triggerRules') return `${skillPath}/trigger-rules/${encodeURIComponent(request.body.ruleKey)}`;
  if (request.kind === 'relation') return `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`;
  if (request.kind === 'image') return `${skillPath}/representative-image`;
  throw new Error(`未知请求种类：${request.kind}`);
}

function createRequests(candidate) {
  const requests = [];
  for (const object of candidate.objects) {
    const skillPath = `/skills/${encodeURIComponent(object.skillKey)}`;
    requests.push({ kind: 'skill', equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'POST', route: '/skills', readRoute: skillPath, body: object.apiPayload.skill });
    for (const [kind, idField, api] of componentKinds) {
      for (const body of object.apiPayload[kind] ?? []) {
        const id = body[idField];
        requests.push({ kind, equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'POST', route: `${skillPath}/${api}`, readRoute: `${skillPath}/${api}/${encodeURIComponent(id)}`, body });
      }
    }
    requests.push({ kind: 'relation', equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'POST', route: '/equipment-skill-relations', readRoute: `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`, body: object.apiPayload.relation });
    requests.push({ kind: 'image', equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'PUT', route: `${skillPath}/representative-image`, readRoute: `${skillPath}/representative-image`, body: object.apiPayload.representativeImage });
  }
  return requests;
}

function compareRequestRecord(object, request, response) {
  if (request.kind === 'relation') {
    if (!response.ok) return { state: response.status === 404 ? 'missing' : 'conflict', fields: [], error: `GET HTTP ${response.status}` };
    let items;
    try { items = listItems(response, request.readRoute); } catch (error) { return { state: 'conflict', fields: [], error: String(error) }; }
    if (items.some(item => item.equipmentKey !== object.equipmentKey || item.skillKey !== object.skillKey)) return { state: 'conflict', fields: [], error: '关系存在当前批次外项' };
    const actual = items.find(item => item.skillKey === object.skillKey);
    if (!actual) return { state: 'missing', fields: [] };
    const expected = relationExpected(object);
    const fields = differences(normalize(expected), normalize(stripServerFields(actual, 'relation')));
    return { state: fields.every(field => field.equal) ? 'same' : 'conflict', fields };
  }
  if (request.kind === 'image') {
    if (!response.ok) return { state: response.status === 404 ? 'missing' : 'conflict', fields: [], error: `GET HTTP ${response.status}` };
    const actual = imageCore(response.data);
    const expected = { imageKey: object.apiPayload.representativeImage.imageKey, enabled: true };
    if (!actual) return { state: 'missing', fields: [] };
    const fields = differences(normalize(expected), normalize(actual));
    return { state: fields.every(field => field.equal) ? 'same' : 'conflict', fields };
  }
  if (response.status === 404) return { state: 'missing', fields: [] };
  if (!response.ok) return { state: 'conflict', fields: [], error: `GET HTTP ${response.status}` };
  const expected = expectedBody(object, request);
  const actual = stripServerFields(response.data, request.kind === 'skill' ? 'skill' : request.kind);
  const fields = differences(normalize(expected), normalize(actual));
  return { state: fields.every(field => field.equal) ? 'same' : 'conflict', fields };
}

function sourcePath(record) {
  return path.resolve(DATA_ROOT, record.relativePath);
}

function verifySourceFiles(source) {
  return (source.sourceFiles ?? []).map(record => {
    const file = sourcePath(record);
    const exists = fs.existsSync(file);
    const compressedSha256 = exists ? fileSha256(file) : null;
    const raw = exists && (record.format || '').toLowerCase().includes('gzip') ? zlib.gunzipSync(bytesOf(file)) : null;
    const row = {
      key: record.key,
      path: file,
      exists,
      declaredSha256: record.sha256,
      actualSha256: compressedSha256,
      rawSha256: raw ? sha256(raw) : null,
      pass: exists && compressedSha256 === record.sha256
    };
    if (!row.pass) throw new Error(`来源散列不符：${record.relativePath}`);
    return row;
  });
}

function businessDiffAgainstOriginal(candidate) {
  if (!fs.existsSync(ORIGINAL_CANDIDATE_PATH)) throw new Error('缺少原始完整候选，无法证明最终修订边界');
  const originalBytes = bytesOf(ORIGINAL_CANDIDATE_PATH);
  if (sha256(originalBytes) !== EXPECTED_ORIGINAL_CANDIDATE_SHA) throw new Error('原始完整候选散列变化，停止');
  const original = JSON.parse(originalBytes);
  const differencesFound = [];
  const finalByKey = new Map(candidate.objects.map(object => [object.equipmentKey, object]));
  for (const oldObject of original.objects) {
    const newObject = finalByKey.get(oldObject.equipmentKey);
    if (!newObject) throw new Error(`最终候选缺少原始装备：${oldObject.equipmentKey}`);
    const rows = differences(normalize(oldObject.apiPayload), normalize(newObject.apiPayload));
    differencesFound.push(...rows.filter(row => !row.equal).map(row => ({ equipmentKey: oldObject.equipmentKey, ...row })));
  }
  const allowed = new Set([
    'item_3036.parameters[2].valueType',
    'item_3036.parameters[2].description',
    'item_3302.parameters[2].description'
  ]);
  const unexpected = differencesFound.filter(row => !allowed.has(`${row.equipmentKey}.${row.path}`));
  if (unexpected.length) throw new Error(`最终候选出现未授权业务差异：${JSON.stringify(unexpected.slice(0, 5))}`);
  return { originalSha256: EXPECTED_ORIGINAL_CANDIDATE_SHA, differences: differencesFound, allowedDifferences: [...allowed] };
}

function staticValidate(candidate, request, source, before) {
  const checks = [];
  const candidateSha256 = fileSha256(CANDIDATE_PATH);
  const requestSha256 = fileSha256(REQUEST_PATH);
  const sourceSha256 = fileSha256(SOURCE_PATH);
  const beforeSha256 = fileSha256(BEFORE_PATH);
  assert.equal(candidateSha256, EXPECTED_CANDIDATE_SHA, '最终候选散列不符，停止');
  assert.equal(requestSha256, EXPECTED_REQUEST_SHA, '最终请求散列不符，停止');
  assert.equal(sourceSha256, EXPECTED_SOURCE_SHA, '冻结来源散列不符，停止');
  assert.equal(beforeSha256, EXPECTED_BEFORE_SHA, '写前现值散列不符，停止');
  assert.deepEqual(candidate.objects.map(item => item.equipmentKey).sort(), [...expectedEquipmentKeys].sort(), '候选装备范围不符');
  assert.deepEqual(candidate.objects.map(item => item.equipmentKey), expectedEquipmentKeys, '候选对象顺序不符');
  for (const [key, value] of Object.entries(totalsExpected)) assert.equal(candidate.totals?.[key], value, `候选总计不符：${key}`);
  for (const object of candidate.objects) {
    assert.equal(object.apiPayload.skill.skillKey, object.skillKey, `${object.equipmentKey}技能键不符`);
    assert.equal(object.apiPayload.relation.equipmentKey, object.equipmentKey, `${object.equipmentKey}关系装备键不符`);
    assert.equal(object.apiPayload.relation.skillKey, object.skillKey, `${object.equipmentKey}关系技能键不符`);
    assert.equal(object.apiPayload.representativeImage.imageKey, object.equipmentKey, `${object.equipmentKey}图片键不符`);
  }
  const expectedRequests = createRequests(candidate);
  assert.equal(request.requests.length, 90, '最终请求不是90项');
  assert.equal(expectedRequests.length, 90, '由候选生成的请求不是90项');
  const requestDifferences = [];
  for (let i = 0; i < expectedRequests.length; i += 1) {
    const expected = expectedRequests[i];
    const actual = request.requests[i];
    const keys = ['kind', 'equipmentKey', 'skillKey', 'method', 'route', 'readRoute', 'body'];
    for (const key of keys) if (!same(expected[key], actual?.[key])) requestDifferences.push({ index: i, key, expected: expected[key], actual: actual?.[key] });
  }
  assert.equal(requestDifferences.length, 0, `最终请求与候选不一致：${JSON.stringify(requestDifferences.slice(0, 3))}`);
  const target3036 = candidate.objects.find(object => object.equipmentKey === 'item_3036');
  const targetParameter = target3036.apiPayload.parameters.find(parameter => parameter.parameterKey === 'actual_target_bonus_health');
  assert.equal(targetParameter.valueType, 'DECIMAL', '3036实际目标额外生命必须是DECIMAL');
  assert.equal(targetParameter.valueMode, 'RUNTIME_INPUT', '3036实际目标额外生命必须是运行时输入');
  assert.equal(targetParameter.fixedValue, null, '3036动态输入不得写固定值');
  assert.equal(targetParameter.levelValues, null, '3036动态输入不得写等级表');
  const originalDiff = businessDiffAgainstOriginal(candidate);
  checks.push({ name: '最终候选哈希', pass: true, values: { candidateSha256, requestSha256, sourceSha256, beforeSha256 } });
  checks.push({ name: '候选总计与对象范围', pass: true, totals: candidate.totals, equipmentKeys: expectedEquipmentKeys });
  checks.push({ name: '90项请求顺序与请求体', pass: true, requestCount: request.requests.length, order: '各装备技能主体→参数/公式→关系→代表图' });
  checks.push({ name: '最终修订业务差异', pass: true, ...originalDiff });
  checks.push({ name: '3036小数运行时输入', pass: true, valueType: targetParameter.valueType, exampleInput: 1234.5, fixedValue: targetParameter.fixedValue, levelValues: targetParameter.levelValues });
  checks.push({ name: '3302法强系数说明', pass: true, parameterDescription: candidate.objects.find(object => object.equipmentKey === 'item_3302').apiPayload.parameters.find(parameter => parameter.parameterKey === 'ability_power_ratio').description });
  return { candidateSha256, requestSha256, sourceSha256, beforeSha256, checks, expectedRequests, sourceChecks: verifySourceFiles(source) };
}

async function apiGet(route) { return apiRequest(route); }

async function apiRequest(route, { method = 'GET', body } = {}) {
  const options = {
    method,
    headers: { Authorization: `Bearer ${API_TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000)
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(API_ROOT + route, options);
    const raw = await response.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch (error) { return { route, method, status: response.status, ok: response.ok, data: null, error: `非JSON响应：${String(error)}` }; }
    }
    return { route, method, status: response.status, ok: response.ok, data };
  } catch (error) {
    return { route, method, status: null, ok: false, data: null, error: String(error) };
  }
}

function expectedCoreData(beforeObject, route) {
  const record = beforeObject.records.find(item => item.route === route);
  if (!record) throw new Error(`写前现值缺少 ${route}`);
  return record.data;
}

function compareCore(route, expected, response) {
  if (!response.ok) return { match: false, fields: [{ path: 'HTTP', expected: 200, actual: response.status, equal: false }] };
  const expectedCore = stripServerFields(expected, 'equipment');
  const actualCore = stripServerFields(response.data, 'equipment');
  const fields = differences(normalize(expectedCore), normalize(actualCore));
  return { match: fields.every(field => field.equal), fields };
}

async function readCoreProtection(object, beforeObject, phase, log) {
  const routes = [`/equipment/${object.equipmentKey}`, `/equipment/${object.equipmentKey}/attributes`, `/equipment/${object.equipmentKey}/representative-image`];
  const row = { phase, equipmentKey: object.equipmentKey, routes: [], relation: null };
  for (const route of routes) {
    const response = await apiGet(route);
    log.push({ phase, kind: 'protection', equipmentKey: object.equipmentKey, route, response });
    const comparison = compareCore(route, expectedCoreData(beforeObject, route), response);
    row.routes.push({ route, response, comparison });
    if (!comparison.match) throw new Error(`原装备、属性或代表图现值变化：${route}`);
  }
  const relationRoute = `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`;
  const relationResponse = await apiGet(relationRoute);
  log.push({ phase, kind: 'protection-relation', equipmentKey: object.equipmentKey, route: relationRoute, response: relationResponse });
  const items = listItems(relationResponse, relationRoute);
  row.relation = { route: relationRoute, response: relationResponse, items, empty: items.length === 0 };
  if (items.length !== 0) throw new Error(`写入前装备关系不是空集：${object.equipmentKey}`);
  return row;
}

async function readSubject(object, phase, log) {
  const request = { kind: 'skill', equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'POST', route: '/skills', readRoute: `/skills/${encodeURIComponent(object.skillKey)}`, body: object.apiPayload.skill };
  const response = await apiGet(request.readRoute);
  log.push({ phase, kind: 'subject', equipmentKey: object.equipmentKey, skillKey: object.skillKey, route: request.readRoute, response });
  const comparison = compareRequestRecord(object, request, response);
  if (comparison.state === 'conflict') throw new Error(`技能主体同键异值或读取失败：${object.skillKey}`);
  return { request, response, comparison };
}

function assertFileHashes(expected) {
  const actual = { candidateSha256: fileSha256(CANDIDATE_PATH), requestSha256: fileSha256(REQUEST_PATH), sourceSha256: fileSha256(SOURCE_PATH), beforeSha256: fileSha256(BEFORE_PATH) };
  for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, `写入过程中${key}变化，停止且不重放`);
  return actual;
}

class StopObject extends Error {
  constructor(equipmentKey, message) { super(message); this.equipmentKey = equipmentKey; }
}

class StopBatch extends Error {}

async function appendJournal(runDir, event, output) {
  output.events.push(event);
  await writeFile(path.join(runDir, '写入流水.jsonl'), `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
}

async function writeAndRead(object, request, runDir, output, hashValues) {
  assertFileHashes(hashValues);
  const beforeResponse = await apiGet(request.readRoute);
  output.reads.push({ phase: 'before-component', request, response: beforeResponse });
  const beforeComparison = compareRequestRecord(object, request, beforeResponse);
  if (beforeComparison.state === 'same') {
    await appendJournal(runDir, { at: new Date().toISOString(), action: '写前同值跳过', request, response: beforeResponse, comparison: beforeComparison }, output);
    return { written: false, state: 'same', beforeResponse, afterResponse: beforeResponse };
  }
  if (beforeComparison.state === 'conflict') throw new StopObject(object.equipmentKey, `写入前同键异值：${request.readRoute}`);
  await appendJournal(runDir, { at: new Date().toISOString(), action: '准备写入', request, beforeResponse, comparison: beforeComparison }, output);
  const writeResponse = await apiRequest(request.route, { method: request.method, body: request.body });
  const afterResponse = await apiGet(request.readRoute);
  output.reads.push({ phase: 'after-write', request, response: afterResponse });
  const afterComparison = compareRequestRecord(object, request, afterResponse);
  const writeOk = writeResponse.status != null && writeResponse.status >= 200 && writeResponse.status < 300;
  const event = { at: new Date().toISOString(), action: '写后独立GET', request, writeResponse, afterResponse, comparison: afterComparison, match: afterComparison.state === 'same', reconciledAfterWriteError: !writeOk && afterComparison.state === 'same' };
  await appendJournal(runDir, event, output);
  if (afterComparison.state !== 'same') {
    if (!writeOk && afterResponse.status == null) throw new StopBatch(`写入响应未知且写后GET失败：${request.readRoute}；未重放写入`);
    throw new StopObject(object.equipmentKey, `写后GET未得到候选值：${request.readRoute}；不重放写入`);
  }
  return { written: true, state: 'same', writeResponse, afterResponse };
}

async function applyObject(object, requestRows, beforeObject, runDir, output, hashValues) {
  await readCoreProtection(object, beforeObject, 'object-before', output.protectionReads);
  const rows = requestRows.filter(row => row.equipmentKey === object.equipmentKey);
  for (const request of rows) await writeAndRead(object, request, runDir, output, hashValues);
}

async function finalReadback(candidate, requests, before, output) {
  const results = [];
  for (const request of requests) {
    const object = candidate.objects.find(item => item.skillKey === request.skillKey);
    const response = await apiGet(request.readRoute);
    const comparison = compareRequestRecord(object, request, response);
    results.push({ index: results.length, request, response, comparison });
    if (comparison.state !== 'same') throw new StopBatch(`最终90项GET不匹配：${request.readRoute}`);
  }
  const protections = [];
  for (const object of candidate.objects) {
    const beforeObject = before.objects.find(item => item.equipmentKey === object.equipmentKey);
    protections.push(await readCoreProtection(object, beforeObject, 'final-protection', protections));
  }
  return { results, protections, getCount: results.length, allMatch: results.every(row => row.comparison.state === 'same') };
}

function actualValue(parameter, overrides) {
  if (Object.hasOwn(overrides, parameter.parameterKey)) return overrides[parameter.parameterKey];
  if (parameter.valueMode === 'FIXED') return parameter.fixedValue;
  throw new Error(`算例没有运行时输入：${parameter.parameterKey}`);
}

function evaluate(node, context) {
  if (!node || typeof node !== 'object') throw new Error('公式节点为空');
  if (node.nodeType === 'PARAMETER') {
    const parameter = context.parameters.get(node.parameterKey);
    if (!parameter) throw new Error(`公式参数缺失：${node.parameterKey}`);
    return actualValue(parameter, context.overrides);
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const key = `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`;
    if (!Object.hasOwn(context.attributes, key)) throw new Error(`算例属性输入缺失：${key}`);
    return context.attributes[key];
  }
  if (node.nodeType !== 'OPERATION') throw new Error(`不支持的公式节点：${node.nodeType}`);
  const values = node.operands.map(operand => evaluate(operand, context));
  if (node.operation === 'ADD') return values.reduce((sum, value) => sum + value, 0);
  if (node.operation === 'MULTIPLY') return values.reduce((product, value) => product * value, 1);
  if (node.operation === 'MIN') return Math.min(...values);
  if (node.operation === 'MAX') return Math.max(...values);
  throw new Error(`不支持的公式运算：${node.operation}`);
}

function numericCases() {
  return [
    { name: '3179 mStat29为0', equipmentKey: 'item_3179', formulaKey: 'nightstalker_true_damage', overrides: { actual_mstat29: 0 }, attributes: {}, expected: 50 },
    { name: '3179 mStat29为123.4', equipmentKey: 'item_3179', formulaKey: 'nightstalker_true_damage', overrides: { actual_mstat29: 123.4 }, attributes: {}, expected: 235.1 },
    { name: '3302额外攻击力200法强100', equipmentKey: 'item_3302', formulaKey: 'on_hit_magic_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:BONUS': 200, 'SOURCE:ability_power:TOTAL': 100 }, expected: 60 },
    { name: '3302不误用总攻击力', equipmentKey: 'item_3302', formulaKey: 'on_hit_magic_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:TOTAL': 200, 'SOURCE:attack_damage:BONUS': 0, 'SOURCE:ability_power:TOTAL': 100 }, expected: 40 },
    { name: '3302光明每次攻击双抗0.2', equipmentKey: 'item_3302', formulaKey: 'light_resistance_max', overrides: { actual_light_resistance_per_hit: 0.2 }, attributes: {}, expected: 0.6 },
    { name: '3302光明每次攻击双抗0.75', equipmentKey: 'item_3302', formulaKey: 'light_resistance_max', overrides: { actual_light_resistance_per_hit: 0.75 }, attributes: {}, expected: 2.25 },
    { name: '3742基础攻击力120满层', equipmentKey: 'item_3742', formulaKey: 'max_bonus_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:BASE': 120 }, expected: 160 },
    { name: '3742无基础攻击力仍保留满层固定项', equipmentKey: 'item_3742', formulaKey: 'max_bonus_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:BASE': 0 }, expected: 40 },
    { name: '4645符合条件倍率', equipmentKey: 'item_4645', formulaKey: 'eligible_magic_true_damage_multiplier', overrides: {}, attributes: {}, expected: 1.2 },
    { name: '6631总攻击力200', equipmentKey: 'item_6631', formulaKey: 'active_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:TOTAL': 200 }, expected: 160 },
    { name: '6631总攻击力0', equipmentKey: 'item_6631', formulaKey: 'active_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:TOTAL': 0 }, expected: 0 },
    { name: '6662基础攻击力100', equipmentKey: 'item_6662', formulaKey: 'spellblade_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:BASE': 100 }, expected: 150 },
    { name: '6662基础攻击力0', equipmentKey: 'item_6662', formulaKey: 'spellblade_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:BASE': 0 }, expected: 0 },
    { name: '6697击杀英雄0', equipmentKey: 'item_6697', formulaKey: 'bonus_attack_damage', overrides: { actual_killed_hero_count: 0 }, attributes: {}, expected: 12 },
    { name: '6697击杀英雄5', equipmentKey: 'item_6697', formulaKey: 'bonus_attack_damage', overrides: { actual_killed_hero_count: 5 }, attributes: {}, expected: 27 }
  ];
}

function runNumeric(candidate, finalReadback) {
  const parameterResponses = finalReadback.results.filter(row => row.request.kind === 'parameters');
  const formulaResponses = finalReadback.results.filter(row => row.request.kind === 'formulas');
  const actualParameters = new Map(parameterResponses.map(row => [`${row.request.skillKey}/${row.request.body.parameterKey}`, row.response.data]));
  const actualFormulas = new Map(formulaResponses.map(row => [`${row.request.skillKey}/${row.request.body.formulaKey}`, row.response.data]));
  const parameterCount = actualParameters.size;
  const formulaCount = actualFormulas.size;
  const componentMatches = [...parameterResponses, ...formulaResponses].every(row => row.comparison.state === 'same');
  const cases = [];
  for (const example of numericCases()) {
    const object = candidate.objects.find(item => item.equipmentKey === example.equipmentKey);
    const formula = object.apiPayload.formulas.find(item => item.formulaKey === example.formulaKey);
    const parameters = new Map(object.apiPayload.parameters.map(parameter => [parameter.parameterKey, parameter]));
    const value = evaluate(formula.expression, { parameters, overrides: example.overrides, attributes: example.attributes });
    cases.push({ ...example, actualValue: value, pass: Object.is(value, example.expected) || Math.abs(value - example.expected) < 1e-9, source: '最终90项GET中的公式结构与参数响应' });
  }
  const targetParameter = candidate.objects.find(item => item.equipmentKey === 'item_3036').apiPayload.parameters.find(item => item.parameterKey === 'actual_target_bonus_health');
  const decimalInput = { parameterKey: 'actual_target_bonus_health', valueType: targetParameter.valueType, valueMode: targetParameter.valueMode, fixedValue: targetParameter.fixedValue, levelValues: targetParameter.levelValues, exampleInput: 1234.5, pass: targetParameter.valueType === 'DECIMAL' && targetParameter.valueMode === 'RUNTIME_INPUT' && targetParameter.fixedValue === null && targetParameter.levelValues === null };
  return { parameterCount, formulaCount, expectedParameterCount: 52, expectedFormulaCount: 8, componentMatches, decimalInput, cases, passedCases: cases.filter(item => item.pass).length, caseCount: cases.length, allPass: parameterCount === 52 && formulaCount === 8 && componentMatches && decimalInput.pass && cases.every(item => item.pass) };
}

async function writeRootFile(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' });
}

async function run() {
  if (APPLY && fs.existsSync(LOCK_PATH)) throw new Error(`已存在防重放锁：${LOCK_PATH}`);
  const candidate = readJson(CANDIDATE_PATH);
  const request = readJson(REQUEST_PATH);
  const source = readJson(SOURCE_PATH);
  const before = readJson(BEFORE_PATH);
  const hashRecord = readJson(HASH_PATH);
  const staticValidation = staticValidate(candidate, request, source, before);
  const hashValues = {
    candidateSha256: staticValidation.candidateSha256,
    requestSha256: staticValidation.requestSha256,
    sourceSha256: staticValidation.sourceSha256,
    beforeSha256: staticValidation.beforeSha256
  };
  assert.equal(hashRecord.sourceSha256, EXPECTED_SOURCE_SHA, '冻结哈希中的来源散列不符');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(HERE, '执行记录', runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, '最终候选快照.json'), bytesOf(CANDIDATE_PATH), { flag: 'wx' });
  await writeFile(path.join(runDir, '最终请求快照.json'), bytesOf(REQUEST_PATH), { flag: 'wx' });
  const output = {
    runId,
    startedAt: new Date().toISOString(),
    mode: APPLY ? '显式补缺写入' : '默认只读预检',
    apiRoot: API_ROOT,
    candidateSha256: staticValidation.candidateSha256,
    requestSha256: staticValidation.requestSha256,
    sourceSha256: staticValidation.sourceSha256,
    beforeSha256: staticValidation.beforeSha256,
    staticValidation: { ...staticValidation, expectedRequests: undefined },
    sourceChecks: staticValidation.sourceChecks,
    preflight: [],
    protectionReads: [],
    reads: [],
    events: [],
    objectStops: [],
    errors: []
  };
  try {
    for (const object of candidate.objects) {
      const beforeObject = before.objects.find(item => item.equipmentKey === object.equipmentKey);
      if (!beforeObject) throw new StopBatch(`写前现值缺少：${object.equipmentKey}`);
      const protection = await readCoreProtection(object, beforeObject, 'preflight', output.protectionReads);
      const subject = await readSubject(object, 'preflight', output.reads);
      output.preflight.push({ equipmentKey: object.equipmentKey, protection, subject });
      if (subject.comparison.state === 'conflict') throw new StopBatch(`主体同键异值：${object.skillKey}`);
    }
    output.preflightSummary = {
      objects: output.preflight.length,
      coreProtectionRoutes: output.protectionReads.length,
      subjectReads: output.reads.length,
      allRelationsEmpty: output.preflight.every(item => item.protection.relation.empty),
      subjectsMissing: output.preflight.filter(item => item.subject.comparison.state === 'missing').length
    };
    if (APPLY) {
      assertFileHashes(hashValues);
      for (const object of candidate.objects) {
        try {
          await applyObject(object, staticValidation.expectedRequests, before.objects.find(item => item.equipmentKey === object.equipmentKey), runDir, output, hashValues);
        } catch (error) {
          if (error instanceof StopObject) {
            output.objectStops.push({ equipmentKey: error.equipmentKey, message: String(error) });
            continue;
          }
          throw error;
        }
      }
      if (output.objectStops.length) throw new StopBatch(`存在对象停止：${JSON.stringify(output.objectStops)}`);
      output.finalReadback = await finalReadback(candidate, staticValidation.expectedRequests, before, output);
      output.numeric = runNumeric(candidate, output.finalReadback);
      if (!output.finalReadback.allMatch) throw new StopBatch('最终90项GET未全部匹配');
      if (!output.numeric.allPass) throw new StopBatch('独立实值核算未全部通过');
      const lock = {
        runId,
        completedAt: new Date().toISOString(),
        candidateSha256: staticValidation.candidateSha256,
        requestSha256: staticValidation.requestSha256,
        writes: output.events.filter(event => event.action === '写后独立GET' && event.writeResponse?.status >= 200 && event.writeResponse?.status < 300).length,
        finalGets: output.finalReadback.getCount,
        numeric: { parameterCount: output.numeric.parameterCount, formulaCount: output.numeric.formulaCount, passedCases: output.numeric.passedCases, caseCount: output.numeric.caseCount }
      };
      await writeFile(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      output.lock = lock;
      await writeRootFile(RESULT_PATH, output);
      await writeRootFile(NUMERIC_PATH, output.numeric);
      const successfulWrites = output.events.filter(event => event.action === '写后独立GET' && event.comparison?.state === 'same');
      const writeCount = successfulWrites.length;
      const md = [
        '# 第十八批装备实际录入体验',
        '',
        `结论：10件装备、10个技能主体、52个参数、8个公式、10个挂载和10个代表图已按最终请求完成；实际写入后逐项GET，最终独立GET ${output.finalReadback.getCount}/90 全部匹配。`,
        '',
        `本次写入成功事件 ${writeCount} 项，写入脚本使用显式 --apply；候选 SHA256 为 ${staticValidation.candidateSha256}，请求 SHA256 为 ${staticValidation.requestSha256}。已创建防重放锁，后续重复执行会停止。`,
        '',
        `数值核算读取最终API参数 ${output.numeric.parameterCount}/52、公式 ${output.numeric.formulaCount}/8；独立算例 ${output.numeric.passedCases}/${output.numeric.caseCount} 通过。3036的实际目标额外生命参数为DECIMAL运行时输入，1234.5作为小数示例可保留；1500固定门槛仍是独立参数。`,
        '',
        '范围主动、多目标分摊、第三方友军、纯视野与战斗过程资格仍按候选边界记录；本次未声称战斗运行、触发时序或页面验收。',
        '',
        `记录目录：${runDir}`,
        `完成时间：${output.finishedAt ?? new Date().toISOString()}`,
        ''
      ].join('\n');
      await writeFile(EXPERIENCE_PATH, md, { encoding: 'utf8' });
    } else {
      output.readOnlySummary = '未调用业务写入；只完成静态核对和写前保护GET。';
    }
  } catch (error) {
    output.errors.push({ message: String(error), stack: error?.stack ?? null });
  }
  output.finishedAt = new Date().toISOString();
  await writeFile(path.join(runDir, '执行记录.json'), `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({
    mode: output.mode,
    runId,
    candidateSha256: output.candidateSha256,
    requestSha256: output.requestSha256,
    preflight: output.preflightSummary,
    writes: output.events.filter(event => event.action === '写后独立GET' && event.comparison?.state === 'same').length,
    finalGets: output.finalReadback?.getCount ?? 0,
    numeric: output.numeric ? { parameterCount: output.numeric.parameterCount, formulaCount: output.numeric.formulaCount, passedCases: output.numeric.passedCases, caseCount: output.numeric.caseCount, allPass: output.numeric.allPass } : null,
    errors: output.errors,
    runDir
  }, null, 2));
  if (output.errors.length) process.exitCode = 1;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
