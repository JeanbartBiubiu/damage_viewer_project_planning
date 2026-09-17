import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const batchRoot = path.resolve(here, '..');
const baseUrl = (process.env.DAMAGE_API_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol').replace(/\/+$/, '');
const token = String(process.env.DAMAGE_ENTRY_TOKEN || '').trim();
if (!token) throw new Error('缺少非空 DAMAGE_ENTRY_TOKEN；本脚本只发送 GET。');

const expectedCurrent = { skillCount: 1062, ruleCount: 100, sourceInitializedCount: 24, finalRuleCount: 104 };
const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];
const targetConfigs = [
  { id: 'ashe', name: '艾希 R', ownerKind: 'character', ownerKey: 'champion_ashe', skillKey: 'ashe_r', ruleKey: 'actual_hit', eventType: 'SKILL_HIT', eventDetail: { sourceSkillKey: 'ashe_r' }, effectKey: 'hit_damage', formulaKey: 'hit_damage', resultKey: 'damage', resultTarget: 'TARGET' },
  { id: 'nasus', name: '内瑟斯 E', ownerKind: 'character', ownerKey: 'champion_nasus', skillKey: 'nasus_e', ruleKey: 'actual_initial_hit', eventType: 'SKILL_HIT', eventDetail: { sourceSkillKey: 'nasus_e' }, effectKey: 'initial_damage', formulaKey: 'initial_damage', resultKey: 'damage', resultTarget: 'TARGET' },
  { id: 'rocket', name: '火箭腰带主动', ownerKind: 'equipment', ownerKey: 'item_3152', skillKey: 'item_3152_active', ruleKey: 'actual_hit', eventType: 'SKILL_HIT', eventDetail: { sourceSkillKey: 'item_3152_active' }, effectKey: 'firebolt_hit', formulaKey: 'firebolt_damage', resultKey: 'damage', resultTarget: 'TARGET' },
  { id: 'riven', name: '锐雯 E', ownerKind: 'character', ownerKey: 'champion_riven', skillKey: 'riven_e', ruleKey: 'on_used', eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'riven_e', useKind: 'ACTIVE' }, effectKey: 'shield', formulaKey: 'total_shield', resultKey: 'shield', resultTarget: 'SOURCE' }
];
const targetById = new Map(targetConfigs.map((target) => [target.id, target]));
const upstreamConfigs = [
  { ...targetConfigs[0], directory: path.join(batchRoot, '艾希R触发补录') },
  { ...targetConfigs[1], directory: path.join(batchRoot, '内瑟斯E触发补录') },
  { ...targetConfigs[2], directory: path.join(batchRoot, '火箭腰带主动触发补录') },
  { ...targetConfigs[3], directory: path.join(batchRoot, '锐雯E触发补录') }
];

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
};
const shaValue = (value) => sha256(Buffer.from(JSON.stringify(stable(value)), 'utf8'));
const shaJsonValue = (value) => sha256(Buffer.from(JSON.stringify(value), 'utf8'));
const localPath = (name) => path.join(here, name);
const fileSha = (filePath) => sha256(fs.readFileSync(filePath));
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (name, value) => fs.writeFileSync(localPath(name), JSON.stringify(value, null, 2) + '\n', 'utf8');
const assertCondition = (condition, message) => assert.equal(Boolean(condition), true, message);
const arrayData = (response, context) => {
  assert.equal(response.status, 200, context + ' 预期200，实际' + response.status);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(context + ' 没有数组结果');
};
const sortedUnique = (values, context) => {
  assertCondition(values.every((value) => typeof value === 'string' && value.length > 0), context + ' 存在空键');
  const sorted = [...values].sort();
  assert.equal(new Set(sorted).size, sorted.length, context + ' 存在重复键');
  return sorted;
};
const ruleId = (skillKey, ruleKey) => skillKey + '/' + ruleKey;

