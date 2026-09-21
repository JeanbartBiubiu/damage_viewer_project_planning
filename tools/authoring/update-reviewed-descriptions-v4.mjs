import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 说明纠错 v4：只新增按既有结果标识修改效果子结果说明，其余字段及时间戳保持保护。
// 首次真实写入后保持本文件字节不变；独立回读使用本文件的 readback 模式。
const executor = fileURLToPath(import.meta.url);
const web = path.resolve(path.dirname(executor), '../..');
const tool = 'tools/authoring/update-reviewed-descriptions-v4.mjs';
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
const fieldSets = {
  skill: ['name', 'description', 'maxLevel', 'status', 'sortOrder', 'skillCategoryKeys'],
  parameter: ['name', 'description', 'valueType', 'valueMode', 'fixedValue', 'levelValues', 'sortOrder'],
  effect: ['name', 'description', 'sortOrder', 'lifecycle', 'results']
};
const collectionIds = {
  parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey',
  processes: 'processKey', 'internal-states': 'stateKey', 'trigger-rules': 'ruleKey'
};
const plan = read('01-纠错计划.json');
assert(Array.isArray(plan.changes) && plan.changes.length > 0);
const targets = new Map();
for (const change of plan.changes) {
  assert(change && typeof change === 'object' && !Array.isArray(change), '说明修改必须是对象');
  const allowed = ['kind', 'route', 'skillKey', 'description', 'resultDescriptions'];
  for (const key of Object.keys(change)) assert(allowed.includes(key), '不允许的修改字段：' + key);
  assert(typeof change.route === 'string', '目标路径必须是字符串');
  const match = /^\/skills\/([a-z0-9_]+)(?:\/(parameters|effects|trigger-rules)\/([a-z0-9_]+))?$/.exec(change.route);
  assert(match, '只允许技能、参数、效果或触发规则说明');
  assert(!targets.has(change.route), '重复目标：' + change.route);
  const kind = { parameters: 'parameter', effects: 'effect', 'trigger-rules': 'trigger-rule' }[match[2]] || 'skill';
  assert.equal(change.kind, kind);
  assert.equal(change.skillKey, match[1]);
  assert(typeof change.description === 'string' && change.description.trim() && change.description.length <= 2000);
  if (Object.hasOwn(change, 'resultDescriptions')) {
    assert.equal(kind, 'effect', '仅效果允许修改子结果说明');
    assert(Array.isArray(change.resultDescriptions) && change.resultDescriptions.length > 0, '子结果说明必须是非空数组');
    const resultKeys = new Set();
    for (const result of change.resultDescriptions) {
      assert(result && typeof result === 'object' && !Array.isArray(result), '子结果说明必须是对象');
      assert.deepEqual(Object.keys(result).sort(), ['description', 'resultKey'], '子结果只允许结果标识与说明');
      assert(typeof result.resultKey === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(result.resultKey), '结果标识无效');
      assert(!resultKeys.has(result.resultKey), '重复子结果目标：' + result.resultKey);
      assert(typeof result.description === 'string' && result.description.trim()
        && result.description === result.description.trim() && result.description.length <= 2000, '子结果说明须为不超过2000字符的非空正文，且无首尾空格');
      resultKeys.add(result.resultKey);
    }
  }
  targets.set(change.route, { ...change, collection: match[2], key: match[3] || match[1] });
}
const skills = [...new Set(plan.changes.map(change => change.skillKey))];

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
  if (!target.collection) return;
  const listRoute = '/skills/' + target.skillKey + '/' + target.collection;
  const rows = values[listRoute], stableKey = collectionIds[target.collection];
  assert(Array.isArray(rows));
  const matches = rows.filter(row => row[stableKey] === target.key);
  assert.equal(matches.length, 1, '目标列表缺少或重复目标：' + target.route);
  const row = matches[0], detail = values[target.route];
  for (const key of [stableKey, 'name', 'description', 'sortOrder']) assert.deepEqual(row[key], detail[key], '列表与详情不一致：' + key);
  assert(validTime(row.updatedAt), '目标列表更新时间无效');
  if (target.kind === 'trigger-rule') {
    assert.equal(row.eventType, detail.eventSource.eventType);
    assert.equal(row.conditionGroupCount, detail.conditionGroups.length);
    assert.equal(row.actionCount, detail.actions.length);
    assert.equal(row.perTargetCooldownEnabled, detail.perTargetCooldown !== null);
    assert.equal(row.maxTriggersPerProcessEnabled, detail.maxTriggersPerProcess !== null);
  } else {
    assert.equal(row.updatedAt, detail.updatedAt, '列表与详情更新时间不一致');
    if (target.kind === 'parameter') assert.deepEqual(row, detail, '参数列表必须保留完整参数');
  }
}

