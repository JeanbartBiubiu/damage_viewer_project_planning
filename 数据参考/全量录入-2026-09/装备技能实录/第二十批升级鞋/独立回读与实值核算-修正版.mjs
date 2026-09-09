import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..', 'damage_web_dev', '.agents', 'artifacts', 'gear20-finalize');
const API_ROOT = process.env.DV_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol';
const API_TOKEN = process.env.GEAR20_API_TOKEN;
if (!API_TOKEN) throw new Error('缺少GEAR20_API_TOKEN环境变量；令牌只允许由运行环境提供');
const CANDIDATE_PATH = path.join(HERE, '修正版最终候选.json');
const REQUEST_PATH = path.join(HERE, '修正版最终请求.json');
const SOURCE_PATH = path.join(HERE, '冻结来源.json');
const BEFORE_PATH = path.join(HERE, '写前保护快照.json');
const EXPECTED = {
  candidateSha256: '9dc1b9628720c0afc91d9e835649ae6899dd9bfcbacac136fae7c7081ab79f62',
  requestSha256: '873602b2c17d2db51d58f32a4b9cbb0e3e9d9e87d88c372c744ebd190ec3d902',
  sourceSha256: '3861cdd2d66da43deb99aca9c085c894258f58a21bfdfc967b9feaa71203e649',
  beforeSha256: 'b928abf4069b9a1b65f5eba0801bc3ecf72035b86f793eee523e440222aef463',
};
const SELECTED_EQUIPMENT = ['item_3168', 'item_3170', 'item_3171', 'item_3173', 'item_3174'];
const COMPONENT_KINDS = [
  ['parameter', 'parameterKey', 'parameters'],
  ['formula', 'formulaKey', 'formulas'],
  ['effect', 'effectKey', 'effects'],
  ['process', 'processKey', 'processes'],
  ['internalState', 'stateKey', 'internalStates'],
  ['triggerRule', 'ruleKey', 'triggerRules'],
];
const LIST_ENDPOINTS = [
  ['parameters', 'parameters'],
  ['formulas', 'formulas'],
  ['effects', 'effects'],
  ['processes', 'processes'],
  ['internalStates', 'internal-states'],
  ['triggerRules', 'trigger-rules'],
];

if (process.argv.slice(2).length !== 1 || process.argv[2] !== '--after-apply') {
  throw new Error('只允许显式 --after-apply；本脚本不会执行任何业务写入');
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function fileSha256(file) { return sha256(fs.readFileSync(file)); }
function clone(value) { return structuredClone(value); }
function fail(message) { throw new Error(message); }

function normalize(value, key = '') {
  if (Array.isArray(value)) {
    const items = value.map(item => normalize(item));
    return key === 'skillCategoryKeys' ? items.sort() : items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([entryKey, entryValue]) => [entryKey, normalize(entryValue, entryKey)]));
  }
  return value;
}
function same(left, right) { return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right)); }
function differences(expected, actual, currentPath = '', rows = []) {
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    rows.push({ path: currentPath, expected, actual, equal: Object.is(expected, actual) });
    return rows;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) { rows.push({ path: currentPath, expected, actual, equal: false }); return rows; }
    rows.push({ path: `${currentPath}.length`, expected: expected.length, actual: actual.length, equal: expected.length === actual.length });
    for (let index = 0; index < Math.max(expected.length, actual.length); index += 1) differences(expected[index], actual[index], `${currentPath}[${index}]`, rows);
    return rows;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) differences(expected[key], actual[key], currentPath ? `${currentPath}.${key}` : key, rows);
  return rows;
}
function stripServerFields(value, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = clone(value);
  for (const key of ['gameId', 'createdAt', 'updatedAt']) delete result[key];
  if (kind !== 'skill' && kind !== 'relation') delete result.skillKey;
  return result;
}
function listItems(response, route) {
  if (!response.ok) fail(`${route} HTTP ${response.status}`);
  const items = Array.isArray(response.data) ? response.data : response.data?.items;
  if (!Array.isArray(items)) fail(`列表结构不符：${route}`);
  if (!Array.isArray(response.data) && response.data?.total != null && Number(response.data.total) !== items.length) fail(`列表未完整读取：${route}`);
  return items;
}

