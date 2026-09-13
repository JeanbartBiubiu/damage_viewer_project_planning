import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { expectedCurrent, targetConfigs } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
const writeEnabled = process.env.DAMAGE_ALLOW_WRITE === 'YES';
const approvedBatch = String(process.env.DAMAGE_APPROVED_BATCH_SHA256 || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN。');
if (!writeEnabled) throw new Error('缺少 DAMAGE_ALLOW_WRITE=YES，拒绝业务写入。');

const reportPath = path.join(here, '05-写入与即时回读.json');
if (fs.existsSync(reportPath)) throw new Error('写入报告已存在，拒绝重放。先按稳定键回读并人工生成剩余项恢复方案。');

const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const shaValue = (value) => sha256(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const fileSha = (filePath) => sha256(fs.readFileSync(filePath));
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const equal = (actual, expected) => isDeepStrictEqual(stable(actual), stable(expected));
const assertCondition = (condition, message) => assert.equal(Boolean(condition), true, message);
const arrayData = (response, context) => {
  assert.equal(response.status, 200, `${context} 预期200，实际${response.status}`);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(`${context} 没有数组结果`);
};
const sortedUnique = (values, context) => {
  assertCondition(values.every((value) => typeof value === 'string' && value.length > 0), `${context} 存在空键`);
  const sorted = [...values].sort();
  assert.equal(new Set(sorted).size, sorted.length, `${context} 存在重复键`);
  return sorted;
};
const normalizeStoredRule = (value) => {
  const normalized = structuredClone(value);
  if (normalized?.eventSource?.eventType === 'SKILL_HIT' && normalized.eventSource.detail?.useKind === null) {
    delete normalized.eventSource.detail.useKind;
  }
  return normalized;
};

const frozen = readJson('02-合并冻结请求.json');
const source = readJson('03-来源散列快照.json');
const baseline = readJson('04-共享写前现值.json');
assert.equal(frozen.status, 'FROZEN', '冻结请求状态不符');
assert.equal(frozen.revision, 'rev1', '冻结请求修订不符');
assert.deepEqual(frozen.expectedCurrent, expectedCurrent, '冻结计数不符');
assert.equal(frozen.requests?.length, 4, '冻结请求不是四项');
assert.equal(frozen.methodPolicy?.allowedRequestCount, 4, '冻结写入数量不符');
assert.deepEqual(frozen.methodPolicy?.allowedBusinessMethods, ['POST'], '冻结方法白名单不符');
assert.equal(approvedBatch, frozen.batchSha256, 'DAMAGE_APPROVED_BATCH_SHA256 与冻结批次散列不符');
assert.equal(fileSha(path.join(here, '03-来源散列快照.json')), frozen.sourceSnapshotSha256, '来源快照文件散列不符');
assert.equal(fileSha(path.join(here, '02-合并冻结请求.json')), baseline.frozenRequestSha256, '冻结请求文件散列不符');
assert.equal(frozen.batchSha256, baseline.batchSha256, '基线批次散列不符');
assert.equal(baseline.status, 'CAPTURED', '写前基线状态不符');
assert.equal(baseline.businessWrites, 0, '写前基线含业务写入');
assert.equal(baseline.global?.skillKeys?.length, expectedCurrent.skillCount, '写前技能数不符');
assert.equal(baseline.global?.ruleDetails?.length, expectedCurrent.ruleCount, '写前规则数不符');
assert.equal(baseline.global?.eventTypeCounts?.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '写前初始化规则数不符');
const baselineAgeMs = Date.now() - Date.parse(baseline.capturedAt);
assertCondition(Number.isFinite(baselineAgeMs) && baselineAgeMs >= 0 && baselineAgeMs <= 30 * 60 * 1000, '写前共享基线超过30分钟，请重新冻结，不得沿旧基线写入');
for (const item of frozen.scriptHashes || []) {
  assert.equal(fileSha(path.join(here, item.name)), item.sha256, `批次文件已变化：${item.name}`);
}
for (const file of source.files || []) {
  const sourcePath = path.join(repoRoot, ...file.relativePath.split('/'));
  assert.equal(fileSha(sourcePath), file.sha256, `固定来源文件已变化：${file.relativePath}`);
}
for (const object of source.objects || []) {
  const sourcePath = path.join(repoRoot, ...object.relativePath.split('/'));
  const sourceObject = JSON.parse(fs.readFileSync(sourcePath, 'utf8')).skills?.[object.skillKey];
  assertCondition(sourceObject, `固定来源对象缺失：${object.skillKey}`);
  assert.equal(shaValue(sourceObject), object.objectSha256, `固定来源对象已变化：${object.skillKey}`);
}

const allowedRoutes = new Set(frozen.requests.map((entry) => entry.route));
assert.equal(allowedRoutes.size, 4, '冻结写入路径不唯一');
const report = {
  schemaVersion: 1,
  revision: 'rev1',
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  methodPolicy: 'FOUR_FROZEN_POSTS_ONLY',
  authorizationValueRecorded: false,
  approvedBatchSha256: approvedBatch,
  sourceSnapshotSha256: frozen.sourceSnapshotSha256,
  frozenRequestSha256: fileSha(path.join(here, '02-合并冻结请求.json')),
  baselineSha256: fileSha(path.join(here, '04-共享写前现值.json')),
  methods: { GET: 0, POST: 0 },
  getCount: 0,
  businessWriteCount: 0,
  preflight: [],
  writes: [],
  finalTargetReadback: [],
  error: null
};
const saveReport = () => fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });

