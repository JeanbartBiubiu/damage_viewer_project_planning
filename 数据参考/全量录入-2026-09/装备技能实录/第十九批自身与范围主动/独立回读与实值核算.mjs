import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
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

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !['--current', '--after-apply', '--math-only'].includes(args[0]))) {
  throw new Error('只允许默认只读回读、--current、--after-apply 或 --math-only');
}
const STRICT = args[0] === '--after-apply';
const MATH_ONLY = args[0] === '--math-only';

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

function imageCore(data) {
  const image = data && Object.hasOwn(data, 'image') ? data.image : data;
  if (!image || typeof image !== 'object') return null;
  return { imageKey: image.imageKey, name: image.name, enabled: image.enabled };
}

function imageExpected(object, before) {
  const route = '/equipment/' + object.equipmentKey + '/representative-image';
  const equipmentImage = before.representativeImageGET.find(item => item.route === route)?.data?.image;
  return {
    imageKey: object.apiPayload.representativeImage.imageKey,
    name: equipmentImage?.name,
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
    const expected = relationExpected(object);
    const key = expected.equipmentKey + '|' + expected.skillKey;
    const list = plans.get(expected.equipmentKey) ?? [];
    if (list.some(item => item.key === key)) throw new Error('候选关系重复：' + key);
    list.push({ key, object, expected });
    plans.set(expected.equipmentKey, list);
  }
  return plans;
}

function relationExact(response, equipmentKey, plans) {
  if (!response.ok) {
    return {
      state: response.status === 404 ? 'missing' : 'conflict',
      pass: false,
      error: '关系列表GET失败：HTTP ' + response.status,
      actualKeys: [],
      expectedKeys: (plans.get(equipmentKey) ?? []).map(item => item.key),
    };
  }
  let items;
  try {
    items = listItems(response, response.route);
  } catch (error) {
    return { state: 'conflict', pass: false, error: String(error), actualKeys: [], expectedKeys: [] };
  }
  const expectedPlans = plans.get(equipmentKey) ?? [];
  const expectedByKey = new Map(expectedPlans.map(item => [item.key, item]));
  const seen = new Set();
  const actualKeys = [];
  const invalid = [];
  const mismatches = [];
  for (const item of items) {
    const key = item.equipmentKey + '|' + item.skillKey;
    actualKeys.push(key);
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
  const expectedKeys = expectedPlans.map(item => item.key);
  const keySetPass = invalid.length === 0
    && mismatches.length === 0
    && actualKeys.length === expectedKeys.length
    && expectedKeys.every(key => seen.has(key));
  return {
    state: keySetPass ? 'same' : (actualKeys.length < expectedKeys.length ? 'missing' : 'conflict'),
    pass: keySetPass,
    actualKeys,
    expectedKeys,
    invalid,
    mismatches,
    itemCount: items.length,
  };
}

function compareRequest(object, request, response, plans, before) {
  if (request.kind === 'relation') return relationExact(response, object.equipmentKey, plans);
  if (request.kind === 'image') {
    if (response.status === 404) return { state: 'missing', pass: false, fields: [] };
    if (!response.ok) return { state: 'conflict', pass: false, fields: [], error: 'GET失败：HTTP ' + response.status };
    const expected = imageExpected(object, before);
    const actual = imageCore(response.data);
    if (!actual) return { state: 'missing', pass: false, fields: [] };
    const fields = differences(normalize(expected), normalize(actual));
    return { state: fields.every(field => field.equal) ? 'same' : 'conflict', pass: fields.every(field => field.equal), fields };
  }
  if (response.status === 404) return { state: 'missing', pass: false, fields: [] };
  if (!response.ok) return { state: 'conflict', pass: false, fields: [], error: 'GET失败：HTTP ' + response.status };
  const expected = expectedBody(object, request);
  if (!expected) return { state: 'conflict', pass: false, fields: [], error: '请求没有对应候选载荷' };
  const actual = stripServerFields(response.data, request.kind === 'skill' ? 'skill' : request.kind);
  const fields = differences(normalize(expected), normalize(actual));
  return { state: fields.every(field => field.equal) ? 'same' : 'conflict', pass: fields.every(field => field.equal), fields };
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
  assert.equal(before.noBusinessWrites, true, '写前保护快照无业务写入标记不成立');
  assert.equal(request.noApply, true, '最终请求缺少 noApply 标记');
  assert.equal(request.apiWrites, 0, '最终请求已有业务写入记录');
  assert.equal(request.candidateSha256, EXPECTED.candidateSha256, '请求中的候选散列不符');
  assert.equal(request.sourceSha256, EXPECTED.sourceSha256, '请求中的来源散列不符');
  assert.equal(request.beforeSha256, EXPECTED.beforeSha256, '请求中的写前散列不符');
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
  relationPlans(candidate);
  return { hashes, generated, requestDifferences, guardChecks: guardSelfChecks(candidate, before) };
}

async function apiGet(route) {
  try {
    const response = await fetch(API_ROOT + route, {
      headers: {
        Authorization: 'Bearer ' + API_TOKEN,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20000),
    });
    const raw = await response.text();
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (error) {
        return { route, method: 'GET', status: response.status, ok: response.ok, data: null, error: '非JSON响应：' + String(error) };
      }
    }
    return { route, method: 'GET', status: response.status, ok: response.ok, data };
  } catch (error) {
    return { route, method: 'GET', status: null, ok: false, data: null, error: String(error) };
  }
}