function collectActualWriteEvidence(value, pathText = 'root', evidence = []) {
  if (!value || typeof value !== 'object') return evidence;
  if (value.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(value.method).toUpperCase())) evidence.push({ path: pathText, method: value.method, route: value.route || null });
  if (Array.isArray(value)) value.forEach((child, index) => collectActualWriteEvidence(child, pathText + '[' + index + ']', evidence));
  else Object.entries(value).forEach(([key, child]) => {
    if (['plannedWrites', 'plannedPost', 'writeBoundary'].includes(key)) return;
    collectActualWriteEvidence(child, pathText + '.' + key, evidence);
  });
  return evidence;
}

let getCount = 0;
const statusCountsAll = {};
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
  statusCountsAll[response.status] = (statusCountsAll[response.status] || 0) + 1;
  return { method: 'GET', route, status: response.status, data };
}
async function getMany(routes, concurrency = 24) {
  const result = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= routes.length) return;
      result[index] = await get(routes[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, () => worker()));
  return result;
}

function loadUpstream(config) {
  const files = ['02-冻结请求.json', '03-来源快照.json', '04-写入前现值.json', '05-只读准备报告.json'];
  const values = Object.fromEntries(files.map((name) => [name, readJson(path.join(config.directory, name))]));
  assertCondition(['READY', 'READY_FOR_INDEPENDENT_REVIEW'].includes(values['02-冻结请求.json'].status), config.name + ' 上游冻结状态不符');
  assert.equal(values['02-冻结请求.json'].plannedWrites, 1, config.name + ' 上游计划写入数不为1');
  const upstreamWrite = (values['02-冻结请求.json'].writes || []).find((entry) => entry?.body?.ruleKey === config.ruleKey);
  assertCondition(upstreamWrite?.method === 'POST', config.name + ' 上游缺少候选 POST');
  assert.equal(upstreamWrite.route, '/skills/' + config.skillKey + '/trigger-rules', config.name + ' 上游路径不符');
  assert.equal(upstreamWrite.detailRoute, '/skills/' + config.skillKey + '/trigger-rules/' + config.ruleKey, config.name + ' 上游详情路径不符');
  const sourcePath = path.join(config.directory, '03-来源快照.json');
  const frozenPath = path.join(config.directory, '02-冻结请求.json');
  const sourceDigest = values['02-冻结请求.json'].sourceSnapshotSha256;
  const sourceDigestKind = sourceDigest === fileSha(sourcePath)
    ? '文件字节'
    : (sourceDigest === shaJsonValue(values['03-来源快照.json']) ? '紧凑对象' : null);
  assertCondition(sourceDigestKind, config.name + ' 上游来源散列不符');
  assert.equal(values['04-写入前现值.json'].sourceSnapshotSha256, sourceDigest, config.name + ' 上游现值引用的来源散列不符');
  const frozenDigest = values['04-写入前现值.json'].frozenRequestSha256;
  const frozenDigestKind = frozenDigest === fileSha(frozenPath)
    ? '文件字节'
    : (frozenDigest === shaJsonValue(values['02-冻结请求.json']) ? '紧凑对象' : null);
  assertCondition(frozenDigestKind, config.name + ' 上游现值引用的冻结请求散列不符');
  const evidence = ['03-来源快照.json', '04-写入前现值.json', '05-只读准备报告.json']
    .flatMap((name) => collectActualWriteEvidence(values[name], name));
  assert.equal(evidence.length, 0, config.name + ' 上游证据含非GET调用');
  return {
    config,
    frozen: values['02-冻结请求.json'],
    source: values['03-来源快照.json'],
    baseline: values['04-写入前现值.json'],
    report: values['05-只读准备报告.json'],
    digestConventions: { source: sourceDigestKind, frozenRequest: frozenDigestKind },
    files: files.map((name) => ({ name, path: path.join(config.directory, name), sha256: fileSha(path.join(config.directory, name)) }))
  };
}

