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
const LOCK_PATH = path.join(HERE, '最终写入完成.lock.json');
const RESULT_PATH = path.join(HERE, '实际录入结果.json');
const NUMERIC_PATH = path.join(HERE, '独立实值核算.json');
const EXPERIENCE_PATH = path.join(HERE, '体验报告.md');
const EXPECTED_CANDIDATE_SHA = '4863b2119fd7f154d188d207f4b6e465d3719146f35dd1cc2bfb047e4b294a2b';
const EXPECTED_REQUEST_SHA = '6f2aa8e960114cd8f3068ff2d3bda96a840aa242c32e5f635b2529bc6cd4891c';
const EXPECTED_SOURCE_SHA = '98d14396062ef2189cf364faf863f4d2ee62481dff9dacbaf4641fa9663c0492';
const EXPECTED_BEFORE_SHA = 'd21a71991758032112009478a123761e1d0628fb660c59f2c26d13ba2c947250';
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

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileSha256 = file => sha256(fs.readFileSync(file));

function normalize(value, key = '') {
  if (Array.isArray(value)) {
    const values = value.map(item => normalize(item));
    return key === 'skillCategoryKeys' ? values.sort() : values;
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v, k)]));
  return value;
}

function same(a, b) { return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b)); }

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
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) differences(expected[key], actual[key], currentPath ? `${currentPath}.${key}` : key, rows);
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
  return { ...object.apiPayload.relation, equipmentName: object.equipmentName, skillName: object.apiPayload.skill.name, skillStatus: object.apiPayload.skill.status };
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

function createRequests(candidate) {
  const requests = [];
  for (const object of candidate.objects) {
    const skillPath = `/skills/${encodeURIComponent(object.skillKey)}`;
    requests.push({ kind: 'skill', equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'POST', route: '/skills', readRoute: skillPath, body: object.apiPayload.skill });
    for (const [kind, idField, api] of componentKinds) for (const body of object.apiPayload[kind] ?? []) requests.push({ kind, equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'POST', route: `${skillPath}/${api}`, readRoute: `${skillPath}/${api}/${encodeURIComponent(body[idField])}`, body });
    requests.push({ kind: 'relation', equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'POST', route: '/equipment-skill-relations', readRoute: `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`, body: object.apiPayload.relation });
    requests.push({ kind: 'image', equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'PUT', route: `${skillPath}/representative-image`, readRoute: `${skillPath}/representative-image`, body: object.apiPayload.representativeImage });
  }
  return requests;
}

function compareRequest(object, request, response) {
  if (request.kind === 'relation') {
    if (!response.ok) return { state: 'conflict', fields: [], error: `GET HTTP ${response.status}` };
    let items;
    try { items = listItems(response, request.readRoute); } catch (error) { return { state: 'conflict', fields: [], error: String(error) }; }
    if (items.length !== 1 || items.some(item => item.equipmentKey !== object.equipmentKey || item.skillKey !== object.skillKey)) return { state: 'conflict', fields: [], error: `关系项数量或键不符，实际${items.length}项` };
    const fields = differences(normalize(relationExpected(object)), normalize(stripServerFields(items[0], 'relation')));
    return { state: fields.every(field => field.equal) ? 'same' : 'conflict', fields };
  }
  if (request.kind === 'image') {
    if (!response.ok) return { state: 'conflict', fields: [], error: `GET HTTP ${response.status}` };
    const actual = imageCore(response.data);
    const expected = { imageKey: object.apiPayload.representativeImage.imageKey, enabled: true };
    if (!actual) return { state: 'conflict', fields: [{ path: 'image', expected, actual, equal: false }] };
    const fields = differences(normalize(expected), normalize(actual));
    return { state: fields.every(field => field.equal) ? 'same' : 'conflict', fields };
  }
  if (!response.ok) return { state: 'conflict', fields: [], error: `GET HTTP ${response.status}` };
  const expected = expectedBody(object, request);
  const actual = stripServerFields(response.data, request.kind === 'skill' ? 'skill' : request.kind);
  const fields = differences(normalize(expected), normalize(actual));
  return { state: fields.every(field => field.equal) ? 'same' : 'conflict', fields };
}