async function readSkillCategories(candidate) {
  const route = '/skill-categories';
  const response = await apiGet(route);
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
  return {
    route,
    response,
    required,
    available,
    missing,
    pass: !error && missing.length === 0,
    error,
  };
}

function beforeCoreRecord(before, route) {
  for (const category of ['equipmentGET', 'equipmentAttributesGET', 'representativeImageGET']) {
    const row = before[category].find(item => item.route === route);
    if (row) return row;
  }
  return null;
}

async function readEquipmentCore(candidate, before) {
  const rows = [];
  for (const equipmentKey of [...new Set(candidate.objects.map(item => item.equipmentKey))]) {
    for (const route of [
      '/equipment/' + equipmentKey,
      '/equipment/' + equipmentKey + '/attributes',
      '/equipment/' + equipmentKey + '/representative-image',
    ]) {
      const response = await apiGet(route);
      const expected = beforeCoreRecord(before, route);
      const pass = Boolean(expected) && same(expected, response);
      rows.push({ equipmentKey, route, response, expected, pass });
    }
  }
  return {
    count: rows.length,
    passed: rows.filter(row => row.pass).length,
    rows,
    allPass: rows.length === 21 && rows.every(row => row.pass),
  };
}

async function readRequestTargets(candidate, request, before, plans) {
  const rows = [];
  for (const [index, requestRow] of request.requests.entries()) {
    const object = objectFor(candidate, requestRow.skillKey);
    const response = await apiGet(requestRow.readRoute);
    const comparison = compareRequest(object, requestRow, response, plans, before);
    rows.push({ index, request: requestRow, response, comparison, pass: comparison.pass });
  }
  return {
    count: rows.length,
    passed: rows.filter(row => row.pass).length,
    missing: rows.filter(row => row.comparison.state === 'missing').length,
    conflicts: rows.filter(row => row.comparison.state === 'conflict').length,
    rows,
    allPass: rows.length === 77 && rows.every(row => row.pass),
  };
}

