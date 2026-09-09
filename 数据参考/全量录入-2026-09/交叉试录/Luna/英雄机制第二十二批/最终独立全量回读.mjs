import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

// 独立回读器只发GET。--after-write用于写入后的完整核对，--preflight用于未写入状态。
// 公式求值只读取本次fresh GET返回的参数和公式表达式；候选文件仅用于预期键和写后载荷比对。
const here = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.HERO22_API_TOKEN;
if (!token) throw new Error('缺少临时环境变量 HERO22_API_TOKEN');
const args = process.argv.slice(2);
if (args.length !== 1 || !['--preflight', '--after-write'].includes(args[0])) throw new Error('必须明确指定 --preflight 或 --after-write');
const mode = args[0] === '--after-write' ? 'after-write' : 'preflight';

const heroes = ['leona', 'nautilus', 'alistar', 'blitzcrank'];
const candidateHeroes = ['leona', 'nautilus'];
const slots = ['p', 'q', 'w', 'e', 'r'];
const allSkills = heroes.flatMap(hero => slots.map(slot => `${hero}_${slot}`));
const candidateSkills = candidateHeroes.flatMap(hero => slots.map(slot => `${hero}_${slot}`));
const kinds = [
  { kind: 'parameters', field: 'parameterKey', endpoint: 'parameters' },
  { kind: 'formulas', field: 'formulaKey', endpoint: 'formulas' },
  { kind: 'effects', field: 'effectKey', endpoint: 'effects' },
  { kind: 'processes', field: 'processKey', endpoint: 'processes' },
  { kind: 'internalStates', field: 'stateKey', endpoint: 'internal-states' },
  { kind: 'triggerRules', field: 'ruleKey', endpoint: 'trigger-rules' },
];
const catalogs = ['skill-categories', 'attributes', 'modifier-zones', 'damage-types'];
const expected = {
  candidateSha256: '9ce3115402b975c25dc86ce779179e094fba433ff3273a3aac5d06952547e074',
  planSha256: '3ca4514a0f7d61b7852e771f7e714a8979d1a735f546e5a552370930225aa4ba',
  snapshotSha256: '8ec887af62d5c6ebdf592fab60b72cd2589022338ce76ee589f8c370bce7d079',
  sourceSha256: '1f5c18f71a9492a5aa86f33c4896f5c47b460c85b0b5f4560029856b2e8761f5',
  sourceManifestSha256: '9dfa1b1ec7debc76d6ea73629f03e55577a4955f84d398050c5871b1bf223014',
  currentDetails: 29,
  finalDetails: 106,
  finalCounts: { parameters: 83, formulas: 14, effects: 9, processes: 0, internalStates: 0, triggerRules: 0 },
  formulaCount: 14,
  formulaCases: 28,
  candidateComponents: 77,
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
const readBytes = name => fs.readFileSync(path.join(here, name));
const readJson = name => JSON.parse(readBytes(name));
const fileSha = name => sha256(readBytes(name));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
const identity = (skillKey, kind, stableKey) => `${skillKey}/${kind}/${stableKey}`;
const candidate = readJson('最终候选.json');
const plan = readJson('最终请求计划.json');
const originalSnapshot = readJson('当前现值保护快照.json');
const source = readJson('候选源值核对.json');

function diff(expectedValue, actualValue, at = '$') {
  if (isDeepStrictEqual(expectedValue, actualValue)) return null;
  if (expectedValue === null || actualValue === null || typeof expectedValue !== 'object' || typeof actualValue !== 'object') return { path: at, expected: expectedValue, actual: actualValue };
  if (Array.isArray(expectedValue) || Array.isArray(actualValue)) {
    if (!Array.isArray(expectedValue) || !Array.isArray(actualValue) || expectedValue.length !== actualValue.length) return { path: at, expected: expectedValue, actual: actualValue };
    for (let index = 0; index < expectedValue.length; index++) { const child = diff(expectedValue[index], actualValue[index], `${at}[${index}]`); if (child) return child; }
    return null;
  }
  for (const key of [...new Set([...Object.keys(expectedValue), ...Object.keys(actualValue)])].sort()) {
    if (!(key in expectedValue) || !(key in actualValue)) return { path: `${at}.${key}`, expected: expectedValue[key], actual: actualValue[key] };
    const child = diff(expectedValue[key], actualValue[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
}
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const businessCanonical = value => Array.isArray(value)
  ? value.map(businessCanonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !serverFields.has(key)).sort().map(key => [key, businessCanonical(value[key])]))
    : value;
const businessDiff = (expectedValue, actualValue) => diff(businessCanonical(expectedValue), businessCanonical(actualValue));

const candidateEntries = [];
for (const skillKey of candidateSkills) for (const spec of kinds) for (const body of candidate.skills?.[skillKey]?.write?.[spec.kind] ?? []) {
  candidateEntries.push({ skillKey, kind: spec.kind, field: spec.field, endpoint: spec.endpoint, id: body[spec.field], body });
}
const candidateEntryMap = new Map(candidateEntries.map(entry => [identity(entry.skillKey, entry.kind, entry.id), entry]));
const planEntries = (plan.requests ?? []).map(request => {
  const spec = kinds.find(item => item.kind === request.kind);
  return { skillKey: request.skillKey, kind: request.kind, id: request.stableKey, field: spec?.field, endpoint: spec?.endpoint, body: request.body };
});
const planEntryMap = new Map(planEntries.map(entry => [identity(entry.skillKey, entry.kind, entry.id), entry]));

const calls = [];
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(here, '最终-独立回读', runId);
await fsp.mkdir(runDir, { recursive: true });
const httpJournal = path.join(runDir, 'HTTP流水.jsonl');
const appendJsonl = async (file, value) => {
  const handle = await fsp.open(file, 'a');
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
};
const saveJson = async (name, value) => fsp.writeFile(path.join(runDir, name), jsonBytes(value), { flag: 'wx' });
const request = async route => {
  if (!route.startsWith('/') || route.includes('://') || route.includes('..')) throw new Error(`非法GET路径：${route}`);
  const sequence = calls.length + 1;
  const before = { sequence, phase: '请求前', at: new Date().toISOString(), method: 'GET', route };
  await appendJsonl(httpJournal, before);
  const started = Date.now();
  let result;
  try {
    const response = await fetch(apiBase + route, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const raw = await response.text();
    let data = null;
    let parseError = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (error) { parseError = `${error.name}: ${error.message}`; }
    result = { sequence, at: before.at, method: 'GET', route, status: response.status, ok: response.ok && !parseError, elapsedMs: Date.now() - started, data, ...(parseError ? { parseError, rawBytes: Buffer.byteLength(raw), rawSha256: sha256(raw) } : {}) };
  } catch (error) {
    result = { sequence, at: before.at, method: 'GET', route, status: null, ok: false, elapsedMs: Date.now() - started, data: null, error: `${error.name}: ${error.message}` };
  }
  calls.push(result);
  await appendJsonl(httpJournal, { ...result, phase: '请求后' });
  if (!result.ok) throw new Error(`GET失败，立即停止：${route} status=${result.status ?? 'network'}`);
  return result.data;
};

async function fetchState() {
  const state = { catalogs: {}, characters: {}, relations: {}, subjects: {}, components: {}, images: {} };
  for (const name of catalogs) state.catalogs[name] = await request('/' + name);
  for (const hero of heroes) {
    state.characters[hero] = await request(`/characters/champion_${hero}`);
    state.relations[hero] = await request(`/character-skill-relations?characterKey=champion_${hero}`);
  }
  for (const skillKey of allSkills) {
    state.subjects[skillKey] = await request(`/skills/${skillKey}`);
    state.components[skillKey] = {};
    for (const spec of kinds) {
      const list = await request(`/skills/${skillKey}/${spec.endpoint}`);
      const items = rows(list);
      const seen = new Set();
      for (const item of items) {
        const stableKey = item?.[spec.field];
        if (typeof stableKey !== 'string' || seen.has(stableKey)) throw new Error(`列表稳定键无效或重复：${skillKey}/${spec.kind}/${stableKey}`);
        seen.add(stableKey);
      }
      const details = [];
      for (const item of items) {
        const stableKey = item[spec.field];
        details.push({ stableKey, response: await request(`/skills/${skillKey}/${spec.endpoint}/${encodeURIComponent(stableKey)}`) });
      }
      state.components[skillKey][spec.kind] = { list, details };
    }
    state.images[skillKey] = await request(`/skills/${skillKey}/representative-image`);
  }
  return state;
}

function currentCounts(state) {
  const counts = Object.fromEntries(kinds.map(spec => [spec.kind, 0]));
  let details = 0;
  for (const skillKey of allSkills) for (const spec of kinds) {
    counts[spec.kind] += rows(state.components?.[skillKey]?.[spec.kind]?.list).length;
    details += state.components?.[skillKey]?.[spec.kind]?.details?.length ?? 0;
  }
  return { counts, details };
}
function flatten(state) {
  const map = new Map();
  for (const skillKey of allSkills) for (const spec of kinds) for (const item of state.components?.[skillKey]?.[spec.kind]?.details ?? []) map.set(identity(skillKey, spec.kind, item.stableKey), item.response);
  return map;
}
function compareProtected(before, after) {
  const conflicts = [];
  for (const name of catalogs) { const item = diff(before.catalogs?.[name], after.catalogs?.[name]); if (item) conflicts.push({ type: 'catalog', name, diff: item }); }
  for (const hero of heroes) {
    for (const [type, key] of [['character', 'characters'], ['relation', 'relations']]) { const item = diff(before[key]?.[hero], after[key]?.[hero]); if (item) conflicts.push({ type, hero, diff: item }); }
  }
  for (const skillKey of allSkills) {
    for (const [type, key] of [['subject', 'subjects'], ['image', 'images']]) { const item = diff(before[key]?.[skillKey], after[key]?.[skillKey]); if (item) conflicts.push({ type, skillKey, diff: item }); }
    for (const spec of kinds) {
      const oldList = before.components?.[skillKey]?.[spec.kind]?.list ?? [];
      const newList = after.components?.[skillKey]?.[spec.kind]?.list ?? [];
      const newByKey = new Map(newList.map(item => [item[spec.field], item]));
      for (const oldItem of oldList) {
        const itemDiff = diff(oldItem, newByKey.get(oldItem[spec.field]));
        if (itemDiff) conflicts.push({ type: 'protectedListItem', skillKey, kind: spec.kind, stableKey: oldItem[spec.field], diff: itemDiff });
      }
      const oldDetails = before.components?.[skillKey]?.[spec.kind]?.details ?? [];
      const newDetails = new Map((after.components?.[skillKey]?.[spec.kind]?.details ?? []).map(item => [item.stableKey, item.response]));
      for (const oldDetail of oldDetails) {
        const itemDiff = diff(oldDetail.response, newDetails.get(oldDetail.stableKey));
        if (itemDiff) conflicts.push({ type: 'protectedDetail', skillKey, kind: spec.kind, stableKey: oldDetail.stableKey, diff: itemDiff });
      }
    }
  }
  return conflicts;
}
function listSummaryDiff(item, detail) {
  if (!item || !detail) return null;
  for (const [key, expectedValue] of Object.entries(item)) {
    const actualValue = key === 'resultCount'
      ? (Array.isArray(detail.results) ? detail.results.length : undefined)
      : key === 'lifecycleEnabled'
        ? detail.lifecycle !== null && detail.lifecycle !== undefined
        : detail[key];
    if (!isDeepStrictEqual(expectedValue, actualValue)) return { path: key, expected: expectedValue, actual: actualValue };
  }
  return null;
}
function candidateChecks(state, mode) {
  const errors = [];
  const details = flatten(state);
  for (const entry of planEntries) {
    const key = identity(entry.skillKey, entry.kind, entry.id);
    const actual = details.get(key);
    if (!actual) { errors.push({ type: 'missingCandidate', key }); continue; }
    const bodyDiff = businessDiff(entry.body, actual);
    if (bodyDiff) errors.push({ type: 'candidateDetailMismatch', key, diff: bodyDiff });
  }
  const listDetailErrors = [];
  for (const skillKey of allSkills) for (const spec of kinds) {
    const component = state.components[skillKey][spec.kind];
    const byKey = new Map(component.details.map(item => [item.stableKey, item.response]));
    for (const item of rows(component.list)) {
      const itemDiff = listSummaryDiff(item, byKey.get(item[spec.field]));
      if (itemDiff) listDetailErrors.push({ skillKey, kind: spec.kind, stableKey: item[spec.field], diff: itemDiff });
    }
  }
  if (listDetailErrors.length) errors.push({ type: 'listDetailMismatch', items: listDetailErrors });
  const candidateKeys = new Set(planEntries.map(entry => identity(entry.skillKey, entry.kind, entry.id)));
  if (mode === 'after-write') {
    const actualCandidateKeys = new Set(candidateEntries.map(entry => identity(entry.skillKey, entry.kind, entry.id)).filter(key => details.has(key)));
    if (actualCandidateKeys.size !== expected.candidateComponents || ![...candidateKeys].every(key => actualCandidateKeys.has(key))) errors.push({ type: 'candidateKeyCount', expected: expected.candidateComponents, actual: actualCandidateKeys.size });
  }
  const writes = Object.fromEntries(candidateSkills.map(skillKey => [skillKey, candidate.skills[skillKey].write]));
  const actualSerialized = JSON.stringify(Object.fromEntries(candidateSkills.map(skillKey => [skillKey, kinds.reduce((out, spec) => { out[spec.kind] = [...(state.components[skillKey][spec.kind]?.details ?? [])].filter(item => candidateEntryMap.has(identity(skillKey, spec.kind, item.stableKey))).map(item => item.response); return out; }, {})])));
  if (actualSerialized.includes('DAMAGE') || actualSerialized.includes('DIRECT_HEAL') || actualSerialized.includes('MOMENT_EVALUATION')) errors.push({ type: 'forbiddenResult', detail: 'fresh GET候选组成含禁止结果' });
  if (candidate.skills.leona_p.write.parameters.length || candidate.skills.leona_p.write.formulas.length) errors.push({ type: 'leonaPShouldBeEmpty' });
  if (candidate.skills.nautilus_r.write.formulas.some(item => item.formulaKey === 'secondary_magic_damage')) errors.push({ type: 'nautilusRSecondaryShouldBeAbsent' });
  const shield = details.get('nautilus_w/effects/shield');
  if (!shield || shield.results?.[0]?.resultType !== 'NORMAL_SHIELD' || shield.lifecycle?.durationValue?.kind !== 'PARAMETER' || shield.lifecycle.durationValue.parameterKey !== 'shield_duration_ms') errors.push({ type: 'nautilusWShieldShape', actual: shield });
  for (const skillKey of ['leona_q','leona_w','leona_e','leona_r','nautilus_q','nautilus_w','nautilus_e','nautilus_r']) if (!details.has(`${skillKey}/effects/mana_cost`)) errors.push({ type: 'missingManaEffect', skillKey });
  return { errors, listDetailErrors, writes };
}

function raw(skillKey) { const value = source.skills[skillKey]; if (!value) throw new Error('缺少源值：' + skillKey); return value; }
function normalizedSourceNumber(value) { const number = Number(value); if (!Number.isFinite(number)) throw new Error(`源值不是有限数字：${value}`); return Math.round(number * 1e6) / 1e6; }
function data(skillKey, name, rank) { const values = raw(skillKey).dataValues?.[name]; if (!Array.isArray(values) || values[rank] === undefined) throw new Error(`缺少源DataValue ${skillKey}/${name}/${rank}`); return normalizedSourceNumber(values[rank]); }
function characterData(skillKey, name, level) { const values = raw(skillKey).calculations?.[name]?.mFormulaParts?.[0]?.values; if (!Array.isArray(values) || values[level - 1] === undefined) throw new Error(`缺少源角色等级值 ${skillKey}/${name}/${level}`); return normalizedSourceNumber(values[level - 1]); }
function namedDataValue(skillKey, calculationKey, partIndex = 0) { const value = raw(skillKey).calculations?.[calculationKey]?.mFormulaParts?.[partIndex]?.mDataValue; if (typeof value !== 'string') throw new Error(`缺少源树NamedDataValue ${skillKey}/${calculationKey}`); return value; }
function actualDetails(state) {
  const map = flatten(state);
  const get = (skillKey, kind, stableKey) => {
    const value = map.get(identity(skillKey, kind, stableKey));
    if (!value) throw new Error(`fresh GET缺少组成 ${skillKey}/${kind}/${stableKey}`);
    return value;
  };
  return { map, get };
}
function parameterValue(detail, skillKey, key, context) {
  const row = detail.get(skillKey, 'parameters', key);
  if (row.valueMode === 'FIXED') return Number(row.fixedValue);
  if (row.valueMode === 'SKILL_LEVEL') { const value = row.levelValues?.[String(context.rank)]; if (value === undefined) throw new Error(`缺少技能等级输入 ${skillKey}/${key}`); return Number(value); }
  if (row.valueMode === 'CHARACTER_LEVEL') { const value = row.levelValues?.[String(context.characterLevel)]; if (value === undefined) throw new Error(`缺少角色等级输入 ${skillKey}/${key}`); return Number(value); }
  if (row.valueMode === 'RUNTIME_INPUT') { if (!context.runtime || context.runtime[key] === undefined) throw new Error(`缺少运行时输入 ${skillKey}/${key}`); return Number(context.runtime[key]); }
  throw new Error(`未知参数模式 ${skillKey}/${key}`);
}
function attributeValue(node, context) {
  const key = [node.attributeOwner, node.attributeKey, node.attributeValueKind].join('|');
  if (!context.attributes || context.attributes[key] === undefined) throw new Error(`缺少属性输入 ${key}`);
  return Number(context.attributes[key]);
}
function evaluateNode(node, detail, skillKey, context) {
  if (!node || typeof node !== 'object') throw new Error('空表达式节点');
  if (node.nodeType === 'PARAMETER') return parameterValue(detail, skillKey, node.parameterKey, context);
  if (node.nodeType === 'ATTRIBUTE') return attributeValue(node, context);
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`非法公式节点 ${skillKey}`);
  const [left, right] = node.operands.map(item => evaluateNode(item, detail, skillKey, context));
  if (node.operation === 'ADD') return left + right;
  if (node.operation === 'SUBTRACT') return left - right;
  if (node.operation === 'MULTIPLY') return left * right;
  if (node.operation === 'DIVIDE') return left / right;
  if (node.operation === 'MIN') return Math.min(left, right);
  if (node.operation === 'MAX') return Math.max(left, right);
  throw new Error(`未知公式运算 ${node.operation}`);
}
function evaluateFormula(detail, skillKey, formulaKey, context) {
  const formula = detail.get(skillKey, 'formulas', formulaKey);
  return evaluateNode(formula.expression, detail, skillKey, context);
}
function attr(owner, key, kind, value) { return { [owner + '|' + key + '|' + kind]: value }; }
function env(rank, extra = {}) { return { rank, ...extra }; }
function sameNumber(left, right) { return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-9; }

const formulaChecks = [];
const rejectionChecks = [];
const boundaryChecks = [];
function sourceSpecs() {
  const mrDataValue = namedDataValue('leona_w', 'BonusMRTooltip');
  if (mrDataValue !== 'ArmorBaseBonus') throw new Error(`Leona W BonusMR树来源异常：${mrDataValue}`);
  return [
    ['leona_q', 'magic_damage', [[env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), data('leona_q', 'BaseDamage', 1)], [env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 600) }), data('leona_q', 'BaseDamage', 5) + 0.3 * 600]]],
    ['leona_w', 'magic_damage', [[env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), data('leona_w', 'ExplosionBaseDamage', 1)], [env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 400) }), data('leona_w', 'ExplosionBaseDamage', 5) + 0.4 * 400]]],
    ['leona_w', 'bonus_armor', [[env(1, { runtime: { source_mstat1_for_armor_bonus: 0 } }), data('leona_w', 'ArmorBaseBonus', 1)], [env(5, { runtime: { source_mstat1_for_armor_bonus: 100 } }), data('leona_w', 'ArmorBaseBonus', 5) + 0.2 * 100]]],
    ['leona_w', 'bonus_magic_resistance', [[env(1, { attributes: attr('SOURCE', 'magic_resistance', 'BONUS', 0) }), data('leona_w', mrDataValue, 1)], [env(5, { attributes: attr('SOURCE', 'magic_resistance', 'BONUS', 100) }), data('leona_w', mrDataValue, 5) + 0.2 * 100]]],
    ['leona_w', 'damage_reduction_amount', [[env(1, { runtime: { incoming_damage_for_reduction: 10 } }), Math.min(data('leona_w', 'FlatDamageReduction', 1), 5)], [env(5, { runtime: { incoming_damage_for_reduction: 100 } }), Math.min(data('leona_w', 'FlatDamageReduction', 5), 50)]]],
    ['leona_e', 'magic_damage', [[env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), data('leona_e', 'BaseDamage', 1)], [env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 250) }), data('leona_e', 'BaseDamage', 5) + 0.4 * 250]]],
    ['leona_r', 'magic_damage', [[env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), data('leona_r', 'ExplosionBaseDamage', 1)], [env(3, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 500) }), data('leona_r', 'ExplosionBaseDamage', 3) + 0.8 * 500]]],
    ['nautilus_p', 'physical_damage', [[env(null, { characterLevel: 1, attributes: attr('SOURCE', 'attack_damage', 'TOTAL', 0) }), characterData('nautilus_p', 'BonusDamage', 1)], [env(null, { characterLevel: 18, attributes: attr('SOURCE', 'attack_damage', 'TOTAL', 200) }), characterData('nautilus_p', 'BonusDamage', 18) + 200]]],
    ['nautilus_q', 'magic_damage', [[env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), data('nautilus_q', 'BaseDamage', 1)], [env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 400) }), data('nautilus_q', 'BaseDamage', 5) + 0.9 * 400]]],
    ['nautilus_w', 'shield_value', [[env(1, { attributes: attr('SOURCE', 'hp', 'TOTAL', 0) }), data('nautilus_w', 'ShieldBase', 1)], [env(5, { attributes: attr('SOURCE', 'hp', 'TOTAL', 3000) }), data('nautilus_w', 'ShieldBase', 5) + data('nautilus_w', 'ShieldHealthRatio', 5) * 3000]]],
    ['nautilus_w', 'bonus_magic_damage_total', [[env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), data('nautilus_w', 'DotDamageBase', 1)], [env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 300) }), data('nautilus_w', 'DotDamageBase', 5) + 0.4 * 300]]],
    ['nautilus_e', 'magic_damage', [[env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), data('nautilus_e', 'DamageBase', 1)], [env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 200) }), data('nautilus_e', 'DamageBase', 5) + 0.5 * 200]]],
    ['nautilus_e', 'later_wave_magic_damage', [[env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), 0.5 * data('nautilus_e', 'DamageBase', 1)], [env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 200) }), 0.5 * (data('nautilus_e', 'DamageBase', 5) + 0.5 * 200)]]],
    ['nautilus_r', 'primary_magic_damage', [[env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), data('nautilus_r', 'PrimaryDamage', 1)], [env(3, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 400) }), data('nautilus_r', 'PrimaryDamage', 3) + 0.8 * 400]]],
  ];
}
function runMath(state) {
  const detail = actualDetails(state);
  const specs = sourceSpecs();
  for (const [skillKey, formulaKey, cases] of specs) {
    const actualFormula = detail.get(skillKey, 'formulas', formulaKey);
    const actualFormulaSha256 = sha256(JSON.stringify(actualFormula));
    for (const [index, [context, sourceExpected]] of cases.entries()) {
      let actual = null;
      let error = null;
      try { actual = evaluateFormula(detail, skillKey, formulaKey, context); } catch (err) { error = String(err?.message ?? err); }
      const passed = error === null && sameNumber(actual, sourceExpected);
      formulaChecks.push({ skillKey, formulaKey, caseId: String.fromCharCode(65 + index), input: context, actual, sourceExpected, actualFormulaSha256, passed, error });
    }
  }
  const missingCases = [
    ['缺少Leona W进入伤害', 'leona_w', 'damage_reduction_amount', env(5)],
    ['缺少Leona W未映射护甲属性', 'leona_w', 'bonus_armor', env(5)],
    ['缺少Leona W额外魔抗属性', 'leona_w', 'bonus_magic_resistance', env(5)],
    ['缺少Nautilus W总生命属性', 'nautilus_w', 'shield_value', env(5)],
    ['缺少Nautilus P总攻击力属性', 'nautilus_p', 'physical_damage', env(null, { characterLevel: 18 })],
    ['缺少Leona Q法术强度属性', 'leona_q', 'magic_damage', env(5)],
  ];
  for (const [id, skillKey, formulaKey, context] of missingCases) {
    let rejected = false;
    let error = null;
    try { evaluateFormula(detail, skillKey, formulaKey, context); } catch (err) { rejected = true; error = String(err?.message ?? err); }
    rejectionChecks.push({ id, skillKey, formulaKey, input: context, rejected, error });
  }
  for (const input of [0, 10, 1000]) {
    let actual = null;
    let error = null;
    try { actual = evaluateFormula(detail, 'leona_w', 'damage_reduction_amount', env(5, { runtime: { incoming_damage_for_reduction: input } })); } catch (err) { error = String(err?.message ?? err); }
    const expectedValue = Math.min(data('leona_w', 'FlatDamageReduction', 5), 0.5 * input);
    boundaryChecks.push({ input, actual, expected: expectedValue, error, passed: error === null && sameNumber(actual, expectedValue) });
  }
  const actualFormulaKeys = candidateSkills.flatMap(skillKey => (state.components[skillKey].formulas?.details ?? []).map(item => `${skillKey}/${item.stableKey}`)).sort();
  const expectedFormulaKeys = specs.map(item => `${item[0]}/${item[1]}`).sort();
  const castChecks = [
    ['leona_q', 'spellCastTime=0.5217499732971191', 'mCastTime=0.25'],
    ['nautilus_r', 'spellCastTime=0.25', 'mCastTime=0.46000000834465027'],
  ].map(([skillKey, first, second]) => {
    const row = detail.get(skillKey, 'parameters', 'cast_time_ms');
    return { skillKey, valueType: row.valueType, valueMode: row.valueMode, fixedValue: row.fixedValue, levelValues: row.levelValues, hasFirstSourceField: row.description?.includes(first) ?? false, hasSecondSourceField: row.description?.includes(second) ?? false, passed: row.valueType === 'INTEGER' && row.valueMode === 'RUNTIME_INPUT' && row.fixedValue === null && row.levelValues === null && row.description?.includes(first) && row.description?.includes(second) };
  });
  const mathFailures = [...formulaChecks.filter(item => !item.passed), ...rejectionChecks.filter(item => !item.rejected), ...boundaryChecks.filter(item => !item.passed), ...castChecks.filter(item => !item.passed)];
  return {
    independentFromCandidateFormula: true,
    formulaSource: 'fresh GET详情中的实际expression字段',
    sourceNumericNormalization: '源值期望按六位小数归一化；保留原始源文件及其哈希，避免浮点噪声改变已入库实值比较',
    sourceTreeBasis: { skillKey: 'leona_w', calculationKey: 'BonusMRTooltip', dataValue: namedDataValue('leona_w', 'BonusMRTooltip') },
    formulaChecks,
    rejectionChecks,
    boundaryChecks,
    castChecks,
    actualFormulaKeys,
    expectedFormulaKeys,
    summary: { finalFormulaCount: actualFormulaKeys.length, expectedFormulaCount: expected.formulaCount, formulaCases: formulaChecks.length, expectedFormulaCases: expected.formulaCases, rejectionCases: rejectionChecks.length, boundaryCases: boundaryChecks.length, castChecks: castChecks.length, failures: mathFailures.length, passed: mathFailures.length === 0 && JSON.stringify(actualFormulaKeys) === JSON.stringify(expectedFormulaKeys) },
  };
}

