import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLANNING_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const ARTIFACT_ROOT = path.resolve(PLANNING_ROOT, '..', 'damage_web_dev', '.agents', 'artifacts', 'gear19-finalize');
const API_ROOT = process.env.DV_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol';
const API_TOKEN = process.env.GEAR19_API_TOKEN || 'local-entry';
const CANDIDATE_PATH = path.join(HERE, '分类修正最终候选.json');
const REQUEST_PATH = path.join(HERE, '分类修正最终请求.json');
const SOURCE_PATH = path.join(HERE, '冻结来源.json');
const BEFORE_PATH = path.join(HERE, '写前保护快照.json');
const LOCK_PATH = path.join(HERE, '分类修正最终写入锁.json');

const EXPECTED = {
  candidateSha256: 'be371ab2b79c2106f70880b94a2a894f93c4cf1d507634a37dc2c7d4078a7c1f',
  requestSha256: 'd6eb2f55d83fcbd8276efb9ac5dbf89af47bc9d7ea3571fb4dba702b3163f345',
  sourceSha256: '1ce775810bd1a252438386f6959dd8adf7a1de51224e3e055e3ffe8826ad7a79',
  beforeSha256: 'f50a3ac022bc7689dc437a5006b969a85b6ef550f305aa3bd0cf51a6ceeef057',
};

const COMPONENT_KINDS = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
const EXPECTED_TOTALS = {
  equipment: 7,
  skills: 8,
  parameters: 42,
  formulas: 11,
  effects: 0,
  processes: 0,
  internalStates: 0,
  triggerRules: 0,
  relations: 8,
  representativeImages: 8,
  components: 84,
};
const SELECTED_EQUIPMENT = [
  'item_3074',
  'item_3748',
  'item_6698',
  'item_3107',
  'item_3190',
  'item_6664',
  'item_8020',
];

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
  throw new Error('只允许默认只读预检或显式 --apply');
}
const APPLY = args[0] === '--apply';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(file) {
  return sha256(fs.readFileSync(file));
}

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

function same(left, right) {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
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
    if (expected.length !== actual.length) {
      rows.push({ path: currentPath + '.length', expected: expected.length, actual: actual.length, equal: false });
    }
    for (let index = 0; index < Math.max(expected.length, actual.length); index += 1) {
      differences(expected[index], actual[index], currentPath + '[' + index + ']', rows);
    }
    return rows;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    differences(expected[key], actual[key], currentPath ? currentPath + '.' + key : key, rows);
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
  if (!response.ok) throw new Error(route + ' HTTP ' + response.status);
  const items = Array.isArray(response.data) ? response.data : response.data?.items;
  if (!Array.isArray(items)) throw new Error('列表结构不符：' + route);
  if (response.data && !Array.isArray(response.data) && response.data.total != null
      && Number(response.data.total) !== items.length) {
    throw new Error('列表未完整读取：' + route);
  }
  return items;
}

