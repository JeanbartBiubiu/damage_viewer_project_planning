import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；独立回读不会保存或输出令牌。');
const reportPath = path.join(here, '07-独立GET回读.json');
if (fs.existsSync(reportPath)) throw new Error('已存在 07-独立GET回读.json，拒绝覆盖。');

const frozen = JSON.parse(fs.readFileSync(path.join(here, '02-合并冻结请求.json'), 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(here, '04-共享写前现值.json'), 'utf8'));
const expectedCurrent = { skillCount: 1062, ruleCount: 96, sourceInitializedCount: 24, finalRuleCount: 100 };
const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];
const targetConfigs = [
  { id: 'black', name: '黑色切割者', skillKey: 'item_3071_passive', ownerKey: 'item_3071', ownerKind: 'equipment', ruleKey: 'on_physical_damage_dealt_to_champion', effectKey: 'armor_shred' },
  { id: 'magic', name: '魔切', skillKey: 'item_3042_passive', ownerKey: 'item_3042', ownerKind: 'equipment', ruleKey: 'on_basic_attack_hit_to_champion', effectKey: 'on_hit_damage_from_max_mana' },
  { id: 'stridebreaker', name: '挺进破坏者', skillKey: 'item_6631_active', ownerKey: 'item_6631', ownerKind: 'equipment', ruleKey: 'actual_hit', effectKey: 'active_hit' },
  { id: 'triumph', name: '凯旋', skillKey: 'rune_9111_passive', ownerKey: 'rune_9111', ownerKind: 'rune', ruleKey: 'on_champion_kill', effectKey: 'triumph_heal' }
];
const targetById = new Map(targetConfigs.map((target) => [target.id, target]));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
};
const shaValue = (value) => sha256(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const fileSha = (name) => sha256(fs.readFileSync(path.join(here, name)));
const equal = (actual, expected) => isDeepStrictEqual(stable(actual), stable(expected));
const subsetEqual = (actual, expected) => {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length >= expected.length && expected.every((value, index) => subsetEqual(actual[index], value));
  if (expected && typeof expected === 'object') return Boolean(actual && typeof actual === 'object' && !Array.isArray(actual)) && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && subsetEqual(actual[key], value));
  return Object.is(actual, expected);
};
const ruleId = (skillKey, ruleKey) => skillKey + '/' + ruleKey;
const report = {
  schemaVersion: 2,
  revision: 'rev2',
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  methodPolicy: 'GET_ONLY',
  authorizationValueRecorded: false,
  businessWrites: 0,
  getCount: 0,
  methods: { GET: 0 },
  targets: [],
  global: null,
  error: null
};
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

function requireStatus(response, expected, context) {
  assert.equal(response.status, expected, context + ' 预期 ' + expected + '，实际 ' + response.status);
  return response;
}

function arrayData(response, context) {
  requireStatus(response, 200, context);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(context + ' 没有数组结果');
}

function sortedUnique(values, context) {
  assert.equal(values.every((value) => typeof value === 'string' && value.length > 0), true, context + ' 存在空键');
  const sorted = [...values].sort();
  assert.equal(new Set(sorted).size, sorted.length, context + ' 存在重复键');
  return sorted;
}

async function get(route) {
  report.getCount += 1;
  report.methods.GET += 1;
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
  return { method: 'GET', route, status: response.status, data };
}

async function getMany(routes, concurrency = 24) {
  const results = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= routes.length) return;
      results[index] = await get(routes[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker()));
  return results;
}