async function readComponentLists(candidate) {
  const rows = [];
  for (const object of candidate.objects) {
    const skillPath = '/skills/' + encodeURIComponent(object.skillKey);
    for (const [kind, idField, endpoint] of COMPONENT_KINDS) {
      const route = skillPath + '/' + endpoint;
      const response = await apiGet(route);
      const expectedItems = object.apiPayload[kind] ?? [];
      if (!response.ok) {
        rows.push({
          skillKey: object.skillKey,
          kind,
          route,
          expectedCount: expectedItems.length,
          response,
          actualCount: null,
          actualKeys: [],
          expectedKeys: expectedItems.map(item => item[idField]),
          state: response.status === 404 ? 'missing' : 'conflict',
          pass: false,
        });
        continue;
      }
      try {
        const items = listItems(response, route);
        const actualKeys = items.map(item => item[idField]);
        const expectedKeys = expectedItems.map(item => item[idField]);
        const unique = new Set(actualKeys);
        const pass = actualKeys.length === expectedKeys.length
          && unique.size === actualKeys.length
          && expectedKeys.every(key => unique.has(key));
        rows.push({
          skillKey: object.skillKey,
          kind,
          route,
          expectedCount: expectedItems.length,
          response,
          actualCount: items.length,
          actualKeys,
          expectedKeys,
          state: pass ? 'same' : 'conflict',
          pass,
        });
      } catch (error) {
        rows.push({ skillKey: object.skillKey, kind, route, expectedCount: expectedItems.length, response, state: 'conflict', pass: false, error: String(error) });
      }
    }
  }
  return {
    count: rows.length,
    passed: rows.filter(row => row.pass).length,
    missing: rows.filter(row => row.state === 'missing').length,
    conflicts: rows.filter(row => row.state === 'conflict').length,
    zeroTypeRows: rows.filter(row => row.expectedCount === 0),
    rows,
    allPass: rows.length === 48 && rows.every(row => row.pass),
    allSixKindsPresent: rows.length === 8 * COMPONENT_KINDS.length,
  };
}

async function readTargetRelations(candidate, before, plans) {
  const keys = before.scope?.targetEquipmentKeys ?? [];
  const rows = [];
  for (const equipmentKey of keys) {
    const route = '/equipment-skill-relations?equipmentKey=' + encodeURIComponent(equipmentKey);
    const response = await apiGet(route);
    const comparison = relationExact(response, equipmentKey, plans);
    rows.push({ equipmentKey, route, response, comparison, pass: comparison.pass });
  }
  return {
    count: rows.length,
    passed: rows.filter(row => row.pass).length,
    rows,
    allPass: rows.length === 10 && rows.every(row => row.pass),
  };
}

async function readTargetSkillSubjects(candidate, before) {
  const rows = [];
  for (const item of before.targetSkillGET ?? []) {
    const response = await apiGet(item.response.route);
    const selected = candidate.objects.find(object => object.skillKey === item.skillKey);
    let pass;
    let state;
    if (selected) {
      const request = {
        kind: 'skill',
        equipmentKey: selected.equipmentKey,
        skillKey: selected.skillKey,
        method: 'POST',
        route: '/skills',
        readRoute: item.response.route,
        body: selected.apiPayload.skill,
      };
      const comparison = compareRequest(selected, request, response, new Map(), before);
      pass = comparison.pass;
      state = comparison.state;
      rows.push({ equipmentKey: item.equipmentKey, skillKey: item.skillKey, response, comparison, pass, state });
    } else {
      pass = response.status === item.response.status && response.ok === item.response.ok && same(item.response.data, response.data);
      state = pass ? 'same' : 'conflict';
      rows.push({ equipmentKey: item.equipmentKey, skillKey: item.skillKey, response, expected: item.response, pass, state });
    }
  }
  return {
    count: rows.length,
    passed: rows.filter(row => row.pass).length,
    selectedRows: rows.filter(row => candidate.objects.some(object => object.skillKey === row.skillKey)),
    unselectedRows: rows.filter(row => !candidate.objects.some(object => object.skillKey === row.skillKey)),
    rows,
    allPass: rows.length === 20 && rows.every(row => row.pass),
  };
}

function findFormula(candidate, skillKey, formulaKey, actualFormulas) {
  const actual = actualFormulas.get(skillKey + '/' + formulaKey);
  if (actual) return actual;
  return objectFor(candidate, skillKey).apiPayload.formulas.find(item => item.formulaKey === formulaKey);
}

function findParameter(candidate, skillKey, parameterKey, actualParameters) {
  const actual = actualParameters.get(skillKey + '/' + parameterKey);
  if (actual) return actual;
  return objectFor(candidate, skillKey).apiPayload.parameters.find(item => item.parameterKey === parameterKey);
}

function parameterMap(candidate, skillKey, actualParameters) {
  return new Map(objectFor(candidate, skillKey).apiPayload.parameters.map(parameter => [
    parameter.parameterKey,
    findParameter(candidate, skillKey, parameter.parameterKey, actualParameters),
  ]));
}

