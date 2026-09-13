import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRule, expectedCurrent, targetConfigs } from './批次配置.mjs';

const mode = process.argv[2];
const modes = ['freeze', 'prepare', 'review', 'write', 'readback', 'targets', 'manifest'];
if (!modes.includes(mode)) throw new Error('用法：node 批次执行.mjs freeze|prepare|review|write|readback|targets|manifest');

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const files = Object.fromEntries([
  ['source', '03-来源散列快照.json'],
  ['frozen', '02-冻结请求.json'],
  ['preflight', '04-写入前现值.json'],
  ['prepare', '05-只读准备报告.json'],
  ['review', '05-独立写前评审.json'],
  ['write', '06-写入与即时回读.json'],
  ['journal', '06-写入流水.jsonl'],
  ['readback', '07-独立GET回读.json'],
  ['targets', '08-页面目标.json'],
  ['browser', '09-页面验收.json'],
  ['manifest', '10-证据清单.json']
].map(([key, name]) => [key, path.join(here, name)]));

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const fileSha = file => shaBytes(fs.readFileSync(file));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

const canonicalSha = value => shaBytes(JSON.stringify(canonical(value)));

function withoutTimestamps(value) {
  if (Array.isArray(value)) return value.map(withoutTimestamps);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['createdAt', 'updatedAt'].includes(key))
    .map(([key, item]) => [key, withoutTimestamps(item)]));
}

function normalizeRule(value) {
  return canonical({
    ruleKey: value.ruleKey,
    name: value.name,
    description: value.description ?? null,
    sortOrder: value.sortOrder,
    eventSource: { eventType: value.eventSource.eventType, detail: {} },
    conditionGroups: value.conditionGroups || [],
    actions: value.actions || [],
    perTargetCooldown: value.perTargetCooldown ?? null,
    maxTriggersPerProcess: value.maxTriggersPerProcess ?? null
  });
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

function requestClient() {
  if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
  const log = [];
  async function request(relativePath, options = {}) {
    const method = options.method || 'GET';
    const response = await fetch(baseUrl + relativePath, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(30_000)
    });
    let data = null;
    if (response.status !== 204) {
      const text = await response.text();
      data = text ? JSON.parse(text) : null;
    }
    log.push({ method, path: relativePath, status: response.status });
    return { status: response.status, data };
  }
  async function get(relativePath, expectedStatus = 200) {
    const result = await request(relativePath);
    assert.equal(result.status, expectedStatus, relativePath + ' 状态不符');
    return result.data;
  }
  return { log, request, get };
}

const collections = [
  { path: 'parameters', key: 'parameterKey' },
  { path: 'formulas', key: 'formulaKey' },
  { path: 'effects', key: 'effectKey' },
  { path: 'processes', key: 'processKey' },
  { path: 'internal-states', key: 'stateKey' }
];

function sourceFilePath(relativePath) {
  return path.join(repoRoot, ...relativePath.split('/'));
}

function assertCandidateSource(config) {
  const file = sourceFilePath(config.sourceFile);
  assert(fs.existsSync(file), '缺少来源文件：' + config.sourceFile);
  assert.equal(fileSha(file), config.sourceCandidateSha256, '候选来源散列漂移：' + config.sourceFile);
  const document = readJson(file);
  const skill = document.skills?.[config.skillKey];
  assert(skill, '来源候选缺少技能：' + config.skillKey);
  assert.equal(skill.skillKey, config.skillKey);
  const effects = skill.write?.effects || [];
  for (const action of config.actions) {
    const effect = effects.find(item => item.effectKey === action.effectKey);
    assert(effect, '来源候选缺少目标效果：' + config.skillKey + '/' + action.effectKey);
    assert.equal(effect.results?.length, 1);
    assert.equal(effect.results[0].target, 'SOURCE');
    assert.equal(effect.results[0].resultType, 'ATTRIBUTE_CHANGE');
    assert.equal(effect.results[0].detail?.attributeKey, action.attributeKey);
    assert.equal(effect.results[0].valueRule?.value?.kind, 'PARAMETER');
    assert.equal(effect.results[0].valueRule.value.parameterKey, action.parameterKey);
  }
  return {
    skillKey: config.skillKey,
    sourceFile: config.sourceFile,
    sourceCandidateSha256: config.sourceCandidateSha256,
    clientSha256: skill.source?.clientSha256 ?? skill.source?.sourceEvidence?.clientSha256 ?? null,
    officialSha256: skill.source?.officialSha256 ?? skill.source?.sourceEvidence?.officialSha256 ?? null,
    effectKeys: config.actions.map(item => item.effectKey)
  };
}