const result = { at: new Date().toISOString(), runId, mode, apiBase, candidateSha256: expected.candidateSha256, planSha256: expected.planSha256, sourceVersion: source.sourceVersion, apiWrites: 0, calls: null, protectedConflicts: null, candidateConflicts: null, counts: null, math: null, success: false, errors: [] };
await saveJson('运行锁.json', { at: result.at, runId, mode, candidateSha256: expected.candidateSha256, planSha256: expected.planSha256, apiWrites: 0 });
try {
  const staticFiles = { candidate: fileSha('最终候选.json'), plan: fileSha('最终请求计划.json'), snapshot: fileSha('当前现值保护快照.json'), source: fileSha('候选源值核对.json'), sourceManifest: fileSha('最终来源哈希汇总.json') };
  if (staticFiles.candidate !== expected.candidateSha256 || staticFiles.plan !== expected.planSha256 || staticFiles.snapshot !== expected.snapshotSha256 || staticFiles.source !== expected.sourceSha256 || staticFiles.sourceManifest !== expected.sourceManifestSha256) throw new Error(`静态文件散列漂移：${JSON.stringify(staticFiles)}`);
  const state = await fetchState();
  await saveJson('独立全量回读.json', { at: result.at, runId, mode, sourceVersion: source.sourceVersion, catalogs: state.catalogs, characters: state.characters, relations: state.relations, subjects: state.subjects, components: state.components, images: state.images, apiWrites: 0, calls });
  const counts = currentCounts(state);
  const protectedConflicts = compareProtected(originalSnapshot, state);
  const candidateResult = candidateChecks(state, mode);
  result.counts = counts;
  result.protectedConflicts = protectedConflicts;
  result.candidateConflicts = candidateResult.errors;
  const expectedDetails = mode === 'after-write' ? expected.finalDetails : expected.currentDetails;
  const expectedCounts = mode === 'after-write' ? expected.finalCounts : { parameters: 29, formulas: 0, effects: 0, processes: 0, internalStates: 0, triggerRules: 0 };
  if (counts.details !== expectedDetails || !isDeepStrictEqual(counts.counts, expectedCounts)) throw new Error(`组成数量异常：${JSON.stringify({ counts, expectedDetails, expectedCounts })}`);
  if (protectedConflicts.length) throw new Error(`保护对象发生漂移：${protectedConflicts.length}项`);
  if (candidateResult.errors.length) throw new Error(`实际组成核对失败：${candidateResult.errors.length}项`);
  if (mode === 'after-write') {
    result.math = runMath(state);
    await saveJson('实际读后数学核算.json', { ...result.math, apiWrites: 0 });
    if (!result.math.summary.passed) throw new Error(`实际读后数学失败：${result.math.summary.failures}项`);
  }
  result.success = true;
} catch (error) {
  result.errors.push({ name: error.name, message: error.message });
} finally {
  result.finishedAt = new Date().toISOString();
  result.calls = { total: calls.length, expected: mode === 'after-write' ? 278 : 201, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}) };
  await fsp.writeFile(path.join(runDir, '执行结果.json'), jsonBytes(result));
}
console.log(JSON.stringify({ success: result.success, mode, runId, apiWrites: result.apiWrites, calls: result.calls, counts: result.counts, protectedConflicts: result.protectedConflicts?.length ?? null, candidateConflicts: result.candidateConflicts?.length ?? null, math: result.math?.summary ?? null, errors: result.errors, output: runDir }, null, 2));
if (!result.success) process.exitCode = 1;
