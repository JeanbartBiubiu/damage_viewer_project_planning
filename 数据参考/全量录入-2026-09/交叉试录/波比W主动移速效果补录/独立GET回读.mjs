import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildEffect, expectedCurrent, target } from './批次配置.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, '07-独立GET回读.json');
if (fs.existsSync(output)) throw new Error('07-独立GET回读.json 已存在，拒绝覆盖。');
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空临时 DAMAGE_ENTRY_TOKEN；令牌不会保存或输出。');

const kinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];
let getCount = 0;
const statusCounts = {};
const stable = value => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : value;
const shaValue = value => crypto.createHash('sha256').update(Buffer.from(JSON.stringify(stable(value)), 'utf8')).digest('hex');
const equal = (left, right) => isDeepStrictEqual(stable(left), stable(right));
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key]]));
const normalizeEffect = value => pick(value, ['effectKey', 'name', 'description', 'sortOrder', 'lifecycle', 'results']);
const ruleId = (skillKey, ruleKey) => skillKey + '/' + ruleKey;

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
  const responses = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= routes.length) return;
      responses[index] = await get(routes[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker()));
  return responses;
}

function arrayData(response, context) {
  assert.equal(response.status, 200, context + ' 预期200，实际' + response.status);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(context + ' 没有数组结果');
}

function sortedUnique(values, context) {
  assert(values.every(value => typeof value === 'string' && value.length > 0), context + ' 存在空键');
  const sorted = [...values].sort();
  assert.equal(new Set(sorted).size, sorted.length, context + ' 存在重复键');
  return sorted;
}

function relationItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

