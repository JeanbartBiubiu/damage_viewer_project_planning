import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { batchConfig } from './批次配置.mjs';

const batchDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(batchDirectory, '..', '..', '..', '..');
const planningRoot = path.resolve(webRoot, '..', 'damage_viewer_project_planning');
const mode = process.argv[2];
const validModes = new Set(['freeze', 'prepare', 'review', 'write', 'readback', 'targets', 'manifest']);
if (!validModes.has(mode)) throw new Error('用法：node 批次执行.mjs freeze|prepare|review|write|readback|targets|manifest');

const outputFiles = {
  frozen: path.join(batchDirectory, '02-冻结请求.json'),
  sources: path.join(batchDirectory, '03-来源散列快照.json'),
  prepare: path.join(batchDirectory, '04-写入前现值.json'),
  review: path.join(batchDirectory, '05-独立写前评审.json'),
  journal: path.join(batchDirectory, '06-写入流水.jsonl'),
  write: path.join(batchDirectory, '06-写入与即时回读.json'),
  readback: path.join(batchDirectory, '07-独立GET回读.json'),
  targets: path.join(batchDirectory, '08-页面目标.json'),
  browser: path.join(batchDirectory, '09-页面验收.json'),
  experience: path.join(batchDirectory, '录入体验报告.md'),
  manifest: path.join(batchDirectory, '10-证据清单.json')
};

const identityKeys = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
}

function stripManaged(value) {
  if (Array.isArray(value)) return value.map(stripManaged);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !identityKeys.has(key))
    .map(([key, item]) => [key, stripManaged(item)]));
}

const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = file => shaBytes(fs.readFileSync(file));
const canonicalSha = value => shaBytes(JSON.stringify(normalize(value)));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function writeJsonExclusive(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
}

function assertMissing(...files) {
  for (const file of files) if (fs.existsSync(file)) throw new Error(path.basename(file) + ' 已存在，拒绝覆盖。');
}

async function mapLimit(values, limit, worker) {
  const result = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
  return result;
}

function sourceFilePath(source) {
  const root = source.root === 'web' ? webRoot : source.root === 'planning' ? planningRoot : null;
  if (!root) throw new Error('未知来源工作树：' + source.root);
  return path.join(root, ...source.relativePath.split('/'));
}

function validateSources() {
  const files = {};
  const evidence = [];
  for (const source of batchConfig.sourceFiles) {
    const file = sourceFilePath(source);
    const actual = fileSha(file);
    assert.equal(actual, source.sha256, '固定来源散列漂移：' + source.relativePath);
    files[source.id] = readJson(file);
    evidence.push({ ...source, absolutePathRecorded: false, byteSize: fs.statSync(file).size, actualSha256: actual });
  }

  const zhonyas = files.zhonyasReview.candidates.find(item => item.skillKey === 'item_3157_active' && item.status === 'DEFERRED');
  assert(zhonyas, '中娅固定候选不存在');
  assert.equal(zhonyas.current.components.parameters.details.stasis_duration_ms.data.fixedValue, 2500);
  assert.equal(zhonyas.current.components.parameters.details.active_cooldown_ms.data.fixedValue, 120000);
  assert.equal(zhonyas.current.components.effects.details.stasis_damage_immunity.data.results[0].resultType, 'DAMAGE_IMMUNITY');
  assert(zhonyas.deferredReasons.some(value => value.includes('冷却')));

  const qss = files.qssReview.candidates.find(item => item.skillKey === 'item_3139_active' && item.status === 'DEFERRED');
  assert(qss, '水银弯刀固定候选不存在');
  assert.equal(qss.current.components.parameters.details.active_cooldown_ms.data.fixedValue, 90000);
  assert.equal(qss.current.components.parameters.details.move_speed_ratio.data.fixedValue, 0.5);
  assert.equal(qss.current.components.parameters.details.move_speed_duration_ms.data.fixedValue, 2000);
  assert.equal(qss.current.components.effects.details.quicksilver_move_speed.data.results[0].target, 'SOURCE');
  assert(qss.deferredReasons.some(value => value.includes('解控')));

  const redemption = files.redemptionSource.selectedRawObjects.item_3107;
  assert(redemption, '救赎固定来源不存在');
  assert.equal(redemption.dataValues.Cooldown, 90);
  assert.equal(redemption.dataValues.AOESize, 550);
  assert.equal(redemption.dataValues.CastRange, 5500);
  assert.equal(redemption.dataValues.DiminishedEffect, 0.5);
  assert.equal(redemption.dataValues.DiminishedTimer, 8);
  assert(Math.abs(redemption.dataValues.DamageToChampions - 0.1) < 1e-6);
  assert(redemption.bindings.some(item => item.text.includes('在2.5秒后') && item.text.includes('10%最大生命值的真实伤害')));

  return {
    status: 'PASS',
    sourceVersion: batchConfig.sourceVersion,
    files: evidence,
    assertions: {
      redemption: '2.5秒后对敌方英雄造成10%最大生命值真实伤害；90秒冷却、550区域、5500距离、8秒重复窗与50%保留比例均有固定来源。',
      qss: '50%自身移动速度持续2秒及90秒冷却有固定来源；解控、浮空例外和幽灵状态仍未接。',
      zhonyas: '全类型伤害免疫持续2.5秒及120秒冷却有固定来源；不可选取和行动限制仍未接。'
    }
  };
}

