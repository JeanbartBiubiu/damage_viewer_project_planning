import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

// 独立全量回读器：只发送GET。--preflight用于当前未写入状态，--after-write用于业务写入后的363次全量GET。
// 它不读取写入器的请求快照作为回读依据，重新取得主体、目录、列表和组件详情，并独立核算关键公式。
const here = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const token = process.env.HERO19_API_TOKEN ?? 'local-entry';
const candidateFile = '修订一候选.json';
const versionFile = '修订一候选版本.json';
const planFile = '修订一写前计划.json';
const protectionFile = '修订一写前保护.json';
const protectionSummaryFile = '修订一写前保护摘要.json';
const mathFile = '修订一独立源值与算例.json';
const freezeFile = '修订一冻结候选锁.json';
const originalSnapshotFile = '写前现值.json';
const skills = ['riven', 'aatrox', 'rengar', 'khazix'].flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const heroes = ['riven', 'aatrox', 'rengar', 'khazix'];
const kinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
const catalogs = [
  ['attributes', 'attributeKey'],
  ['modifier-zones', 'modifierZoneKey'],
  ['damage-types', 'damageTypeKey'],
  ['statuses', 'statusKey'],
];
const expected = {
  lockSha256: '8c79339da015b246e56871674327c967c0cc1db0c0bdd38e833f34ca8e8fcb97',
  candidateSha256: 'bb0306ca12eadabdad3d05aacb606b347bd393ffc7aa17205da345e3da08e97c',
  candidatePlanSha256: 'aa89ecca3c72b8d4bb02a1a87180e7ac6050b5cbf267a484808e0353fd783e64',
  candidateVersionFileSha256: '36cafdc0c8fc09f410cdc2c2d835c31d8cf4262df2d01303554a77b7b0a9fc57',
  planFileSha256: 'aa8c3aa9dd8f22b0f0606b92aaf8048e8bc8df9e88ba7590d1671a8295e85ce1',
  protectionFileSha256: 'ae5a5428d695ec424ef1fb1c232fa0e8f7893bc30279fa20d5e7af345fa10563',
  protectionSummarySha256: '6cb4ed16037995baea34c535665d68a1b39dc117e681850816e2ae5d5fed967b',
  mathFileSha256: '63a23e737a1bf08cc127ab7f5a885bdb122d891633156332578dee3f854f7376',
  originalSnapshotSha256: '1954947a6d0afe3d3b41138ad60a11285223814a9ea1843e736518ba74130cd8',
};
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const readBytes = name => fs.readFileSync(path.join(here, name));
const readJson = name => JSON.parse(readBytes(name));
const rows = response => Array.isArray(response?.data) ? response.data : Array.isArray(response?.data?.items) ? response.data.items : [];
const identity = (skillKey, kind, id) => `${skillKey}/${kind}/${id}`;
const exactDiff = (expectedValue, actualValue, at = '$') => {
  if (isDeepStrictEqual(expectedValue, actualValue)) return null;
  if (expectedValue === null || actualValue === null || typeof expectedValue !== 'object' || typeof actualValue !== 'object') return { path: at, expected: expectedValue, actual: actualValue };
  if (Array.isArray(expectedValue) || Array.isArray(actualValue)) {
    if (!Array.isArray(expectedValue) || !Array.isArray(actualValue) || expectedValue.length !== actualValue.length) return { path: at, expected: expectedValue, actual: actualValue };
    for (let index = 0; index < expectedValue.length; index++) { const child = exactDiff(expectedValue[index], actualValue[index], `${at}[${index}]`); if (child) return child; }
    return null;
  }
  for (const key of [...new Set([...Object.keys(expectedValue), ...Object.keys(actualValue)])].sort()) {
    if (!(key in expectedValue) || !(key in actualValue)) return { path: `${at}.${key}`, expected: expectedValue[key], actual: actualValue[key] };
    const child = exactDiff(expectedValue[key], actualValue[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
};
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !serverFields.has(key)).sort().map(key => [key, canonical(value[key])]))
    : value;
const businessDiff = (expectedValue, actualValue) => exactDiff(canonical(expectedValue), canonical(actualValue));
const parameterValue = value => ({ valueType: value?.valueType, valueMode: value?.valueMode, fixedValue: value?.fixedValue, levelValues: value?.levelValues });
const parameterValueDiff = (expectedValue, actualValue) => exactDiff(parameterValue(expectedValue), parameterValue(actualValue));
const valueOf = (candidate, skillKey, key, context = {}) => {
  const item = candidate.skills[skillKey]?.write.parameters.find(value => value.parameterKey === key);
  if (!item) throw new Error(`缺候选参数 ${skillKey}/${key}`);
  if (item.valueMode === 'FIXED') return Number(item.fixedValue);
  if (item.valueMode === 'SKILL_LEVEL') return Number(item.levelValues[String(context.level ?? 1)]);
  if (item.valueMode === 'RUNTIME_INPUT') {
    if (!(key in context)) throw new Error(`算例缺运行输入 ${skillKey}/${key}`);
    return Number(context[key]);
  }
  throw new Error(`未知参数模式 ${skillKey}/${key}`);
};
const evalExpression = (candidate, skillKey, expression, context) => {
  if (expression?.nodeType === 'PARAMETER') return valueOf(candidate, skillKey, expression.parameterKey, context);
  if (expression?.nodeType === 'ATTRIBUTE') {
    const contextKey = expression.attributeKey === 'attack_damage'
      ? (expression.attributeValueKind === 'BONUS' ? 'bonus_attack_damage' : 'total_attack_damage')
      : expression.attributeKey === 'ability_power'
        ? (expression.attributeValueKind === 'BONUS' ? 'bonus_ability_power' : 'total_ability_power')
        : expression.attributeKey;
    if (!(contextKey in context)) throw new Error(`算例缺属性 ${skillKey}/${expression.attributeKey}/${expression.attributeValueKind}`);
    return Number(context[contextKey]);
  }
  if (expression?.nodeType !== 'OPERATION' || !Array.isArray(expression.operands) || expression.operands.length !== 2) throw new Error(`公式节点非法 ${skillKey}`);
  const [left, right] = expression.operands.map(item => evalExpression(candidate, skillKey, item, context));
  switch (expression.operation) {
    case 'ADD': return left + right;
    case 'SUBTRACT': return left - right;
    case 'MULTIPLY': return left * right;
    case 'DIVIDE': return left / right;
    case 'MIN': return Math.min(left, right);
    case 'MAX': return Math.max(left, right);
    default: throw new Error(`公式运算非法 ${expression.operation}`);
  }
};
const formulaValue = (candidate, skillKey, formulaKey, context) => {
  const formula = candidate.skills[skillKey]?.write.formulas.find(item => item.formulaKey === formulaKey);
  if (!formula) throw new Error(`缺候选公式 ${skillKey}/${formulaKey}`);
  return evalExpression(candidate, skillKey, formula.expression, context);
};
const sourceSkill = (source, skillKey) => {
  for (const hero of source.heroes ?? []) { const found = hero.spells?.find(spell => spell.skillKey === skillKey); if (found) return found; }
  throw new Error(`缺来源技能 ${skillKey}`);
};
const rawData = (source, skillKey, name) => {
  const entry = (sourceSkill(source, skillKey).object.mSpell.DataValues ?? []).find(item => item.name === name);
  if (!entry) throw new Error(`缺来源数据值 ${skillKey}/${name}`);
  return entry.values;
};
const rawRank = (source, skillKey, name, level) => Number(rawData(source, skillKey, name)[level]);
const attrsOf = (expression, result = []) => {
  if (!expression || typeof expression !== 'object') return result;
  if (expression.nodeType === 'ATTRIBUTE') result.push(expression);
  for (const child of expression.operands ?? []) attrsOf(child, result);
  return result;
};

const args = process.argv.slice(2);
if (args.length !== 1 || !['--preflight', '--after-write'].includes(args[0])) throw new Error('必须明确指定 --preflight 或 --after-write');
const mode = args[0] === '--after-write' ? 'after-write' : 'preflight';
const candidateBytes = readBytes(candidateFile);
const versionBytes = readBytes(versionFile);
const planBytes = readBytes(planFile);
const protectionBytes = readBytes(protectionFile);
const protectionSummaryBytes = readBytes(protectionSummaryFile);
const mathBytes = readBytes(mathFile);
const freezeBytes = readBytes(freezeFile);
const originalSnapshotBytes = readBytes(originalSnapshotFile);
const candidate = JSON.parse(candidateBytes);
const version = JSON.parse(versionBytes);
const plan = JSON.parse(planBytes);
const protection = JSON.parse(protectionBytes);
const protectionSummary = JSON.parse(protectionSummaryBytes);
const math = JSON.parse(mathBytes);
const freeze = JSON.parse(freezeBytes);
const originalSnapshot = JSON.parse(originalSnapshotBytes);

const checks = [];
const failures = [];
const check = (name, ok, details = null) => { const item = { name, ok: Boolean(ok), details }; checks.push(item); if (!item.ok) failures.push(item); return item.ok; };
const staticFileChecks = [
  [freezeFile, expected.lockSha256, sha256(freezeBytes)],
  [candidateFile, expected.candidateSha256, sha256(candidateBytes)],
  [versionFile, expected.candidateVersionFileSha256, sha256(versionBytes)],
  [planFile, expected.planFileSha256, sha256(planBytes)],
  [protectionFile, expected.protectionFileSha256, sha256(protectionBytes)],
  [protectionSummaryFile, expected.protectionSummarySha256, sha256(protectionSummaryBytes)],
  [mathFile, expected.mathFileSha256, sha256(mathBytes)],
  [originalSnapshotFile, expected.originalSnapshotSha256, sha256(originalSnapshotBytes)],
];
for (const [name, expectedHash, actualHash] of staticFileChecks) check(`冻结文件 ${name}`, actualHash === expectedHash, actualHash);
check('锁内核心散列一致', freeze.candidateFileSha256 === expected.candidateSha256 && freeze.candidatePlanSha256 === expected.candidatePlanSha256 && freeze.writePlanFileSha256 === expected.planFileSha256 && freeze.independentMathFileSha256 === expected.mathFileSha256 && freeze.protectionFileSha256 === expected.protectionFileSha256, freeze);
check('数学初始55项全通过', math.checkCount === 55 && math.failedChecks === 0 && math.runtimeInputCount === 27, { checkCount: math.checkCount, failedChecks: math.failedChecks, runtimeInputCount: math.runtimeInputCount });
check('写前保护固定188次GET', protectionSummary.requestCount === 188 && protectionSummary.statusCounts?.['200'] === 188 && protectionSummary.errorCount === 0 && protectionSummary.apiWrites === 0, protectionSummary);
check('候选和计划计数冻结', version.newComponentIntents === 175 && plan.requestCount === 175 && plan.reusedPublicParameters?.length === 16, { candidate: version.newComponentIntents, plan: plan.requestCount, reused: plan.reusedPublicParameters?.length });

const expectedEntries = [];
for (const skillKey of skills) for (const [kind, field, endpoint] of kinds) for (const body of candidate.skills[skillKey]?.write?.[kind] ?? []) expectedEntries.push({ skillKey, kind, field, id: body[field], body, route: `/skills/${skillKey}/${endpoint}`, detailRoute: `/skills/${skillKey}/${endpoint}/${encodeURIComponent(body[field])}` });
const entryMap = new Map(expectedEntries.map(entry => [identity(entry.skillKey, entry.kind, entry.id), entry]));
check('候选组成191项且键唯一', entryMap.size === 191 && entryMap.size === expectedEntries.length, { total: expectedEntries.length, unique: entryMap.size });
const reuseKeys = new Set((plan.reusedPublicParameters ?? []).map(item => identity(item.skillKey, 'parameters', item.parameterKey)));
check('复用公共参数16项', reuseKeys.size === 16, [...reuseKeys]);

const independentMath = [];
try {
  const source = JSON.parse(fs.readFileSync(path.join(here, '根绑定与数值证据.json')));
  const crossPath = path.resolve(here, '..', '英雄机制第十七批', '根绑定与数值证据.json');
  const crossBytes = fs.readFileSync(crossPath);
  const crossSha256 = sha256(crossBytes);
  const cross = JSON.parse(crossBytes);
  const crossCalc = cross.heroes?.find(hero => hero.id === 'Vladimir')?.spells?.find(spell => spell.skillKey === 'vladimir_w')?.object?.mSpell?.mSpellCalculations?.TotalDamage;
  const crossPart = crossCalc?.mFormulaParts?.find(part => part?.mDataValue === 'BonusHealthRatio');
  const pushMath = (name, actual, expectedValue, details = {}) => {
    const delta = typeof actual === 'number' && typeof expectedValue === 'number' ? Math.abs(actual - expectedValue) : 0;
    const ok = typeof actual === 'number' && typeof expectedValue === 'number' ? delta < 1e-4 : isDeepStrictEqual(actual, expectedValue);
    independentMath.push({ name, actual, expected: expectedValue, delta, ok, ...details });
    if (!ok) throw new Error(`独立算例不一致 ${name}`);
  };
  pushMath('Aatrox E根乘数', Number(sourceSkill(source, 'aatrox_e').object.mSpell.mSpellCalculations.TotalEVamp.mMultiplier.mNumber), 0.01);
  pushMath('Aatrox E交叉mStat映射', { mStat: crossPart?.mStat ?? null, mStatFormula: crossPart?.mStatFormula ?? null, dataValue: crossPart?.mDataValue ?? null, crossSha256 }, { mStat: 12, mStatFormula: 2, dataValue: 'BonusHealthRatio', crossSha256: 'da3d627ae08acf0af922daae667574be76ea0c5bc14d7d5fb0be7eae929e0b7a' });
  pushMath('Aatrox E参数换算', valueOf(candidate, 'aatrox_e', 'bonus_healing_ratio_per_bonus_health'), 0.00011, { rootMultiplier: 0.01, rawRatio: rawRank(source, 'aatrox_e', 'EVampHPRatio', 1) });
  for (const [bonusHealth, expectedRatio] of [[0, 0.16], [1000, 0.27], [2000, 0.38]]) pushMath(`Aatrox E完整比例/${bonusHealth}`, formulaValue(candidate, 'aatrox_e', 'total_healing_ratio', { hp: bonusHealth }), expectedRatio, { bonusHealth, totalAttackDamage: 200, bonusAttackDamage: 100, formula: '0.16 + 0.00011×SOURCE.hp.BONUS' });
  const ad = { total_attack_damage: 200, bonus_attack_damage: 100 };
  pushMath('Riven Q总攻击力分支', formulaValue(candidate, 'riven_q', 'first_slash_damage', { level: 3, ...ad }), rawRank(source, 'riven_q', 'BaseDamage', 3) + rawRank(source, 'riven_q', 'ADRatio', 3) * 200, { totalAttackDamage: 200, bonusAttackDamage: 100, attributeValueKind: 'TOTAL' });
  pushMath('Riven W额外攻击力分支', formulaValue(candidate, 'riven_w', 'total_damage', { level: 5, ...ad }), rawRank(source, 'riven_w', 'BaseDamage', 5) + 100, { totalAttackDamage: 200, bonusAttackDamage: 100, attributeValueKind: 'BONUS' });
  pushMath('Aatrox Q总攻击力分支', formulaValue(candidate, 'aatrox_q', 'q_damage', { level: 5, ...ad }), rawRank(source, 'aatrox_q', 'QBaseDamage', 5) + rawRank(source, 'aatrox_q', 'QTotalADRatio', 5) * 200, { totalAttackDamage: 200, bonusAttackDamage: 100, attributeValueKind: 'TOTAL' });
  pushMath('Rengar E额外攻击力分支', formulaValue(candidate, 'rengar_e', 'total_damage', { level: 5, ...ad }), rawRank(source, 'rengar_e', 'BaseDamage', 5) + rawRank(source, 'rengar_e', 'BonusADRatio', 5) * 100, { totalAttackDamage: 200, bonusAttackDamage: 100, attributeValueKind: 'BONUS' });
  const actualDamage = candidate.skills.aatrox_p.write.parameters.find(item => item.parameterKey === 'passive_actual_damage');
  pushMath('Aatrox P实际命中伤害无默认', { valueMode: actualDamage?.valueMode, fixedValue: actualDamage?.fixedValue, levelValues: actualDamage?.levelValues }, { valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null });
  const armor = candidate.skills.rengar_r.write.parameters.find(item => item.parameterKey === 'armor_shred_points');
  pushMath('Rengar R固定护甲削减点数', armor?.levelValues ?? null, { '1': 15, '2': 20, '3': 25 });
  const attackMappings = [
    ['riven_w', 'total_damage', 'BONUS'], ['riven_e', 'total_shield', 'BONUS'], ['riven_r', 'wind_slash_min_damage', 'BONUS'], ['riven_r', 'wind_slash_max_damage', 'BONUS'],
    ['rengar_e', 'total_damage', 'BONUS'], ['rengar_e', 'total_empowered_damage', 'BONUS'], ['khazix_p', 'passive_damage', 'BONUS'], ['khazix_q', 'base_damage', 'BONUS'], ['khazix_w', 'base_damage', 'BONUS'], ['khazix_e', 'total_damage', 'BONUS'],
    ['riven_q', 'first_slash_damage', 'TOTAL'], ['riven_r', 'bonus_attack_damage', 'TOTAL'], ['aatrox_q', 'q_damage', 'TOTAL'], ['aatrox_w', 'w_damage', 'TOTAL'], ['rengar_q', 'q_total_damage', 'TOTAL'], ['rengar_q', 'empowered_q_total_damage', 'TOTAL'],
  ];
  for (const [skillKey, formulaKey, expectedKind] of attackMappings) {
    const formula = candidate.skills[skillKey].write.formulas.find(item => item.formulaKey === formulaKey);
    const actualKinds = attrsOf(formula?.expression).filter(item => item.attributeKey === 'attack_damage').map(item => item.attributeValueKind);
    pushMath(`攻击力选择/${skillKey}/${formulaKey}`, actualKinds.every(value => value === expectedKind), true, { actualKinds, expectedKind });
  }
  check('独立源树与算例', independentMath.every(item => item.ok), { checks: independentMath.length, failed: independentMath.filter(item => !item.ok).length, totalAttackDamage: 200, bonusAttackDamage: 100 });
} catch (error) {
  failures.push({ name: '独立源树与算例异常', error: `${error.name}: ${error.message}` });
  check('独立源树与算例', false, `${error.name}: ${error.message}`);
}

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(here, '修订一独立回读', runId);
await fsp.mkdir(runDir, { recursive: true });
await fsp.writeFile(path.join(runDir, '运行锁.json'), JSON.stringify({ at: new Date().toISOString(), runId, mode, candidateSha256: expected.candidateSha256, planSha256: expected.planFileSha256, apiWrites: 0 }, null, 2) + '\n', { flag: 'wx' });
const journalPath = path.join(runDir, 'HTTP流水.jsonl');
const calls = [];
const appendJsonl = async value => { const handle = await fsp.open(journalPath, 'a'); try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); } };
const request = async (route, options = {}) => {
  const allow404 = options.allow404 === true;
  if (!route.startsWith('/') || route.includes('://') || route.includes('..')) throw new Error(`非法GET路径：${route}`);
  const sequence = calls.length + 1;
  await appendJsonl({ sequence, phase: '请求前', at: new Date().toISOString(), method: 'GET', route });
  const started = Date.now();
  let result;
  try {
    const response = await fetch(apiBase + route, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const raw = await response.text();
    let data = null;
    let parseError = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (error) { parseError = `${error.name}: ${error.message}`; }
    result = { sequence, at: new Date().toISOString(), method: 'GET', route, status: response.status, ok: response.ok && !parseError, elapsedMs: Date.now() - started, data, ...(parseError ? { parseError, rawBytes: Buffer.byteLength(raw), rawSha256: sha256(raw) } : {}) };
  } catch (error) {
    result = { sequence, at: new Date().toISOString(), method: 'GET', route, status: null, ok: false, elapsedMs: Date.now() - started, data: null, error: `${error.name}: ${error.message}` };
  }
  calls.push(result);
  await appendJsonl({ ...result, phase: '请求后' });
  if (!result.ok && !(allow404 && result.status === 404)) throw new Error(`GET失败，立即停止：${route} status=${result.status ?? 'network'}`);
  return result;
};

async function fetchState() {
  const state = { catalogs: {}, characters: {}, relations: {}, images: {}, skills: {} };
  for (const [name] of catalogs) state.catalogs[name] = await request(`/${name}`);
  for (const hero of heroes) {
    state.characters[hero] = await request(`/characters/champion_${hero}`);
    state.relations[hero] = await request(`/character-skill-relations?characterKey=champion_${hero}`);
  }
  for (const skillKey of skills) {
    state.skills[skillKey] = { subject: await request(`/skills/${skillKey}`), components: {} };
    state.images[skillKey] = await request(`/skills/${skillKey}/representative-image`, { allow404: true });
    for (const [kind, field, endpoint] of kinds) {
      const list = await request(`/skills/${skillKey}/${endpoint}`);
      const items = rows(list);
      const seen = new Set();
      for (const item of items) {
        const id = item?.[field];
        if (typeof id !== 'string' || seen.has(id)) throw new Error(`列表稳定键无效或重复，立即停止：${skillKey}/${kind}/${id}`);
        seen.add(id);
      }
      state.skills[skillKey].components[kind] = { list, items, details: [] };
      if (mode === 'preflight') {
        for (const item of items) state.skills[skillKey].components[kind].details.push({ id: item[field], item, detail: await request(`/skills/${skillKey}/${endpoint}/${encodeURIComponent(item[field])}`) });
      }
    }
  }
  if (mode === 'after-write') {
    for (const entry of expectedEntries) {
      const detail = await request(entry.detailRoute);
      const component = state.skills[entry.skillKey].components[entry.kind];
      component.details.push({ id: entry.id, item: component.items.find(item => item[entry.field] === entry.id) ?? null, detail });
    }
  }
  return state;
}

const listSummaryDiff = (item, detail) => {
  if (!item || !detail) return null;
  for (const [key, expectedValue] of Object.entries(item)) {
    const actualValue = key === 'resultCount'
      ? Array.isArray(detail.results) ? detail.results.length : undefined
      : key === 'lifecycleEnabled'
        ? detail.lifecycle !== null && detail.lifecycle !== undefined
        : detail[key];
    if (!isDeepStrictEqual(expectedValue, actualValue)) return { path: key, expected: expectedValue, actual: actualValue };
  }
  return null;
};
function compareProtected(before, after) {
  const conflicts = [];
  for (const [name] of catalogs) { const item = exactDiff(before.catalogs?.[name]?.data, after.catalogs?.[name]?.data); if (item) conflicts.push({ type: 'catalog', name, diff: item }); }
  for (const hero of heroes) {
    for (const [type, key] of [['character', 'characters'], ['relation', 'relations']]) { const item = exactDiff(before[key]?.[hero]?.data, after[key]?.[hero]?.data); if (item) conflicts.push({ type, hero, diff: item }); }
  }
  for (const skillKey of skills) {
    for (const [type, key] of [['subject', 'skills'], ['image', 'images']]) {
      const beforeData = type === 'subject' ? before.skills?.[skillKey]?.subject?.data : before.images?.[skillKey]?.data;
      const afterData = type === 'subject' ? after.skills?.[skillKey]?.subject?.data : after.images?.[skillKey]?.data;
      const item = exactDiff(beforeData, afterData); if (item) conflicts.push({ type, skillKey, diff: item });
    }
    for (const [kind] of kinds) {
      const beforeComponent = before.skills?.[skillKey]?.components?.[kind];
      const afterComponent = after.skills?.[skillKey]?.components?.[kind];
      const beforeItems = beforeComponent?.items ?? [];
      const afterItems = afterComponent?.items ?? [];
      const afterById = new Map(afterItems.map(item => [item[kinds.find(row => row[0] === kind)[1]], item]));
      for (const oldItem of beforeItems) {
        const field = kinds.find(row => row[0] === kind)[1];
        const currentItem = afterById.get(oldItem[field]);
        const itemDiff = exactDiff(oldItem, currentItem);
        if (itemDiff) conflicts.push({ type: 'protectedListItem', skillKey, kind, id: oldItem[field], diff: itemDiff });
      }
      const oldDetails = new Map((beforeComponent?.details ?? []).map(item => [item.id, item.detail?.data]));
      const newDetails = new Map((afterComponent?.details ?? []).map(item => [item.id, item.detail?.data]));
      for (const [id, oldData] of oldDetails) { const itemDiff = exactDiff(oldData, newDetails.get(id)); if (itemDiff) conflicts.push({ type: 'protectedDetail', skillKey, kind, id, diff: itemDiff }); }
    }
  }
  return conflicts;
}
function compareComponents(state) {
  const conflicts = [];
  const details = new Map();
  const listKeys = new Map();
  for (const skillKey of skills) for (const [kind, field] of kinds) {
    const component = state.skills[skillKey].components[kind];
    const ids = component.items.map(item => item[field]);
    listKeys.set(`${skillKey}/${kind}`, new Set(ids));
    for (const record of component.details) details.set(identity(skillKey, kind, record.id), record);
    for (const item of component.items) {
      const record = component.details.find(value => value.id === item[field]);
      const summaryDiff = listSummaryDiff(item, record?.detail?.data);
      if (summaryDiff) conflicts.push({ type: 'listDetailMismatch', skillKey, kind, id: item[field], diff: summaryDiff });
    }
  }
  const expectedKeys = new Set(expectedEntries.map(entry => identity(entry.skillKey, entry.kind, entry.id)));
  if (mode === 'preflight') {
    const expectedExisting = new Set();
    for (const skillKey of skills) for (const [kind, field] of kinds) for (const item of protection.skills?.[skillKey]?.components?.[kind]?.items ?? []) expectedExisting.add(identity(skillKey, kind, item[field]));
    const actualKeys = new Set([...listKeys.values()].flatMap(value => [...value]));
    const actualIdentityKeys = new Set();
    for (const skillKey of skills) for (const [kind, field] of kinds) for (const item of state.skills[skillKey].components[kind].items) actualIdentityKeys.add(identity(skillKey, kind, item[field]));
    if (!isDeepStrictEqual(actualIdentityKeys, expectedExisting)) conflicts.push({ type: 'preflightExistingKeys', expected: [...expectedExisting], actual: [...actualIdentityKeys] });
    if (details.size !== 16) conflicts.push({ type: 'preflightDetailCount', expected: 16, actual: details.size });
  } else {
    const actualIdentityKeys = new Set();
    for (const skillKey of skills) for (const [kind, field] of kinds) for (const item of state.skills[skillKey].components[kind].items) actualIdentityKeys.add(identity(skillKey, kind, item[field]));
    if (!isDeepStrictEqual(actualIdentityKeys, expectedKeys)) conflicts.push({ type: 'afterWriteComponentKeys', expected: [...expectedKeys], actual: [...actualIdentityKeys] });
    if (details.size !== 191) conflicts.push({ type: 'afterWriteDetailCount', expected: 191, actual: details.size });
    for (const entry of expectedEntries) {
      const record = details.get(identity(entry.skillKey, entry.kind, entry.id));
      if (!record?.detail?.ok || record.detail.status !== 200) { conflicts.push({ type: 'missingDetail', key: identity(entry.skillKey, entry.kind, entry.id), status: record?.detail?.status ?? null }); continue; }
      if (reuseKeys.has(identity(entry.skillKey, entry.kind, entry.id))) {
        const old = protection.skills?.[entry.skillKey]?.components?.parameters?.details?.find(item => item.id === entry.id)?.detail?.data;
        const itemDiff = exactDiff(old, record.detail.data); if (itemDiff) conflicts.push({ type: 'reusedParameterChanged', key: identity(entry.skillKey, entry.kind, entry.id), diff: itemDiff });
      } else {
        const itemDiff = businessDiff(entry.body, record.detail.data); if (itemDiff) conflicts.push({ type: 'candidateDetailMismatch', key: identity(entry.skillKey, entry.kind, entry.id), diff: itemDiff });
      }
    }
  }
  return { conflicts, details, listKeys };
}

const result = {
  at: new Date().toISOString(),
  mode,
  apiBase,
  candidateSha256: expected.candidateSha256,
  planSha256: expected.planFileSha256,
  apiWrites: 0,
  staticChecks: checks,
  staticFailures: failures,
  independentMath,
  calls: null,
  protectionConflicts: null,
  componentConflicts: null,
  success: false,
};
try {
  if (failures.length) throw new Error(`静态或独立数学检查失败${failures.length}项`);
  const state = await fetchState();
  const expectedRequestCount = mode === 'preflight' ? 188 : 363;
  result.calls = {
    total: calls.length,
    expected: expectedRequestCount,
    methods: calls.reduce((out, call) => { out[call.method] = (out[call.method] ?? 0) + 1; return out; }, {}),
    statuses: calls.reduce((out, call) => { out[String(call.status)] = (out[String(call.status)] ?? 0) + 1; return out; }, {}),
  };
  if (calls.length !== expectedRequestCount || calls.some(call => call.method !== 'GET') || calls.some(call => call.status !== 200)) throw new Error(`GET数量或状态异常：${JSON.stringify(result.calls)}`);
  result.protectionConflicts = compareProtected(protection, state);
  result.componentConflicts = compareComponents(state).conflicts;
  const snapshot = { at: result.at, mode, sourceVersion: 'client16.17/official16.17.1', subjects: state.skills, catalogs: state.catalogs, characters: state.characters, relations: state.relations, images: state.images, calls, protectionConflicts: result.protectionConflicts, componentConflicts: result.componentConflicts, apiWrites: 0 };
  await fsp.writeFile(path.join(runDir, '独立全量回读.json'), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
  if (result.protectionConflicts.length || result.componentConflicts.length) throw new Error(`全量回读冲突：保护${result.protectionConflicts.length}项，组成${result.componentConflicts.length}项`);
  result.success = true;
} catch (error) {
  result.error = { name: error.name, message: error.message };
} finally {
  result.finishedAt = new Date().toISOString();
  result.apiWrites = calls.filter(call => call.method !== 'GET').length;
  await fsp.writeFile(path.join(runDir, '执行结果.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ success: result.success, mode, runId, apiWrites: result.apiWrites, calls: result.calls, staticFailures: result.staticFailures.length, independentMathChecks: independentMath.length, protectionConflicts: result.protectionConflicts?.length ?? null, componentConflicts: result.componentConflicts?.length ?? null, error: result.error ?? null, output: runDir }, null, 2));
if (!result.success) process.exitCode = 1;