async function request(method, route, body) {
  if (method !== 'GET') {
    assert.equal(method, 'POST', `拒绝未允许的方法 ${method}`);
    assertCondition(allowedRoutes.has(route), `拒绝未冻结路径 ${route}`);
    assertCondition(report.businessWriteCount < 4, '拒绝超过四次业务写入');
    report.businessWriteCount += 1;
    report.methods.POST += 1;
  } else {
    report.getCount += 1;
    report.methods.GET += 1;
  }
  const response = await fetch(baseUrl + route, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000)
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); }
    catch { data = { parseError: true, responseBytes: Buffer.byteLength(raw) }; }
  }
  return { method, route, status: response.status, data };
}
const get = (route) => request('GET', route);

function targetRoutes(config) {
  const skill = `/skills/${encodeURIComponent(config.skillKey)}`;
  const owner = `/characters/${encodeURIComponent(config.ownerKey)}`;
  return {
    skill,
    static: {
      subject: skill,
      owner,
      ownerAttributes: `${owner}/attributes`,
      ownerRepresentativeImage: `${owner}/representative-image`,
      relationByOwner: `/character-skill-relations?characterKey=${encodeURIComponent(config.ownerKey)}`,
      relationBySkill: `/character-skill-relations?skillKey=${encodeURIComponent(config.skillKey)}`,
      skillRepresentativeImage: `${skill}/representative-image`
    }
  };
}

async function readNonRule(config) {
  const routes = targetRoutes(config);
  const staticData = {};
  for (const [key, route] of Object.entries(routes.static)) {
    const response = await get(route);
    assert.equal(response.status, 200, `${config.name} ${route} 非200`);
    staticData[key] = response.data;
  }
  const components = {};
  for (const [apiName, keyName] of [['parameters', 'parameterKey'], ['formulas', 'formulaKey'], ['effects', 'effectKey'], ['processes', 'processKey'], ['internal-states', 'stateKey']]) {
    const listRoute = `${routes.skill}/${apiName}`;
    const list = await get(listRoute);
    const items = arrayData(list, `${config.name} ${apiName}`);
    const keys = sortedUnique(items.map((item) => item[keyName]), `${config.name} ${apiName}`);
    const details = [];
    for (const key of keys) {
      const response = await get(`${listRoute}/${encodeURIComponent(key)}`);
      assert.equal(response.status, 200, `${config.name} ${apiName}/${key} 非200`);
      details.push({ key, data: response.data });
    }
    components[apiName] = { list: list.data, keys, details };
  }
  return { static: staticData, components };
}

