import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const planning = 'C:/project/damage_viewer_project_planning';
const baseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_ENTRY_TOKEN || null;
const equipmentKey = 'item_6631';
const skillKey = 'item_6631_active';
const effectKey = 'active_hit';
const ruleKey = 'actual_hit';

const sourcePaths = [
  {
    kind: '规划第十八批最终候选',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '装备技能实录', '第十八批剩余自身效果', '最终候选.json')
  },
  {
    kind: '规划第十八批冻结来源',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '装备技能实录', '第十八批剩余自身效果', '冻结来源.json')
  },
  {
    kind: '客户端装备列表',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '装备效果补证', '客户端原始资料', 'items-16.17-zh_CN.json.gz')
  },
  {
    kind: '客户端装备对象',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '装备效果补证', '客户端原始资料', 'items-16.17.cdtb.bin.json.gz')
  },
  {
    kind: '客户端中文绑定文本',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '装备效果补证', '客户端原始资料', 'lol-16.17-zh_CN.stringtable.json.gz')
  },
  {
    kind: '官方装备资料',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '装备符文', '官方原始资料', 'item-16.17.1-zh_CN.json')
  },
  {
    kind: '前批效果冻结请求',
    path: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', '六件装备公式结果补录', '09-冻结请求.json')
  },
  {
    kind: '前批效果写入回读',
    path: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', '六件装备公式结果补录', '04-写入与即时回读.json')
  },
  {
    kind: '已有装备接口记录',
    path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '装备', 'item_6631.json')
  },
  {
    kind: '已有装备图片接口记录',
    path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '装备图片', 'item_6631.json')
  },
  {
    kind: '已有装备图片文件',
    path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '装备图片', 'source-images', '6631.png')
  }
];

const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];

const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(Buffer.from(JSON.stringify(value), 'utf8'));
const localPath = name => path.join(here, name);
const fileSha = filePath => shaBytes(fs.readFileSync(filePath));
const fileDigest = name => fileSha(localPath(name));
const writeJson = (name, value) => fs.writeFileSync(localPath(name), JSON.stringify(value, null, 2) + '\n');

function parseJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sourceRecord(source) {
  assert(fs.existsSync(source.path), '来源文件不存在：' + source.path);
  const bytes = fs.readFileSync(source.path);
  const result = {
    kind: source.kind,
    path: source.path,
    byteSize: bytes.byteLength,
    sha256: shaBytes(bytes)
  };
  if (source.path.toLowerCase().endsWith('.gz')) {
    const decompressed = gunzipSync(bytes);
    result.decompressedByteSize = decompressed.byteLength;
    result.decompressedSha256 = shaBytes(decompressed);
  }
  return result;
}

function findNode(value, predicate, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (predicate(value)) return value;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findNode(child, predicate, seen);
      if (found) return found;
    }
  } else {
    for (const child of Object.values(value)) {
      const found = findNode(child, predicate, seen);
      if (found) return found;
    }
  }
  return null;
}

const sourceRecords = sourcePaths.map(sourceRecord);
const candidateDocument = parseJson(sourcePaths[0].path);
const candidateObject = candidateDocument.objects.find(item => item.skillKey === skillKey);
assert(candidateObject, '候选来源没有 ' + skillKey);
assert.equal(candidateObject.equipmentKey, equipmentKey);
assert.equal(candidateObject.apiPayload?.skill?.skillKey, skillKey);
assert.deepEqual(candidateObject.apiPayload?.triggerRules, []);

const officialDocument = parseJson(sourcePaths[5].path);
const officialItem = officialDocument.data?.['6631'];
assert(officialItem, '官方来源没有 6631');

const clientList = JSON.parse(gunzipSync(fs.readFileSync(sourcePaths[2].path)));
const clientListItem = clientList.find(item => item.id === 6631);
assert(clientListItem, '客户端装备列表没有 6631');

const clientObjects = JSON.parse(gunzipSync(fs.readFileSync(sourcePaths[3].path)));
const clientItem = clientObjects['Items/6631'];
assert(clientItem, '客户端装备对象没有 Items/6631');
const clientDataValues = Object.fromEntries((clientItem.mDataValues || []).map(item => [
  item.mName,
  Object.prototype.hasOwnProperty.call(item, 'mValue') ? item.mValue : null
]));
const calculationNames = ['SlashDamage', 'MeleeItemCalcValue', 'RangedItemCalcValue'];
const clientCalculations = Object.fromEntries(calculationNames
  .filter(name => clientItem.mItemCalculations?.[name])
  .map(name => [name, clientItem.mItemCalculations[name]]));
