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
const LOCK_PATH = path.join(HERE, '修正版最终写入锁.json');
const EXPECTED = {
  candidateSha256: '9dc1b9628720c0afc91d9e835649ae6899dd9bfcbacac136fae7c7081ab79f62',
  requestSha256: '873602b2c17d2db51d58f32a4b9cbb0e3e9d9e87d88c372c744ebd190ec3d902',
  sourceSha256: '3861cdd2d66da43deb99aca9c085c894258f58a21bfdfc967b9feaa71203e649',
  beforeSha256: 'b928abf4069b9a1b65f5eba0801bc3ecf72035b86f793eee523e440222aef463',
};
const SELECTED_EQUIPMENT = ['item_3168', 'item_3170', 'item_3171', 'item_3173', 'item_3174'];
const EXPECTED_TOTALS = {
  equipment: 5, skills: 5, parameters: 28, formulas: 5, effects: 0, processes: 0,
  internalStates: 0, triggerRules: 0, relations: 5, representativeImages: 5,
};
const EXPECTED_REQUEST_SUMMARY = {
  skill: 5, parameter: 28, formula: 5, relation: 5, representativeImage: 5, total: 48,
};

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
  throw new Error('只允许默认只读预检或显式 --apply');
}
const APPLY = args[0] === '--apply';

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
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryKey, entryValue]) => [entryKey, normalize(entryValue, entryKey)]),
    );
  }
  return value;
}

function same(left, right) { return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right)); }

// 完整递归比较；展示时可以截取，判定本身不得截断。
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
    for (let index = 0; index < Math.max(expected.length, actual.length); index += 1) {
      differences(expected[index], actual[index], `${currentPath}[${index}]`, rows);
    }
    return rows;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    differences(expected[key], actual[key], currentPath ? `${currentPath}.${key}` : key, rows);
  }
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
  if (!Array.isArray(response.data) && response.data?.total != null && Number(response.data.total) !== items.length) {
    fail(`列表未完整读取：${route}`);
  }
  return items;
}

function objectFor(candidate, skillKey) {
  const object = candidate.objects.find(item => item.skillKey === skillKey);
  if (!object) fail(`候选缺少技能：${skillKey}`);
  return object;
}

function relationExpected(object) {
  return {
    ...object.apiPayload.relation,
    equipmentName: object.equipmentName,
    skillName: object.apiPayload.skill.name,
    skillStatus: object.apiPayload.skill.status,
  };
}

function imageCore(data) {
  const image = data && Object.hasOwn(data, 'image') ? data.image : data;
  if (!image || typeof image !== 'object' || Array.isArray(image)) return null;
  return { imageKey: image.imageKey, name: image.name, enabled: image.enabled };
}

function imageExpected(object, before) {
  const row = before.rows.find(item => item.kind === 'representativeImageGET' && item.equipmentKey === object.equipmentKey);
  const beforeImage = row?.response?.data?.image;
  return {
    imageKey: object.apiPayload.representativeImage.imageKey,
    name: beforeImage?.name,
    enabled: true,
  };
}

function expectedBody(object, request) {
  if (request.kind === 'skill') return object.apiPayload.skill;
  if (request.kind === 'parameter') return object.apiPayload.parameters.find(item => item.parameterKey === request.body.parameterKey);
  if (request.kind === 'formula') return object.apiPayload.formulas.find(item => item.formulaKey === request.body.formulaKey);
  if (request.kind === 'relation') return object.apiPayload.relation;
  if (request.kind === 'representativeImage') return object.apiPayload.representativeImage;
  return undefined;
}