function frozenPayload() {
  return {
    schemaVersion: batchConfig.schemaVersion,
    sourceVersion: batchConfig.sourceVersion,
    scope: batchConfig.scope,
    expectedCurrent: batchConfig.expectedCurrent,
    sourceFiles: batchConfig.sourceFiles,
    targets: batchConfig.targets,
    writeBoundary: batchConfig.writeBoundary,
    runtimeBoundary: batchConfig.runtimeBoundary
  };
}

function allowedWrites() {
  const values = new Set();
  for (const target of batchConfig.targets) {
    const skill = '/skills/' + encodeURIComponent(target.skillKey);
    if (target.process) values.add('POST ' + skill + '/processes');
    if (target.rule) values.add('POST ' + skill + '/trigger-rules');
    if (target.updatedSkill) values.add('PUT ' + skill);
  }
  return values;
}

function requestClient({ allowWrites = false } = {}) {
  const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
  if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
  const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
  const log = [];
  const writeAllowlist = allowedWrites();

  async function request(relativePath, options = {}) {
    const method = options.method || 'GET';
    if (method !== 'GET') {
      if (!allowWrites || !writeAllowlist.has(method + ' ' + relativePath)) throw new Error('不允许的业务请求：' + method + ' ' + relativePath);
    }
    const response = await fetch(baseUrl + relativePath, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(30_000)
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; }
    catch { throw new Error('接口未返回JSON：' + relativePath + ' HTTP ' + response.status); }
    log.push({ method, path: relativePath, status: response.status });
    return { status: response.status, ok: response.ok, data };
  }

  async function get(relativePath, expectedStatus = 200) {
    const result = await request(relativePath);
    assert.equal(result.status, expectedStatus, relativePath + ' 状态应为 ' + expectedStatus);
    return result.data;
  }

  return { request, get, log };
}

function requestAudit(client) {
  const statusCounts = {};
  const methodCounts = {};
  for (const item of client.log) {
    statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
    methodCounts[item.method] = (methodCounts[item.method] || 0) + 1;
  }
  return { total: client.log.length, methodCounts, statusCounts, entries: client.log };
}

