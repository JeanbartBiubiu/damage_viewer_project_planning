import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const planning = 'C:/project/damage_viewer_project_planning';
const baseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token || !token.trim()) throw new Error('缺少 DAMAGE_ENTRY_TOKEN；本脚本只发送 GET，令牌不会保存。');

const target = {
  kind: 'equipment',
  ownerKey: 'item_3152',
  ownerName: '海克斯科技火箭腰带',
  skillKey: 'item_3152_active',
  skillName: '海克斯科技火箭腰带·超音速',
  ruleKey: 'actual_hit'
};
const expectedCurrent = { skillCount: 1062, ruleCount: 96, sourceInitializedCount: 24 };
const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];
const sourcePaths = [
  {
    kind: '规划候选',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '装备技能实录', '第十五批伤害装备', '完整候选.json')
  },
  {
    kind: '客户端装备原始资料',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '装备效果补证', '客户端原始资料', 'items-16.17.cdtb.bin.json.gz')
  },
  {
    kind: '客户端中文文本原始资料',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '装备效果补证', '客户端原始资料', 'lol-16.17-zh_CN.stringtable.json.gz')
  },
  {
    kind: '官方装备原始资料',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '装备符文', '官方原始资料', 'item-16.17.1-zh_CN.json')
  },
  {
    kind: '已有装备接口记录',
    path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '装备', 'item_3152.json')
  },
  {
    kind: '已有装备图片接口记录',
    path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '装备图片', 'item_3152.json')
  },
  {
    kind: '已有装备图片文件',
    path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '装备图片', 'source-images', '3152.png')
  }
];

const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(Buffer.from(JSON.stringify(value), 'utf8'));
const localPath = name => path.join(here, name);
const fileSha = filePath => shaBytes(fs.readFileSync(filePath));
const fileDigest = name => fileSha(localPath(name));
const writeJson = (name, value) => fs.writeFileSync(localPath(name), JSON.stringify(value, null, 2) + '\n');
const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readGzipJson = filePath => JSON.parse(gunzipSync(fs.readFileSync(filePath)));

function sourceRecord(source) {
  assert(fs.existsSync(source.path), '来源文件不存在：' + source.path);
  const bytes = fs.readFileSync(source.path);
  const record = { kind: source.kind, path: source.path, byteSize: bytes.byteLength, sha256: shaBytes(bytes) };
  if (source.path.toLowerCase().endsWith('.gz')) {
    const raw = gunzipSync(bytes);
    record.decompressedByteSize = raw.byteLength;
    record.decompressedSha256 = shaBytes(raw);
  }
  return record;
}