function createRequests(candidate) {
  const requests = [];
  for (const object of candidate.objects) {
    const skillPath = `/skills/${encodeURIComponent(object.skillKey)}`;
    const payload = object.apiPayload;
    requests.push({ kind: 'skill', equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'POST', route: '/skills', readRoute: skillPath, body: payload.skill });
    for (const body of payload.parameters ?? []) requests.push({ kind: 'parameter', equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'POST', route: `${skillPath}/parameters`, readRoute: `${skillPath}/parameters/${encodeURIComponent(body.parameterKey)}`, body });
    for (const body of payload.formulas ?? []) requests.push({ kind: 'formula', equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'POST', route: `${skillPath}/formulas`, readRoute: `${skillPath}/formulas/${encodeURIComponent(body.formulaKey)}`, body });
    for (const kind of ['effects', 'processes', 'internalStates', 'triggerRules']) if ((payload[kind] ?? []).length) fail(`${object.skillKey}不应生成${kind}`);
    requests.push({ kind: 'relation', equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'POST', route: '/equipment-skill-relations', readRoute: `/equipment-skill-relations?equipmentKey=${encodeURIComponent(object.equipmentKey)}`, body: payload.relation });
    requests.push({ kind: 'representativeImage', equipmentKey: object.equipmentKey, skillKey: object.skillKey, method: 'PUT', route: `${skillPath}/representative-image`, readRoute: `${skillPath}/representative-image`, body: payload.representativeImage });
  }
  return requests;
}

function relationPlans(candidate) {
  const plans = new Map();
  for (const object of candidate.objects) {
    const expected = relationExpected(object);
    const key = `${expected.equipmentKey}|${expected.skillKey}`;
    const list = plans.get(expected.equipmentKey) ?? [];
    if (list.some(item => item.key === key)) fail(`候选关系重复：${key}`);
    list.push({ key, object, expected });
    plans.set(expected.equipmentKey, list);
  }
  return plans;
}

function relationState(object, response, plans) {
  if (!response.ok) return { state: 'conflict', fields: [], error: `关系列表GET失败：HTTP ${response.status}` };
  let items;
  try { items = listItems(response, response.route); } catch (error) { return { state: 'conflict', fields: [], error: String(error) }; }
  const expectedPlans = plans.get(object.equipmentKey) ?? [];
  const expectedByKey = new Map(expectedPlans.map(item => [item.key, item]));
  const seen = new Set(); const invalid = []; const mismatches = [];
  for (const item of items) {
    const key = `${item.equipmentKey}|${item.skillKey}`;
    if (seen.has(key)) invalid.push({ reason: '重复关系', key });
    seen.add(key);
    const plan = expectedByKey.get(key);
    if (!plan) {
      invalid.push({ reason: '计划外关系', key, item });
      continue;
    }
    const fields = differences(normalize(plan.expected), normalize(stripServerFields(item, 'relation')));
    if (fields.some(field => !field.equal)) mismatches.push({ key, fields });
  }
  if (invalid.length || mismatches.length) return { state: 'conflict', fields: mismatches, invalid, error: '关系集合含计划外项、重复项或同键异值' };
  const allExpectedPresent = expectedPlans.every(plan => seen.has(plan.key));
  return {
    state: allExpectedPresent && items.length === expectedPlans.length ? 'same' : 'missing',
    fields: [], itemCount: items.length, plannedCount: expectedPlans.length,
    actualKeys: [...seen], expectedKeys: expectedPlans.map(plan => plan.key), exact: allExpectedPresent && items.length === expectedPlans.length,
  };
}

function compareRequest(object, request, response, plans, before) {
  if (request.kind === 'relation') return relationState(object, response, plans);
  if (request.kind === 'representativeImage') {
    if (response.status === 404) return { state: 'missing', fields: [] };
    if (!response.ok) return { state: 'conflict', fields: [], error: `GET失败：HTTP ${response.status}` };
    const actual = imageCore(response.data);
    // 代表图接口200但image为null表示缺失；已有异图或禁用图必须冲突。
    if (!actual) return { state: 'missing', fields: [] };
    const fields = differences(normalize(imageExpected(object, before)), normalize(actual));
    return { state: fields.every(field => field.equal) ? 'same' : 'conflict', fields };
  }
  if (response.status === 404) return { state: 'missing', fields: [] };
  if (!response.ok) return { state: 'conflict', fields: [], error: `GET失败：HTTP ${response.status}` };
  const expected = expectedBody(object, request);
  if (!expected) return { state: 'conflict', fields: [], error: '请求没有对应候选载荷' };
  const actual = stripServerFields(response.data, request.kind === 'skill' ? 'skill' : request.kind);
  const fields = differences(normalize(expected), normalize(actual));
  return { state: fields.every(field => field.equal) ? 'same' : 'conflict', fields };
}