function objectFor(candidate, skillKey) {
  const object = candidate.objects.find(item => item.skillKey === skillKey);
  if (!object) fail(`候选缺少技能：${skillKey}`);
  return object;
}
function relationExpected(object) {
  return { ...object.apiPayload.relation, equipmentName: object.equipmentName, skillName: object.apiPayload.skill.name, skillStatus: object.apiPayload.skill.status };
}
function imageCore(data) {
  const image = data && Object.hasOwn(data, 'image') ? data.image : data;
  if (!image || typeof image !== 'object' || Array.isArray(image)) return null;
  return { imageKey: image.imageKey, name: image.name, enabled: image.enabled };
}
function imageExpected(object, before) {
  const row = before.rows.find(item => item.kind === 'representativeImageGET' && item.equipmentKey === object.equipmentKey);
  return { imageKey: object.apiPayload.representativeImage.imageKey, name: row?.response?.data?.image?.name, enabled: true };
}
function expectedBody(object, request) {
  if (request.kind === 'skill') return object.apiPayload.skill;
  if (request.kind === 'parameter') return object.apiPayload.parameters.find(item => item.parameterKey === request.body.parameterKey);
  if (request.kind === 'formula') return object.apiPayload.formulas.find(item => item.formulaKey === request.body.formulaKey);
  if (request.kind === 'relation') return object.apiPayload.relation;
  if (request.kind === 'representativeImage') return object.apiPayload.representativeImage;
  return undefined;
}
function relationState(object, response, plans) {
  if (!response.ok) return { state: 'conflict', error: `关系列表GET失败：HTTP ${response.status}`, fields: [] };
  let items;
  try { items = listItems(response, response.route); } catch (error) { return { state: 'conflict', error: String(error), fields: [] }; }
  const expectedPlans = plans.get(object.equipmentKey) ?? [];
  const expectedByKey = new Map(expectedPlans.map(item => [item.key, item]));
  const seen = new Set(); const invalid = []; const mismatches = [];
  for (const item of items) {
    const key = `${item.equipmentKey}|${item.skillKey}`;
    if (seen.has(key)) invalid.push({ reason: '重复关系', key });
    seen.add(key);
    const plan = expectedByKey.get(key);
    if (!plan) { invalid.push({ reason: '计划外关系', key, item }); continue; }
    const fields = differences(normalize(plan.expected), normalize(stripServerFields(item, 'relation')));
    if (fields.some(field => !field.equal)) mismatches.push({ key, fields });
  }
  const allExpectedPresent = expectedPlans.every(plan => seen.has(plan.key));
  const exact = invalid.length === 0 && mismatches.length === 0 && allExpectedPresent && items.length === expectedPlans.length;
  return { state: exact ? 'same' : 'conflict', itemCount: items.length, plannedCount: expectedPlans.length, actualKeys: [...seen], expectedKeys: expectedPlans.map(plan => plan.key), exact, invalid, mismatches, fields: mismatches.flatMap(item => item.fields) };
}
function compareRequest(object, request, response, plans, before) {
  if (request.kind === 'relation') return relationState(object, response, plans);
  if (request.kind === 'representativeImage') {
    if (response.status === 404) return { state: 'conflict', fields: [], error: '写后代表图不应为404' };
    if (!response.ok) return { state: 'conflict', fields: [], error: `GET失败：HTTP ${response.status}` };
    const actual = imageCore(response.data);
    if (!actual) return { state: 'conflict', fields: [{ path: 'image', expected: imageExpected(object, before), actual, equal: false }], error: '写后代表图为空' };
    const fields = differences(normalize(imageExpected(object, before)), normalize(actual));
    return { state: fields.every(field => field.equal) ? 'same' : 'conflict', fields };
  }
  if (!response.ok) return { state: 'conflict', fields: [], error: `GET失败：HTTP ${response.status}` };
  const expected = expectedBody(object, request);
  if (!expected) return { state: 'conflict', fields: [], error: '请求没有对应候选载荷' };
  const actual = stripServerFields(response.data, request.kind === 'skill' ? 'skill' : request.kind);
  const fields = differences(normalize(expected), normalize(actual));
  return { state: fields.every(field => field.equal) ? 'same' : 'conflict', fields };
}
function relationPlans(candidate) {
  const plans = new Map();
  for (const object of candidate.objects) {
    const expected = relationExpected(object); const key = `${expected.equipmentKey}|${expected.skillKey}`;
    const list = plans.get(expected.equipmentKey) ?? [];
    if (list.some(item => item.key === key)) fail(`候选关系重复：${key}`);
    list.push({ key, object, expected }); plans.set(expected.equipmentKey, list);
  }
  return plans;
}