function objectFor(candidate, skillKey) {
  const object = candidate.objects.find(item => item.skillKey === skillKey);
  if (!object) throw new Error('候选缺少技能：' + skillKey);
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

function imageCore(responseData) {
  const image = responseData && Object.hasOwn(responseData, 'image') ? responseData.image : responseData;
  if (!image || typeof image !== 'object') return null;
  return { imageKey: image.imageKey, name: image.name, enabled: image.enabled };
}

function imageExpected(object, before) {
  const equipmentRoute = '/equipment/' + object.equipmentKey + '/representative-image';
  const row = before.representativeImageGET.find(item => item.route === equipmentRoute);
  const beforeImage = row?.data?.image;
  return {
    imageKey: object.apiPayload.representativeImage.imageKey,
    name: beforeImage?.name,
    enabled: true,
  };
}

function expectedBody(object, request) {
  if (request.kind === 'skill') return object.apiPayload.skill;
  if (request.kind === 'parameters') return object.apiPayload.parameters.find(item => item.parameterKey === request.body.parameterKey);
  if (request.kind === 'formulas') return object.apiPayload.formulas.find(item => item.formulaKey === request.body.formulaKey);
  return undefined;
}

function createRequests(candidate) {
  const requests = [];
  for (const object of candidate.objects) {
    const skillPath = '/skills/' + encodeURIComponent(object.skillKey);
    requests.push({
      kind: 'skill',
      equipmentKey: object.equipmentKey,
      skillKey: object.skillKey,
      method: 'POST',
      route: '/skills',
      readRoute: skillPath,
      body: object.apiPayload.skill,
    });
    for (const [kind, idField, endpoint] of COMPONENT_KINDS) {
      for (const body of object.apiPayload[kind] ?? []) {
        const id = body[idField];
        requests.push({
          kind,
          equipmentKey: object.equipmentKey,
          skillKey: object.skillKey,
          method: 'POST',
          route: skillPath + '/' + endpoint,
          readRoute: skillPath + '/' + endpoint + '/' + encodeURIComponent(id),
          body,
        });
      }
    }
    requests.push({
      kind: 'relation',
      equipmentKey: object.equipmentKey,
      skillKey: object.skillKey,
      method: 'POST',
      route: '/equipment-skill-relations',
      readRoute: '/equipment-skill-relations?equipmentKey=' + encodeURIComponent(object.equipmentKey),
      body: object.apiPayload.relation,
    });
    requests.push({
      kind: 'image',
      equipmentKey: object.equipmentKey,
      skillKey: object.skillKey,
      method: 'PUT',
      route: skillPath + '/representative-image',
      readRoute: skillPath + '/representative-image',
      body: object.apiPayload.representativeImage,
    });
  }
  return requests;
}

function relationPlans(candidate) {
  const plans = new Map();
  for (const object of candidate.objects) {
    const relation = relationExpected(object);
    const key = relation.equipmentKey + '|' + relation.skillKey;
    const list = plans.get(relation.equipmentKey) ?? [];
    if (list.some(item => item.key === key)) throw new Error('候选关系重复：' + key);
    list.push({ key, object, expected: relation });
    plans.set(relation.equipmentKey, list);
  }
  return plans;
}

function relationState(object, response, plans) {
  if (!response.ok) {
    return { state: 'conflict', fields: [], error: '关系列表GET失败：HTTP ' + response.status };
  }
  let items;
  try {
    items = listItems(response, response.route);
  } catch (error) {
    return { state: 'conflict', fields: [], error: String(error) };
  }
  const expectedPlans = plans.get(object.equipmentKey) ?? [];
  const expectedByKey = new Map(expectedPlans.map(item => [item.key, item]));
  const seen = new Set();
  const invalid = [];
  const mismatches = [];
  for (const item of items) {
    const key = item.equipmentKey + '|' + item.skillKey;
    if (seen.has(key)) invalid.push({ reason: '重复关系', key });
    seen.add(key);
    const plan = expectedByKey.get(key);
    if (!plan) {
      invalid.push({ reason: '计划外关系', key, item });
      continue;
    }
    const fields = differences(
      normalize(plan.expected),
      normalize(stripServerFields(item, 'relation')),
    );
    if (fields.some(field => !field.equal)) mismatches.push({ key, fields });
  }
  if (invalid.length || mismatches.length) {
    return {
      state: 'conflict',
      fields: mismatches,
      error: '关系集合含计划外项、重复项或同键异值',
      invalid,
    };
  }
  const wantedKey = object.equipmentKey + '|' + object.skillKey;
  const actual = items.find(item => item.equipmentKey + '|' + item.skillKey === wantedKey);
  return {
    state: actual ? 'same' : 'missing',
    fields: [],
    itemCount: items.length,
    plannedCount: expectedPlans.length,
    exact: items.length === expectedPlans.length,
  };
}

function compareRequest(object, request, response, plans, before) {
  if (request.kind === 'relation') return relationState(object, response, plans);
  if (request.kind === 'image') {
    if (response.status === 404) return { state: 'missing', fields: [] };
    if (!response.ok) return { state: 'conflict', fields: [], error: 'GET失败：HTTP ' + response.status };
    const expected = imageExpected(object, before);
    const actual = imageCore(response.data);
    if (!actual) return { state: 'missing', fields: [] };
    const fields = differences(normalize(expected), normalize(actual));
    return { state: fields.every(field => field.equal) ? 'same' : 'conflict', fields };
  }
  if (response.status === 404) return { state: 'missing', fields: [] };
  if (!response.ok) return { state: 'conflict', fields: [], error: 'GET失败：HTTP ' + response.status };
  const expected = expectedBody(object, request);
  if (!expected) return { state: 'conflict', fields: [], error: '请求没有对应候选载荷' };
  const actual = stripServerFields(response.data, request.kind === 'skill' ? 'skill' : request.kind);
  const fields = differences(normalize(expected), normalize(actual));
  return { state: fields.every(field => field.equal) ? 'same' : 'conflict', fields };
}

function guardSelfChecks(candidate, before) {
  const expected = {
    expression: {
      metadata: Object.fromEntries(Array.from({ length: 31 }, (_, index) => ['field' + (index + 1), index])),
    },
  };
  const actual = structuredClone(expected);
  actual.expression.metadata.field31 = 999;
  const deepFields = differences(normalize(expected), normalize(actual));
  assert.ok(deepFields.some(field => field.path.endsWith('field31') && !field.equal), '第31字段深层差异没有被发现');
  assert.equal(deepFields.every(field => field.equal), false, '第31字段深层差异错误判为相同');

  const object = candidate.objects[0];
  const wideObject = structuredClone(object);
  const wideFormula = {
    formulaKey: 'guard_formula',
    name: '保护校验公式',
    description: '仅用于校验深层差异',
    expression: expected,
    sortOrder: 999,
  };
  wideObject.apiPayload.formulas = [wideFormula];
  const wideRequest = { kind: 'formulas', equipmentKey: object.equipmentKey, skillKey: object.skillKey, body: wideFormula };
  const wideResponse = {
    route: '/skills/' + encodeURIComponent(object.skillKey) + '/formulas/guard_formula',
    method: 'GET',
    status: 200,
    ok: true,
    data: { ...wideFormula, expression: actual },
  };
  const wideState = compareRequest(wideObject, wideRequest, wideResponse, relationPlans(candidate), before);
  assert.equal(wideState.state, 'conflict', '第31字段深层公式差异错误地通过');
  const imageRequest = {
    kind: 'image',
    equipmentKey: object.equipmentKey,
    skillKey: object.skillKey,
    body: object.apiPayload.representativeImage,
  };
  const emptyImage = {
    route: '/skills/' + encodeURIComponent(object.skillKey) + '/representative-image',
    method: 'GET',
    status: 200,
    ok: true,
    data: { image: null },
  };
  const emptyState = compareRequest(object, imageRequest, emptyImage, relationPlans(candidate), before);
  assert.equal(emptyState.state, 'missing', '200空代表图没有进入可写缺失态');
  const differentImage = {
    ...emptyImage,
    data: { image: { imageKey: 'item_other', name: 'item_other', enabled: true } },
  };
  const differentState = compareRequest(object, imageRequest, differentImage, relationPlans(candidate), before);
  assert.equal(differentState.state, 'conflict', '已有异图错误地进入了可写缺失态');
  return {
    deepDifferenceDetected: true,
    deepDifferencePath: deepFields.find(field => field.path.endsWith('field31') && !field.equal)?.path,
    deepComparatorState: wideState.state,
    emptyImageState: emptyState.state,
    differentImageState: differentState.state,
  };
}

function expectedSnapshotRows(before) {
  const rows = [];
  for (const key of ['equipmentGET', 'equipmentAttributesGET', 'representativeImageGET']) {
    for (const item of before[key] ?? []) rows.push({ category: key, expected: item });
  }
  for (const item of before.targetRelationGET ?? []) {
    rows.push({ category: 'targetRelationGET', expected: item.response });
  }
  for (const item of before.targetSkillGET ?? []) {
    rows.push({ category: 'targetSkillGET', expected: item.response });
  }
  return rows;
}

function staticValidate(candidate, request, source, before) {
  const hashes = {
    candidateSha256: fileSha256(CANDIDATE_PATH),
    requestSha256: fileSha256(REQUEST_PATH),
    sourceSha256: fileSha256(SOURCE_PATH),
    beforeSha256: fileSha256(BEFORE_PATH),
  };
  assert.equal(hashes.candidateSha256, EXPECTED.candidateSha256, '最终候选散列不符');
  assert.equal(hashes.requestSha256, EXPECTED.requestSha256, '最终请求散列不符');
  assert.equal(hashes.sourceSha256, EXPECTED.sourceSha256, '冻结来源散列不符');
  assert.equal(hashes.beforeSha256, EXPECTED.beforeSha256, '写前保护快照散列不符');
  assert.equal(before.apiWrites, 0, '写前保护快照已有业务写入');
  assert.equal(before.noBusinessWrites, true, '写前保护快照没有明确无业务写入标记');
  assert.equal(request.noApply, true, '最终请求缺少 noApply 标记');
  assert.equal(request.apiWrites, 0, '最终请求已有业务写入记录');
  assert.equal(request.candidateSha256, EXPECTED.candidateSha256, '请求中的候选散列不符');
  assert.equal(request.sourceSha256, EXPECTED.sourceSha256, '请求中的来源散列不符');
  assert.equal(request.beforeSha256, EXPECTED.beforeSha256, '请求中的写前散列不符');
  assert.deepEqual(candidate.objects.map(item => item.equipmentKey).filter((item, index, all) => all.indexOf(item) === index), SELECTED_EQUIPMENT, '候选装备范围或顺序不符');
  assert.deepEqual(candidate.totals, EXPECTED_TOTALS, '候选总计不符');
  const generated = createRequests(candidate);
  assert.equal(generated.length, 77, '候选生成请求不是77项');
  assert.equal(request.requests.length, 77, '最终请求不是77项');
  const requestDifferences = [];
  for (let index = 0; index < generated.length; index += 1) {
    for (const key of ['kind', 'equipmentKey', 'skillKey', 'method', 'route', 'readRoute', 'body']) {
      if (!same(generated[index][key], request.requests[index][key])) {
        requestDifferences.push({ index, key, expected: generated[index][key], actual: request.requests[index][key] });
      }
    }
  }
  assert.equal(requestDifferences.length, 0, '最终请求与候选生成结果不一致');
  assert.equal((request.requestSummary ?? {}).total, 77, '请求总计不符');
  assert.equal((request.requestSummary ?? {}).skill, 8, '技能主体请求总计不符');
  assert.equal((request.requestSummary ?? {}).parameters, 42, '参数请求总计不符');
  assert.equal((request.requestSummary ?? {}).formulas, 11, '公式请求总计不符');
  assert.equal((request.requestSummary ?? {}).relation, 8, '关系请求总计不符');
  assert.equal((request.requestSummary ?? {}).image, 8, '代表图请求总计不符');
  relationPlans(candidate);
  const guardChecks = guardSelfChecks(candidate, before);
  return {
    hashes,
    generated,
    requestDifferences,
    snapshotRows: expectedSnapshotRows(before),
    sourceStage: source.stage,
    guardChecks,
  };
}

async function apiRequest(route, options = {}) {
  const method = options.method ?? 'GET';
  const requestOptions = {
    method,
    headers: {
      Authorization: 'Bearer ' + API_TOKEN,
      Accept: 'application/json',
    },
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
      try {
        data = JSON.parse(raw);
      } catch (error) {
        return { route, method, status: response.status, ok: response.ok, data: null, error: '非JSON响应：' + String(error) };
      }
    }
    return { route, method, status: response.status, ok: response.ok, data };
  } catch (error) {
    return { route, method, status: null, ok: false, data: null, error: String(error) };
  }
}