function guardSelfChecks(candidate, before) {
  const expected = { expression: { metadata: Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`field${index + 1}`, index])) } };
  const actual = clone(expected);
  actual.expression.metadata.field31 = 999;
  const deepFields = differences(normalize(expected), normalize(actual));
  assert.ok(deepFields.some(field => field.path.endsWith('field31') && !field.equal), '第31字段深层差异没有被发现');
  const object = candidate.objects[0];
  const wideObject = clone(object);
  const wideFormula = { formulaKey: 'guard_formula', name: '保护校验公式', description: '仅用于校验深层差异', expression: expected, sortOrder: 999 };
  wideObject.apiPayload.formulas = [wideFormula];
  const wideRequest = { kind: 'formula', equipmentKey: object.equipmentKey, skillKey: object.skillKey, body: wideFormula };
  const wideResponse = { route: `/skills/${encodeURIComponent(object.skillKey)}/formulas/guard_formula`, method: 'GET', status: 200, ok: true, data: { ...wideFormula, expression: actual } };
  const wideState = compareRequest(wideObject, wideRequest, wideResponse, relationPlans(candidate), before);
  assert.equal(wideState.state, 'conflict', '第31字段深层公式差异错误地通过');
  const imageRequest = { kind: 'representativeImage', equipmentKey: object.equipmentKey, skillKey: object.skillKey, body: object.apiPayload.representativeImage };
  const emptyImage = { route: `/skills/${encodeURIComponent(object.skillKey)}/representative-image`, method: 'GET', status: 200, ok: true, data: { image: null } };
  const emptyState = compareRequest(object, imageRequest, emptyImage, relationPlans(candidate), before);
  assert.equal(emptyState.state, 'missing', '200空代表图没有进入可写缺失态');
  const differentImage = { ...emptyImage, data: { image: { imageKey: 'item_other', name: 'item_other', enabled: true } } };
  const differentState = compareRequest(object, imageRequest, differentImage, relationPlans(candidate), before);
  assert.equal(differentState.state, 'conflict', '已有异图错误地进入了可写缺失态');
  return { deepDifferenceDetected: true, deepDifferencePath: deepFields.find(field => field.path.endsWith('field31') && !field.equal)?.path, deepComparatorState: wideState.state, emptyImageState: emptyState.state, differentImageState: differentState.state };
}

