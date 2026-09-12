import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const planning = 'C:/project/damage_viewer_project_planning';
const baseUrl = process.env.DAMAGE_ENTRY_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_ENTRY_TOKEN;
assert(token && token.trim(), '必须提供非空 DAMAGE_ENTRY_TOKEN；令牌不会写入或输出');

const config = {
  characterKey: 'champion_ashe',
  characterName: '艾希',
  skillKey: 'ashe_r',
  effectKey: 'hit_damage',
  ruleKey: 'actual_hit',
  candidatePath: path.join(planning, '数据参考', '全量录入-2026-09', '艾希技能实录第一批', '录入候选.json'),
  clientPath: path.join(planning, '数据参考', '全量录入-2026-09', '艾希拉克丝客户端补证', 'ashe.bin.json'),
  officialPath: path.join(planning, '数据参考', '全量录入-2026-09', '英雄', '原始资料', 'zh_CN', 'champion', 'Ashe.json'),
  historyPaths: [
    path.join(planning, '数据参考', '全量录入-2026-09', '艾希技能实录第一批', '实录回读.json'),
    path.join(planning, '数据参考', '全量录入-2026-09', '艾希技能实录第一批', '独立核对.json')
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
const statusCounts = {};
const requestLog = [];
let getCount = 0;

const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(Buffer.from(JSON.stringify(value), 'utf8'));
const writeJson = (name, value) => fs.writeFileSync(path.join(here, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const listData = response => Array.isArray(response.data) ? response.data : (response.data?.items || []);
const mapBy = (rows, key) => Object.fromEntries(rows.map(row => [row[key], row]));
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value && Object.prototype.hasOwnProperty.call(value, key)).map(key => [key, value[key]]));

async function get(route, expectedStatuses = [200]) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'GET',
    headers: { accept: 'application/json', authorization: `Bearer ${token}` }
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { rawText: text }; }
  getCount += 1;
  statusCounts[String(response.status)] = (statusCounts[String(response.status)] || 0) + 1;
  const record = { method: 'GET', route, status: response.status, data };
  requestLog.push(record);
  assert(expectedStatuses.includes(response.status), `${route} 返回 ${response.status}`);
  return record;
}

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

function findParam(expression, predicate) {
  if (!expression || typeof expression !== 'object') return false;
  if (predicate(expression)) return true;
  return Array.isArray(expression)
    ? expression.some(item => findParam(item, predicate))
    : Object.values(expression).some(item => findParam(item, predicate));
}

function bodyForRule() {
  return {
    ruleKey: config.ruleKey,
    name: '命中英雄触发水晶箭伤害',
    description: '仅在运行时确认 ashe_r 已命中英雄后，在当前目标上执行已有的 hit_damage；眩晕、距离换算、附近目标伤害、减速、弹道、视野、消耗与冷却不在本条规则中。',
    sortOrder: 10,
    eventSource: {
      eventType: 'SKILL_HIT',
      detail: { sourceSkillKey: config.skillKey }
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
        actionKey: 'execute_hit_damage',
        name: '执行水晶箭命中伤害',
        actionType: 'EXECUTE_EFFECT',
        sortOrder: 10,
        targetContext: 'CURRENT_TARGET',
        detail: { effectKey: config.effectKey },
        runtimeInputBindings: [],
        resultModifiers: []
      }
    ],
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  };
}

async function readComponents(skillKey) {
  const result = {};
  for (const [component, keyField] of componentKinds) {
    const list = await get(`/skills/${encodeURIComponent(skillKey)}/${component}`);
    const rows = listData(list);
    const keys = rows.map(row => row[keyField]);
    const details = [];
    for (const key of keys) {
      const response = await get(`/skills/${encodeURIComponent(skillKey)}/${component}/${encodeURIComponent(key)}`);
      details.push({ key, response });
    }
    result[component] = { list, keys, details };
  }
  return result;
}