async function captureGlobal(client) {
  const skillsResponse = await client.get('/skills');
  assert.equal(skillsResponse.total, batchConfig.expectedCurrent.skillCount);
  assert.equal(skillsResponse.items.length, skillsResponse.total);
  const rows = await mapLimit(skillsResponse.items, 12, async skill => {
    const base = '/skills/' + encodeURIComponent(skill.skillKey);
    const [rules, processes] = await Promise.all([client.get(base + '/trigger-rules'), client.get(base + '/processes')]);
    const ruleDetails = await mapLimit(rules, 8, async summary => ({
      skillKey: skill.skillKey,
      ruleKey: summary.ruleKey,
      updatedAt: summary.updatedAt,
      body: stripManaged(await client.get(base + '/trigger-rules/' + encodeURIComponent(summary.ruleKey)))
    }));
    const processDetails = await mapLimit(processes, 8, async summary => ({
      skillKey: skill.skillKey,
      processKey: summary.processKey,
      updatedAt: summary.updatedAt,
      body: stripManaged(await client.get(base + '/processes/' + encodeURIComponent(summary.processKey)))
    }));
    return { skill, ruleDetails, processDetails };
  });
  const rules = rows.flatMap(row => row.ruleDetails).sort((a, b) => a.skillKey.localeCompare(b.skillKey) || a.ruleKey.localeCompare(b.ruleKey));
  const processes = rows.flatMap(row => row.processDetails).sort((a, b) => a.skillKey.localeCompare(b.skillKey) || a.processKey.localeCompare(b.processKey));
  const skills = rows.map(row => ({
    skillKey: row.skill.skillKey,
    updatedAt: row.skill.updatedAt,
    body: stripManaged(row.skill)
  })).sort((a, b) => a.skillKey.localeCompare(b.skillKey));
  const sourceInitializedCount = rules.filter(item => item.body.eventSource?.eventType === 'SOURCE_INITIALIZED').length;
  return {
    skillCount: skills.length,
    ruleCount: rules.length,
    processCount: processes.length,
    sourceInitializedCount,
    skills,
    rules,
    processes,
    hashes: {
      skills: canonicalSha(skills),
      rules: canonicalSha(rules),
      processes: canonicalSha(processes)
    }
  };
}

async function componentCollection(client, skillKey, segment, idField) {
  const base = '/skills/' + encodeURIComponent(skillKey) + '/' + segment;
  const items = await client.get(base);
  assert(Array.isArray(items), base + ' 列表格式不符');
  const details = [];
  for (const item of items) {
    const id = item[idField];
    assert.equal(typeof id, 'string', base + ' 标识不合法');
    details.push(stripManaged(await client.get(base + '/' + encodeURIComponent(id))));
  }
  return { keys: items.map(item => item[idField]).sort(), summaries: items, details };
}

async function captureTarget(client, target) {
  const base = '/skills/' + encodeURIComponent(target.skillKey);
  const [skill, parameters, formulas, effects, processes, states, rules, relation, image] = await Promise.all([
    client.get(base),
    componentCollection(client, target.skillKey, 'parameters', 'parameterKey'),
    componentCollection(client, target.skillKey, 'formulas', 'formulaKey'),
    componentCollection(client, target.skillKey, 'effects', 'effectKey'),
    componentCollection(client, target.skillKey, 'processes', 'processKey'),
    componentCollection(client, target.skillKey, 'internal-states', 'stateKey'),
    componentCollection(client, target.skillKey, 'trigger-rules', 'ruleKey'),
    client.get('/equipment-skill-relations?equipmentKey=' + encodeURIComponent(target.ownerKey)),
    client.get(base + '/representative-image')
  ]);
  return { skill, businessSkill: stripManaged(skill), parameters, formulas, effects, processes, states, rules, relation, image };
}

function detailByKey(collection, key, value) {
  return collection.details.find(item => item[key] === value);
}

function validateCommonTarget(target, current) {
  assert.equal(current.skill.skillKey, target.skillKey);
  assert.equal(current.skill.name, target.skillName);
  assert.deepEqual(current.parameters.keys, [...target.expectedParameters].sort());
  assert.deepEqual(current.effects.keys, [...target.expectedEffects].sort());
  for (const [key, expected] of Object.entries(target.expectedParameterValues)) {
    const parameter = detailByKey(current.parameters, 'parameterKey', key);
    assert(parameter, target.skillKey + ' 缺少参数 ' + key);
    assert.equal(parameter.fixedValue, expected, target.skillKey + '/' + key + ' 数值漂移');
  }
  assert.equal(current.relation.total, 1);
  assert.equal(current.relation.items[0].equipmentKey, target.ownerKey);
  assert.equal(current.relation.items[0].skillKey, target.skillKey);
  assert.equal(current.image.image?.enabled, true);

  if (target.skillKey === 'item_3107_active') {
    const effect = detailByKey(current.effects, 'effectKey', 'enemy_true_damage');
    const result = effect.results[0];
    assert.equal(result.resultType, 'DAMAGE');
    assert.equal(result.target, 'TARGET');
    assert.equal(result.detail.damageTypeKey, 'real');
    assert.deepEqual(result.valueRule.value, { kind: 'FORMULA', formulaKey: 'enemy_true_damage' });
  } else if (target.skillKey === 'item_3139_active') {
    const effect = detailByKey(current.effects, 'effectKey', 'quicksilver_move_speed');
    assert.deepEqual(effect.lifecycle.durationValue, { kind: 'PARAMETER', parameterKey: 'move_speed_duration_ms' });
    assert.equal(effect.results[0].target, 'SOURCE');
    assert.equal(effect.results[0].detail.attributeKey, 'move_speed_percent');
  } else if (target.skillKey === 'item_3157_active') {
    const effect = detailByKey(current.effects, 'effectKey', 'stasis_damage_immunity');
    assert.deepEqual(effect.lifecycle.durationValue, { kind: 'PARAMETER', parameterKey: 'stasis_duration_ms' });
    assert.equal(effect.results[0].target, 'SOURCE');
    assert.equal(effect.results[0].resultType, 'DAMAGE_IMMUNITY');
  }
}