async function apiRequest(route, options = {}) {
  const method = options.method ?? 'GET';
  const requestOptions = { method, headers: { Authorization: `Bearer ${API_TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) };
  if (options.body !== undefined) { requestOptions.headers['Content-Type'] = 'application/json'; requestOptions.body = JSON.stringify(options.body); }
  try {
    const response = await fetch(API_ROOT + route, requestOptions);
    const raw = await response.text(); let data = null;
    if (raw) { try { data = JSON.parse(raw); } catch (error) { return { route, method, status: response.status, ok: response.ok, data: null, error: `非JSON响应：${String(error)}` }; } }
    return { route, method, status: response.status, ok: response.ok, data };
  } catch (error) { return { route, method, status: null, ok: false, data: null, error: String(error) }; }
}
async function writeJournal(file, event) { await appendFile(file, `${JSON.stringify(event)}\n`, 'utf8'); }
function snapshotMatch(expected, actual) { return expected.route === actual.route && expected.method === actual.method && expected.status === actual.status && expected.ok === actual.ok && same(expected.data, actual.data); }

function runtimeValue(parameterKey, parameter, overrides) {
  if (!Object.hasOwn(overrides, parameterKey)) throw new Error(`MISSING_RUNTIME_PARAMETER:${parameterKey}`);
  const value = overrides[parameterKey];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`INVALID_RUNTIME_PARAMETER:${parameterKey}`);
  if (parameter.valueType === 'INTEGER' && !Number.isInteger(value)) throw new Error(`INVALID_INTEGER_RUNTIME_PARAMETER:${parameterKey}`);
  return value;
}
function evaluate(node, parameters, overrides) {
  if (!node || typeof node !== 'object') throw new Error('INVALID_EXPRESSION_NODE');
  if (node.nodeType === 'PARAMETER') {
    const parameter = parameters.get(node.parameterKey);
    if (!parameter) throw new Error(`UNKNOWN_PARAMETER:${node.parameterKey}`);
    if (parameter.valueMode === 'FIXED') return parameter.fixedValue;
    if (parameter.valueMode === 'RUNTIME_INPUT') return runtimeValue(node.parameterKey, parameter, overrides);
    throw new Error(`UNSUPPORTED_VALUE_MODE:${node.parameterKey}`);
  }
  if (node.nodeType === 'ATTRIBUTE') throw new Error(`ATTRIBUTE_NOT_PROVIDED:${node.attributeKey}`);
  if (node.nodeType === 'FORMULA') throw new Error(`FORMULA_REFERENCE_NOT_ALLOWED:${node.formulaKey}`);
  if (node.nodeType !== 'OPERATION') throw new Error(`UNSUPPORTED_NODE:${node.nodeType}`);
  const operands = node.operands ?? [];
  if (!operands.length) throw new Error(`EMPTY_OPERATION:${node.operation}`);
  const values = operands.map(child => evaluate(child, parameters, overrides));
  if (node.operation === 'ADD') return values.reduce((sum, value) => sum + value, 0);
  if (node.operation === 'MULTIPLY') return values.reduce((product, value) => product * value, 1);
  if (node.operation === 'MIN') return Math.min(...values);
  throw new Error(`UNSUPPORTED_OPERATION:${node.operation}`);
}
function approx(actual, expected, epsilon = 1e-9) { return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= epsilon; }
function runPositive(name, object, actualFormula, actualParameters, overrides, expected) {
  let actual = null; let error = null;
  try { actual = evaluate(actualFormula.expression, actualParameters, overrides); } catch (caught) { error = String(caught); }
  return { name, skillKey: object.skillKey, formulaKey: actualFormula.formulaKey, overrides, expected, actual, error, pass: error === null && approx(actual, expected) };
}
function runReject(name, object, actualFormula, actualParameters, overrides, expectedError) {
  let error = null;
  try { evaluate(actualFormula.expression, actualParameters, overrides); } catch (caught) { error = String(caught); }
  return { name, skillKey: object.skillKey, formulaKey: actualFormula.formulaKey, overrides, expectedError, error, rejected: error !== null, pass: error === expectedError };
}

async function readAllComponentLists(candidate, journalPath, output, requestReads) {
  const componentLists = [];
  // 列表接口的公式项只返回元数据；完整公式表达式来自上面的逐项公式GET。
  const actualParameters = new Map(); const actualFormulas = new Map();
  for (const row of requestReads) {
    if (!row.response.ok || !row.response.data) continue;
    if (row.request.kind === 'parameter') actualParameters.set(`${row.request.skillKey}/${row.request.body.parameterKey}`, stripServerFields(row.response.data, 'parameter'));
    if (row.request.kind === 'formula') actualFormulas.set(`${row.request.skillKey}/${row.request.body.formulaKey}`, stripServerFields(row.response.data, 'formula'));
  }
  for (const object of candidate.objects) {
    const skillPath = `/skills/${encodeURIComponent(object.skillKey)}`;
    for (const [field, endpoint] of LIST_ENDPOINTS) {
      const route = `${skillPath}/${endpoint}`;
      const response = await apiRequest(route);
      let items = null; let error = null;
      try { items = listItems(response, route); } catch (caught) { error = String(caught); }
      const expectedItems = object.apiPayload[field] ?? [];
      const actualItems = items?.map(item => stripServerFields(item, field === 'parameters' ? 'parameter' : field === 'formulas' ? 'formula' : field === 'internalStates' ? 'internalState' : field === 'triggerRules' ? 'triggerRule' : field)) ?? null;
      const projectListItem = (item) => {
        if (field !== 'formulas' || !item || typeof item !== 'object') return item;
        const projected = { ...item };
        delete projected.expression;
        return projected;
      };
      // 公式列表端点不返回expression；表达式的完整性由48条逐项GET和后续实值核算共同覆盖。
      const expectedComparable = expectedItems.map(projectListItem);
      const actualComparable = actualItems?.map(projectListItem) ?? null;
      const fields = error ? [{ path: 'error', expected: null, actual: error, equal: false }] : differences(normalize(expectedComparable), normalize(actualComparable));
      const check = { equipmentKey: object.equipmentKey, skillKey: object.skillKey, componentKind: field, route, response, expectedCount: expectedItems.length, actualCount: actualItems?.length ?? null, expressionValidatedByDetailGET: field === 'formulas', fields, pass: !error && fields.every(fieldRow => fieldRow.equal) };
      componentLists.push(check);
      await writeJournal(journalPath, { action: '完整组成列表GET', ...check });
    }
  }
  output.componentLists = componentLists;
  output.actualParameterCount = actualParameters.size;
  output.actualFormulaCount = actualFormulas.size;
  return { componentLists, actualParameters, actualFormulas };
}

function runBusinessMath(candidate, actualParameters, actualFormulas) {
  const getActual = (object, kind, key) => {
    const map = kind === 'formula' ? actualFormulas : actualParameters;
    const value = map.get(`${object.skillKey}/${key}`);
    if (!value) fail(`业务GET缺少${kind}：${object.skillKey}/${key}`);
    return value;
  };
  const parametersFor = object => new Map(object.apiPayload.parameters.map(parameter => {
    const actual = getActual(object, 'parameter', parameter.parameterKey);
    return [parameter.parameterKey, actual];
  }));
  const formulas = [
    ['不朽之路五层', 'item_3168', 'stacked_omnivamp', { actual_stacks: 5 }, 0.03],
    ['迅速进军移动速度400', 'item_3170', 'adaptive_force_from_move_speed', { actual_source_move_speed: 400 }, 20],
    ['猩红明朗远程比例', 'item_3171', 'ranged_move_speed_ratio', {}, 0.08],
    ['带链碾碎者护盾', 'item_3173', 'magic_shield_value', { actual_level_base_shield: 100, source_mstat12_formula2_value: 500 }, 140],
    ['装甲战靴护盾', 'item_3174', 'physical_shield_value', { actual_level_base_shield: 100, source_mstat12_formula2_value: 500 }, 140],
  ];
  const positives = formulas.map(([name, equipmentKey, formulaKey, overrides, expected]) => {
    const object = candidate.objects.find(item => item.equipmentKey === equipmentKey);
    return runPositive(name, object, getActual(object, 'formula', formulaKey), parametersFor(object), overrides, expected);
  });
  const stackObject = candidate.objects.find(item => item.equipmentKey === 'item_3168');
  const stackFormula = getActual(stackObject, 'formula', 'stacked_omnivamp');
  const stackParameters = parametersFor(stackObject);
  const caps = [9, 10, 11].map(actual_stacks => runPositive(`不朽之路层数${actual_stacks}`, stackObject, stackFormula, stackParameters, { actual_stacks }, Math.min(actual_stacks, 10) * 0.006));
  const missing = [
    ['不朽之路缺层数', 'item_3168', 'stacked_omnivamp', {}, 'Error: MISSING_RUNTIME_PARAMETER:actual_stacks'],
    ['迅速进军缺移动速度', 'item_3170', 'adaptive_force_from_move_speed', {}, 'Error: MISSING_RUNTIME_PARAMETER:actual_source_move_speed'],
    ['带链碾碎者缺基础护盾', 'item_3173', 'magic_shield_value', { source_mstat12_formula2_value: 500 }, 'Error: MISSING_RUNTIME_PARAMETER:actual_level_base_shield'],
    ['装甲战靴缺基础护盾', 'item_3174', 'physical_shield_value', { source_mstat12_formula2_value: 500 }, 'Error: MISSING_RUNTIME_PARAMETER:actual_level_base_shield'],
  ].map(([name, equipmentKey, formulaKey, overrides, expectedError]) => {
    const object = candidate.objects.find(item => item.equipmentKey === equipmentKey);
    return runReject(name, object, getActual(object, 'formula', formulaKey), parametersFor(object), overrides, expectedError);
  });
  const integerObject = stackObject;
  const integerReject = runReject('层数拒绝小数0.5', integerObject, stackFormula, stackParameters, { actual_stacks: 0.5 }, 'Error: INVALID_INTEGER_RUNTIME_PARAMETER:actual_stacks');
  const shieldNoDefault = ['item_3173', 'item_3174'].map(equipmentKey => {
    const object = candidate.objects.find(item => item.equipmentKey === equipmentKey);
    const parameter = parametersFor(object).get('actual_level_base_shield');
    const formulaKey = equipmentKey === 'item_3173' ? 'magic_shield_value' : 'physical_shield_value';
    const rejection = runReject(`${equipmentKey}基础护盾无默认`, object, getActual(object, 'formula', formulaKey), parametersFor(object), { source_mstat12_formula2_value: 500 }, 'Error: MISSING_RUNTIME_PARAMETER:actual_level_base_shield');
    return { equipmentKey, parameter: { valueType: parameter?.valueType, valueMode: parameter?.valueMode, fixedValue: parameter?.fixedValue, levelValues: parameter?.levelValues }, missingEvaluation: rejection, pass: parameter?.valueType === 'DECIMAL' && parameter?.valueMode === 'RUNTIME_INPUT' && parameter?.fixedValue === null && parameter?.levelValues === null && rejection.pass };
  });
  const allPass = positives.every(item => item.pass) && caps.every(item => item.pass) && missing.every(item => item.pass) && integerReject.pass && shieldNoDefault.every(item => item.pass) && actualParameters.size === 28 && actualFormulas.size === 5;
  return { actualParameterCount: actualParameters.size, actualFormulaCount: actualFormulas.size, positiveCases: positives, capCases: caps, missingValueRejections: missing, integerTypeRejection: integerReject, shieldLevelNoDefault: shieldNoDefault, allPass, businessMathReady: allPass };
}

function findWriterEvidence() {
  if (!fs.existsSync(ARTIFACT_ROOT)) return null;
  const rows = [];
  for (const name of fs.readdirSync(ARTIFACT_ROOT).filter(value => value.startsWith('writer-')).sort().reverse()) {
    const file = path.join(ARTIFACT_ROOT, name, '执行记录.json');
    if (!fs.existsSync(file)) continue;
    try {
      const record = readJson(file);
      if (record.mode !== '显式补缺写入' || record.candidateSha256 !== EXPECTED.candidateSha256 || record.requestSha256 !== EXPECTED.requestSha256) continue;
      rows.push({ path: file, runId: record.runId, mode: record.mode, errors: record.errors ?? [], requestEvents: record.requestEvents?.length ?? 0, writes: record.apiWrites ?? 0, finishedAt: record.finishedAt });
    } catch { /* 保留其他流水，不让坏记录伪装成成功证据 */ }
  }
  return rows[0] ?? null;
}

async function run() {
  const startedAt = new Date().toISOString();
  const runId = startedAt.replace(/[:.]/g, '-');
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const runDir = path.join(ARTIFACT_ROOT, `readback-${runId}`);
  await mkdir(runDir, { recursive: true });
  const journalPath = path.join(runDir, '所有GET原始响应.jsonl');
  const resultPath = path.join(runDir, '独立回读与实值核算.json');
  const output = { runId, startedAt, mode: '写入后独立只读回读', apiRoot: API_ROOT, noBusinessWrites: true, apiWrites: 0, errors: [], runDir, requestReads: [], protections: [], componentLists: [], finalRelations: [], currentState: null, math: null };
  let candidate; let request; let source; let before;
  try {
    candidate = readJson(CANDIDATE_PATH); request = readJson(REQUEST_PATH); source = readJson(SOURCE_PATH); before = readJson(BEFORE_PATH);
    const hashes = { candidateSha256: fileSha256(CANDIDATE_PATH), requestSha256: fileSha256(REQUEST_PATH), sourceSha256: fileSha256(SOURCE_PATH), beforeSha256: fileSha256(BEFORE_PATH) };
    assert.deepEqual(hashes, EXPECTED, '回读输入文件哈希不符');
    output.candidateSha256 = hashes.candidateSha256; output.requestSha256 = hashes.requestSha256; output.sourceSha256 = hashes.sourceSha256; output.beforeSha256 = hashes.beforeSha256;
    const writerEvidence = findWriterEvidence();
    if (!writerEvidence) fail('找不到当前修正版对应的显式写入流水');
    if (writerEvidence.errors.length) fail(`写入流水存在错误：${JSON.stringify(writerEvidence.errors)}`);
    if (writerEvidence.requestEvents !== 48) fail(`写入流水请求事件不是48项：${writerEvidence.requestEvents}`);
    output.writerEvidence = writerEvidence;
    const plans = relationPlans(candidate);
    for (const requestRow of request.requests) {
      const object = objectFor(candidate, requestRow.skillKey);
      const response = await apiRequest(requestRow.readRoute);
      const comparison = compareRequest(object, requestRow, response, plans, before);
      const row = { index: output.requestReads.length, request: requestRow, response, comparison, pass: comparison.state === 'same' };
      output.requestReads.push(row);
      await writeJournal(journalPath, { action: '逐请求写后GET', ...row });
    }
    const protectionKinds = ['equipmentGET', 'equipmentAttributesGET', 'representativeImageGET'];
    const currentState = { equipment: [], attributes: [], representativeImages: [], skills: [], relations: [], components: [], categories: null };
    for (const key of SELECTED_EQUIPMENT) {
      const object = candidate.objects.find(item => item.equipmentKey === key);
      const itemState = { equipmentKey: key, equipment: null, attributes: null, representativeImage: null };
      for (const kind of protectionKinds) {
        const row = before.rows.find(value => value.kind === kind && value.equipmentKey === key);
        const response = await apiRequest(row.response.route);
        const match = snapshotMatch(row.response, response);
        const check = { kind, equipmentKey: key, route: row.response.route, expected: row.response, actual: response, match };
        output.protections.push(check);
        await writeJournal(journalPath, { action: '主体属性原图保护GET', ...check });
        if (kind === 'equipmentGET') itemState.equipment = response;
        if (kind === 'equipmentAttributesGET') itemState.attributes = response;
        if (kind === 'representativeImageGET') itemState.representativeImage = response;
      }
      currentState.equipment.push(itemState.equipment); currentState.attributes.push(itemState.attributes); currentState.representativeImages.push(itemState.representativeImage);
      const skillRoute = `/skills/${encodeURIComponent(object.skillKey)}`;
      const skillResponse = await apiRequest(skillRoute);
      const skillRequest = request.requests.find(value => value.kind === 'skill' && value.skillKey === object.skillKey);
      const skillComparison = compareRequest(object, skillRequest, skillResponse, plans, before);
      const skillCheck = { equipmentKey: key, skillKey: object.skillKey, route: skillRoute, response: skillResponse, comparison: skillComparison, pass: skillComparison.state === 'same' };
      currentState.skills.push(skillCheck); await writeJournal(journalPath, { action: '技能主体完整GET', ...skillCheck });
      const relationRoute = `/equipment-skill-relations?equipmentKey=${encodeURIComponent(key)}`;
      const relationResponse = await apiRequest(relationRoute);
      const relationComparison = relationState(object, relationResponse, plans);
      const relationCheck = { equipmentKey: key, route: relationRoute, response: relationResponse, comparison: relationComparison, pass: relationComparison.state === 'same' && relationComparison.exact === true };
      output.finalRelations.push(relationCheck); currentState.relations.push(relationCheck); await writeJournal(journalPath, { action: '关联精确集合GET', ...relationCheck });
    }
    const categoryResponse = await apiRequest('/skill-categories');
    let categoryItems = []; let categoryError = null;
    try { categoryItems = listItems(categoryResponse, '/skill-categories'); } catch (error) { categoryError = String(error); }
    const required = [...new Set(candidate.objects.flatMap(object => object.apiPayload.skill.skillCategoryKeys ?? []))];
    const available = categoryItems.map(item => item.skillCategoryKey);
    const missing = required.filter(key => !available.includes(key));
    const disabled = required.filter(key => categoryItems.find(item => item.skillCategoryKey === key)?.status !== 'ENABLED');
    const categoryCheck = { route: '/skill-categories', response: categoryResponse, required, available, missing, disabled, error: categoryError, pass: !categoryError && categoryResponse.ok && missing.length === 0 && disabled.length === 0 };
    currentState.categories = categoryCheck; await writeJournal(journalPath, { action: '技能分类GET', ...categoryCheck });
    const actual = await readAllComponentLists(candidate, journalPath, output, output.requestReads);
    currentState.components = output.componentLists; output.currentState = currentState;
    output.math = runBusinessMath(candidate, actual.actualParameters, actual.actualFormulas);
    output.readbackCounts = { requestReads: output.requestReads.length, requestMatches: output.requestReads.filter(item => item.pass).length, protections: output.protections.length, protectionMatches: output.protections.filter(item => item.match).length, skills: currentState.skills.length, skillMatches: currentState.skills.filter(item => item.pass).length, finalRelations: output.finalRelations.length, relationMatches: output.finalRelations.filter(item => item.pass).length, componentLists: output.componentLists.length, componentMatches: output.componentLists.filter(item => item.pass).length, categoryGets: 1, categoryPass: categoryCheck.pass };
    output.readbackComplete = output.requestReads.length === 48 && output.requestReads.every(item => item.pass) && output.protections.length === 15 && output.protections.every(item => item.match) && currentState.skills.length === 5 && currentState.skills.every(item => item.pass) && output.finalRelations.length === 5 && output.finalRelations.every(item => item.pass) && output.componentLists.length === 30 && output.componentLists.every(item => item.pass) && categoryCheck.pass;
    output.businessMathReady = output.readbackComplete && output.math.businessMathReady;
    if (!output.readbackComplete) output.errors.push({ message: '独立回读存在不匹配或不完整列表' });
    if (!output.math.businessMathReady) output.errors.push({ message: '实际业务GET数学核算未全部通过' });
    output.finishedAt = new Date().toISOString();
    await writeFile(path.join(runDir, '当前状态.json'), `${JSON.stringify(currentState, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    output.errors.push({ message: String(error), stack: error?.stack ?? null });
    output.finishedAt = new Date().toISOString();
    await writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  }
  console.log(JSON.stringify({ mode: output.mode, runId, candidateSha256: output.candidateSha256 ?? null, requestSha256: output.requestSha256 ?? null, writerRunId: output.writerEvidence?.runId ?? null, readbackComplete: output.readbackComplete ?? false, businessMathReady: output.businessMathReady ?? false, readbackCounts: output.readbackCounts ?? null, errors: output.errors, runDir }, null, 2));
  if (output.errors.length) process.exitCode = 1;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