async function verifySkillCategories(candidate, journalPath) {
  const route = '/skill-categories';
  const response = await apiRequest(route);
  let items = [];
  let error = null;
  if (response.ok) {
    try {
      items = listItems(response, route);
    } catch (caught) {
      error = String(caught);
    }
  } else {
    error = '分类列表GET失败：HTTP ' + response.status;
  }
  const required = [...new Set(candidate.objects.flatMap(object => object.apiPayload.skill.skillCategoryKeys ?? []))];
  const available = items.map(item => item.skillCategoryKey);
  const missing = required.filter(key => !available.includes(key));
  const result = {
    route,
    response,
    required,
    available,
    missing,
    pass: !error && missing.length === 0,
    error,
  };
  await writeJournal(journalPath, { action: '技能分类存在性预检', ...result });
  if (!result.pass) throw new Error('技能分类存在性预检失败：' + JSON.stringify(result));
  return result;
}

async function writeJournal(journalPath, event) {
  await appendFile(journalPath, JSON.stringify(event) + '\n', 'utf8');
}

async function verifyWriteBeforeSnapshot(before, journalPath) {
  const rows = expectedSnapshotRows(before);
  const checks = [];
  for (const row of rows) {
    const actual = await apiRequest(row.expected.route);
    const match = same(row.expected, actual);
    const result = {
      phase: '写入前51GET',
      category: row.category,
      route: row.expected.route,
      expected: row.expected,
      actual,
      match,
    };
    checks.push(result);
    await writeJournal(journalPath, { action: '写入前保护GET', ...result });
    if (!match) {
      throw new Error('写入前保护GET与快照不一致：' + row.expected.route);
    }
  }
  assert.equal(checks.length, 51, '写入前保护GET不是51项');
  return { count: checks.length, passed: checks.filter(item => item.match).length, checks };
}