function validateBeforeTarget(target, current) {
  validateCommonTarget(target, current);
  if (target.expectedCurrentDescription) assert.equal(current.skill.description, target.expectedCurrentDescription);
  assert.deepEqual(current.processes.keys, []);
  assert.deepEqual(current.rules.keys, []);
}

function validateAfterTarget(target, current) {
  validateCommonTarget(target, current);
  if (target.updatedSkill) assert.deepEqual(current.businessSkill, target.updatedSkill);
  if (target.process) {
    assert.deepEqual(current.processes.keys, [target.process.processKey]);
    assert.deepEqual(detailByKey(current.processes, 'processKey', target.process.processKey), target.process);
  } else assert.deepEqual(current.processes.keys, []);
  assert.deepEqual(current.rules.keys, [target.rule.ruleKey]);
  assert.deepEqual(detailByKey(current.rules, 'ruleKey', target.rule.ruleKey), target.rule);
}

function targetStableSubset(current) {
  return {
    parameters: current.parameters,
    formulas: current.formulas,
    effects: current.effects,
    states: current.states,
    relation: current.relation,
    image: current.image
  };
}

function compareGlobalPreflight(expected, current) {
  assert.equal(current.skillCount, expected.skillCount);
  assert.equal(current.ruleCount, expected.ruleCount);
  assert.equal(current.processCount, expected.processCount);
  assert.equal(current.sourceInitializedCount, expected.sourceInitializedCount);
  assert.deepEqual(current.hashes, expected.hashes);
}

function assertFrozenFile() {
  const frozen = readJson(outputFiles.frozen);
  const expectedPayload = frozenPayload();
  assert.deepEqual(frozen.payload, expectedPayload, '冻结请求与当前配置不一致');
  assert.equal(frozen.batchSha256, canonicalSha(expectedPayload), '冻结批次散列不一致');
  return frozen;
}

async function runFreeze() {
  assertMissing(outputFiles.frozen, outputFiles.sources);
  const sources = validateSources();
  const payload = frozenPayload();
  const batchSha256 = canonicalSha(payload);
  writeJsonExclusive(outputFiles.frozen, {
    schemaVersion: 1,
    frozenAt: new Date().toISOString(),
    status: 'FROZEN',
    batchSha256,
    payload,
    allowedWrites: [...allowedWrites()].sort(),
    authorizationValueRecorded: false
  });
  writeJsonExclusive(outputFiles.sources, { schemaVersion: 1, capturedAt: new Date().toISOString(), ...sources, batchSha256 });
  process.stdout.write(JSON.stringify({ status: 'FROZEN', batchSha256, targetCount: batchConfig.targets.length, allowedWrites: [...allowedWrites()].sort(), sources: sources.files.map(item => ({ id: item.id, sha256: item.actualSha256 })) }, null, 2));
}