function assertCurrentEffect(config, action, values) {
  const effect = values.effects.details.find(item => item.effectKey === action.effectKey);
  assert(effect, '当前实库缺少目标效果：' + config.skillKey + '/' + action.effectKey);
  assert.equal(effect.lifecycle?.durationValue, null, '目标效果不是无期限常驻：' + config.skillKey + '/' + action.effectKey);
  assert.deepEqual(effect.lifecycle?.maxStacksValue, { kind: 'FIXED', value: 1 });
  assert.deepEqual(effect.lifecycle?.applicationStacksValue, { kind: 'FIXED', value: 1 });
  assert.equal(effect.lifecycle?.instanceScope, 'SOURCE');
  assert.equal(effect.lifecycle?.expiryMode, 'EXPLICIT_ONLY');
  assert.equal(effect.results?.length, 1);
  const result = effect.results[0];
  assert.equal(result.target, 'SOURCE');
  assert.equal(result.resultType, 'ATTRIBUTE_CHANGE');
  assert.equal(result.detail?.attributeKey, action.attributeKey);
  assert.equal(result.lifecycleBehavior?.moment, 'PERSISTENT');
  assert.equal(result.lifecycleBehavior?.reapplicationValueMode, 'REPLACE');
  assert.equal(result.lifecycleBehavior?.stackValueMode, 'SHARED');
  assert.equal(result.valueRule?.value?.kind, 'PARAMETER');
  assert.equal(result.valueRule.value.parameterKey, action.parameterKey);
  const parameter = values.parameters.details.find(item => item.parameterKey === action.parameterKey);
  assert(parameter, '当前实库缺少目标参数：' + config.skillKey + '/' + action.parameterKey);
  assert.equal(parameter.valueMode, 'SKILL_LEVEL', '常驻效果取值不是当前技能等级：' + config.skillKey + '/' + action.effectKey);
}

async function captureComposition(client, config) {
  const prefix = '/skills/' + encodeURIComponent(config.skillKey);
  const skill = withoutTimestamps(await client.get(prefix));
  const relation = withoutTimestamps(await client.get('/character-skill-relations?skillKey=' + encodeURIComponent(config.skillKey)));
  const image = withoutTimestamps(await client.get(prefix + '/representative-image'));
  assert.equal(skill.skillKey, config.skillKey);
  assert.equal(skill.name, config.skillName);
  assert.equal(relation.total, 1, '角色技能关系数不符：' + config.skillKey);
  assert.equal(relation.items[0].characterKey, config.ownerKey, '角色归属不符：' + config.skillKey);
  assert.equal(relation.items[0].skillStatus, 'ENABLED', '目标技能未启用：' + config.skillKey);
  assert.equal(image.image?.enabled, true, '目标技能代表图未启用：' + config.skillKey);
  const values = {};
  for (const collection of collections) {
    const list = await client.get(prefix + '/' + collection.path);
    const summaries = [...list].sort((left, right) => String(left[collection.key]).localeCompare(String(right[collection.key])));
    const details = [];
    for (const item of summaries) {
      details.push(withoutTimestamps(await client.get(prefix + '/' + collection.path + '/' + encodeURIComponent(item[collection.key]))));
    }
    values[collection.path] = { summaries: withoutTimestamps(summaries), details };
  }
  for (const action of config.actions) assertCurrentEffect(config, action, values);
  const ruleSummaries = withoutTimestamps(await client.get(prefix + '/trigger-rules'));
  const nonRule = { skill, relation, image, collections: values };
  return { nonRule, nonRuleSha256: canonicalSha(nonRule), ruleSummaries };
}