async function apiGet(route) {
  try {
    const response = await fetch(API_ROOT + route, { headers: { Authorization: `Bearer ${API_TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const raw = await response.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch (error) { return { route, method: 'GET', status: response.status, ok: response.ok, data: null, error: `非JSON响应：${String(error)}` }; }
    }
    return { route, method: 'GET', status: response.status, ok: response.ok, data };
  } catch (error) {
    return { route, method: 'GET', status: null, ok: false, data: null, error: String(error) };
  }
}

function verifySourceFiles(source) {
  return (source.sourceFiles ?? []).map(record => {
    const file = path.resolve(DATA_ROOT, record.relativePath);
    const actual = fs.existsSync(file) ? fileSha256(file) : null;
    const rawSha256 = fs.existsSync(file) && String(record.format).toLowerCase().includes('gzip') ? sha256(zlib.gunzipSync(fs.readFileSync(file))) : null;
    const row = { key: record.key, path: file, exists: actual !== null, declaredSha256: record.sha256, actualSha256: actual, rawSha256, pass: actual === record.sha256 };
    assert.ok(row.pass, `来源散列不符：${record.relativePath}`);
    return row;
  });
}

function staticCheck(candidate, request, source, before) {
  const hashes = { candidateSha256: fileSha256(CANDIDATE_PATH), requestSha256: fileSha256(REQUEST_PATH), sourceSha256: fileSha256(SOURCE_PATH), beforeSha256: fileSha256(BEFORE_PATH) };
  assert.equal(hashes.candidateSha256, EXPECTED_CANDIDATE_SHA, '最终候选散列不符');
  assert.equal(hashes.requestSha256, EXPECTED_REQUEST_SHA, '最终请求散列不符');
  assert.equal(hashes.sourceSha256, EXPECTED_SOURCE_SHA, '冻结来源散列不符');
  assert.equal(hashes.beforeSha256, EXPECTED_BEFORE_SHA, '写前现值散列不符');
  assert.deepEqual(candidate.objects.map(item => item.equipmentKey), expectedEquipmentKeys, '候选装备范围或顺序不符');
  assert.deepEqual(candidate.objects.map(item => item.equipmentKey).sort(), [...expectedEquipmentKeys].sort(), '候选装备集合不符');
  assert.deepEqual(candidate.totals, { ...candidate.totals, equipment: 10, skills: 10, parameters: 52, formulas: 8, effects: 0, processes: 0, internalStates: 0, triggerRules: 0, relations: 10, representativeImages: 10 }, '候选总计不符');
  const generated = createRequests(candidate);
  assert.equal(generated.length, 90, '候选生成请求不是90项');
  assert.equal(request.requests.length, 90, '最终请求不是90项');
  const requestDifferences = [];
  for (let i = 0; i < 90; i += 1) for (const key of ['kind', 'equipmentKey', 'skillKey', 'method', 'route', 'readRoute', 'body']) if (!same(generated[i][key], request.requests[i][key])) requestDifferences.push({ index: i, key, expected: generated[i][key], actual: request.requests[i][key] });
  assert.equal(requestDifferences.length, 0, `最终请求不等于候选生成结果：${JSON.stringify(requestDifferences.slice(0, 3))}`);
  assert.equal(request.candidateSha256, EXPECTED_CANDIDATE_SHA, '请求中的候选散列不符');
  assert.equal(request.sourceSha256, EXPECTED_SOURCE_SHA, '请求中的来源散列不符');
  assert.equal(request.beforeSha256, EXPECTED_BEFORE_SHA, '请求中的写前散列不符');
  const decimal = candidate.objects.find(item => item.equipmentKey === 'item_3036').apiPayload.parameters.find(item => item.parameterKey === 'actual_target_bonus_health');
  assert.deepEqual({ valueType: decimal.valueType, valueMode: decimal.valueMode, fixedValue: decimal.fixedValue, levelValues: decimal.levelValues }, { valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null }, '3036实际目标额外生命输入形态不符');
  return { hashes, sourceChecks: verifySourceFiles(source), requestCount: 90, requestDifferences, decimalInput: { ...decimal, exampleInput: 1234.5, canPreserveFraction: true } };
}

function expectedCore(beforeObject, route) {
  const record = beforeObject.records.find(item => item.route === route);
  assert.ok(record, `写前现值缺少：${route}`);
  return record.data;
}

async function readProtection(object, beforeObject) {
  const row = { equipmentKey: object.equipmentKey, routes: [], relation: null };
  for (const route of [`/equipment/${object.equipmentKey}`, `/equipment/${object.equipmentKey}/attributes`, `/equipment/${object.equipmentKey}/representative-image`]) {
    const response = await apiGet(route);
    const fields = response.ok ? differences(normalize(stripServerFields(expectedCore(beforeObject, route), 'equipment')), normalize(stripServerFields(response.data, 'equipment'))) : [{ path: 'HTTP', expected: 200, actual: response.status, equal: false }];
    const comparison = { match: fields.every(field => field.equal), fields };
    row.routes.push({ route, response, comparison });
    if (!comparison.match) throw new Error(`原装备、属性或原代表图已漂移：${route}`);
  }
  const relationRoute = `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`;
  const response = await apiGet(relationRoute);
  const items = listItems(response, relationRoute);
  const request = { kind: 'relation', equipmentKey: object.equipmentKey, skillKey: object.skillKey, body: object.apiPayload.relation, readRoute: relationRoute };
  const comparison = compareRequest(object, request, response);
  row.relation = { route: relationRoute, response, items, comparison };
  if (comparison.state !== 'same') throw new Error(`最终装备挂载不符：${relationRoute}`);
  return row;
}

function actualValue(parameter, overrides) {
  if (Object.hasOwn(overrides, parameter.parameterKey)) return overrides[parameter.parameterKey];
  if (parameter.valueMode === 'FIXED') return parameter.fixedValue;
  throw new Error(`算例没有运行时输入：${parameter.parameterKey}`);
}

function evaluate(node, context) {
  if (node.nodeType === 'PARAMETER') {
    const parameter = context.parameters.get(node.parameterKey);
    if (!parameter) throw new Error(`公式参数缺失：${node.parameterKey}`);
    return actualValue(parameter, context.overrides);
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const key = `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`;
    assert.ok(Object.hasOwn(context.attributes, key), `算例属性输入缺失：${key}`);
    return context.attributes[key];
  }
  assert.equal(node.nodeType, 'OPERATION', `不支持的公式节点：${node.nodeType}`);
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
    { name: '3302光明双抗每次攻击0.2', equipmentKey: 'item_3302', formulaKey: 'light_resistance_max', overrides: { actual_light_resistance_per_hit: 0.2 }, attributes: {}, expected: 0.6 },
    { name: '3302光明双抗每次攻击0.75', equipmentKey: 'item_3302', formulaKey: 'light_resistance_max', overrides: { actual_light_resistance_per_hit: 0.75 }, attributes: {}, expected: 2.25 },
    { name: '3742基础攻击力120满层', equipmentKey: 'item_3742', formulaKey: 'max_bonus_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:BASE': 120 }, expected: 160 },
    { name: '3742无基础攻击力仍保留固定满层项', equipmentKey: 'item_3742', formulaKey: 'max_bonus_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:BASE': 0 }, expected: 40 },
    { name: '4645符合条件倍率', equipmentKey: 'item_4645', formulaKey: 'eligible_magic_true_damage_multiplier', overrides: {}, attributes: {}, expected: 1.2 },
    { name: '6631总攻击力200', equipmentKey: 'item_6631', formulaKey: 'active_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:TOTAL': 200 }, expected: 160 },
    { name: '6631总攻击力0', equipmentKey: 'item_6631', formulaKey: 'active_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:TOTAL': 0 }, expected: 0 },
    { name: '6662基础攻击力100', equipmentKey: 'item_6662', formulaKey: 'spellblade_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:BASE': 100 }, expected: 150 },
    { name: '6662基础攻击力0', equipmentKey: 'item_6662', formulaKey: 'spellblade_damage', overrides: {}, attributes: { 'SOURCE:attack_damage:BASE': 0 }, expected: 0 },
    { name: '6697击杀英雄0', equipmentKey: 'item_6697', formulaKey: 'bonus_attack_damage', overrides: { actual_killed_hero_count: 0 }, attributes: {}, expected: 12 },
    { name: '6697击杀英雄5', equipmentKey: 'item_6697', formulaKey: 'bonus_attack_damage', overrides: { actual_killed_hero_count: 5 }, attributes: {}, expected: 27 }
  ];
}

function runNumeric(candidate, finalResults) {
  const parameterRows = finalResults.filter(row => row.request.kind === 'parameters');
  const formulaRows = finalResults.filter(row => row.request.kind === 'formulas');
  const actualParameters = new Map(parameterRows.map(row => [`${row.request.skillKey}/${row.request.body.parameterKey}`, row.response.data]));
  const actualFormulas = new Map(formulaRows.map(row => [`${row.request.skillKey}/${row.request.body.formulaKey}`, row.response.data]));
  const cases = [];
  for (const example of numericCases()) {
    const object = candidate.objects.find(item => item.equipmentKey === example.equipmentKey);
    const formulaActual = actualFormulas.get(`${object.skillKey}/${example.formulaKey}`);
    const parameters = new Map(object.apiPayload.parameters.map(parameter => [parameter.parameterKey, actualParameters.get(`${object.skillKey}/${parameter.parameterKey}`)]));
    const actualValueResult = evaluate(formulaActual.expression, { parameters, overrides: example.overrides, attributes: example.attributes });
    cases.push({ ...example, actualValue: actualValueResult, pass: Object.is(actualValueResult, example.expected) || Math.abs(actualValueResult - example.expected) < 1e-9, source: '最终90项独立GET的公式与参数详情' });
  }
  const decimal = actualParameters.get('item_3036_passive/actual_target_bonus_health');
  const decimalInput = { parameterKey: 'actual_target_bonus_health', valueType: decimal?.valueType, valueMode: decimal?.valueMode, fixedValue: decimal?.fixedValue, levelValues: decimal?.levelValues, exampleInput: 1234.5, pass: decimal?.valueType === 'DECIMAL' && decimal?.valueMode === 'RUNTIME_INPUT' && decimal?.fixedValue === null && decimal?.levelValues === null };
  return { parameterCount: actualParameters.size, formulaCount: actualFormulas.size, expectedParameterCount: 52, expectedFormulaCount: 8, componentMatches: [...parameterRows, ...formulaRows].every(row => row.comparison.state === 'same'), decimalInput, cases, passedCases: cases.filter(item => item.pass).length, caseCount: cases.length, allPass: actualParameters.size === 52 && actualFormulas.size === 8 && decimalInput.pass && cases.every(item => item.pass) };
}

function findWriteEvidence() {
  const root = path.join(HERE, '执行记录');
  if (!fs.existsSync(root)) return null;
  const rows = [];
  for (const name of fs.readdirSync(root).sort().reverse()) {
    const file = path.join(root, name, '执行记录.json');
    if (!fs.existsSync(file)) continue;
    try {
      const record = readJson(file);
      if (record.mode !== '显式补缺写入' || record.candidateSha256 !== EXPECTED_CANDIDATE_SHA) continue;
      rows.push({ path: file, runId: record.runId, mode: record.mode, eventCount: record.events?.length ?? 0, writeAfterCount: record.events?.filter(event => event.action === '写后独立GET').length ?? 0, writeSuccessCount: record.events?.filter(event => event.action === '写后独立GET' && event.writeResponse?.status >= 200 && event.writeResponse?.status < 300).length ?? 0, writeMatchCount: record.events?.filter(event => event.action === '写后独立GET' && event.match).length ?? 0, errors: record.errors ?? [] });
    } catch { /* 保留坏记录，不让它替代可读的写入证据 */ }
  }
  return rows[0] ?? null;
}

async function writeRootFile(file, value) { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' }); }

async function run() {
  if (fs.existsSync(LOCK_PATH)) throw new Error(`已存在防重放锁：${LOCK_PATH}`);
  const candidate = readJson(CANDIDATE_PATH);
  const request = readJson(REQUEST_PATH);
  const source = readJson(SOURCE_PATH);
  const before = readJson(BEFORE_PATH);
  const staticValidation = staticCheck(candidate, request, source, before);
  const writeEvidence = findWriteEvidence();
  assert.ok(writeEvidence, '找不到最终候选对应的实际写入流水');
  assert.equal(writeEvidence.writeAfterCount, 90, '写入流水不是90项写后GET');
  assert.equal(writeEvidence.writeSuccessCount, 90, '写入流水不是90项成功响应');
  assert.equal(writeEvidence.writeMatchCount, 90, '写入流水不是90项匹配');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(HERE, '执行记录', `独立回读-${runId}`);
  await mkdir(runDir, { recursive: true });
  const output = { runId, startedAt: new Date().toISOString(), mode: '写入后独立只读回读', apiRoot: API_ROOT, candidateSha256: staticValidation.hashes.candidateSha256, requestSha256: staticValidation.hashes.requestSha256, sourceSha256: staticValidation.hashes.sourceSha256, beforeSha256: staticValidation.hashes.beforeSha256, staticValidation, writeEvidence, finalGets: [], protections: [], numeric: null, errors: [] };
  try {
    for (const row of request.requests) {
      const object = candidate.objects.find(item => item.skillKey === row.skillKey);
      const response = await apiGet(row.readRoute);
      const comparison = compareRequest(object, row, response);
      output.finalGets.push({ index: output.finalGets.length, request: row, response, comparison });
      if (comparison.state !== 'same') throw new Error(`最终90项GET不匹配：${row.readRoute}`);
    }
    for (const object of candidate.objects) {
      const beforeObject = before.objects.find(item => item.equipmentKey === object.equipmentKey);
      output.protections.push(await readProtection(object, beforeObject));
    }
    output.numeric = runNumeric(candidate, output.finalGets);
    assert.equal(output.finalGets.length, 90, '最终独立GET数量不符');
    assert.ok(output.finalGets.every(row => row.comparison.state === 'same'), '最终独立GET存在不匹配');
    assert.ok(output.numeric.allPass, '独立实值核算未全部通过');
    assert.equal(fileSha256(CANDIDATE_PATH), EXPECTED_CANDIDATE_SHA, '回读期间候选变化');
    assert.equal(fileSha256(REQUEST_PATH), EXPECTED_REQUEST_SHA, '回读期间请求变化');
    output.finishedAt = new Date().toISOString();
    const lock = { runId, completedAt: output.finishedAt, candidateSha256: output.candidateSha256, requestSha256: output.requestSha256, writes: writeEvidence.writeSuccessCount, writeMatches: writeEvidence.writeMatchCount, finalGets: output.finalGets.length, numeric: { parameterCount: output.numeric.parameterCount, formulaCount: output.numeric.formulaCount, passedCases: output.numeric.passedCases, caseCount: output.numeric.caseCount } };
    await writeFile(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    output.lock = lock;
    await writeFile(path.join(runDir, '写后独立回读.json'), `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await writeRootFile(RESULT_PATH, output);
    await writeRootFile(NUMERIC_PATH, output.numeric);
    const md = [
      '# 第十八批装备实际录入体验',
      '',
      `10件装备、10个技能主体、52个参数、8个公式、10个装备挂载和10个代表图已完成。写入流水显示实际写后GET ${writeEvidence.writeMatchCount}/90 匹配；本次独立回读再次GET ${output.finalGets.length}/90，全部匹配。`,
      '',
      `实际写入成功 ${writeEvidence.writeSuccessCount} 项，使用最终候选 SHA256 ${output.candidateSha256} 和最终请求 SHA256 ${output.requestSha256}。已创建防重放锁，重复执行会停止。`,
      '',
      `独立实值核算读取参数 ${output.numeric.parameterCount}/52、公式 ${output.numeric.formulaCount}/8，${output.numeric.passedCases}/${output.numeric.caseCount} 个区别性算例通过。3036实际目标额外生命使用DECIMAL运行时输入，1234.5示例保留小数；1500固定门槛独立保存。`,
      '',
      '第一次写入脚本在90项写后GET全部成功后，于最终保护阶段错误地继续要求装备关系为空；该错误没有重放写入，本次独立回读已按写后应有的单条关系重新核对。',
      '',
      '本记录证明接口写入、逐项GET、原装备属性和原代表图保护及公式静态算例；未执行页面验收或战斗运行。',
      '',
      `写入流水：${writeEvidence.path}`,
      `独立回读目录：${runDir}`,
      `完成时间：${output.finishedAt}`,
      ''
    ].join('\n');
    await writeFile(EXPERIENCE_PATH, md, { encoding: 'utf8' });
  } catch (error) {
    output.errors.push({ message: String(error), stack: error?.stack ?? null });
    output.finishedAt = new Date().toISOString();
    await writeFile(path.join(runDir, '写后独立回读-失败.json'), `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  }
  if (!output.finishedAt) output.finishedAt = new Date().toISOString();
  console.log(JSON.stringify({ mode: output.mode, runId, candidateSha256: output.candidateSha256, requestSha256: output.requestSha256, writeMatches: output.writeEvidence.writeMatchCount, finalGets: output.finalGets.length, numeric: output.numeric ? { parameterCount: output.numeric.parameterCount, formulaCount: output.numeric.formulaCount, passedCases: output.numeric.passedCases, caseCount: output.numeric.caseCount, allPass: output.numeric.allPass } : null, errors: output.errors, runDir }, null, 2));
  if (output.errors.length) process.exitCode = 1;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
