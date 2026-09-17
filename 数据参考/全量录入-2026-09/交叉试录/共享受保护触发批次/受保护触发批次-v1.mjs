import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(import.meta.url);
const runnerVersion = 'protected-trigger-batch-v1';
const supportedModes = ['freeze', 'prepare', 'review', 'write', 'readback', 'targets', 'manifest'];
const collections = [
  { path: 'parameters', key: 'parameterKey' },
  { path: 'formulas', key: 'formulaKey' },
  { path: 'effects', key: 'effectKey' },
  { path: 'processes', key: 'processKey' },
  { path: 'internal-states', key: 'stateKey' }
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

const shaBytes = value => crypto.createHash('sha256').update(value).digest('hex');
const canonicalSha = value => shaBytes(JSON.stringify(canonical(value)));
const fileSha = file => shaBytes(fs.readFileSync(file));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function withoutTimestamps(value) {
  if (Array.isArray(value)) return value.map(withoutTimestamps);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['createdAt', 'updatedAt'].includes(key))
    .map(([key, item]) => [key, withoutTimestamps(item)]));
}

function stripManagedFields(value) {
  if (Array.isArray(value)) return value.map(stripManagedFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['createdAt', 'updatedAt', 'gameId', 'skillKey'].includes(key))
    .map(([key, item]) => [key, stripManagedFields(item)]));
}