async function readTarget(config) {
  const skill = '/skills/' + encodeURIComponent(config.skillKey);
  const owner = config.ownerKind === 'equipment'
    ? '/equipment/' + encodeURIComponent(config.ownerKey)
    : '/runes/' + encodeURIComponent(config.ownerKey);
  const relation = config.ownerKind === 'equipment'
    ? '/equipment-skill-relations?equipmentKey=' + encodeURIComponent(config.ownerKey)
    : '/rune-skill-relations?runeKey=' + encodeURIComponent(config.ownerKey);
  const staticRoutes = {
    subject: skill,
    owner,
    relation,
    relationFiltered: relation + '&skillKey=' + encodeURIComponent(config.skillKey),
    skillRepresentativeImage: skill + '/representative-image'
  };
  if (config.ownerKind === 'equipment') staticRoutes.ownerRepresentativeImage = owner + '/representative-image';
  const staticResponses = {};
  for (const [key, route] of Object.entries(staticRoutes)) {
    staticResponses[key] = await get(route);
    requireStatus(staticResponses[key], 200, config.name + ' ' + route);
  }
  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const listRoute = skill + '/' + apiName;
    const list = await get(listRoute);
    const items = arrayData(list, config.name + ' ' + listRoute);
    const keys = sortedUnique(items.map((item) => item[keyName]), config.name + ' ' + listRoute);
    const details = await getMany(keys.map((key) => listRoute + '/' + encodeURIComponent(key)));
    details.forEach((response, index) => requireStatus(response, 200, config.name + ' 组成详情 ' + keys[index]));
    components[apiName] = { list, items, keys, details: details.map((response, index) => ({ key: keys[index], response })) };
  }
  const candidateRoute = skill + '/trigger-rules/' + encodeURIComponent(config.ruleKey);
  const candidateDetail = await get(candidateRoute);
  requireStatus(candidateDetail, 200, config.name + ' 新规则详情');
  const relationItems = staticResponses.relation.data?.items || [];
  const filteredItems = staticResponses.relationFiltered.data?.items || [];
  const relationMatch = (item) => item.skillKey === config.skillKey && (item.equipmentKey === config.ownerKey || item.runeKey === config.ownerKey);
  assert.equal(relationItems.some(relationMatch), true, config.name + ' 全量关系缺少目标');
  assert.equal(filteredItems.some(relationMatch), true, config.name + ' 过滤关系缺少目标');
  assert.equal(staticResponses.skillRepresentativeImage.data?.image?.imageKey, config.ownerKey, config.name + ' 技能代表图键不符');
  if (config.ownerKind === 'equipment') assert.equal(staticResponses.ownerRepresentativeImage.data?.image?.imageKey, config.ownerKey, config.name + ' 装备代表图键不符');
  const effect = components.effects.details.find(({ key }) => key === config.effectKey)?.response.data;
  assert.equal(Boolean(effect), true, config.name + ' 效果缺失');
  const targetResultKey = config.id === 'black' ? 'armor_reduction' : config.id === 'triumph' ? 'result' : 'damage';
  const result = effect.results?.find((item) => item.resultKey === targetResultKey);
  assert.equal(Boolean(result), true, config.name + ' 结果缺失');
  assert.equal(result.target, config.id === 'triumph' ? 'SOURCE' : 'TARGET', config.name + ' 结果 target 不符');
  return {
    id: config.id,
    skillKey: config.skillKey,
    ownerKey: config.ownerKey,
    candidateRuleKey: config.ruleKey,
    staticResponses,
    components,
    candidateDetail,
    nonRule: {
      static: Object.fromEntries(Object.entries(staticResponses).map(([key, response]) => [key, response.data])),
      components: Object.fromEntries(
        componentKinds.filter(([apiName]) => apiName !== 'trigger-rules').map(([apiName]) => [apiName, {
          list: components[apiName].list.data,
          details: components[apiName].details.map(({ key, response }) => ({ key, data: response.data }))
        }])
      )
    }
  };
}