function canonicalBody(config, loaded) {
  const upstream = loaded.frozen.writes.find((entry) => entry?.body?.ruleKey === config.ruleKey);
  const body = structuredClone(upstream.body);
  body.eventSource = { eventType: config.eventType, detail: structuredClone(config.eventDetail) };
  assert.equal(body.ruleKey, config.ruleKey, config.name + ' 规则键不符');
  assert.deepEqual(body.eventSource.detail, config.eventDetail, config.name + ' 事件明细不符');
  assert.equal(body.perTargetCooldown, null, config.name + ' 逐目标冷却不符');
  assert.equal(body.maxTriggersPerProcess, null, config.name + ' 过程触发次数不符');
  if (config.id === 'riven') {
    body.conditionGroups = [];
  } else {
    assert.equal(Array.isArray(body.conditionGroups), true, config.name + ' 条件组不是数组');
    assert.equal(body.conditionGroups.length, 1, config.name + ' 必须只有一个条件组');
    assert.equal(Array.isArray(body.conditionGroups[0].conditions), true, config.name + ' 条件项不是数组');
    assert.equal(body.conditionGroups[0].conditions.length, 1, config.name + ' 必须只有一个条件');
    const condition = body.conditionGroups[0].conditions[0];
    assert.equal(condition.conditionType, 'TARGET_CATEGORY_CHECK', config.name + ' 条件类型不符');
    assert.deepEqual(condition.detail?.categories, ['CHAMPION'], config.name + ' 类别条件不符');
  }
  const action = (body.actions || []).find((item) => item.actionType === 'EXECUTE_EFFECT' && item.detail?.effectKey === config.effectKey);
  assertCondition(action, config.name + ' 缺少目标效果动作');
  assert.equal(action.targetContext, 'CURRENT_TARGET', config.name + ' 动作目标上下文不符');
  assert.deepEqual(action.runtimeInputBindings, [], config.name + ' 不应有运行时输入绑定');
  assert.deepEqual(action.resultModifiers, [], config.name + ' 不应有结果修正');
  return body;
}

function targetRoutes(config) {
  const skill = '/skills/' + encodeURIComponent(config.skillKey);
  const owner = config.ownerKind === 'equipment' ? '/equipment/' + encodeURIComponent(config.ownerKey) : '/characters/' + encodeURIComponent(config.ownerKey);
  const relationName = config.ownerKind === 'equipment' ? 'equipment-skill-relations' : 'character-skill-relations';
  const ownerQuery = config.ownerKind === 'equipment' ? 'equipmentKey' : 'characterKey';
  return {
    skill,
    static: {
      subject: skill,
      owner,
      ownerAttributes: owner + '/attributes',
      ownerRepresentativeImage: owner + '/representative-image',
      relation: '/' + relationName + '?' + ownerQuery + '=' + encodeURIComponent(config.ownerKey),
      relationFiltered: '/' + relationName + '?skillKey=' + encodeURIComponent(config.skillKey),
      skillRepresentativeImage: skill + '/representative-image'
    }
  };
}

function validateEffect(config, target) {
  const effect = target.components.effects.details.find((item) => item.key === config.effectKey)?.response.data;
  assertCondition(effect, config.name + ' 缺少已有 ' + config.effectKey + ' 效果');
  const result = effect.results?.find((item) => item.resultKey === config.resultKey);
  assertCondition(result, config.name + ' 缺少已有 ' + config.resultKey + ' 结果');
  assert.equal(result.target, config.resultTarget, config.name + ' 结果目标不符');
  assert.equal(result.valueRule?.value?.formulaKey, config.formulaKey, config.name + ' 结果公式不符');
  assertCondition(target.components.formulas.keys.includes(config.formulaKey), config.name + ' 缺少 ' + config.formulaKey + ' 公式');
}

