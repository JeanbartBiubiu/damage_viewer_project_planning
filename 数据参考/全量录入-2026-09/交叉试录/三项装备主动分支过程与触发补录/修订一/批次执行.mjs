import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { batchConfig } from './批次配置.mjs';

const batchDirectory = path.dirname(fileURLToPath(import.meta.url));
const parentDirectory = path.resolve(batchDirectory, '..');
const webRoot = path.resolve(batchDirectory, '..', '..', '..', '..', '..');
const planningRoot = path.resolve(webRoot, '..', 'damage_viewer_project_planning');
const mode = process.argv[2];
if (!new Set(['freeze', 'prepare', 'review', 'write', 'readback', 'targets', 'manifest']).has(mode)) throw new Error('用法：node 批次执行.mjs freeze|prepare|review|write|readback|targets|manifest');

const out = Object.fromEntries(Object.entries({
  frozen: '02-冻结请求.json', sources: '03-来源散列快照.json', prepare: '04-写入前现值.json', review: '05-独立写前评审.json', journal: '06-写入流水.jsonl', write: '06-写入与即时回读.json', readback: '07-独立GET回读.json', targets: '08-页面目标.json', browser: '09-页面验收.json', experience: '录入体验报告.md', manifest: '10-证据清单.json'
}).map(([key, name]) => [key, path.join(batchDirectory, name)]));
const parentPrepareFile = path.join(parentDirectory, '04-写入前现值.json');
const parentFailureFile = path.join(parentDirectory, '06-首个请求失败后只读回查.json');
const managed = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
}
function stripManaged(value) {
  if (Array.isArray(value)) return value.map(stripManaged);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !managed.has(key)).map(([key, item]) => [key, stripManaged(item)]));
}
const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonicalSha = value => shaBytes(JSON.stringify(normalize(value)));
const fileSha = file => shaBytes(fs.readFileSync(file));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); }
function assertMissing(...files) { for (const file of files) if (fs.existsSync(file)) throw new Error(path.basename(file) + ' 已存在，拒绝覆盖。'); }
async function mapLimit(values, limit, worker) {
  const results = new Array(values.length); let cursor = 0;
  async function run() { while (cursor < values.length) { const index = cursor++; results[index] = await worker(values[index], index); } }
  await Promise.all(Array.from({ length: Math.min(values.length, limit) }, run)); return results;
}

function sourcePath(source) {
  const root = source.root === 'web' ? webRoot : source.root === 'planning' ? planningRoot : null;
  if (!root) throw new Error('未知来源工作树：' + source.root);
  return path.join(root, ...source.relativePath.split('/'));
}
function validateSources() {
  const evidence = [];
  for (const source of batchConfig.sourceFiles) {
    const file = sourcePath(source); const actual = fileSha(file);
    assert.equal(actual, source.sha256, '固定来源散列漂移：' + source.relativePath);
    evidence.push({ ...source, actualSha256: actual, byteSize: fs.statSync(file).size });
  }
  const zh = readJson(sourcePath(batchConfig.sourceFiles.find(item => item.id === 'zhonyasReview'))).candidates.find(item => item.skillKey === 'item_3157_active' && item.status === 'DEFERRED');
  const qss = readJson(sourcePath(batchConfig.sourceFiles.find(item => item.id === 'qssReview'))).candidates.find(item => item.skillKey === 'item_3139_active' && item.status === 'DEFERRED');
  const red = readJson(sourcePath(batchConfig.sourceFiles.find(item => item.id === 'redemptionSource'))).selectedRawObjects.item_3107;
  assert.equal(zh.current.components.parameters.details.active_cooldown_ms.data.fixedValue, 120000);
  assert.equal(zh.current.components.parameters.details.stasis_duration_ms.data.fixedValue, 2500);
  assert.equal(qss.current.components.parameters.details.active_cooldown_ms.data.fixedValue, 90000);
  assert.equal(qss.current.components.parameters.details.move_speed_ratio.data.fixedValue, 0.5);
  assert.equal(qss.current.components.parameters.details.move_speed_duration_ms.data.fixedValue, 2000);
  assert(Math.abs(red.dataValues.DamageToChampions - 0.1) < 1e-6);
  assert.equal(red.dataValues.Cooldown, 90);
  assert.equal(red.dataValues.DiminishedEffect, 0.5);
  assert(red.bindings.some(item => item.text.includes('在2.5秒后') && item.text.includes('10%最大生命值的真实伤害')));
  return { status: 'PASS', files: evidence };
}
function payload() {
  return { schemaVersion: batchConfig.schemaVersion, sourceVersion: batchConfig.sourceVersion, scope: batchConfig.scope, expectedCurrent: batchConfig.expectedCurrent, sourceFiles: batchConfig.sourceFiles, targets: batchConfig.targets, writeBoundary: batchConfig.writeBoundary, runtimeBoundary: batchConfig.runtimeBoundary, correctionBasis: { parentPrepareSha256: fileSha(parentPrepareFile), parentFailureSha256: fileSha(parentFailureFile), directAttributePattern: { formula: 'nasus_r/damage_per_second', node: { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'TOTAL' } } } };
}
function allowedWrites() {
  const set = new Set();
  for (const target of batchConfig.targets) {
    const base = '/skills/' + encodeURIComponent(target.skillKey);
    if (target.formulaUpdate) set.add('PUT ' + base + '/formulas/' + encodeURIComponent(target.formulaUpdate.formulaKey));
    if (target.deleteParameterKey) set.add('DELETE ' + base + '/parameters/' + encodeURIComponent(target.deleteParameterKey));
    if (target.process) set.add('POST ' + base + '/processes');
    set.add('POST ' + base + '/trigger-rules');
    if (target.updatedSkill) set.add('PUT ' + base);
  }
  return set;
}
function assertFrozen() {
  const frozen = readJson(out.frozen); const current = payload();
  assert.deepEqual(frozen.payload, current, '冻结请求与当前修订配置不一致');
  assert.equal(frozen.batchSha256, canonicalSha(current)); return frozen;
}