async function captureAllRules(client) {
  const document = await client.get('/skills');
  assert.equal(document.total, expectedCurrent.skillCount);
  assert.equal(document.items.length, expectedCurrent.skillCount);
  const skillKeys = document.items.map(item => item.skillKey).sort();
  assert.equal(new Set(skillKeys).size, skillKeys.length);
  const lists = await mapLimit(skillKeys, 8, async skillKey => ({
    skillKey,
    summaries: withoutTimestamps(await client.get('/skills/' + encodeURIComponent(skillKey) + '/trigger-rules'))
  }));
  const identities = lists.flatMap(item => item.summaries.map(summary => ({ skillKey: item.skillKey, ruleKey: summary.ruleKey })))
    .sort((left, right) => left.skillKey.localeCompare(right.skillKey) || left.ruleKey.localeCompare(right.ruleKey));
  assert.equal(new Set(identities.map(item => item.skillKey + '/' + item.ruleKey)).size, identities.length);
  const rules = await mapLimit(identities, 8, async identity => ({
    ...identity,
    detail: normalizeRule(await client.get('/skills/' + encodeURIComponent(identity.skillKey) + '/trigger-rules/' + encodeURIComponent(identity.ruleKey)))
  }));
  return {
    skillCount: skillKeys.length,
    skillKeysSha256: canonicalSha(skillKeys),
    ruleCount: rules.length,
    sourceInitializedCount: rules.filter(item => item.detail.eventSource.eventType === 'SOURCE_INITIALIZED').length,
    rules,
    rulesSha256: canonicalSha(rules)
  };
}

function statusCounts(log) {
  const result = {};
  for (const item of log) result[item.status] = (result[item.status] || 0) + 1;
  return result;
}

function assertOnlyGet(client) {
  assert(client.log.every(item => item.method === 'GET'), '只读阶段出现非GET请求');
}

