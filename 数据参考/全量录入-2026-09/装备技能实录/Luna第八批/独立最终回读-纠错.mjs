import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = path.dirname(fileURLToPath(import.meta.url));
const rootUrl = 'http://127.0.0.1:8080';
const payload = JSON.parse(await fs.readFile(path.join(dir, '纠错payload候选.json'), 'utf8'));
const before = JSON.parse(await fs.readFile(path.join(dir, '纠错前实库.json'), 'utf8'));
const stamp = new Date().toISOString().replaceAll(':', '-');
const reportPath = path.join(dir, `独立最终回读-纠错-${stamp}.json`);
const report = {
  generatedAt: new Date().toISOString(),
  mode: '纠错后独立最终GET回读',
  apiBaseUrl: `${rootUrl}${payload.apiBase}`,
  batch: payload.batch,
  operationReadbacks: [],
  skills: {},
  modifierZones: {},
  equipment: {},
  arithmetic: {},
  failures: [],
  passed: false
};

const skillKeys = ['item_3032_passive', 'item_3050_passive', 'item_3071_passive', 'item_3803_passive', 'item_6653_passive', 'item_8010_passive'];
const kinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];
const kindNames = new Map([
  ['parameter', 'parameters'], ['formula', 'formulas'], ['effect', 'effects'],
  ['process', 'processes'], ['internal-state', 'internal-states'], ['trigger-rule', 'trigger-rules']
]);
const idFields = new Map(kinds);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const listItems = data => Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
const stripMeta = value => {
  if (Array.isArray(value)) return value.map(stripMeta);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['gameId', 'createdAt', 'updatedAt'].includes(key)).map(([key, item]) => [key, stripMeta(item)]));
  return value;
};

function compareExpected(expected, actual, currentPath = '', rows = []) {
  if (expected === null || typeof expected !== 'object') {
    rows.push({ path: currentPath, expected, actual, equal: Object.is(expected, actual) });
    return rows;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      rows.push({ path: currentPath, expected, actual, equal: false });
      return rows;
    }
    rows.push({ path: `${currentPath}.length`, expected: expected.length, actual: actual.length, equal: expected.length === actual.length });
    expected.forEach((value, index) => compareExpected(value, actual[index], `${currentPath}[${index}]`, rows));
    return rows;
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    rows.push({ path: currentPath, expected, actual, equal: false });
    return rows;
  }
  for (const [key, value] of Object.entries(expected)) compareExpected(value, actual[key], currentPath ? `${currentPath}.${key}` : key, rows);
  return rows;
}

function matches(expected, actual) {
  return compareExpected(expected, actual).every(row => row.equal);
}