async function readTarget() {
  const staticRoutes = [
    `/characters/${config.characterKey}`,
    `/characters/${config.characterKey}/attributes`,
    `/characters/${config.characterKey}/representative-image`,
    `/character-skill-relations?characterKey=${config.characterKey}`,
    `/skills/${config.skillKey}`,
    `/skills/${config.skillKey}/representative-image`
  ];
  const staticResponses = {};
  for (const route of staticRoutes) staticResponses[route] = await get(route);
  const components = await readComponents(config.skillKey);
  const candidateRoute = `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`;
  const candidateDetail = await get(candidateRoute, [404]);
  const relationRows = listData(staticResponses[`/character-skill-relations?characterKey=${config.characterKey}`]);
  assert(relationRows.some(row => row.skillKey === config.skillKey), '角色技能关系缺少 ashe_r');
  assert.equal(staticResponses[`/skills/${config.skillKey}`].data.skillKey, config.skillKey);
  assert.equal(staticResponses[`/characters/${config.characterKey}`].data.characterKey, config.characterKey);
  assert.equal(staticResponses[`/skills/${config.skillKey}/representative-image`].data.image?.enabled, true);
  assert.equal(staticResponses[`/characters/${config.characterKey}/representative-image`].data.image?.enabled, true);
  assert.equal(candidateDetail.status, 404);
  return {
    characterKey: config.characterKey,
    skillKey: config.skillKey,
    staticResponses,
    components,
    candidateDetail,
    targetRuleKeysBefore: components['trigger-rules'].keys,
    existingEffectKeys: components.effects.keys
  };
}

function validateTarget(target) {
  assert.deepEqual(target.targetRuleKeysBefore, []);
  assert.deepEqual(target.existingEffectKeys, ['hit_damage', 'mana_cost']);
  const parameters = mapBy(listData(target.components.parameters.list), 'parameterKey');
  assert(parameters.base_damage && parameters.ap_ratio, 'R命中公式参数缺失');
  const formula = target.components.formulas.details.find(item => item.key === 'hit_damage')?.response.data;
  assert(formula, 'R命中公式详情缺失');
  assert(findParam(formula.expression, node => node.nodeType === 'PARAMETER' && node.parameterKey === 'base_damage'));
  assert(findParam(formula.expression, node => node.nodeType === 'PARAMETER' && node.parameterKey === 'ap_ratio'));
  assert(findParam(formula.expression, node => node.nodeType === 'ATTRIBUTE' && node.attributeKey === 'ability_power' && node.attributeOwner === 'SOURCE'));
  const effect = target.components.effects.details.find(item => item.key === config.effectKey)?.response.data;
  assert(effect, 'R命中效果详情缺失');
  assert.equal(effect.results.length, 1);
  const result = effect.results[0];
  assert.equal(result.resultType, 'DAMAGE');
  assert.equal(result.target, 'TARGET');
  assert.equal(result.detail.damageTypeKey, 'magic');
  assert.equal(result.valueRule.value.kind, 'FORMULA');
  assert.equal(result.valueRule.value.formulaKey, 'hit_damage');
  const mana = target.components.effects.details.find(item => item.key === 'mana_cost')?.response.data;
  assert(mana, 'R法力消耗效果详情缺失');
  assert.equal(target.components.processes.keys.length, 0, 'R当前出现未预期的过程，需重新审查');
  assert.equal(target.components['internal-states'].keys.length, 0, 'R当前出现未预期的内部状态，需重新审查');
}

async function scanRules() {
  const skillList = await get('/skills');
  const skills = listData(skillList);
  assert.equal(skills.length, 1062, '全局技能数量不是 1062');
  const perSkill = [];
  let ruleCount = 0;
  for (const skill of skills) {
    const skillKey = skill.skillKey;
    const list = await get(`/skills/${encodeURIComponent(skillKey)}/trigger-rules`);
    const rows = listData(list);
    const details = [];
    for (const row of rows) {
      const ruleKey = row.ruleKey;
      const detail = await get(`/skills/${encodeURIComponent(skillKey)}/trigger-rules/${encodeURIComponent(ruleKey)}`);
      details.push({ ruleKey, response: detail });
      ruleCount += 1;
    }
    perSkill.push({ skillKey, list, ruleKeys: rows.map(row => row.ruleKey), details });
  }
  return { skillList, skillCount: skills.length, ruleCount, perSkill };
}

