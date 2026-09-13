import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRule, expectedCurrent, targetConfigs } from './批次配置.mjs';

const mode = process.argv[2];
if (!['freeze', 'prepare', 'write'].includes(mode)) throw new Error('用法：node 批次执行.mjs freeze|prepare|write');
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const paths = Object.fromEntries([
  ['source', '03-来源散列快照.json'],
  ['frozen', '02-冻结请求.json'],
  ['preflight', '04-写入前现值.json'],
  ['prepare', '05-只读准备报告.json'],
  ['write', '06-写入与即时回读.json'],
  ['journal', '06-写入流水.jsonl']
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
    .filter(([key]) => key !== 'createdAt' && key !== 'updatedAt')
    .map(([key, item]) => [key, withoutTimestamps(item)]));
}

function normalizeRule(value) {
  const eventType = value.eventSource.eventType;
  const detail = eventType === 'SOURCE_INITIALIZED' ? {} : {
    sourceSkillKey: value.eventSource.detail?.sourceSkillKey ?? null,
    useKind: value.eventSource.detail?.useKind ?? null
  };
  return canonical({
    ruleKey: value.ruleKey,
    name: value.name,
    description: value.description ?? null,
    sortOrder: value.sortOrder,
    eventSource: { eventType, detail },
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
    for (const item of summaries) details.push(withoutTimestamps(await client.get(prefix + '/' + collection.path + '/' + encodeURIComponent(item[collection.key]))));
    values[collection.path] = { summaries: withoutTimestamps(summaries), details };
  }
  for (const action of config.actions) assert(values.effects.details.some(item => item.effectKey === action.effectKey), '缺少目标效果：' + config.skillKey + '/' + action.effectKey);
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
  const lists = await mapLimit(skillKeys, 8, async skillKey => ({ skillKey, summaries: withoutTimestamps(await client.get('/skills/' + encodeURIComponent(skillKey) + '/trigger-rules')) }));
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

function runFreeze() {
  for (const file of [paths.source, paths.frozen]) if (fs.existsSync(file)) throw new Error(path.basename(file) + ' 已存在，拒绝覆盖。');
  const sourceFiles = [...new Set(targetConfigs.map(item => item.sourceFile))].map(relativePath => {
    const file = path.join(repoRoot, ...relativePath.split('/'));
    const expected = targetConfigs.find(item => item.sourceFile === relativePath).sourceCandidateSha256;
    assert(fs.existsSync(file), '缺少来源文件：' + relativePath);
    assert.equal(fileSha(file), expected, '候选来源散列漂移：' + relativePath);
    return { relativePath, sha256: fileSha(file), byteSize: fs.statSync(file).size };
  });
  const scriptNames = ['01-补录方案.md', 'README.md', '批次配置.mjs', '批次执行.mjs', '独立GET回读.mjs', '生成页面目标.mjs', '生成证据清单.mjs'];
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
    scriptFiles,
    scope: targetConfigs.map(item => ({ skillKey: item.skillKey, ruleKey: item.ruleKey, effectKeys: item.actions.map(action => action.effectKey) }))
  };
  fs.writeFileSync(paths.source, JSON.stringify(sourceSnapshot, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
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
    sourceSnapshotSha256: fileSha(paths.source),
    requests,
    runtimeBoundary: '四条规则可由管理接口保存；Wasm组装、宿主事件生产和真实战斗尚未验证。'
  };
  const frozen = { ...core, batchSha256: canonicalSha(core) };
  fs.writeFileSync(paths.frozen, JSON.stringify(frozen, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: frozen.status, requestCount: requests.length, sourceSnapshotSha256: frozen.sourceSnapshotSha256, batchSha256: frozen.batchSha256, bodySha256: requests.map(item => ({ id: item.id, sha256: item.bodySha256 })) }, null, 2));
}

function verifyFrozen() {
  const source = readJson(paths.source);
  const frozen = readJson(paths.frozen);
  assert.equal(frozen.sourceSnapshotSha256, fileSha(paths.source));
  const { batchSha256, ...core } = frozen;
  assert.equal(batchSha256, canonicalSha(core));
  assert.deepEqual(frozen.expectedCurrent, expectedCurrent);
  assert.equal(frozen.requests.length, targetConfigs.length);
  for (const file of source.sourceFiles) assert.equal(fileSha(path.join(repoRoot, ...file.relativePath.split('/'))), file.sha256, '来源漂移：' + file.relativePath);
  for (const file of source.scriptFiles) assert.equal(fileSha(path.join(here, file.name)), file.sha256, '脚本漂移：' + file.name);
  for (const request of frozen.requests) {
    const config = targetConfigs.find(item => item.id === request.id);
    assert.equal(request.bodySha256, canonicalSha(request.body));
    assert.equal(request.sourceCandidateSha256, fileSha(path.join(repoRoot, ...request.sourceFile.split('/'))));
    assert.deepEqual(request.body, buildRule(config));
  }
  return { source, frozen };
}

async function runPrepare() {
  verifyFrozen();
  for (const file of [paths.preflight, paths.prepare]) if (fs.existsSync(file)) throw new Error(path.basename(file) + ' 已存在，拒绝覆盖。');
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
    targets.push({ id: config.id, skillKey: config.skillKey, ruleKey: config.ruleKey, nonRuleSha256: captured.nonRuleSha256, nonRule: captured.nonRule, ruleSummaries: [], expectedDetailStatus: 404 });
  }
  const preflight = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    businessWrites: 0,
    frozenBatchSha256: readJson(paths.frozen).batchSha256,
    globalRules,
    targets,
    requestAudit: { requestCount: client.log.length, methods: { GET: client.log.length }, statuses: statusCounts(client.log), pathsSha256: canonicalSha(client.log.map(item => item.path)) }
  };
  fs.writeFileSync(paths.preflight, JSON.stringify(preflight, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  const report = {
    schemaVersion: 1,
    capturedAt: preflight.capturedAt,
    status: 'PASS',
    preflightSha256: fileSha(paths.preflight),
    frozenBatchSha256: preflight.frozenBatchSha256,
    getCount: client.log.length,
    statusCounts: preflight.requestAudit.statuses,
    skillCount: globalRules.skillCount,
    ruleCount: globalRules.ruleCount,
    sourceInitializedCount: globalRules.sourceInitializedCount,
    targetCount: targets.length,
    businessWrites: 0,
    boundary: '规范准备只发GET；四项非规则组成已冻结，目标规则详情均为404。'
  };
  fs.writeFileSync(paths.prepare, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify(report, null, 2));
}

async function runWrite() {
  const { frozen } = verifyFrozen();
  if (fs.existsSync(paths.write)) throw new Error('06-写入与即时回读.json 已存在，拒绝再次执行写入。');
  const preflight = readJson(paths.preflight);
  const prepare = readJson(paths.prepare);
  assert.equal(prepare.status, 'PASS');
  assert.equal(prepare.preflightSha256, fileSha(paths.preflight));
  assert.equal(preflight.frozenBatchSha256, frozen.batchSha256);
  const preflightById = new Map(preflight.targets.map(item => [item.id, item]));
  const client = requestClient();
  const before = [];
  for (const config of targetConfigs) {
    const captured = await captureComposition(client, config);
    assert.equal(captured.nonRuleSha256, preflightById.get(config.id).nonRuleSha256, '写前非规则组成漂移：' + config.skillKey);
    assert(captured.ruleSummaries.every(item => item.ruleKey === config.ruleKey), '出现范围外目标规则：' + config.skillKey);
    before.push({ id: config.id, ruleSummaries: captured.ruleSummaries, nonRuleSha256: captured.nonRuleSha256 });
  }
  const journalExisted = fs.existsSync(paths.journal);
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
    const operation = { at: new Date().toISOString(), id: request.id, skillKey: request.skillKey, ruleKey: request.ruleKey, state, detailSha256: canonicalSha(normalizeRule(detail)) };
    fs.appendFileSync(paths.journal, JSON.stringify(operation) + '\n', 'utf8');
    operations.push(operation);
  }
  const output = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    frozenBatchSha256: frozen.batchSha256,
    preflightSha256: fileSha(paths.preflight),
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
    boundary: '仅创建冻结的四条规则并即时回读；其余技能组成和运行边界不变。'
  };
  assert.equal(output.businessWrites + output.alreadyLanded, frozen.requests.length);
  assert.equal(output.requestAudit.methods.POST, businessWrites);
  assert(output.requestAudit.nonGetPaths.every(item => item.method === 'POST' && frozen.requests.some(request => request.route === item.path)));
  fs.writeFileSync(paths.write, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: output.status, recoveryMode: output.recoveryMode, businessWrites: output.businessWrites, alreadyLanded: output.alreadyLanded, requestAudit: output.requestAudit, operations: output.operations }, null, 2));
}

if (mode === 'freeze') runFreeze();
else if (mode === 'prepare') await runPrepare();
else await runWrite();