async function scanRules() {
  const skillsResponse = await get('/skills');
  const skills = arrayData(skillsResponse, '最终全技能目录');
  const skillKeys = sortedUnique(skills.map((skill) => skill.skillKey), '最终全技能目录');
  assert.equal(skillKeys.length, expectedCurrent.skillCount, '最终技能数不是 1062');
  const listResponses = await getMany(skillKeys.map((skillKey) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules'));
  const lists = listResponses.map((response, index) => {
    const skillKey = skillKeys[index];
    const rules = arrayData(response, '最终规则列表 ' + skillKey);
    const ruleKeys = sortedUnique(rules.map((rule) => rule.ruleKey), '最终规则列表 ' + skillKey);
    return { skillKey, response, rules, ruleKeys };
  });
  const refs = lists.flatMap(({ skillKey, ruleKeys }) => ruleKeys.map((ruleKey) => ({ skillKey, ruleKey }))).sort((left, right) => ruleId(left.skillKey, left.ruleKey).localeCompare(ruleId(right.skillKey, right.ruleKey)));
  const detailResponses = await getMany(refs.map(({ skillKey, ruleKey }) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules/' + encodeURIComponent(ruleKey)));
  detailResponses.forEach((response, index) => requireStatus(response, 200, '最终规则详情 ' + ruleId(refs[index].skillKey, refs[index].ruleKey)));
  const details = detailResponses.map((response, index) => ({ ...refs[index], response }));
  const eventTypeCounts = details.reduce((counts, item) => {
    const eventType = item.response.data?.eventSource?.eventType;
    if (eventType) counts[eventType] = (counts[eventType] || 0) + 1;
    return counts;
  }, {});
  return { skillsResponse, skillKeys, lists, refs, details, eventTypeCounts, ruleCount: refs.length };
}

function oldRuleDetails() {
  return baseline.preservation?.existingRuleDetails || baseline.globalBaseline?.first?.ruleDetails || [];
}

function oldRuleLists() {
  return baseline.preservation?.existingRuleLists || baseline.globalBaseline?.first?.ruleLists || [];
}

function compareOld(scan) {
  const oldDetails = oldRuleDetails();
  const oldMap = new Map(oldDetails.map((item) => [ruleId(item.skillKey, item.ruleKey), item.response?.data]));
  const actualOldIds = scan.refs.map((item) => ruleId(item.skillKey, item.ruleKey)).filter((id) => oldMap.has(id)).sort();
  assert.deepEqual(actualOldIds, [...oldMap.keys()].sort(), '旧 96 条规则键集合变化');
  for (const item of scan.details) {
    const id = ruleId(item.skillKey, item.ruleKey);
    if (oldMap.has(id)) assert.equal(equal(item.response.data, oldMap.get(id)), true, '旧规则详情变化：' + id);
  }
  const expectedBySkill = new Map(oldRuleLists().map((item) => [item.skillKey, item]));
  for (const list of scan.lists) {
    const expected = expectedBySkill.get(list.skillKey);
    assert.equal(Boolean(expected), true, '旧规则列表缺少技能：' + list.skillKey);
    const currentOld = list.rules.filter((item) => oldMap.has(ruleId(list.skillKey, item.ruleKey)));
    const expectedOld = expected.rules.filter((item) => oldMap.has(ruleId(expected.skillKey, item.ruleKey)));
    assert.equal(equal(currentOld, expectedOld), true, '旧规则列表摘要变化：' + list.skillKey);
  }
}

try {
  assert.equal(frozen.revision, 'rev2', '冻结请求不是 rev2');
  assert.equal(frozen.requests?.length, 4, '冻结请求不是四项');
  assert.equal(baseline.revision, 'rev2', '写前现值不是 rev2');
  assert.equal(baseline.sourceSnapshotSha256, fileSha('03-来源散列快照.json'), '来源快照散列不符');
  assert.equal(baseline.frozenRequestSha256, fileSha('02-合并冻结请求.json'), '冻结请求散列不符');
  assert.equal(oldRuleDetails().length, expectedCurrent.ruleCount, '写前未保存旧 96 条详情');
  const targets = [];
  for (const target of targetConfigs) targets.push(await readTarget(target));
  for (const target of targets) {
    const expected = baseline.preservation?.targetNonRuleSnapshots?.[target.id];
    assert.equal(Boolean(expected), true, '缺少目标非规则基线：' + target.id);
    assert.equal(equal(target.nonRule, expected), true, '目标非规则组成变化：' + target.id);
    const frozenEntry = frozen.requests.find((entry) => entry.id === target.id);
    assert.equal(subsetEqual(target.candidateDetail.data, frozenEntry.body), true, '新增规则详情与冻结请求不符：' + target.id);
    report.targets.push({
      id: target.id,
      skillKey: target.skillKey,
      candidateDetailStatus: target.candidateDetail.status,
      candidateBodySha256: shaValue(target.candidateDetail.data),
      nonRuleSnapshotSha256: shaValue(target.nonRule),
      representativeImageKeys: {
        skill: target.staticResponses.skillRepresentativeImage.data?.image?.imageKey,
        owner: target.staticResponses.ownerRepresentativeImage?.data?.image?.imageKey || null
      }
    });
  }
  const finalScan = await scanRules();
  assert.equal(finalScan.ruleCount, expectedCurrent.finalRuleCount, '最终规则总数不是 100');
  assert.equal(finalScan.details.length, expectedCurrent.finalRuleCount, '最终规则详情数不是 100');
  assert.equal(finalScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '最终 SOURCE_INITIALIZED 不是 24');
  const oldMap = new Map(oldRuleDetails().map((item) => [ruleId(item.skillKey, item.ruleKey), item.response?.data]));
  const newIds = frozen.requests.map((entry) => entry.skillKey + '/' + entry.ruleKey);
  const expectedIds = [...oldMap.keys(), ...newIds].sort();
  const actualIds = finalScan.refs.map((item) => ruleId(item.skillKey, item.ruleKey)).sort();
  assert.deepEqual(actualIds, expectedIds, '最终规则集合不是旧 96 条加四条新规则');
  compareOld(finalScan);
  for (const entry of frozen.requests) {
    const actual = finalScan.details.find((item) => item.skillKey === entry.skillKey && item.ruleKey === entry.ruleKey);
    assert.equal(Boolean(actual), true, '缺少新增规则：' + entry.id);
    assert.equal(subsetEqual(actual.response.data, entry.body), true, '新增规则最终详情不符：' + entry.id);
  }
  report.global = {
    skillCount: finalScan.skillKeys.length,
    ruleCount: finalScan.ruleCount,
    sourceInitializedCount: finalScan.eventTypeCounts.SOURCE_INITIALIZED || 0,
    eventTypeCounts: finalScan.eventTypeCounts,
    ruleKeysSha256: shaValue(finalScan.refs),
    oldRuleDetailsExact: true,
    oldRuleListsExact: true,
    newRulesExact: true
  };
  report.status = 'PASS';
  report.completedAt = new Date().toISOString();
  save();
  process.stdout.write(JSON.stringify({
    status: report.status,
    revision: report.revision,
    getCount: report.getCount,
    methods: report.methods,
    businessWrites: report.businessWrites,
    skillCount: report.global.skillCount,
    ruleCount: report.global.ruleCount,
    sourceInitializedCount: report.global.sourceInitializedCount
  }, null, 2));
} catch (error) {
  report.status = 'FAILED';
  report.completedAt = new Date().toISOString();
  report.error = { message: error instanceof Error ? error.message : String(error) };
  save();
  throw error;
}