function staticValidate(candidate, request, source, before) {
  const hashes = { candidateSha256: fileSha256(CANDIDATE_PATH), requestSha256: fileSha256(REQUEST_PATH), sourceSha256: fileSha256(SOURCE_PATH), beforeSha256: fileSha256(BEFORE_PATH) };
  assert.deepEqual(hashes, EXPECTED, '输入文件哈希不符');
  assert.equal(candidate.sourceFreezeSha256, EXPECTED.sourceSha256, '候选未绑定冻结来源');
  assert.equal(candidate.currentSnapshotSha256, EXPECTED.beforeSha256, '候选未绑定写前快照');
  assert.deepEqual(candidate.objects.map(item => item.equipmentKey), SELECTED_EQUIPMENT, '候选装备范围或顺序不符');
  assert.deepEqual(candidate.totals, EXPECTED_TOTALS, '候选总计不符');
  assert.equal(candidate.apiWrites, 0, '候选标记已有业务写入');
  assert.equal(before.apiWrites, 0, '写前快照标记已有业务写入');
  assert.equal(before.noBusinessWrites, true, '写前快照缺少只读标记');
  assert.equal(request.noApply, true, '请求缺少noApply标记');
  assert.equal(request.apiWrites, 0, '请求标记已有业务写入');
  assert.deepEqual(request.requestSummary, EXPECTED_REQUEST_SUMMARY, '请求计数不符');
  assert.equal(request.candidateSha256, EXPECTED.candidateSha256, '请求中的候选哈希不符');
  assert.equal(request.sourceSha256, EXPECTED.sourceSha256, '请求中的来源哈希不符');
  assert.equal(request.beforeSha256, EXPECTED.beforeSha256, '请求中的快照哈希不符');
  assert.equal(source.businessWrites, 0, '冻结来源已有业务写入');
  for (const object of candidate.objects) {
    assert.deepEqual(object.apiPayload.skill.skillCategoryKeys, ['passive'], `${object.skillKey}分类不是passive`);
    assert.equal(object.apiPayload.parameters.some(parameter => ['shield_breakpoint_level', 'shield_bonus_per_level'].includes(parameter.parameterKey)), false, `${object.skillKey}仍含断点说明参数`);
  }
  const stack = candidate.objects.find(object => object.equipmentKey === 'item_3168').apiPayload.parameters.find(parameter => parameter.parameterKey === 'actual_stacks');
  assert.deepEqual({ valueType: stack.valueType, valueMode: stack.valueMode, fixedValue: stack.fixedValue, levelValues: stack.levelValues }, { valueType: 'INTEGER', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null }, '层数输入形态不符');
  const shieldInputs = candidate.objects.filter(object => ['item_3173', 'item_3174'].includes(object.equipmentKey)).map(object => object.apiPayload.parameters.find(parameter => parameter.parameterKey === 'actual_level_base_shield'));
  assert.ok(shieldInputs.every(parameter => parameter?.valueType === 'DECIMAL' && parameter.valueMode === 'RUNTIME_INPUT' && parameter.fixedValue === null && parameter.levelValues === null), '基础护盾输入不符');
  const generated = createRequests(candidate);
  assert.equal(generated.length, 48, '候选生成请求不是48项');
  assert.equal(request.requests.length, 48, '最终请求不是48项');
  const requestDifferences = [];
  for (let index = 0; index < generated.length; index += 1) {
    for (const key of ['kind', 'equipmentKey', 'skillKey', 'method', 'route', 'readRoute', 'body']) {
      if (!same(generated[index][key], request.requests[index][key])) requestDifferences.push({ index, key, expected: generated[index][key], actual: request.requests[index][key] });
    }
  }
  assert.equal(requestDifferences.length, 0, `最终请求与候选生成结果不一致：${JSON.stringify(requestDifferences.slice(0, 3))}`);
  assert.equal(before.rows.length, 25, '写前保护快照不是25条主体、属性、图、关系和目标技能GET');
  assert.equal(before.counts?.totalGets, 26, '写前保护快照总GET不是26');
  const guardChecks = guardSelfChecks(candidate, before);
  return { hashes, requestCount: generated.length, requestDifferences, beforeRows: before.rows.length, sourceStage: source.stage ?? null, guardChecks };
}