async function scanGlobalRules() {
  const skillsResponse = await get('/skills');
  const skills = arrayData(skillsResponse, '技能目录');
  const skillKeys = sortedUnique(skills.map(item => item.skillKey), '技能目录');
  assert.equal(skillKeys.length, expectedCurrent.skillCount, '技能总数不符');
  const lists = (await getMany(skillKeys.map(key => '/skills/' + encodeURIComponent(key) + '/trigger-rules'))).map((response, index) => {
    const ruleKeys = sortedUnique(arrayData(response, skillKeys[index] + ' 规则列表').map(item => item.ruleKey), skillKeys[index] + ' 规则列表');
    return { skillKey: skillKeys[index], data: response.data, ruleKeys };
  });
  const refs = lists.flatMap(item => item.ruleKeys.map(ruleKey => ({ skillKey: item.skillKey, ruleKey })))
    .sort((left, right) => ruleId(left.skillKey, left.ruleKey).localeCompare(ruleId(right.skillKey, right.ruleKey)));
  assert.equal(refs.length, expectedCurrent.ruleCount, '规则总数不符');
  const details = (await getMany(refs.map(item => '/skills/' + encodeURIComponent(item.skillKey) + '/trigger-rules/' + encodeURIComponent(item.ruleKey))))
    .map((response, index) => {
      assert.equal(response.status, 200, ruleId(refs[index].skillKey, refs[index].ruleKey) + ' 详情非200');
      return { ...refs[index], data: response.data };
    });
  const eventTypeCounts = details.reduce((counts, item) => {
    const key = item.data?.eventSource?.eventType;
    if (key) counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  assert.equal(eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '来源初始化规则数不符');
  return { skills, skillKeys, lists, refs, details, eventTypeCounts };
}

async function readTarget() {
  const skillRoute = '/skills/' + target.skillKey;
  const ownerRoute = '/characters/' + target.ownerKey;
  const staticRoutes = {
    subject: skillRoute,
    owner: ownerRoute,
    ownerAttributes: ownerRoute + '/attributes',
    ownerRepresentativeImage: ownerRoute + '/representative-image',
    relationByOwner: '/character-skill-relations?characterKey=' + target.ownerKey,
    relationBySkill: '/character-skill-relations?skillKey=' + target.skillKey,
    skillRepresentativeImage: skillRoute + '/representative-image',
    moveSpeedAttribute: '/attributes/move_speed_percent',
    flatAddZone: '/modifier-zones/attribute_flat_add',
    analogEffect: '/skills/' + target.analogSkillKey + '/effects/' + target.analogEffectKey
  };
  const staticData = {};
  for (const [key, route] of Object.entries(staticRoutes)) {
    const response = await get(route);
    assert.equal(response.status, 200, route + ' 非200');
    staticData[key] = response.data;
  }
  const matches = item => item.characterKey === target.ownerKey && item.skillKey === target.skillKey;
  assert.equal(staticData.subject.skillKey, target.skillKey);
  assert.equal(staticData.owner.characterKey, target.ownerKey);
  assert(relationItems(staticData.relationByOwner).some(matches), '正向关系缺失');
  assert(relationItems(staticData.relationBySkill).some(matches), '反向关系缺失');
  assert.equal(staticData.ownerRepresentativeImage?.image?.enabled, true);
  assert.equal(staticData.skillRepresentativeImage?.image?.enabled, true);
  const components = {};
  for (const [kind, keyName] of kinds) {
    const route = skillRoute + '/' + kind;
    const list = await get(route);
    const keys = sortedUnique(arrayData(list, kind + ' 列表').map(item => item[keyName]), kind + ' 列表');
    const detailResponses = await getMany(keys.map(key => route + '/' + encodeURIComponent(key)));
    detailResponses.forEach((response, index) => assert.equal(response.status, 200, kind + '/' + keys[index] + ' 非200'));
    components[kind] = { list: list.data, keys, details: detailResponses.map((response, index) => ({ key: keys[index], data: response.data })) };
  }
  const candidate = await get(skillRoute + '/effects/' + target.effectKey);
  assert.equal(candidate.status, 200, '候选效果详情非200');
  return { staticRoutes, static: staticData, components, candidate };
}

const freeze = read('02-冻结请求.json');
const baseline = read('04-写入前现值.json');
const preparation = read('05-只读准备报告.json');
const write = read('06-写入与即时回读.json');
const approvedBatch = String(process.env.DAMAGE_APPROVED_BATCH_SHA256 || '').trim();
const approvedBody = String(process.env.DAMAGE_APPROVED_BODY_SHA256 || '').trim();
assert.equal(approvedBatch, freeze.batchSha256, '独立回读批准批次散列不符');
assert.equal(approvedBody, freeze.request.bodySha256, '独立回读批准正文散列不符');
assert.deepEqual(freeze.request.body, buildEffect(), '冻结正文与配置不符');
assert.equal(preparation.status, 'READY_FOR_MAIN_REVIEW');
assert.equal(preparation.businessWrites, 0);
assert.equal(write.status, 'PASS');
assert.equal(write.postCount, 1);
assert.equal(write.replayedWrites, 0);
assert.equal(write.recoveryReadPerformed, false);

const global = await scanGlobalRules();
const current = await readTarget();
const prior = baseline.global.priorRuleCheckpoint;
assert.equal(shaValue(global.refs), prior.ruleRefsSha256, '全量规则引用相对上一独立检查点变化');
assert.equal(shaValue(global.details), prior.ruleDetailsSha256, '全量规则详情相对上一独立检查点变化');
assert.equal(shaValue(global.skillKeys), baseline.global.skillKeysSha256, '技能目录键集合变化');
assert.equal(equal(current.static, baseline.target.static), true, '目标静态资料或同类效果变化');
for (const kind of ['parameters', 'formulas', 'processes', 'internal-states', 'trigger-rules']) {
  assert.equal(equal(current.components[kind], baseline.target.components[kind]), true, kind + ' 组成变化');
}
const oldEffectBefore = baseline.target.components.effects.details.find(item => item.key === target.existingEffectKey);
const oldEffectAfter = current.components.effects.details.find(item => item.key === target.existingEffectKey);
assert.equal(equal(oldEffectAfter, oldEffectBefore), true, '原法力效果变化');
assert.deepEqual(current.components.effects.keys, [target.effectKey, target.existingEffectKey].sort(), '最终效果键集合不符');
const newEffect = current.components.effects.details.find(item => item.key === target.effectKey)?.data;
assert(newEffect, '最终效果详情缺失');
assert.equal(equal(normalizeEffect(newEffect), freeze.request.body), true, '最终效果与冻结正文不一致');
assert.equal(equal(normalizeEffect(current.candidate.data), freeze.request.body), true, '稳定键回读与冻结正文不一致');

const report = {
  schemaVersion: 1,
  completedAt: new Date().toISOString(),
  status: 'PASS',
  methodPolicy: 'GET_ONLY',
  authorizationValueRecorded: false,
  businessWrites: 0,
  getCount,
  statusCounts,
  differenceCount: 0,
  approvedBatchSha256: approvedBatch,
  frozenBodySha256: approvedBody,
  globalReadback: {
    skillCount: global.skillKeys.length,
    ruleListGetCount: global.skillKeys.length,
    ruleDetailGetCount: global.details.length,
    ruleCount: global.refs.length,
    sourceInitializedCount: global.eventTypeCounts.SOURCE_INITIALIZED || 0,
    eventTypeCounts: global.eventTypeCounts,
    ruleRefsSha256: shaValue(global.refs),
    ruleDetailsSha256: shaValue(global.details),
    matchesPriorIndependentCheckpoint: true
  },
  targetReadback: {
    effectKeys: current.components.effects.keys,
    newEffectNormalizedSha256: shaValue(normalizeEffect(newEffect)),
    newEffectEqualsFrozenBody: true,
    existingEffectUnchanged: true,
    protectedKindsUnchanged: ['parameters', 'formulas', 'processes', 'internal-states', 'trigger-rules'],
    staticAndAnalogUnchanged: true,
    targetSnapshotSha256: shaValue(current)
  },
  boundary: '独立GET回读证明1062个技能、131条规则、24条来源初始化规则与上一检查点一致，并证明波比新效果及受保护组成；不证明页面、Wasm、宿主事件或真实战斗。'
};
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
process.stdout.write(JSON.stringify({ status: report.status, getCount, skillCount: report.globalReadback.skillCount, ruleCount: report.globalReadback.ruleCount, sourceInitializedCount: report.globalReadback.sourceInitializedCount, effectKeys: report.targetReadback.effectKeys, businessWrites: 0 }, null, 2));
