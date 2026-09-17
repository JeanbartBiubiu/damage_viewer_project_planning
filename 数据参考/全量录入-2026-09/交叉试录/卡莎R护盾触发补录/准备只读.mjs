import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = 'C:/project/damage_web_dev';
const planning = 'C:/project/damage_viewer_project_planning';
const baseUrl = process.env.DAMAGE_ENTRY_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_ENTRY_TOKEN;
assert(token && token.trim(), '必须提供非空 DAMAGE_ENTRY_TOKEN；令牌不会写入或输出');

const config = {
  ownerKey: 'champion_kaisa',
  ownerName: '卡莎',
  skillKey: 'kaisa_r',
  skillName: '卡莎·猎手本能',
  effectKey: 'self_shield',
  formulaKey: 'shield_value',
  ruleKey: 'on_used',
  candidatePath: path.join(repoRoot, '数据参考', '全量录入-2026-09', '交叉试录', 'Cursor', '英雄机制第三十二批', '完整候选.json'),
  sourceManifestPath: path.join(repoRoot, '数据参考', '全量录入-2026-09', '交叉试录', 'Cursor', '英雄机制第三十二批', '来源哈希汇总.json'),
  inputVersionPath: path.join(repoRoot, '数据参考', '全量录入-2026-09', '交叉试录', 'Cursor', '英雄机制第三十二批', '输入包', '输入版本.json'),
  clientPath: path.join(planning, '数据参考', '全量录入-2026-09', '技能公共参数实录', '客户端原文', 'Kaisa.json.gz'),
  officialZhPath: path.join(planning, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'zh_CN', 'champion', 'Kaisa.json'),
  officialEnPath: path.join(planning, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'en_US', 'champion', 'Kaisa.json'),
  clientPointer: 'Characters/Kaisa/Spells/KaisaRAbility/KaisaR',
  officialSpellId: 'KaisaR',
  officialChampionId: 'Kaisa'
};

const expectedCurrent = { skillCount: 1062, ruleCount: 104, sourceInitializedCount: 24 };
const componentKinds = [
  ['parameters', 'parameterKey'],
  ['formulas', 'formulaKey'],
  ['effects', 'effectKey'],
  ['processes', 'processKey'],
  ['internal-states', 'stateKey'],
  ['trigger-rules', 'ruleKey']
];

const statusCounts = {};
const requestLog = [];
let getCount = 0;

const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(Buffer.from(JSON.stringify(value), 'utf8'));
const localPath = name => path.join(here, name);
const fileSha = filePath => shaBytes(fs.readFileSync(filePath));
const fileDigest = name => fileSha(localPath(name));
const writeJson = (name, value) => fs.writeFileSync(localPath(name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readGzipJson = filePath => JSON.parse(gunzipSync(fs.readFileSync(filePath)));
const listData = response => Array.isArray(response.data) ? response.data : (response.data?.items || []);
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value && Object.prototype.hasOwnProperty.call(value, key)).map(key => [key, value[key]]));

function fileRecord(kind, filePath) {
  assert(fs.existsSync(filePath), `来源文件不存在：${filePath}`);
  const bytes = fs.readFileSync(filePath);
  const record = { kind, path: filePath, byteSize: bytes.byteLength, sha256: shaBytes(bytes) };
  if (filePath.toLowerCase().endsWith('.gz')) {
    const expanded = gunzipSync(bytes);
    record.decompressedByteSize = expanded.byteLength;
    record.decompressedSha256 = shaBytes(expanded);
  }
  return record;
}

function findNode(value, predicate) {
  if (!value || typeof value !== 'object') return false;
  if (predicate(value)) return true;
  return Array.isArray(value)
    ? value.some(item => findNode(item, predicate))
    : Object.values(value).some(item => findNode(item, predicate));
}

function readCandidate() {
  const document = readJson(config.candidatePath);
  const candidate = Object.values(document.skills || {}).find(item => item.skillKey === config.skillKey);
  assert(candidate, `候选文件没有 ${config.skillKey}`);
  return { document, candidate };
}