async function readTarget(config) {
  const routes = targetRoutes(config);
  const staticResponses = {};
  for (const [key, route] of Object.entries(routes.static)) {
    staticResponses[key] = await get(route);
    assert.equal(staticResponses[key].status, 200, config.name + ' ' + route + ' 非200');
  }
  const subject = staticResponses.subject.data;
  assert.equal(subject?.skillKey, config.skillKey, config.name + ' 技能主体键不符');
  const owner = staticResponses.owner.data;
  const ownerKeyName = config.ownerKind === 'equipment' ? 'equipmentKey' : 'characterKey';
  assert.equal(owner?.[ownerKeyName], config.ownerKey, config.name + ' 所有者主体键不符');
  const relationRows = arrayData(staticResponses.relation, config.name + ' 全量关系');
  const filteredRows = arrayData(staticResponses.relationFiltered, config.name + ' 反向关系');
  const relationMatch = (item) => item.skillKey === config.skillKey && (item[ownerKeyName] === config.ownerKey);
  assertCondition(relationRows.some(relationMatch), config.name + ' 全量关系缺少目标');
  assertCondition(filteredRows.some(relationMatch), config.name + ' 反向关系缺少目标');
  for (const imageKey of ['ownerRepresentativeImage', 'skillRepresentativeImage']) {
    const image = staticResponses[imageKey].data?.image;
    assertCondition(image?.enabled === true && typeof image.imageKey === 'string' && image.imageKey.length > 0, config.name + ' ' + imageKey + ' 不可用');
  }
  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const listRoute = routes.skill + '/' + apiName;
    const list = await get(listRoute);
    const items = arrayData(list, config.name + ' ' + listRoute);
    const keys = sortedUnique(items.map((item) => item[keyName]), config.name + ' ' + listRoute);
    const details = await getMany(keys.map((key) => listRoute + '/' + encodeURIComponent(key)));
    details.forEach((response, index) => assert.equal(response.status, 200, config.name + ' 组成详情 ' + keys[index] + ' 非200'));
    components[apiName] = { list, items, keys, details: details.map((response, index) => ({ key: keys[index], response })) };
  }
  const candidateRoute = routes.skill + '/trigger-rules/' + encodeURIComponent(config.ruleKey);
  const candidateDetail = await get(candidateRoute);
  assert.equal(candidateDetail.status, 404, config.name + ' 候选详情必须404');
  const target = {
    id: config.id,
    name: config.name,
    ownerKind: config.ownerKind,
    ownerKey: config.ownerKey,
    skillKey: config.skillKey,
    candidateRuleKey: config.ruleKey,
    staticResponses,
    components,
    candidateDetail,
    nonRule: {
      static: Object.fromEntries(Object.entries(staticResponses).map(([key, response]) => [key, response.data])),
      components: Object.fromEntries(componentKinds.filter(([apiName]) => apiName !== 'trigger-rules').map(([apiName]) => [apiName, {
        list: components[apiName].list.data,
        details: components[apiName].details.map(({ key, response }) => ({ key, data: response.data }))
      }]))
    }
  };
  validateEffect(config, target);
  return target;
}