function normalizeRule(value) {
  const expectedKeys = [
    'actions',
    'conditionGroups',
    'description',
    'eventSource',
    'maxTriggersPerProcess',
    'name',
    'perTargetCooldown',
    'ruleKey',
    'sortOrder'
  ];
  assert.deepEqual(Object.keys(value).sort(), expectedKeys, '规则详情出现未知或缺失顶层字段：' + value.ruleKey);
  assert(value.eventSource && typeof value.eventSource === 'object');
  assert(value.eventSource.detail && typeof value.eventSource.detail === 'object' && !Array.isArray(value.eventSource.detail));
  return canonical({
    ruleKey: value.ruleKey,
    name: value.name,
    description: value.description ?? null,
    sortOrder: value.sortOrder,
    eventSource: value.eventSource,
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

function validateConfig(config) {
  assert(config && typeof config === 'object');
  assert.equal(config.schemaVersion, 1);
  assert(config.scope && config.runtimeBoundary);
  assert(config.expectedCurrent && Number.isInteger(config.expectedCurrent.skillCount));
  assert(Array.isArray(config.targets) && config.targets.length > 0);
  const ids = new Set();
  const identities = new Set();
  for (const target of config.targets) {
    assert(target.id && !ids.has(target.id), '批次目标标识重复：' + target.id);
    ids.add(target.id);
    assert(['character', 'equipment'].includes(target.ownerKind));
    assert(target.ownerKey && target.skillKey && target.skillName && target.sourceFile && target.sourceSha256);
    assert(target.rule && target.rule.ruleKey);
    const identity = target.skillKey + '/' + target.rule.ruleKey;
    assert(!identities.has(identity), '规则身份重复：' + identity);
    identities.add(identity);
    normalizeRule(target.rule);
    assert(target.rule.actions.length > 0);
    for (const action of target.rule.actions) {
      assert(['EXECUTE_EFFECT', 'START_PROCESS'].includes(action.actionType), '当前共享执行器不支持动作：' + action.actionType);
      const key = action.actionType === 'EXECUTE_EFFECT' ? action.detail?.effectKey : action.detail?.processKey;
      assert(key, '动作缺少目标稳定标识：' + target.id + '/' + action.actionKey);
    }
  }
  assert.equal(config.expectedCurrent.finalRuleCount, config.expectedCurrent.ruleCount + config.targets.length);
  const initializedAdded = config.targets.filter(target => target.rule.eventSource.eventType === 'SOURCE_INITIALIZED').length;
  assert.equal(config.expectedCurrent.finalSourceInitializedCount, config.expectedCurrent.sourceInitializedCount + initializedAdded);
}

function requestClient(config) {
  const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
  if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');
  const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
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
      signal: AbortSignal.timeout(config.requestTimeoutMs || 30_000)
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

function statusCounts(log) {
  const result = {};
  for (const item of log) result[item.status] = (result[item.status] || 0) + 1;
  return result;
}

function assertOnlyGet(client) {
  assert(client.log.every(item => item.method === 'GET'), '只读阶段出现非GET请求');
}

function relativeFrom(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function targetReference(action) {
  return action.actionType === 'EXECUTE_EFFECT'
    ? { collection: 'effects', keyField: 'effectKey', key: action.detail.effectKey }
    : { collection: 'processes', keyField: 'processKey', key: action.detail.processKey };
}

function sourceCandidate(config, repoRoot, target) {
  const file = path.join(repoRoot, ...target.sourceFile.split('/'));
  assert(fs.existsSync(file), '缺少来源文件：' + target.sourceFile);
  assert.equal(fileSha(file), target.sourceSha256, '来源文件散列漂移：' + target.sourceFile);
  const document = readJson(file);
  const skill = document.skills?.[target.skillKey];
  assert(skill, '来源文件缺少技能：' + target.skillKey);
  assert.equal(skill.skillKey, target.skillKey);
  for (const action of target.rule.actions) {
    const ref = targetReference(action);
    const object = skill.write?.[ref.collection]?.find(item => item[ref.keyField] === ref.key);
    assert(object, '来源候选缺少动作目标：' + target.id + '/' + ref.collection + '/' + ref.key);
  }
  return { document, skill };
}

function assertReferencesMatchSource(config, repoRoot, target, values) {
  const { skill } = sourceCandidate(config, repoRoot, target);
  for (const action of target.rule.actions) {
    const ref = targetReference(action);
    const expected = skill.write[ref.collection].find(item => item[ref.keyField] === ref.key);
    const actual = values[ref.collection].details.find(item => item[ref.keyField] === ref.key);
    assert(actual, '当前实库缺少动作目标：' + target.id + '/' + ref.collection + '/' + ref.key);
    assert.deepEqual(canonical(stripManagedFields(actual)), canonical(expected), '当前动作目标与冻结来源候选漂移：' + target.id + '/' + ref.key);
  }
}

async function captureComposition(context, client, target) {
  const prefix = '/skills/' + encodeURIComponent(target.skillKey);
  const skill = withoutTimestamps(await client.get(prefix));
  const relationPath = target.ownerKind === 'character'
    ? '/character-skill-relations?skillKey=' + encodeURIComponent(target.skillKey)
    : '/equipment-skill-relations?skillKey=' + encodeURIComponent(target.skillKey);
  const relation = withoutTimestamps(await client.get(relationPath));
  const image = withoutTimestamps(await client.get(prefix + '/representative-image'));
  assert.equal(skill.skillKey, target.skillKey);
  assert.equal(skill.name, target.skillName);
  assert.equal(relation.total, 1, '归属关系数不符：' + target.skillKey);
  const ownerField = target.ownerKind === 'character' ? 'characterKey' : 'equipmentKey';
  assert.equal(relation.items[0][ownerField], target.ownerKey, '归属对象不符：' + target.skillKey);
  assert.equal(relation.items[0].skillStatus, 'ENABLED', '目标技能未启用：' + target.skillKey);
  assert.equal(image.image?.enabled, true, '代表图未启用：' + target.skillKey);
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
  assertReferencesMatchSource(context.config, context.repoRoot, target, values);
  const ruleSummaries = withoutTimestamps(await client.get(prefix + '/trigger-rules'));
  const nonRule = { skill, relation, image, collections: values };
  return { nonRule, nonRuleSha256: canonicalSha(nonRule), ruleSummaries };
}

async function captureAllRules(context, client) {
  const document = await client.get('/skills');
  assert.equal(document.total, context.config.expectedCurrent.skillCount);
  assert.equal(document.items.length, context.config.expectedCurrent.skillCount);
  const skillKeys = document.items.map(item => item.skillKey).sort();
  assert.equal(new Set(skillKeys).size, skillKeys.length);
  const lists = await mapLimit(skillKeys, context.config.concurrency || 8, async skillKey => ({
    skillKey,
    summaries: await client.get('/skills/' + encodeURIComponent(skillKey) + '/trigger-rules')
  }));
  const identities = lists.flatMap(item => item.summaries.map(summary => ({
    skillKey: item.skillKey,
    ruleKey: summary.ruleKey,
    summaryUpdatedAt: summary.updatedAt,
    summaryEventType: summary.eventType
  }))).sort((left, right) => left.skillKey.localeCompare(right.skillKey) || left.ruleKey.localeCompare(right.ruleKey));
  assert.equal(new Set(identities.map(item => item.skillKey + '/' + item.ruleKey)).size, identities.length);
  const rules = await mapLimit(identities, context.config.concurrency || 8, async identity => ({
    ...identity,
    detail: normalizeRule(await client.get('/skills/' + encodeURIComponent(identity.skillKey) + '/trigger-rules/' + encodeURIComponent(identity.ruleKey)))
  }));
  const bodyRules = rules.map(item => ({ skillKey: item.skillKey, ruleKey: item.ruleKey, detail: item.detail }));
  const metadataRules = rules.map(item => ({ skillKey: item.skillKey, ruleKey: item.ruleKey, summaryUpdatedAt: item.summaryUpdatedAt, detail: item.detail }));
  return {
    skillCount: skillKeys.length,
    skillKeysSha256: canonicalSha(skillKeys),
    ruleCount: rules.length,
    sourceInitializedCount: rules.filter(item => item.detail.eventSource.eventType === 'SOURCE_INITIALIZED').length,
    rules,
    bodyRulesSha256: canonicalSha(bodyRules),
    metadataRulesSha256: canonicalSha(metadataRules)
  };
}

function createContext(batchDirectory, config) {
  const batchDir = path.resolve(batchDirectory);
  const repoRoot = path.resolve(batchDir, '..', '..', '..', '..');
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
  ].map(([key, name]) => [key, path.join(batchDir, name)]));
  return { batchDir, repoRoot, files, config };
}

function runFreeze(context) {
  const { batchDir, repoRoot, files, config } = context;
  for (const file of [files.source, files.frozen]) if (fs.existsSync(file)) throw new Error(path.basename(file) + ' 已存在，拒绝覆盖。');
  const sourceEntries = config.targets.map(target => {
    const { skill } = sourceCandidate(config, repoRoot, target);
    return {
      skillKey: target.skillKey,
      sourceFile: target.sourceFile,
      sourceSha256: target.sourceSha256,
      actionReferences: target.rule.actions.map(targetReference),
      clientSha256: skill.source?.clientSha256 ?? null,
      officialSha256: skill.source?.officialSha256 ?? null
    };
  });
  const sourceFiles = [...new Set(config.targets.map(item => item.sourceFile))].map(relativePath => {
    const file = path.join(repoRoot, ...relativePath.split('/'));
    return { relativePath, sha256: fileSha(file), byteSize: fs.statSync(file).size };
  });
  const localNames = ['01-补录方案.md', 'README.md', '批次配置.mjs', '批次执行.mjs'];
  const scriptFiles = localNames.map(name => {
    const file = path.join(batchDir, name);
    assert(fs.existsSync(file), '冻结前缺少脚本或说明：' + name);
    return { relativePath: relativeFrom(repoRoot, file), sha256: fileSha(file), byteSize: fs.statSync(file).size };
  });
  scriptFiles.push({ relativePath: relativeFrom(repoRoot, runnerPath), sha256: fileSha(runnerPath), byteSize: fs.statSync(runnerPath).size });
  const sourceSnapshot = {
    schemaVersion: 1,
    runnerVersion,
    frozenAt: new Date().toISOString(),
    status: 'FROZEN',
    sourceVersion: config.sourceVersion,
    sourceFiles,
    sourceEntries,
    scriptFiles,
    scope: config.targets.map(target => ({ skillKey: target.skillKey, ruleKey: target.rule.ruleKey, actions: target.rule.actions.map(action => ({ actionKey: action.actionKey, ...targetReference(action) })) }))
  };
  fs.writeFileSync(files.source, JSON.stringify(sourceSnapshot, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  const requests = config.targets.map(target => ({
    id: target.id,
    ownerKind: target.ownerKind,
    ownerKey: target.ownerKey,
    skillKey: target.skillKey,
    ruleKey: target.rule.ruleKey,
    method: 'POST',
    route: '/skills/' + target.skillKey + '/trigger-rules',
    detailRoute: '/skills/' + target.skillKey + '/trigger-rules/' + target.rule.ruleKey,
    expectedStatus: 201,
    sourceFile: target.sourceFile,
    sourceSha256: target.sourceSha256,
    bodySha256: canonicalSha(normalizeRule(target.rule)),
    body: target.rule
  }));
  const core = {
    schemaVersion: 1,
    runnerVersion,
    revision: 'rev1',
    status: 'FROZEN',
    frozenAt: sourceSnapshot.frozenAt,
    methodPolicy: { allowedBusinessMethods: ['POST'], allowedRequestCount: requests.length },
    expectedCurrent: config.expectedCurrent,
    sourceSnapshotSha256: fileSha(files.source),
    requests,
    runtimeBoundary: config.runtimeBoundary
  };
  const frozen = { ...core, batchSha256: canonicalSha(core) };
  fs.writeFileSync(files.frozen, JSON.stringify(frozen, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: frozen.status, runnerVersion, requestCount: requests.length, sourceSnapshotSha256: frozen.sourceSnapshotSha256, batchSha256: frozen.batchSha256, bodySha256: requests.map(item => ({ id: item.id, sha256: item.bodySha256 })) }, null, 2));
}

function verifyFrozen(context) {
  const { repoRoot, files, config } = context;
  const source = readJson(files.source);
  const frozen = readJson(files.frozen);
  assert.equal(source.status, 'FROZEN');
  assert.equal(source.runnerVersion, runnerVersion);
  assert.equal(frozen.status, 'FROZEN');
  assert.equal(frozen.runnerVersion, runnerVersion);
  assert.equal(frozen.sourceSnapshotSha256, fileSha(files.source));
  const { batchSha256, ...core } = frozen;
  assert.equal(batchSha256, canonicalSha(core));
  assert.deepEqual(frozen.expectedCurrent, config.expectedCurrent);
  assert.equal(frozen.requests.length, config.targets.length);
  for (const item of source.sourceFiles) assert.equal(fileSha(path.join(repoRoot, ...item.relativePath.split('/'))), item.sha256, '来源漂移：' + item.relativePath);
  for (const item of source.scriptFiles) assert.equal(fileSha(path.join(repoRoot, ...item.relativePath.split('/'))), item.sha256, '脚本漂移：' + item.relativePath);
  for (const request of frozen.requests) {
    const target = config.targets.find(item => item.id === request.id);
    assert(target, '冻结请求出现未知目标：' + request.id);
    assert.equal(request.bodySha256, canonicalSha(normalizeRule(request.body)));
    assert.equal(request.sourceSha256, fileSha(path.join(repoRoot, ...request.sourceFile.split('/'))));
    assert.deepEqual(normalizeRule(request.body), normalizeRule(target.rule));
  }
  return { source, frozen };
}

async function runPrepare(context) {
  verifyFrozen(context);
  const { files, config } = context;
  for (const file of [files.preflight, files.prepare]) if (fs.existsSync(file)) throw new Error(path.basename(file) + ' 已存在，拒绝覆盖。');
  const client = requestClient(config);
  const globalRules = await captureAllRules(context, client);
  assert.equal(globalRules.ruleCount, config.expectedCurrent.ruleCount);
  assert.equal(globalRules.sourceInitializedCount, config.expectedCurrent.sourceInitializedCount);
  const targets = [];
  for (const target of config.targets) {
    const captured = await captureComposition(context, client, target);
    assert.deepEqual(captured.ruleSummaries, [], '目标规则列表非空：' + target.skillKey);
    const missing = await client.request('/skills/' + target.skillKey + '/trigger-rules/' + target.rule.ruleKey);
    assert.equal(missing.status, 404, '目标规则详情不是预期404：' + target.skillKey);
    targets.push({ id: target.id, skillKey: target.skillKey, ruleKey: target.rule.ruleKey, nonRuleSha256: captured.nonRuleSha256, nonRule: captured.nonRule, ruleSummaries: [], expectedDetailStatus: 404 });
  }
  assertOnlyGet(client);
  const preflight = {
    schemaVersion: 1,
    runnerVersion,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    businessWrites: 0,
    frozenBatchSha256: readJson(files.frozen).batchSha256,
    globalRules,
    targets,
    requestAudit: { requestCount: client.log.length, methods: { GET: client.log.length }, statuses: statusCounts(client.log), pathsSha256: canonicalSha(client.log.map(item => item.path)) }
  };
  fs.writeFileSync(files.preflight, JSON.stringify(preflight, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  const report = {
    schemaVersion: 1,
    runnerVersion,
    capturedAt: preflight.capturedAt,
    status: 'PASS',
    preflightSha256: fileSha(files.preflight),
    frozenBatchSha256: preflight.frozenBatchSha256,
    getCount: client.log.length,
    statusCounts: preflight.requestAudit.statuses,
    skillCount: globalRules.skillCount,
    ruleCount: globalRules.ruleCount,
    sourceInitializedCount: globalRules.sourceInitializedCount,
    bodyRulesSha256: globalRules.bodyRulesSha256,
    metadataRulesSha256: globalRules.metadataRulesSha256,
    targetCount: targets.length,
    businessWrites: 0,
    boundary: '规范准备只发GET；完整事件明细、旧规则更新时间和目标非规则组成已冻结，目标规则列表为空且详情均为404。'
  };
  fs.writeFileSync(files.prepare, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify(report, null, 2));
}

function approvalCore(value) {
  return {
    approvedBatchSha256: value.approvedBatchSha256,
    preflightSha256: value.preflightSha256,
    bodyRulesSha256: value.bodyRulesSha256,
    metadataRulesSha256: value.metadataRulesSha256,
    targetNonRuleSha256: value.targetNonRuleSha256
  };
}

async function runReview(context) {
  const { frozen } = verifyFrozen(context);
  const { files, config } = context;
  if (fs.existsSync(files.review)) throw new Error('05-独立写前评审.json 已存在，拒绝覆盖。');
  const preflight = readJson(files.preflight);
  const prepare = readJson(files.prepare);
  assert.equal(prepare.status, 'PASS');
  assert.equal(prepare.preflightSha256, fileSha(files.preflight));
  assert.equal(preflight.frozenBatchSha256, frozen.batchSha256);
  const client = requestClient(config);
  const globalRules = await captureAllRules(context, client);
  assert.equal(globalRules.ruleCount, config.expectedCurrent.ruleCount);
  assert.equal(globalRules.sourceInitializedCount, config.expectedCurrent.sourceInitializedCount);
  assert.equal(globalRules.skillKeysSha256, preflight.globalRules.skillKeysSha256);
  assert.equal(globalRules.bodyRulesSha256, preflight.globalRules.bodyRulesSha256, '独立评审完整规则正文变化');
  assert.equal(globalRules.metadataRulesSha256, preflight.globalRules.metadataRulesSha256, '独立评审规则更新时间变化');
  const targetNonRuleSha256 = [];
  for (const target of config.targets) {
    const captured = await captureComposition(context, client, target);
    const before = preflight.targets.find(item => item.id === target.id);
    assert.equal(captured.nonRuleSha256, before?.nonRuleSha256, '独立评审目标组成变化：' + target.skillKey);
    assert.deepEqual(captured.ruleSummaries, [], '独立评审目标规则列表非空：' + target.skillKey);
    const missing = await client.request('/skills/' + target.skillKey + '/trigger-rules/' + target.rule.ruleKey);
    assert.equal(missing.status, 404, '独立评审目标规则详情不是404：' + target.skillKey);
    targetNonRuleSha256.push({ id: target.id, sha256: captured.nonRuleSha256 });
  }
  assertOnlyGet(client);
  const core = {
    approvedBatchSha256: frozen.batchSha256,
    preflightSha256: fileSha(files.preflight),
    bodyRulesSha256: globalRules.bodyRulesSha256,
    metadataRulesSha256: globalRules.metadataRulesSha256,
    targetNonRuleSha256
  };
  const output = {
    schemaVersion: 1,
    runnerVersion,
    capturedAt: new Date().toISOString(),
    status: 'APPROVED',
    reviewer: '既有独立来源复核加新进程完整事件明细GET契约检查',
    ...core,
    approvalDecisionSha256: canonicalSha(core),
    getCount: client.log.length,
    statusCounts: statusCounts(client.log),
    skillCount: globalRules.skillCount,
    ruleCount: globalRules.ruleCount,
    sourceInitializedCount: globalRules.sourceInitializedCount,
    businessWrites: 0,
    requestPathsSha256: canonicalSha(client.log.map(item => item.path)),
    boundary: config.reviewBoundary
  };
  fs.writeFileSync(files.review, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify(output, null, 2));
}

function verifyReview(context, frozen, preflight) {
  const review = readJson(context.files.review);
  assert.equal(review.status, 'APPROVED');
  assert.equal(review.approvedBatchSha256, frozen.batchSha256);
  assert.equal(review.preflightSha256, fileSha(context.files.preflight));
  assert.equal(review.bodyRulesSha256, preflight.globalRules.bodyRulesSha256);
  assert.equal(review.metadataRulesSha256, preflight.globalRules.metadataRulesSha256);
  assert.equal(review.approvalDecisionSha256, canonicalSha(approvalCore(review)));
  for (const target of preflight.targets) {
    const approved = review.targetNonRuleSha256.find(item => item.id === target.id);
    assert.equal(approved?.sha256, target.nonRuleSha256, '独立批准目标散列不符：' + target.id);
  }
  return review;
}

async function runWrite(context) {
  const { frozen } = verifyFrozen(context);
  const { files, config } = context;
  if (fs.existsSync(files.write)) throw new Error('06-写入与即时回读.json 已存在，拒绝再次执行写入。');
  const preflight = readJson(files.preflight);
  const prepare = readJson(files.prepare);
  assert.equal(prepare.status, 'PASS');
  assert.equal(prepare.preflightSha256, fileSha(files.preflight));
  assert.equal(preflight.frozenBatchSha256, frozen.batchSha256);
  const review = verifyReview(context, frozen, preflight);
  const beforeById = new Map(preflight.targets.map(item => [item.id, item]));
  const client = requestClient(config);
  const before = [];
  for (const target of config.targets) {
    const captured = await captureComposition(context, client, target);
    assert.equal(captured.nonRuleSha256, beforeById.get(target.id).nonRuleSha256, '写前非规则组成漂移：' + target.skillKey);
    assert(captured.ruleSummaries.every(item => item.ruleKey === target.rule.ruleKey), '出现范围外目标规则：' + target.skillKey);
    before.push({ id: target.id, ruleSummaries: captured.ruleSummaries, nonRuleSha256: captured.nonRuleSha256 });
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
    const operation = { at: new Date().toISOString(), id: request.id, skillKey: request.skillKey, ruleKey: request.ruleKey, state, detailSha256: canonicalSha(normalizeRule(detail)) };
    fs.appendFileSync(files.journal, JSON.stringify(operation) + '\n', 'utf8');
    operations.push(operation);
  }
  const output = {
    schemaVersion: 1,
    runnerVersion,
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
    boundary: config.writeBoundary
  };
  assert.equal(output.businessWrites + output.alreadyLanded, frozen.requests.length);
  assert.equal(output.requestAudit.methods.POST, businessWrites);
  assert(output.requestAudit.nonGetPaths.every(item => item.method === 'POST' && frozen.requests.some(request => request.route === item.path)));
  fs.writeFileSync(files.write, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: output.status, recoveryMode: output.recoveryMode, businessWrites: output.businessWrites, alreadyLanded: output.alreadyLanded, requestAudit: output.requestAudit, operations: output.operations }, null, 2));
}

async function runReadback(context) {
  const { frozen } = verifyFrozen(context);
  const { files, config } = context;
  if (fs.existsSync(files.readback)) throw new Error('07-独立GET回读.json 已存在，拒绝覆盖。');
  const preflight = readJson(files.preflight);
  const write = readJson(files.write);
  assert.equal(write.status, 'PASS');
  assert.equal(write.frozenBatchSha256, frozen.batchSha256);
  assert.equal(write.businessWrites + write.alreadyLanded, config.targets.length);
  const client = requestClient(config);
  const currentRules = await captureAllRules(context, client);
  assert.equal(currentRules.ruleCount, config.expectedCurrent.finalRuleCount);
  assert.equal(currentRules.sourceInitializedCount, config.expectedCurrent.finalSourceInitializedCount);
  assert.equal(currentRules.skillKeysSha256, preflight.globalRules.skillKeysSha256);
  const targetIds = new Set(config.targets.map(item => item.skillKey + '/' + item.rule.ruleKey));
  const oldRules = currentRules.rules.filter(item => !targetIds.has(item.skillKey + '/' + item.ruleKey));
  const oldBody = oldRules.map(item => ({ skillKey: item.skillKey, ruleKey: item.ruleKey, detail: item.detail }));
  const oldMetadata = oldRules.map(item => ({ skillKey: item.skillKey, ruleKey: item.ruleKey, summaryUpdatedAt: item.summaryUpdatedAt, detail: item.detail }));
  assert.equal(oldRules.length, config.expectedCurrent.ruleCount);
  assert.equal(canonicalSha(oldBody), preflight.globalRules.bodyRulesSha256, '旧规则完整正文发生变化');
  assert.equal(canonicalSha(oldMetadata), preflight.globalRules.metadataRulesSha256, '旧规则更新时间或完整正文发生变化');
  const byIdentity = new Map(currentRules.rules.map(item => [item.skillKey + '/' + item.ruleKey, item]));
  const targetChecks = [];
  for (const target of config.targets) {
    const identity = target.skillKey + '/' + target.rule.ruleKey;
    const rule = byIdentity.get(identity);
    assert(rule, '独立回读缺少新增规则：' + identity);
    assert.deepEqual(rule.detail, normalizeRule(target.rule), '新增规则不符：' + identity);
    const captured = await captureComposition(context, client, target);
    const before = preflight.targets.find(item => item.id === target.id);
    assert.equal(captured.nonRuleSha256, before.nonRuleSha256, '目标非规则组成变化：' + target.skillKey);
    assert.equal(captured.ruleSummaries.length, 1);
    assert.equal(captured.ruleSummaries[0].ruleKey, target.rule.ruleKey);
    targetChecks.push({ id: target.id, skillKey: target.skillKey, ruleKey: target.rule.ruleKey, actionReferences: target.rule.actions.map(targetReference), nonRuleSha256: captured.nonRuleSha256, ruleSha256: canonicalSha(rule.detail), updatedAt: rule.summaryUpdatedAt });
  }
  assertOnlyGet(client);
  const output = {
    schemaVersion: 1,
    runnerVersion,
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
    oldBodyRulesSha256: canonicalSha(oldBody),
    oldMetadataRulesSha256: canonicalSha(oldMetadata),
    allBodyRulesSha256: currentRules.bodyRulesSha256,
    allMetadataRulesSha256: currentRules.metadataRulesSha256,
    targetChecks,
    rules: currentRules.rules.map(item => ({ skillKey: item.skillKey, ruleKey: item.ruleKey, summaryUpdatedAt: item.summaryUpdatedAt, detail: item.detail })),
    requestPathsSha256: canonicalSha(client.log.map(item => item.path)),
    boundary: config.readbackBoundary
  };
  fs.writeFileSync(files.readback, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: output.status, getCount: output.getCount, skillCount: output.skillCount, ruleCount: output.ruleCount, sourceInitializedCount: output.sourceInitializedCount, oldRulesCount: output.oldRulesCount, oldBodyRulesSha256: output.oldBodyRulesSha256, oldMetadataRulesSha256: output.oldMetadataRulesSha256, targetChecks: output.targetChecks, businessWrites: 0 }, null, 2));
}

function runTargets(context) {
  verifyFrozen(context);
  const { files, config } = context;
  if (fs.existsSync(files.targets)) throw new Error('08-页面目标.json 已存在，拒绝覆盖。');
  const readback = readJson(files.readback);
  assert.equal(readback.status, 'PASS');
  const passed = new Set(readback.targetChecks.map(item => item.id));
  const targets = config.targets.filter(item => passed.has(item.id)).map(item => ({
    id: item.id,
    ownerKind: item.ownerKind,
    ownerKey: item.ownerKey,
    skillKey: item.skillKey,
    ruleKey: item.rule.ruleKey,
    ruleName: item.rule.name,
    eventType: item.rule.eventSource.eventType,
    actionReferences: item.rule.actions.map(action => ({ actionKey: action.actionKey, actionName: action.name, actionType: action.actionType, targetContext: action.targetContext, ...targetReference(action) })),
    expectedActionCount: item.rule.actions.length,
    expectedConditionGroupCount: item.rule.conditionGroups.length
  }));
  assert.equal(targets.length, config.targets.length);
  const core = { schemaVersion: 1, runnerVersion, generatedAt: new Date().toISOString(), status: 'PASS', source: '冻结请求与独立GET回读自动交集', targetCount: targets.length, targets, boundary: config.pageTargetBoundary };
  const output = { ...core, targetSha256: canonicalSha(core) };
  fs.writeFileSync(files.targets, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: output.status, targetCount: output.targetCount, targets: output.targets.map(item => item.skillKey), targetSha256: output.targetSha256 }, null, 2));
}

