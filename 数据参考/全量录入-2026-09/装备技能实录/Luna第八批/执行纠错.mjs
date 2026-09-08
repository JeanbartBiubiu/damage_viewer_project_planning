import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = path.dirname(fileURLToPath(import.meta.url));
const rootUrl = 'http://127.0.0.1:8080';
const apply = process.argv.includes('--apply');
assert.ok(process.argv.slice(2).every(arg => arg === '--apply'), '只接受 --apply');

const payload = JSON.parse(await fs.readFile(path.join(dir, '纠错payload候选.json'), 'utf8'));
const backup = JSON.parse(await fs.readFile(path.join(dir, '纠错前实库.json'), 'utf8'));
const operations = payload.operations;
const deleteAllowlist = new Set([
  '/api/admin/games/lol/skills/item_3050_passive/effects/storm_magic_damage',
  '/api/admin/games/lol/skills/item_3050_passive/parameters/storm_tick_interval_ms'
]);
const stamp = new Date().toISOString().replaceAll(':', '-');
const reportPath = path.join(dir, apply ? `纠错写入执行记录-${stamp}.json` : `纠错只读检查-${stamp}.json`);
const journalPath = path.join(dir, '纠错流水.jsonl');
const report = {
  startedAt: new Date().toISOString(),
  mode: apply ? '明确纠错写入并逐项独立GET' : '只读全批预检',
  apiBaseUrl: `${rootUrl}${payload.apiBase}`,
  batch: payload.batch,
  operationCount: operations.length,
  preflight: [],
  writes: [],
  finalOperationReadback: [],
  failures: [],
  passed: false
};

const isObject = value => value !== null && typeof value === 'object';
const isSuccess = response => response.status >= 200 && response.status < 300;
const listItems = data => Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);

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
  if (!isObject(actual) || Array.isArray(actual)) {
    rows.push({ path: currentPath, expected, actual, equal: false });
    return rows;
  }
  for (const [key, value] of Object.entries(expected)) compareExpected(value, actual[key], currentPath ? `${currentPath}.${key}` : key, rows);
  return rows;
}

function matches(expected, actual) {
  return compareExpected(expected, actual).every(row => row.equal);
}