function readClientExcerpt() {
  const document = readGzipJson(config.clientPath);
  const object = document[config.clientPointer];
  assert(object?.mSpell, `客户端没有 ${config.clientPointer}`);
  const spell = object.mSpell;
  const values = Object.fromEntries((spell.DataValues || [])
    .filter(value => ['RBaseValue', 'RShieldDuration', 'RTotalADRatio', 'RAPRatio'].includes(value.name))
    .map(value => [value.name, value.values]));
  return {
    objectPath: config.clientPointer,
    spellTags: spell.mSpellTags || [],
    dataValues: values,
    calculations: { RCalculatedShieldValue: spell.mSpellCalculations?.RCalculatedShieldValue || null },
    spellCastTime: spell.spellCastTime,
    cooldownTime: spell.cooldownTime,
    castRangeDisplayOverride: spell.castRangeDisplayOverride,
    castRadius: spell.castRadius,
    targetingType: spell.mTargetingTypeData || null,
    mana: spell.mana
  };
}

function readOfficialExcerpt(filePath) {
  const document = readJson(filePath);
  const champion = document.data?.[config.officialChampionId];
  const spell = champion?.spells?.find(item => item.id === config.officialSpellId);
  assert(spell, `官方资料没有 ${config.officialSpellId}：${filePath}`);
  return pick(spell, ['id', 'name', 'description', 'tooltip', 'leveltip', 'maxrank', 'cooldown', 'cost', 'range', 'effect', 'image']);
}

function sourceRecords() {
  return [
    fileRecord('卡莎候选与批次记录', config.candidatePath),
    fileRecord('卡莎来源散列汇总', config.sourceManifestPath),
    fileRecord('卡莎输入版本', config.inputVersionPath),
    fileRecord('卡莎客户端完整原文', config.clientPath),
    fileRecord('卡莎官方中文资料', config.officialZhPath),
    fileRecord('卡莎官方英文资料', config.officialEnPath)
  ];
}

function makeSourceSnapshot() {
  const { document, candidate } = readCandidate();
  const records = sourceRecords();
  const client = readClientExcerpt();
  const officialZh = readOfficialExcerpt(config.officialZhPath);
  const officialEn = readOfficialExcerpt(config.officialEnPath);
  const candidateSource = candidate.source || {};
  const candidateShield = candidate.write?.effects?.find(item => item.effectKey === config.effectKey);
  const candidateResult = candidateShield?.results?.[0];
  const candidateFormula = candidate.write?.formulas?.find(item => item.formulaKey === config.formulaKey);
  const clientRecord = records.find(record => record.kind === '卡莎客户端完整原文');
  const officialZhRecord = records.find(record => record.kind === '卡莎官方中文资料');
  const officialEnRecord = records.find(record => record.kind === '卡莎官方英文资料');
  const sourceChecks = {
    candidatePresent: Boolean(candidate),
    candidateEffectPresent: Boolean(candidateShield),
    candidateFormulaPresent: Boolean(candidateFormula),
    candidateResultSelfShield: candidateResult?.resultType === 'NORMAL_SHIELD' && candidateResult.target === 'SOURCE' && candidateResult.valueRule?.value?.kind === 'FORMULA' && candidateResult.valueRule.value.formulaKey === config.formulaKey,
    candidateLifecycleSource: candidateShield?.lifecycle?.instanceScope === 'SOURCE' && candidateShield.lifecycle.durationValue?.kind === 'PARAMETER' && candidateShield.lifecycle.durationValue.parameterKey === 'shield_duration_ms',
    candidateClientHash: candidateSource.clientSha256 === clientRecord.decompressedSha256,
    candidateCompressedClientHash: candidateSource.clientCompressedSha256 === clientRecord.sha256,
    candidateOfficialZhHash: candidateSource.officialZhSha256 === officialZhRecord.sha256,
    candidateOfficialEnHash: candidateSource.officialEnSha256 === officialEnRecord.sha256,
    clientShieldTag: client.spellTags.includes('Trait_Shield'),
    clientShieldDuration: Array.isArray(client.dataValues.RShieldDuration) && client.dataValues.RShieldDuration.every(value => value === 2),
    clientShieldCalculation: findNode(client.calculations.RCalculatedShieldValue, node => node.__type === 'NamedDataValueCalculationPart' && node.mDataValue === 'RBaseValue') && findNode(client.calculations.RCalculatedShieldValue, node => node.__type === 'StatByNamedDataValueCalculationPart' && node.mDataValue === 'RTotalADRatio') && findNode(client.calculations.RCalculatedShieldValue, node => node.__type === 'StatByNamedDataValueCalculationPart' && node.mDataValue === 'RAPRatio'),
    officialZhShieldText: `${officialZh.description || ''}${officialZh.tooltip || ''}`.includes('护盾'),
    officialEnShieldText: `${officialEn.description || ''}${officialEn.tooltip || ''}`.toLowerCase().includes('shield'),
    officialSpellRank: officialZh.maxrank === 3 && officialEn.maxrank === 3
  };
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    sourcePolicy: '固定客户端16.17与官方16.17.1；只读取本地候选、规划来源和固定资料，不使用外部最新资料覆盖。',
    methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
    authorizationValueRecorded: false,
    sourceFiles: records,
    candidate: {
      path: config.candidatePath,
      batch: document.meta?.batch || null,
      sha256: records.find(record => record.kind === '卡莎候选与批次记录').sha256,
      source: candidate.source || null,
      write: candidate.write || null,
      pending: candidate.pending || [],
      excluded: candidate.excluded || []
    },
    client: { path: config.clientPath, excerpt: client },
    official: {
      zh: { path: config.officialZhPath, pointer: `data.${config.officialChampionId}.spells[id=${config.officialSpellId}]`, excerpt: officialZh },
      en: { path: config.officialEnPath, pointer: `data.${config.officialChampionId}.spells[id=${config.officialSpellId}]`, excerpt: officialEn }
    },
    acceptedFacts: {
      trigger: {
        skillKey: config.skillKey,
        ruleKey: config.ruleKey,
        eventType: 'SKILL_USED',
        eventDetail: { sourceSkillKey: config.skillKey, useKind: 'ACTIVE' },
        targetContext: 'CURRENT_TARGET',
        actionType: 'EXECUTE_EFFECT',
        effectKey: config.effectKey
      },
      targetSemantics: '动作使用 CURRENT_TARGET；已有 self_shield 的结果 target 为 SOURCE，因此护盾只落在卡莎自身。',
      boundary: [
        '只消费宿主已确认合法的主动使用事件。',
        '不表达电浆资格、附近判定、跃迁、位移落点或空间范围。',
        '不重复执行施放资格、法力消耗或冷却，不新增参数、公式或效果。'
      ]
    },
    sourceChecks
  };
}