const sourceRecords = sourcePaths.map(sourceRecord);
const candidateRoot = readJson(sourcePaths[0].path);
const candidateObject = candidateRoot.objects?.find(item => item.equipmentKey === target.ownerKey);
const clientRoot = readGzipJson(sourcePaths[1].path);
const clientItem = clientRoot['Items/3152'];
const clientValues = Object.fromEntries((clientItem?.mDataValues || []).map(item => [item.mName, item.mValue]));
const clientFirebolt = clientItem?.mItemCalculations?.FireboltDamage || null;
const stringtable = readGzipJson(sourcePaths[2].path);
const stringEntries = stringtable.entries || {};
const officialRoot = readJson(sourcePaths[3].path);
const officialItem = officialRoot.data?.['3152'] || null;
const sourceChecks = {
  candidateObjectPresent: Boolean(candidateObject),
  candidateSkillKey: candidateObject?.skillKey === target.skillKey,
  candidateHadNoTriggerRule: Array.isArray(candidateObject?.apiPayload?.triggerRules) && candidateObject.apiPayload.triggerRules.length === 0,
  clientItemPresent: Boolean(clientItem),
  clientBaseDamage: clientValues.BaseDamage === 100,
  clientApRatio: Number.isFinite(clientValues.APRatio) && Math.abs(clientValues.APRatio - 0.1) < 0.000001,
  clientCooldown: clientValues.Cooldown === 50,
  clientCalculationPresent: Boolean(clientFirebolt),
  stringtableActivePresent: typeof stringEntries.item_3152_active === 'string',
  stringtableTerrainRulePresent: typeof stringEntries.item_3152_tooltipextendedrules === 'string',
  officialItemPresent: Boolean(officialItem),
  officialName: officialItem?.name === target.ownerName
};
const sourceSnapshot = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  sourcePolicy: '固定客户端16.17与官方16.17.1；只读取规划来源，不用外部最新资料覆盖。',
  methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
  authorizationValueRecorded: false,
  sourceFiles: sourceRecords,
  candidate: {
    path: sourcePaths[0].path,
    equipmentKey: candidateObject?.equipmentKey || null,
    equipmentName: candidateObject?.equipmentName || null,
    skillKey: candidateObject?.skillKey || null,
    apiPayload: candidateObject?.apiPayload || null,
    pendingRules: candidateObject?.pendingRules || []
  },
  clientExtraction: {
    path: sourcePaths[1].path,
    pointer: 'Items/3152',
    dataValues: {
      APRatio: clientValues.APRatio ?? null,
      BaseDamage: clientValues.BaseDamage ?? null,
      Cooldown: clientValues.Cooldown ?? null
    },
    fireboltDamage: clientFirebolt
  },
  clientStringtableExtraction: {
    path: sourcePaths[2].path,
    pointer: 'entries/item_3152_active、entries/item_3152_tooltipextendedrules',
    entries: {
      item_3152_active: stringEntries.item_3152_active || null,
      item_3152_tooltipextendedrules: stringEntries.item_3152_tooltipextendedrules || null,
      generatedtip_item_3152_description: stringEntries.generatedtip_item_3152_description || null
    }
  },
  official: {
    path: sourcePaths[3].path,
    itemKey: '3152',
    item: officialItem
  },
  acceptedFacts: {
    trigger: {
      skillKey: target.skillKey,
      ruleKey: target.ruleKey,
      eventType: 'SKILL_HIT',
      eventDetail: { sourceSkillKey: target.skillKey, useKind: null },
      targetCategory: 'CHAMPION',
      targetContext: 'CURRENT_TARGET',
      actionType: 'EXECUTE_EFFECT',
      effectKey: 'firebolt_hit'
    },
    boundary: [
      '只接收已确认的实际火箭命中，不由规则生成冲刺、弹道或命中。',
      '不表达同次施放只命中一次、多颗魔法弹、穿墙、法术护盾或主动冷却。',
      '只复用当前实库已有 firebolt_hit，不新增参数、公式或效果。'
    ]
  },
  sourceChecks
};
writeJson('03-来源快照.json', sourceSnapshot);