function scanPairs(scan) {
  return scan.perSkill.flatMap(skill => skill.ruleKeys.map(ruleKey => `${skill.skillKey}/${ruleKey}`)).sort();
}

function scanStats(scan) {
  const events = {};
  let sourceInitializedCount = 0;
  for (const skill of scan.perSkill) {
    for (const detail of skill.details) {
      const eventType = detail.response.data?.eventSource?.eventType || 'UNKNOWN';
      events[eventType] = (events[eventType] || 0) + 1;
      if (eventType === 'SOURCE_INITIALIZED') sourceInitializedCount += 1;
    }
  }
  return { skillCount: scan.skillCount, ruleCount: scan.ruleCount, eventTypeCounts: events, sourceInitializedCount };
}

async function readCatalogs() {
  const attributes = await get('/attributes');
  const abilityPower = await get('/attributes/ability_power');
  const damageTypes = await get('/damage-types');
  const magic = await get('/damage-types/magic');
  const modifierZones = await get('/modifier-zones');
  const statuses = await get('/statuses');
  assert.equal(abilityPower.status, 200);
  assert.equal(magic.status, 200);
  return {
    attributes: { list: attributes, details: [{ key: 'ability_power', response: abilityPower }] },
    damageTypes: { list: damageTypes, details: [{ key: 'magic', response: magic }] },
    modifierZones: { list: modifierZones },
    statuses: { list: statuses }
  };
}

function sourceRecords() {
  return [
    fileRecord('艾希技能候选与已有组成', config.candidatePath),
    fileRecord('艾希客户端主对象', config.clientPath),
    fileRecord('艾希官方中文资料', config.officialPath),
    ...config.historyPaths.map((filePath, index) => fileRecord(index === 0 ? '艾希技能已有实录回读' : '艾希技能已有独立核对', filePath))
  ];
}

function readClientExcerpt() {
  const document = readJson(config.clientPath);
  const objectPath = 'Characters/Ashe/Spells/EnchantedCrystalArrowAbility/EnchantedCrystalArrow';
  const object = document[objectPath];
  assert(object?.mSpell, '客户端没有艾希 R 主对象');
  const spell = object.mSpell;
  return {
    objectPath,
    spellTags: spell.mSpellTags || [],
    dataValues: spell.DataValues || [],
    calculations: spell.mSpellCalculations || {},
    castTime: spell.spellCastTime,
    cooldownTime: spell.cooldownTime,
    mana: spell.mana,
    castRange: spell.castRange,
    missileBehaviors: spell.mMissileSpec?.behaviors || [],
    targetingType: spell.mTargetingTypeData || null
  };
}

function readCandidate() {
  const document = readJson(config.candidatePath);
  const candidate = document.skills?.find(item => item.skillKey === config.skillKey);
  assert(candidate, '候选文件没有 ashe_r');
  assert.deepEqual(candidate.effects?.map(item => item.effectKey), ['hit_damage', 'mana_cost']);
  return candidate;
}

function readOfficialExcerpt() {
  const document = readJson(config.officialPath);
  const champion = document.data?.Ashe;
  const spell = champion?.spells?.find(item => item.id === 'EnchantedCrystalArrow');
  assert(spell, '官方资料没有 EnchantedCrystalArrow');
  return pick(spell, ['id', 'name', 'description', 'tooltip', 'leveltip', 'maxrank', 'cooldown', 'cost', 'effect', 'image']);
}

