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
const skillKey = 'item_3071_passive';
const equipmentKey = 'item_3071';
const ruleKey = 'on_physical_damage_dealt_to_champion';

const sourcePaths = [
  {
    kind: '规划候选',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '装备技能实录', 'Luna第八批', '录入候选.json')
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
    kind: '候选未补字段清单',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '装备效果候选', '未补字段清单.json')
  },
  {
    kind: '已有装备接口记录',
    path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '装备', 'item_3071.json')
  },
  {
    kind: '已有装备图片接口记录',
    path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '装备图片', 'item_3071.json')
  },
  {
    kind: '已有装备图片文件',
    path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '装备图片', 'source-images', '3071.png')
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

const expectedCurrent = {
  skillCount: 1062,
  ruleCount: 96,
  sourceInitializedCount: 24,
  damageDealtRuleCount: 2
};

const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(Buffer.from(JSON.stringify(value), 'utf8'));
const localPath = name => path.join(here, name);
const fileSha = filePath => shaBytes(fs.readFileSync(filePath));
const fileDigest = name => fileSha(localPath(name));
const writeJson = (name, value) => {
  fs.writeFileSync(localPath(name), JSON.stringify(value, null, 2) + '\n');
};

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

const sourceRecords = sourcePaths.map(sourceRecord);
const candidate = parseJson(sourcePaths[0].path);
const candidateObject = candidate.objects.find(item => item.equipmentKey === equipmentKey);
assert(candidateObject, '候选来源没有 item_3071');
assert.equal(candidateObject.skill?.skillKey, skillKey);
assert.deepEqual(candidateObject.triggerRules, []);
assert.equal(candidateObject.effects?.find(item => item.effectKey === 'armor_shred')?.results?.[0]?.detail?.modifierZoneKey, 'item_3071_armor_reduction');

const official = parseJson(sourcePaths[3].path);
const officialItem = official.data?.['3071'];
assert(officialItem, '官方来源没有 3071');

const clientRaw = gunzipSync(fs.readFileSync(sourcePaths[1].path));
const client = JSON.parse(clientRaw);
const clientItem = client['Items/3071'];
assert(clientItem, '客户端来源没有 Items/3071');
const clientValues = Object.fromEntries((clientItem.mDataValues || []).map(item => [item.mName, item.mValue]));
assert.equal(clientValues.MaxStacks, 5);
assert.equal(clientValues.MoveSpeedBonus, 20);
assert.equal(clientValues.MoveSpeedDuration, 2);
assert.equal(clientValues.RangedMod, 0.5);
assert(Math.abs(clientValues.ShredPerStack - 0.06) < 0.000001);
const msBonusSplit = clientItem.mItemCalculations?.MSBonusSplit || null;
const stringtable = JSON.parse(gunzipSync(fs.readFileSync(sourcePaths[2].path)));
const stringEntries = stringtable.entries || {};
const stringtableSelected = {
  item_3071_tooltip: stringEntries.item_3071_tooltip || null,
  generatedtip_item_3071_description: stringEntries.generatedtip_item_3071_description || null,
  game_item_tooltip_3071: stringEntries.game_item_tooltip_3071 || null,
  game_item_plaintext_3071: stringEntries.game_item_plaintext_3071 || null
};
assert(stringtableSelected.item_3071_tooltip, '客户端中文文本来源没有 item_3071_tooltip');
assert(stringtableSelected.generatedtip_item_3071_description, '客户端中文文本来源没有 generatedtip_item_3071_description');

