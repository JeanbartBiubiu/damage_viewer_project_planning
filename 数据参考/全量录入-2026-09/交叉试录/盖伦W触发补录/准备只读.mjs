import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRepo = path.resolve(here, '..', '..', '..', '..');
const planning = 'C:/project/damage_viewer_project_planning';
const baseUrl = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = `prep-${crypto.randomUUID()}`;
const expectedCurrent = { skillCount: 1062, ruleCount: 104, sourceInitializedCount: 24 };
const target = {
  ownerKey: 'champion_garen',
  ownerName: '盖伦',
  skillKey: 'garen_w',
  skillName: '盖伦·勇气',
  ruleKey: 'on_used',
  officialChampionKey: 'Garen',
  officialSpellId: 'GarenW',
  clientPointer: 'Characters/Garen/Spells/GarenWAbility/GarenW',
  expectedEffects: ['upfront_shield', 'upfront_tenacity'],
  actionNames: ['执行勇气短时护盾', '执行勇气短时韧性'],
  effectSpecs: {
    upfront_shield: {
      durationParameter: 'upfront_duration_ms',
      resultType: 'NORMAL_SHIELD',
      resultTarget: 'SOURCE',
      valueKind: 'FORMULA',
      valueKey: 'shield',
      detailChecks: { absorbedDamageTypeKey: null }
    },
    upfront_tenacity: {
      durationParameter: 'upfront_duration_ms',
      resultType: 'ATTRIBUTE_CHANGE',
      resultTarget: 'SOURCE',
      valueKind: 'PARAMETER',
      valueKey: 'tenacity_ratio',
      detailChecks: { attributeKey: 'tenacity_percent', modifierZoneKey: 'attribute_flat_add', operation: 'INCREASE' }
    }
  },
  excluded: [
    '不把永久双抗层数、击杀边界或死亡保持写入主动使用规则。',
    '不接入主动减伤、减伤乘区或防御过程。',
    '不把基础冷却或冷却修正当作本条规则动作。',
    '不把静态来源、接口 GET 或本脚本检查当作战斗运行时证明。'
  ]
};
const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];
const candidatePath = path.join(webRepo, '数据参考', '全量录入-2026-09', '交叉试录', 'Cursor', '英雄机制第六批', '完整候选.json');
const officialPath = path.join(planning, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'zh_CN', 'champion', 'Garen.json');
const clientPath = path.join(planning, '数据参考', '全量录入-2026-09', '技能公共参数实录', '客户端原文', 'Garen.json.gz');
const sourcePaths = [
  { kind: '固定英雄机制候选', path: candidatePath },
  { kind: '官方中文英雄资料', path: officialPath },
  { kind: '客户端英雄原始资料', path: clientPath },
  { kind: '已有角色接口记录', path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '英雄全量核对', 'champion_garen.json') },
  { kind: '已有技能接口记录', path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '技能', 'records', 'garen_w.json') },
  { kind: '已有角色技能关系记录', path: path.join(planning, '数据参考', '全量录入-2026-09', 'API实录', '技能', 'records', 'relations_champion_garen.json') },
  { kind: '技能代表图文件', path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄技能全量页面输入', 'images', '02_技能', 'Garen', 'W_GarenW.png') },
  { kind: '角色代表图文件', path: path.join(planning, '数据参考', '全量录入-2026-09', '英雄技能全量页面输入', 'images', '01_角色', 'Garen.png') }
];

