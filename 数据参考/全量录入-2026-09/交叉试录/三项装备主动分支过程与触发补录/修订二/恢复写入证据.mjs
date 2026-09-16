import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { batchConfig } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const journalFile = path.join(here, '06-写入流水.jsonl');
const outputFile = path.join(here, '06-写入与即时回读.json');
const runnerFile = path.join(here, '批次执行.mjs');
const configFile = path.join(here, '批次配置.mjs');
const frozenFile = path.join(here, '02-冻结请求.json');
if (fs.existsSync(outputFile)) throw new Error('06-写入与即时回读.json 已存在，拒绝覆盖。');

const managed = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
function normalize(value) { if (Array.isArray(value)) return value.map(normalize); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])); }
function strip(value) { if (Array.isArray(value)) return value.map(strip); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.entries(value).filter(([key]) => !managed.has(key)).map(([key, item]) => [key, strip(item)])); }
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(normalize(value)));
const fileHash = file => sha(fs.readFileSync(file));
const frozen = JSON.parse(fs.readFileSync(frozenFile, 'utf8'));

const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
const base = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const requests = [];
async function get(route, expected = 200) {
  const response = await fetch(base + route, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  const raw = await response.text(); const data = raw ? JSON.parse(raw) : null;
  requests.push({ method: 'GET', path: route, status: response.status });
  assert.equal(response.status, expected, route + ' 状态应为 ' + expected);
  return data;
}

const rows = fs.readFileSync(journalFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
assert.equal(rows.length, 18);
const completed = rows.filter(row => row.action === '写入后即时回读');
assert.equal(completed.length, 9);
assert(completed.every(row => row.matched === true));
const planned = rows.filter(row => row.action === '准备写入');
assert.equal(planned.length, 9);
const methodCounts = {};
for (const row of planned) methodCounts[row.method] = (methodCounts[row.method] || 0) + 1;
assert.deepEqual(methodCounts, { PUT: 3, DELETE: 1, POST: 5 });

const skills = await get('/skills');
assert.equal(skills.total, batchConfig.expectedCurrent.skillCount);
const targets = [];
for (const target of batchConfig.targets) {
  const root = '/skills/' + encodeURIComponent(target.skillKey);
  const current = { skill: await get(root) };
  if (target.formulaUpdate) {
    current.formula = await get(root + '/formulas/' + encodeURIComponent(target.formulaUpdate.formulaKey));
    assert.deepEqual(strip(current.formula), target.formulaUpdate);
  }
  if (target.deleteParameterKey) {
    current.deletedParameterStatus = 404;
    await get(root + '/parameters/' + encodeURIComponent(target.deleteParameterKey), 404);
  }
  if (target.process) {
    current.process = await get(root + '/processes/' + encodeURIComponent(target.process.processKey));
    assert.deepEqual(strip(current.process), target.process);
  }
  current.rule = await get(root + '/trigger-rules/' + encodeURIComponent(target.rule.ruleKey));
  assert.deepEqual(strip(current.rule), target.rule);
  if (target.updatedSkill) assert.deepEqual(strip(current.skill), target.updatedSkill);
  targets.push({ skillKey: target.skillKey, current, currentSha256: hash(current) });
}
assert(requests.every(row => row.method === 'GET'));

const statusCounts = {};
for (const row of requests) statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
const operations = planned.map(row => {
  const done = completed.find(item => item.label === row.label);
  assert(done);
  return { label: row.label, method: row.method, path: row.path, responseStatus: done.responseStatus, responseError: done.responseError, readbackStatus: done.readbackStatus, matched: done.matched };
});
const output = {
  schemaVersion: 3,
  recoveredAt: new Date().toISOString(),
  status: 'PASS',
  batchSha256: frozen.batchSha256,
  recoveredFromPostWriteSummaryError: true,
  summaryError: '全部业务请求和即时回读完成后，统计局部变量遮蔽同名函数；没有重放任何业务请求。',
  executedRunnerSha256: '4e7d27e1349ab16b483c58a6d5222f6e2bec551b218f11711e1788e9e2b05ddb',
  currentRunnerSha256: fileHash(runnerFile),
  configSha256: fileHash(configFile),
  authorizationValueRecorded: false,
  operations,
  immediateTargets: targets,
  requestAudit: {
    originalBusinessMethodCounts: methodCounts,
    originalImmediateReadbacks: completed.length,
    recovery: { total: requests.length, methodCounts: { GET: requests.length }, statusCounts, entries: requests }
  },
  businessWrites: 9,
  businessRequestsReplayed: 0,
  boundary: batchConfig.writeBoundary
};
fs.writeFileSync(outputFile, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: output.status, batchSha256: output.batchSha256, recoveredFromPostWriteSummaryError: true, businessWrites: output.businessWrites, businessRequestsReplayed: 0, originalBusinessMethodCounts: methodCounts, recoveryGetCount: requests.length, targets: targets.map(row => row.skillKey) }, null, 2));