function runFreeze() {
  for (const file of [files.source, files.frozen]) if (fs.existsSync(file)) throw new Error(path.basename(file) + ' 已存在，拒绝覆盖。');
  const sourceEntries = targetConfigs.map(assertCandidateSource);
  const sourceFiles = [...new Set(targetConfigs.map(item => item.sourceFile))].map(relativePath => {
    const file = sourceFilePath(relativePath);
    return { relativePath, sha256: fileSha(file), byteSize: fs.statSync(file).size };
  });
  const scriptNames = ['01-补录方案.md', 'README.md', '批次配置.mjs', '批次执行.mjs'];
  const scriptFiles = scriptNames.map(name => {
    const file = path.join(here, name);
    assert(fs.existsSync(file), '冻结前缺少脚本或说明：' + name);
    return { name, sha256: fileSha(file), byteSize: fs.statSync(file).size };
  });
  const sourceSnapshot = {
    schemaVersion: 1,
    frozenAt: new Date().toISOString(),
    status: 'FROZEN',
    sourceVersion: '客户端16.17/官方16.17.1',
    sourceFiles,
    sourceEntries,
    scriptFiles,
    scope: targetConfigs.map(item => ({ skillKey: item.skillKey, ruleKey: item.ruleKey, effectKeys: item.actions.map(action => action.effectKey) }))
  };
  fs.writeFileSync(files.source, JSON.stringify(sourceSnapshot, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  const requests = targetConfigs.map(config => {
    const body = buildRule(config);
    return {
      id: config.id,
      skillKey: config.skillKey,
      ownerKey: config.ownerKey,
      ruleKey: config.ruleKey,
      effectKeys: config.actions.map(action => action.effectKey),
      method: 'POST',
      route: '/skills/' + config.skillKey + '/trigger-rules',
      detailRoute: '/skills/' + config.skillKey + '/trigger-rules/' + config.ruleKey,
      expectedStatus: 201,
      sourceFile: config.sourceFile,
      sourceCandidateSha256: config.sourceCandidateSha256,
      bodySha256: canonicalSha(body),
      body
    };
  });
  const core = {
    schemaVersion: 1,
    revision: 'rev1',
    status: 'FROZEN',
    frozenAt: sourceSnapshot.frozenAt,
    methodPolicy: { allowedBusinessMethods: ['POST'], allowedRequestCount: requests.length },
    expectedCurrent,
    sourceSnapshotSha256: fileSha(files.source),
    requests,
    runtimeBoundary: '三条管理规则可保存；来源初始化不表示复活、换装或后续技能升级，Wasm组装、宿主事件生产和真实战斗尚未验证。'
  };
  const frozen = { ...core, batchSha256: canonicalSha(core) };
  fs.writeFileSync(files.frozen, JSON.stringify(frozen, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({
    status: frozen.status,
    requestCount: requests.length,
    sourceSnapshotSha256: frozen.sourceSnapshotSha256,
    batchSha256: frozen.batchSha256,
    bodySha256: requests.map(item => ({ id: item.id, sha256: item.bodySha256 }))
  }, null, 2));
}

function verifyFrozen() {
  const source = readJson(files.source);
  const frozen = readJson(files.frozen);
  assert.equal(source.status, 'FROZEN');
  assert.equal(frozen.status, 'FROZEN');
  assert.equal(frozen.sourceSnapshotSha256, fileSha(files.source));
  const { batchSha256, ...core } = frozen;
  assert.equal(batchSha256, canonicalSha(core));
  assert.deepEqual(frozen.expectedCurrent, expectedCurrent);
  assert.equal(frozen.requests.length, targetConfigs.length);
  for (const item of source.sourceFiles) assert.equal(fileSha(sourceFilePath(item.relativePath)), item.sha256, '来源漂移：' + item.relativePath);
  for (const item of source.scriptFiles) assert.equal(fileSha(path.join(here, item.name)), item.sha256, '脚本漂移：' + item.name);
  for (const request of frozen.requests) {
    const config = targetConfigs.find(item => item.id === request.id);
    assert(config, '冻结请求出现未知目标：' + request.id);
    assert.equal(request.bodySha256, canonicalSha(request.body));
    assert.equal(request.sourceCandidateSha256, fileSha(sourceFilePath(request.sourceFile)));
    assert.deepEqual(request.body, buildRule(config));
  }
  return { source, frozen };
}

async function runPrepare() {
  verifyFrozen();
  for (const file of [files.preflight, files.prepare]) if (fs.existsSync(file)) throw new Error(path.basename(file) + ' 已存在，拒绝覆盖。');
  const client = requestClient();
  const globalRules = await captureAllRules(client);
  assert.equal(globalRules.ruleCount, expectedCurrent.ruleCount);
  assert.equal(globalRules.sourceInitializedCount, expectedCurrent.sourceInitializedCount);
  const targets = [];
  for (const config of targetConfigs) {
    const captured = await captureComposition(client, config);
    assert.deepEqual(captured.ruleSummaries, [], '目标规则列表非空：' + config.skillKey);
    const missing = await client.request('/skills/' + config.skillKey + '/trigger-rules/' + config.ruleKey);
    assert.equal(missing.status, 404, '目标规则详情不是预期404：' + config.skillKey);
    targets.push({
      id: config.id,
      skillKey: config.skillKey,
      ruleKey: config.ruleKey,
      nonRuleSha256: captured.nonRuleSha256,
      nonRule: captured.nonRule,
      ruleSummaries: [],
      expectedDetailStatus: 404
    });
  }
  assertOnlyGet(client);
  const preflight = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    businessWrites: 0,
    frozenBatchSha256: readJson(files.frozen).batchSha256,
    globalRules,
    targets,
    requestAudit: {
      requestCount: client.log.length,
      methods: { GET: client.log.length },
      statuses: statusCounts(client.log),
      pathsSha256: canonicalSha(client.log.map(item => item.path))
    }
  };
  fs.writeFileSync(files.preflight, JSON.stringify(preflight, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  const report = {
    schemaVersion: 1,
    capturedAt: preflight.capturedAt,
    status: 'PASS',
    preflightSha256: fileSha(files.preflight),
    frozenBatchSha256: preflight.frozenBatchSha256,
    getCount: client.log.length,
    statusCounts: preflight.requestAudit.statuses,
    skillCount: globalRules.skillCount,
    ruleCount: globalRules.ruleCount,
    sourceInitializedCount: globalRules.sourceInitializedCount,
    targetCount: targets.length,
    businessWrites: 0,
    boundary: '规范准备只发GET；三项非规则组成已冻结，目标规则列表为空且详情均为404。'
  };
  fs.writeFileSync(files.prepare, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify(report, null, 2));
}

function approvalCore(value) {
  return {
    approvedBatchSha256: value.approvedBatchSha256,
    preflightSha256: value.preflightSha256,
    rulesSha256: value.rulesSha256,
    targetNonRuleSha256: value.targetNonRuleSha256
  };
}

async function runReview() {
  const { frozen } = verifyFrozen();
  if (fs.existsSync(files.review)) throw new Error('05-独立写前评审.json 已存在，拒绝覆盖。');
  const preflight = readJson(files.preflight);
  const prepare = readJson(files.prepare);
  assert.equal(prepare.status, 'PASS');
  assert.equal(prepare.preflightSha256, fileSha(files.preflight));
  assert.equal(preflight.frozenBatchSha256, frozen.batchSha256);
  const client = requestClient();
  const globalRules = await captureAllRules(client);
  assert.equal(globalRules.ruleCount, expectedCurrent.ruleCount);
  assert.equal(globalRules.sourceInitializedCount, expectedCurrent.sourceInitializedCount);
  assert.equal(globalRules.skillKeysSha256, preflight.globalRules.skillKeysSha256);
  assert.equal(globalRules.rulesSha256, preflight.globalRules.rulesSha256, '独立评审规则基线变化');
  const targetNonRuleSha256 = [];
  for (const config of targetConfigs) {
    const captured = await captureComposition(client, config);
    const before = preflight.targets.find(item => item.id === config.id);
    assert(before, '预检缺少目标：' + config.id);
    assert.equal(captured.nonRuleSha256, before.nonRuleSha256, '独立评审目标组成变化：' + config.skillKey);
    assert.deepEqual(captured.ruleSummaries, [], '独立评审目标规则列表非空：' + config.skillKey);
    const missing = await client.request('/skills/' + config.skillKey + '/trigger-rules/' + config.ruleKey);
    assert.equal(missing.status, 404, '独立评审目标规则详情不是404：' + config.skillKey);
    targetNonRuleSha256.push({ id: config.id, sha256: captured.nonRuleSha256 });
  }
  assertOnlyGet(client);
  const core = {
    approvedBatchSha256: frozen.batchSha256,
    preflightSha256: fileSha(files.preflight),
    rulesSha256: globalRules.rulesSha256,
    targetNonRuleSha256
  };
  const output = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'APPROVED',
    reviewer: '既有独立来源复核加新进程纯GET契约检查',
    ...core,
    approvalDecisionSha256: canonicalSha(core),
    getCount: client.log.length,
    statusCounts: statusCounts(client.log),
    skillCount: globalRules.skillCount,
    ruleCount: globalRules.ruleCount,
    sourceInitializedCount: globalRules.sourceInitializedCount,
    businessWrites: 0,
    requestPathsSha256: canonicalSha(client.log.map(item => item.path)),
    boundary: '批准只覆盖冻结的三条来源初始化规则；不批准其他主动、命中、升级或运行分支。'
  };
  fs.writeFileSync(files.review, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify(output, null, 2));
}

function verifyReview(frozen, preflight) {
  const review = readJson(files.review);
  assert.equal(review.status, 'APPROVED');
  assert.equal(review.approvedBatchSha256, frozen.batchSha256);
  assert.equal(review.preflightSha256, fileSha(files.preflight));
  assert.equal(review.rulesSha256, preflight.globalRules.rulesSha256);
  assert.equal(review.approvalDecisionSha256, canonicalSha(approvalCore(review)));
  for (const target of preflight.targets) {
    const approved = review.targetNonRuleSha256.find(item => item.id === target.id);
    assert.equal(approved?.sha256, target.nonRuleSha256, '独立批准目标散列不符：' + target.id);
  }
  return review;
}

async function runWrite() {
  const { frozen } = verifyFrozen();
  if (fs.existsSync(files.write)) throw new Error('06-写入与即时回读.json 已存在，拒绝再次执行写入。');
  const preflight = readJson(files.preflight);
  const prepare = readJson(files.prepare);
  assert.equal(prepare.status, 'PASS');
  assert.equal(prepare.preflightSha256, fileSha(files.preflight));
  assert.equal(preflight.frozenBatchSha256, frozen.batchSha256);
  const review = verifyReview(frozen, preflight);
  const beforeById = new Map(preflight.targets.map(item => [item.id, item]));
  const client = requestClient();
  const before = [];
  for (const config of targetConfigs) {
    const captured = await captureComposition(client, config);
    assert.equal(captured.nonRuleSha256, beforeById.get(config.id).nonRuleSha256, '写前非规则组成漂移：' + config.skillKey);
    assert(captured.ruleSummaries.every(item => item.ruleKey === config.ruleKey), '出现范围外目标规则：' + config.skillKey);
    before.push({ id: config.id, ruleSummaries: captured.ruleSummaries, nonRuleSha256: captured.nonRuleSha256 });
  }
  const journalExisted = fs.existsSync(files.journal);
  const operations = [];
  let businessWrites = 0;
  for (const request of frozen.requests) {
    const current = await client.request(request.detailRoute);
    let state;
    let detail;
    if (current.status === 200) {
      assert.deepEqual(normalizeRule(current.data), normalizeRule(request.body), '已落地规则与冻结请求不符：' + request.id);
      state = 'ALREADY_LANDED';
      detail = current.data;
    } else {
      assert.equal(current.status, 404, '目标规则写前状态异常：' + request.id);
      const created = await client.request(request.route, { method: 'POST', body: request.body });
      assert.equal(created.status, 201, 'POST状态不符：' + request.id);
      assert.deepEqual(normalizeRule(created.data), normalizeRule(request.body), 'POST响应不符：' + request.id);
      businessWrites += 1;
      detail = await client.get(request.detailRoute);
      assert.deepEqual(normalizeRule(detail), normalizeRule(request.body), '即时回读不符：' + request.id);
      state = 'CREATED';
    }
    const operation = {
      at: new Date().toISOString(),
      id: request.id,
      skillKey: request.skillKey,
      ruleKey: request.ruleKey,
      state,
      detailSha256: canonicalSha(normalizeRule(detail))
    };
    fs.appendFileSync(files.journal, JSON.stringify(operation) + '\n', 'utf8');
    operations.push(operation);
  }
  const output = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    frozenBatchSha256: frozen.batchSha256,
    preflightSha256: fileSha(files.preflight),
    reviewSha256: fileSha(files.review),
    approvalDecisionSha256: review.approvalDecisionSha256,
    recoveryMode: journalExisted || operations.some(item => item.state === 'ALREADY_LANDED'),
    businessWrites,
    alreadyLanded: operations.filter(item => item.state === 'ALREADY_LANDED').length,
    allowedBusinessMethods: ['POST'],
    before,
    operations,
    requestAudit: {
      requestCount: client.log.length,
      methods: Object.fromEntries(['GET', 'POST'].map(method => [method, client.log.filter(item => item.method === method).length])),
      statuses: statusCounts(client.log),
      nonGetPaths: client.log.filter(item => item.method !== 'GET').map(item => ({ method: item.method, path: item.path }))
    },
    boundary: '仅创建独立批准散列覆盖的三条来源初始化规则并即时回读；其余技能组成和运行边界不变。'
  };
  assert.equal(output.businessWrites + output.alreadyLanded, frozen.requests.length);
  assert.equal(output.requestAudit.methods.POST, businessWrites);
  assert(output.requestAudit.nonGetPaths.every(item => item.method === 'POST' && frozen.requests.some(request => request.route === item.path)));
  fs.writeFileSync(files.write, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({
    status: output.status,
    recoveryMode: output.recoveryMode,
    businessWrites: output.businessWrites,
    alreadyLanded: output.alreadyLanded,
    requestAudit: output.requestAudit,
    operations: output.operations
  }, null, 2));
}

async function runReadback() {
  const { frozen } = verifyFrozen();
  if (fs.existsSync(files.readback)) throw new Error('07-独立GET回读.json 已存在，拒绝覆盖。');
  const preflight = readJson(files.preflight);
  const write = readJson(files.write);
  assert.equal(write.status, 'PASS');
  assert.equal(write.frozenBatchSha256, frozen.batchSha256);
  assert.equal(write.businessWrites + write.alreadyLanded, targetConfigs.length);
  const client = requestClient();
  const currentRules = await captureAllRules(client);
  assert.equal(currentRules.ruleCount, expectedCurrent.finalRuleCount);
  assert.equal(currentRules.sourceInitializedCount, expectedCurrent.finalSourceInitializedCount);
  assert.equal(currentRules.skillKeysSha256, preflight.globalRules.skillKeysSha256);
  const targetIds = new Set(targetConfigs.map(item => item.skillKey + '/' + item.ruleKey));
  const oldRules = currentRules.rules.filter(item => !targetIds.has(item.skillKey + '/' + item.ruleKey));
  assert.equal(oldRules.length, expectedCurrent.ruleCount);
  assert.equal(canonicalSha(oldRules), preflight.globalRules.rulesSha256, '既有规则集合发生变化');
  const byIdentity = new Map(currentRules.rules.map(item => [item.skillKey + '/' + item.ruleKey, item.detail]));
  const targetChecks = [];
  for (const config of targetConfigs) {
    const identity = config.skillKey + '/' + config.ruleKey;
    assert.deepEqual(byIdentity.get(identity), normalizeRule(buildRule(config)), '新增规则不符：' + identity);
    const captured = await captureComposition(client, config);
    const before = preflight.targets.find(item => item.id === config.id);
    assert.equal(captured.nonRuleSha256, before.nonRuleSha256, '目标非规则组成变化：' + config.skillKey);
    assert.equal(captured.ruleSummaries.length, 1);
    assert.equal(captured.ruleSummaries[0].ruleKey, config.ruleKey);
    targetChecks.push({
      id: config.id,
      skillKey: config.skillKey,
      ruleKey: config.ruleKey,
      effectKeys: config.actions.map(action => action.effectKey),
      nonRuleSha256: captured.nonRuleSha256,
      ruleSha256: canonicalSha(byIdentity.get(identity))
    });
  }
  assertOnlyGet(client);
  const output = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    businessWrites: 0,
    getCount: client.log.length,
    statusCounts: statusCounts(client.log),
    skillCount: currentRules.skillCount,
    ruleCount: currentRules.ruleCount,
    sourceInitializedCount: currentRules.sourceInitializedCount,
    oldRulesCount: oldRules.length,
    oldRulesSha256: canonicalSha(oldRules),
    allRulesSha256: currentRules.rulesSha256,
    targetChecks,
    requestPathsSha256: canonicalSha(client.log.map(item => item.path)),
    boundary: '独立检查器只发GET；既有139条规则与三项非规则组成不变，三条新增规则精确匹配冻结请求。来源初始化后的Wasm、宿主和真实战斗未执行。'
  };
  fs.writeFileSync(files.readback, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({
    status: output.status,
    getCount: output.getCount,
    skillCount: output.skillCount,
    ruleCount: output.ruleCount,
    sourceInitializedCount: output.sourceInitializedCount,
    oldRulesCount: output.oldRulesCount,
    targetChecks: output.targetChecks,
    businessWrites: 0
  }, null, 2));
}

function runTargets() {
  verifyFrozen();
  if (fs.existsSync(files.targets)) throw new Error('08-页面目标.json 已存在，拒绝覆盖。');
  const frozen = readJson(files.frozen);
  const readback = readJson(files.readback);
  assert.equal(readback.status, 'PASS');
  const passed = new Set(readback.targetChecks.map(item => item.id));
  const targets = frozen.requests.filter(item => passed.has(item.id)).map(item => ({
    id: item.id,
    skillKey: item.skillKey,
    ownerKey: item.ownerKey,
    effectKeys: item.effectKeys,
    ruleKey: item.ruleKey,
    ruleName: item.body.name,
    eventType: item.body.eventSource.eventType,
    actions: item.body.actions.map(action => ({
      actionKey: action.actionKey,
      actionName: action.name,
      effectKey: action.detail.effectKey,
      targetContext: action.targetContext
    })),
    expectedActionCount: item.body.actions.length,
    expectedConditionGroupCount: item.body.conditionGroups.length
  }));
  assert.equal(targets.length, targetConfigs.length);
  const core = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    source: '冻结请求与独立GET回读自动交集',
    targetCount: targets.length,
    targets,
    boundary: '只包含已写入且独立回读通过的三项；主动、命中、升级和运行分支不进入页面目标。'
  };
  const output = { ...core, targetSha256: canonicalSha(core) };
  fs.writeFileSync(files.targets, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: output.status, targetCount: output.targetCount, targets: output.targets.map(item => item.skillKey), targetSha256: output.targetSha256 }, null, 2));
}