let getCount = 0;
const statusCounts = {};
const authMode = 'ENVIRONMENT_TOKEN_PRESENT';
async function get(route) {
  getCount += 1;
  const response = await fetch(baseUrl + route, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { parseError: true, responseBytes: Buffer.byteLength(text) }; }
  statusCounts[response.status] = (statusCounts[response.status] || 0) + 1;
  return { method: 'GET', route, status: response.status, data };
}
async function getMany(routes, concurrency = 32) {
  const results = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= routes.length) return;
      results[index] = await get(routes[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, routes.length || 1) }, worker));
  return results;
}
function requireStatus(response, expected, label) {
  assert.equal(response.status, expected, label + ' 预期 ' + expected + '，实际 ' + response.status);
  return response;
}
function arrayData(response, label) {
  requireStatus(response, 200, label);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(label + ' 没有数组结果');
}
function checkKeys(items, keyName, label) {
  const keys = items.map(item => item[keyName]);
  assert.equal(keys.every(key => typeof key === 'string' && key.length > 0), true, label + ' 存在空键');
  assert.equal(new Set(keys).size, keys.length, label + ' 存在重复键');
  return keys;
}
async function readComponents() {
  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const listRoute = '/skills/' + encodeURIComponent(target.skillKey) + '/' + apiName;
    const listResponse = await get(listRoute);
    const items = arrayData(listResponse, listRoute);
    const keys = checkKeys(items, keyName, listRoute);
    const detailRoutes = keys.map(key => listRoute + '/' + encodeURIComponent(key));
    const detailResponses = await getMany(detailRoutes);
    detailResponses.forEach((response, index) => requireStatus(response, 200, detailRoutes[index]));
    components[apiName] = {
      list: listResponse,
      keys: keys.slice().sort(),
      details: detailResponses.map((response, index) => ({ key: keys[index], response }))
    };
  }
  return components;
}
async function readTarget() {
  const staticRoutes = [
    '/equipment/' + target.ownerKey,
    '/equipment/' + target.ownerKey + '/attributes',
    '/equipment/' + target.ownerKey + '/representative-image',
    '/equipment-skill-relations?equipmentKey=' + target.ownerKey,
    '/equipment-skill-relations?skillKey=' + target.skillKey,
    '/skills/' + target.skillKey,
    '/skills/' + target.skillKey + '/representative-image'
  ];
  const staticResponses = {};
  for (const route of staticRoutes) staticResponses[route] = requireStatus(await get(route), 200, route);
  const components = await readComponents();
  const candidateDetailRoute = '/skills/' + target.skillKey + '/trigger-rules/' + target.ruleKey;
  const candidateDetail = await get(candidateDetailRoute);
  const relationForward = arrayData(staticResponses['/equipment-skill-relations?equipmentKey=' + target.ownerKey], '装备正向关系');
  const relationReverse = arrayData(staticResponses['/equipment-skill-relations?skillKey=' + target.skillKey], '装备反向关系');
  const triggerKeys = components['trigger-rules'].keys;
  const image = staticResponses['/skills/' + target.skillKey + '/representative-image'].data?.image;
  const ownerImage = staticResponses['/equipment/' + target.ownerKey + '/representative-image'].data?.image;
  return {
    staticResponses,
    components,
    candidateDetail,
    relationForward,
    relationReverse,
    checks: {
      relationForwardExact: relationForward.length === 1 && relationForward[0].equipmentKey === target.ownerKey && relationForward[0].skillKey === target.skillKey,
      relationReverseExact: relationReverse.length === 1 && relationReverse[0].equipmentKey === target.ownerKey && relationReverse[0].skillKey === target.skillKey,
      skillImagePresent: image?.enabled === true && image?.imageKey,
      ownerImagePresent: ownerImage?.enabled === true && ownerImage?.imageKey,
      triggerListEmpty: triggerKeys.length === 0,
      candidateDetail404: candidateDetail.status === 404
    }
  };
}
async function readCatalog(listRoute, keyName, label) {
  const listResponse = await get(listRoute);
  const items = arrayData(listResponse, label + '列表');
  const keys = checkKeys(items, keyName, label + '列表');
  const detailRoutes = keys.map(key => listRoute + '/' + encodeURIComponent(key));
  const detailResponses = await getMany(detailRoutes);
  detailResponses.forEach((response, index) => requireStatus(response, 200, detailRoutes[index]));
  return { list: listResponse, keys: keys.slice().sort(), details: detailResponses.map((response, index) => ({ key: keys[index], response })) };
}
function sameList(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }
function sortRefs(refs) { return refs.slice().sort((a, b) => a.skillKey.localeCompare(b.skillKey) || a.ruleKey.localeCompare(b.ruleKey)); }
async function scanRules() {
  const skillsResponse = await get('/skills');
  const skills = arrayData(skillsResponse, '全技能目录');
  const skillKeys = checkKeys(skills, 'skillKey', '全技能目录').slice().sort();
  const listResponses = await getMany(skillKeys.map(key => '/skills/' + encodeURIComponent(key) + '/trigger-rules'));
  const lists = listResponses.map((response, index) => {
    const route = '/skills/' + encodeURIComponent(skillKeys[index]) + '/trigger-rules';
    const rules = arrayData(response, route);
    const ruleKeys = checkKeys(rules, 'ruleKey', route).slice().sort();
    return { skillKey: skillKeys[index], response, rules, ruleKeys };
  });
  const refs = sortRefs(lists.flatMap(item => item.ruleKeys.map(ruleKey => ({ skillKey: item.skillKey, ruleKey }))));
  const detailRoutes = refs.map(ref => '/skills/' + encodeURIComponent(ref.skillKey) + '/trigger-rules/' + encodeURIComponent(ref.ruleKey));
  const detailResponses = await getMany(detailRoutes);
  detailResponses.forEach((response, index) => requireStatus(response, 200, detailRoutes[index]));
  return { skillsResponse, skills, skillKeys, lists, refs, details: detailResponses.map((response, index) => ({ ...refs[index], response })) };
}
function eventCounts(details) {
  return Object.fromEntries(Object.entries(details.reduce((out, item) => {
    const type = item.response.data?.eventSource?.eventType || 'UNKNOWN';
    out[type] = (out[type] || 0) + 1;
    return out;
  }, {})).sort(([a], [b]) => a.localeCompare(b)));
}
function conditionCounts(details) {
  return Object.fromEntries(Object.entries(details.reduce((out, item) => {
    for (const group of item.response.data?.conditionGroups || []) for (const condition of group.conditions || []) {
      const type = condition.conditionType || 'UNKNOWN';
      out[type] = (out[type] || 0) + 1;
    }
    return out;
  }, {})).sort(([a], [b]) => a.localeCompare(b)));
}
function componentDetail(targetSnapshot, apiName, key) {
  return targetSnapshot.components[apiName].details.find(item => item.key === key)?.response.data || null;
}