function assertHashesUnchanged(hashes) {
  const current = {
    candidateSha256: fileSha256(CANDIDATE_PATH),
    requestSha256: fileSha256(REQUEST_PATH),
    sourceSha256: fileSha256(SOURCE_PATH),
    beforeSha256: fileSha256(BEFORE_PATH),
  };
  for (const key of Object.keys(hashes)) assert.equal(current[key], hashes[key], '写入期间文件变化：' + key);
  return current;
}

async function writeOne(object, request, plans, before, journalPath, hashes, output) {
  assertHashesUnchanged(hashes);
  const beforeResponse = await apiRequest(request.readRoute);
  const beforeComparison = compareRequest(object, request, beforeResponse, plans, before);
  const base = {
    index: output.requestEvents.length,
    request,
    beforeResponse,
    beforeComparison,
  };
  await writeJournal(journalPath, { action: '逐请求写入前GET', ...base });
  if (beforeComparison.state === 'same') {
    const event = { ...base, action: '同值跳过', written: false };
    output.requestEvents.push(event);
    await writeJournal(journalPath, event);
    return event;
  }
  if (beforeComparison.state === 'conflict') {
    throw new Error('写入前同键异值或关系集合冲突：' + request.readRoute);
  }
  const writeResponse = await apiRequest(request.route, { method: request.method, body: request.body });
  if (!(writeResponse.status >= 200 && writeResponse.status < 300)) {
    const recoveryGet = await apiRequest(request.readRoute);
    const event = {
      ...base,
      action: '写入报错后先GET并停止',
      writeResponse,
      recoveryGet,
      recoveryComparison: compareRequest(object, request, recoveryGet, plans, before),
      written: false,
    };
    output.requestEvents.push(event);
    await writeJournal(journalPath, event);
    throw new Error('业务写入失败，已先GET并停止，不重放：' + request.route);
  }
  const afterResponse = await apiRequest(request.readRoute);
  const afterComparison = compareRequest(object, request, afterResponse, plans, before);
  const event = {
    ...base,
    action: '写后独立GET',
    writeResponse,
    afterResponse,
    afterComparison,
    written: true,
  };
  output.requestEvents.push(event);
  await writeJournal(journalPath, event);
  if (afterComparison.state !== 'same') {
    throw new Error('写后GET未得到候选值，不重放：' + request.readRoute);
  }
  return event;
}