async function runPrepare() {
  assertMissing(outputFiles.prepare);
  const frozen = assertFrozenFile();
  validateSources();
  const client = requestClient();
  const global = await captureGlobal(client);
  assert.equal(global.ruleCount, batchConfig.expectedCurrent.ruleCount);
  assert.equal(global.sourceInitializedCount, batchConfig.expectedCurrent.sourceInitializedCount);
  const targets = [];
  for (const target of batchConfig.targets) {
    const current = await captureTarget(client, target);
    validateBeforeTarget(target, current);
    targets.push({ skillKey: target.skillKey, current, currentSha256: canonicalSha(current) });
  }
  assert(client.log.every(item => item.method === 'GET'));
  const output = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    methodPolicy: 'GET_ONLY',
    batchSha256: frozen.batchSha256,
    businessWrites: 0,
    global,
    globalSha256: canonicalSha(global),
    targets,
    requestAudit: requestAudit(client),
    boundary: batchConfig.writeBoundary
  };
  writeJsonExclusive(outputFiles.prepare, output);
  process.stdout.write(JSON.stringify({ status: output.status, batchSha256: output.batchSha256, getCount: output.requestAudit.methodCounts.GET, global: { skillCount: global.skillCount, ruleCount: global.ruleCount, processCount: global.processCount, sourceInitializedCount: global.sourceInitializedCount }, targets: targets.map(item => item.skillKey), businessWrites: 0 }, null, 2));
}

async function runReview() {
  assertMissing(outputFiles.review);
  const frozen = assertFrozenFile();
  validateSources();
  const prepare = readJson(outputFiles.prepare);
  assert.equal(prepare.status, 'PASS');
  assert.equal(prepare.batchSha256, frozen.batchSha256);
  const client = requestClient();
  const global = await captureGlobal(client);
  compareGlobalPreflight(prepare.global, global);
  const targetChecks = [];
  for (const target of batchConfig.targets) {
    const current = await captureTarget(client, target);
    validateBeforeTarget(target, current);
    const prior = prepare.targets.find(item => item.skillKey === target.skillKey);
    assert(prior);
    assert.equal(canonicalSha(current), prior.currentSha256, target.skillKey + ' 独立评审现值与准备现值不一致');
    targetChecks.push({ skillKey: target.skillKey, currentSha256: canonicalSha(current), status: 'APPROVED' });
  }
  assert(client.log.every(item => item.method === 'GET'));
  const output = {
    schemaVersion: 1,
    reviewedAt: new Date().toISOString(),
    status: 'APPROVED',
    methodPolicy: 'GET_ONLY',
    approvedBatchSha256: frozen.batchSha256,
    approvedPrepareSha256: fileSha(outputFiles.prepare),
    global: { skillCount: global.skillCount, ruleCount: global.ruleCount, processCount: global.processCount, sourceInitializedCount: global.sourceInitializedCount, hashes: global.hashes },
    targetChecks,
    requestAudit: requestAudit(client),
    businessWrites: 0,
    reviewBoundary: '只批准冻结的两个过程、三条规则与两项说明更新；剩余机制缺口不在批准范围。'
  };
  writeJsonExclusive(outputFiles.review, output);
  process.stdout.write(JSON.stringify({ status: output.status, approvedBatchSha256: output.approvedBatchSha256, getCount: output.requestAudit.methodCounts.GET, global: output.global, targets: targetChecks, businessWrites: 0 }, null, 2));
}