function evaluate(node, context) {
  if (!node || typeof node !== 'object') throw new Error('公式节点为空');
  if (node.nodeType === 'PARAMETER') {
    const parameter = context.parameters.get(node.parameterKey);
    if (!parameter) throw new Error('MISSING_PARAMETER:' + node.parameterKey);
    if (Object.hasOwn(context.overrides, node.parameterKey)) return context.overrides[node.parameterKey];
    if (parameter.valueMode === 'FIXED' && parameter.fixedValue !== null && parameter.fixedValue !== undefined) return parameter.fixedValue;
    throw new Error('MISSING_RUNTIME_PARAMETER:' + node.parameterKey);
  }
  if (node.nodeType === 'ATTRIBUTE') {
    const key = node.attributeOwner + ':' + node.attributeKey + ':' + node.attributeValueKind;
    if (!Object.hasOwn(context.attributes, key)) throw new Error('MISSING_ATTRIBUTE:' + key);
    return context.attributes[key];
  }
  if (node.nodeType !== 'OPERATION') throw new Error('未知公式节点：' + node.nodeType);
  if (!Array.isArray(node.operands) || node.operands.length < 2) throw new Error('运算节点缺少操作数');
  const values = node.operands.map(operand => evaluate(operand, context));
  if (node.operation === 'ADD') return values.reduce((sum, value) => sum + value, 0);
  if (node.operation === 'MULTIPLY') return values.reduce((product, value) => product * value, 1);
  if (node.operation === 'MIN') return Math.min(...values);
  if (node.operation === 'MAX') return Math.max(...values);
  throw new Error('未知公式运算：' + node.operation);
}

function near(actual, expected, tolerance = 1e-9) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function positiveCases() {
  const hp = {
    'SOURCE:hp:TOTAL': 2400,
    'SOURCE:hp:CURRENT': 600,
    'SOURCE:hp:BONUS': 900,
    'TARGET:hp:TOTAL': 3600,
    'TARGET:hp:CURRENT': 1100,
    'TARGET:hp:BONUS': 1500,
  };
  return [
    {
      name: '3074主动总攻击力375',
      skillKey: 'item_3074_active',
      formulaKey: 'active_physical_damage',
      attributes: { 'SOURCE:attack_damage:TOTAL': 375 },
      overrides: {},
      expected: 300,
    },
    {
      name: '3748被动主目标近战读取自身总生命',
      skillKey: 'item_3748_passive',
      formulaKey: 'primary_on_hit_damage_melee',
      attributes: hp,
      overrides: {},
      expected: 24,
    },
    {
      name: '3748被动主目标远程读取自身总生命',
      skillKey: 'item_3748_passive',
      formulaKey: 'primary_on_hit_damage_ranged',
      attributes: hp,
      overrides: {},
      expected: 12,
    },
    {
      name: '3748主动主目标近战读取自身总生命',
      skillKey: 'item_3748_active',
      formulaKey: 'active_primary_damage_melee',
      attributes: hp,
      overrides: {},
      expected: 96,
    },
    {
      name: '3748主动主目标远程读取自身总生命',
      skillKey: 'item_3748_active',
      formulaKey: 'active_primary_damage_ranged',
      attributes: hp,
      overrides: {},
      expected: 48,
    },
    {
      name: '6698主动总攻击力375',
      skillKey: 'item_6698_active',
      formulaKey: 'active_physical_damage',
      attributes: { 'SOURCE:attack_damage:TOTAL': 375 },
      overrides: {},
      expected: 300,
    },
    {
      name: '3107敌方目标最大生命3600',
      skillKey: 'item_3107_active',
      formulaKey: 'enemy_true_damage',
      attributes: {},
      overrides: { actual_target_max_health: 3600 },
      expected: 360,
    },
    {
      name: '6664每次伤害',
      skillKey: 'item_6664_passive',
      formulaKey: 'damage_per_tick',
      attributes: {},
      overrides: { source_mstat12_formula2_value: 1200 },
      expected: 27,
    },
    {
      name: '6664每秒伤害',
      skillKey: 'item_6664_passive',
      formulaKey: 'damage_per_second',
      attributes: {},
      overrides: { source_mstat12_formula2_value: 1200 },
      expected: 27,
    },
    {
      name: '6664英雄触发每次伤害',
      skillKey: 'item_6664_passive',
      formulaKey: 'champion_proc_damage_per_tick',
      attributes: {},
      overrides: { source_mstat12_formula2_value: 1200 },
      expected: 108,
    },
    {
      name: '8020合资格魔法伤害1250',
      skillKey: 'item_8020_passive',
      formulaKey: 'additional_magic_damage',
      attributes: {},
      overrides: { actual_qualified_magic_damage: 1250 },
      expected: 150,
    },
  ];
}