async function verifyFinalRelations(candidate, plans, journalPath, output) {
  const checks = [];
  for (const equipmentKey of SELECTED_EQUIPMENT) {
    const object = candidate.objects.find(item => item.equipmentKey === equipmentKey);
    const route = '/equipment-skill-relations?equipmentKey=' + encodeURIComponent(equipmentKey);
    const response = await apiRequest(route);
    const expectedPlans = plans.get(equipmentKey) ?? [];
    const relationItems = response.ok ? listItems(response, route) : [];
    const keys = relationItems.map(item => item.equipmentKey + '|' + item.skillKey);
    const expectedKeys = expectedPlans.map(item => item.key);
    const unique = new Set(keys);
    const keySetPass = keys.length === unique.size
      && keys.length === expectedKeys.length
      && expectedKeys.every(key => unique.has(key));
    const valuePass = keySetPass && expectedPlans.every(plan => {
      const item = relationItems.find(row => row.equipmentKey + '|' + row.skillKey === plan.key);
      return item && same(normalize(plan.expected), normalize(stripServerFields(item, 'relation')));
    });
    const check = { equipmentKey, route, response, actualKeys: keys, expectedKeys, pass: response.ok && keySetPass && valuePass };
    checks.push(check);
    await writeJournal(journalPath, { action: '最终关系集合GET', ...check });
    if (!check.pass) throw new Error('最终关系集合不精确：' + route);
    if (!object) throw new Error('候选缺少装备对象：' + equipmentKey);
  }
  output.finalRelationChecks = checks;
  return checks;
}