const startedAt = new Date().toISOString();
const sourceSnapshot = {
  schemaVersion: 1,
  capturedAt: startedAt,
  sourcePolicy: '固定客户端16.17与官方16.17.1；只读取规划来源，不用外部最新资料覆盖。',
  methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
  authorizationValueRecorded: false,
  sourceFiles: sourceRecords,
  candidate: {
    path: sourcePaths[0].path,
    equipment: candidateObject
  },
  official: {
    path: sourcePaths[3].path,
    itemKey: '3071',
    item: officialItem
  },
  clientExtraction: {
    path: sourcePaths[1].path,
    pointer: 'Items/3071',
    dataValues: clientValues,
    calculations: { MSBonusSplit: msBonusSplit }
  },
  clientStringtableExtraction: {
    path: sourcePaths[2].path,
    version: stringtable.version || null,
    pointer: 'entries/item_3071_tooltip、entries/generatedtip_item_3071_description',
    entries: stringtableSelected
  },
  acceptedFacts: {
    trigger: {
      eventType: 'DAMAGE_DEALT',
      damageTypeBusinessMeaning: '物理伤害',
      damageTypeKeyInCurrentCatalog: 'physics',
      deliveryKind: 'ANY',
      originKind: 'ANY',
      targetCategory: 'CHAMPION',
      targetContext: 'CURRENT_TARGET',
      actionType: 'EXECUTE_EFFECT',
      effectKey: 'armor_shred',
      perTargetCooldown: null
    },
    effectBoundary: {
      effectKey: 'armor_shred',
      modifierZoneKey: 'item_3071_armor_reduction',
      ratioPerStack: 0.06,
      durationMs: 6000,
      maxStacks: 5
    },
    arithmetic: [
      { sample: '第五层总护甲削减', expected: 0.3, actual: 5 * 0.06 },
      { sample: '第五层后的再次触发', expected: 0.3, actual: 0.3 }
    ]
  },
  excluded: [
    '不把 damage_internal_cooldown_ms=10 解释为 perTargetCooldown。',
    '不新增热烈移动速度效果或其触发规则。',
    '不新增伤害类型、效果、参数、公式或乘区。',
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
    '/attributes',
    '/attributes/armor',
    '/equipment/' + equipmentKey,
    '/equipment/' + equipmentKey + '/attributes',
    '/equipment-skill-relations?equipmentKey=' + equipmentKey,
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
  const candidatePhysicalAlias = requireStatus(await get('/damage-types/physical'), 404, '/damage-types/physical');
  const triggerList = components['trigger-rules'];
  assert.deepEqual(triggerList.keys, []);

  return {
    skillKey,
    equipmentKey,
    staticResponses,
    components,
    candidateDetail,
    candidatePhysicalAlias
  };
}

async function readCatalogWithDetails(listRoute, keyName, detailRoute, label) {
  const listResponse = await get(listRoute);
  const items = arrayData(listResponse, label + '列表');
  const keys = checkKeys(items, keyName, label + '列表');
  const detailRoutes = keys.map(key => detailRoute(key));
  const details = await getMany(detailRoutes);
  details.forEach((response, index) => requireStatus(response, 200, detailRoutes[index]));
  return {
    list: listResponse,
    keys: keys.slice().sort(),
    details: details.map((response, index) => ({ key: keys[index], response }))
  };
}

function sortRuleRefs(refs) {
  return refs.slice().sort((a, b) => a.skillKey.localeCompare(b.skillKey) || a.ruleKey.localeCompare(b.ruleKey));
}

async function scanSkillRules(includeDetails) {
  const skillsResponse = requireStatus(await get('/skills'), 200, '全技能目录');
  const skills = arrayData(skillsResponse, '全技能目录');
  if (typeof skillsResponse.data?.total === 'number') assert.equal(skillsResponse.data.total, skills.length, '技能目录 total 不一致');
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
  const refs = sortRuleRefs(lists.flatMap(item => item.ruleKeys.map(rule => ({ skillKey: item.skillKey, ruleKey: rule }))));
  const details = includeDetails
    ? await getMany(refs.map(item => '/skills/' + encodeURIComponent(item.skillKey) + '/trigger-rules/' + encodeURIComponent(item.ruleKey)))
    : [];
  if (includeDetails) {
    details.forEach((response, index) => {
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
    details: details.map((response, index) => ({ ...refs[index], response }))
  };
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function eventTypeCounts(ruleDetails) {
  return Object.fromEntries(
    Object.entries(ruleDetails.reduce((counts, item) => {
      const eventType = item.response.data?.eventSource?.eventType || 'UNKNOWN';
      counts[eventType] = (counts[eventType] || 0) + 1;
      return counts;
    }, {})).sort(([a], [b]) => a.localeCompare(b))
  );
}

function categoryConditionCount(ruleDetails) {
  return ruleDetails.reduce((count, item) => count + (item.response.data?.conditionGroups || [])
    .flatMap(group => group.conditions || [])
    .filter(condition => condition.conditionType === 'TARGET_CATEGORY_CHECK')
    .length, 0);
}

function damageDealtWithCategoryCount(ruleDetails) {
  return ruleDetails.filter(item => item.response.data?.eventSource?.eventType === 'DAMAGE_DEALT')
    .filter(item => (item.response.data?.conditionGroups || [])
      .flatMap(group => group.conditions || [])
      .some(condition => condition.conditionType === 'TARGET_CATEGORY_CHECK')).length;
}

const target = await readTarget();
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
assert(modifierZones.keys.includes('item_3071_armor_reduction'));
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

const sourceInitializedCount = firstScan.details.filter(item => item.response.data?.eventSource?.eventType === 'SOURCE_INITIALIZED').length;
const damageDealtRuleCount = firstScan.details.filter(item => item.response.data?.eventSource?.eventType === 'DAMAGE_DEALT').length;
assert.equal(firstScan.skillKeys.length, expectedCurrent.skillCount, '技能总数与写入前基线不符');
assert.equal(firstScan.refs.length, expectedCurrent.ruleCount, '触发规则总数与写入前基线不符');
assert.equal(sourceInitializedCount, expectedCurrent.sourceInitializedCount, 'SOURCE_INITIALIZED 数量与写入前基线不符');
assert.equal(damageDealtRuleCount, expectedCurrent.damageDealtRuleCount, 'DAMAGE_DEALT 数量与写入前基线不符');
assert.equal(target.candidateDetail.status, 404);
assert.equal(target.candidatePhysicalAlias.status, 404);

const ruleBody = {
  ruleKey,
  name: '对英雄造成物理伤害触发切割',
  description: '来源对象对英雄造成物理伤害后，在当前目标上执行已有的 armor_shred；当前接口的物理伤害目录键为 physics。perTargetCooldown 保持 null，不把客户端 10 毫秒字段解释为逐目标冷却。',
  sortOrder: 10,
  eventSource: {
    eventType: 'DAMAGE_DEALT',
    detail: {
      damageTypeKey: 'physics',
      deliveryKind: 'ANY',
      originKind: 'ANY'
    }
  },
  conditionGroups: [
    {
      groupKey: 'champion_counterparty',
      name: '伤害承受对象为英雄',
      sortOrder: 10,
      conditions: [
        {
          conditionKey: 'champion_counterparty',
          conditionType: 'TARGET_CATEGORY_CHECK',
          sortOrder: 10,
          detail: { categories: ['CHAMPION'] }
        }
      ]
    }
  ],
  actions: [
    {
      actionKey: 'execute_armor_shred',
      name: '执行切割目标护甲削减',
      actionType: 'EXECUTE_EFFECT',
      sortOrder: 10,
      targetContext: 'CURRENT_TARGET',
      detail: { effectKey: 'armor_shred' },
      runtimeInputBindings: [],
      resultModifiers: []
    }
  ],
  perTargetCooldown: null,
  maxTriggersPerProcess: null
};

const targetRuleRefsBefore = target.components['trigger-rules'].keys;
const conflicts = targetRuleRefsBefore.includes(ruleKey)
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
  expectedCurrent,
  observedCurrent: {
    skillCount: firstScan.skillKeys.length,
    ruleCount: firstScan.refs.length,
    sourceInitializedCount,
    damageDealtRuleCount,
    stableRead: stableVerification
  },
  targetBefore: {
    equipmentKey,
    skillKey,
    ruleKeys: targetRuleRefsBefore,
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
  expectedCurrent,
  observedCurrent: frozen.observedCurrent,
  targetSnapshot: target,
  protectionCatalogs: {
    attributes: {
      list: target.staticResponses['/attributes'],
      armor: target.staticResponses['/attributes/armor']
    },
    modifierZones,
    damageTypes,
    currentPhysicalKeyProbe: {
      physics: damageTypes.details.find(item => item.key === 'physics')?.response || null,
      physicalAlias: target.candidatePhysicalAlias
    }
  },
  triggerRuleBaseline: {
    skillCatalog: firstScan.skillsResponse,
    skillCount: firstScan.skillKeys.length,
    ruleListCount: firstScan.lists.length,
    ruleDetailCount: firstScan.details.length,
    eventTypeCounts: eventTypeCounts(firstScan.details),
    targetCategoryConditionCount: categoryConditionCount(firstScan.details),
    damageDealtWithCategoryCount: damageDealtWithCategoryCount(firstScan.details),
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
    targetRuleKeysBefore: targetRuleRefsBefore
  },
  getCount,
  statusCounts,
  businessWrites: 0
};
writeJson('04-写入前现值.json', baseline);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: frozen.status === 'READY_FOR_INDEPENDENT_REVIEW' ? 'PASS' : 'REVISE',
  methodPolicy: 'GET_ONLY',
  businessWrites: 0,
  authMode,
  sourceFiles: sourceRecords.length,
  hashes: {
    sourceSnapshot: fileDigest('03-来源快照.json'),
    frozenRequest: fileDigest('02-冻结请求.json'),
    baseline: fileDigest('04-写入前现值.json')
  },
  getStats: {
    total: getCount,
    statusCounts,
    expected404: [
      target.candidateDetail.route,
      target.candidatePhysicalAlias.route
    ],
    unexpectedStatusCount: Object.entries(statusCounts)
      .filter(([status]) => !['200', '404'].includes(status))
      .reduce((sum, [, count]) => sum + count, 0)
  },
  currentBaseline: {
    skillCount: firstScan.skillKeys.length,
    triggerRuleCount: firstScan.refs.length,
    sourceInitializedCount,
    damageDealtRuleCount,
    eventTypeCounts: eventTypeCounts(firstScan.details),
    targetCategoryConditionCount: categoryConditionCount(firstScan.details),
    damageDealtWithCategoryCount: damageDealtWithCategoryCount(firstScan.details),
    allRuleDetailGets: firstScan.details.length,
    allRuleDetailStatuses200: firstScan.details.every(item => item.response.status === 200)
  },
  targetChecks: {
    equipmentStatus: target.staticResponses['/equipment/' + equipmentKey].status,
    skillStatus: target.staticResponses['/skills/' + skillKey].status,
    parameterCount: target.components.parameters.keys.length,
    formulaCount: target.components.formulas.keys.length,
    effectKeys: target.components.effects.keys,
    processCount: target.components.processes.keys.length,
    internalStateCount: target.components['internal-states'].keys.length,
    ruleKeysBefore: targetRuleRefsBefore,
    newRuleDetailStatus: target.candidateDetail.status,
    modifierZoneKeyPresent: modifierZones.keys.includes('item_3071_armor_reduction'),
    physicsKeyPresent: damageTypes.keys.includes('physics'),
    physicalAliasStatus: target.candidatePhysicalAlias.status
  },
  stableRead: stableVerification,
  plannedPost: {
    count: frozen.plannedWrites,
    route: frozen.writes[0].route,
    detailRoute: frozen.writes[0].detailRoute,
    ruleKey: frozen.writes[0].body.ruleKey,
    eventType: frozen.writes[0].body.eventSource.eventType,
    damageTypeKey: frozen.writes[0].body.eventSource.detail.damageTypeKey,
    deliveryKind: frozen.writes[0].body.eventSource.detail.deliveryKind,
    originKind: frozen.writes[0].body.eventSource.detail.originKind,
    targetCategory: frozen.writes[0].body.conditionGroups[0].conditions[0].detail.categories,
    targetContext: frozen.writes[0].body.actions[0].targetContext,
    effectKey: frozen.writes[0].body.actions[0].detail.effectKey,
    perTargetCooldown: frozen.writes[0].body.perTargetCooldown,
    maxTriggersPerProcess: frozen.writes[0].body.maxTriggersPerProcess
  },
  nextStep: '主负责人独立评审 02-冻结请求.json 后，只执行其中唯一 POST；返回 201 后立即 GET 详情并核对冻结字段。'
};
writeJson('05-只读准备报告.json', report);

console.log(JSON.stringify({
  status: report.status,
  methodPolicy: report.methodPolicy,
  businessWrites: report.businessWrites,
  getCount,
  statusCounts,
  skillCount: firstScan.skillKeys.length,
  triggerRuleCount: firstScan.refs.length,
  sourceInitializedCount,
  damageDealtRuleCount,
  targetRuleKeysBefore: targetRuleRefsBefore,
  plannedPostCount: frozen.plannedWrites,
  sourceSnapshotSha256: report.hashes.sourceSnapshot,
  frozenRequestSha256: report.hashes.frozenRequest,
  baselineSha256: report.hashes.baseline
}, null, 2));
