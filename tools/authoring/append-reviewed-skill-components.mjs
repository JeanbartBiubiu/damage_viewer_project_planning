import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 本版只新增效果、过程和触发规则；首次真实写入后保持文件字节不变。
const executor = fileURLToPath(import.meta.url);
const web = path.resolve(path.dirname(executor), '../..');
const executorKey = 'tools/authoring/append-reviewed-skill-components.mjs';
const mode = process.argv[2], here = path.resolve(process.argv[3] || '');
assert(['prepare', 'preflight', 'write', 'readback'].includes(mode));
assert(here.startsWith(path.join(web, '数据参考') + path.sep));
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hash = name => sha(fs.readFileSync(name === executorKey ? executor : path.join(here, name)));
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const save = (name, value) => fs.writeFileSync(path.join(here, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const plan = read('01-候选方案.json');
const id = value => typeof value === 'string' && /^[a-z0-9_]+$/.test(value);
const kinds = { parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey', processes: 'processKey', 'internal-states': 'stateKey', 'trigger-rules': 'ruleKey' };
assert(Array.isArray(plan.targets) && plan.targets.length);
const targets = new Set();
for (const t of plan.targets) { assert(id(t.skillKey) && id(t.ownerKey)); assert(!targets.has(t.skillKey)); targets.add(t.skillKey); }
assert(Array.isArray(plan.requests) && plan.requests.length);
const detailRoutes = new Set();
for (const w of plan.requests) {
  assert.equal(w.method, 'POST');
  const match = /^\/skills\/([a-z0-9_]+)\/(effects|processes|trigger-rules)$/.exec(w.route);
  assert(match && targets.has(match[1]));
  assert(w.body && id(w.body[kinds[match[2]]]));
  assert.equal(w.detailRoute, w.route + '/' + w.body[kinds[match[2]]]);
  assert(!detailRoutes.has(w.detailRoute)); detailRoutes.add(w.detailRoute);
}
function sources() {
  assert(Array.isArray(plan.sourceFiles) && plan.sourceFiles.length);
  return plan.sourceFiles.map(s => {
    const root = s.root === 'web' ? web : s.root === 'planning' ? path.resolve(web, '../damage_viewer_project_planning') : null;
    assert(root && typeof s.path === 'string');
    const file = path.resolve(root, s.path); assert(file.startsWith(root + path.sep));
    const actualSha256 = sha(fs.readFileSync(file)); assert.equal(actualSha256, s.sha256, '来源变化：' + s.path);
    return { ...s, actualSha256 };
  });
}
function client() {
  const token = crypto.randomUUID(), audit = [];
  async function request(route, method = 'GET', body) {
    assert(method === 'GET' || mode === 'write');
    if (method !== 'GET') { const allowed = plan.requests.find(w => w.method === method && w.route === route && w.body[kinds[route.split('/').at(-1)]] === body[kinds[route.split('/').at(-1)]]); assert(allowed); assert.deepEqual(body, allowed.body); }
    const r = await fetch(base + route, { method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    const data = await r.json(); audit.push({ method, path: route, status: r.status }); return { status: r.status, data };
  }
  async function get(route, expectedStatus = 200) { const r = await request(route); assert.equal(r.status, expectedStatus, route); return r.data; }
  return { request, get, audit };
}
async function snapshot(api) {
  const values = {}, refs = new Set();
  const referenceKinds = { attributeKey: 'attributes', damageTypeKey: 'damage-types', absorbedDamageTypeKey: 'damage-types', modifierZoneKey: 'modifier-zones', statusKey: 'statuses' };
  function collect(x) { if (Array.isArray(x)) x.forEach(collect); else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (referenceKinds[k] && v !== null) { assert(id(v)); refs.add('/' + referenceKinds[k] + '/' + v); } collect(v); } }
  async function once(route) { if (!Object.hasOwn(values, route)) values[route] = await api.get(route); return values[route]; }
  collect(plan.requests);
  for (const t of plan.targets) {
    const root = '/skills/' + t.skillKey, owner = '/characters/' + t.ownerKey;
    for (const route of [root, owner, owner + '/attributes', owner + '/representative-image', root + '/representative-image', '/character-skill-relations?characterKey=' + t.ownerKey, '/character-skill-relations?skillKey=' + t.skillKey]) await once(route);
    for (const [kind, key] of Object.entries(kinds)) {
      const route = root + '/' + kind, list = await once(route); assert(Array.isArray(list)); assert.equal(new Set(list.map(row => row[key])).size, list.length);
      for (const row of list) { assert(id(row[key])); collect(await once(route + '/' + row[key])); }
    }
  }
  for (const route of refs) await once(route);
  return values;
}
function bodyOf(actual, w) {
  if (w.route.endsWith('/trigger-rules')) return actual;
  const { gameId, skillKey, createdAt, updatedAt, ...body } = actual;
  assert.equal(gameId, 'lol'); assert.equal(skillKey, w.route.split('/')[2]);
  for (const time of [createdAt, updatedAt]) assert(typeof time === 'string' && Number.isFinite(Date.parse(time)));
  return body;
}
function expectedSummary(w, actual) {
  const b = w.body, common = { name: b.name, description: b.description, sortOrder: b.sortOrder };
  assert(typeof actual.updatedAt === 'string' && Number.isFinite(Date.parse(actual.updatedAt)));
  if (w.route.endsWith('/trigger-rules')) return { ...common, ruleKey: b.ruleKey, eventType: b.eventSource.eventType, conditionGroupCount: b.conditionGroups.length, actionCount: b.actions.length, perTargetCooldownEnabled: b.perTargetCooldown !== null, maxTriggersPerProcessEnabled: b.maxTriggersPerProcess !== null, updatedAt: actual.updatedAt };
  assert(typeof actual.createdAt === 'string' && Number.isFinite(Date.parse(actual.createdAt)));
  const meta = { ...common, gameId: 'lol', skillKey: w.route.split('/')[2], createdAt: actual.createdAt, updatedAt: actual.updatedAt };
  return w.route.endsWith('/effects') ? { ...meta, effectKey: b.effectKey, resultCount: b.results.length, lifecycleEnabled: b.lifecycle !== null } : { ...meta, processKey: b.processKey, activationType: b.activationType, stepCount: b.steps.length, effectBindingCount: b.effectBindings.length, stateOperationCount: b.stateOperations.length };
}
const required = [executorKey, '01-候选方案.json', '02-冻结请求.json', '03-来源摘要.json', '04-写入前现值.json'];
if (mode === 'prepare') {
  for (const f of required.slice(2)) assert(!fs.existsSync(path.join(here, f)), '拒绝覆盖：' + f);
  const source = sources(), api = client(), values = await snapshot(api);
  for (const t of plan.targets) assert.equal(values['/skills/' + t.skillKey].status, 'ENABLED');
  for (const w of plan.requests) { assert(!Object.hasOwn(values, w.detailRoute)); await api.get(w.detailRoute, 404); }
  save('03-来源摘要.json', source);
  save('04-写入前现值.json', { at: new Date().toISOString(), base, values, audit: api.audit, businessWrites: 0 });
  save('02-冻结请求.json', { base, requests: plan.requests, sourceSha256: hash('03-来源摘要.json'), baselineSha256: hash('04-写入前现值.json') });
  console.log(JSON.stringify({ status: 'READY_FOR_REVIEW', GETs: api.audit.length, plannedPOSTs: plan.requests.length, batchFileSha256: hash('02-冻结请求.json') }));
} else {
  const review = read('05-独立评审.json'); assert.equal(review.status, 'APPROVED');
  for (const f of required) assert.equal(hash(f), review.approvedFiles[f], '批准文件漂移：' + f);
  assert.deepEqual(sources(), read('03-来源摘要.json'));
  const frozen = read('02-冻结请求.json'), before = read('04-写入前现值.json');
  assert.equal(frozen.base, base); assert.deepEqual(frozen.requests, plan.requests);
  assert.equal(frozen.sourceSha256, hash('03-来源摘要.json')); assert.equal(frozen.baselineSha256, hash('04-写入前现值.json'));
  const api = client(), values = await snapshot(api);
  if (mode === 'readback') {
    const writer = read('06-写入与即时回读.json'); assert.equal(writer.status, 'PASS');
    let unchanged = 0, changedCollections = 0;
    for (const [route, old] of Object.entries(before.values)) {
      const added = plan.requests.filter(w => w.route === route);
      if (!added.length) { assert.deepEqual(values[route], old, '已有数据变化：' + route); unchanged++; continue; }
      const key = kinds[route.split('/').at(-1)], rows = values[route]; assert.equal(rows.length, old.length + added.length);
      const oldByKey = new Map(old.map(row => [row[key], row]));
      for (const row of rows) { const w = added.find(w => w.body[key] === row[key]); if (w) assert.deepEqual(row, expectedSummary(w, row)); else { assert(oldByKey.has(row[key])); assert.deepEqual(row, oldByKey.get(row[key])); } }
      changedCollections++;
    }
    const newObjects = {};
    for (const w of plan.requests) { assert.deepEqual(bodyOf(values[w.detailRoute], w), w.body, w.detailRoute); newObjects[w.detailRoute] = values[w.detailRoute]; }
    assert.equal(Object.keys(values).length, Object.keys(before.values).length + plan.requests.length);
    console.log(JSON.stringify({ status: 'PASS', at: new Date().toISOString(), businessWrites: 0, GETs: api.audit.length, unchangedResponsesIncludingTimestamps: unchanged, expectedChangedCollections: changedCollections, newObjects, audit: api.audit }));
  } else {
    assert.deepEqual(values, before.values, '受保护现值漂移');
    for (const w of plan.requests) await api.get(w.detailRoute, 404);
    if (mode === 'preflight') console.log(JSON.stringify({ status: 'PASS', GETs: api.audit.length, businessWrites: 0 }));
    else {
      assert.equal(process.env.DAMAGE_APPROVED_BATCH_SHA, hash('02-冻结请求.json'));
      const report = { startedAt: new Date().toISOString(), status: 'STARTED', businessWritesAttempted: 0, operations: [], approvedFiles: review.approvedFiles };
      save('06-写入与即时回读.json', report);
      const persist = () => fs.writeFileSync(path.join(here, '06-写入与即时回读.json'), JSON.stringify(report, null, 2) + '\n');
      try {
        for (const w of plan.requests) {
          await api.get(w.detailRoute, 404); report.businessWritesAttempted++; report.pendingRoute = w.detailRoute; persist();
          const response = await api.request(w.route, w.method, w.body); report.operations.push({ method: w.method, route: w.route, response }); persist();
          assert.equal(response.status, 201); const actual = await api.get(w.detailRoute); assert.deepEqual(bodyOf(actual, w), w.body);
          report.operations.at(-1).readback = actual; report.pendingRoute = null; persist();
        }
        report.status = 'PASS';
      } catch (error) { report.status = 'FAILED_CHECK_CURRENT_BEFORE_RECOVERY'; report.error = error.message; throw error; }
      finally { report.finishedAt = new Date().toISOString(); report.audit = api.audit; persist(); }
      console.log(JSON.stringify({ status: report.status, writes: report.businessWritesAttempted, immediateReadbacks: report.operations.filter(x => x.readback).length }));
    }
  }
}