async function main() {
  const startedAt = new Date().toISOString();
  const candidate = readCandidate();
  const sourceSnapshot = {
    schemaVersion: 1,
    capturedAt: startedAt,
    sourcePolicy: '固定客户端16.17与官方16.17.1；只读取规划来源和已有实录，不使用外部最新资料覆盖。',
    methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
    authorizationValueRecorded: false,
    sourceFiles: sourceRecords(),
    candidate: { path: config.candidatePath, sourceHash: readJson(config.candidatePath).sourceHash || null, skill: candidate },
    client: { path: config.clientPath, pointer: 'Characters/Ashe/Spells/EnchantedCrystalArrowAbility/EnchantedCrystalArrow', excerpt: readClientExcerpt() },
    official: { path: config.officialPath, pointer: 'data/Ashe/spells[id=EnchantedCrystalArrow]', excerpt: readOfficialExcerpt() },
    acceptedFacts: {
      directHitEffect: 'hit_damage：单次命中魔法伤害，结果目标为 TARGET。',
      skippedControl: 'MinStunDuration 与 MaxStunDuration 只有时长上下界；没有距离输入、眩晕结果或距离换算。',
      skippedArea: '附近目标伤害、减速、弹道和视野没有当前完整作者效果，严格1V1不把它们并入单次命中。',
      resourceBoundary: 'mana_cost 和 cooldown 属于施法过程，命中规则不重复执行。'
    }
  };
  writeJson('03-来源快照.json', sourceSnapshot);
  const sourceSnapshotSha256 = shaValue(sourceSnapshot);
  const target = await readTarget();
  validateTarget(target);
  const catalogs = await readCatalogs();
  const firstScan = await scanRules();
  const secondScan = await scanRules();
  const firstPairs = scanPairs(firstScan);
  const secondPairs = scanPairs(secondScan);
  assert.equal(firstScan.ruleCount, 96, '全局触发规则数量不是 96');
  assert.equal(secondScan.ruleCount, 96, '第二轮全局触发规则数量不是 96');
  assert.deepEqual(firstPairs, secondPairs, '两轮全局触发规则键集合不稳定');
  assert.equal(shaValue(firstPairs), '2053880a8945cb80fa5daec9077b6c6544f991eeac4c027238e1c46ed8225023');
  const firstStats = scanStats(firstScan);
  const secondStats = scanStats(secondScan);
  assert.equal(firstStats.sourceInitializedCount, 24);
  assert.equal(secondStats.sourceInitializedCount, 24);
  const body = bodyForRule();
  const frozen = {
    schemaVersion: 1,
    generatedAt: startedAt,
    status: 'READY_FOR_INDEPENDENT_REVIEW',
    writable: true,
    sourceVersion: { client: '16.17', official: '16.17.1' },
    sourceSnapshotSha256,
    expectedCurrent: { skillCount: 1062, ruleCount: 96, sourceInitializedCount: 24 },
    observedCurrent: {
      ...firstStats,
      stableRead: {
        stableSkillKeys: true,
        stableRuleKeys: true,
        stableRuleCount: true,
        firstSkillCount: firstScan.skillCount,
        secondSkillCount: secondScan.skillCount,
        firstRuleCount: firstScan.ruleCount,
        secondRuleCount: secondScan.ruleCount,
        firstRuleKeysSha256: shaValue(firstPairs),
        secondRuleKeysSha256: shaValue(secondPairs)
      }
    },
    targetBefore: {
      characterKey: config.characterKey,
      skillKey: config.skillKey,
      ruleKeys: target.targetRuleKeysBefore,
      existingEffectKeys: target.existingEffectKeys,
      candidateDetailStatus: target.candidateDetail.status
    },
    plannedWrites: 1,
    writes: [{
      id: `${config.skillKey}-${config.ruleKey}`,
      kind: '新增触发规则',
      method: 'POST',
      route: `/skills/${config.skillKey}/trigger-rules`,
      detailRoute: `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`,
      expectedStatus: 201,
      body
    }],
    conflicts: [],
    excluded: [
      '不新增眩晕、减速、附近目标伤害、弹道、视野或距离换算。',
      '不把眩晕上下界参数当作完整控制效果，不猜填距离输入或冷却。',
      '不重复执行 mana_cost，不使用 cast 过程替代实际命中。',
      '不把静态来源、接口 GET 或本脚本检查当作战斗运行时证明。'
    ]
  };
  writeJson('02-冻结请求.json', frozen);
  const frozenRequestSha256 = shaValue(frozen);
  const writeBefore = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    baseUrl,
    requestPolicy: { businessMethodsSent: [], authorizationValueRecorded: false, businessWritesIssued: 0 },
    sourceSnapshotSha256,
    frozenRequestSha256,
    expectedCurrent: frozen.expectedCurrent,
    observedCurrent: frozen.observedCurrent,
    targetSnapshot: target,
    protectionCatalogs: catalogs,
    triggerRuleBaseline: firstScan,
    triggerRuleStableSecondScan: secondScan,
    preservation: {
      targetStaticSha256: shaValue(target.staticResponses),
      targetComponentsSha256: shaValue(target.components),
      oldRulePairsSha256: shaValue(firstPairs)
    },
    getCount,
    statusCounts,
    businessWrites: 0
  };
  writeJson('04-写入前现值.json', writeBefore);
  const checks = {
    characterSubject: true,
    skillSubject: true,
    characterAttributes: true,
    characterSkillRelation: true,
    characterRepresentativeImage: true,
    skillRepresentativeImage: true,
    parametersAndFormula: true,
    initialDamageEffect: true,
    noUnprovenControlEffect: true,
    candidateAbsent: true,
    targetRuleBaselineEmpty: true,
    globalOldRulesComplete: true,
    globalTwoPassStable: true,
    noBusinessWrite: true
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'READY_FOR_INDEPENDENT_REVIEW',
    methodPolicy: 'LOCAL_FILES_AND_GET_ONLY',
    authorizationValueRecorded: false,
    fixedVersion: '16.17.1',
    scope: {
      skillKey: config.skillKey,
      effectKey: config.effectKey,
      eventType: 'SKILL_HIT',
      sourceSkillKey: config.skillKey,
      targetCategory: 'CHAMPION',
      actionTargetContext: 'CURRENT_TARGET',
      skippedEffects: ['stun', 'slow', 'nearby_target_damage', 'projectile', 'vision', 'mana_cost', 'cooldown']
    },
    checks,
    getSummary: {
      getCount,
      businessWrites: 0,
      statusCounts,
      targetGetCount: requestLog.filter(item => item.route.includes('/characters/') || item.route.includes('/character-skill-relations') || item.route.includes('/skills/ashe_r')).length,
      globalSkillListGetCount: requestLog.filter(item => item.route === '/skills').length,
      globalTriggerRuleListGetCount: requestLog.filter(item => item.route.endsWith('/trigger-rules')).length,
      globalTriggerRuleDetailGetCount: requestLog.filter(item => item.route.includes('/trigger-rules/') && item.route !== `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`).length,
      candidateDetailGetCount: 1
    },
    observedCurrent: frozen.observedCurrent,
    candidate: {
      ruleKey: config.ruleKey,
      detailRoute: `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`,
      preflightStatus: target.candidateDetail.status,
      frozenBodySha256: shaValue(body),
      body
    },
    conflicts: [],
    excluded: frozen.excluded
  };
  writeJson('05-只读准备报告.json', report);
  console.log(JSON.stringify({ status: report.status, getCount, statusCounts, skillCount: firstStats.skillCount, ruleCount: firstStats.ruleCount, sourceInitializedCount: firstStats.sourceInitializedCount, candidateStatus: target.candidateDetail.status, businessWrites: 0 }));
}

main().catch(error => {
  console.error(`只读准备失败：${error.message}`);
  process.exitCode = 1;
});