function appendJournal(value) {
  fs.appendFileSync(outputFiles.journal, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n', 'utf8');
}

async function postAndVerify(client, pathBase, pathDetail, body, label) {
  const before = await client.request(pathDetail);
  assert.equal(before.status, 404, label + ' 写入前同键必须为404');
  appendJournal({ label, action: '准备创建', method: 'POST', path: pathBase });
  let response = null;
  let error = null;
  try { response = await client.request(pathBase, { method: 'POST', body }); }
  catch (caught) { error = String(caught); }
  const after = await client.request(pathDetail);
  const matched = after.status === 200 && canonicalSha(stripManaged(after.data)) === canonicalSha(body);
  appendJournal({ label, action: '创建后即时回读', postStatus: response?.status ?? null, postError: error, readbackStatus: after.status, matched });
  if (!matched) throw new Error(label + ' 创建结果未通过即时回读；禁止重放');
  return { label, method: 'POST', path: pathBase, postStatus: response?.status ?? null, postError: error, readbackStatus: after.status, matched, bodySha256: canonicalSha(body), readback: after.data };
}

async function putAndVerify(client, pathValue, expectedBefore, body, label) {
  const before = await client.get(pathValue);
  assert.deepEqual(stripManaged(before), expectedBefore, label + ' 更新前现值漂移');
  appendJournal({ label, action: '准备更新', method: 'PUT', path: pathValue });
  let response = null;
  let error = null;
  try { response = await client.request(pathValue, { method: 'PUT', body }); }
  catch (caught) { error = String(caught); }
  const after = await client.request(pathValue);
  const matched = after.status === 200 && canonicalSha(stripManaged(after.data)) === canonicalSha(body);
  appendJournal({ label, action: '更新后即时回读', putStatus: response?.status ?? null, putError: error, readbackStatus: after.status, matched });
  if (!matched) throw new Error(label + ' 更新结果未通过即时回读；禁止重放');
  return { label, method: 'PUT', path: pathValue, putStatus: response?.status ?? null, putError: error, readbackStatus: after.status, matched, bodySha256: canonicalSha(body), readback: after.data };
}

async function runWrite() {
  assertMissing(outputFiles.journal, outputFiles.write);
  const frozen = assertFrozenFile();
  validateSources();
  const prepare = readJson(outputFiles.prepare);
  const review = readJson(outputFiles.review);
  assert.equal(review.status, 'APPROVED');
  assert.equal(review.approvedBatchSha256, frozen.batchSha256);
  assert.equal(review.approvedPrepareSha256, fileSha(outputFiles.prepare));
  const approval = String(process.env.DAMAGE_APPROVED_BATCH_SHA || '').trim();
  if (!approval || approval !== review.approvedBatchSha256) throw new Error('DAMAGE_APPROVED_BATCH_SHA 与独立批准散列不一致；业务写入尚未开始。');

  const client = requestClient({ allowWrites: true });
  const beforeTargets = [];
  const skills = await client.get('/skills');
  assert.equal(skills.total, batchConfig.expectedCurrent.skillCount);
  for (const target of batchConfig.targets) {
    const current = await captureTarget(client, target);
    validateBeforeTarget(target, current);
    const prior = prepare.targets.find(item => item.skillKey === target.skillKey);
    assert.equal(canonicalSha(current), prior.currentSha256, target.skillKey + ' 唯一写入窗口前现值漂移');
    beforeTargets.push({ skillKey: target.skillKey, current });
  }
  fs.writeFileSync(outputFiles.journal, '', { encoding: 'utf8', flag: 'wx' });
  const operations = [];
  for (const target of batchConfig.targets) {
    validateSources();
    const base = '/skills/' + encodeURIComponent(target.skillKey);
    const before = beforeTargets.find(item => item.skillKey === target.skillKey).current;
    if (target.process) operations.push(await postAndVerify(client, base + '/processes', base + '/processes/' + encodeURIComponent(target.process.processKey), target.process, target.skillKey + '/过程'));
    validateSources();
    operations.push(await postAndVerify(client, base + '/trigger-rules', base + '/trigger-rules/' + encodeURIComponent(target.rule.ruleKey), target.rule, target.skillKey + '/规则'));
    if (target.updatedSkill) {
      validateSources();
      operations.push(await putAndVerify(client, base, before.businessSkill, target.updatedSkill, target.skillKey + '/说明'));
    }
  }
  const immediateTargets = [];
  for (const target of batchConfig.targets) {
    const current = await captureTarget(client, target);
    validateAfterTarget(target, current);
    assert.deepEqual(targetStableSubset(current), targetStableSubset(beforeTargets.find(item => item.skillKey === target.skillKey).current), target.skillKey + ' 非写入组成发生变化');
    immediateTargets.push({ skillKey: target.skillKey, current, currentSha256: canonicalSha(current) });
  }
  const audit = requestAudit(client);
  assert.equal(audit.methodCounts.POST, 5);
  assert.equal(audit.methodCounts.PUT, 2);
  const output = {
    schemaVersion: 1,
    writtenAt: new Date().toISOString(),
    status: 'PASS',
    batchSha256: frozen.batchSha256,
    authorizationValueRecorded: false,
    operations,
    immediateTargets,
    requestAudit: audit,
    businessWrites: 7,
    boundary: batchConfig.writeBoundary
  };
  writeJsonExclusive(outputFiles.write, output);
  process.stdout.write(JSON.stringify({ status: output.status, batchSha256: output.batchSha256, businessWrites: output.businessWrites, methodCounts: audit.methodCounts, operations: operations.map(item => ({ label: item.label, method: item.method, responseStatus: item.postStatus ?? item.putStatus, readbackStatus: item.readbackStatus, matched: item.matched })) }, null, 2));
}

function entriesByKey(values, first, second) {
  return new Map(values.map(item => [item[first] + '/' + item[second], item]));
}

async function runReadback() {
  assertMissing(outputFiles.readback);
  const frozen = assertFrozenFile();
  validateSources();
  const prepare = readJson(outputFiles.prepare);
  const write = readJson(outputFiles.write);
  assert.equal(write.status, 'PASS');
  assert.equal(write.batchSha256, frozen.batchSha256);
  const client = requestClient();
  const global = await captureGlobal(client);
  assert.equal(global.skillCount, batchConfig.expectedCurrent.skillCount);
  assert.equal(global.ruleCount, batchConfig.expectedCurrent.finalRuleCount);
  assert.equal(global.sourceInitializedCount, batchConfig.expectedCurrent.sourceInitializedCount);
  assert.equal(global.processCount, prepare.global.processCount + batchConfig.expectedCurrent.addedProcessCount);

  const currentRules = entriesByKey(global.rules, 'skillKey', 'ruleKey');
  for (const old of prepare.global.rules) assert.deepEqual(currentRules.get(old.skillKey + '/' + old.ruleKey), old, '旧规则发生变化：' + old.skillKey + '/' + old.ruleKey);
  const currentProcesses = entriesByKey(global.processes, 'skillKey', 'processKey');
  for (const old of prepare.global.processes) assert.deepEqual(currentProcesses.get(old.skillKey + '/' + old.processKey), old, '旧过程发生变化：' + old.skillKey + '/' + old.processKey);
  const currentSkills = new Map(global.skills.map(item => [item.skillKey, item]));
  for (const old of prepare.global.skills) {
    const target = batchConfig.targets.find(item => item.skillKey === old.skillKey);
    const current = currentSkills.get(old.skillKey);
    if (target?.updatedSkill) assert.deepEqual(current.body, target.updatedSkill, '目标技能说明不符：' + old.skillKey);
    else assert.deepEqual(current, old, '未授权技能元数据发生变化：' + old.skillKey);
  }

  const targets = [];
  for (const target of batchConfig.targets) {
    const current = await captureTarget(client, target);
    validateAfterTarget(target, current);
    const prior = prepare.targets.find(item => item.skillKey === target.skillKey).current;
    assert.deepEqual(targetStableSubset(current), targetStableSubset(prior), target.skillKey + ' 非写入组成发生变化');
    targets.push({ skillKey: target.skillKey, current, currentSha256: canonicalSha(current), conclusion: target.conclusion, completedBranch: target.completedBranch, remaining: target.remaining });
  }
  assert(client.log.every(item => item.method === 'GET'));
  const output = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    methodPolicy: 'GET_ONLY',
    batchSha256: frozen.batchSha256,
    businessWrites: 0,
    global,
    targets,
    requestAudit: requestAudit(client),
    boundary: batchConfig.runtimeBoundary
  };
  writeJsonExclusive(outputFiles.readback, output);
  process.stdout.write(JSON.stringify({ status: output.status, getCount: output.requestAudit.methodCounts.GET, global: { skillCount: global.skillCount, ruleCount: global.ruleCount, processCount: global.processCount, sourceInitializedCount: global.sourceInitializedCount }, targets: targets.map(item => ({ skillKey: item.skillKey, conclusion: item.conclusion, completedBranch: item.completedBranch, remaining: item.remaining })), businessWrites: 0 }, null, 2));
}