function runMath(candidate, finalGets) {
  const actualParameters = new Map();
  const actualFormulas = new Map();
  for (const row of finalGets) {
    if (!row.response?.ok || !row.response.data) continue;
    if (row.request.kind === 'parameters') {
      actualParameters.set(row.request.skillKey + '/' + row.request.body.parameterKey, row.response.data);
    }
    if (row.request.kind === 'formulas') {
      actualFormulas.set(row.request.skillKey + '/' + row.request.body.formulaKey, row.response.data);
    }
  }
  const candidateParameterCount = candidate.objects.reduce((sum, object) => sum + object.apiPayload.parameters.length, 0);
  const candidateFormulaCount = candidate.objects.reduce((sum, object) => sum + object.apiPayload.formulas.length, 0);
  const readbackComplete = actualParameters.size === 42
    && actualFormulas.size === 11
    && finalGets.filter(row => row.request.kind === 'parameters').every(row => row.comparison.pass)
    && finalGets.filter(row => row.request.kind === 'formulas').every(row => row.comparison.pass);
  const cases = [];
  for (const example of positiveCases()) {
    const formula = findFormula(candidate, example.skillKey, example.formulaKey, actualFormulas);
    const value = evaluate(formula.expression, {
      parameters: parameterMap(candidate, example.skillKey, actualParameters),
      overrides: example.overrides,
      attributes: example.attributes,
    });
    cases.push({
      ...example,
      actual: value,
      pass: near(value, example.expected),
      expressionSource: actualFormulas.has(example.skillKey + '/' + example.formulaKey) ? '业务接口逐项GET' : '最终候选',
    });
  }
  const hpBase = {
    'SOURCE:hp:CURRENT': 600,
    'SOURCE:hp:BONUS': 900,
    'TARGET:hp:TOTAL': 3600,
    'TARGET:hp:CURRENT': 1100,
    'TARGET:hp:BONUS': 1500,
  };
  const hpFormulaKeys = [
    ['item_3748_passive', 'primary_on_hit_damage_melee'],
    ['item_3748_passive', 'primary_on_hit_damage_ranged'],
    ['item_3748_active', 'active_primary_damage_melee'],
    ['item_3748_active', 'active_primary_damage_ranged'],
  ];
  const missingSourceHp = hpFormulaKeys.map(([skillKey, formulaKey]) => {
    const formula = findFormula(candidate, skillKey, formulaKey, actualFormulas);
    try {
      evaluate(formula.expression, {
        parameters: parameterMap(candidate, skillKey, actualParameters),
        overrides: {},
        attributes: hpBase,
      });
      return { skillKey, formulaKey, rejected: false, error: null };
    } catch (error) {
      return { skillKey, formulaKey, rejected: String(error).includes('MISSING_ATTRIBUTE:SOURCE:hp:TOTAL'), error: String(error) };
    }
  });
  const targetMagicFormula = findFormula(candidate, 'item_8020_passive', 'additional_magic_damage', actualFormulas);
  let missingRuntime;
  try {
    evaluate(targetMagicFormula.expression, {
      parameters: parameterMap(candidate, 'item_8020_passive', actualParameters),
      overrides: {},
      attributes: {},
    });
    missingRuntime = { rejected: false, error: null };
  } catch (error) {
    missingRuntime = { rejected: String(error).includes('MISSING_RUNTIME_PARAMETER:actual_qualified_magic_damage'), error: String(error) };
  }
  const shieldParameter = findParameter(candidate, 'item_3190_active', 'actual_self_shield_value', actualParameters);
  const decimalInput = {
    parameterKey: 'actual_self_shield_value',
    valueType: shieldParameter?.valueType,
    valueMode: shieldParameter?.valueMode,
    fixedValue: shieldParameter?.fixedValue,
    levelValues: shieldParameter?.levelValues,
    exampleInput: 1234.5,
    acceptedValue: 1234.5,
    preservesFraction: !Number.isInteger(1234.5),
    pass: shieldParameter?.valueType === 'DECIMAL'
      && shieldParameter?.valueMode === 'RUNTIME_INPUT'
      && shieldParameter?.fixedValue === null
      && shieldParameter?.levelValues === null,
  };
  const ranges = ['aura_range', 'proc_aoe_radius', 'champion_proc_aoe_radius']
    .map(parameterKey => findParameter(candidate, 'item_6664_passive', parameterKey, actualParameters))
    .map(parameter => ({ parameterKey: parameter?.parameterKey, value: parameter?.fixedValue }));
  const rangeSeparation = {
    values: ranges,
    expected: { aura_range: 325, proc_aoe_radius: 350, champion_proc_aoe_radius: 500 },
    distinct: new Set(ranges.map(item => item.value)).size === 3,
    pass: ranges.length === 3
      && ranges[0]?.value === 325
      && ranges[1]?.value === 350
      && ranges[2]?.value === 500
      && new Set(ranges.map(item => item.value)).size === 3,
  };
  const hpPerturbations = hpFormulaKeys.map(([skillKey, formulaKey]) => {
    const formula = findFormula(candidate, skillKey, formulaKey, actualFormulas);
    const parameters = parameterMap(candidate, skillKey, actualParameters);
    const baseAttributes = {
      'SOURCE:hp:TOTAL': 2400,
      'SOURCE:hp:CURRENT': 600,
      'SOURCE:hp:BONUS': 900,
      'TARGET:hp:TOTAL': 3600,
      'TARGET:hp:CURRENT': 1100,
      'TARGET:hp:BONUS': 1500,
    };
    const baseValue = evaluate(formula.expression, { parameters, overrides: {}, attributes: baseAttributes });
    const changedValue = evaluate(formula.expression, {
      parameters,
      overrides: {},
      attributes: {
        ...baseAttributes,
        'SOURCE:hp:CURRENT': 1,
        'SOURCE:hp:BONUS': 2,
        'TARGET:hp:TOTAL': 9999,
        'TARGET:hp:CURRENT': 3,
        'TARGET:hp:BONUS': 4,
      },
    });
    return {
      skillKey,
      formulaKey,
      sourceTotal: 2400,
      sourceCurrent: 600,
      sourceBonus: 900,
      targetTotal: 3600,
      targetCurrent: 1100,
      targetBonus: 1500,
      baseValue,
      changedValue,
      pass: baseValue === changedValue,
    };
  });
  const formulaCountPass = candidateFormulaCount === 11;
  const parameterCountPass = candidateParameterCount === 42;
  return {
    readbackComplete,
    readSource: readbackComplete ? '业务接口逐项GET' : '最终候选（当前尚未完成业务写入）',
    parsedParameterCount: candidateParameterCount,
    parsedFormulaCount: candidateFormulaCount,
    parameterCountPass,
    formulaCountPass,
    positiveCases: cases,
    positiveCaseCount: cases.length,
    positivePassed: cases.filter(item => item.pass).length,
    missingSourceHp,
    missingSourceHpAllRejected: missingSourceHp.length === 4 && missingSourceHp.every(item => item.rejected),
    missingRuntime,
    decimalInput,
    rangeSeparation,
    hpPerturbations,
    hpPerturbationsPass: hpPerturbations.length === 4 && hpPerturbations.every(item => item.pass),
    allFormulaExamplesPass: cases.length === 11 && cases.every(item => item.pass),
    allPass: parameterCountPass
      && formulaCountPass
      && cases.length === 11
      && cases.every(item => item.pass)
      && missingSourceHp.every(item => item.rejected)
      && missingRuntime.rejected
      && decimalInput.pass
      && rangeSeparation.pass
      && hpPerturbations.every(item => item.pass),
    businessMathReady: readbackComplete
      && parameterCountPass
      && formulaCountPass
      && cases.length === 11
      && cases.every(item => item.pass),
  };
}

