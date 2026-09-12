import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const expectedHashes = JSON.parse(process.env.DAMAGE_APPROVED_HASHES_JSON ?? 'null');
if (!expectedHashes || typeof expectedHashes !== 'object') throw new Error('缺少 DAMAGE_APPROVED_HASHES_JSON');
const requiredFiles = ['01-来源与方案.md', '02-冻结请求.json', '03-来源快照.json', '04-写入前现值.json'];
if (Object.keys(expectedHashes).length !== requiredFiles.length || requiredFiles.some(file => typeof expectedHashes[file] !== 'string')) {
  throw new Error('批准散列文件集合不符');
}

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
const detailRoute = entry => entry.detailRoute ?? entry.route;

try {
  for (const [file, expected] of Object.entries(expectedHashes)) {
    const actual = shaFile(path.join(here, file));
    if (actual !== expected) throw new Error(`${file} 散列漂移：${actual}`);
  }
  const frozen = JSON.parse(fs.readFileSync(path.join(here, '02-冻结请求.json'), 'utf8'));
  const source = JSON.parse(fs.readFileSync(path.join(here, '03-来源快照.json'), 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(path.join(here, '04-写入前现值.json'), 'utf8'));
  const review = JSON.parse(fs.readFileSync(path.join(here, '05-Cursor独立评审.json'), 'utf8'));
  const normalizedPath = path.join(repo, '数据参考', 'lol-wiki-current-items', 'current-items.normalized.json');
  if (shaFile(normalizedPath) !== frozen.source.normalizedSha256 || source.normalized.sha256 !== frozen.source.normalizedSha256) {
    throw new Error('固定装备来源散列漂移');
  }
  if (frozen.planRevision !== 1 || frozen.plannedWrites !== 7 || frozen.writes.length !== 7) throw new Error('冻结写入数量或版本不符');
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
    const expectedBeforeStatus = entry.method === 'POST' ? 404 : 200;
    if (before.status !== expectedBeforeStatus) throw new Error(`写入目标现值异常：${route} (${before.status})`);
    const bodySha256 = entry.body === null ? null : crypto.createHash('sha256').update(JSON.stringify(stable(entry.body))).digest('hex');
    const changed = await request(entry.method, entry.route, entry.body);
    report.businessWriteCount += 1;
    const log = { method: entry.method, route: entry.route, detailRoute: route, bodySha256, status: changed.status, immediateReadback: null };
    report.writes.push(log);
    persist();
    const expectedWriteStatus = entry.method === 'POST' ? 201 : entry.method === 'DELETE' ? 204 : 200;
    if (changed.status !== expectedWriteStatus) throw new Error(`写入响应不符：${entry.method} ${entry.route} (${changed.status})`);
    if (entry.body !== null && !subsetEqual(changed.data, entry.body)) throw new Error(`写入响应内容不符：${entry.route}`);
    const readback = await request('GET', route);
    log.immediateReadback = readback;
    persist();
    if (entry.method === 'DELETE') {
      if (readback.status !== 404) throw new Error(`删除后对象仍存在：${route}`);
    } else if (readback.status !== 200 || !subsetEqual(readback.data, entry.body)) {
      throw new Error(`即时回读不符：${route}`);
    }
  }

  for (const entry of frozen.writes) {
    const route = detailRoute(entry);
    const readback = await request('GET', route);
    report.finalReadback.push(readback);
    if (entry.method === 'DELETE') {
      if (readback.status !== 404) throw new Error(`最终删除回读不符：${route}`);
    } else if (readback.status !== 200 || !subsetEqual(readback.data, entry.body)) {
      throw new Error(`最终回读不符：${route}`);
    }
  }

  const changedRoutes = new Set(frozen.writes.map(detailRoute));
  for (const expected of baseline.requests) {
    if (changedRoutes.has(expected.route)
      || expected.route === '/skills/item_3040_passive/parameters'
      || expected.route === '/skills/item_3040_passive/formulas'
      || expected.route === '/skills/item_3040_passive/effects'
      || expected.route === '/skills/item_3040_passive/trigger-rules') continue;
    const actual = await request('GET', expected.route);
    report.finalReadback.push(actual);
    if (actual.status !== expected.status || !equal(actual.data, expected.data)) throw new Error(`受保护对象变化：${expected.route}`);
  }

  const parameters = await request('GET', '/skills/item_3040_passive/parameters');
  const formulas = await request('GET', '/skills/item_3040_passive/formulas');
  const effects = await request('GET', '/skills/item_3040_passive/effects');
  const rules = await request('GET', '/skills/item_3040_passive/trigger-rules');
  report.finalReadback.push(parameters, formulas, effects, rules);
  if (parameters.status !== 200 || parameters.data.some(item => item.parameterKey === 'lifeline_shield_resource_input')) throw new Error('运行时护盾资源参数删除不完整');
  if (formulas.status !== 200 || !formulas.data.some(item => item.formulaKey === 'lifeline_health_threshold_value')) throw new Error('阈值公式列表缺失');
  if (effects.status !== 200 || effects.data.length !== 1 || effects.data[0].effectKey !== 'lifeline_shield') throw new Error('效果列表异常');
  if (rules.status !== 200 || rules.data.length !== 1 || rules.data[0].ruleKey !== 'on_damage_cross_below_lifeline_threshold') throw new Error('触发规则列表异常');

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