assert.equal(clientDataValues.Cooldown, 15);
assert(Math.abs(clientDataValues.ADRatio - 0.8) < 0.000001);
assert(Math.abs(clientDataValues.MSSlow + 0.35) < 0.000001);
assert(Math.abs(clientDataValues.ActiveMS - 0.35) < 0.000001);
assert.equal(clientDataValues.Duration, 3);
assert(Math.abs(clientDataValues.DecayRate - 0.8) < 0.000001);

const stringtable = JSON.parse(gunzipSync(fs.readFileSync(sourcePaths[4].path)));
const stringEntries = stringtable.entries || {};
const stringtableSelected = Object.fromEntries([
  'item_6631_name',
  'item_6631_brief',
  'item_6631_tooltip',
  'item_6631_active',
  'item_6631_activeexternal',
  'item_6631_tooltipextendedrules',
  'generatedtip_item_6631_description'
].map(key => [key, stringEntries[key] || null]));
assert(stringtableSelected.item_6631_active, '中文绑定文本没有 item_6631_active');
assert(stringtableSelected.generatedtip_item_6631_description, '中文绑定文本没有 generatedtip_item_6631_description');

const priorEffectFreeze = parseJson(sourcePaths[6].path);
const priorTarget = priorEffectFreeze.targets?.find(item => item.skillKey === skillKey);
const priorEffectPost = priorTarget?.effectPosts?.find(item => item.effectKey === effectKey) || null;
assert(priorEffectPost, '前批冻结请求没有 ' + skillKey + '/' + effectKey);
const priorEffectReadbackDocument = parseJson(sourcePaths[7].path);
const priorEffectReadbackOperation = findNode(
  priorEffectReadbackDocument,
  value => value.skillKey === skillKey && value.effectKey === effectKey && value.readback
);
const priorEffectReadback = priorEffectReadbackOperation?.readback || null;
assert(priorEffectReadback, '前批回读没有 ' + skillKey + '/' + effectKey);

const startedAt = new Date().toISOString();
const sourceSnapshot = {
  schemaVersion: 1,
  capturedAt: startedAt,
  sourcePolicy: '固定客户端16.17与官方16.17.1；只读取规划来源和已有前批证据，不使用外部最新资料覆盖。',
  methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
  authorizationValueRecorded: false,
  sourceFiles: sourceRecords,
  candidate: {
    path: sourcePaths[0].path,
    equipment: candidateObject
  },
  official: {
    path: sourcePaths[5].path,
    itemKey: '6631',
    item: officialItem
  },
  clientList: {
    path: sourcePaths[2].path,
    item: clientListItem
  },
  clientExtraction: {
    path: sourcePaths[3].path,
    pointer: 'Items/6631',
    dataValues: clientDataValues,
    calculations: clientCalculations
  },
  clientStringtableExtraction: {
    path: sourcePaths[4].path,
    version: stringtable.version || null,
    pointer: 'entries/item_6631_active、entries/generatedtip_item_6631_description',
    entries: stringtableSelected
  },
  priorEffectEvidence: {
    freezePath: sourcePaths[6].path,
    effectPost: priorEffectPost,
    readbackPath: sourcePaths[7].path,
    effectReadback: priorEffectReadback
  },
  acceptedFacts: {
    scope: {
      skillKey,
      effectKey,
      eventType: 'SKILL_HIT',
      sourceSkillKey: skillKey,
      targetCategory: 'CHAMPION',
      targetContext: 'CURRENT_TARGET',
      actionType: 'EXECUTE_EFFECT'
    },
    existingEffect: {
      resultKey: priorEffectReadback.results?.[0]?.resultKey || null,
      resultType: priorEffectReadback.results?.[0]?.resultType || null,
      target: priorEffectReadback.results?.[0]?.target || null,
      formulaKey: priorEffectReadback.results?.[0]?.valueRule?.value?.formulaKey || null,
      damageTypeKey: priorEffectReadback.results?.[0]?.detail?.damageTypeKey || null,
      deliveryKind: priorEffectReadback.results?.[0]?.detail?.deliveryKind || null,
      originKind: priorEffectReadback.results?.[0]?.detail?.originKind || null
    }
  },
  excluded: [
    '不重复创建 active_hit 或任何其他效果、参数、公式、过程和内部状态。',
    '不补主动施放过程、范围命中生产、附近其他目标、减速、自身移动速度或衰减算法。',
    '不新增或解释主动冷却、每目标冷却、触发次数、吸血或法术护盾字段。',
    '不新增 DAMAGE_DEALT 技能伤害分支。',
    '不把静态来源、接口 GET 或本脚本检查当作战斗运行时证明。'
  ]
};
writeJson('03-来源快照.json', sourceSnapshot);