function runManifest(context) {
  const { frozen } = verifyFrozen(context);
  const { batchDir, files, config } = context;
  if (fs.existsSync(files.manifest)) throw new Error('10-证据清单.json 已存在，拒绝覆盖。');
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
  assert.equal(write.businessWrites, config.targets.length);
  assert.equal(write.alreadyLanded, 0);
  assert.equal(write.recoveryMode, false);
  assert.equal(write.requestAudit.methods.POST, config.targets.length);
  assert.equal(readback.ruleCount, config.expectedCurrent.finalRuleCount);
  assert.equal(readback.sourceInitializedCount, config.expectedCurrent.finalSourceInitializedCount);
  assert.equal(readback.oldRulesCount, config.expectedCurrent.ruleCount);
  assert.equal(browser.targetCount, config.targets.length);
  assert.equal(browser.businessWrites, 0);
  assert.equal(browser.nonGetRequests, 0);
  assert.equal(browser.consoleErrors, 0);
  assert.equal(browser.consoleWarnings, 0);
  assert.equal(browser.pageErrors, 0);
  assert.equal(browser.failedRequests, 0);
  assert(browser.targets.every(item => item.matched));
  const names = ['01-补录方案.md', 'README.md', '批次配置.mjs', '批次执行.mjs', '02-冻结请求.json', '03-来源散列快照.json', '04-写入前现值.json', '05-只读准备报告.json', '05-独立写前评审.json', '06-写入流水.jsonl', '06-写入与即时回读.json', '07-独立GET回读.json', '08-页面目标.json', '09-页面验收.json', '录入体验报告.md'];
  for (const name of names) assert(fs.existsSync(path.join(batchDir, name)), '缺少证据文件：' + name);
  const output = {
    schemaVersion: 1,
    runnerVersion,
    capturedAt: new Date().toISOString(),
    status: 'PASS',
    scope: config.scope,
    frozenBatchSha256: frozen.batchSha256,
    sourceSnapshotSha256: fileSha(files.source),
    prepare: { getCount: prepare.getCount, statusCounts: prepare.statusCounts, businessWrites: prepare.businessWrites, bodyRulesSha256: prepare.bodyRulesSha256, metadataRulesSha256: prepare.metadataRulesSha256 },
    review: { status: review.status, getCount: review.getCount, approvedBatchSha256: review.approvedBatchSha256, approvalDecisionSha256: review.approvalDecisionSha256, bodyRulesSha256: review.bodyRulesSha256, metadataRulesSha256: review.metadataRulesSha256, businessWrites: review.businessWrites },
    write: { businessWrites: write.businessWrites, alreadyLanded: write.alreadyLanded, recoveryMode: write.recoveryMode, requestAudit: write.requestAudit },
    independent: { getCount: readback.getCount, skillCount: readback.skillCount, ruleCount: readback.ruleCount, sourceInitializedCount: readback.sourceInitializedCount, oldRulesCount: readback.oldRulesCount, oldBodyRulesSha256: readback.oldBodyRulesSha256, oldMetadataRulesSha256: readback.oldMetadataRulesSha256, businessWrites: readback.businessWrites },
    browser: { targetCount: browser.targetCount, getRequests: browser.getRequests, nonGetRequests: browser.nonGetRequests, screenshots: browser.screenshots.length, consoleErrors: browser.consoleErrors, consoleWarnings: browser.consoleWarnings, pageErrors: browser.pageErrors, failedRequests: browser.failedRequests, businessWrites: browser.businessWrites },
    files: names.map(name => ({ name, sha256: fileSha(path.join(batchDir, name)), byteSize: fs.statSync(path.join(batchDir, name)).size })),
    boundary: config.manifestBoundary
  };
  fs.writeFileSync(files.manifest, JSON.stringify(output, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: output.status, scope: output.scope, frozenBatchSha256: output.frozenBatchSha256, prepare: output.prepare, review: output.review, write: output.write, independent: output.independent, browser: output.browser, fileCount: output.files.length }, null, 2));
}

export async function runProtectedTriggerBatch({ batchDirectory, config, mode }) {
  validateConfig(config);
  if (!supportedModes.includes(mode)) throw new Error('不支持的阶段：' + mode);
  const context = createContext(batchDirectory, config);
  if (mode === 'freeze') return runFreeze(context);
  if (mode === 'prepare') return runPrepare(context);
  if (mode === 'review') return runReview(context);
  if (mode === 'write') return runWrite(context);
  if (mode === 'readback') return runReadback(context);
  if (mode === 'targets') return runTargets(context);
  return runManifest(context);
}