const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(Buffer.from(JSON.stringify(value), 'utf8'));
const localPath = name => path.join(here, name);
const fileDigest = name => shaBytes(fs.readFileSync(localPath(name)));
const writeJson = (name, value) => fs.writeFileSync(localPath(name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readGzipJson = filePath => JSON.parse(gunzipSync(fs.readFileSync(filePath)));
const sourceRecord = source => {
  assert(fs.existsSync(source.path), `来源文件不存在：${source.path}`);
  const bytes = fs.readFileSync(source.path);
  const result = { kind: source.kind, path: source.path, byteSize: bytes.byteLength, sha256: shaBytes(bytes) };
  if (source.path.toLowerCase().endsWith('.gz')) {
    const raw = gunzipSync(bytes);
    result.decompressedByteSize = raw.byteLength;
    result.decompressedSha256 = shaBytes(raw);
  }
  return result;
};
const sourceRecords = sourcePaths.map(sourceRecord);
const candidateRoot = readJson(candidatePath);
const candidate = candidateRoot.skills?.[target.skillKey];
assert(candidate, `候选来源缺少 ${target.skillKey}`);
const officialRoot = readJson(officialPath);
const officialChampion = officialRoot.data?.[target.officialChampionKey] || null;
const officialSpell = officialChampion?.spells?.find(spell => spell.id === target.officialSpellId) || null;
const clientRoot = readGzipJson(clientPath);
const clientObject = clientRoot[target.clientPointer] || null;
const clientSpell = clientObject?.mSpell || null;
const clientDataValues = Object.fromEntries((clientSpell?.DataValues || []).map(value => [value.name, value.values]));
const clientShield = clientSpell?.mSpellCalculations?.TotalShield || null;
const clientShieldParts = clientShield?.mFormulaParts || [];
const candidateEffectKeys = (candidate.write?.effects || []).map(effect => effect.effectKey);
const levelValues = name => (clientDataValues[name] || []).slice(1, 6);
const sourceChecks = {
  candidateSkillKey: candidate.skillKey === target.skillKey,
  candidateEffectsPresent: target.expectedEffects.every(key => candidateEffectKeys.includes(key)),
  candidateTriggerRulesEmpty: Array.isArray(candidate.write?.triggerRules) && candidate.write.triggerRules.length === 0,
  officialChampionPresent: Boolean(officialChampion),
  officialSpellPresent: Boolean(officialSpell),
  officialMaxRank: officialSpell?.maxrank === 5,
  officialNoResourceCost: Array.isArray(officialSpell?.cost) && officialSpell.cost.every(value => value === 0),
  clientSpellPresent: Boolean(clientSpell),
  clientUpfrontDuration: levelValues('UpfrontDuration').every(value => Math.abs(value - 0.75) < 0.000001),
  clientUpfrontTenacity: levelValues('UpfrontTenacity').every(value => Math.abs(value - 0.6) < 0.000001),
  clientShieldCalculation: clientShieldParts.some(part => part.__type === 'NamedDataValueCalculationPart' && part.mDataValue === 'BaseShield') && clientShieldParts.some(part => part.__type === 'StatByNamedDataValueCalculationPart' && part.mDataValue === 'ShieldHealthRatio'),
  clientShieldSourceValues: levelValues('BaseShield').join(',') === '65,85,105,125,145'
};
const sourceSnapshot = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  sourcePolicy: '固定客户端16.17与官方16.17.1；只读取指定候选和规划来源，不使用外部最新资料覆盖。',
  methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
  authorizationValueRecorded: false,
  sourceFiles: sourceRecords,
  candidate: { path: candidatePath, meta: candidateRoot.meta || null, skill: candidate },
  official: { path: officialPath, championKey: target.officialChampionKey, championName: officialChampion?.name || null, spell: officialSpell },
  clientExtraction: {
    path: clientPath,
    pointer: `${target.clientPointer}/mSpell`,
    spellTags: clientSpell?.mSpellTags || [],
    dataValues: {
      UpfrontDuration: clientDataValues.UpfrontDuration || null,
      UpfrontTenacity: clientDataValues.UpfrontTenacity || null,
      BaseShield: clientDataValues.BaseShield || null,
      ShieldHealthRatio: clientDataValues.ShieldHealthRatio || null
    },
    totalShield: clientShield,
    cooldownValues: clientSpell?.Cooldown?.values || null
  },
  acceptedFacts: {
    trigger: { skillKey: target.skillKey, ruleKey: target.ruleKey, eventType: 'SKILL_USED', eventDetail: { sourceSkillKey: target.skillKey, useKind: 'ACTIVE' }, targetContext: 'CURRENT_TARGET', actionType: 'EXECUTE_EFFECT', effectKeys: target.expectedEffects },
    effectResults: target.expectedEffects.map(effectKey => ({ effectKey, resultTarget: 'SOURCE', durationParameter: 'upfront_duration_ms' })),
    boundary: target.excluded
  },
  sourceChecks
};
writeJson('03-来源快照.json', sourceSnapshot);

let getCount = 0;
const statusCounts = {};
const requestLog = [];
async function get(route) {
  getCount += 1;
  const response = await fetch(baseUrl + route, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { parseError: true, responseBytes: Buffer.byteLength(text) }; }
  statusCounts[String(response.status)] = (statusCounts[String(response.status)] || 0) + 1;
  const result = { method: 'GET', route, status: response.status, data };
  requestLog.push({ method: 'GET', route, status: response.status });
  return result;
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
  assert.equal(response.status, expected, `${label} 预期 ${expected}，实际 ${response.status}`);
  return response;
}
function arrayData(response, label) {
  requireStatus(response, 200, label);
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.data?.items)) return response.data.items;
  throw new Error(`${label} 没有数组结果`);
}
function checkKeys(items, keyName, label) {
  const keys = items.map(item => item[keyName]);
  assert(keys.every(key => typeof key === 'string' && key.length > 0), `${label} 存在空键`);
  assert.equal(new Set(keys).size, keys.length, `${label} 存在重复键`);
  return keys;
}
async function readComponents() {
  const components = {};
  for (const [apiName, keyName] of componentKinds) {
    const listRoute = `/skills/${encodeURIComponent(target.skillKey)}/${apiName}`;
    const listResponse = await get(listRoute);
    const items = arrayData(listResponse, listRoute);
    const keys = checkKeys(items, keyName, listRoute);
    const detailRoutes = keys.map(key => `${listRoute}/${encodeURIComponent(key)}`);
    const detailResponses = await getMany(detailRoutes);
    detailResponses.forEach((response, index) => requireStatus(response, 200, detailRoutes[index]));
    components[apiName] = { list: listResponse, keys: keys.slice().sort(), details: detailResponses.map((response, index) => ({ key: keys[index], response })) };
  }
  return components;
}
async function readTarget() {
  const staticRoutes = [
    `/characters/${target.ownerKey}`,
    `/characters/${target.ownerKey}/attributes`,
    `/characters/${target.ownerKey}/representative-image`,
    `/character-skill-relations?characterKey=${target.ownerKey}`,
    `/character-skill-relations?skillKey=${target.skillKey}`,
    `/skills/${target.skillKey}`,
    `/skills/${target.skillKey}/representative-image`
  ];
  const staticResponses = {};
  for (const route of staticRoutes) staticResponses[route] = requireStatus(await get(route), 200, route);
  const components = await readComponents();
  const candidateDetailRoute = `/skills/${target.skillKey}/trigger-rules/${target.ruleKey}`;
  const candidateDetail = await get(candidateDetailRoute);
  const relationForward = arrayData(staticResponses[`/character-skill-relations?characterKey=${target.ownerKey}`], '角色正向关系');
  const relationReverse = arrayData(staticResponses[`/character-skill-relations?skillKey=${target.skillKey}`], '角色反向关系');
  const skillImage = staticResponses[`/skills/${target.skillKey}/representative-image`].data?.image;
  const ownerImage = staticResponses[`/characters/${target.ownerKey}/representative-image`].data?.image;
  return {
    staticResponses,
    components,
    candidateDetail,
    relationForward,
    relationReverse,
    checks: {
      relationForwardExact: relationForward.some(item => item.characterKey === target.ownerKey && item.skillKey === target.skillKey),
      relationReverseExact: relationReverse.length === 1 && relationReverse[0].characterKey === target.ownerKey && relationReverse[0].skillKey === target.skillKey,
      skillImagePresent: skillImage?.enabled === true && Boolean(skillImage.imageKey),
      ownerImagePresent: ownerImage?.enabled === true && Boolean(ownerImage.imageKey),
      triggerListEmpty: components['trigger-rules'].keys.length === 0,
      candidateDetail404: candidateDetail.status === 404
    }
  };
}
async function readCatalog(listRoute, keyName, label) {
  const listResponse = await get(listRoute);
  const items = arrayData(listResponse, `${label}列表`);
  const keys = checkKeys(items, keyName, `${label}列表`);
  const detailRoutes = keys.map(key => `${listRoute}/${encodeURIComponent(key)}`);
  const detailResponses = await getMany(detailRoutes);
  detailResponses.forEach((response, index) => requireStatus(response, 200, detailRoutes[index]));
  return { list: listResponse, keys: keys.slice().sort(), details: detailResponses.map((response, index) => ({ key: keys[index], response })) };
}
const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const sortRefs = refs => refs.slice().sort((a, b) => a.skillKey.localeCompare(b.skillKey) || a.ruleKey.localeCompare(b.ruleKey));
async function scanRules() {
  const skillsResponse = await get('/skills');
  const skills = arrayData(skillsResponse, '全技能目录');
  const skillKeys = checkKeys(skills, 'skillKey', '全技能目录').slice().sort();
  const listResponses = await getMany(skillKeys.map(key => `/skills/${encodeURIComponent(key)}/trigger-rules`));
  const lists = listResponses.map((response, index) => {
    const route = `/skills/${encodeURIComponent(skillKeys[index])}/trigger-rules`;
    const rules = arrayData(response, route);
    const ruleKeys = checkKeys(rules, 'ruleKey', route).slice().sort();
    return { skillKey: skillKeys[index], response, rules, ruleKeys };
  });
  const refs = sortRefs(lists.flatMap(item => item.ruleKeys.map(ruleKey => ({ skillKey: item.skillKey, ruleKey }))));
  const detailRoutes = refs.map(ref => `/skills/${encodeURIComponent(ref.skillKey)}/trigger-rules/${encodeURIComponent(ref.ruleKey)}`);
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
function componentDetail(snapshot, apiName, key) {
  return snapshot.components[apiName].details.find(item => item.key === key)?.response.data || null;
}
function checkEffect(effectKey, spec) {
  const effect = componentDetail(targetSnapshot, 'effects', effectKey);
  const result = effect?.results?.[0];
  const value = result?.valueRule?.value;
  const checks = {
    present: Boolean(effect),
    lifecyclePresent: Boolean(effect?.lifecycle),
    durationParameter: effect?.lifecycle?.durationValue?.kind === 'PARAMETER' && effect.lifecycle.durationValue.parameterKey === spec.durationParameter,
    instanceScopeSource: effect?.lifecycle?.instanceScope === 'SOURCE',
    maxStacksOne: effect?.lifecycle?.maxStacksValue?.kind === 'FIXED' && effect.lifecycle.maxStacksValue.value === 1,
    resultPresent: Boolean(result),
    resultType: result?.resultType === spec.resultType,
    resultTargetSource: result?.target === spec.resultTarget,
    valueReference: value?.kind === spec.valueKind && (value.formulaKey === spec.valueKey || value.parameterKey === spec.valueKey)
  };
  for (const [key, expected] of Object.entries(spec.detailChecks || {})) checks[`detail_${key}`] = result?.detail?.[key] === expected;
  return { effectKey, observed: { effectKeys: effect ? [effect.effectKey] : [], resultType: result?.resultType || null, resultTarget: result?.target || null, duration: effect?.lifecycle?.durationValue || null, value: value || null, detail: result?.detail || null }, checks, pass: Object.values(checks).every(Boolean) };
}

const targetSnapshot = await readTarget();
const attributes = await readCatalog('/attributes', 'attributeKey', '属性');
const modifierZones = await readCatalog('/modifier-zones', 'modifierZoneKey', '修正区域');
const damageTypes = await readCatalog('/damage-types', 'damageTypeKey', '伤害类型');
const firstScan = await scanRules();
const secondScan = await scanRules();
const firstRuleKeys = firstScan.refs.map(ref => `${ref.skillKey}/${ref.ruleKey}`);
const secondRuleKeys = secondScan.refs.map(ref => `${ref.skillKey}/${ref.ruleKey}`);
const firstDetailMap = new Map(firstScan.details.map(item => [`${item.skillKey}/${item.ruleKey}`, item.response.data]));
const secondDetailMap = new Map(secondScan.details.map(item => [`${item.skillKey}/${item.ruleKey}`, item.response.data]));
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
const effectChecks = Object.fromEntries(target.expectedEffects.map(effectKey => [effectKey, checkEffect(effectKey, target.effectSpecs[effectKey])]));
const allExistingEffectsCaptured = targetSnapshot.components.effects.details.every(item => item.response.status === 200);
const effectSemantics = Object.values(effectChecks).every(item => item.pass);
const ruleBody = {
  ruleKey: target.ruleKey,
  name: '勇气主动使用',
  description: '接收 garen_w 主动使用；无条件在 CURRENT_TARGET 上依次执行已有 upfront_shield 和 upfront_tenacity。两个效果结果 target=SOURCE，均使用 upfront_duration_ms（750毫秒）；永久双抗、主动减伤和冷却不在本条规则中。',
  sortOrder: 10,
  eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: target.skillKey, useKind: 'ACTIVE' } },
  conditionGroups: [],
  actions: target.expectedEffects.map((effectKey, index) => ({
    actionKey: `execute_${effectKey}`,
    name: target.actionNames[index],
    actionType: 'EXECUTE_EFFECT',
    sortOrder: (index + 1) * 10,
    targetContext: 'CURRENT_TARGET',
    detail: { effectKey },
    runtimeInputBindings: [],
    resultModifiers: []
  })),
  perTargetCooldown: null,
  maxTriggersPerProcess: null
};
const ruleShapeChecks = {
  eventType: ruleBody.eventSource.eventType === 'SKILL_USED',
  sourceSkillKey: ruleBody.eventSource.detail.sourceSkillKey === target.skillKey,
  useKindActive: ruleBody.eventSource.detail.useKind === 'ACTIVE',
  noConditions: ruleBody.conditionGroups.length === 0,
  actionCount: ruleBody.actions.length === target.expectedEffects.length,
  actionOrder: ruleBody.actions.every((action, index) => action.detail.effectKey === target.expectedEffects[index] && action.sortOrder === (index + 1) * 10),
  currentTarget: ruleBody.actions.every(action => action.targetContext === 'CURRENT_TARGET'),
  executeEffect: ruleBody.actions.every(action => action.actionType === 'EXECUTE_EFFECT'),
  noCooldownFields: ruleBody.perTargetCooldown === null && ruleBody.maxTriggersPerProcess === null
};
const baselineMatches = firstScan.skillKeys.length === expectedCurrent.skillCount && firstScan.refs.length === expectedCurrent.ruleCount && sourceInitializedCount === expectedCurrent.sourceInitializedCount;
const targetChecks = {
  targetRelations: targetSnapshot.checks.relationForwardExact && targetSnapshot.checks.relationReverseExact,
  targetImages: targetSnapshot.checks.skillImagePresent && targetSnapshot.checks.ownerImagePresent,
  targetTriggerEmpty: targetSnapshot.checks.triggerListEmpty,
  candidateDetail404: targetSnapshot.checks.candidateDetail404,
  allExistingEffectsCaptured,
  effectSemantics,
  sourceChecks: Object.values(sourceChecks).every(Boolean),
  ruleShape: Object.values(ruleShapeChecks).every(Boolean)
};
const conflicts = targetSnapshot.components['trigger-rules'].keys.includes(target.ruleKey)
  ? [{ skillKey: target.skillKey, ruleKey: target.ruleKey, issue: '目标规则已存在，禁止重复创建' }]
  : [];
