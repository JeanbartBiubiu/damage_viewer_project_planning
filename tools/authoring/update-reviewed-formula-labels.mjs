import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 公式标签纠错：仅合入明示的名称、说明，完整保留表达式、引用和排序。
// 首次真实写入后保持本文件字节不变；独立回读使用本文件的 readback 模式。
const executor = fileURLToPath(import.meta.url);
const web = path.resolve(path.dirname(executor), '../..');
const tool = 'tools/authoring/update-reviewed-formula-labels.mjs';
const mode = process.argv[2] || 'prepare';
const here = path.resolve(process.argv[3] || '');
assert(['prepare', 'preflight', 'write', 'readback'].includes(mode));
assert(here.startsWith(path.join(web, '数据参考') + path.sep), '批次目录必须位于当前Web数据参考下');
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const save = (name, value) => fs.writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hash = name => sha(fs.readFileSync(name === tool ? executor : path.join(here, name)));
const id = value => typeof value === 'string' && /^[a-z0-9_]+$/.test(value);
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const editable = ['name', 'description'];
const bodyFields = ['name', 'description', 'expression', 'sortOrder'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const collectionIds = {
  parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey',
  processes: 'processKey', 'internal-states': 'stateKey', 'trigger-rules': 'ruleKey'
};
const plan = read('01-纠错计划.json');
assert(Array.isArray(plan.changes) && plan.changes.length > 0);
const targets = new Map();
for (const change of plan.changes) {
  assert(object(change));
  assert.deepEqual(Object.keys(change).sort(), ['skillKey', 'formulaKey', 'route', 'updates'].sort(), '每项只允许目标标识、路径和updates');
  const match = /^\/skills\/([a-z0-9_]+)\/formulas\/([a-z0-9_]+)$/.exec(change.route);
  assert(match, '只允许现有公式详情路径');
  assert(!targets.has(change.route), '重复目标：' + change.route);
  assert.equal(change.skillKey, match[1]);
  assert.equal(change.formulaKey, match[2]);
  assert(object(change.updates) && Object.keys(change.updates).length > 0, 'updates必须包含明示更新');
  assert(Object.keys(change.updates).every(key => editable.includes(key)), 'updates包含未授权字段');
  targets.set(change.route, change);
}
const skills = [...new Set(plan.changes.map(change => change.skillKey))];

function validateFormulaLabels(body) {
  assert(typeof body.name === 'string' && body.name.trim() === body.name && body.name.length > 0 && body.name.length <= 100, '公式名称必须是已去除首尾空格的非空文本，最多100字符');
  assert(body.description === null || (typeof body.description === 'string' && body.description.trim() === body.description && body.description.length > 0 && body.description.length <= 2000), '说明须为null或已去除首尾空格的非空文本，最多2000字符');
  assert(Number.isSafeInteger(body.sortOrder) && body.sortOrder >= 0 && body.sortOrder <= 2147483647, '原公式排序须为非负整数');
  assert(object(body.expression), '原公式表达式必须是对象');
}

function sources() {
  assert(Array.isArray(plan.sourceFiles) && plan.sourceFiles.length > 0, '必须声明固定来源及摘要');
  return plan.sourceFiles.map(source => {
    const root = source.root === 'web' ? web : source.root === 'planning' ? path.resolve(web, '../damage_viewer_project_planning') : null;
    assert(root && typeof source.path === 'string');
    assert(typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(source.sha256), '必须声明来源sha256');
    const file = path.resolve(root, source.path);
    assert(file.startsWith(root + path.sep), '来源超出指定根目录');
    const actual = sha(fs.readFileSync(file));
    assert.equal(actual, source.sha256, '来源漂移：' + source.path);
    return { ...source, sha256: actual };
  });
}

function client() {
  const token = crypto.randomUUID(), audit = [];
  async function request(route, method = 'GET', body, onResponse) {
    assert(skills.some(key => route === '/skills/' + key || route.startsWith('/skills/' + key + '/')));
    assert(method === 'GET' || (mode === 'write' && method === 'PUT' && targets.has(route)));
    const response = await fetch(base + route, {
      method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000)
    });
    audit.push({ method, path: route, status: response.status });
    // HTTP状态在解析正文之前落盘；损坏的200响应也不能触发重放。
    if (onResponse) onResponse(response.status);
    return { status: response.status, data: await response.json() };
  }
  return { request, audit, async get(route) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    return response.data;
  } };
}

async function snapshot(api) {
  const values = {};
  for (const key of skills) {
    const root = '/skills/' + key;
    values[root] = await api.get(root);
    for (const [kind, stableKey] of Object.entries(collectionIds)) {
      const route = root + '/' + kind, rows = await api.get(route);
      assert(Array.isArray(rows), route);
      assert(rows.every(row => id(row[stableKey])), '列表标识无效：' + route);
      assert.equal(new Set(rows.map(row => row[stableKey])).size, rows.length, '列表标识重复：' + route);
      values[route] = rows;
      for (const row of rows) values[route + '/' + row[stableKey]] = await api.get(route + '/' + row[stableKey]);
    }
  }
  return values;
}

