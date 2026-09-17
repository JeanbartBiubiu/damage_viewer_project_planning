import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const expectedHashes = {
  '01-来源与方案.md': 'e7e73e5db9420ee6a5c2029a1246931a40f90f65e927c9566be364399c0afef2',
  '02-冻结请求.json': '9b389c44ea19f91de6f9a44edf425637e6051df2a983bb237edf94266cc622ac',
  '03-来源快照.json': 'd696846fdd7ca3f8cb466e7815eedec7fc662d9cca3930c34b2b2928e02bc47b',
  '04-写入前现值.json': '937e99671d21b928f5496360db633ea54f8aedcf8575df1bdb461a5a38ef3476'
};
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const outputPath = path.join(here, '06-写入与即时回读.json');
const report = {
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  authorizationValueRecorded: false,
  approvedHashes: expectedHashes,
  preflight: [],
  writes: [],
  finalReadback: [],
  businessWriteCount: 0,
  error: null
};

const shaFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
};
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const subsetEqual = (actual, expected) => {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((x, i) => subsetEqual(actual[i], x));
  if (expected && typeof expected === 'object') return actual && typeof actual === 'object' && !Array.isArray(actual)
    && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && subsetEqual(actual[key], value));
  return Object.is(actual, expected);
};
const persist = () => fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
const request = async (method, route, body = null) => {
  const response = await fetch(base + route, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { parseError: true, responseBytes: Buffer.byteLength(text) }; }
  }
  return { method, route, status: response.status, data };
};
const detailRoute = entry => {
  const body = entry.body;
  if (entry.route === '/modifier-zones') return `${entry.route}/${body.modifierZoneKey}`;
  if (entry.route.endsWith('/effects')) return `${entry.route}/${body.effectKey}`;
  if (entry.route.endsWith('/trigger-rules')) return `${entry.route}/${body.ruleKey}`;
  throw new Error(`无法确定回读路由：${entry.route}`);
};

try {
  for (const [file, expected] of Object.entries(expectedHashes)) {
    const actual = shaFile(path.join(here, file));
    if (actual !== expected) throw new Error(`${file} 散列漂移：${actual}`);
  }
  const normalizedPath = path.join(repo, '数据参考', 'lol-wiki-current-items', 'current-items.normalized.json');
  const frozen = JSON.parse(fs.readFileSync(path.join(here, '02-冻结请求.json'), 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(path.join(here, '04-写入前现值.json'), 'utf8'));
  const review = JSON.parse(fs.readFileSync(path.join(here, '05-Cursor独立评审.json'), 'utf8'));
  if (shaFile(normalizedPath) !== frozen.source.normalizedSha256) throw new Error('固定装备来源散列漂移');
  if (frozen.planRevision !== 1 || frozen.plannedWrites !== 6 || frozen.writes.length !== 6) throw new Error('冻结写入数量或版本不符');
  if (review.resultStatus !== 'finished' || review.verdict !== 'READY' || review.reviewedPlanRevision !== 1
    || review.writeAllowlistAudit?.runDeltaCount !== 0 || review.toolEvents?.allTerminalCallsCompleted !== true
    || review.toolEvents?.anyTruncated !== false || review.apiWrites !== 0) throw new Error('Cursor 评审未满足写入门禁');

  for (const expected of baseline.requests) {
    const actual = await request('GET', expected.route);
    report.preflight.push(actual);
    persist();
    if (actual.status !== expected.status || !equal(actual.data, expected.data)) throw new Error(`写前现值漂移：${expected.route}`);
  }

  for (const entry of frozen.writes) {
    const route = detailRoute(entry);
    const before = await request('GET', route);
    if (before.status !== 404) throw new Error(`新增目标不再为空：${route} (${before.status})`);
    const bodySha256 = crypto.createHash('sha256').update(JSON.stringify(stable(entry.body))).digest('hex');
    const created = await request(entry.method, entry.route, entry.body);
    report.businessWriteCount += 1;
    const log = { method: entry.method, route: entry.route, detailRoute: route, bodySha256, status: created.status, immediateReadback: null };
    report.writes.push(log);
    persist();
    if (created.status !== 201 || !subsetEqual(created.data, entry.body)) throw new Error(`新增响应不符：${entry.route} (${created.status})`);
    const readback = await request('GET', route);
    log.immediateReadback = readback;
    persist();
    if (readback.status !== 200 || !subsetEqual(readback.data, entry.body)) throw new Error(`即时回读不符：${route}`);
  }

  for (const entry of frozen.writes) {
    const route = detailRoute(entry);
    const readback = await request('GET', route);
    report.finalReadback.push(readback);
    if (readback.status !== 200 || !subsetEqual(readback.data, entry.body)) throw new Error(`最终回读不符：${route}`);
  }
  const protectedRoutes = baseline.requests.filter(item => !item.route.startsWith('/modifier-zones')
    && !item.route.endsWith('/effects') && !item.route.endsWith('/trigger-rules')
    && !item.route.includes('/effects/') && !item.route.includes('/trigger-rules/'));
  for (const expected of protectedRoutes) {
    const actual = await request('GET', expected.route);
    report.finalReadback.push(actual);
    if (actual.status !== expected.status || !equal(actual.data, expected.data)) throw new Error(`受保护对象变化：${expected.route}`);
  }
  const zones = await request('GET', '/modifier-zones');
  report.finalReadback.push(zones);
  const oldZones = baseline.requests.find(item => item.route === '/modifier-zones').data.items;
  if (zones.status !== 200 || oldZones.some(old => !zones.data.items.some(item => equal(item, old)))) throw new Error('既有乘区发生变化');
  if (zones.data.total !== oldZones.length + 2) throw new Error(`乘区总数异常：${zones.data.total}`);

  report.status = 'PASS';
  report.completedAt = new Date().toISOString();
  persist();
  process.stdout.write(JSON.stringify({ status: report.status, preflightGets: report.preflight.length, businessWrites: report.businessWriteCount, finalGets: report.finalReadback.length }, null, 2));
} catch (error) {
  report.status = 'FAILED';
  report.error = { message: error instanceof Error ? error.message : String(error) };
  report.completedAt = new Date().toISOString();
  persist();
  throw error;
}