const ready = baselineMatches && Object.values(stableRead).slice(0, 4).every(Boolean) && Object.values(targetChecks).every(Boolean) && conflicts.length === 0;
const frozen = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: ready ? 'READY_FOR_INDEPENDENT_REVIEW' : 'REVISE',
  writable: ready,
  sourceVersion: { client: '16.17', official: '16.17.1' },
  sourceSnapshotSha256: fileDigest('03-来源快照.json'),
  expectedCurrent,
  observedCurrent: { skillCount: firstScan.skillKeys.length, ruleCount: firstScan.refs.length, sourceInitializedCount, eventTypeCounts: eventCounts(firstScan.details), stableRead },
  targetBefore: { ownerKey: target.ownerKey, skillKey: target.skillKey, ruleKeys: targetSnapshot.components['trigger-rules'].keys, candidateDetailStatus: targetSnapshot.candidateDetail.status, existingEffectKeys: targetSnapshot.components.effects.keys, effectChecks },
  semanticChecks: { sourceChecks, targetChecks, ruleShapeChecks },
  plannedWrites: ready ? 1 : 0,
  writes: ready ? [{ id: `${target.skillKey}-${target.ruleKey}`, kind: '新增触发规则', method: 'POST', route: `/skills/${target.skillKey}/trigger-rules`, detailRoute: `/skills/${target.skillKey}/trigger-rules/${target.ruleKey}`, expectedStatus: 201, body: ruleBody }] : [],
  conflicts,
  excluded: target.excluded
};
writeJson('02-冻结请求.json', frozen);
const baseline = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  baseUrl,
  requestPolicy: { businessMethodsSent: ['GET'], authorizationValueRecorded: false, businessWritesIssued: 0 },
  authMode: 'PROCESS_GENERATED_TOKEN',
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
  triggerRuleStableSecondScan: { skillCount: secondScan.skillKeys.length, ruleListCount: secondScan.lists.length, ruleCount: secondScan.refs.length, skillKeys: secondScan.skillKeys, ruleKeys: secondRuleKeys, verification: stableRead },
  preservation: { existingRuleCount: firstScan.refs.length, existingRuleKeys: firstRuleKeys, expectedFinalRuleCount: ready ? firstScan.refs.length + 1 : firstScan.refs.length, expectedNewRuleKey: ready ? `${target.skillKey}/${target.ruleKey}` : null },
  getCount,
  statusCounts,
  requestLog,
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
  authMode: 'PROCESS_GENERATED_TOKEN',
  sourceFiles: sourceRecords.length,
  experienceFindings: [
    '主动自身效果规则要把 sourceSkillKey 与 useKind=ACTIVE 一起保存；CURRENT_TARGET 是动作输入目标，效果详情中的 target=SOURCE 决定护盾和韧性落在盖伦自身。',
    '盖伦 W 已有两个主动效果，动作必须按 upfront_shield、upfront_tenacity 的顺序同时接入；只接护盾会漏掉0.75秒韧性。',
    '两个效果都引用 upfront_duration_ms，实时详情确认该参数对应750毫秒；永久双抗、主动减伤和冷却保留在后续机制边界。'
  ],
  limitations: [
    '本批没有验证击杀叠层、主动减伤乘区、冷却起点或防御过程。',
    '静态来源、管理接口 GET 和本脚本检查不能证明战斗运行时已经产生 SKILL_USED 或正确消费两个效果。'
  ],
  hashes: { sourceSnapshot: fileDigest('03-来源快照.json'), frozenRequest: fileDigest('02-冻结请求.json'), baseline: fileDigest('04-写入前现值.json') },
  getStats: { total: getCount, statusCounts, expected404: [targetSnapshot.candidateDetail.route], unexpectedStatusCount: Object.entries(statusCounts).filter(([status]) => !['200', '404'].includes(status)).reduce((sum, [, count]) => sum + count, 0) },
  currentBaseline: { skillCount: firstScan.skillKeys.length, triggerRuleCount: firstScan.refs.length, sourceInitializedCount, eventTypeCounts: eventCounts(firstScan.details), conditionTypeCounts: conditionCounts(firstScan.details), allRuleDetailGets: firstScan.details.length, allRuleDetailStatuses200: firstScan.details.every(item => item.response.status === 200), baselineMatches },
  targetChecks: { ownerStatus: targetSnapshot.staticResponses[`/characters/${target.ownerKey}`].status, skillStatus: targetSnapshot.staticResponses[`/skills/${target.skillKey}`].status, relationForwardCount: targetSnapshot.relationForward.length, relationReverseCount: targetSnapshot.relationReverse.length, componentCounts: Object.fromEntries(componentKinds.map(([kind]) => [kind, targetSnapshot.components[kind].keys.length])), existingEffectKeys: targetSnapshot.components.effects.keys, ruleKeysBefore: targetSnapshot.components['trigger-rules'].keys, candidateDetailStatus: targetSnapshot.candidateDetail.status, effectChecks, allExistingEffectsCaptured },
  sourceChecks,
  stableRead,
  plannedPost: ready ? { count: 1, route: frozen.writes[0].route, detailRoute: frozen.writes[0].detailRoute, ruleKey: target.ruleKey, eventType: ruleBody.eventSource.eventType, sourceSkillKey: ruleBody.eventSource.detail.sourceSkillKey, useKind: ruleBody.eventSource.detail.useKind, targetContexts: ruleBody.actions.map(action => action.targetContext), actionEffectKeys: ruleBody.actions.map(action => action.detail.effectKey), actionResultTargets: target.expectedEffects.map(effectKey => effectChecks[effectKey].observed.resultTarget), durations: target.expectedEffects.map(effectKey => effectChecks[effectKey].observed.duration), perTargetCooldown: null, maxTriggersPerProcess: null } : null,
  nextStep: ready ? '独立评审 02-冻结请求.json 后，才可由受保护写入流程执行唯一 POST；本脚本本轮未写入。' : '先处理基线漂移或 semanticChecks 失败项；本轮没有可提交 POST。'
};
writeJson('05-只读准备报告.json', report);
console.log(JSON.stringify({ status: report.status, conclusion: report.conclusion, methodPolicy: report.methodPolicy, businessWrites: 0, getCount, statusCounts, skillCount: firstScan.skillKeys.length, triggerRuleCount: firstScan.refs.length, sourceInitializedCount, targetRuleKeysBefore: targetSnapshot.components['trigger-rules'].keys, plannedPostCount: frozen.plannedWrites, sourceSnapshotSha256: report.hashes.sourceSnapshot, frozenRequestSha256: report.hashes.frozenRequest, baselineSha256: report.hashes.baseline }, null, 2));