async function runTargets() {
  assertMissing(outputFiles.targets);
  const frozen = assertFrozenFile();
  const readback = readJson(outputFiles.readback);
  assert.equal(readback.status, 'PASS');
  assert.equal(readback.batchSha256, frozen.batchSha256);
  const targets = batchConfig.targets.map(target => {
    const item = readback.targets.find(value => value.skillKey === target.skillKey);
    assert(item);
    return {
      skillKey: target.skillKey,
      skillName: target.skillName,
      ownerKey: target.ownerKey,
      expectedImageEnabled: true,
      expectedRule: target.rule,
      expectedProcess: target.process,
      expectedUpdatedSkill: target.updatedSkill,
      completedBranch: target.completedBranch,
      remaining: target.remaining,
      readbackSha256: item.currentSha256
    };
  });
  const output = { schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'PASS', batchSha256: frozen.batchSha256, source: '07-独立GET回读.json', targetCount: targets.length, targets, boundary: '页面只读核对列表图片、目标组成、过程及规则；不点击新增、保存、删除或停用。' };
  writeJsonExclusive(outputFiles.targets, output);
  process.stdout.write(JSON.stringify({ status: output.status, targetCount: output.targetCount, targets: targets.map(item => ({ skillKey: item.skillKey, processKey: item.expectedProcess?.processKey ?? null, ruleKey: item.expectedRule.ruleKey })) }, null, 2));
}