function makeRequests(values) {
  return [...targets.values()].map(target => {
    const before = values[target.route];
    assert(before, '缺少原详情：' + target.route);
    assert.equal(before[target.collection ? collectionIds[target.collection] : 'skillKey'], target.key);
    checkTargetList(values, target);
    const expectedReadback = { ...structuredClone(before), description: target.description };
    let changed = before.description !== target.description;
    if (target.resultDescriptions) {
      assert(Array.isArray(before.results), '效果缺少结果数组');
      const resultKeys = new Set();
      for (const result of before.results) {
        assert(result && typeof result.resultKey === 'string'
          && /^[a-z][a-z0-9_]{0,63}$/.test(result.resultKey), '既有结果标识无效');
        assert(!resultKeys.has(result.resultKey), '既有结果标识重复：' + result.resultKey);
        resultKeys.add(result.resultKey);
      }
      const descriptions = new Map(target.resultDescriptions.map(result => [result.resultKey, result.description]));
      for (const key of descriptions.keys()) assert(resultKeys.has(key), '子结果不存在：' + key);
      // 遍历原数组，保留结果顺序及全部非说明字段；不接受数组替换或其他子结构修改。
      expectedReadback.results = expectedReadback.results.map(result => {
        if (!descriptions.has(result.resultKey)) return result;
        const description = descriptions.get(result.resultKey);
        changed ||= result.description !== description;
        return { ...result, description };
      });
    }
    assert(changed, '说明已一致，不应重复写入');
    let body;
    if (target.kind === 'trigger-rule') {
      for (const key of ['name', 'sortOrder', 'eventSource', 'conditionGroups', 'actions', 'perTargetCooldown', 'maxTriggersPerProcess']) {
        assert(Object.hasOwn(before, key), '规则缺少字段：' + key);
      }
      body = structuredClone(expectedReadback);
      delete body.ruleKey;
      // 与既有范围修正工具一致：GET的null占位不能提交给严格事件正文校验。
      // 非null的使用类型保持原值，expectedReadback仍保存GET返回的完整结构。
      if (body.eventSource?.detail?.useKind === null) delete body.eventSource.detail.useKind;
    } else {
      body = {};
      for (const key of fieldSets[target.kind]) {
        assert(Object.hasOwn(before, key), target.route + '/' + key);
        body[key] = structuredClone(expectedReadback[key]);
      }
    }
    return { method: 'PUT', route: target.route, body, expectedReadback };
  });
}

function checkDetail(actual, expected, target) {
  if (target.kind === 'trigger-rule') assert.deepEqual(actual, expected, '完整规则出现说明之外的变化');
  else {
    assert(validTime(actual.updatedAt) && validTime(expected.updatedAt), '详情更新时间无效');
    assert(Date.parse(actual.updatedAt) >= Date.parse(expected.updatedAt), '详情更新时间倒退');
    assert.deepEqual({ ...actual, updatedAt: expected.updatedAt }, expected, '详情出现说明和更新时间之外的变化');
  }
}

// 以逐笔即时回读构造精确终值；同一列表中的多个目标按各自标识累加。
function applyOperation(expectedValues, request, operation) {
  const target = targets.get(request.route);
  assert.equal(operation.route, request.route);
  assert.equal(operation.method, 'PUT');
  assert.equal(operation.responseStatus, 200);
  assert.equal(operation.response.status, 200);
  checkDetail(operation.response.data, request.expectedReadback, target);
  checkDetail(operation.readback, request.expectedReadback, target);
  assert.deepEqual(operation.readback, operation.response.data, '保存响应与即时详情不一致');
  expectedValues[request.route] = operation.readback;
  if (!target.collection) return;
  const listRoute = '/skills/' + target.skillKey + '/' + target.collection;
  assert.equal(operation.listRoute, listRoute);
  assert(Array.isArray(operation.listReadback), '缺少即时完整目标列表');
  const stableKey = collectionIds[target.collection], old = expectedValues[listRoute];
  const row = operation.listReadback.find(item => item[stableKey] === target.key);
  const oldRow = old.find(item => item[stableKey] === target.key);
  assert(row && oldRow && validTime(row.updatedAt) && validTime(oldRow.updatedAt));
  assert(Date.parse(row.updatedAt) >= Date.parse(oldRow.updatedAt), '列表更新时间倒退');
  if (target.kind !== 'trigger-rule') assert.equal(row.updatedAt, operation.readback.updatedAt, '列表与详情更新时间不一致');
  const expected = old.map(item => item[stableKey] === target.key ? { ...item, description: target.description, updatedAt: row.updatedAt } : item);
  assert.deepEqual(operation.listReadback, expected, '目标列表出现说明和目标更新时间之外的变化');
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
    const changedLists = new Set([...targets.values()].filter(target => target.collection).map(target => '/skills/' + target.skillKey + '/' + target.collection));
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
          const listRoute = target.collection ? '/skills/' + target.skillKey + '/' + target.collection : null;
          if (listRoute) assert.deepEqual(await api.get(listRoute), expected[listRoute], '当前目标列表漂移');
          const operation = { route: request.route, method: 'PUT' };
          report.operations.push(operation); report.businessWritesAttempted++; report.pendingRoute = request.route; persist();
          operation.response = await api.request(request.route, 'PUT', request.body, status => { operation.responseStatus = status; persist(); });
          persist(); assert.equal(operation.response.status, 200);
          checkDetail(operation.response.data, request.expectedReadback, target);
          operation.readback = await api.get(request.route); persist();
          if (listRoute) { operation.listRoute = listRoute; operation.listReadback = await api.get(listRoute); persist(); }
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