function runManifest() {
  verifyFrozen();
  if (fs.existsSync(files.manifest)) throw new Error('10-证据清单.json 已存在，拒绝覆盖。');
  const frozen = readJson(files.frozen);
  const prepare = readJson(files.prepare);
  const review = readJson(files.review);
  const write = readJson(files.write);
  const readback = readJson(files.readback);
  const targets = readJson(files.targets);
  const browser = readJson(files.browser);
  assert.equal(prepare.status, 'PASS');
  assert.equal(review.status, 'APPROVED');
  assert.equal(write.status, 'PASS');
  assert.equal(readback.status, 'PASS');
  assert.equal(targets.status, 'PASS');
  assert.equal(browser.status, 'PASS');
  assert.equal(write.businessWrites, 3);
  assert.equal(write.alreadyLanded, 0);
  assert.equal(write.recoveryMode, false);
  assert.equal(write.requestAudit.methods.POST, 3);
  assert.equal(readback.ruleCount, expectedCurrent.finalRuleCount);
  assert.equal(readback.sourceInitializedCount, expectedCurrent.finalSourceInitializedCount);
  assert.equal(readback.oldRulesCount, expectedCurrent.ruleCount);
  assert.equal(browser.targetCount, 3);
  assert.equal(browser.businessWrites, 0);
  assert.equal(browser.nonGetRequests, 0);
  assert.equal(browser.consoleErrors, 0);
  assert.equal(browser.consoleWarnings, 0);
  assert.equal(browser.pageErrors, 0);
  assert.equal(browser.failedRequests, 0);
  assert(browser.targets.every(item => item.matched));
  const names = [
    '01-补录方案.md',
    'README.md',
    '批次配置.mjs',
    '批次执行.mjs',
    '02-冻结请求.json',
    '03-来源散列快照.json',
    '04-写入前现值.json',
    '05-只读准备报告.json',
    '05-独立写前评审.json',
    '06-写入流水.jsonl',
    '06-写入与即时回读.json',
    '07-独立GET回读.json',
    '08-页面目标.json',
    '09-页面验收.json',
    '录入体验报告.md'
  ];
  for (const name of names) assert(fs.existsSync(path.join(here, name)), '缺少证据文件：' + name);
  const output = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    scope: '克格莫Q、奥拉夫R和亚恒R三项常驻自身属性来源初始化规则',
    frozenBatchSha256: frozen.batchSha256,
    sourceSnapshotSha256: fileSha(files.source),
    prepare: { getCount: prepare.getCount, statusCounts: prepare.statusCounts, businessWrites: prepare.businessWrites },
    review: {
      status: review.status,
      getCount: review.getCount,
      approvedBatchSha256: review.approvedBatchSha256,
      approvalDecisionSha256: review.approvalDecisionSha256,
      businessWrites: review.businessWrites
    },
    write: {
      businessWrites: write.businessWrites,
      alreadyLanded: write.alreadyLanded,
      recoveryMode: write.recoveryMode,
      requestAudit: write.requestAudit
    },
    independent: {
      getCount: readback.getCount,
      skillCount: readback.skillCount,
      ruleCount: readback.ruleCount,
      sourceInitializedCount: readback.sourceInitializedCount,
      oldRulesCount: readback.oldRulesCount,
      businessWrites: readback.businessWrites
    },
    browser: {
      targetCount: browser.targetCount,
      getRequests: browser.getRequests,
      nonGetRequests: browser.nonGetRequests,
      screenshots: browser.screenshots.length,
      consoleErrors: browser.consoleErrors,
      consoleWarnings: browser.consoleWarnings,
      pageErrors: browser.pageErrors,
      failedRequests: browser.failedRequests,
      businessWrites: browser.businessWrites
    },
    files: names.map(name => ({ name, sha256: fileSha(path.join(here, name)), byteSize: fs.statSync(path.join(here, name)).size })),
    boundary: '三条管理规则、独立批准、两路完整GET回读和真实页面通过；来源初始化不表示后续技能升级，Wasm组装、宿主事件生产及真实战斗未执行。'
  };
  fs.writeFileSync(files.manifest, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({
    status: output.status,
    scope: output.scope,
    frozenBatchSha256: output.frozenBatchSha256,
    prepare: output.prepare,
    review: output.review,
    write: output.write,
    independent: output.independent,
    browser: output.browser,
    fileCount: output.files.length
  }, null, 2));
}

if (mode === 'freeze') runFreeze();
else if (mode === 'prepare') await runPrepare();
else if (mode === 'review') await runReview();
else if (mode === 'write') await runWrite();
else if (mode === 'readback') await runReadback();
else if (mode === 'targets') runTargets();
else runManifest();
