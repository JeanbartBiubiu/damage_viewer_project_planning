import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { expectedCurrent, targetConfigs } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；独立回读只发送 GET。');
const reportPath = path.join(here, '06-独立GET回读.json');
if (fs.existsSync(reportPath)) throw new Error('06-独立GET回读.json 已存在，拒绝覆盖。');

const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const shaValue = (value) => sha256(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const fileSha = (name) => sha256(fs.readFileSync(path.join(here, name)));
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const equal = (actual, expected) => isDeepStrictEqual(stable(actual), stable(expected));
const assertCondition = (condition, message) => assert.equal(Boolean(condition), true, message);
const ruleId = (skillKey, ruleKey) => `${skillKey}/${ruleKey}`;
const normalizeStoredRule = (value) => {
  const normalized = structuredClone(value);
  if (normalized?.eventSource?.eventType === 'SKILL_HIT' && normalized.eventSource.detail?.useKind === null) {
    delete normalized.eventSource.detail.useKind;
  }
  return normalized;
};

const frozen = readJson('02-合并冻结请求.json');
const baseline = readJson('04-共享写前现值.json');
const writer = readJson('05-写入与即时回读.json');
assert.equal(frozen.status, 'FROZEN', '冻结请求状态不符');
assert.deepEqual(frozen.expectedCurrent, expectedCurrent, '冻结计数不符');
assert.equal(frozen.requests?.length, 4, '冻结请求不是四项');
assert.equal(baseline.status, 'CAPTURED', '写前基线状态不符');
assert.equal(baseline.businessWrites, 0, '写前基线含业务写入');
assert.equal(writer.status, 'PASS', '受保护写入未通过');
assert.equal(writer.businessWriteCount, 4, '受保护写入数不是4');
assert.equal(writer.baselineSha256, fileSha('04-共享写前现值.json'), '写入器使用的基线与当前文件不一致');
assert.equal(baseline.frozenRequestSha256, fileSha('02-合并冻结请求.json'), '冻结请求文件散列不符');
assert.equal(frozen.sourceSnapshotSha256, fileSha('03-来源散列快照.json'), '来源快照文件散列不符');
for (const item of frozen.scriptHashes || []) assert.equal(fileSha(item.name), item.sha256, `批次文件已变化：${item.name}`);

const report = {
  schemaVersion: 1,
  revision: 'rev1',
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  methodPolicy: 'GET_ONLY',
  authorizationValueRecorded: false,
  methods: { GET: 0 },
  getCount: 0,
  businessWrites: 0,
  targets: [],
  global: null,
  error: null
};
const save = () => fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
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
async function get(route) {
  report.getCount += 1;
  report.methods.GET += 1;
  const response = await fetch(baseUrl + route, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000)
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); }
    catch { data = { parseError: true, responseBytes: Buffer.byteLength(raw) }; }
  }
  return { method: 'GET', route, status: response.status, data };
}
async function getMany(routes, concurrency = 24) {
  const output = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= routes.length) return;
      output[index] = await get(routes[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker()));
  return output;
}

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

async function readTarget(config) {
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
    const responses = await getMany(keys.map((key) => `${listRoute}/${encodeURIComponent(key)}`));
    responses.forEach((response, index) => assert.equal(response.status, 200, `${config.name} ${apiName}/${keys[index]} 非200`));
    components[apiName] = { list: list.data, keys, details: responses.map((response, index) => ({ key: keys[index], data: response.data })) };
  }
  const candidate = await get(`${routes.skill}/trigger-rules/${encodeURIComponent(config.ruleKey)}`);
  assert.equal(candidate.status, 200, `${config.name} 新规则详情非200`);
  return { nonRule: { static: staticData, components }, candidate };
}