let getCount = 0;
const statusCounts = {};
const authMode = token ? 'ENVIRONMENT_TOKEN_PRESENT' : 'NO_AUTH_HEADER';

async function get(route) {
  getCount += 1;
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(baseUrl + route, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { parseError: true, responseBytes: Buffer.byteLength(text) };
    }
  }
  statusCounts[response.status] = (statusCounts[response.status] || 0) + 1;
  return { method: 'GET', route, status: response.status, data };
}

async function getMany(routes, concurrency = 24) {
  const results = new Array(routes.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
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

async function readTarget() {
  const staticRoutes = [
    '/equipment/' + equipmentKey,
    '/equipment/' + equipmentKey + '/attributes',
    '/equipment/' + equipmentKey + '/representative-image',
    '/equipment-skill-relations?equipmentKey=' + equipmentKey,
    '/equipment-skill-relations?equipmentKey=' + equipmentKey + '&skillKey=' + skillKey,
    '/skills/' + skillKey,
    '/skills/' + skillKey + '/representative-image'
  ];
  const staticResponses = {};
  for (const route of staticRoutes) {
    staticResponses[route] = requireStatus(await get(route), 200, route);
  }

  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const listRoute = '/skills/' + skillKey + '/' + apiName;
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

  const candidateDetailRoute = '/skills/' + skillKey + '/trigger-rules/' + ruleKey;
  const candidateDetail = requireStatus(await get(candidateDetailRoute), 404, candidateDetailRoute);
  const triggerRules = components['trigger-rules'];
  assert.deepEqual(triggerRules.keys, []);
  const effects = components.effects;
  assert(effects.keys.includes(effectKey), '当前实库没有已有 active_hit');

  return {
    equipmentKey,
    skillKey,
    staticResponses,
    components,
    candidateDetail,
    targetRuleKeysBefore: triggerRules.keys,
    existingEffectKeys: effects.keys
  };
}

async function readCatalogWithDetails(listRoute, keyName, detailRoute, label) {
  const listResponse = await get(listRoute);
  const items = arrayData(listResponse, label + '列表');
  const keys = checkKeys(items, keyName, label + '列表');
  const detailRoutes = keys.map(key => detailRoute(key));
  const detailResponses = await getMany(detailRoutes);
  detailResponses.forEach((response, index) => requireStatus(response, 200, detailRoutes[index]));
  return {
    list: listResponse,
    keys: keys.slice().sort(),
    details: detailResponses.map((response, index) => ({ key: keys[index], response }))
  };
}

function sortRuleRefs(refs) {
  return refs.slice().sort((a, b) => a.skillKey.localeCompare(b.skillKey) || a.ruleKey.localeCompare(b.ruleKey));
}

async function scanSkillRules(includeDetails) {
  const skillsResponse = requireStatus(await get('/skills'), 200, '全技能目录');
  const skills = arrayData(skillsResponse, '全技能目录');
  if (typeof skillsResponse.data?.total === 'number') {
    assert.equal(skillsResponse.data.total, skills.length, '技能目录 total 不一致');
  }
  const skillKeys = checkKeys(skills, 'skillKey', '全技能目录').slice().sort();
  const listResponses = await getMany(skillKeys.map(key => '/skills/' + encodeURIComponent(key) + '/trigger-rules'));
  const lists = listResponses.map((response, index) => {
    const route = '/skills/' + encodeURIComponent(skillKeys[index]) + '/trigger-rules';
    const rules = arrayData(response, route);
    const ruleKeys = checkKeys(rules, 'ruleKey', route);
    return {
      skillKey: skillKeys[index],
      response,
      rules,
      ruleKeys: ruleKeys.slice().sort()
    };
  });
  const refs = sortRuleRefs(lists.flatMap(item => item.ruleKeys.map(key => ({
    skillKey: item.skillKey,
    ruleKey: key
  }))));
  const detailResponses = includeDetails
    ? await getMany(refs.map(item => '/skills/' + encodeURIComponent(item.skillKey) + '/trigger-rules/' + encodeURIComponent(item.ruleKey)))
    : [];
  if (includeDetails) {
    detailResponses.forEach((response, index) => {
      const item = refs[index];
      requireStatus(response, 200, '触发规则详情 ' + item.skillKey + '/' + item.ruleKey);
    });
  }
  return {
    skillsResponse,
    skills,
    skillKeys,
    lists,
    refs,
    details: detailResponses.map((response, index) => ({ ...refs[index], response }))
  };
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function eventTypeCounts(ruleDetails) {
  return Object.fromEntries(Object.entries(ruleDetails.reduce((counts, item) => {
    const eventType = item.response.data?.eventSource?.eventType || 'UNKNOWN';
    counts[eventType] = (counts[eventType] || 0) + 1;
    return counts;
  }, {})).sort(([a], [b]) => a.localeCompare(b)));
}

function categoryConditionCount(ruleDetails) {
  return ruleDetails.reduce((count, item) => count + (item.response.data?.conditionGroups || [])
    .flatMap(group => group.conditions || [])
    .filter(condition => condition.conditionType === 'TARGET_CATEGORY_CHECK')
    .length, 0);
}

function skillHitCategoryRuleCount(ruleDetails) {
  return ruleDetails.filter(item => item.response.data?.eventSource?.eventType === 'SKILL_HIT')
    .filter(item => (item.response.data?.conditionGroups || [])
      .flatMap(group => group.conditions || [])
      .some(condition => condition.conditionType === 'TARGET_CATEGORY_CHECK')).length;
}

const target = await readTarget();
const attributes = await readCatalogWithDetails(
  '/attributes',
  'attributeKey',
  key => '/attributes/' + encodeURIComponent(key),
  '属性'
);
const modifierZones = await readCatalogWithDetails(
  '/modifier-zones',
  'modifierZoneKey',
  key => '/modifier-zones/' + encodeURIComponent(key),
  '修正区域'
);
const damageTypes = await readCatalogWithDetails(
  '/damage-types',
  'damageTypeKey',
  key => '/damage-types/' + encodeURIComponent(key),
  '伤害类型'
);
assert(attributes.keys.includes('attack_damage'));
assert(modifierZones.keys.length > 0);
assert(damageTypes.keys.includes('physics'));

const firstScan = await scanSkillRules(true);
const secondScan = await scanSkillRules(false);
const firstRuleKeys = firstScan.refs.map(item => item.skillKey + '/' + item.ruleKey);
const secondRuleKeys = secondScan.refs.map(item => item.skillKey + '/' + item.ruleKey);
const stableVerification = {
  stableSkillKeys: sameList(firstScan.skillKeys, secondScan.skillKeys),
  stableRuleKeys: sameList(firstRuleKeys, secondRuleKeys),
  stableRuleCount: firstRuleKeys.length === secondRuleKeys.length,
  firstSkillCount: firstScan.skillKeys.length,
  secondSkillCount: secondScan.skillKeys.length,
  firstRuleCount: firstRuleKeys.length,
  secondRuleCount: secondRuleKeys.length,
  firstRuleKeysSha256: shaValue(firstRuleKeys),
  secondRuleKeysSha256: shaValue(secondRuleKeys)
};
assert.equal(stableVerification.stableSkillKeys, true, '两次扫描技能键集合不一致');
assert.equal(stableVerification.stableRuleKeys, true, '两次扫描触发规则键集合不一致');
assert.equal(stableVerification.stableRuleCount, true, '两次扫描触发规则数量不一致');
assert.equal(target.candidateDetail.status, 404);

const ruleBody = {
  ruleKey,
  name: '破阵冲击波命中英雄',
  description: '仅在运行时确认 item_6631_active 已命中英雄后，在当前目标上执行已有的 active_hit；本批不生成范围命中，不接入减速、自身移动速度、衰减或冷却。',
  sortOrder: 10,
  eventSource: {
    eventType: 'SKILL_HIT',
    detail: {
      sourceSkillKey: skillKey
    }
  },
  conditionGroups: [
    {
      groupKey: 'champion_target',
      name: '命中对象为英雄',
      sortOrder: 10,
      conditions: [
        {
          conditionKey: 'champion_target',
          conditionType: 'TARGET_CATEGORY_CHECK',
          sortOrder: 10,
          detail: { categories: ['CHAMPION'] }
        }
      ]
    }
  ],
  actions: [
    {
      actionKey: 'execute_active_hit',
      name: '执行破阵冲击波主动命中',
      actionType: 'EXECUTE_EFFECT',
      sortOrder: 10,
      targetContext: 'CURRENT_TARGET',
      detail: { effectKey },
      runtimeInputBindings: [],
      resultModifiers: []
    }
  ],
  perTargetCooldown: null,
  maxTriggersPerProcess: null
};

const conflicts = target.targetRuleKeysBefore.includes(ruleKey)
  ? [{ skillKey, ruleKey, issue: '目标规则已存在，禁止重复创建' }]
  : [];
assert.equal(conflicts.length, 0, '目标规则已存在');

const frozen = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: stableVerification.stableSkillKeys && stableVerification.stableRuleKeys && stableVerification.stableRuleCount && conflicts.length === 0
    ? 'READY_FOR_INDEPENDENT_REVIEW'
    : 'REVISE',
  writable: stableVerification.stableSkillKeys && stableVerification.stableRuleKeys && stableVerification.stableRuleCount && conflicts.length === 0,
  sourceVersion: { client: '16.17', official: '16.17.1' },
  sourceSnapshotSha256: fileDigest('03-来源快照.json'),
  observedCurrent: {
    skillCount: firstScan.skillKeys.length,
    ruleCount: firstScan.refs.length,
    eventTypeCounts: eventTypeCounts(firstScan.details),
    targetCategoryConditionCount: categoryConditionCount(firstScan.details),
    skillHitCategoryRuleCount: skillHitCategoryRuleCount(firstScan.details),
    stableRead: stableVerification
  },
  targetBefore: {
    equipmentKey,
    skillKey,
    existingEffectKeys: target.existingEffectKeys,
    ruleKeys: target.targetRuleKeysBefore,
    newRuleDetailStatus: target.candidateDetail.status
  },
  plannedWrites: 1,
  writes: [
    {
      id: skillKey + '-' + ruleKey,
      kind: '新增触发规则',
      method: 'POST',
      route: '/skills/' + skillKey + '/trigger-rules',
      detailRoute: '/skills/' + skillKey + '/trigger-rules/' + ruleKey,
      expectedStatus: 201,
      body: ruleBody
    }
  ],
  conflicts,
  excluded: sourceSnapshot.excluded
};
writeJson('02-冻结请求.json', frozen);

const baseline = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  baseUrl,
  requestPolicy: {
    businessMethodsSent: ['GET'],
    authorizationValueRecorded: false,
    businessWritesIssued: 0
  },
  authMode,
  sourceSnapshotSha256: fileDigest('03-来源快照.json'),
  frozenRequestSha256: fileDigest('02-冻结请求.json'),
  observedCurrent: frozen.observedCurrent,
  targetSnapshot: target,
  protectionCatalogs: {
    attributes,
    modifierZones,
    damageTypes
  },
  triggerRuleBaseline: {
    skillCatalog: firstScan.skillsResponse,
    skillCount: firstScan.skillKeys.length,
    ruleListCount: firstScan.lists.length,
    ruleDetailCount: firstScan.details.length,
    eventTypeCounts: eventTypeCounts(firstScan.details),
    targetCategoryConditionCount: categoryConditionCount(firstScan.details),
    skillHitCategoryRuleCount: skillHitCategoryRuleCount(firstScan.details),
    skillRuleLists: firstScan.lists.map(item => ({
      skillKey: item.skillKey,
      response: item.response,
      rules: item.rules,
      ruleKeys: item.ruleKeys
    })),
    ruleDetails: firstScan.details
  },
  triggerRuleStableSecondScan: {
    skillCount: secondScan.skillKeys.length,
    ruleListCount: secondScan.lists.length,
    ruleCount: secondScan.refs.length,
    skillKeys: secondScan.skillKeys,
    ruleKeys: secondRuleKeys,
    requestStatuses: {
      skillCatalog: secondScan.skillsResponse.status,
      triggerRuleLists: secondScan.lists.every(item => item.response.status === 200) ? 200 : null
    },
    verification: stableVerification
  },
  preservation: {
    existingRuleCount: firstScan.refs.length,
    existingRuleKeys: firstRuleKeys,
    expectedFinalRuleCount: firstScan.refs.length + 1,
    expectedNewRuleKey: skillKey + '/' + ruleKey,
    targetRuleKeysBefore: target.targetRuleKeysBefore,
    targetEffectKeysBefore: target.existingEffectKeys
  },
  getCount,
  statusCounts,
  businessWrites: 0
};
writeJson('04-写入前现值.json', baseline);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  verdict: frozen.status === 'READY_FOR_INDEPENDENT_REVIEW' ? 'READY' : 'REVISE',
  methodPolicy: 'GET_ONLY',
  businessWrites: 0,
  authMode,
  hashes: {
    sourceSnapshot: fileDigest('03-来源快照.json'),
    frozenRequest: fileDigest('02-冻结请求.json'),
    baseline: fileDigest('04-写入前现值.json')
  },
  getStats: {
    total: getCount,
    statusCounts,
    expected404: [
      target.candidateDetail.route
    ],
    unexpectedStatusCount: Object.entries(statusCounts)
      .filter(([status]) => status !== '200' && status !== '404')
      .reduce((sum, [, count]) => sum + count, 0)
  },
  currentBaseline: {
    skillCount: firstScan.skillKeys.length,
    triggerRuleCount: firstScan.refs.length,
    eventTypeCounts: eventTypeCounts(firstScan.details),
    targetCategoryConditionCount: categoryConditionCount(firstScan.details),
    skillHitCategoryRuleCount: skillHitCategoryRuleCount(firstScan.details),
    allRuleDetailGets: firstScan.details.length,
    allRuleDetailStatuses200: firstScan.details.every(item => item.response.status === 200)
  },
  targetChecks: {
    equipmentStatus: target.staticResponses['/equipment/' + equipmentKey].status,
    equipmentAttributesStatus: target.staticResponses['/equipment/' + equipmentKey + '/attributes'].status,
    equipmentRelationStatus: target.staticResponses['/equipment-skill-relations?equipmentKey=' + equipmentKey].status,
    skillStatus: target.staticResponses['/skills/' + skillKey].status,
    parameterCount: target.components.parameters.keys.length,
    formulaCount: target.components.formulas.keys.length,
    effectKeys: target.components.effects.keys,
    processCount: target.components.processes.keys.length,
    internalStateCount: target.components['internal-states'].keys.length,
    ruleKeysBefore: target.targetRuleKeysBefore,
    newRuleDetailStatus: target.candidateDetail.status,
    physicsKeyPresent: damageTypes.keys.includes('physics'),
    activeHitPresent: target.existingEffectKeys.includes(effectKey)
  },
  stableRead: stableVerification,
  plannedPost: {
    count: frozen.plannedWrites,
    route: frozen.writes[0].route,
    detailRoute: frozen.writes[0].detailRoute,
    ruleKey: frozen.writes[0].body.ruleKey,
    eventType: frozen.writes[0].body.eventSource.eventType,
    sourceSkillKey: frozen.writes[0].body.eventSource.detail.sourceSkillKey,
    targetCategory: frozen.writes[0].body.conditionGroups[0].conditions[0].detail.categories,
    targetContext: frozen.writes[0].body.actions[0].targetContext,
    effectKey: frozen.writes[0].body.actions[0].detail.effectKey,
    perTargetCooldown: frozen.writes[0].body.perTargetCooldown,
    maxTriggersPerProcess: frozen.writes[0].body.maxTriggersPerProcess
  },
  nextStep: '主负责人独立评审 02-冻结请求.json 后，只执行其中唯一 POST；返回 201 后立即 GET 新规则详情并核对冻结字段。'
};
writeJson('05-只读准备报告.json', report);

console.log(JSON.stringify({
  verdict: report.verdict,
  methodPolicy: report.methodPolicy,
  businessWrites: report.businessWrites,
  getCount,
  statusCounts,
  skillCount: firstScan.skillKeys.length,
  triggerRuleCount: firstScan.refs.length,
  eventTypeCounts: report.currentBaseline.eventTypeCounts,
  targetRuleKeysBefore: target.targetRuleKeysBefore,
  targetEffectKeys: target.existingEffectKeys,
  plannedPostCount: frozen.plannedWrites,
  sourceSnapshotSha256: report.hashes.sourceSnapshot,
  frozenRequestSha256: report.hashes.frozenRequest,
  baselineSha256: report.hashes.baseline
}, null, 2));
