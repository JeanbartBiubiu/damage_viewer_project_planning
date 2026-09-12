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
  kind: 'character',
  ownerKey: 'champion_riven',
  ownerName: '锐雯',
  skillKey: 'riven_e',
  skillName: '锐雯·勇往直前',
  ruleKey: 'on_used'
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
    kind: '官方英雄原始资料',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'zh_CN', 'champion', 'Riven.json')
  },
  {
    kind: '客户端英雄原始资料',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '技能公共参数实录', '客户端原文', 'Riven.json.gz')
  },
  {
    kind: '技能公共参数候选',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '技能公共参数第五批', '公共参数候选.json')
  },
  {
    kind: '已有角色接口记录',
    path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '英雄全量核对', 'champion_riven.json')
  },
  {
    kind: '已有技能接口记录',
    path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '技能', 'records', 'riven_e.json')
  },
  {
    kind: '已有角色技能关系记录',
    path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '技能', 'records', 'relations_champion_riven.json')
  },
  {
    kind: '技能代表图文件',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄技能全量页面输入', 'images', '02_技能', 'Riven', 'E_RivenFeint.png')
  },
  {
    kind: '角色代表图文件',
    path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄技能全量页面输入', 'images', '01_角色', 'Riven.png')
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
const officialRoot = readJson(sourcePaths[0].path);
const officialChampion = officialRoot.data?.Riven || null;
const officialSpell = officialChampion?.spells?.find(spell => spell.id === 'RivenFeint') || null;
const clientRoot = readGzipJson(sourcePaths[1].path);
const clientSpellObject = clientRoot['Characters/Riven/Spells/RivenFeintAbility/RivenFeint'] || null;
const clientSpell = clientSpellObject?.mSpell || null;
const clientDataValues = Object.fromEntries((clientSpell?.DataValues || []).map(value => [value.name, value.values]));
const clientTotalShield = clientSpell?.mSpellCalculations?.TotalShield || null;
const publicRoot = readJson(sourcePaths[2].path);
const publicEntry = publicRoot.entries?.find(entry => entry.skillKey === target.skillKey) || null;
const sourceChecks = {
  officialChampionPresent: Boolean(officialChampion),
  officialSpellPresent: Boolean(officialSpell),
  officialShieldDuration: typeof officialSpell?.tooltip === 'string' && officialSpell.tooltip.includes('1.5'),
  officialFiveRanks: officialSpell?.maxrank === 5,
  officialCooldown: JSON.stringify(officialSpell?.cooldown) === JSON.stringify([10, 9, 8, 7, 6]),
  officialNoResourceCost: Array.isArray(officialSpell?.cost) && officialSpell.cost.every(value => value === 0),
  clientSpellPresent: Boolean(clientSpell),
  clientShieldTag: Array.isArray(clientSpell?.mSpellTags) && clientSpell.mSpellTags.includes('Trait_Shield'),
  clientShieldDuration: Array.isArray(clientDataValues.ShieldDuration) && clientDataValues.ShieldDuration.slice(1, 6).every(value => value === 1.5),
  clientShieldCalculation: Boolean(clientTotalShield?.mFormulaParts?.some(part => part.__type === 'NamedDataValueCalculationPart' && part.mDataValue === 'ShieldAmount')),
  clientAdCoefficient: Boolean(clientTotalShield?.mFormulaParts?.some(part => part.__type === 'StatByCoefficientCalculationPart' && Math.abs(part.mCoefficient - 1.1) < 0.000001 && part.mStat === 2 && part.mStatFormula === 2)),
  publicEntryPresent: Boolean(publicEntry),
  publicEntrySkillKey: publicEntry?.skillKey === target.skillKey,
  publicEntryFiveRanks: publicEntry?.maxLevel === 5
};
const sourceSnapshot = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  sourcePolicy: '固定客户端16.17与官方16.17.1；只读取规划来源，不用外部最新资料覆盖。',
  methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
  authorizationValueRecorded: false,
  sourceFiles: sourceRecords,
  official: {
    path: sourcePaths[0].path,
    championKey: 'Riven',
    championName: officialChampion?.name || null,
    spell: officialSpell
  },
  clientExtraction: {
    path: sourcePaths[1].path,
    pointer: 'Characters/Riven/Spells/RivenFeintAbility/RivenFeint/mSpell',
    spellTags: clientSpell?.mSpellTags || [],
    dataValues: {
      ShieldAmount: clientDataValues.ShieldAmount || null,
      BaseShieldAmount: clientDataValues.BaseShieldAmount || null,
      ShieldDuration: clientDataValues.ShieldDuration || null
    },
    totalShield: clientTotalShield,
    cooldownValues: clientSpell?.Cooldown?.values || null,
    buff: clientSpellObject?.mBuff || null
  },
  publicParameterCandidate: {
    path: sourcePaths[2].path,
    entry: publicEntry
  },
  acceptedFacts: {
    trigger: {
      skillKey: target.skillKey,
      ruleKey: target.ruleKey,
      eventType: 'SKILL_USED',
      eventDetail: { sourceSkillKey: target.skillKey, useKind: 'ACTIVE' },
      targetContext: 'CURRENT_TARGET',
      actionType: 'EXECUTE_EFFECT',
      effectKey: 'shield'
    },
    targetFallback: '无显式目标时 CURRENT_TARGET 回落来源对象；shield 结果自身 target 为 SOURCE，所以护盾落在锐雯身上。',
    boundary: [
      '只连接主动使用后已有的1.5秒自身护盾。',
      '不表达冲刺、施放资格、中断或冷却消费。',
      '不新增参数、公式或效果。'
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
    '/characters/' + target.ownerKey,
    '/characters/' + target.ownerKey + '/attributes',
    '/characters/' + target.ownerKey + '/representative-image',
    '/character-skill-relations?characterKey=' + target.ownerKey,
    '/character-skill-relations?skillKey=' + target.skillKey,
    '/skills/' + target.skillKey,
    '/skills/' + target.skillKey + '/representative-image'
  ];
  const staticResponses = {};
  for (const route of staticRoutes) staticResponses[route] = requireStatus(await get(route), 200, route);
  const components = await readComponents();
  const candidateDetailRoute = '/skills/' + target.skillKey + '/trigger-rules/' + target.ruleKey;
  const candidateDetail = await get(candidateDetailRoute);
  const relationForward = arrayData(staticResponses['/character-skill-relations?characterKey=' + target.ownerKey], '角色正向关系');
  const relationReverse = arrayData(staticResponses['/character-skill-relations?skillKey=' + target.skillKey], '角色反向关系');
  const skillImage = staticResponses['/skills/' + target.skillKey + '/representative-image'].data?.image;
  const ownerImage = staticResponses['/characters/' + target.ownerKey + '/representative-image'].data?.image;
  return {
    staticResponses,
    components,
    candidateDetail,
    relationForward,
    relationReverse,
    checks: {
      relationForwardExact: relationForward.some(item => item.characterKey === target.ownerKey && item.skillKey === target.skillKey),
      relationReverseExact: relationReverse.length === 1 && relationReverse[0].characterKey === target.ownerKey && relationReverse[0].skillKey === target.skillKey,
      skillImagePresent: skillImage?.enabled === true && skillImage?.imageKey,
      ownerImagePresent: ownerImage?.enabled === true && ownerImage?.imageKey,
      triggerListEmpty: components['trigger-rules'].keys.length === 0,
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
const shieldEffect = componentDetail(targetSnapshot, 'effects', 'shield');
const shieldResult = shieldEffect?.results?.[0];
const totalShieldFormula = componentDetail(targetSnapshot, 'formulas', 'total_shield');
const liveChecks = {
  skillCount: firstScan.skillKeys.length === expectedCurrent.skillCount,
  ruleCount: firstScan.refs.length === expectedCurrent.ruleCount,
  sourceInitializedCount: sourceInitializedCount === expectedCurrent.sourceInitializedCount,
  stableRead: Object.values(stableRead).slice(0, 4).every(Boolean),
  targetRelations: targetSnapshot.checks.relationForwardExact && targetSnapshot.checks.relationReverseExact,
  targetImages: Boolean(targetSnapshot.checks.skillImagePresent && targetSnapshot.checks.ownerImagePresent),
  targetTriggerEmpty: targetSnapshot.checks.triggerListEmpty,
  candidate404: targetSnapshot.checks.candidateDetail404,
  shieldPresent: Boolean(shieldEffect),
  shieldResultSemantic: shieldResult?.resultType === 'NORMAL_SHIELD' && shieldResult.target === 'SOURCE' && shieldResult.valueRule?.value?.kind === 'FORMULA' && shieldResult.valueRule.value.formulaKey === 'total_shield',
  shieldLifecycleSemantic: shieldEffect?.lifecycle?.instanceScope === 'SOURCE' && shieldEffect.lifecycle.durationValue?.kind === 'PARAMETER' && shieldEffect.lifecycle.durationValue.parameterKey === 'shield_duration_ms' && shieldEffect.lifecycle.maxStacksValue?.kind === 'FIXED' && shieldEffect.lifecycle.maxStacksValue.value === 1,
  shieldFormulaPresent: Boolean(totalShieldFormula),
  shieldFormulaSourceAttribute: totalShieldFormula?.expression?.operation === 'ADD' && totalShieldFormula.expression.operands?.some(operand => operand.nodeType === 'OPERATION' && operand.operation === 'MULTIPLY' && operand.operands?.some(node => node.nodeType === 'ATTRIBUTE' && node.attributeOwner === 'SOURCE' && node.attributeKey === 'attack_damage' && node.attributeValueKind === 'BONUS')),
  sourceChecks: Object.values(sourceChecks).every(Boolean)
};
const ruleBody = {
  ruleKey: target.ruleKey,
  name: '勇往直前主动使用',
  description: '接收 riven_e 主动使用；CURRENT_TARGET 无显式目标时回落来源对象，在当前目标上执行已有 shield。shield 结果目标为 SOURCE，因此只连接1.5秒自身护盾，不表达冲刺、施放资格、中断或冷却消费。',
  sortOrder: 10,
  eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: target.skillKey, useKind: 'ACTIVE' } },
  conditionGroups: [],
  actions: [{
    actionKey: 'execute_shield',
    name: '执行自身护盾',
    actionType: 'EXECUTE_EFFECT',
    sortOrder: 10,
    targetContext: 'CURRENT_TARGET',
    detail: { effectKey: 'shield' },
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
    '角色技能关系需要使用实际角色键 champion_riven；反向关系通过 character-skill-relations?skillKey=riven_e 读取。',
    'SKILL_USED 的主动使用需要同时保存 sourceSkillKey 和 useKind=ACTIVE；现有 olaf_w/on_used 提供了相同接口结构。',
    '动作目标 CURRENT_TARGET 与效果结果目标 SOURCE 可以不同：无显式目标时当前目标回落来源对象，而 shield 的 SOURCE 结果仍落在锐雯自身；这是本项最需要在录入时复核的语义。',
    '护盾生命周期和结果均嵌在 shield 效果详情中，没有独立结果接口；需要在一个详情读取中核对1.5秒参数、SOURCE范围和 total_shield公式。'
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
    ownerStatus: targetSnapshot.staticResponses['/characters/' + target.ownerKey].status,
    skillStatus: targetSnapshot.staticResponses['/skills/' + target.skillKey].status,
    relationForwardCount: targetSnapshot.relationForward.length,
    relationReverseCount: targetSnapshot.relationReverse.length,
    componentCounts: Object.fromEntries(componentKinds.map(([kind]) => [kind, targetSnapshot.components[kind].keys.length])),
    ruleKeysBefore: targetSnapshot.components['trigger-rules'].keys,
    candidateDetailStatus: targetSnapshot.candidateDetail.status,
    shieldResultType: shieldResult?.resultType || null,
    shieldResultTarget: shieldResult?.target || null,
    shieldFormula: shieldResult?.valueRule?.value?.formulaKey || null,
    shieldDurationParameter: shieldEffect?.lifecycle?.durationValue?.parameterKey || null,
    shieldInstanceScope: shieldEffect?.lifecycle?.instanceScope || null,
    ownerImageKey: targetSnapshot.staticResponses['/characters/' + target.ownerKey + '/representative-image'].data?.image?.imageKey || null,
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
    useKind: ruleBody.eventSource.detail.useKind,
    targetContext: ruleBody.actions[0].targetContext,
    effectKey: ruleBody.actions[0].detail.effectKey,
    actionResultTarget: shieldResult?.target || null,
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