async function scanRules() {
  const skillsResponse = await get('/skills');
  const skills = arrayData(skillsResponse, '最终全技能目录');
  const skillKeys = sortedUnique(skills.map((item) => item.skillKey), '最终全技能目录');
  assert.equal(skillKeys.length, expectedCurrent.skillCount, `最终技能数不是${expectedCurrent.skillCount}`);
  const responses = await getMany(skillKeys.map((skillKey) => `/skills/${encodeURIComponent(skillKey)}/trigger-rules`));
  const lists = responses.map((response, index) => {
    const rules = arrayData(response, `${skillKeys[index]} 最终规则列表`);
    const ruleKeys = sortedUnique(rules.map((item) => item.ruleKey), `${skillKeys[index]} 最终规则列表`);
    return { skillKey: skillKeys[index], rules, ruleKeys };
  });
  const refs = lists
    .flatMap(({ skillKey, ruleKeys }) => ruleKeys.map((ruleKey) => ({ skillKey, ruleKey })))
    .sort((left, right) => ruleId(left.skillKey, left.ruleKey).localeCompare(ruleId(right.skillKey, right.ruleKey)));
  assert.equal(refs.length, expectedCurrent.finalRuleCount, `最终规则数不是${expectedCurrent.finalRuleCount}`);
  const detailResponses = await getMany(refs.map(({ skillKey, ruleKey }) => `/skills/${encodeURIComponent(skillKey)}/trigger-rules/${encodeURIComponent(ruleKey)}`));
  detailResponses.forEach((response, index) => assert.equal(response.status, 200, `${ruleId(refs[index].skillKey, refs[index].ruleKey)} 详情非200`));
  const details = detailResponses.map((response, index) => ({ ...refs[index], data: response.data }));
  const eventTypeCounts = details.reduce((counts, item) => {
    const key = item.data?.eventSource?.eventType;
    if (key) counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  return { skillKeys, lists, refs, details, eventTypeCounts };
}

try {
  for (const config of targetConfigs) {
    const current = await readTarget(config);
    const expectedNonRule = baseline.targetNonRuleSnapshots?.[config.id];
    assertCondition(expectedNonRule, `${config.id} 缺少非规则基线`);
    assert.equal(equal(current.nonRule, expectedNonRule), true, `${config.id} 非规则组成变化`);
    const entry = frozen.requests.find((item) => item.id === config.id);
    assertCondition(entry, `冻结请求缺少 ${config.id}`);
    assert.equal(entry.bodySha256, shaValue(entry.body), `${config.id} 冻结正文散列不符`);
    assert.equal(equal(normalizeStoredRule(current.candidate.data), entry.body), true, `${config.id} 新规则与冻结正文不符`);
    report.targets.push({
      id: config.id,
      skillKey: config.skillKey,
      candidateDetailStatus: current.candidate.status,
      candidateBodySha256: shaValue(normalizeStoredRule(current.candidate.data)),
      frozenBodySha256: entry.bodySha256,
      normalizedStoredSkillHitUseKindNull: current.candidate.data?.eventSource?.detail?.useKind === null,
      nonRuleSnapshotSha256: shaValue(current.nonRule)
    });
  }

  const finalScan = await scanRules();
  assert.equal(finalScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '最终初始化规则数不符');
  const oldDetails = baseline.global.ruleDetails;
  assert.equal(oldDetails.length, expectedCurrent.ruleCount, '写前旧规则详情数不符');
  const oldMap = new Map(oldDetails.map((item) => [ruleId(item.skillKey, item.ruleKey), item.data]));
  const expectedIds = [...oldMap.keys(), ...frozen.requests.map((entry) => ruleId(entry.skillKey, entry.ruleKey))].sort();
  const actualIds = finalScan.refs.map((item) => ruleId(item.skillKey, item.ruleKey)).sort();
  assert.deepEqual(actualIds, expectedIds, '最终规则集合不是旧126条加四条新增');
  for (const item of finalScan.details) {
    const id = ruleId(item.skillKey, item.ruleKey);
    if (oldMap.has(id)) assert.equal(equal(item.data, oldMap.get(id)), true, `旧规则详情变化：${id}`);
  }
  for (const entry of frozen.requests) {
    const current = finalScan.details.find((item) => item.skillKey === entry.skillKey && item.ruleKey === entry.ruleKey);
    assertCondition(current, `最终集合缺少 ${entry.id}`);
    assert.equal(equal(normalizeStoredRule(current.data), entry.body), true, `${entry.id} 最终详情不符`);
  }
  report.global = {
    skillCount: finalScan.skillKeys.length,
    ruleCount: finalScan.refs.length,
    sourceInitializedCount: finalScan.eventTypeCounts.SOURCE_INITIALIZED || 0,
    eventTypeCounts: finalScan.eventTypeCounts,
    ruleKeysSha256: shaValue(finalScan.refs),
    priorRulesUnchanged: oldMap.size,
    newRulesMatched: frozen.requests.length,
    targetNonRuleSnapshotsUnchanged: report.targets.length
  };
  report.status = 'PASS';
  report.completedAt = new Date().toISOString();
  report.runtimeValidation = '未执行；本报告证明实库规则与受保护对象回读。';
  save();
  process.stdout.write(JSON.stringify({
    status: report.status,
    getCount: report.getCount,
    businessWrites: report.businessWrites,
    skillCount: report.global.skillCount,
    ruleCount: report.global.ruleCount,
    sourceInitializedCount: report.global.sourceInitializedCount,
    priorRulesUnchanged: report.global.priorRulesUnchanged,
    newRulesMatched: report.global.newRulesMatched
  }, null, 2));
} catch (error) {
  report.status = 'FAILED';
  report.completedAt = new Date().toISOString();
  report.error = { message: error instanceof Error ? error.message : String(error) };
  save();
  throw error;
}