const targetSnapshot = await readTarget();
const attributes = await readCatalog('/attributes', 'attributeKey', '属性');
const modifierZones = await readCatalog('/modifier-zones', 'modifierZoneKey', '修正区域');
const damageTypes = await readCatalog('/damage-types', 'damageTypeKey', '伤害类型');
const firstScan = await scanRules();
const secondScan = await scanRules();
const firstRuleKeys = firstScan.refs.map(ref => ref.skillKey + '/' + ref.ruleKey);
const secondRuleKeys = secondScan.refs.map(ref => ref.skillKey + '/' + ref.ruleKey);
const firstDetailMap = new Map(firstScan.details.map(item => [item.skillKey + '/' + item.ruleKey, item.response.data]));
const secondDetailMap = new Map(secondScan.details.map(item => [item.skillKey + '/' + item.ruleKey, item.response.data]));
const stableRead = {
  stableSkillKeys: sameList(firstScan.skillKeys, secondScan.skillKeys),
  stableRuleKeys: sameList(firstRuleKeys, secondRuleKeys),
  stableRuleCount: firstRuleKeys.length === secondRuleKeys.length,
  stableRuleDetails: firstRuleKeys.every(key => isDeepStrictEqual(firstDetailMap.get(key), secondDetailMap.get(key))),
  firstSkillCount: firstScan.skillKeys.length,
  secondSkillCount: secondScan.skillKeys.length,
  firstRuleCount: firstRuleKeys.length,
  secondRuleCount: secondRuleKeys.length,
  firstRuleKeysSha256: shaValue(firstRuleKeys),
  secondRuleKeysSha256: shaValue(secondRuleKeys),
  firstRuleDetailHashes: Object.fromEntries(firstRuleKeys.map(key => [key, shaValue(firstDetailMap.get(key))])),
  secondRuleDetailHashes: Object.fromEntries(secondRuleKeys.map(key => [key, shaValue(secondDetailMap.get(key))]))
};
const sourceInitializedCount = firstScan.details.filter(item => item.response.data?.eventSource?.eventType === 'SOURCE_INITIALIZED').length;
const firebolt = componentDetail(targetSnapshot, 'effects', 'firebolt_hit');
const fireboltResult = firebolt?.results?.[0];
const liveChecks = {
  skillCount: firstScan.skillKeys.length === expectedCurrent.skillCount,
  ruleCount: firstScan.refs.length === expectedCurrent.ruleCount,
  sourceInitializedCount: sourceInitializedCount === expectedCurrent.sourceInitializedCount,
  stableRead: Object.values(stableRead).slice(0, 4).every(Boolean),
  targetRelations: targetSnapshot.checks.relationForwardExact && targetSnapshot.checks.relationReverseExact,
  targetImages: Boolean(targetSnapshot.checks.skillImagePresent && targetSnapshot.checks.ownerImagePresent),
  targetTriggerEmpty: targetSnapshot.checks.triggerListEmpty,
  candidate404: targetSnapshot.checks.candidateDetail404,
  fireboltPresent: Boolean(firebolt),
  fireboltDamageResult: fireboltResult?.resultType === 'DAMAGE' && fireboltResult.target === 'TARGET' && fireboltResult.detail?.damageTypeKey === 'magic',
  fireboltFormula: fireboltResult?.valueRule?.value?.kind === 'FORMULA' && fireboltResult.valueRule.value.formulaKey === 'firebolt_damage',
  physicsCatalogPresent: damageTypes.keys.includes('magic'),
  sourceChecks: Object.values(sourceChecks).every(Boolean)
};
const ruleBody = {
  ruleKey: target.ruleKey,
  name: '超音速实际命中',
  description: '只接收 item_3152_active 已确认的一次实际火箭命中，在当前目标上执行已有 firebolt_hit。规则不生成冲刺、弹道或多颗魔法弹，不表达同次施放去重、穿墙、法术护盾和主动冷却。',
  sortOrder: 10,
  eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: target.skillKey, useKind: null } },
  conditionGroups: [{
    groupKey: 'champion_counterparty',
    name: '命中对象为英雄',
    sortOrder: 10,
    conditions: [{ conditionKey: 'champion_counterparty', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 10, detail: { categories: ['CHAMPION'] } }]
  }],
  actions: [{
    actionKey: 'damage',
    name: '执行火箭命中',
    actionType: 'EXECUTE_EFFECT',
    sortOrder: 10,
    targetContext: 'CURRENT_TARGET',
    detail: { effectKey: 'firebolt_hit' },
    runtimeInputBindings: [],
    resultModifiers: []
  }],
  perTargetCooldown: null,
  maxTriggersPerProcess: null
};
const conflicts = targetSnapshot.components['trigger-rules'].keys.includes(target.ruleKey)
  ? [{ skillKey: target.skillKey, ruleKey: target.ruleKey, issue: '目标规则已存在，禁止重复创建' }]
  : [];