function client({ writable = false } = {}) {
  const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
  if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
  const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
  const log = []; const allowlist = allowedWrites();
  async function request(route, options = {}) {
    const method = options.method || 'GET';
    if (method !== 'GET' && (!writable || !allowlist.has(method + ' ' + route))) throw new Error('不允许的业务请求：' + method + ' ' + route);
    const response = await fetch(baseUrl + route, { method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), signal: AbortSignal.timeout(30_000) });
    const raw = await response.text(); let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { throw new Error('接口未返回JSON：' + route + ' HTTP ' + response.status); }
    log.push({ method, path: route, status: response.status }); return { status: response.status, ok: response.ok, data };
  }
  async function get(route, expected = 200) { const result = await request(route); assert.equal(result.status, expected, route + ' 状态应为 ' + expected); return result.data; }
  return { request, get, log };
}
function audit(api) {
  const methodCounts = {}, statusCounts = {};
  for (const row of api.log) { methodCounts[row.method] = (methodCounts[row.method] || 0) + 1; statusCounts[row.status] = (statusCounts[row.status] || 0) + 1; }
  return { total: api.log.length, methodCounts, statusCounts, entries: api.log };
}

async function captureGlobal(api) {
  const list = await api.get('/skills');
  assert.equal(list.total, batchConfig.expectedCurrent.skillCount); assert.equal(list.items.length, list.total);
  const rows = await mapLimit(list.items, 12, async skill => {
    const base = '/skills/' + encodeURIComponent(skill.skillKey);
    const [rules, processes] = await Promise.all([api.get(base + '/trigger-rules'), api.get(base + '/processes')]);
    const ruleDetails = await mapLimit(rules, 8, async row => ({ skillKey: skill.skillKey, ruleKey: row.ruleKey, updatedAt: row.updatedAt, body: stripManaged(await api.get(base + '/trigger-rules/' + encodeURIComponent(row.ruleKey))) }));
    const processDetails = await mapLimit(processes, 8, async row => ({ skillKey: skill.skillKey, processKey: row.processKey, updatedAt: row.updatedAt, body: stripManaged(await api.get(base + '/processes/' + encodeURIComponent(row.processKey))) }));
    return { skill, ruleDetails, processDetails };
  });
  const skills = rows.map(row => ({ skillKey: row.skill.skillKey, updatedAt: row.skill.updatedAt, body: stripManaged(row.skill) })).sort((a, b) => a.skillKey.localeCompare(b.skillKey));
  const rules = rows.flatMap(row => row.ruleDetails).sort((a, b) => a.skillKey.localeCompare(b.skillKey) || a.ruleKey.localeCompare(b.ruleKey));
  const processes = rows.flatMap(row => row.processDetails).sort((a, b) => a.skillKey.localeCompare(b.skillKey) || a.processKey.localeCompare(b.processKey));
  return { skillCount: skills.length, ruleCount: rules.length, processCount: processes.length, sourceInitializedCount: rules.filter(row => row.body.eventSource?.eventType === 'SOURCE_INITIALIZED').length, skills, rules, processes, hashes: { skills: canonicalSha(skills), rules: canonicalSha(rules), processes: canonicalSha(processes) } };
}
async function collection(api, skillKey, segment, key) {
  const base = '/skills/' + encodeURIComponent(skillKey) + '/' + segment; const summaries = await api.get(base); const details = [];
  assert(Array.isArray(summaries));
  for (const row of summaries) details.push(stripManaged(await api.get(base + '/' + encodeURIComponent(row[key]))));
  return { keys: summaries.map(row => row[key]).sort(), summaries, details };
}
async function captureTarget(api, target) {
  const base = '/skills/' + encodeURIComponent(target.skillKey);
  const [skill, parameters, formulas, effects, processes, states, rules, relation, image] = await Promise.all([
    api.get(base), collection(api, target.skillKey, 'parameters', 'parameterKey'), collection(api, target.skillKey, 'formulas', 'formulaKey'), collection(api, target.skillKey, 'effects', 'effectKey'), collection(api, target.skillKey, 'processes', 'processKey'), collection(api, target.skillKey, 'internal-states', 'stateKey'), collection(api, target.skillKey, 'trigger-rules', 'ruleKey'), api.get('/equipment-skill-relations?equipmentKey=' + encodeURIComponent(target.ownerKey)), api.get(base + '/representative-image')
  ]);
  return { skill, businessSkill: stripManaged(skill), parameters, formulas, effects, processes, states, rules, relation, image };
}
const by = (collectionValue, key, value) => collectionValue.details.find(row => row[key] === value);
function expectedBeforeParameters(target) { return [...target.expectedParameters, ...(target.deleteParameterKey ? [target.deleteParameterKey] : [])].sort(); }
function validateCommon(target, value) {
  assert.equal(value.skill.skillKey, target.skillKey); assert.equal(value.skill.name, target.skillName);
  assert.deepEqual(value.effects.keys, [...target.expectedEffects].sort());
  for (const [key, expected] of Object.entries(target.expectedParameterValues)) { const parameter = by(value.parameters, 'parameterKey', key); assert(parameter); assert.equal(parameter.fixedValue, expected); }
  assert.equal(value.relation.total, 1); assert.equal(value.relation.items[0].equipmentKey, target.ownerKey); assert.equal(value.relation.items[0].skillKey, target.skillKey); assert.equal(value.image.image?.enabled, true);
  if (target.skillKey === 'item_3107_active') { const effect = by(value.effects, 'effectKey', 'enemy_true_damage'); assert.equal(effect.results[0].target, 'TARGET'); assert.equal(effect.results[0].detail.damageTypeKey, 'real'); }
  if (target.skillKey === 'item_3139_active') { const effect = by(value.effects, 'effectKey', 'quicksilver_move_speed'); assert.equal(effect.results[0].target, 'SOURCE'); assert.equal(effect.results[0].detail.attributeKey, 'move_speed_percent'); }
  if (target.skillKey === 'item_3157_active') { const effect = by(value.effects, 'effectKey', 'stasis_damage_immunity'); assert.equal(effect.results[0].target, 'SOURCE'); assert.equal(effect.results[0].resultType, 'DAMAGE_IMMUNITY'); }
}
function validateBefore(target, value) {
  validateCommon(target, value); assert.deepEqual(value.parameters.keys, expectedBeforeParameters(target)); assert.deepEqual(value.processes.keys, []); assert.deepEqual(value.rules.keys, []);
  if (target.expectedCurrentDescription) assert.equal(value.skill.description, target.expectedCurrentDescription);
  if (target.expectedCurrentFormula) assert.deepEqual(by(value.formulas, 'formulaKey', target.expectedCurrentFormula.formulaKey), target.expectedCurrentFormula);
}
function validateAfter(target, value) {
  validateCommon(target, value); assert.deepEqual(value.parameters.keys, [...target.expectedParameters].sort());
  if (target.formulaUpdate) assert.deepEqual(by(value.formulas, 'formulaKey', target.formulaUpdate.formulaKey), { formulaKey: target.formulaUpdate.formulaKey, ...target.formulaUpdate });
  if (target.updatedSkill) assert.deepEqual(value.businessSkill, target.updatedSkill);
  if (target.process) { assert.deepEqual(value.processes.keys, [target.process.processKey]); assert.deepEqual(by(value.processes, 'processKey', target.process.processKey), target.process); } else assert.deepEqual(value.processes.keys, []);
  assert.deepEqual(value.rules.keys, [target.rule.ruleKey]); assert.deepEqual(by(value.rules, 'ruleKey', target.rule.ruleKey), target.rule);
}
function unchangedSubset(value) { return { effects: value.effects, states: value.states, relation: value.relation, image: value.image }; }
function targetAfterExpectedFromBefore(target, before) {
  const expected = structuredClone(before);
  if (target.updatedSkill) expected.businessSkill = target.updatedSkill;
  if (target.formulaUpdate) {
    const index = expected.formulas.details.findIndex(row => row.formulaKey === target.formulaUpdate.formulaKey);
    expected.formulas.details[index] = { formulaKey: target.formulaUpdate.formulaKey, ...target.formulaUpdate };
    expected.formulas.keys = expected.formulas.details.map(row => row.formulaKey).sort();
  }
  if (target.deleteParameterKey) {
    expected.parameters.details = expected.parameters.details.filter(row => row.parameterKey !== target.deleteParameterKey);
    expected.parameters.keys = expected.parameters.details.map(row => row.parameterKey).sort();
  }
  return expected;
}