function checkTargetList(values, target) {
  const listRoute = '/skills/' + target.skillKey + '/formulas';
  const rows = values[listRoute];
  assert(Array.isArray(rows));
  const matches = rows.filter(row => row.formulaKey === target.formulaKey);
  assert.equal(matches.length, 1, '目标列表缺少或重复目标：' + target.route);
  const row = matches[0], detail = values[target.route];
  assert(validTime(row.updatedAt), '目标列表更新时间无效');
  const { expression, ...summary } = detail;
  assert(object(expression), '原公式表达式必须是对象');
  assert.deepEqual(row, summary, '公式摘要必须与详情除表达式外的全部字段一致');
}

function makeRequests(values) {
  return [...targets.values()].map(target => {
    const before = values[target.route];
    assert(before, '缺少原详情：' + target.route);
    assert.equal(before.gameId, 'lol');
    assert.equal(before.skillKey, target.skillKey);
    assert.equal(before.formulaKey, target.formulaKey);
    checkTargetList(values, target);
    const originalBody = {};
    for (const key of bodyFields) {
      assert(Object.hasOwn(before, key), target.route + '/' + key);
      originalBody[key] = structuredClone(before[key]);
    }
    const body = { ...originalBody, ...structuredClone(target.updates) };
    assert.notDeepEqual(body, originalBody, '目标实际未变化，不应重复写入');
    const skill = values['/skills/' + target.skillKey];
    assert.equal(skill.skillKey, target.skillKey);
    validateFormulaLabels(body);
    const expectedReadback = { ...before, ...structuredClone(target.updates) };
    return { method: 'PUT', route: target.route, body, expectedReadback };
  });
}

function checkDetail(actual, expected) {
  assert(validTime(actual.updatedAt) && validTime(expected.updatedAt), '详情更新时间无效');
  assert(Date.parse(actual.updatedAt) >= Date.parse(expected.updatedAt), '详情更新时间倒退');
  assert.deepEqual({ ...actual, updatedAt: expected.updatedAt }, expected, '详情出现明示更新和更新时间之外的变化');
}

// 以逐笔即时回读构造精确终值；同一列表中的多个目标按各自标识累加。
function applyOperation(expectedValues, request, operation) {
  const target = targets.get(request.route);
  assert.equal(operation.route, request.route);
  assert.equal(operation.method, 'PUT');
  assert.equal(operation.responseStatus, 200);
  assert.equal(operation.response.status, 200);
  checkDetail(operation.response.data, request.expectedReadback);
  checkDetail(operation.readback, request.expectedReadback);
  assert.deepEqual(operation.readback, operation.response.data, '保存响应与即时详情不一致');
  expectedValues[request.route] = operation.readback;
  const listRoute = '/skills/' + target.skillKey + '/formulas';
  assert.equal(operation.listRoute, listRoute);
  assert(Array.isArray(operation.listReadback), '缺少即时完整目标列表');
  const old = expectedValues[listRoute];
  const row = operation.listReadback.find(item => item.formulaKey === target.formulaKey);
  const oldRow = old.find(item => item.formulaKey === target.formulaKey);
  assert(row && oldRow && validTime(row.updatedAt) && validTime(oldRow.updatedAt));
  assert(Date.parse(row.updatedAt) >= Date.parse(oldRow.updatedAt), '列表更新时间倒退');
  assert.equal(row.updatedAt, operation.readback.updatedAt, '列表与详情更新时间不一致');
  const expected = old.map(item => item.formulaKey === target.formulaKey ? { ...item, ...target.updates, updatedAt: row.updatedAt } : item);
  const orderChanged = Object.hasOwn(target.updates, 'name') && target.updates.name !== oldRow.name;
  if (orderChanged) {
    // 查询按排序值、名称、标识排列；名称的同值排序由数据库决定，不在工具中猜测中文排序规则。
    // 只允许本次明示更新的目标行移动；其他行的相对顺序及全部字段仍严格不变。
    const isTarget = item => item.formulaKey === target.formulaKey;
    assert.deepEqual(operation.listReadback.filter(isTarget), expected.filter(isTarget), '目标公式摘要字段不一致');
    assert.deepEqual(operation.listReadback.filter(item => !isTarget(item)), expected.filter(item => !isTarget(item)), '非目标行或相对顺序变化');
    for (let index = 1; index < operation.listReadback.length; index++) {
      assert(operation.listReadback[index - 1].sortOrder <= operation.listReadback[index].sortOrder, '公式列表排序值顺序异常');
    }
  } else assert.deepEqual(operation.listReadback, expected, '目标列表出现明示更新和目标更新时间之外的变化');
  expectedValues[listRoute] = operation.listReadback;
  checkTargetList(expectedValues, target);
}

