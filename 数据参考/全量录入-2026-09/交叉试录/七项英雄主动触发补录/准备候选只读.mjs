import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedCurrent, targetConfigs } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；本脚本只发送 GET。');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const shaValue = (value) => sha256(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const fileSha = (filePath) => sha256(fs.readFileSync(filePath));
const writeJson = (filePath, value) => fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
const arrayData = (response, context) => {
  assert.equal(response.status, 200, context + ' 预期200，实际' + response.status);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(context + ' 没有数组结果');
};

let getCount = 0;
const statusCounts = {};
async function get(route) {
  getCount += 1;
  const response = await fetch(baseUrl + route, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000)
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = { parseError: true, responseBytes: Buffer.byteLength(raw) }; }
  }
  statusCounts[response.status] = (statusCounts[response.status] || 0) + 1;
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
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, worker));
  return output;
}

function bodyFor(config) {
  const body = structuredClone(config.body);
  assert.equal(body.ruleKey, config.ruleKey, config.name + ' 规则键不符');
  assert.equal(body.eventSource?.eventType, config.eventType, config.name + ' 事件类型不符');
  assert.deepEqual(body.eventSource?.detail, config.eventDetail, config.name + ' 事件明细不符');
  assert.deepEqual(body.conditionGroups, [], config.name + ' 条件组应为空');
  assert.deepEqual(body.actions, config.actions, config.name + ' 动作与配置不一致');
  assert.equal(body.perTargetCooldown, null, config.name + ' 逐目标冷却必须为空');
  assert.equal(body.maxTriggersPerProcess, null, config.name + ' 每过程次数必须为空');
  return body;
}