async function apiRequest(route, options = {}) {
  const method = options.method ?? 'GET';
  const requestOptions = {
    method,
    headers: { Authorization: `Bearer ${API_TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  };
  if (options.body !== undefined) {
    requestOptions.headers['Content-Type'] = 'application/json';
    requestOptions.body = JSON.stringify(options.body);
  }
  try {
    const response = await fetch(API_ROOT + route, requestOptions);
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

async function writeJournal(journalPath, event) { await appendFile(journalPath, `${JSON.stringify(event)}\n`, 'utf8'); }

async function verifySkillCategories(candidate, journalPath, snapshot) {
  const route = '/skill-categories';
  const response = await apiRequest(route);
  let items = []; let error = null;
  if (response.ok) {
    try { items = listItems(response, route); } catch (caught) { error = String(caught); }
  } else error = `分类列表GET失败：HTTP ${response.status}`;
  const required = [...new Set(candidate.objects.flatMap(object => object.apiPayload.skill.skillCategoryKeys ?? []))];
  const available = items.map(item => item.skillCategoryKey);
  const missing = required.filter(key => !available.includes(key));
  const disabled = required.filter(key => items.find(item => item.skillCategoryKey === key)?.status !== 'ENABLED');
  const snapshotCategory = snapshot.category?.data;
  const snapshotKeys = snapshotCategory?.items?.map(item => item.skillCategoryKey) ?? [];
  const result = { route, response, required, available, missing, disabled, snapshotKeys, pass: !error && missing.length === 0 && disabled.length === 0 && snapshot.category?.status === 200, error };
  await writeJournal(journalPath, { action: '技能分类存在性预检', ...result });
  if (!result.pass) fail(`技能分类存在性预检失败：${JSON.stringify(result)}`);
  return result;
}

function snapshotMatch(expected, actual) {
  return expected.route === actual.route && expected.method === actual.method && expected.status === actual.status && expected.ok === actual.ok && same(expected.data, actual.data);
}

async function verifyWriteBeforeSnapshot(before, journalPath) {
  const checks = [];
  for (const row of before.rows) {
    const expected = row.response;
    const actual = await apiRequest(expected.route);
    const match = snapshotMatch(expected, actual);
    const result = { phase: '写入前保护GET', kind: row.kind, equipmentKey: row.equipmentKey, skillKey: row.skillKey, route: expected.route, expected: { status: expected.status, ok: expected.ok, data: expected.data }, actual, match };
    checks.push(result);
    await writeJournal(journalPath, { action: '写入前保护GET', ...result });
    if (!match) fail(`写入前保护GET与快照不一致：${expected.route}`);
  }
  assert.equal(checks.length, 25, '写入前保护GET不是25项');
  return { count: checks.length, passed: checks.filter(item => item.match).length, checks };
}

function assertHashesUnchanged(hashes) {
  const current = { candidateSha256: fileSha256(CANDIDATE_PATH), requestSha256: fileSha256(REQUEST_PATH), sourceSha256: fileSha256(SOURCE_PATH), beforeSha256: fileSha256(BEFORE_PATH) };
  for (const key of Object.keys(hashes)) assert.equal(current[key], hashes[key], `写入期间文件变化：${key}`);
  return current;
}

async function writeOne(object, request, plans, before, journalPath, hashes, output) {
  assertHashesUnchanged(hashes);
  const beforeResponse = await apiRequest(request.readRoute);
  const beforeComparison = compareRequest(object, request, beforeResponse, plans, before);
  const base = { index: output.requestEvents.length, request, beforeResponse, beforeComparison };
  await writeJournal(journalPath, { action: '逐请求写入前GET', ...base });
  if (beforeComparison.state === 'same') {
    const event = { ...base, action: '同值跳过', written: false };
    output.requestEvents.push(event);
    await writeJournal(journalPath, event);
    return event;
  }
  if (beforeComparison.state === 'conflict') fail(`写入前同键异值或关系集合冲突：${request.readRoute}`);
  const writeResponse = await apiRequest(request.route, { method: request.method, body: request.body });
  if (!(writeResponse.status >= 200 && writeResponse.status < 300)) {
    const recoveryGet = await apiRequest(request.readRoute);
    const event = { ...base, action: '写入报错后先GET并停止', writeResponse, recoveryGet, recoveryComparison: compareRequest(object, request, recoveryGet, plans, before), written: false };
    output.requestEvents.push(event);
    await writeJournal(journalPath, event);
    fail(`业务写入失败，已先GET并停止，不重放：${request.route}`);
  }
  const afterResponse = await apiRequest(request.readRoute);
  const afterComparison = compareRequest(object, request, afterResponse, plans, before);
  const event = { ...base, action: '写后独立GET', writeResponse, afterResponse, afterComparison, written: true };
  output.requestEvents.push(event);
  await writeJournal(journalPath, event);
  if (afterComparison.state !== 'same') fail(`写后GET未得到候选值，不重放：${request.readRoute}`);
  return event;
}

async function verifyFinalRelations(candidate, plans, journalPath, output) {
  const checks = [];
  for (const equipmentKey of SELECTED_EQUIPMENT) {
    const object = candidate.objects.find(item => item.equipmentKey === equipmentKey);
    const route = `/equipment-skill-relations?equipmentKey=${encodeURIComponent(equipmentKey)}`;
    const response = await apiRequest(route);
    const comparison = relationState(object, response, plans);
    const check = { equipmentKey, route, response, comparison, pass: comparison.state === 'same' && comparison.exact === true };
    checks.push(check);
    await writeJournal(journalPath, { action: '最终关系集合GET', ...check });
    if (!check.pass) fail(`最终关系集合不精确：${route}`);
  }
  output.finalRelationChecks = checks;
  return checks;
}

async function updateLock(lock, state, output) {
  await writeFile(LOCK_PATH, `${JSON.stringify({ ...lock, state, updatedAt: new Date().toISOString(), writes: output.requestEvents.filter(event => event.written).length, skipped: output.requestEvents.filter(event => event.action === '同值跳过').length, failed: output.requestEvents.filter(event => event.action === '写入报错后先GET并停止').length, requestEvents: output.requestEvents.length }, null, 2)}\n`, 'utf8');
}

async function run() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const runDir = path.join(ARTIFACT_ROOT, `writer-${runId}`);
  await mkdir(runDir, { recursive: true });
  const journalPath = path.join(runDir, '逐请求日志.jsonl');
  const resultPath = path.join(runDir, '执行记录.json');
  const output = { runId, mode: APPLY ? '显式补缺写入' : '默认只读预检', apiRoot: API_ROOT, noBusinessWrites: !APPLY, apiWrites: 0, requestEvents: [], errors: [], runDir };
  let lock = null;
  try {
    const candidate = readJson(CANDIDATE_PATH);
    const request = readJson(REQUEST_PATH);
    const source = readJson(SOURCE_PATH);
    const before = readJson(BEFORE_PATH);
    const staticValidation = staticValidate(candidate, request, source, before);
    output.candidateSha256 = staticValidation.hashes.candidateSha256;
    output.requestSha256 = staticValidation.hashes.requestSha256;
    output.sourceSha256 = staticValidation.hashes.sourceSha256;
    output.beforeSha256 = staticValidation.hashes.beforeSha256;
    output.staticValidation = staticValidation;
    const plans = relationPlans(candidate);
    await writeJournal(journalPath, { action: '启动', runId, mode: output.mode, candidateSha256: output.candidateSha256, requestSha256: output.requestSha256, sourceSha256: output.sourceSha256, beforeSha256: output.beforeSha256, requestCount: 48, businessWriteEnabled: APPLY });
    if (APPLY) {
      if (fs.existsSync(LOCK_PATH)) fail(`已存在修正版最终写入锁，禁止重放：${LOCK_PATH}`);
      lock = { runId, state: 'STARTED', startedAt: new Date().toISOString(), candidateSha256: output.candidateSha256, requestSha256: output.requestSha256, sourceSha256: output.sourceSha256, beforeSha256: output.beforeSha256, runDir };
      await writeFile(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await writeJournal(journalPath, { action: '启动防重放锁', lockPath: LOCK_PATH, lock });
    }
    output.categoryPreflight = await verifySkillCategories(candidate, journalPath, before);
    output.writeBefore = await verifyWriteBeforeSnapshot(before, journalPath);
    if (APPLY) {
      for (const requestRow of request.requests) {
        const object = objectFor(candidate, requestRow.skillKey);
        await writeOne(object, requestRow, plans, before, journalPath, staticValidation.hashes, output);
        output.apiWrites = output.requestEvents.filter(event => event.written).length;
      }
      await verifyFinalRelations(candidate, plans, journalPath, output);
      assertHashesUnchanged(staticValidation.hashes);
      await updateLock(lock, 'COMPLETED', output);
    } else {
      output.readOnlySummary = '只完成静态核对、分类读取和写入前25项GET；未调用任何业务写接口。';
    }
  } catch (error) {
    output.errors.push({ message: String(error), stack: error?.stack ?? null });
    if (lock) {
      try { await updateLock(lock, 'ABORTED', output); } catch (lockError) { output.errors.push({ message: `更新中止锁失败：${String(lockError)}` }); }
    }
  }
  output.finishedAt = new Date().toISOString();
  await writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ mode: output.mode, runId, candidateSha256: output.candidateSha256 ?? null, requestSha256: output.requestSha256 ?? null, categoryPreflight: output.categoryPreflight?.pass ?? false, writeBeforeGETs: output.writeBefore?.count ?? 0, requestEvents: output.requestEvents.length, apiWrites: output.apiWrites, errors: output.errors, runDir }, null, 2));
  if (output.errors.length) process.exitCode = 1;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