async function get(route) {
  const response = await fetch(baseUrl + route, {
    method: 'GET',
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { parseError: true, responseBytes: Buffer.byteLength(text) }; }
  getCount += 1;
  statusCounts[String(response.status)] = (statusCounts[String(response.status)] || 0) + 1;
  const record = { method: 'GET', route, status: response.status, data };
  requestLog.push(record);
  return record;
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
    const listRoute = `/skills/${encodeURIComponent(config.skillKey)}/${apiName}`;
    const listResponse = await get(listRoute);
    const items = arrayData(listResponse, listRoute);
    const keys = checkKeys(items, keyName, listRoute);
    const detailRoutes = keys.map(key => `${listRoute}/${encodeURIComponent(key)}`);
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
    `/characters/${config.ownerKey}`,
    `/characters/${config.ownerKey}/attributes`,
    `/characters/${config.ownerKey}/representative-image`,
    `/character-skill-relations?characterKey=${config.ownerKey}`,
    `/character-skill-relations?skillKey=${config.skillKey}`,
    `/skills/${config.skillKey}`,
    `/skills/${config.skillKey}/representative-image`
  ];
  const staticResponses = {};
  for (const route of staticRoutes) staticResponses[route] = requireStatus(await get(route), 200, route);
  const components = await readComponents();
  const candidateRoute = `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`;
  const candidateDetail = await get(candidateRoute);
  assert([200, 404].includes(candidateDetail.status), `${candidateRoute} 预期 200 或 404，实际 ${candidateDetail.status}`);
  const relationForward = arrayData(staticResponses[`/character-skill-relations?characterKey=${config.ownerKey}`], '角色正向关系');
  const relationReverse = arrayData(staticResponses[`/character-skill-relations?skillKey=${config.skillKey}`], '角色反向关系');
  const skillImage = staticResponses[`/skills/${config.skillKey}/representative-image`].data?.image;
  const ownerImage = staticResponses[`/characters/${config.ownerKey}/representative-image`].data?.image;
  return {
    staticResponses,
    components,
    candidateDetail,
    relationForward,
    relationReverse,
    checks: {
      ownerSubject: staticResponses[`/characters/${config.ownerKey}`].data?.characterKey === config.ownerKey,
      skillSubject: staticResponses[`/skills/${config.skillKey}`].data?.skillKey === config.skillKey,
      relationForwardExact: relationForward.some(item => item.characterKey === config.ownerKey && item.skillKey === config.skillKey),
      relationReverseExact: relationReverse.length === 1 && relationReverse[0].characterKey === config.ownerKey && relationReverse[0].skillKey === config.skillKey,
      skillImagePresent: skillImage?.enabled === true && Boolean(skillImage?.imageKey),
      ownerImagePresent: ownerImage?.enabled === true && Boolean(ownerImage?.imageKey),
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
  return {
    list: listResponse,
    keys: keys.slice().sort(),
    details: detailResponses.map((response, index) => ({ key: keys[index], response }))
  };
}

function sameList(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }
function sortRefs(refs) { return refs.slice().sort((a, b) => a.skillKey.localeCompare(b.skillKey) || a.ruleKey.localeCompare(b.ruleKey)); }

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
  return {
    skillsResponse,
    skills,
    skillKeys,
    lists,
    refs,
    details: detailResponses.map((response, index) => ({ ...refs[index], response }))
  };
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

function bodyForRule() {
  return {
    ruleKey: config.ruleKey,
    name: '猎手本能主动使用',
    description: '仅消费宿主已确认合法的 kaisa_r 主动使用事件；在 CURRENT_TARGET 上执行已有 self_shield。self_shield 结果目标为 SOURCE，因此只给卡莎自身护盾；不表达电浆资格、附近判定、跃迁、位移、空间范围、施放资格、资源或冷却。',
    sortOrder: 10,
    eventSource: { eventType: 'SKILL_USED', detail: { sourceSkillKey: config.skillKey, useKind: 'ACTIVE' } },
    conditionGroups: [],
    actions: [{
      actionKey: 'execute_self_shield',
      name: '执行猎手本能自身护盾',
      actionType: 'EXECUTE_EFFECT',
      sortOrder: 10,
      targetContext: 'CURRENT_TARGET',
      detail: { effectKey: config.effectKey },
      runtimeInputBindings: [],
      resultModifiers: []
    }],
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const sourceSnapshot = makeSourceSnapshot();
  writeJson('03-来源快照.json', sourceSnapshot);
  const sourceSnapshotSha256 = fileDigest('03-来源快照.json');

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
    stableRuleDetails: firstRuleKeys.length === secondRuleKeys.length && firstRuleKeys.every(key => isDeepStrictEqual(firstDetailMap.get(key), secondDetailMap.get(key))),
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
  const shieldEffect = componentDetail(targetSnapshot, 'effects', config.effectKey);
  const shieldResult = shieldEffect?.results?.[0];
  const shieldFormula = componentDetail(targetSnapshot, 'formulas', config.formulaKey);
  const componentRead = componentKinds.every(([apiName]) => targetSnapshot.components[apiName].details.every(item => item.response.status === 200));
  const liveChecks = {
    skillCount: firstScan.skillKeys.length === expectedCurrent.skillCount && secondScan.skillKeys.length === expectedCurrent.skillCount,
    ruleCount: firstRuleKeys.length === expectedCurrent.ruleCount && secondRuleKeys.length === expectedCurrent.ruleCount,
    sourceInitializedCount: sourceInitializedCount === expectedCurrent.sourceInitializedCount && secondScan.details.filter(item => item.response.data?.eventSource?.eventType === 'SOURCE_INITIALIZED').length === expectedCurrent.sourceInitializedCount,
    globalTwoPassStable: stableRead.stableSkillKeys && stableRead.stableRuleKeys && stableRead.stableRuleCount && stableRead.stableRuleDetails,
    targetRelations: targetSnapshot.checks.relationForwardExact && targetSnapshot.checks.relationReverseExact,
    targetImages: targetSnapshot.checks.skillImagePresent && targetSnapshot.checks.ownerImagePresent,
    targetSubjects: targetSnapshot.checks.ownerSubject && targetSnapshot.checks.skillSubject,
    targetComponentsReadable: componentRead,
    targetTriggerEmpty: targetSnapshot.checks.triggerListEmpty,
    candidate404: targetSnapshot.checks.candidateDetail404,
    shieldPresent: Boolean(shieldEffect),
    shieldResultSemantic: shieldResult?.resultType === 'NORMAL_SHIELD' && shieldResult.target === 'SOURCE' && shieldResult.valueRule?.value?.kind === 'FORMULA' && shieldResult.valueRule.value.formulaKey === config.formulaKey,
    shieldLifecycleSemantic: shieldEffect?.lifecycle?.instanceScope === 'SOURCE' && shieldEffect.lifecycle.durationValue?.kind === 'PARAMETER' && shieldEffect.lifecycle.durationValue.parameterKey === 'shield_duration_ms' && shieldEffect.lifecycle.maxStacksValue?.kind === 'FIXED' && shieldEffect.lifecycle.maxStacksValue.value === 1,
    shieldFormulaPresent: Boolean(shieldFormula),
    shieldFormulaSourceAttributes: findNode(shieldFormula?.expression, node => node.nodeType === 'ATTRIBUTE' && node.attributeOwner === 'SOURCE' && node.attributeKey === 'attack_damage' && node.attributeValueKind === 'TOTAL') && findNode(shieldFormula?.expression, node => node.nodeType === 'ATTRIBUTE' && node.attributeOwner === 'SOURCE' && node.attributeKey === 'ability_power' && node.attributeValueKind === 'TOTAL'),
    sourceChecks: Object.values(sourceSnapshot.sourceChecks).every(Boolean)
  };
  const ruleBody = bodyForRule();
  const conflicts = targetSnapshot.components['trigger-rules'].keys.includes(config.ruleKey) || targetSnapshot.candidateDetail.status === 200
    ? [{ skillKey: config.skillKey, ruleKey: config.ruleKey, issue: '目标规则已存在，禁止重复创建' }]
    : [];
  const ready = Object.values(liveChecks).every(value => value === true) && conflicts.length === 0;
  const observedCurrent = {
    skillCount: firstScan.skillKeys.length,
    ruleCount: firstRuleKeys.length,
    sourceInitializedCount,
    eventTypeCounts: eventCounts(firstScan.details),
    conditionTypeCounts: conditionCounts(firstScan.details),
    stableRead
  };
  const frozen = {
    schemaVersion: 1,
    generatedAt: startedAt,
    status: ready ? 'READY_FOR_INDEPENDENT_REVIEW' : 'REVISE',
    writable: ready,
    sourceVersion: { client: '16.17', official: '16.17.1' },
    sourceSnapshotSha256,
    expectedCurrent,
    observedCurrent,
    targetBefore: {
      ownerKey: config.ownerKey,
      skillKey: config.skillKey,
      ruleKeys: targetSnapshot.components['trigger-rules'].keys,
      candidateDetailStatus: targetSnapshot.candidateDetail.status,
      relationForwardCount: targetSnapshot.relationForward.length,
      relationReverseCount: targetSnapshot.relationReverse.length,
      existingEffectKeys: targetSnapshot.components.effects.keys,
      existingFormulaKeys: targetSnapshot.components.formulas.keys
    },
    semanticChecks: { sourceChecks: sourceSnapshot.sourceChecks, liveChecks },
    plannedWrites: ready ? 1 : 0,
    writes: ready ? [{
      id: `${config.skillKey}/${config.ruleKey}`,
      kind: '新增触发规则',
      method: 'POST',
      route: `/skills/${config.skillKey}/trigger-rules`,
      detailRoute: `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`,
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
    authMode: 'ENVIRONMENT_TOKEN_PRESENT',
    sourceSnapshotSha256,
    frozenRequestSha256: fileDigest('02-冻结请求.json'),
    expectedCurrent,
    observedCurrent,
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
      ruleCount: secondRuleKeys.length,
      skillKeys: secondScan.skillKeys,
      ruleKeys: secondRuleKeys,
      verification: stableRead
    },
    preservation: {
      existingRuleCount: firstRuleKeys.length,
      existingRuleKeys: firstRuleKeys,
      expectedFinalRuleCount: ready ? firstRuleKeys.length + 1 : firstRuleKeys.length,
      expectedNewRuleKey: ready ? `${config.skillKey}/${config.ruleKey}` : null
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
    methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
    businessWrites: 0,
    authorizationValueRecorded: false,
    sourceFiles: sourceSnapshot.sourceFiles.length,
    experienceFindings: [
      'SKILL_USED 主动使用事件需要同时保留 sourceSkillKey 和 useKind=ACTIVE；现有同类 on_used 规则提供了接口结构旁证。',
      '动作目标 CURRENT_TARGET 与效果结果目标 SOURCE 可以不同；本批只借用已有 self_shield 的 SOURCE 结果，不把电浆资格、附近判定或位移写进规则。',
      '候选文件、固定客户端和官方资料的散列在本地重新核对；完整两轮旧规则扫描约需两千余次 GET，耗时会随服务负载变化。'
    ],
    deficiencies: [
      '本准备阶段没有宿主事件生产、空间范围判定或电浆资格运行证据。',
      '静态来源和管理接口读数不能证明护盾已经在战斗运行时施加，也不能证明位移、冷却或资源消费已经接线。'
    ],
    hashes: {
      sourceSnapshot: sourceSnapshotSha256,
      frozenRequest: fileDigest('02-冻结请求.json'),
      baseline: fileDigest('04-写入前现值.json')
    },
    getStats: {
      total: getCount,
      statusCounts,
      expected404: [`/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`],
      unexpectedStatusCount: Object.entries(statusCounts).filter(([status]) => !['200', '404'].includes(status)).reduce((sum, [, count]) => sum + count, 0)
    },
    currentBaseline: {
      skillCount: firstScan.skillKeys.length,
      triggerRuleCount: firstRuleKeys.length,
      sourceInitializedCount,
      eventTypeCounts: eventCounts(firstScan.details),
      conditionTypeCounts: conditionCounts(firstScan.details),
      allRuleDetailGets: firstScan.details.length,
      allRuleDetailStatuses200: firstScan.details.every(item => item.response.status === 200),
      expectedCurrent
    },
    targetChecks: {
      ownerStatus: targetSnapshot.staticResponses[`/characters/${config.ownerKey}`].status,
      skillStatus: targetSnapshot.staticResponses[`/skills/${config.skillKey}`].status,
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
      ownerImageKey: targetSnapshot.staticResponses[`/characters/${config.ownerKey}/representative-image`].data?.image?.imageKey || null,
      skillImageKey: targetSnapshot.staticResponses[`/skills/${config.skillKey}/representative-image`].data?.image?.imageKey || null
    },
    sourceChecks: sourceSnapshot.sourceChecks,
    liveChecks,
    stableRead,
    plannedPost: ready ? {
      count: 1,
      route: frozen.writes[0].route,
      detailRoute: frozen.writes[0].detailRoute,
      ruleKey: config.ruleKey,
      eventType: ruleBody.eventSource.eventType,
      sourceSkillKey: ruleBody.eventSource.detail.sourceSkillKey,
      useKind: ruleBody.eventSource.detail.useKind,
      targetContext: ruleBody.actions[0].targetContext,
      effectKey: ruleBody.actions[0].detail.effectKey,
      actionResultTarget: shieldResult?.target || null,
      perTargetCooldown: null,
      maxTriggersPerProcess: null
    } : null,
    nextStep: ready ? '独立评审 02-冻结请求.json 后，才可由受保护写入脚本执行唯一 POST；本脚本本轮未写入。' : '先根据 semanticChecks 修订候选或补齐实库事实；本轮没有可提交 POST。'
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
    triggerRuleCount: firstRuleKeys.length,
    sourceInitializedCount,
    targetRuleKeysBefore: targetSnapshot.components['trigger-rules'].keys,
    candidateDetailStatus: targetSnapshot.candidateDetail.status,
    plannedPostCount: frozen.plannedWrites,
    sourceSnapshotSha256,
    frozenRequestSha256: report.hashes.frozenRequest,
    baselineSha256: report.hashes.baseline
  }, null, 2));
}

main().catch(error => {
  console.error(`只读准备失败：${error.message}`);
  process.exitCode = 1;
});