async function request(route) {
  const response = await fetch(rootUrl + route, { headers: { Authorization: 'Bearer local-entry' }, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: response.status, data };
}

function operationReadPath(operation) {
  return operation.action === 'CREATE' ? `${operation.endpoint}/${encodeURIComponent(operation.target.key)}` : operation.endpoint;
}

function objectKey(operation) {
  return operation.target.skillKey ?? `modifier-zone:${operation.target.key}`;
}

function operationState(operation, actual) {
  const target = operation.expectedAfter;
  if (actual.status === target.status && (target.body === undefined || matches(target.body, actual.data))) return 'target';
  return 'unexpected';
}

function componentDescriptors(skillKey) {
  const source = before.skills[skillKey];
  const descriptors = Object.fromEntries(kinds.map(([kind]) => [kind, new Map()]));
  for (const [kind, idField] of kinds) {
    for (const data of source.components[kind] ?? []) descriptors[kind].set(data[idField], { mode: 'unchanged', expected: clone(data) });
  }
  return { subject: { mode: 'unchanged', expected: clone(source.subject.data) }, descriptors };
}

function applyPlanToExpected() {
  const expected = Object.fromEntries(skillKeys.map(skillKey => [skillKey, componentDescriptors(skillKey)]));
  const zones = new Map((before.modifierZones.data.items ?? []).map(zone => [zone.modifierZoneKey, { mode: 'unchanged', expected: clone(zone) }]));
  for (const operation of payload.operations) {
    const target = operation.target;
    if (target.kind === 'modifier-zone') {
      if (operation.action === 'CREATE') zones.set(target.key, { mode: 'target', expected: clone(operation.expectedAfter.body) });
      continue;
    }
    const group = expected[target.skillKey];
    assert.ok(group, `未知技能 ${target.skillKey}`);
    if (target.kind === 'skill') {
      if (operation.action === 'UPDATE') group.subject = { mode: 'target', expected: clone(operation.expectedAfter.body) };
      continue;
    }
    const kind = kindNames.get(target.kind);
    assert.ok(kind, `未知组成类型 ${target.kind}`);
    if (operation.action === 'DELETE') group.descriptors[kind].delete(target.key);
    else if (operation.action === 'CREATE') group.descriptors[kind].set(target.key, { mode: 'target', expected: clone(operation.expectedAfter.body) });
    else if (operation.action === 'UPDATE') group.descriptors[kind].set(target.key, { mode: 'target', expected: clone(operation.expectedAfter.body) });
  }
  return { expected, zones };
}

async function readOperationTargets() {
  assert.equal(payload.operations.length, 26);
  for (const operation of payload.operations) {
    const route = operationReadPath(operation);
    const actual = await request(route);
    const state = operationState(operation, actual);
    report.operationReadbacks.push({ order: operation.order, object: objectKey(operation), action: operation.action, route, state, actual });
    if (state !== 'target') throw new Error(`操作最终回读不符 ${route}`);
  }
}

async function readSkill(skillKey, expectedGroup) {
  const subject = await request(`/api/admin/games/lol/skills/${skillKey}`);
  assert.equal(subject.status, 200, `${skillKey}主体`);
  const subjectFields = expectedGroup.subject.mode === 'unchanged'
    ? compareExpected(stripMeta(expectedGroup.subject.expected), stripMeta(subject.data))
    : compareExpected(expectedGroup.subject.expected, subject.data);
  assert.ok(subjectFields.every(row => row.equal), `${skillKey}主体字段不同`);
  const result = { subject: { status: subject.status, matches: true, fields: subjectFields }, components: {} };
  for (const [kind, idField] of kinds) {
    const listRoute = `/api/admin/games/lol/skills/${skillKey}/${kind}`;
    const list = await request(listRoute);
    assert.equal(list.status, 200, `${skillKey}/${kind}列表`);
    const rows = listItems(list.data);
    const actualKeys = rows.map(row => row[idField]);
    const expectedKeys = [...expectedGroup.descriptors[kind].keys()];
    assert.deepEqual([...actualKeys].sort(), [...expectedKeys].sort(), `${skillKey}/${kind}键集合不同`);
    const details = [];
    for (const [key, descriptor] of expectedGroup.descriptors[kind]) {
      const detail = await request(`${listRoute}/${encodeURIComponent(key)}`);
      assert.equal(detail.status, 200, `${skillKey}/${kind}/${key}`);
      const fields = descriptor.mode === 'unchanged'
        ? compareExpected(stripMeta(descriptor.expected), stripMeta(detail.data))
        : compareExpected(descriptor.expected, detail.data);
      assert.ok(fields.every(row => row.equal), `${skillKey}/${kind}/${key}字段不同`);
      details.push({ key, status: detail.status, mode: descriptor.mode, matches: true, fields, data: detail.data });
    }
    result.components[kind] = { list: { status: list.status, count: rows.length, keys: actualKeys }, details };
  }
  report.skills[skillKey] = result;
}

async function readZones(expectedZones) {
  const list = await request('/api/admin/games/lol/modifier-zones');
  assert.equal(list.status, 200, '修正区列表');
  const rows = listItems(list.data);
  const expectedKeys = [...expectedZones.keys()];
  const actualKeys = rows.map(row => row.modifierZoneKey);
  assert.deepEqual(actualKeys, expectedKeys, '修正区键集合或顺序不同');
  assert.equal(rows.length, 4, '修正区总数');
  for (let index = 1; index < rows.length; index++) assert.ok(rows[index - 1].sortOrder <= rows[index].sortOrder, '修正区sortOrder未保持顺序');
  const details = [];
  for (const [key, descriptor] of expectedZones) {
    const detail = await request(`/api/admin/games/lol/modifier-zones/${encodeURIComponent(key)}`);
    assert.equal(detail.status, 200, `修正区 ${key}`);
    const fields = descriptor.mode === 'unchanged'
      ? compareExpected(stripMeta(descriptor.expected), stripMeta(detail.data))
      : compareExpected(descriptor.expected, detail.data);
    assert.ok(fields.every(row => row.equal), `修正区 ${key}字段不同`);
    details.push({ key, mode: descriptor.mode, status: detail.status, matches: true, fields, data: detail.data });
  }
  assert.equal(rows.find(row => row.modifierZoneKey === 'item_3071_armor_reduction')?.sortOrder, 200);
  assert.equal(rows.find(row => row.modifierZoneKey === 'item_8010_magic_resistance_reduction')?.sortOrder, 210);
  report.modifierZones = { list: { status: list.status, count: rows.length, keys: actualKeys, items: rows }, details };
}

async function readEquipment() {
  const equipmentKeys = ['item_3032', 'item_3050', 'item_3071', 'item_3803', 'item_6653', 'item_8010'];
  const records = {};
  for (const equipmentKey of equipmentKeys) {
    const source = before.equipment[equipmentKey];
    const paths = {
      equipment: `/api/admin/games/lol/equipment/${equipmentKey}`,
      attributes: `/api/admin/games/lol/equipment/${equipmentKey}/attributes`,
      relation: `/api/admin/games/lol/equipment-skill-relations?equipmentKey=${equipmentKey}`,
      equipmentImage: `/api/admin/games/lol/equipment/${equipmentKey}/representative-image`,
      skillImage: `/api/admin/games/lol/skills/${equipmentKey}_passive/representative-image`
    };
    // 装备主体身份从纠错前关联快照取回，其他关系数据逐字段对照，确保本批只动技能组成和两个修正区。
    const expected = {
      equipment: {
        equipmentKey,
        gameId: 'lol',
        name: source.relation.data.items[0]?.equipmentName
      },
      attributes: source.attributes.data,
      relation: source.relation.data,
      equipmentImage: source.equipmentImage.data,
      skillImage: source.skillImage.data
    };
    const actual = {};
    for (const [name, route] of Object.entries(paths)) {
      const response = await request(route);
      assert.equal(response.status, 200, `${equipmentKey}/${name}`);
      actual[name] = response;
      const fields = compareExpected(stripMeta(expected[name]), stripMeta(response.data));
      assert.ok(fields.every(row => row.equal), `${equipmentKey}/${name}与纠错前快照不同`);
      actual[name].fields = fields;
    }
    records[equipmentKey] = actual;
  }
  report.equipment = records;
}

function verifyArithmetic() {
  const resistance = [
    { case: '正抗性100先叠30%再叠20%', input: 100, actual: 100 * 0.7 * 0.8, expected: 56 },
    { case: '正抗性110只叠30%', input: 110, actual: 110 * 0.7, expected: 77 }
  ];
  const stackCaps = [
    { case: '黑色切割者第五层后再次触发', actual: Math.min(6, 5) * 0.06, expected: 0.3 },
    { case: '放血者第四层后再次触发', actual: Math.min(5, 4) * 0.075, expected: 0.3 },
    { case: '兰德里第三层后再次计时', actual: Math.min(4, 3) * 0.02, expected: 0.06 }
  ];
  for (const item of [...resistance, ...stackCaps]) assert.equal(item.actual, item.expected, item.case);
  report.arithmetic = { resistance, stackCaps, passed: true };
}

try {
  assert.equal(payload.batch, 'Luna第八批');
  assert.equal(payload.expectedFinalComponentCounts.modifierZonesTotal, 4);
  const { expected, zones } = applyPlanToExpected();
  await readOperationTargets();
  for (const skillKey of skillKeys) await readSkill(skillKey, expected[skillKey]);
  await readZones(zones);
  await readEquipment();
  verifyArithmetic();
  report.passed = true;
} catch (error) {
  report.failures.push(String(error));
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = {
    operationCount: report.operationReadbacks.length,
    operationTargetCount: report.operationReadbacks.filter(row => row.state === 'target').length,
    skillCount: Object.keys(report.skills).length,
    equipmentCount: Object.keys(report.equipment).length,
    modifierZoneCount: report.modifierZones.list?.count ?? 0,
    failureCount: report.failures.length
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ mode: report.mode, report: reportPath, summary: report.summary, failures: report.failures }, null, 2));
}
