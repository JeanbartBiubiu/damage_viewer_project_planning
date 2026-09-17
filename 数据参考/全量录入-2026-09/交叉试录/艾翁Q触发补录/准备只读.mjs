import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = 'C:/project/damage_web_dev';
const baseUrl = process.env.DAMAGE_ENTRY_BASE_URL || 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.DAMAGE_ENTRY_TOKEN;
assert(token && token.trim(), '必须提供非空 DAMAGE_ENTRY_TOKEN；令牌不会写入或输出');

const config = {
  characterKey: 'champion_ivern',
  characterName: '艾翁',
  skillKey: 'ivern_q',
  skillName: '艾翁·根深敌固',
  effectKey: 'damage',
  formulaKey: 'magic_damage',
  ruleKey: 'actual_hit',
  sourceAttribute: 'ability_power',
  sourceAttributeValueKind: 'TOTAL',
  damageTypeKey: 'magic',
  candidatePath: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第四十八批', '修订一', '完整候选.json'),
  clientPath: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第四十八批', '最终验收', '固定来源输入', '参考资料', '客户端原文', 'Ivern.json.gz'),
  clientPointer: 'Characters/Ivern/Spells/IvernQAbility/IvernQ',
  officialPath: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第四十八批', '最终验收', '固定来源输入', '参考资料', '官方中文', 'Ivern.json'),
  officialChampion: 'Ivern',
  officialSpellId: 'IvernQ',
  sourceFiles: [
    { kind: '艾翁 Q 候选与已有组成', path: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第四十八批', '修订一', '完整候选.json') },
    { kind: '艾翁客户端16.17原始资料', path: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第四十八批', '最终验收', '固定来源输入', '参考资料', '客户端原文', 'Ivern.json.gz'), expectedSha256: '3e21fdf20084ca37263d8bc86ea2eb040cabba152161021e8e89054548948196', expectedDecompressedSha256: '40e544c50fe387702ee3cbc82e41bf2296be3996640cf077b517a2ec7724d03e' },
    { kind: '艾翁官方16.17.1中文资料', path: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第四十八批', '最终验收', '固定来源输入', '参考资料', '官方中文', 'Ivern.json'), expectedSha256: '944b848a16ce275abfe73bff480a001eafdf014df9f849b436cba47231a95be3' },
    { kind: '艾翁官方16.17.1英文资料', path: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第四十八批', '最终验收', '固定来源输入', '参考资料', '官方英文', 'Ivern.json'), expectedSha256: '891792e3b500acaf06cf58158077a6038c3903083f0df2c513f75730f32df712' },
    { kind: '艾翁来源绑定与当前文本', path: path.join(repo, '数据参考', '全量录入-2026-09', '交叉试录', 'Luna', '英雄机制第四十八批', '最终验收', '固定来源输入', '来源绑定与当前文本.json') }
  ],
  existingEffectKeys: ['damage', 'mana_cost'],
  requiredParameters: ['base_damage', 'ap_ratio'],
  excluded: ['禁锢', '再次施放突进', '友军突进', '非史诗级野怪分支', '法力消耗', '冷却'],
  acceptedFacts: {
    directHitEffect: 'damage：命中目标的一次魔法伤害，结果目标为 TARGET。',
    formula: 'magic_damage=base_damage+ap_ratio×来源总法强。',
    hitBoundary: '只把运行时已经确认的实际命中英雄接入伤害；禁锢、再次施放突进、友军和野怪分支另行处理。',
    resourceBoundary: 'mana_cost 与 cooldown 属于施法过程，命中规则不重复执行。'
  }
};

const componentKinds = [['parameters', 'parameterKey'], ['formulas', 'formulaKey'], ['effects', 'effectKey'], ['processes', 'processKey'], ['internal-states', 'stateKey'], ['trigger-rules', 'ruleKey']];
const statusCounts = {};
const requestLog = [];
let getCount = 0;
const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(Buffer.from(JSON.stringify(value), 'utf8'));
const writeJson = (name, value) => fs.writeFileSync(path.join(here, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readDocument = filePath => { const bytes = fs.readFileSync(filePath); return JSON.parse(filePath.toLowerCase().endsWith('.gz') ? gunzipSync(bytes) : bytes); };
const listData = response => Array.isArray(response.data) ? response.data : (response.data?.items || []);
const mapBy = (rows, key) => Object.fromEntries(rows.map(row => [row[key], row]));
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value && Object.prototype.hasOwnProperty.call(value, key)).map(key => [key, value[key]]));

async function get(route, expectedStatuses = [200]) {
  const response = await fetch(`${baseUrl}${route}`, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
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

function fileRecord(source) {
  assert(fs.existsSync(source.path), `来源文件不存在：${source.path}`);
  const bytes = fs.readFileSync(source.path);
  const record = { kind: source.kind, path: source.path, byteSize: bytes.byteLength, sha256: shaBytes(bytes) };
  if (source.path.toLowerCase().endsWith('.gz')) { const expanded = gunzipSync(bytes); record.decompressedByteSize = expanded.byteLength; record.decompressedSha256 = shaBytes(expanded); }
  if (source.expectedSha256) assert.equal(record.sha256, source.expectedSha256, `${source.kind}散列不匹配`);
  if (source.expectedDecompressedSha256) assert.equal(record.decompressedSha256, source.expectedDecompressedSha256, `${source.kind}解压散列不匹配`);
  return record;
}

function findNode(value, predicate) {
  if (!value || typeof value !== 'object') return false;
  if (predicate(value)) return true;
  return Array.isArray(value) ? value.some(item => findNode(item, predicate)) : Object.values(value).some(item => findNode(item, predicate));
}

function bodyForRule() {
  return {
    ruleKey: config.ruleKey,
    name: '命中英雄触发根深敌固伤害',
    description: '仅消费宿主确认的 ivern_q 实际英雄命中，并在当前目标上执行已有的 damage；禁锢、再次施放突进、友军与非史诗级野怪分支、法力消耗和冷却不在本条规则中。',
    sortOrder: 10,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: config.skillKey } },
    conditionGroups: [{ groupKey: 'champion_target', name: '命中对象为英雄', sortOrder: 10, conditions: [{ conditionKey: 'champion_target', conditionType: 'TARGET_CATEGORY_CHECK', sortOrder: 10, detail: { categories: ['CHAMPION'] } }] }],
    actions: [{ actionKey: 'execute_damage', name: '执行根深敌固命中伤害', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET', detail: { effectKey: config.effectKey }, runtimeInputBindings: [], resultModifiers: [] }],
    perTargetCooldown: null,
    maxTriggersPerProcess: null
  };
}

async function readComponents(skillKey) {
  const result = {};
  for (const [component, keyField] of componentKinds) {
    const list = await get(`/skills/${encodeURIComponent(skillKey)}/${component}`);
    const rows = listData(list);
    const details = [];
    for (const row of rows) { const key = row[keyField]; details.push({ key, response: await get(`/skills/${encodeURIComponent(skillKey)}/${component}/${encodeURIComponent(key)}`) }); }
    result[component] = { list, keys: rows.map(row => row[keyField]), details };
  }
  return result;
}

async function readTarget() {
  const relationRoute = `/character-skill-relations?characterKey=${encodeURIComponent(config.characterKey)}`;
  const routes = [`/characters/${config.characterKey}`, `/characters/${config.characterKey}/attributes`, `/characters/${config.characterKey}/representative-image`, relationRoute, `/skills/${config.skillKey}`, `/skills/${config.skillKey}/representative-image`];
  const staticResponses = Object.fromEntries(await Promise.all(routes.map(async route => [route, await get(route)])));
  const components = await readComponents(config.skillKey);
  const candidateRoute = `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`;
  const candidateDetail = await get(candidateRoute, [404]);
  const relationRows = listData(staticResponses[relationRoute]);
  assert(relationRows.some(row => row.skillKey === config.skillKey), `${config.skillKey}角色技能关系缺少`);
  assert.equal(staticResponses[`/skills/${config.skillKey}`].data.skillKey, config.skillKey);
  assert.equal(staticResponses[`/characters/${config.characterKey}`].data.characterKey, config.characterKey);
  assert.equal(staticResponses[`/skills/${config.skillKey}/representative-image`].data.image?.enabled, true);
  assert.equal(staticResponses[`/characters/${config.characterKey}/representative-image`].data.image?.enabled, true);
  assert.equal(candidateDetail.status, 404);
  return { characterKey: config.characterKey, skillKey: config.skillKey, staticResponses, components, candidateDetail, targetRuleKeysBefore: components['trigger-rules'].keys, existingEffectKeys: components.effects.keys };
}

function validateTarget(target) {
  assert.deepEqual(target.targetRuleKeysBefore, []);
  assert.deepEqual(target.existingEffectKeys, config.existingEffectKeys);
  const parameters = mapBy(listData(target.components.parameters.list), 'parameterKey');
  for (const key of config.requiredParameters) assert(parameters[key], `Q命中公式参数缺失：${key}`);
  const formula = target.components.formulas.details.find(item => item.key === config.formulaKey)?.response.data;
  assert(formula, 'Q命中公式详情缺失');
  assert(findNode(formula.expression, node => node.nodeType === 'PARAMETER' && node.parameterKey === 'base_damage'));
  assert(findNode(formula.expression, node => node.nodeType === 'PARAMETER' && node.parameterKey === 'ap_ratio'));
  assert(findNode(formula.expression, node => node.nodeType === 'ATTRIBUTE' && node.attributeKey === config.sourceAttribute && node.attributeOwner === 'SOURCE' && node.attributeValueKind === config.sourceAttributeValueKind));
  const effect = target.components.effects.details.find(item => item.key === config.effectKey)?.response.data;
  assert(effect, 'Q命中效果详情缺失');
  assert.equal(effect.results.length, 1);
  const result = effect.results[0];
  assert.equal(result.resultType, 'DAMAGE');
  assert.equal(result.target, 'TARGET');
  assert.equal(result.detail.damageTypeKey, config.damageTypeKey);
  assert.equal(result.valueRule.value.kind, 'FORMULA');
  assert.equal(result.valueRule.value.formulaKey, config.formulaKey);
  const mana = target.components.effects.details.find(item => item.key === 'mana_cost')?.response.data;
  assert(mana, 'Q法力消耗效果详情缺失');
  assert.equal(mana.results[0].resultType, 'RESOURCE_CHANGE');
  assert.equal(mana.results[0].target, 'SOURCE');
  assert.equal(target.components.processes.keys.length, 0, 'Q当前出现未预期的过程，需重新审查');
  assert.equal(target.components['internal-states'].keys.length, 0, 'Q当前出现未预期的内部状态，需重新审查');
}

async function scanRules() {
  const skillList = await get('/skills');
  const skills = listData(skillList);
  assert.equal(skills.length, 1062, '全局技能数量不是 1062');
  const perSkill = [];
  let ruleCount = 0;
  for (const skill of skills) {
    const list = await get(`/skills/${encodeURIComponent(skill.skillKey)}/trigger-rules`);
    const rows = listData(list);
    const details = [];
    for (const row of rows) { const detail = await get(`/skills/${encodeURIComponent(skill.skillKey)}/trigger-rules/${encodeURIComponent(row.ruleKey)}`); assert.equal(detail.status, 200); details.push({ ruleKey: row.ruleKey, response: detail }); ruleCount += 1; }
    perSkill.push({ skillKey: skill.skillKey, list, ruleKeys: rows.map(row => row.ruleKey), details });
  }
  return { skillList, skillCount: skills.length, skillKeys: skills.map(skill => skill.skillKey), ruleCount, perSkill };
}

function scanPairs(scan) { return scan.perSkill.flatMap(skill => skill.ruleKeys.map(ruleKey => `${skill.skillKey}/${ruleKey}`)).sort(); }
function scanStats(scan) {
  const eventTypeCounts = {};
  let sourceInitializedCount = 0;
  for (const skill of scan.perSkill) for (const detail of skill.details) { const eventType = detail.response.data?.eventSource?.eventType || 'UNKNOWN'; eventTypeCounts[eventType] = (eventTypeCounts[eventType] || 0) + 1; if (eventType === 'SOURCE_INITIALIZED') sourceInitializedCount += 1; }
  return { skillCount: scan.skillCount, ruleCount: scan.ruleCount, eventTypeCounts, sourceInitializedCount };
}

async function readCatalogs() {
  const attributes = await get('/attributes');
  const sourceAttribute = await get(`/attributes/${config.sourceAttribute}`);
  const damageTypes = await get('/damage-types');
  const damageType = await get(`/damage-types/${config.damageTypeKey}`);
  const modifierZones = await get('/modifier-zones');
  const statuses = await get('/statuses');
  assert.equal(sourceAttribute.status, 200);
  assert.equal(damageType.status, 200);
  return { attributes: { list: attributes, details: [{ key: config.sourceAttribute, response: sourceAttribute }] }, damageTypes: { list: damageTypes, details: [{ key: config.damageTypeKey, response: damageType }] }, modifierZones: { list: modifierZones }, statuses: { list: statuses } };
}

function sourceRecords() { return config.sourceFiles.map(fileRecord); }
function readClientExcerpt() {
  const document = readDocument(config.clientPath);
  const object = document[config.clientPointer];
  assert(object?.mSpell, '客户端没有艾翁 Q 主对象');
  const spell = object.mSpell;
  return { objectPath: config.clientPointer, dataValues: spell.DataValues || [], calculations: spell.mSpellCalculations || {}, mCastTime: spell.mCastTime ?? null, spellCastTime: spell.spellCastTime ?? null, cooldownTime: spell.cooldownTime || [], cooldown: spell.Cooldown || null, mana: spell.mana || [], castRange: spell.castRange || [], castRangeDisplayOverride: spell.castRangeDisplayOverride || [], castRadius: spell.castRadius || [], missileSpeed: spell.missileSpeed ?? null, mSpellTags: spell.mSpellTags || [], targetingType: spell.mTargetingTypeData || null, missileBehaviors: spell.mMissileSpec?.behaviors || [] };
}
function readOfficialExcerpt() {
  const document = readJson(config.officialPath);
  const spell = document.data?.[config.officialChampion]?.spells?.find(item => item.id === config.officialSpellId);
  assert(spell, '官方资料没有 IvernQ');
  return pick(spell, ['id', 'name', 'description', 'tooltip', 'leveltip', 'maxrank', 'cooldown', 'cost', 'effect', 'image']);
}
function readCandidate() {
  const document = readJson(config.candidatePath);
  const candidate = document.skills?.[config.skillKey];
  assert(candidate, '候选文件没有 ivern_q');
  const effects = candidate.effects || candidate.write?.effects || [];
  assert.deepEqual(effects.map(item => item.effectKey), config.existingEffectKeys);
  return { document, candidate };
}

async function main() {
  const startedAt = new Date().toISOString();
  const { document: candidateDocument, candidate } = readCandidate();
  const sourceSnapshot = { schemaVersion: 1, capturedAt: startedAt, sourcePolicy: '固定客户端16.17与官方16.17.1；只读取当前交叉试录候选和固定资料，不使用外部最新资料覆盖。', methodPolicy: 'LOCAL_FILES_AND_GET_ONLY', authorizationValueRecorded: false, sourceFiles: sourceRecords(), candidate: { path: config.candidatePath, fileSha256: shaBytes(fs.readFileSync(config.candidatePath)), revision: candidateDocument.revision || candidateDocument.meta?.revision || null, skill: candidate }, client: { path: config.clientPath, pointer: config.clientPointer, excerpt: readClientExcerpt() }, official: { path: config.officialPath, pointer: `data/${config.officialChampion}/spells[id=${config.officialSpellId}]`, excerpt: readOfficialExcerpt() }, acceptedFacts: config.acceptedFacts };
  writeJson('03-来源快照.json', sourceSnapshot);
  const sourceSnapshotSha256 = shaValue(sourceSnapshot);
  const target = await readTarget();
  validateTarget(target);
  const catalogs = await readCatalogs();
  const firstScan = await scanRules();
  const secondScan = await scanRules();
  const firstPairs = scanPairs(firstScan);
  const secondPairs = scanPairs(secondScan);
  assert.deepEqual(firstScan.skillKeys, secondScan.skillKeys, '两轮全局技能键集合不稳定');
  assert.equal(firstScan.ruleCount, 104, '全局触发规则数量不是 104');
  assert.equal(secondScan.ruleCount, 104, '第二轮全局触发规则数量不是 104');
  assert.deepEqual(firstPairs, secondPairs, '两轮全局触发规则键集合不稳定');
  const firstStats = scanStats(firstScan);
  const secondStats = scanStats(secondScan);
  assert.equal(firstStats.sourceInitializedCount, 24, '全局 SOURCE_INITIALIZED 数量不是 24');
  assert.equal(secondStats.sourceInitializedCount, 24, '第二轮 SOURCE_INITIALIZED 数量不是 24');
  const observedCurrent = { ...firstStats, stableRead: { stableSkillKeys: true, stableRuleKeys: true, stableRuleCount: true, firstSkillCount: firstScan.skillCount, secondSkillCount: secondScan.skillCount, firstRuleCount: firstScan.ruleCount, secondRuleCount: secondScan.ruleCount, firstRuleKeysSha256: shaValue(firstPairs), secondRuleKeysSha256: shaValue(secondPairs) } };
  const body = bodyForRule();
  const frozen = { schemaVersion: 1, generatedAt: startedAt, status: 'READY_FOR_INDEPENDENT_REVIEW', writable: true, sourceVersion: { client: '16.17', official: '16.17.1' }, sourceSnapshotSha256, expectedCurrent: { skillCount: 1062, ruleCount: 104, sourceInitializedCount: 24 }, observedCurrent, targetBefore: { characterKey: config.characterKey, skillKey: config.skillKey, ruleKeys: target.targetRuleKeysBefore, existingEffectKeys: target.existingEffectKeys, candidateDetailStatus: target.candidateDetail.status }, plannedWrites: 1, writes: [{ id: `${config.skillKey}-${config.ruleKey}`, kind: '新增触发规则', method: 'POST', route: `/skills/${config.skillKey}/trigger-rules`, detailRoute: `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`, expectedStatus: 201, body }], conflicts: [], excluded: config.excluded };
  writeJson('02-冻结请求.json', frozen);
  const frozenRequestSha256 = shaValue(frozen);
  const writeBefore = { schemaVersion: 1, capturedAt: new Date().toISOString(), baseUrl, requestPolicy: { businessMethodsSent: [], authorizationValueRecorded: false, businessWritesIssued: 0 }, sourceSnapshotSha256, frozenRequestSha256, expectedCurrent: frozen.expectedCurrent, observedCurrent, targetSnapshot: target, protectionCatalogs: catalogs, triggerRuleBaseline: firstScan, triggerRuleStableSecondScan: secondScan, preservation: { targetStaticSha256: shaValue(target.staticResponses), targetComponentsSha256: shaValue(target.components), oldRulePairsSha256: shaValue(firstPairs) }, getCount, statusCounts, businessWrites: 0 };
  writeJson('04-写入前现值.json', writeBefore);
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'READY_FOR_INDEPENDENT_REVIEW', methodPolicy: 'LOCAL_FILES_AND_GET_ONLY', authorizationValueRecorded: false, fixedVersion: '16.17.1', scope: { skillKey: config.skillKey, effectKey: config.effectKey, eventType: 'SKILL_HIT', sourceSkillKey: config.skillKey, targetCategory: 'CHAMPION', actionTargetContext: 'CURRENT_TARGET', skippedEffects: config.excluded }, checks: { characterSubject: true, skillSubject: true, characterAttributes: true, characterSkillRelation: true, characterRepresentativeImage: true, skillRepresentativeImage: true, parametersAndFormula: true, initialDamageEffect: true, noUnprovenControlEffect: true, candidateAbsent: true, targetRuleBaselineEmpty: true, globalOldRulesComplete: true, globalTwoPassStable: true, noBusinessWrite: true }, getSummary: { getCount, businessWrites: 0, statusCounts, targetGetCount: requestLog.filter(item => item.route.includes('/characters/') || item.route.includes('/character-skill-relations') || item.route.includes(`/skills/${config.skillKey}`)).length, globalSkillListGetCount: requestLog.filter(item => item.route === '/skills').length, globalTriggerRuleListGetCount: requestLog.filter(item => item.route.endsWith('/trigger-rules')).length, globalTriggerRuleDetailGetCount: requestLog.filter(item => item.route.includes('/trigger-rules/') && item.route !== `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`).length, candidateDetailGetCount: 1 }, observedCurrent, candidate: { ruleKey: config.ruleKey, detailRoute: `/skills/${config.skillKey}/trigger-rules/${config.ruleKey}`, preflightStatus: target.candidateDetail.status, frozenBodySha256: shaValue(body), body }, conflicts: [], excluded: config.excluded };
  writeJson('05-只读准备报告.json', report);
  console.log(JSON.stringify({ status: report.status, getCount, statusCounts, skillCount: firstStats.skillCount, ruleCount: firstStats.ruleCount, sourceInitializedCount: firstStats.sourceInitializedCount, candidateStatus: target.candidateDetail.status, businessWrites: 0 }));
}

main().catch(error => { console.error(`只读准备失败：${error.message}`); process.exitCode = 1; });
