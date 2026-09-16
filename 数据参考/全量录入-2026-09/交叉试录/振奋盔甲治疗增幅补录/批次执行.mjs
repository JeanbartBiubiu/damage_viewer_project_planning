import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { batchConfig } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', '..', '..', '..');
const planningRoot = path.resolve(webRoot, '..', 'damage_viewer_project_planning');
const mode = process.argv[2];
if (!new Set(['freeze', 'prepare', 'write', 'readback', 'targets', 'manifest']).has(mode)) {
  throw new Error('用法：node 批次执行.mjs freeze|prepare|write|readback|targets|manifest');
}

const names = {
  frozen: '02-冻结请求.json', sources: '03-来源散列快照.json', prepare: '04-写入前现值.json',
  review: '05-Cursor独立评审.json', resolution: '05b-主负责人修订复核.json', journal: '06-写入流水.jsonl', write: '06-写入与即时回读.json',
  readback: '07-独立GET回读.json', targets: '08-页面目标.json', browser: '09-页面验收.json',
  experience: '录入体验报告.md', manifest: '10-证据清单.json'
};
const files = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, path.join(here, name)]));
const managed = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
const strip = value => Array.isArray(value) ? value.map(strip) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !managed.has(key)).map(([key, item]) => [key, strip(item)])) : value;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(JSON.stringify(normalize(value)));
const fileHash = file => sha(fs.readFileSync(file));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); }
function missing(...targets) { for (const file of targets) if (fs.existsSync(file)) throw new Error(`${path.basename(file)} 已存在，拒绝覆盖。`); }
function sourcePath(source) {
  const root = source.root === 'web' ? webRoot : source.root === 'planning' ? planningRoot : null;
  if (!root) throw new Error(`未知来源根：${source.root}`);
  return path.join(root, ...source.relativePath.split('/'));
}
function verifySources() {
  const rows = batchConfig.sourceFiles.map(source => {
    const file = sourcePath(source), actualSha256 = fileHash(file);
    assert.equal(actualSha256, source.sha256, `来源散列漂移：${source.relativePath}`);
    return { ...source, actualSha256, byteSize: fs.statSync(file).size };
  });
  const candidate = read(sourcePath(batchConfig.sourceFiles[0])).objects.find(row => row.skill?.skillKey === 'item_3065_passive');
  assert.equal(candidate.parameters.find(row => row.parameterKey === 'heal_shield_power_bonus').fixedValue, 0.25);
  assert(candidate.sourceRefs.some(row => row.evidence.includes('HealingIncrease=0.25')));
  assert(candidate.sourceRefs.some(row => row.evidence.includes('护盾效果提升25%')));
  return rows;
}
function frozenPayload() {
  return {
    schemaVersion: batchConfig.schemaVersion,
    planRevision: batchConfig.planRevision,
    sourceVersion: batchConfig.sourceVersion,
    scope: batchConfig.scope,
    sourceFiles: batchConfig.sourceFiles,
    writes: [
      { method: 'POST', route: '/modifier-zones', detailRoute: `/modifier-zones/${batchConfig.modifierZone.modifierZoneKey}`, body: batchConfig.modifierZone },
      { method: 'PUT', route: '/skills/item_3065_passive/parameters/heal_shield_power_bonus', detailRoute: '/skills/item_3065_passive/parameters/heal_shield_power_bonus', body: batchConfig.updatedParameter },
      { method: 'POST', route: '/skills/item_3065_passive/effects', detailRoute: `/skills/item_3065_passive/effects/${batchConfig.effect.effectKey}`, body: batchConfig.effect },
      { method: 'POST', route: '/skills/item_3065_passive/trigger-rules', detailRoute: `/skills/item_3065_passive/trigger-rules/${batchConfig.rule.ruleKey}`, body: batchConfig.rule },
      { method: 'PUT', route: '/skills/item_3065_passive', detailRoute: '/skills/item_3065_passive', body: batchConfig.updatedSkill }
    ],
    boundary: batchConfig.runtimeBoundary
  };
}
function frozen() {
  const value = read(files.frozen), payload = frozenPayload();
  assert.deepEqual(value.payload, payload, '冻结请求与当前配置不一致');
  assert.equal(value.batchSha256, hash(payload), '冻结散列不一致');
  return value;
}
function apiClient({ writes = false } = {}) {
  const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
  if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
  const base = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
  const allowed = new Set(frozenPayload().writes.map(row => `${row.method} ${row.route}`)), log = [];
  async function request(route, options = {}) {
    const method = options.method || 'GET';
    if (method !== 'GET' && (!writes || !allowed.has(`${method} ${route}`))) throw new Error(`不允许的业务请求：${method} ${route}`);
    const response = await fetch(base + route, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(30_000)
    });
    const text = await response.text();
    let data = null;
    if (text) data = JSON.parse(text);
    log.push({ method, path: route, status: response.status });
    return { status: response.status, data };
  }
  async function get(route, status = 200) {
    const result = await request(route);
    assert.equal(result.status, status, `${route} 状态应为 ${status}`);
    return result.data;
  }
  return { request, get, log };
}
function audit(api) {
  const methodCounts = {}, statusCounts = {};
  for (const row of api.log) {
    methodCounts[row.method] = (methodCounts[row.method] || 0) + 1;
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
  }
  return { total: api.log.length, methodCounts, statusCounts, entries: api.log };
}
function expectedReadback(entry) {
  return entry.route === '/skills/item_3065_passive/parameters/heal_shield_power_bonus'
    ? { parameterKey: 'heal_shield_power_bonus', ...entry.body }
    : entry.body;
}
async function snapshot(api) {
  const routes = [
    '/equipment/item_3065', '/equipment/item_3065/attributes', '/equipment-skill-relations?equipmentKey=item_3065',
    '/skills/item_3065_passive', '/skills/item_3065_passive/parameters', '/skills/item_3065_passive/parameters/heal_shield_power_bonus',
    '/skills/item_3065_passive/formulas', '/skills/item_3065_passive/effects', '/skills/item_3065_passive/processes',
    '/skills/item_3065_passive/internal-states', '/skills/item_3065_passive/trigger-rules', '/skills/item_3065_passive/representative-image',
    '/modifier-zones'
  ];
  const values = {};
  for (const route of routes) values[route] = await api.get(route);
  const absent = [
    `/modifier-zones/${batchConfig.modifierZone.modifierZoneKey}`,
    `/skills/item_3065_passive/effects/${batchConfig.effect.effectKey}`,
    `/skills/item_3065_passive/trigger-rules/${batchConfig.rule.ruleKey}`
  ];
  for (const route of absent) values[route] = await api.get(route, 404);
  return { values, absent };
}
function verifyBefore(value) {
  assert.deepEqual(strip(value.values['/skills/item_3065_passive']), batchConfig.expectedCurrentSkill);
  assert.deepEqual(strip(value.values['/skills/item_3065_passive/parameters/heal_shield_power_bonus']), batchConfig.expectedCurrentParameter);
  assert.deepEqual(value.values['/skills/item_3065_passive/formulas'], []);
  assert.deepEqual(value.values['/skills/item_3065_passive/effects'], []);
  assert.deepEqual(value.values['/skills/item_3065_passive/processes'], []);
  assert.deepEqual(value.values['/skills/item_3065_passive/internal-states'], []);
  assert.deepEqual(value.values['/skills/item_3065_passive/trigger-rules'], []);
  assert.equal(value.values['/equipment-skill-relations?equipmentKey=item_3065'].total, 1);
  assert.equal(value.values['/skills/item_3065_passive/representative-image'].image?.enabled, true);
}