async function run() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const resultPath = path.join(ARTIFACT_ROOT, '独立回读与实值核算-' + runId + '.json');
  const output = {
    runId,
    mode: STRICT ? '写入后严格独立回读' : (MATH_ONLY ? '仅候选独立实值核算' : '当前状态只读独立回读'),
    apiRoot: API_ROOT,
    noBusinessWrites: true,
    apiWrites: 0,
    candidateSha256: EXPECTED.candidateSha256,
    requestSha256: EXPECTED.requestSha256,
    sourceSha256: EXPECTED.sourceSha256,
    beforeSha256: EXPECTED.beforeSha256,
    errors: [],
  };
  try {
    const candidate = readJson(CANDIDATE_PATH);
    const request = readJson(REQUEST_PATH);
    const source = readJson(SOURCE_PATH);
    const before = readJson(BEFORE_PATH);
    const staticValidation = staticValidate(candidate, request, source, before);
    output.staticValidation = {
      requestCount: staticValidation.generated.length,
      candidateTotals: candidate.totals,
      sourceStage: source.stage,
      guardChecks: staticValidation.guardChecks,
    };
    const plans = relationPlans(candidate);
    let finalGets = [];
    if (!MATH_ONLY) {
      output.categoryPreflight = await readSkillCategories(candidate);
      output.requestTargets = await readRequestTargets(candidate, request, before, plans);
      output.equipmentCore = await readEquipmentCore(candidate, before);
      output.componentLists = await readComponentLists(candidate);
      output.targetRelations = await readTargetRelations(candidate, before, plans);
      output.targetSkillSubjects = await readTargetSkillSubjects(candidate, before);
      finalGets = output.requestTargets.rows;
    }
    output.math = runMath(candidate, finalGets);
    output.pendingTargetQualifications = candidate.pendingTargetQualifications ?? [];
    output.finishedAt = new Date().toISOString();
    output.status = STRICT
      ? (output.requestTargets.allPass
        && output.categoryPreflight.pass
        && output.equipmentCore.allPass
        && output.componentLists.allPass
        && output.targetRelations.allPass
        && output.targetSkillSubjects.allPass
        && output.math.businessMathReady ? 'PASS' : 'FAIL')
      : 'READ_ONLY';
  } catch (error) {
    output.errors.push({ message: String(error), stack: error?.stack ?? null });
    output.status = STRICT ? 'FAIL' : 'READ_ONLY_ERROR';
    output.finishedAt = new Date().toISOString();
  }
  await writeFile(resultPath, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({
    mode: output.mode,
    status: output.status,
    runId,
    candidateSha256: output.candidateSha256,
    requestSha256: output.requestSha256,
    requestTargets: output.requestTargets ? {
      count: output.requestTargets.count,
      passed: output.requestTargets.passed,
      missing: output.requestTargets.missing,
      conflicts: output.requestTargets.conflicts,
    } : null,
    equipmentCore: output.equipmentCore ? { count: output.equipmentCore.count, passed: output.equipmentCore.passed } : null,
    componentLists: output.componentLists ? { count: output.componentLists.count, passed: output.componentLists.passed, zeroTypeRows: output.componentLists.zeroTypeRows.length } : null,
    targetRelations: output.targetRelations ? { count: output.targetRelations.count, passed: output.targetRelations.passed } : null,
    targetSkillSubjects: output.targetSkillSubjects ? { count: output.targetSkillSubjects.count, passed: output.targetSkillSubjects.passed } : null,
    math: output.math ? {
      readbackComplete: output.math.readbackComplete,
      positive: output.math.positivePassed + '/' + output.math.positiveCaseCount,
      formulaCount: output.math.parsedFormulaCount,
      parameterCount: output.math.parsedParameterCount,
      allPass: output.math.allPass,
      businessMathReady: output.math.businessMathReady,
    } : null,
    errors: output.errors,
    resultPath,
  }, null, 2));
  if (STRICT && output.status !== 'PASS') process.exitCode = 1;
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