async function freeze() {
  assertMissing(out.frozen, out.sources); const sources = validateSources(); const body = payload(); const batchSha256 = canonicalSha(body);
  writeJson(out.frozen, { schemaVersion: 2, frozenAt: new Date().toISOString(), status: 'FROZEN', batchSha256, payload: body, allowedWrites: [...allowedWrites()].sort(), authorizationValueRecorded: false });
  writeJson(out.sources, { schemaVersion: 2, capturedAt: new Date().toISOString(), ...sources, batchSha256, correctionBasis: body.correctionBasis });
  process.stdout.write(JSON.stringify({ status: 'FROZEN', batchSha256, targetCount: batchConfig.targets.length, allowedWrites: [...allowedWrites()].sort(), sources: sources.files.map(row => ({ id: row.id, sha256: row.actualSha256 })) }, null, 2));
}
async function prepare() {
  assertMissing(out.prepare); const frozen = assertFrozen(); validateSources(); const parent = readJson(parentPrepareFile); const api = client(); const global = await captureGlobal(api);
  assert.equal(global.ruleCount, batchConfig.expectedCurrent.ruleCount); assert.equal(global.sourceInitializedCount, batchConfig.expectedCurrent.sourceInitializedCount); assert.deepEqual(global.hashes, parent.global.hashes, '首次写入失败后全库基线发生变化');
  const targets = [];
  for (const target of batchConfig.targets) { const current = await captureTarget(api, target); validateBefore(target, current); targets.push({ skillKey: target.skillKey, current, currentSha256: canonicalSha(current) }); }
  assert(api.log.every(row => row.method === 'GET'));
  const result = { schemaVersion: 2, capturedAt: new Date().toISOString(), status: 'PASS', methodPolicy: 'GET_ONLY', batchSha256: frozen.batchSha256, parentPrepareSha256: fileSha(parentPrepareFile), parentFailureSha256: fileSha(parentFailureFile), businessWrites: 0, global, globalSha256: canonicalSha(global), targets, requestAudit: audit(api), boundary: batchConfig.writeBoundary };
  writeJson(out.prepare, result); process.stdout.write(JSON.stringify({ status: result.status, batchSha256: result.batchSha256, getCount: result.requestAudit.methodCounts.GET, global: { skillCount: global.skillCount, ruleCount: global.ruleCount, processCount: global.processCount, sourceInitializedCount: global.sourceInitializedCount }, targets: targets.map(row => row.skillKey), businessWrites: 0 }, null, 2));
}
async function review() {
  assertMissing(out.review); const frozen = assertFrozen(); validateSources(); const prepared = readJson(out.prepare); const api = client(); const global = await captureGlobal(api);
  assert.deepEqual(global, prepared.global, '独立评审全库基线与准备阶段不一致'); const targetChecks = [];
  for (const target of batchConfig.targets) { const current = await captureTarget(api, target); validateBefore(target, current); const prior = prepared.targets.find(row => row.skillKey === target.skillKey); assert.equal(canonicalSha(current), prior.currentSha256); targetChecks.push({ skillKey: target.skillKey, currentSha256: prior.currentSha256, status: 'APPROVED' }); }
  assert(api.log.every(row => row.method === 'GET'));
  const result = { schemaVersion: 2, reviewedAt: new Date().toISOString(), status: 'APPROVED', methodPolicy: 'GET_ONLY', approvedBatchSha256: frozen.batchSha256, approvedPrepareSha256: fileSha(out.prepare), global: { skillCount: global.skillCount, ruleCount: global.ruleCount, processCount: global.processCount, sourceInitializedCount: global.sourceInitializedCount, hashes: global.hashes }, targetChecks, requestAudit: audit(api), businessWrites: 0, reviewBoundary: '批准救赎公式纠错和精确参数删除，以及两个主动过程、三条规则和两项说明；其余分支不在批准范围。' };
  writeJson(out.review, result); process.stdout.write(JSON.stringify({ status: result.status, approvedBatchSha256: result.approvedBatchSha256, getCount: result.requestAudit.methodCounts.GET, global: result.global, targets: targetChecks, businessWrites: 0 }, null, 2));
}