const ready = Object.values(liveChecks).every(value => value === true) && conflicts.length === 0;
const frozen = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: ready ? 'READY_FOR_INDEPENDENT_REVIEW' : 'REVISE',
  writable: ready,
  sourceVersion: { client: '16.17', official: '16.17.1' },
  sourceSnapshotSha256: fileDigest('03-来源快照.json'),
  expectedCurrent,
  observedCurrent: { skillCount: firstScan.skillKeys.length, ruleCount: firstScan.refs.length, sourceInitializedCount, stableRead },
  targetBefore: {
    ownerKey: target.ownerKey,
    skillKey: target.skillKey,
    ruleKeys: targetSnapshot.components['trigger-rules'].keys,
    candidateDetailStatus: targetSnapshot.candidateDetail.status,
    relationForwardCount: targetSnapshot.relationForward.length,
    relationReverseCount: targetSnapshot.relationReverse.length
  },
  semanticChecks: { sourceChecks, liveChecks },
  plannedWrites: ready ? 1 : 0,
  writes: ready ? [{
    id: target.skillKey + '/' + target.ruleKey,
    kind: '新增触发规则',
    method: 'POST',
    route: '/skills/' + target.skillKey + '/trigger-rules',
    detailRoute: '/skills/' + target.skillKey + '/trigger-rules/' + target.ruleKey,
    expectedStatus: 201,
    body: ruleBody
  }] : [],
  conflicts,
  excluded: sourceSnapshot.acceptedFacts.boundary
};
writeJson('02-冻结请求.json', frozen);