try {
  for (const config of targetConfigs) {
    const entry = frozen.requests.find((item) => item.id === config.id);
    assertCondition(entry, `冻结请求缺少 ${config.id}`);
    assert.equal(entry.method, 'POST', `${config.id} 方法不符`);
    assert.equal(entry.route, `/skills/${config.skillKey}/trigger-rules`, `${config.id} 路径不符`);
    assert.equal(entry.detailRoute, `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`, `${config.id} 详情路径不符`);
    assert.equal(entry.bodySha256, shaValue(entry.body), `${config.id} 请求体散列不符`);
    const candidate = await get(entry.detailRoute);
    assert.equal(candidate.status, 404, `${config.id} 写前详情必须404`);
    const nonRule = await readNonRule(config);
    const expectedNonRule = baseline.targetNonRuleSnapshots?.[config.id];
    assertCondition(expectedNonRule, `${config.id} 缺少非规则基线`);
    assert.equal(equal(nonRule, expectedNonRule), true, `${config.id} 非规则组成已变化`);
    report.preflight.push({
      id: config.id,
      candidateDetailStatus: candidate.status,
      bodySha256: entry.bodySha256,
      nonRuleSnapshotSha256: shaValue(nonRule)
    });
  }

  for (const entry of frozen.requests) {
    const response = await request('POST', entry.route, entry.body);
    const record = { id: entry.id, route: entry.route, bodySha256: entry.bodySha256, responseStatus: response.status, immediateReadback: null };
    report.writes.push(record);
    assert.equal(response.status, entry.expectedStatus, `${entry.id} 创建预期${entry.expectedStatus}，实际${response.status}`);
    const immediate = await get(entry.detailRoute);
    record.immediateReadback = {
      status: immediate.status,
      bodySha256: immediate.status === 200 ? shaValue(normalizeStoredRule(immediate.data)) : null,
      normalizedStoredSkillHitUseKindNull: immediate.data?.eventSource?.detail?.useKind === null
    };
    assert.equal(immediate.status, 200, `${entry.id} 即时回读非200`);
    assert.equal(equal(normalizeStoredRule(immediate.data), entry.body), true, `${entry.id} 即时回读与冻结正文不一致`);
  }

  for (const entry of frozen.requests) {
    const response = await get(entry.detailRoute);
    assert.equal(response.status, 200, `${entry.id} 最终定点回读非200`);
    assert.equal(equal(normalizeStoredRule(response.data), entry.body), true, `${entry.id} 最终定点回读不一致`);
    report.finalTargetReadback.push({ id: entry.id, status: response.status, bodySha256: shaValue(normalizeStoredRule(response.data)) });
  }
  assert.equal(report.businessWriteCount, 4, '业务写入数不是4');
  assert.equal(report.writes.length, 4, '写入流水数不是4');
  assertCondition(report.writes.every((item) => item.responseStatus === 201 && item.immediateReadback?.status === 200), '存在未完成创建或即时回读');
  report.status = 'PASS';
  report.completedAt = new Date().toISOString();
  report.expectedFinalRuleCount = expectedCurrent.finalRuleCount;
  report.runtimeValidation = '未执行；本报告只证明管理接口写入和定点回读。';
  saveReport();
  process.stdout.write(JSON.stringify({
    status: report.status,
    getCount: report.getCount,
    businessWriteCount: report.businessWriteCount,
    status201: report.writes.filter((item) => item.responseStatus === 201).length,
    immediateReadbacks: report.writes.filter((item) => item.immediateReadback?.status === 200).length,
    expectedFinalRuleCount: expectedCurrent.finalRuleCount
  }, null, 2));
} catch (error) {
  report.status = 'FAILED';
  report.completedAt = new Date().toISOString();
  report.error = { message: error instanceof Error ? error.message : String(error) };
  saveReport();
  throw error;
}