async function runManifest() {
  assertMissing(outputFiles.manifest);
  const frozen = assertFrozenFile();
  const prepare = readJson(outputFiles.prepare);
  const review = readJson(outputFiles.review);
  const write = readJson(outputFiles.write);
  const readback = readJson(outputFiles.readback);
  const targets = readJson(outputFiles.targets);
  const browser = readJson(outputFiles.browser);
  assert.equal(prepare.status, 'PASS');
  assert.equal(review.status, 'APPROVED');
  assert.equal(write.status, 'PASS');
  assert.equal(readback.status, 'PASS');
  assert.equal(targets.status, 'PASS');
  assert.equal(browser.status, 'PASS');
  assert.equal(browser.targetCount, batchConfig.targets.length);
  assert.equal(browser.businessWrites, 0);
  assert.equal(browser.nonGetRequests, 0);
  assert.equal(browser.consoleErrors, 0);
  assert.equal(browser.consoleWarnings, 0);
  assert.equal(browser.pageErrors, 0);
  assert.equal(browser.failedRequests, 0);
  assert.equal(browser.requestAudit.postBrowserGetReadback.ruleCount, batchConfig.expectedCurrent.finalRuleCount);
  assert(browser.targets.every(item => item.matched));
  const names = ['01-补录方案.md', 'README.md', '批次配置.mjs', '批次执行.mjs', '02-冻结请求.json', '03-来源散列快照.json', '04-写入前现值.json', '05-独立写前评审.json', '06-写入流水.jsonl', '06-写入与即时回读.json', '07-独立GET回读.json', '08-页面目标.json', '09-页面验收.json', '录入体验报告.md'];
  for (const name of names) assert(fs.existsSync(path.join(batchDirectory, name)), '缺少证据文件：' + name);
  const output = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    scope: batchConfig.scope,
    batchSha256: frozen.batchSha256,
    requestAudit: {
      prepare: prepare.requestAudit,
      review: review.requestAudit,
      write: write.requestAudit,
      readback: readback.requestAudit,
      browserPostReadback: browser.requestAudit.postBrowserGetReadback
    },
    final: { skillCount: readback.global.skillCount, ruleCount: readback.global.ruleCount, processCount: readback.global.processCount, sourceInitializedCount: readback.global.sourceInitializedCount },
    conclusions: batchConfig.targets.map(target => ({ skillKey: target.skillKey, conclusion: target.conclusion, completedBranch: target.completedBranch, remaining: target.remaining })),
    browser: { targetCount: browser.targetCount, screenshots: browser.screenshots.length, consoleErrors: browser.consoleErrors, consoleWarnings: browser.consoleWarnings, pageErrors: browser.pageErrors, failedRequests: browser.failedRequests, businessWrites: browser.businessWrites },
    files: names.map(name => ({ name, sha256: fileSha(path.join(batchDirectory, name)), byteSize: fs.statSync(path.join(batchDirectory, name)).size })),
    boundary: batchConfig.runtimeBoundary
  };
  writeJsonExclusive(outputFiles.manifest, output);
  process.stdout.write(JSON.stringify({ status: output.status, scope: output.scope, batchSha256: output.batchSha256, final: output.final, browser: output.browser, conclusions: output.conclusions, fileCount: output.files.length }, null, 2));
}

if (mode === 'freeze') await runFreeze();
else if (mode === 'prepare') await runPrepare();
else if (mode === 'review') await runReview();
else if (mode === 'write') await runWrite();
else if (mode === 'readback') await runReadback();
else if (mode === 'targets') await runTargets();
else await runManifest();
