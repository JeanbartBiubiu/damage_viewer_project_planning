import fs from 'node:fs';
import assert from 'node:assert/strict';
const apply = process.argv.includes('--apply');
assert.ok(process.argv.slice(2).every(arg => arg === '--apply'), '只接受 --apply');
const allowed = new Set(["PUT /skills/sivir_e/effects/block_heal"]);
const plan = JSON.parse(fs.readFileSync(new URL('./纠错请求.json', import.meta.url)));
const backup = JSON.parse(fs.readFileSync(new URL('./修改前完整回读.json', import.meta.url)));
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const stamp = new Date().toISOString().replaceAll(':', '-');
const report = { startedAt: new Date().toISOString(), mode: apply ? '明确纠错写入' : '只读预检', preflight: [], writes: [], readbacks: [], failures: [], passed: false };
function project(actual, expected) {
  if (Array.isArray(expected)) { assert.ok(Array.isArray(actual)); assert.equal(actual.length, expected.length); return actual.map((v,i) => project(v,expected[i])); }
  if (expected && typeof expected === 'object') return Object.fromEntries(Object.keys(expected).map(k => [k, project(actual?.[k],expected[k])]));
  return actual;
}
function matches(actual, expected) { try { assert.deepEqual(project(actual,expected),expected); return true; } catch { return false; } }
async function request(endpoint, method = 'GET', body) {
  assert.ok(endpoint.startsWith('/skills/' + plan.skillKey + '/'), '越出本技能');
  if (method !== 'GET') assert.ok(allowed.has(method + ' ' + endpoint), '越出本次写入白名单');
  const r = await fetch(base + endpoint, { method, headers: { Authorization: 'Bearer local-entry', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  return { status: r.status, data: await r.json() };
}
function classify(operation, actual) {
  if (actual.status === 200 && matches(actual.data, operation.expected)) return '同值跳过';
  const old = backup.records.find(r => r.endpoint === operation.endpoint);
  assert.ok(old, '缺少完整旧值备份');
  assert.equal(actual.status, old.status, operation.endpoint + ' 状态已变化');
  assert.deepEqual(actual.data, old.data, operation.endpoint + ' 已变化，停止而不覆盖');
  return operation.method === 'PUT' ? '允许精确旧值更新' : '允许补缺';
}
try {
  assert.equal(plan.operations.length, allowed.size);
  for (const operation of plan.operations) {
    const writeEndpoint = operation.method === 'POST' ? operation.endpoint.slice(0, operation.endpoint.lastIndexOf('/')) : operation.endpoint;
    assert.ok(allowed.has(operation.method + ' ' + writeEndpoint));
    const before = await request(operation.endpoint);
    report.preflight.push({ endpoint: operation.endpoint, state: classify(operation,before) });
  }
  if (apply) for (const operation of plan.operations) {
    const before = await request(operation.endpoint);
    if (classify(operation,before) === '同值跳过') { report.writes.push({ endpoint: operation.endpoint, action: '同值跳过' }); continue; }
    const writeEndpoint = operation.method === 'POST' ? operation.endpoint.slice(0, operation.endpoint.lastIndexOf('/')) : operation.endpoint;
    const record = { endpoint: operation.endpoint, method: operation.method, at: new Date().toISOString() };
    report.writes.push(record);
    const written = await request(writeEndpoint, operation.method, operation.body);
    record.status = written.status;
    if (![200,201].includes(written.status)) record.response = written.data;
    const after = await request(operation.endpoint);
    record.readback = after;
    record.matches = after.status === 200 && matches(after.data,operation.expected);
    assert.ok(record.matches, operation.endpoint + ' 写后回读不符');
  }
  for (const operation of plan.operations) {
    const actual = await request(operation.endpoint);
    const state = classify(operation,actual);
    report.readbacks.push({ endpoint: operation.endpoint, expected: operation.expected, actual, matches: state === '同值跳过' });
  }
  report.passed = report.readbacks.every(r => r.matches);
} catch (error) {
  report.failures.push(String(error)); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(new URL('./' + (apply ? '写入回读-' : '只读预检-') + stamp + '.json', import.meta.url), JSON.stringify(report,null,2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ mode: report.mode, pending: report.preflight.filter(r => r.state !== '同值跳过').length, writes: report.writes.map(r => ({ endpoint:r.endpoint,status:r.status,action:r.action,matches:r.matches })), passed: report.passed, failures:report.failures }));
}