function appendJournal(value) { fs.appendFileSync(out.journal, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n', 'utf8'); }
async function post(api, base, detail, body, label) {
  assert.equal((await api.request(detail)).status, 404, label + ' 写前必须为404'); appendJournal({ label, action: '准备创建', method: 'POST', path: base });
  let response = null, error = null; try { response = await api.request(base, { method: 'POST', body }); } catch (caught) { error = String(caught); }
  const got = await api.request(detail); const matched = got.status === 200 && canonicalSha(stripManaged(got.data)) === canonicalSha(body);
  appendJournal({ label, action: '创建后即时回读', responseStatus: response?.status ?? null, responseError: error, responseBodyOnFailure: response?.ok ? null : response?.data ?? null, readbackStatus: got.status, matched });
  if (!matched) throw new Error(label + ' 创建结果未通过即时回读；禁止重放'); return { label, method: 'POST', path: base, responseStatus: response?.status ?? null, responseError: error, readbackStatus: got.status, matched, bodySha256: canonicalSha(body) };
}
async function put(api, route, beforeBody, body, responseBody, label) {
  assert.deepEqual(stripManaged(await api.get(route)), beforeBody, label + ' 更新前现值漂移'); appendJournal({ label, action: '准备更新', method: 'PUT', path: route });
  let response = null, error = null; try { response = await api.request(route, { method: 'PUT', body }); } catch (caught) { error = String(caught); }
  const got = await api.request(route); const matched = got.status === 200 && canonicalSha(stripManaged(got.data)) === canonicalSha(responseBody);
  appendJournal({ label, action: '更新后即时回读', responseStatus: response?.status ?? null, responseError: error, responseBodyOnFailure: response?.ok ? null : response?.data ?? null, readbackStatus: got.status, matched });
  if (!matched) throw new Error(label + ' 更新结果未通过即时回读；禁止重放'); return { label, method: 'PUT', path: route, responseStatus: response?.status ?? null, responseError: error, readbackStatus: got.status, matched, bodySha256: canonicalSha(body) };
}
async function remove(api, route, beforeBody, label) {
  assert.deepEqual(stripManaged(await api.get(route)), beforeBody, label + ' 删除前现值漂移'); appendJournal({ label, action: '准备删除失去引用的参数', method: 'DELETE', path: route });
  let response = null, error = null; try { response = await api.request(route, { method: 'DELETE' }); } catch (caught) { error = String(caught); }
  const got = await api.request(route); const matched = got.status === 404;
  appendJournal({ label, action: '删除后即时回读', responseStatus: response?.status ?? null, responseError: error, responseBodyOnFailure: response?.ok ? null : response?.data ?? null, readbackStatus: got.status, matched });
  if (!matched) throw new Error(label + ' 删除结果未通过即时回读；禁止重放'); return { label, method: 'DELETE', path: route, responseStatus: response?.status ?? null, responseError: error, readbackStatus: got.status, matched, deletedBodySha256: canonicalSha(beforeBody) };
}
async function write() {
  assertMissing(out.journal, out.write); const frozen = assertFrozen(); validateSources(); const prepared = readJson(out.prepare); const reviewed = readJson(out.review);
  assert.equal(reviewed.status, 'APPROVED'); assert.equal(reviewed.approvedBatchSha256, frozen.batchSha256); assert.equal(reviewed.approvedPrepareSha256, fileSha(out.prepare));
  const approval = String(process.env.DAMAGE_APPROVED_BATCH_SHA || '').trim(); if (!approval || approval !== reviewed.approvedBatchSha256) throw new Error('DAMAGE_APPROVED_BATCH_SHA 与修订独立批准散列不一致；业务写入尚未开始。');
  const api = client({ writable: true }); const skillList = await api.get('/skills'); assert.equal(skillList.total, batchConfig.expectedCurrent.skillCount); const before = [];
  for (const target of batchConfig.targets) { const current = await captureTarget(api, target); validateBefore(target, current); const prior = prepared.targets.find(row => row.skillKey === target.skillKey); assert.equal(canonicalSha(current), prior.currentSha256, target.skillKey + ' 写入窗口前现值漂移'); before.push({ skillKey: target.skillKey, current }); }
  fs.writeFileSync(out.journal, '', { encoding: 'utf8', flag: 'wx' }); const operations = [];
  for (const target of batchConfig.targets) {
    validateSources(); const base = '/skills/' + encodeURIComponent(target.skillKey); const prior = before.find(row => row.skillKey === target.skillKey).current;
    if (target.formulaUpdate) { const route = base + '/formulas/' + encodeURIComponent(target.formulaUpdate.formulaKey); operations.push(await put(api, route, target.expectedCurrentFormula, target.formulaUpdate, { formulaKey: target.formulaUpdate.formulaKey, ...target.formulaUpdate }, target.skillKey + '/公式纠错')); }
    if (target.deleteParameterKey) { validateSources(); const route = base + '/parameters/' + encodeURIComponent(target.deleteParameterKey); operations.push(await remove(api, route, by(prior.parameters, 'parameterKey', target.deleteParameterKey), target.skillKey + '/移除失去引用参数')); }
    if (target.process) { validateSources(); operations.push(await post(api, base + '/processes', base + '/processes/' + encodeURIComponent(target.process.processKey), target.process, target.skillKey + '/过程')); }
    validateSources(); operations.push(await post(api, base + '/trigger-rules', base + '/trigger-rules/' + encodeURIComponent(target.rule.ruleKey), target.rule, target.skillKey + '/规则'));
    if (target.updatedSkill) { validateSources(); operations.push(await put(api, base, prior.businessSkill, target.updatedSkill, target.updatedSkill, target.skillKey + '/说明')); }
  }
  const immediateTargets = [];
  for (const target of batchConfig.targets) { const current = await captureTarget(api, target); validateAfter(target, current); const prior = before.find(row => row.skillKey === target.skillKey).current; assert.deepEqual(unchangedSubset(current), unchangedSubset(prior), target.skillKey + ' 未授权组成发生变化'); immediateTargets.push({ skillKey: target.skillKey, current, currentSha256: canonicalSha(current) }); }
  const requestAudit = audit(api); assert.deepEqual({ POST: requestAudit.methodCounts.POST, PUT: requestAudit.methodCounts.PUT, DELETE: requestAudit.methodCounts.DELETE }, { POST: 5, PUT: 3, DELETE: 1 });
  const result = { schemaVersion: 2, writtenAt: new Date().toISOString(), status: 'PASS', batchSha256: frozen.batchSha256, authorizationValueRecorded: false, operations, immediateTargets, requestAudit, businessWrites: 9, boundary: batchConfig.writeBoundary };
  writeJson(out.write, result); process.stdout.write(JSON.stringify({ status: result.status, batchSha256: result.batchSha256, businessWrites: result.businessWrites, methodCounts: requestAudit.methodCounts, operations: operations.map(row => ({ label: row.label, method: row.method, responseStatus: row.responseStatus, readbackStatus: row.readbackStatus, matched: row.matched })) }, null, 2));
}

function keyed(values, first, second) { return new Map(values.map(row => [row[first] + '/' + row[second], row])); }
async function readback() {
  assertMissing(out.readback); const frozen = assertFrozen(); validateSources(); const prepared = readJson(out.prepare); const written = readJson(out.write); assert.equal(written.status, 'PASS'); assert.equal(written.batchSha256, frozen.batchSha256);
  const api = client(); const global = await captureGlobal(api);
  assert.equal(global.skillCount, batchConfig.expectedCurrent.skillCount); assert.equal(global.ruleCount, batchConfig.expectedCurrent.finalRuleCount); assert.equal(global.processCount, prepared.global.processCount + batchConfig.expectedCurrent.addedProcessCount); assert.equal(global.sourceInitializedCount, batchConfig.expectedCurrent.sourceInitializedCount);
  const currentRules = keyed(global.rules, 'skillKey', 'ruleKey'); for (const old of prepared.global.rules) assert.deepEqual(currentRules.get(old.skillKey + '/' + old.ruleKey), old, '旧规则变化：' + old.skillKey + '/' + old.ruleKey);
  const currentProcesses = keyed(global.processes, 'skillKey', 'processKey'); for (const old of prepared.global.processes) assert.deepEqual(currentProcesses.get(old.skillKey + '/' + old.processKey), old, '旧过程变化：' + old.skillKey + '/' + old.processKey);
  const currentSkills = new Map(global.skills.map(row => [row.skillKey, row]));
  for (const old of prepared.global.skills) { const target = batchConfig.targets.find(item => item.skillKey === old.skillKey); const now = currentSkills.get(old.skillKey); if (target?.updatedSkill) assert.deepEqual(now.body, target.updatedSkill); else assert.deepEqual(now, old, '未授权技能元数据变化：' + old.skillKey); }
  const targets = [];
  for (const target of batchConfig.targets) {
    const current = await captureTarget(api, target); validateAfter(target, current); const prior = prepared.targets.find(row => row.skillKey === target.skillKey).current; assert.deepEqual(unchangedSubset(current), unchangedSubset(prior));
    if (target.formulaUpdate) { const otherBefore = prior.formulas.details.filter(row => row.formulaKey !== target.formulaUpdate.formulaKey); const otherAfter = current.formulas.details.filter(row => row.formulaKey !== target.formulaUpdate.formulaKey); assert.deepEqual(otherAfter, otherBefore, '救赎其他公式发生变化'); }
    const expectedParameters = prior.parameters.details.filter(row => row.parameterKey !== target.deleteParameterKey); assert.deepEqual(current.parameters.details, expectedParameters, target.skillKey + ' 非目标参数发生变化');
    targets.push({ skillKey: target.skillKey, current, currentSha256: canonicalSha(current), conclusion: target.conclusion, completedBranch: target.completedBranch, remaining: target.remaining });
  }
  assert(api.log.every(row => row.method === 'GET')); const result = { schemaVersion: 2, capturedAt: new Date().toISOString(), status: 'PASS', methodPolicy: 'GET_ONLY', batchSha256: frozen.batchSha256, businessWrites: 0, global, targets, requestAudit: audit(api), boundary: batchConfig.runtimeBoundary };
  writeJson(out.readback, result); process.stdout.write(JSON.stringify({ status: result.status, getCount: result.requestAudit.methodCounts.GET, global: { skillCount: global.skillCount, ruleCount: global.ruleCount, processCount: global.processCount, sourceInitializedCount: global.sourceInitializedCount }, targets: targets.map(row => ({ skillKey: row.skillKey, conclusion: row.conclusion, completedBranch: row.completedBranch, remaining: row.remaining })), businessWrites: 0 }, null, 2));
}
async function targets() {
  assertMissing(out.targets); const frozen = assertFrozen(); const read = readJson(out.readback); assert.equal(read.status, 'PASS'); assert.equal(read.batchSha256, frozen.batchSha256);
  const pageTargets = batchConfig.targets.map(target => { const item = read.targets.find(row => row.skillKey === target.skillKey); assert(item); return { skillKey: target.skillKey, skillName: target.skillName, ownerKey: target.ownerKey, expectedImageEnabled: true, expectedRule: target.rule, expectedProcess: target.process, expectedFormula: target.formulaUpdate ?? null, deletedParameterKey: target.deleteParameterKey ?? null, expectedUpdatedSkill: target.updatedSkill, completedBranch: target.completedBranch, remaining: target.remaining, readbackSha256: item.currentSha256 }; });
  const result = { schemaVersion: 2, generatedAt: new Date().toISOString(), status: 'PASS', batchSha256: frozen.batchSha256, source: '07-独立GET回读.json', targetCount: pageTargets.length, targets: pageTargets, boundary: '页面只读核对列表图片、目标组成、过程、规则与救赎公式；不点击新增、保存、删除或停用。' };
  writeJson(out.targets, result); process.stdout.write(JSON.stringify({ status: result.status, targetCount: result.targetCount, targets: pageTargets.map(row => ({ skillKey: row.skillKey, processKey: row.expectedProcess?.processKey ?? null, ruleKey: row.expectedRule.ruleKey, formulaKey: row.expectedFormula?.formulaKey ?? null })) }, null, 2));
}
async function manifest() {
  assertMissing(out.manifest); const frozen = assertFrozen(); const prepared = readJson(out.prepare), reviewed = readJson(out.review), written = readJson(out.write), read = readJson(out.readback), pageTargets = readJson(out.targets), browser = readJson(out.browser);
  assert.equal(prepared.status, 'PASS'); assert.equal(reviewed.status, 'APPROVED'); assert.equal(written.status, 'PASS'); assert.equal(read.status, 'PASS'); assert.equal(pageTargets.status, 'PASS'); assert.equal(browser.status, 'PASS'); assert.equal(browser.targetCount, batchConfig.targets.length); assert.equal(browser.businessWrites, 0); assert.equal(browser.nonGetRequests, 0); assert.equal(browser.consoleErrors, 0); assert.equal(browser.consoleWarnings, 0); assert.equal(browser.pageErrors, 0); assert.equal(browser.failedRequests, 0); assert.equal(browser.requestAudit.postBrowserGetReadback.ruleCount, batchConfig.expectedCurrent.finalRuleCount); assert.equal(browser.requestAudit.postBrowserGetReadback.processCount, read.global.processCount); assert(browser.targets.every(row => row.matched));
  const parentNames = ['../01-补录方案.md', '../README.md', '../批次配置.mjs', '../批次执行.mjs', '../02-冻结请求.json', '../03-来源散列快照.json', '../04-写入前现值.json', '../05-独立写前评审.json', '../06-写入流水.jsonl', '../06-首个请求失败后只读回查.json', '../首次写入停止说明.md'];
  const names = ['README.md', '批次配置.mjs', '批次执行.mjs', '02-冻结请求.json', '03-来源散列快照.json', '04-写入前现值.json', '05-独立写前评审.json', '06-写入流水.jsonl', '06-写入与即时回读.json', '07-独立GET回读.json', '08-页面目标.json', '09-页面验收.json', '录入体验报告.md'];
  for (const name of [...parentNames, ...names]) assert(fs.existsSync(path.resolve(batchDirectory, name)), '缺少证据文件：' + name);
  const result = { schemaVersion: 2, capturedAt: new Date().toISOString(), status: 'PASS', scope: batchConfig.scope, batchSha256: frozen.batchSha256, firstAttempt: { status: 'STOPPED_WITHOUT_BUSINESS_CHANGE', evidence: '../06-首个请求失败后只读回查.json' }, requestAudit: { prepare: prepared.requestAudit, review: reviewed.requestAudit, write: written.requestAudit, readback: read.requestAudit, browserPostReadback: browser.requestAudit.postBrowserGetReadback }, final: { skillCount: read.global.skillCount, ruleCount: read.global.ruleCount, processCount: read.global.processCount, sourceInitializedCount: read.global.sourceInitializedCount }, conclusions: batchConfig.targets.map(target => ({ skillKey: target.skillKey, conclusion: target.conclusion, completedBranch: target.completedBranch, remaining: target.remaining })), browser: { targetCount: browser.targetCount, screenshots: browser.screenshots.length, consoleErrors: browser.consoleErrors, consoleWarnings: browser.consoleWarnings, pageErrors: browser.pageErrors, failedRequests: browser.failedRequests, businessWrites: browser.businessWrites }, files: [...parentNames, ...names].map(name => { const file = path.resolve(batchDirectory, name); return { name, sha256: fileSha(file), byteSize: fs.statSync(file).size }; }), boundary: batchConfig.runtimeBoundary };
  writeJson(out.manifest, result); process.stdout.write(JSON.stringify({ status: result.status, scope: result.scope, batchSha256: result.batchSha256, firstAttempt: result.firstAttempt, final: result.final, browser: result.browser, conclusions: result.conclusions, fileCount: result.files.length }, null, 2));
}

if (mode === 'freeze') await freeze(); else if (mode === 'prepare') await prepare(); else if (mode === 'review') await review(); else if (mode === 'write') await write(); else if (mode === 'readback') await readback(); else if (mode === 'targets') await targets(); else await manifest();