const required = [tool, '01-纠错计划.json', '02-冻结请求.json', '03-来源摘要.json', '04-写入前现值.json'];
const writeFile = '06-写入与即时回读.json';
if (mode === 'prepare') {
  for (const name of [...required.slice(2), '05-独立评审.json', writeFile]) assert(!fs.existsSync(path.join(here, name)), '拒绝覆盖或复用已有批次：' + name);
  const source = sources(), api = client(), values = await snapshot(api), requests = makeRequests(values);
  save('03-来源摘要.json', source);
  save('04-写入前现值.json', { at: new Date().toISOString(), base, values, audit: api.audit, businessWrites: 0 });
  save('02-冻结请求.json', { base, requests, sourceSha256: hash('03-来源摘要.json'), baselineSha256: hash('04-写入前现值.json') });
  console.log(JSON.stringify({ status: 'READY_FOR_REVIEW', GETs: api.audit.length, plannedPUTs: requests.length, batchFileSha256: hash('02-冻结请求.json') }));
} else {
  const review = read('05-独立评审.json');
  assert.equal(review.status, 'APPROVED');
  for (const name of required) assert.equal(hash(name), review.approvedFiles[name], '批准文件漂移：' + name);
  assert.deepEqual(sources(), read('03-来源摘要.json'));
  const frozen = read('02-冻结请求.json'), before = read('04-写入前现值.json');
  assert.equal(frozen.base, base); assert.equal(before.base, base);
  assert.equal(frozen.sourceSha256, hash('03-来源摘要.json'));
  assert.equal(frozen.baselineSha256, hash('04-写入前现值.json'));
  assert.deepEqual(frozen.requests, makeRequests(before.values));
  const api = client();
  if (mode === 'readback') {
    const writer = read(writeFile);
    assert.equal(writer.status, 'PASS', '写入结果不明，仅可另行只读恢复，不能认定批次成功');
    assert.deepEqual(writer.approvedFiles, review.approvedFiles);
    assert.equal(writer.businessWritesAttempted, frozen.requests.length);
    assert.equal(writer.operations.length, frozen.requests.length);
    assert.equal(writer.pendingRoute, null);
    assert.deepEqual(writer.audit.filter(row => row.method !== 'GET'), frozen.requests.map(request => ({ method: 'PUT', path: request.route, status: 200 })));
    const expected = structuredClone(before.values);
    for (let index = 0; index < frozen.requests.length; index++) applyOperation(expected, frozen.requests[index], writer.operations[index]);
    const values = await snapshot(api);
    assert.deepEqual(values, expected, '独立回读与受保护终值不一致（含所有时间戳）');
    const changedLists = new Set([...targets.values()].map(target => '/skills/' + target.skillKey + '/formulas'));
    console.log(JSON.stringify({
      status: 'PASS', at: new Date().toISOString(), toolSha256: hash(tool), writeReportSha256: hash(writeFile), businessWrites: 0,
      GETs: api.audit.length, unchangedResponsesIncludingTimestamps: Object.keys(before.values).length - targets.size - changedLists.size,
      expectedChangedCollections: changedLists.size, changedDetails: Object.fromEntries([...targets.keys()].map(route => [route, values[route]])),
      values, audit: api.audit
    }));
  } else {
    if (mode === 'write') {
      assert(!fs.existsSync(path.join(here, writeFile)), '已有06记录，禁止重放；先只读核对落地范围');
      assert.equal(process.env.DAMAGE_APPROVED_BATCH_SHA, hash('02-冻结请求.json'), '缺少准确的获批冻结文件摘要');
    }
    const current = await snapshot(api);
    assert.deepEqual(current, before.values, '保护现值漂移');
    if (mode === 'preflight') console.log(JSON.stringify({ status: 'PASS', GETs: api.audit.length, businessWrites: 0 }));
    else {
      const report = { startedAt: new Date().toISOString(), status: 'STARTED', businessWritesAttempted: 0, operations: [], pendingRoute: null, approvedFiles: review.approvedFiles, audit: api.audit };
      save(writeFile, report);
      const persist = () => fs.writeFileSync(path.join(here, writeFile), JSON.stringify(report, null, 2) + '\n');
      const expected = structuredClone(before.values);
      try {
        for (const request of frozen.requests) {
          assert.deepEqual(await api.get(request.route), expected[request.route], '当前目标漂移');
          const target = targets.get(request.route);
          const listRoute = '/skills/' + target.skillKey + '/formulas';
          assert.deepEqual(await api.get(listRoute), expected[listRoute], '当前目标列表漂移');
          const operation = { route: request.route, method: 'PUT' };
          report.operations.push(operation); report.businessWritesAttempted++; report.pendingRoute = request.route; persist();
          operation.response = await api.request(request.route, 'PUT', request.body, status => { operation.responseStatus = status; persist(); });
          persist(); assert.equal(operation.response.status, 200);
          checkDetail(operation.response.data, request.expectedReadback);
          operation.readback = await api.get(request.route); persist();
          operation.listRoute = listRoute; operation.listReadback = await api.get(listRoute); persist();
          applyOperation(expected, request, operation);
          report.pendingRoute = null; persist();
        }
        report.status = 'PASS';
      } catch (error) {
        report.status = 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY'; report.error = error.message; throw error;
      } finally {
        report.finishedAt = new Date().toISOString(); persist();
      }
      console.log(JSON.stringify({ status: report.status, PUTs: report.businessWritesAttempted, immediateReadbacks: report.operations.filter(operation => operation.readback).length }));
    }
  }
}