async function runFreeze() {
  missing(files.frozen, files.sources);
  const payload = frozenPayload(), batchSha256 = hash(payload), sources = verifySources();
  writeJson(files.frozen, { schemaVersion: 1, frozenAt: new Date().toISOString(), status: 'FROZEN', batchSha256, payload, authorizationValueRecorded: false });
  writeJson(files.sources, { schemaVersion: 1, capturedAt: new Date().toISOString(), status: 'PASS', batchSha256, files: sources });
  console.log(JSON.stringify({ status: 'FROZEN', batchSha256, writeCount: payload.writes.length }, null, 2));
}
async function runPrepare() {
  missing(files.prepare); const freeze = frozen(), api = apiClient(); verifySources();
  const current = await snapshot(api); verifyBefore(current);
  writeJson(files.prepare, { schemaVersion: 1, capturedAt: new Date().toISOString(), status: 'PASS', methodPolicy: 'GET_ONLY', batchSha256: freeze.batchSha256, businessWrites: 0, current, currentSha256: hash(current), requestAudit: audit(api), boundary: batchConfig.runtimeBoundary });
  console.log(JSON.stringify({ status: 'PASS', batchSha256: freeze.batchSha256, GETs: api.log.length, businessWrites: 0 }, null, 2));
}
async function runWrite() {
  missing(files.write, files.journal); const freeze = frozen(), prepared = read(files.prepare), review = read(files.review), resolution = read(files.resolution);
  assert.equal(prepared.status, 'PASS');
  assert.equal(review.status, 'REVISE');
  assert.equal(review.resultStatus, 'finished');
  assert.equal(review.reviewedPlanRevision, batchConfig.planRevision);
  assert.equal(review.reviewedBatchSha256, freeze.batchSha256);
  assert.equal(review.audit.runDeltaCount, 0);
  assert.equal(review.audit.runDeltaOutsideScopeCount, 0);
  assert.equal(review.audit.allTerminalCallsCompleted, true);
  assert.equal(review.audit.anyTruncated, false);
  assert.equal(resolution.status, 'APPROVED');
  assert.equal(resolution.reviewedPlanRevision, batchConfig.planRevision);
  assert.equal(resolution.approvedBatchSha256, freeze.batchSha256);
  assert.equal(resolution.batchExecutorSha256, fileHash(fileURLToPath(import.meta.url)));
  assert.equal(String(process.env.DAMAGE_APPROVED_BATCH_SHA || '').trim(), freeze.batchSha256, '批准散列不匹配');
  verifySources();
  const api = apiClient({ writes: true }), current = await snapshot(api); verifyBefore(current);
  assert.equal(hash(current), prepared.currentSha256, '写前现值漂移');
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), status: 'RUNNING', batchSha256: freeze.batchSha256, operations: [], businessWrites: 0, authorizationValueRecorded: false, error: null };
  const persist = () => fs.writeFileSync(files.write, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(files.journal, '', { flag: 'wx' }); persist();
  try {
    for (const entry of freeze.payload.writes) {
      const beforeStatus = entry.method === 'POST' ? 404 : 200;
      const before = await api.request(entry.detailRoute);
      assert.equal(before.status, beforeStatus, `${entry.detailRoute} 写入前状态漂移`);
      fs.appendFileSync(files.journal, `${JSON.stringify({ at: new Date().toISOString(), action: '准备写入', method: entry.method, path: entry.route, bodySha256: hash(entry.body) })}\n`);
      const result = await api.request(entry.route, { method: entry.method, body: entry.body });
      report.businessWrites += 1;
      const expectedStatus = entry.method === 'POST' ? 201 : 200;
      const readback = await api.request(entry.detailRoute);
      const matched = result.status === expectedStatus && readback.status === 200
        && JSON.stringify(normalize(strip(readback.data))) === JSON.stringify(normalize(expectedReadback(entry)));
      const row = { method: entry.method, path: entry.route, detailPath: entry.detailRoute, responseStatus: result.status, readbackStatus: readback.status, bodySha256: hash(entry.body), matched };
      report.operations.push(row); persist();
      fs.appendFileSync(files.journal, `${JSON.stringify({ at: new Date().toISOString(), action: '写入与即时回读', ...row })}\n`);
      assert(matched, `${entry.route} 写入或即时回读不一致`);
    }
    report.status = 'PASS'; report.completedAt = new Date().toISOString(); report.requestAudit = audit(api); persist();
    console.log(JSON.stringify({ status: report.status, businessWrites: report.businessWrites, operations: report.operations }, null, 2));
  } catch (error) {
    report.status = 'FAILED'; report.error = { message: error instanceof Error ? error.message : String(error) }; report.completedAt = new Date().toISOString(); report.requestAudit = audit(api); persist(); throw error;
  }
}
async function runReadback() {
  missing(files.readback); const freeze = frozen(), prepared = read(files.prepare), written = read(files.write), api = apiClient();
  assert.equal(written.status, 'PASS'); verifySources();
  const zone = strip(await api.get(`/modifier-zones/${batchConfig.modifierZone.modifierZoneKey}`));
  const effect = strip(await api.get(`/skills/item_3065_passive/effects/${batchConfig.effect.effectKey}`));
  const rule = strip(await api.get(`/skills/item_3065_passive/trigger-rules/${batchConfig.rule.ruleKey}`));
  const parameter = strip(await api.get('/skills/item_3065_passive/parameters/heal_shield_power_bonus'));
  const skill = strip(await api.get('/skills/item_3065_passive'));
  assert.deepEqual(zone, batchConfig.modifierZone); assert.deepEqual(parameter, { parameterKey: 'heal_shield_power_bonus', ...batchConfig.updatedParameter }); assert.deepEqual(effect, batchConfig.effect); assert.deepEqual(rule, batchConfig.rule); assert.deepEqual(skill, batchConfig.updatedSkill);
  const protectedRoutes = [
    '/equipment/item_3065', '/equipment/item_3065/attributes', '/equipment-skill-relations?equipmentKey=item_3065',
    '/skills/item_3065_passive/formulas', '/skills/item_3065_passive/processes', '/skills/item_3065_passive/internal-states', '/skills/item_3065_passive/representative-image'
  ];
  for (const route of protectedRoutes) assert.deepEqual(await api.get(route), prepared.current.values[route], `受保护对象变化：${route}`);
  const parameters = await api.get('/skills/item_3065_passive/parameters');
  assert.deepEqual(parameters.map(strip), [{ ...batchConfig.updatedParameter, parameterKey: 'heal_shield_power_bonus' }]);
  const zones = await api.get('/modifier-zones'), oldZones = prepared.current.values['/modifier-zones'].items;
  assert(oldZones.every(old => zones.items.some(item => JSON.stringify(item) === JSON.stringify(old))), '既有乘区变化');
  assert.equal(zones.total, oldZones.length + 1);
  const result = { schemaVersion: 1, capturedAt: new Date().toISOString(), status: 'PASS', methodPolicy: 'GET_ONLY', batchSha256: freeze.batchSha256, businessWrites: 0, current: { zone, parameter, effect, rule, skill }, hashes: { zone: hash(zone), parameter: hash(parameter), effect: hash(effect), rule: hash(rule), skill: hash(skill) }, requestAudit: audit(api), boundary: batchConfig.runtimeBoundary };
  writeJson(files.readback, result); console.log(JSON.stringify({ status: result.status, GETs: api.log.length, hashes: result.hashes }, null, 2));
}
async function runTargets() {
  missing(files.targets); const freeze = frozen(), readback = read(files.readback); assert.equal(readback.status, 'PASS');
  writeJson(files.targets, { schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'PASS', batchSha256: freeze.batchSha256, targetCount: 1, targets: [{ skillKey: 'item_3065_passive', skillName: batchConfig.updatedSkill.name, ownerKey: 'item_3065', expectedImageEnabled: true, modifierZone: batchConfig.modifierZone, effect: batchConfig.effect, rule: batchConfig.rule, skill: batchConfig.updatedSkill, readbackHashes: readback.hashes }], boundary: batchConfig.runtimeBoundary });
  console.log(JSON.stringify({ status: 'PASS', targetCount: 1 }, null, 2));
}
async function runManifest() {
  missing(files.manifest); const freeze = frozen(), prepared = read(files.prepare), review = read(files.review), resolution = read(files.resolution), written = read(files.write), readback = read(files.readback), targets = read(files.targets), browser = read(files.browser);
  assert.equal(prepared.status, 'PASS');
  assert.equal(review.status, 'REVISE');
  assert.equal(review.resultStatus, 'finished');
  assert.equal(review.reviewedPlanRevision, batchConfig.planRevision);
  assert.equal(review.reviewedBatchSha256, freeze.batchSha256);
  assert.equal(review.audit.runDeltaCount, 0);
  assert.equal(review.audit.runDeltaOutsideScopeCount, 0);
  assert.equal(review.audit.allTerminalCallsCompleted, true);
  assert.equal(review.audit.anyTruncated, false);
  assert.equal(resolution.status, 'APPROVED');
  assert.equal(resolution.reviewedPlanRevision, batchConfig.planRevision);
  assert.equal(resolution.approvedBatchSha256, freeze.batchSha256);
  assert.equal(resolution.cursorReviewSha256, fileHash(files.review));
  assert.equal(written.status, 'PASS'); assert.equal(readback.status, 'PASS'); assert.equal(targets.status, 'PASS'); assert.equal(browser.status, 'PASS'); assert.equal(browser.businessWrites, 0); assert.equal(browser.targetCount, 1); assert(browser.targets.every(row => row.matched));
  const evidence = [
    '01-补录方案.md',
    'README.md',
    '批次配置.mjs',
    '批次执行.mjs',
    'Cursor独立评审提示词.txt',
    '初版-02-冻结请求.json',
    '初版-03-来源散列快照.json',
    '初版-04-写入前现值.json',
    '初版-Cursor独立评审提示词.txt',
    '初版评审停止说明.md',
    ...Object.values(names).filter(name => name !== names.manifest),
  ];
  for (const name of evidence) assert(fs.existsSync(path.join(here, name)), `缺少证据：${name}`);
  const result = { schemaVersion: 1, capturedAt: new Date().toISOString(), status: 'PASS', scope: batchConfig.scope, batchSha256: freeze.batchSha256, final: { modifierZonesAdded: 1, effectsAdded: 1, triggerRulesAdded: 1, parameterDescriptionsUpdated: 1, skillDescriptionsUpdated: 1 }, conclusion: { equipmentKey: 'item_3065', conclusion: '资料待核', completedBranch: '来源初始化建立25%受到治疗增幅', remaining: '收到护盾增幅、Wasm组装、宿主初始化事件和真实战斗结算仍待处理。' }, browser: { targetCount: browser.targetCount, screenshots: browser.screenshots.length, businessWrites: browser.businessWrites, consoleErrors: browser.consoleErrors, consoleWarnings: browser.consoleWarnings, pageErrors: browser.pageErrors, failedRequests: browser.failedRequests }, files: evidence.map(name => { const file = path.join(here, name); return { name, sha256: fileHash(file), byteSize: fs.statSync(file).size }; }), boundary: batchConfig.runtimeBoundary };
  writeJson(files.manifest, result); console.log(JSON.stringify({ status: result.status, batchSha256: result.batchSha256, final: result.final, conclusion: result.conclusion, fileCount: result.files.length }, null, 2));
}

if (mode === 'freeze') await runFreeze();
else if (mode === 'prepare') await runPrepare();
else if (mode === 'write') await runWrite();
else if (mode === 'readback') await runReadback();
else if (mode === 'targets') await runTargets();
else await runManifest();