async function updateLock(lock, state, output) {
  await writeFile(LOCK_PATH, JSON.stringify({
    ...lock,
    state,
    updatedAt: new Date().toISOString(),
    writes: output.requestEvents.filter(event => event.written).length,
    skipped: output.requestEvents.filter(event => event.action === '同值跳过').length,
    failed: output.requestEvents.filter(event => event.action === '写入报错后先GET并停止').length,
    requestEvents: output.requestEvents.length,
  }, null, 2) + '\n', 'utf8');
}

async function run() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const runDir = path.join(ARTIFACT_ROOT, 'writer-' + runId);
  await mkdir(runDir, { recursive: true });
  const journalPath = path.join(runDir, '逐请求日志.jsonl');
  const resultPath = path.join(runDir, '执行记录.json');
  const output = {
    runId,
    mode: APPLY ? '显式补缺写入' : '默认只读预检',
    apiRoot: API_ROOT,
    noBusinessWrites: !APPLY,
    apiWrites: 0,
    requestEvents: [],
    errors: [],
    runDir,
  };
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
    output.staticValidation = {
      requestCount: staticValidation.generated.length,
      candidateTotals: candidate.totals,
      sourceStage: staticValidation.sourceStage,
      guardChecks: staticValidation.guardChecks,
    };
    const plans = relationPlans(candidate);
    await writeJournal(journalPath, {
      action: '启动',
      runId,
      mode: output.mode,
      candidateSha256: output.candidateSha256,
      requestSha256: output.requestSha256,
      sourceSha256: output.sourceSha256,
      beforeSha256: output.beforeSha256,
      requestCount: 77,
      businessWriteEnabled: APPLY,
    });
    if (APPLY) {
      if (fs.existsSync(LOCK_PATH)) throw new Error('已存在最终写入锁，禁止重放：' + LOCK_PATH);
      lock = {
        runId,
        state: 'STARTED',
        startedAt: new Date().toISOString(),
        candidateSha256: output.candidateSha256,
        requestSha256: output.requestSha256,
        sourceSha256: output.sourceSha256,
        beforeSha256: output.beforeSha256,
        runDir,
      };
      await writeFile(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      await writeJournal(journalPath, { action: '启动防重放锁', lockPath: LOCK_PATH, lock });
    }
    output.categoryPreflight = await verifySkillCategories(candidate, journalPath);
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
      output.readOnlySummary = '只完成静态核对和写入前51GET；未调用任何业务写接口。';
    }
  } catch (error) {
    output.errors.push({ message: String(error), stack: error?.stack ?? null });
    if (lock) {
      try {
        await updateLock(lock, 'ABORTED', output);
      } catch (lockError) {
        output.errors.push({ message: '更新中止锁失败：' + String(lockError) });
      }
    }
  }
  output.finishedAt = new Date().toISOString();
  await writeFile(resultPath, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({
    mode: output.mode,
    runId,
    candidateSha256: output.candidateSha256 ?? null,
    requestSha256: output.requestSha256 ?? null,
    writeBeforeGETs: output.writeBefore?.count ?? 0,
    requestEvents: output.requestEvents.length,
    apiWrites: output.apiWrites,
    errors: output.errors,
    runDir,
  }, null, 2));
  if (output.errors.length) process.exitCode = 1;
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