async function scanRules(passName) {
  const skillsResponse = await get('/skills');
  const skills = arrayData(skillsResponse, passName + '全技能目录');
  const skillKeys = sortedUnique(skills.map((skill) => skill.skillKey), passName + '全技能目录');
  if (typeof skillsResponse.data?.total === 'number') assert.equal(skillsResponse.data.total, skills.length, passName + ' 技能total不符');
  const listResponses = await getMany(skillKeys.map((skillKey) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules'));
  const lists = listResponses.map((response, index) => {
    const rules = arrayData(response, passName + ' 规则列表 ' + skillKeys[index]);
    const ruleKeys = sortedUnique(rules.map((rule) => rule.ruleKey), passName + ' 规则列表 ' + skillKeys[index]);
    return { skillKey: skillKeys[index], response, rules, ruleKeys };
  });
  const refs = lists.flatMap(({ skillKey, ruleKeys }) => ruleKeys.map((ruleKey) => ({ skillKey, ruleKey }))).sort((left, right) => ruleId(left.skillKey, left.ruleKey).localeCompare(ruleId(right.skillKey, right.ruleKey)));
  const detailResponses = await getMany(refs.map(({ skillKey, ruleKey }) => '/skills/' + encodeURIComponent(skillKey) + '/trigger-rules/' + encodeURIComponent(ruleKey)));
  detailResponses.forEach((response, index) => assert.equal(response.status, 200, passName + ' 规则详情 ' + ruleId(refs[index].skillKey, refs[index].ruleKey) + ' 非200'));
  const details = detailResponses.map((response, index) => ({ ...refs[index], response }));
  const eventTypeCounts = details.reduce((counts, item) => {
    const eventType = item.response.data?.eventSource?.eventType;
    if (eventType) counts[eventType] = (counts[eventType] || 0) + 1;
    return counts;
  }, {});
  return { passName, skillsResponse, skills, skillKeys, lists, refs, details, ruleCount: refs.length, eventTypeCounts };
}
const comparableScan = (scan) => ({ skillKeys: scan.skillKeys, lists: scan.lists.map(({ skillKey, rules, ruleKeys }) => ({ skillKey, rules, ruleKeys })), details: scan.details.map(({ skillKey, ruleKey, response }) => ({ skillKey, ruleKey, data: response.data })) });
const inventoryOutput = (scan) => ({ passName: scan.passName, skillCount: scan.skillKeys.length, ruleCount: scan.ruleCount, eventTypeCounts: scan.eventTypeCounts, skillKeys: scan.skillKeys, ruleLists: scan.lists.map(({ skillKey, response, rules, ruleKeys }) => ({ skillKey, response, rules, ruleKeys })), ruleDetails: scan.details });

const upstream = upstreamConfigs.map(loadUpstream);
const requests = upstream.map((loaded) => {
  const config = loaded.config;
  const body = canonicalBody(config, loaded);
  return { id: config.id, name: config.name, skillKey: config.skillKey, ownerKey: config.ownerKey, ownerKind: config.ownerKind, ruleKey: config.ruleKey, method: 'POST', route: '/skills/' + config.skillKey + '/trigger-rules', detailRoute: '/skills/' + config.skillKey + '/trigger-rules/' + config.ruleKey, expectedStatus: 201, bodySha256: shaValue(body), body };
});

const source = {
  schemaVersion: 2,
  revision: 'rev2',
  status: 'CAPTURED',
  capturedAt: new Date().toISOString(),
  sourcePolicy: '固定四个上游候选目录的来源记录；准备阶段重新计算文件散列，火箭腰带事件明细按本批冻结语义省略空useKind。',
  methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
  authorizationValueRecorded: false,
  sourceDirectories: upstream.map(({ config, source: upstreamSource, files }) => ({ id: config.id, name: config.name, directory: config.directory, upstreamStatus: 'READY_FOR_INDEPENDENT_REVIEW', files, sourceFiles: upstreamSource.sourceFiles || [], upstreamSourceSnapshot: files.find((file) => file.name === '03-来源快照.json')?.sha256 || null })),
  acceptedFacts: {
    ashe: { eventType: 'SKILL_HIT', eventDetail: { sourceSkillKey: 'ashe_r' }, condition: { conditionType: 'TARGET_CATEGORY_CHECK', categories: ['CHAMPION'] }, targetContext: 'CURRENT_TARGET', effectKey: 'hit_damage' },
    nasus: { eventType: 'SKILL_HIT', eventDetail: { sourceSkillKey: 'nasus_e' }, condition: { conditionType: 'TARGET_CATEGORY_CHECK', categories: ['CHAMPION'] }, targetContext: 'CURRENT_TARGET', effectKey: 'initial_damage' },
    rocket: { eventType: 'SKILL_HIT', eventDetail: { sourceSkillKey: 'item_3152_active' }, condition: { conditionType: 'TARGET_CATEGORY_CHECK', categories: ['CHAMPION'] }, targetContext: 'CURRENT_TARGET', effectKey: 'firebolt_hit' },
    riven: { eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: 'riven_e', useKind: 'ACTIVE' }, condition: null, targetContext: 'CURRENT_TARGET', effectKey: 'shield', existingResultTarget: 'SOURCE' }
  },
  requests: requests.map(({ id, ruleKey, bodySha256 }) => ({ id, ruleKey, bodySha256 }))
};
writeJson('03-来源散列快照.json', source);
const sourceSnapshotSha256 = fileSha(localPath('03-来源散列快照.json'));

const firstTargets = [];
for (const config of targetConfigs) firstTargets.push(await readTarget(config));
const firstScan = await scanRules('第一轮');
assert.equal(firstScan.skillKeys.length, expectedCurrent.skillCount, '第一轮技能数不是1062');
assert.equal(firstScan.ruleCount, expectedCurrent.ruleCount, '第一轮规则数不是100');
assert.equal(firstScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '第一轮 SOURCE_INITIALIZED 不是24');
const secondTargets = [];
for (const config of targetConfigs) secondTargets.push(await readTarget(config));
const secondScan = await scanRules('第二轮');
assert.equal(secondScan.skillKeys.length, expectedCurrent.skillCount, '第二轮技能数不是1062');
assert.equal(secondScan.ruleCount, expectedCurrent.ruleCount, '第二轮规则数不是100');
assert.equal(secondScan.eventTypeCounts.SOURCE_INITIALIZED || 0, expectedCurrent.sourceInitializedCount, '第二轮 SOURCE_INITIALIZED 不是24');
assert.equal(isDeepStrictEqual(stable(comparableScan(firstScan)), stable(comparableScan(secondScan))), true, '两轮全局规则快照不稳定');
assert.equal(isDeepStrictEqual(stable(firstTargets.map((target) => target.nonRule)), stable(secondTargets.map((target) => target.nonRule))), true, '两轮目标非规则组成不稳定');

const observedCurrent = {
  skillCount: firstScan.skillKeys.length,
  ruleCount: firstScan.ruleCount,
  sourceInitializedCount: firstScan.eventTypeCounts.SOURCE_INITIALIZED || 0,
  eventTypeCounts: firstScan.eventTypeCounts,
  stableRead: true,
  stableVerification: {
    stableSkillKeys: isDeepStrictEqual(firstScan.skillKeys, secondScan.skillKeys),
    stableRuleKeys: isDeepStrictEqual(firstScan.refs, secondScan.refs),
    stableRuleLists: isDeepStrictEqual(stable(firstScan.lists.map(({ skillKey, rules, ruleKeys }) => ({ skillKey, rules, ruleKeys }))), stable(secondScan.lists.map(({ skillKey, rules, ruleKeys }) => ({ skillKey, rules, ruleKeys })))),
    stableRuleDetails: isDeepStrictEqual(stable(firstScan.details.map(({ skillKey, ruleKey, response }) => ({ skillKey, ruleKey, data: response.data }))), stable(secondScan.details.map(({ skillKey, ruleKey, response }) => ({ skillKey, ruleKey, data: response.data })))),
    firstRuleKeysSha256: shaValue(firstScan.refs),
    secondRuleKeysSha256: shaValue(secondScan.refs)
  }
};
const targetBefore = firstTargets.map((target) => ({ id: target.id, name: target.name, ownerKind: target.ownerKind, ownerKey: target.ownerKey, skillKey: target.skillKey, candidateRuleKey: target.candidateRuleKey, candidateDetailStatus: target.candidateDetail.status, componentKeys: Object.fromEntries(componentKinds.map(([apiName]) => [apiName, target.components[apiName].keys])), nonRuleSnapshotSha256: shaValue(target.nonRule) }));
const freeze = {
  schemaVersion: 2,
  planRevision: 2,
  revision: 'rev2',
  generatedAt: new Date().toISOString(),
  status: 'READY',
  writable: true,
  gameId: 'lol',
  fixedVersion: '16.17.1',
  methodPolicy: 'GET_ONLY_PRECHECK_THEN_FOUR_POSTS',
  authorizationValueRecorded: false,
  sourceSnapshotSha256,
  expectedCurrent,
  observedCurrent,
  writeBoundary: { businessWriteCount: 4, order: requests.map(({ id, route, detailRoute }) => ({ id, route, detailRoute })), methods: ['POST'], expectedStatus: 201, onlyFrozenRoutes: true, noPutPatchDelete: true, noOtherObjectWrites: true, noRerunExistingRules: true, noReplayIfReportExists: true },
  requests,
  protection: { candidateDetailsMustBe404: requests.map(({ detailRoute }) => detailRoute), targetNonRuleSnapshotSha256: Object.fromEntries(firstTargets.map((target) => [target.id, shaValue(target.nonRule)])), targetSkills: targetConfigs.map(({ skillKey }) => skillKey), existingRuleCount: expectedCurrent.ruleCount, existingRuleDetailsSaved: true, existingRuleListsSaved: true, expectedFinalRuleCount: expectedCurrent.finalRuleCount, expectedNewRuleRefs: requests.map(({ skillKey, ruleKey }) => skillKey + '/' + ruleKey), sourceInitializedCount: expectedCurrent.sourceInitializedCount },
  targetBefore,
  excluded: ['不修改四个目标主体、关系、代表图片、参数、公式、效果、过程或内部状态。', '不修改当前批已存在的旧100条规则；SKILL_HIT事件明细不写入useKind=null。', '不把区域周期、弹道、多目标、距离、冲刺、护盾吸收、施放资格、中断或冷却等未冻结行为自行补造。', '静态来源、GET预检和页面验收不等于战斗运行时、TinyGo或Wasm证明。']
};
writeJson('02-合并冻结请求.json', freeze);
const frozenRequestSha256 = fileSha(localPath('02-合并冻结请求.json'));
const baseline = {
  schemaVersion: 2,
  revision: 'rev2',
  status: 'CAPTURED',
  capturedAt: new Date().toISOString(),
  baseUrl,
  requestPolicy: { method: 'GET', authorizationValueRecorded: false, businessWriteIssued: false, writeMethodsObserved: [] },
  healthProbe: { route: firstScan.skillsResponse.route, status: firstScan.skillsResponse.status, observedSkillCount: firstScan.skillKeys.length },
  sourceSnapshotSha256,
  frozenRequestSha256,
  expectedCurrent,
  observedCurrent,
  stableVerification: observedCurrent.stableVerification,
  getCount,
  statusCounts: statusCountsAll,
  businessWrites: 0,
  targets: firstTargets,
  targetSnapshots: firstTargets,
  globalBaseline: { first: inventoryOutput(firstScan), second: inventoryOutput(secondScan) },
  preservation: { existingRuleCount: firstScan.ruleCount, existingRuleRefs: firstScan.refs, existingRuleLists: firstScan.lists.map(({ skillKey, response, rules, ruleKeys }) => ({ skillKey, response, rules, ruleKeys })), existingRuleDetails: firstScan.details, expectedFinalRuleCount: expectedCurrent.finalRuleCount, expectedNewRuleRefs: requests.map(({ skillKey, ruleKey }) => ({ skillKey, ruleKey })), targetNonRuleSnapshots: Object.fromEntries(firstTargets.map((target) => [target.id, target.nonRule])) }
};
writeJson('04-共享写前现值.json', baseline);
process.stdout.write(JSON.stringify({ status: 'READY', methodPolicy: 'GET_ONLY', businessWrites: 0, getCount, observedCurrent, targetCandidates: targetBefore.map(({ id, skillKey, candidateRuleKey, candidateDetailStatus }) => ({ id, skillKey, ruleKey: candidateRuleKey, candidateDetailStatus })), plannedPosts: requests.map(({ id, route, detailRoute, bodySha256 }) => ({ id, route, detailRoute, bodySha256 })), hashes: { sourceSnapshot: sourceSnapshotSha256, frozenRequest: frozenRequestSha256, sharedBaseline: fileSha(localPath('04-共享写前现值.json')) }, statusCounts: statusCountsAll }, null, 2));