async function request(method, route, body) {
  assert.ok(route.startsWith('/api/admin/games/lol/'), `越出本批接口范围: ${route}`);
  const response = await fetch(rootUrl + route, {
    method,
    headers: { Authorization: 'Bearer local-entry', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: response.status, data };
}

function readPath(operation) {
  if (operation.action !== 'CREATE') return operation.endpoint;
  return `${operation.endpoint}/${encodeURIComponent(operation.target.key)}`;
}

function objectKey(operation) {
  return operation.target.skillKey ?? `modifier-zone:${operation.target.key}`;
}

function classify(operation, response) {
  const target = operation.expectedAfter;
  if (response.status === target.status && (target.body === undefined || matches(target.body, response.data))) return 'target';
  const old = operation.precondition;
  if (response.status === old.status && (old.body === undefined || matches(old.body, response.data))) return 'old';
  return 'conflict';
}

function validatePlan() {
  assert.equal(payload.batch, 'Luna第八批');
  assert.equal(payload.gameId, 'lol');
  assert.equal(operations.length, 26);
  assert.equal(payload.expectedWriteCount, 26);
  assert.deepEqual(payload.expectedNewResources, {
    parameters: 6, effects: 1, triggerRules: 1, modifierZones: 2, updates: 14, deletes: 2, total: 26
  });
  for (const operation of operations) {
    assert.ok(['CREATE', 'UPDATE', 'DELETE'].includes(operation.action), `未知动作 ${operation.action}`);
    assert.equal(operation.method, operation.action === 'CREATE' ? 'POST' : operation.action === 'UPDATE' ? 'PUT' : 'DELETE');
    if (operation.action === 'DELETE') assert.ok(deleteAllowlist.has(operation.endpoint), `删除路径未授权: ${operation.endpoint}`);
    else assert.ok(!deleteAllowlist.has(operation.endpoint), `非删除动作占用删除路径: ${operation.endpoint}`);
  }
  assert.equal(operations.filter(operation => operation.action === 'DELETE').length, deleteAllowlist.size);
  for (const route of deleteAllowlist) assert.ok(operations.some(operation => operation.action === 'DELETE' && operation.endpoint === route), `缺少授权删除: ${route}`);
  assert.ok(backup.skills && backup.equipment && backup.modifierZones, '缺少不可覆盖的纠错前快照');
}

async function preflight() {
  for (const operation of operations) {
    const route = readPath(operation);
    const actual = await request('GET', route);
    const state = classify(operation, actual);
    report.preflight.push({ order: operation.order, object: objectKey(operation), action: operation.action, route, state, actual });
  }
  const conflicts = report.preflight.filter(row => row.state === 'conflict');
  if (conflicts.length) throw new Error(`全批预检发现 ${conflicts.length} 个对象不同于旧值或目标值: ${conflicts.map(row => `${row.object} ${row.route}`).join('; ')}`);
}

async function verifyDeleteList(operation) {
  const listRoute = operation.endpoint.slice(0, operation.endpoint.lastIndexOf('/'));
  const list = await request('GET', listRoute);
  assert.ok(isSuccess(list), `删除后列表读取失败 ${listRoute} HTTP ${list.status}`);
  const keyField = operation.target.kind === 'effect' ? 'effectKey' : operation.target.kind === 'parameter' ? 'parameterKey' : 'modifierZoneKey';
  assert.ok(!listItems(list.data).some(item => item[keyField] === operation.target.key), `删除后列表仍存在 ${operation.target.key}`);
  return list;
}

async function applyOperations() {
  if (!apply) return;
  for (const operation of operations) {
    const route = readPath(operation);
    const before = await request('GET', route);
    const state = classify(operation, before);
    const record = { order: operation.order, object: objectKey(operation), action: operation.action, route, beforeState: state, applied: false };
    if (state === 'target') {
      record.action = '同值跳过';
      report.writes.push(record);
      continue;
    }
    if (state !== 'old') throw new Error(`${objectKey(operation)} 写前现值变化，停止该对象: ${route}`);
    const written = await request(operation.method, operation.endpoint, operation.request ?? undefined);
    const after = await request('GET', route);
    const afterState = classify(operation, after);
    record.writeStatus = written.status;
    record.writeResponse = written.data;
    record.readback = after;
    record.afterState = afterState;
    record.applied = afterState === 'target';
    if (operation.action === 'DELETE' && record.applied) record.deletedListReadback = await verifyDeleteList(operation);
    report.writes.push(record);
    await fs.appendFile(journalPath, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`, 'utf8');
    if (!record.applied) throw new Error(`${objectKey(operation)} 写后独立GET不符，停止该对象: ${route}`);
    // 写接口出现异常响应时只接受独立GET已经确认的目标值，不重放请求。
    if (!isSuccess(written) && record.applied) record.confirmedByReadbackAfterNon2xx = true;
  }
}

async function finalOperationReadback() {
  for (const operation of operations) {
    const route = readPath(operation);
    const actual = await request('GET', route);
    const state = classify(operation, actual);
    report.finalOperationReadback.push({ order: operation.order, object: objectKey(operation), action: operation.action, route, state, actual });
  }
  if (apply && report.finalOperationReadback.some(row => row.state !== 'target')) {
    throw new Error('最终操作回读未全部达到目标值');
  }
}

try {
  validatePlan();
  await preflight();
  await applyOperations();
  await finalOperationReadback();
  report.passed = true;
} catch (error) {
  report.failures.push(String(error));
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = {
    preflightCount: report.preflight.length,
    preflightOldCount: report.preflight.filter(row => row.state === 'old').length,
    preflightTargetCount: report.preflight.filter(row => row.state === 'target').length,
    writeCount: report.writes.filter(row => row.applied).length,
    sameTargetSkipCount: report.writes.filter(row => row.action === '同值跳过').length,
    finalTargetCount: report.finalOperationReadback.filter(row => row.state === 'target').length,
    failureCount: report.failures.length
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ mode: report.mode, report: reportPath, summary: report.summary, failures: report.failures }, null, 2));
}