const baseline = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  baseUrl,
  requestPolicy: { businessMethodsSent: ['GET'], authorizationValueRecorded: false, businessWritesIssued: 0 },
  authMode,
  sourceSnapshotSha256: fileDigest('03-来源快照.json'),
  frozenRequestSha256: fileDigest('02-冻结请求.json'),
  expectedCurrent,
  observedCurrent: frozen.observedCurrent,
  targetSnapshot,
  protectionCatalogs: { attributes, modifierZones, damageTypes },
  triggerRuleBaseline: {
    skillCatalog: firstScan.skillsResponse,
    skillCount: firstScan.skillKeys.length,
    ruleListCount: firstScan.lists.length,
    ruleDetailCount: firstScan.details.length,
    eventTypeCounts: eventCounts(firstScan.details),
    conditionTypeCounts: conditionCounts(firstScan.details),
    skillRuleLists: firstScan.lists.map(item => ({ skillKey: item.skillKey, response: item.response, rules: item.rules, ruleKeys: item.ruleKeys })),
    ruleDetails: firstScan.details
  },
  triggerRuleStableSecondScan: {
    skillCount: secondScan.skillKeys.length,
    ruleListCount: secondScan.lists.length,
    ruleCount: secondScan.refs.length,
    skillKeys: secondScan.skillKeys,
    ruleKeys: secondRuleKeys,
    verification: stableRead
  },
  preservation: {
    existingRuleCount: firstScan.refs.length,
    existingRuleKeys: firstRuleKeys,
    expectedFinalRuleCount: ready ? firstScan.refs.length + 1 : firstScan.refs.length,
    expectedNewRuleKey: ready ? target.skillKey + '/' + target.ruleKey : null
  },
  getCount,
  statusCounts,
  businessWrites: 0
};
writeJson('04-写入前现值.json', baseline);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: ready ? 'PASS' : 'REVISE',
  conclusion: ready ? 'READY' : 'REVISE',
  methodPolicy: 'GET_ONLY',
  businessWrites: 0,
  authMode,
  sourceFiles: sourceRecords.length,
  experienceFindings: [
    '装备关系查询返回 items/total 对象，而技能六类组成列表直接返回数组；只读脚本统一读取两种返回形态。',
    'SKILL_HIT 的已有规则把 useKind 保留为空值；本候选沿用该结构，只按 sourceSkillKey 识别实际命中。',
    '火箭伤害结果嵌在 firebolt_hit 详情的 results 中，没有独立的结果接口；写入前必须读取效果详情核对结果目标、伤害类型和公式。'
  ],
  hashes: { sourceSnapshot: fileDigest('03-来源快照.json'), frozenRequest: fileDigest('02-冻结请求.json'), baseline: fileDigest('04-写入前现值.json') },
  getStats: {
    total: getCount,
    statusCounts,
    expected404: [targetSnapshot.candidateDetail.route],
    unexpectedStatusCount: Object.entries(statusCounts).filter(([status]) => !['200', '404'].includes(status)).reduce((sum, [, count]) => sum + count, 0)
  },
  currentBaseline: {
    skillCount: firstScan.skillKeys.length,
    triggerRuleCount: firstScan.refs.length,
    sourceInitializedCount,
    eventTypeCounts: eventCounts(firstScan.details),
    conditionTypeCounts: conditionCounts(firstScan.details),
    allRuleDetailGets: firstScan.details.length,
    allRuleDetailStatuses200: firstScan.details.every(item => item.response.status === 200)
  },
  targetChecks: {
    ownerStatus: targetSnapshot.staticResponses['/equipment/' + target.ownerKey].status,
    skillStatus: targetSnapshot.staticResponses['/skills/' + target.skillKey].status,
    relationForwardCount: targetSnapshot.relationForward.length,
    relationReverseCount: targetSnapshot.relationReverse.length,
    componentCounts: Object.fromEntries(componentKinds.map(([kind]) => [kind, targetSnapshot.components[kind].keys.length])),
    ruleKeysBefore: targetSnapshot.components['trigger-rules'].keys,
    candidateDetailStatus: targetSnapshot.candidateDetail.status,
    fireboltResultTarget: fireboltResult?.target || null,
    fireboltDamageType: fireboltResult?.detail?.damageTypeKey || null,
    fireboltFormula: fireboltResult?.valueRule?.value?.formulaKey || null,
    ownerImageKey: targetSnapshot.staticResponses['/equipment/' + target.ownerKey + '/representative-image'].data?.image?.imageKey || null,
    skillImageKey: targetSnapshot.staticResponses['/skills/' + target.skillKey + '/representative-image'].data?.image?.imageKey || null
  },
  sourceChecks,
  stableRead,
  plannedPost: ready ? {
    count: 1,
    route: frozen.writes[0].route,
    detailRoute: frozen.writes[0].detailRoute,
    ruleKey: target.ruleKey,
    eventType: ruleBody.eventSource.eventType,
    sourceSkillKey: ruleBody.eventSource.detail.sourceSkillKey,
    targetCategory: ['CHAMPION'],
    targetContext: ruleBody.actions[0].targetContext,
    effectKey: ruleBody.actions[0].detail.effectKey,
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  } : null,
  nextStep: ready ? '独立评审 02-冻结请求.json 后，才可由受保护写入脚本执行唯一 POST；本脚本本轮未写入。' : '先按 semanticChecks 修订候选或补齐实库事实；本轮没有可提交 POST。'
};
writeJson('05-只读准备报告.json', report);
console.log(JSON.stringify({
  status: report.status,
  conclusion: report.conclusion,
  methodPolicy: report.methodPolicy,
  businessWrites: 0,
  getCount,
  statusCounts,
  skillCount: firstScan.skillKeys.length,
  triggerRuleCount: firstScan.refs.length,
  sourceInitializedCount,
  targetRuleKeysBefore: targetSnapshot.components['trigger-rules'].keys,
  plannedPostCount: frozen.plannedWrites,
  sourceSnapshotSha256: report.hashes.sourceSnapshot,
  frozenRequestSha256: report.hashes.frozenRequest,
  baselineSha256: report.hashes.baseline
}, null, 2));