const skillsResponse = await get('/skills');
const skills = arrayData(skillsResponse, '技能目录');
assert.equal(skills.length, expectedCurrent.skillCount, '技能数不符');
const skillKeys = skills.map((skill) => skill.skillKey).sort();
assert.equal(new Set(skillKeys).size, skillKeys.length, '技能键重复');
const ruleListResponses = await getMany(skillKeys.map((skillKey) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules'));
const ruleRefs = [];
for (let index = 0; index < skillKeys.length; index += 1) {
  const rules = arrayData(ruleListResponses[index], '规则列表 ' + skillKeys[index]);
  for (const item of rules) ruleRefs.push({ skillKey: skillKeys[index], ruleKey: item.ruleKey });
}
assert.equal(ruleRefs.length, expectedCurrent.ruleCount, '当前规则数不符');
const ruleDetailResponses = await getMany(ruleRefs.map(({ skillKey, ruleKey }) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules/' + encodeURIComponent(ruleKey)));
const sourceInitializedCount = ruleDetailResponses.filter((response) => response.status === 200 && response.data?.eventSource?.eventType === 'SOURCE_INITIALIZED').length;
assert.equal(sourceInitializedCount, expectedCurrent.sourceInitializedCount, '初始化规则数不符');

const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];

const candidates = [];
for (const config of targetConfigs) {
  const body = bodyFor(config);
  const directory = path.resolve(path.dirname(here), config.directoryName);
  fs.mkdirSync(directory, { recursive: true });
  const sourceFiles = config.sourceFiles.map((relativePath) => {
    const absolutePath = path.resolve(repoRoot, relativePath);
    assert.equal(fs.existsSync(absolutePath), true, config.name + ' 来源文件不存在：' + relativePath);
    const raw = fs.readFileSync(absolutePath, 'utf8');
    assert.equal(raw.includes('"' + config.skillKey + '"'), true, config.name + ' 来源文件未包含技能标识');
    return { relativePath, sha256: fileSha(absolutePath), bytes: fs.statSync(absolutePath).size };
  });
  const source = {
    schemaVersion: 2,
    revision: 'rev1',
    status: 'CAPTURED',
    capturedAt: new Date().toISOString(),
    methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
    authorizationValueRecorded: false,
    candidate: {
      id: config.id,
      name: config.name,
      skillKey: config.skillKey,
      ownerKey: config.ownerKey,
      acceptedEvent: config.eventDetail,
      actions: config.actions,
      processCheck: config.processCheck || null,
      effectChecks: config.effectChecks,
      omitted: config.omitted
    },
    sourceFiles
  };
  const sourcePath = path.join(directory, '03-来源快照.json');
  writeJson(sourcePath, source);
  const sourceSnapshotSha256 = fileSha(sourcePath);
  const frozen = {
    schemaVersion: 2,
    planRevision: 1,
    revision: 'rev1',
    status: 'READY',
    generatedAt: new Date().toISOString(),
    plannedWrites: 1,
    sourceSnapshotSha256,
    writeBoundary: { businessWriteCount: 1, methods: ['POST'], noPutPatchDelete: true, noOtherObjectWrites: true },
    writes: [{
      id: config.id,
      method: 'POST',
      route: '/skills/' + config.skillKey + '/trigger-rules',
      detailRoute: '/skills/' + config.skillKey + '/trigger-rules/' + config.ruleKey,
      expectedStatus: 201,
      bodySha256: shaValue(body),
      body
    }],
    excluded: config.omitted
  };
  const frozenPath = path.join(directory, '02-冻结请求.json');
  writeJson(frozenPath, frozen);
  const frozenRequestSha256 = fileSha(frozenPath);

  const skillRoot = '/skills/' + encodeURIComponent(config.skillKey);
  const ownerRoot = '/characters/' + encodeURIComponent(config.ownerKey);
  const fixedRoutes = {
    skill: skillRoot,
    owner: ownerRoot,
    ownerAttributes: ownerRoot + '/attributes',
    ownerRepresentativeImage: ownerRoot + '/representative-image',
    ownerRelations: '/character-skill-relations?characterKey=' + encodeURIComponent(config.ownerKey),
    skillRelations: '/character-skill-relations?skillKey=' + encodeURIComponent(config.skillKey),
    skillRepresentativeImage: skillRoot + '/representative-image',
    candidateRule: skillRoot + '/trigger-rules/' + encodeURIComponent(config.ruleKey)
  };
  const fixedEntries = await Promise.all(Object.entries(fixedRoutes).map(async ([key, route]) => [key, await get(route)]));
  const fixed = Object.fromEntries(fixedEntries);
  for (const [key, response] of Object.entries(fixed)) {
    const expected = key === 'candidateRule' ? 404 : 200;
    assert.equal(response.status, expected, config.name + ' ' + key + ' 状态不符');
  }
  const skillRelationItems = arrayData(fixed.skillRelations, config.name + ' 技能关系');
  assert.equal(skillRelationItems.length, 1, config.name + ' 技能关系数量不为1');
  assert.equal(skillRelationItems[0].characterKey, config.ownerKey, config.name + ' 角色关系不符');

  const components = {};
  for (const [kind, keyName] of componentKinds) {
    const listResponse = await get(skillRoot + '/' + kind);
    const items = arrayData(listResponse, config.name + ' ' + kind);
    const keys = items.map((item) => item[keyName]).sort();
    const detailResponses = await getMany(keys.map((key) => skillRoot + '/' + kind + '/' + encodeURIComponent(key)));
    detailResponses.forEach((response, index) => assert.equal(response.status, 200, config.name + ' ' + kind + '/' + keys[index] + ' 状态不符'));
    components[kind] = { listResponse, keys, details: detailResponses };
  }
  for (const check of config.effectChecks) {
    assert.equal(components.effects.keys.includes(check.effectKey), true, config.name + ' 缺少效果 ' + check.effectKey);
  }
  if (config.processCheck) assert.equal(components.processes.keys.includes(config.processCheck.processKey), true, config.name + ' 缺少过程 ' + config.processCheck.processKey);

  const baseline = {
    schemaVersion: 2,
    revision: 'rev1',
    status: 'CAPTURED',
    capturedAt: new Date().toISOString(),
    requestPolicy: { method: 'GET', authorizationValueRecorded: false, businessWriteIssued: false },
    expectedCurrent,
    observedCurrent: { skillCount: skills.length, ruleCount: ruleRefs.length, sourceInitializedCount },
    sourceSnapshotSha256,
    frozenRequestSha256,
    businessWrites: 0,
    target: { fixed, components }
  };
  writeJson(path.join(directory, '04-写入前现值.json'), baseline);
  const report = {
    schemaVersion: 2,
    revision: 'rev1',
    status: 'PASS',
    completedAt: new Date().toISOString(),
    methodPolicy: 'GET_ONLY',
    authorizationValueRecorded: false,
    businessWrites: 0,
    getSummary: { businessWrites: 0 },
    checks: {
      skillCount: skills.length,
      ruleCount: ruleRefs.length,
      sourceInitializedCount,
      candidateRuleStatus: fixed.candidateRule.status,
      ownerRelationCount: skillRelationItems.length,
      sourceFiles: sourceFiles.length,
      effects: config.effectChecks.length,
      process: config.processCheck?.processKey || null
    }
  };
  writeJson(path.join(directory, '05-只读准备报告.json'), report);
  candidates.push({ id: config.id, directory, sourceSnapshotSha256, frozenRequestSha256, bodySha256: shaValue(body), candidateRuleStatus: fixed.candidateRule.status });
}

process.stdout.write(JSON.stringify({
  status: 'PASS',
  methodPolicy: 'GET_ONLY',
  authorizationValueRecorded: false,
  businessWrites: 0,
  getCount,
  statusCounts,
  observedCurrent: { skillCount: skills.length, ruleCount: ruleRefs.length, sourceInitializedCount },
  candidates
}, null, 2));
