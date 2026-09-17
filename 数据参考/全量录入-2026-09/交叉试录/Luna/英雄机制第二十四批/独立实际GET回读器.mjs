import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 这是独立的全量GET回读器。它不读取写入器运行目录，永远只发送GET；--after-apply时再从实际公式详情取值核算。
const here = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const candidateName = '完整候选.json';
const versionName = '候选版本.json';
const planName = '写入请求计划.json';
const freezeName = '写入准备冻结.json';
const snapshotName = '写前现值.json';
const sourceName = '来源冻结/主技能数值展开.json';
const supplementalProtectionName = '根补充角色关系图片保护.json';
const heroes = ['nunu', 'sejuani', 'sion', 'volibear'];
const skills = heroes.flatMap(hero => ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`));
const supplementalRoutes = heroes.flatMap(hero => {
  const characterKey = `champion_${hero}`;
  const heroSkills = ['p', 'q', 'w', 'e', 'r'].map(slot => `${hero}_${slot}`);
  return [
    { category: 'characters', route: `/characters/${characterKey}` },
    { category: 'relations', route: `/character-skill-relations?characterKey=${characterKey}` },
    ...heroSkills.map(skillKey => ({ category: 'images', route: `/skills/${skillKey}/representative-image` })),
  ];
});
const kinds = [
  ['parameters', 'parameterKey', 'parameters'],
  ['formulas', 'formulaKey', 'formulas'],
  ['effects', 'effectKey', 'effects'],
  ['processes', 'processKey', 'processes'],
  ['internalStates', 'stateKey', 'internal-states'],
  ['triggerRules', 'ruleKey', 'trigger-rules'],
];
const catalogKinds = [
  ['attributes', 'attributeKey'],
  ['modifier-zones', 'modifierZoneKey'],
  ['damage-types', 'damageTypeKey'],
  ['statuses', 'statusKey'],
];
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const allowedNodeTypes = new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']);
const allowedOperations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--after-apply')) throw Error('只接受默认当前回读或 --after-apply');
const afterApply = args.includes('--after-apply');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fileBytes = name => fs.readFileSync(path.join(here, name));
const readJson = name => JSON.parse(fileBytes(name));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : Array.isArray(value?.data?.items) ? value.data.items : [];
const endpointKind = kind => kinds.find(item => item[0] === kind)?.[2];
const keyOf = (skillKey, kind, id) => `${skillKey}/${kind}/${id}`;
const exactCanonical = value => Array.isArray(value)
  ? value.map(exactCanonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, exactCanonical(value[key])]))
    : value;
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !serverFields.has(key)).sort().map(key => [key, canonical(value[key])]))
    : value;
const diff = (expected, actual, at = '$') => {
  if (equal(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return { path: at, expected, actual };
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return { path: at, expected, actual };
    for (let index = 0; index < expected.length; index++) { const child = diff(expected[index], actual[index], `${at}[${index}]`); if (child) return child; }
    return null;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    if (!(key in expected) || !(key in actual)) return { path: `${at}.${key}`, expected: expected[key], actual: actual[key] };
    const child = diff(expected[key], actual[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
};
const exactDiff = (expected, actual) => diff(exactCanonical(expected), exactCanonical(actual));
const businessDiff = (expected, actual) => diff(canonical(expected), canonical(actual));
const detailData = record => record?.detail?.data ?? record?.detail?.response ?? record?.response?.data ?? record?.data ?? null;
const listSummaryDiff = (item, detail) => {
  if (!item || !detail) return { path: '$', expected: '详情对象', actual: detail };
  const countFields = { actionCount: 'actions', conditionGroupCount: 'conditionGroups', effectBindingCount: 'effectBindings', resultCount: 'results', stateOperationCount: 'stateOperations', stepCount: 'steps' };
  for (const [key, expectedValue] of Object.entries(item)) {
    if (key === 'updatedAt' && !(key in detail)) continue;
    const actualValue = countFields[key]
      ? Array.isArray(detail[countFields[key]]) ? detail[countFields[key]].length : undefined
      : key === 'eventType'
        ? detail.eventSource?.eventType
        : key === 'maxTriggersPerProcessEnabled'
          ? detail.maxTriggersPerProcess !== null && detail.maxTriggersPerProcess !== undefined
          : key === 'perTargetCooldownEnabled'
            ? detail.perTargetCooldown !== null && detail.perTargetCooldown !== undefined
            : key === 'lifecycleEnabled'
              ? detail.lifecycle !== null && detail.lifecycle !== undefined
              : detail[key];
    if (!equal(expectedValue, actualValue)) return { path: key, expected: expectedValue, actual: actualValue };
  }
  return null;
};

const candidateBytes = fileBytes(candidateName);
const versionBytes = fileBytes(versionName);
const planBytes = fileBytes(planName);
const freezeBytes = fileBytes(freezeName);
const snapshotBytes = fileBytes(snapshotName);
const supplementalProtectionBytes = fileBytes(supplementalProtectionName);
const candidate = JSON.parse(candidateBytes);
const version = JSON.parse(versionBytes);
const plan = JSON.parse(planBytes);
const freeze = JSON.parse(freezeBytes);
const baseline = JSON.parse(snapshotBytes);
const source = readJson(sourceName);
const supplementalBaseline = JSON.parse(supplementalProtectionBytes);
const failures = [];
const staticChecks = [];
const check = (name, passed, detail = null) => { const row = { name, passed: Boolean(passed), detail }; staticChecks.push(row); if (!row.passed) failures.push({ name, detail }); return row.passed; };
const checkHash = (name, actual, expected) => check(name, actual === expected, { actual, expected });
checkHash('候选散列冻结', sha256(candidateBytes), freeze.candidateSha256);
checkHash('候选版本散列冻结', sha256(versionBytes), freeze.candidateVersionSha256);
checkHash('请求计划散列冻结', sha256(planBytes), freeze.requestPlanSha256);
checkHash('写前现值散列冻结', sha256(snapshotBytes), freeze.snapshotSha256);
checkHash('源数值展开散列冻结', sha256(fileBytes(sourceName)), freeze.sourceHashes?.[sourceName]);
check('候选版本内部候选散列一致', version.fileSha256 === sha256(candidateBytes), { declared: version.fileSha256, actual: sha256(candidateBytes) });

const supplementalBaselineByRoute = new Map((supplementalBaseline.requests ?? []).map(item => [item.route, item]));
const expectedSupplementalRoutes = supplementalRoutes.map(item => item.route);
const actualSupplementalRoutes = supplementalBaseline.requests?.map(item => item.route) ?? [];
check('角色关系图片保护基线28项', supplementalBaseline.GETs === 28 && supplementalBaseline.apiWrites === 0 && actualSupplementalRoutes.length === 28 && new Set(actualSupplementalRoutes).size === 28 && expectedSupplementalRoutes.every(route => supplementalBaselineByRoute.has(route)), { declaredGETs: supplementalBaseline.GETs, declaredApiWrites: supplementalBaseline.apiWrites, routes: actualSupplementalRoutes });
check('角色关系图片保护基线均为成功GET', (supplementalBaseline.requests ?? []).every(item => item.status === 200 && item.data !== undefined && item.data !== null), supplementalBaseline.requests?.map(item => ({ route: item.route, status: item.status, hasData: item.data !== undefined && item.data !== null })) ?? []);

const reuseSet = new Set((plan.reuseParameters ?? []).map(item => `${item.skillKey}/${item.parameterKey}`));
const candidateByKey = new Map();
const candidateEntries = [];
for (const skillKey of skills) for (const [kind, field] of kinds) for (const body of candidate.skills?.[skillKey]?.write?.[kind] ?? []) {
  const id = body[field];
  const entry = { skillKey, kind, id, body, route: `/skills/${encodeURIComponent(skillKey)}/${endpointKind(kind)}`, detailRoute: `/skills/${encodeURIComponent(skillKey)}/${endpointKind(kind)}/${encodeURIComponent(id ?? '')}` };
  const key = keyOf(skillKey, kind, id);
  if (candidateByKey.has(key)) check(`候选键唯一/${key}`, false, '重复');
  candidateByKey.set(key, entry); candidateEntries.push(entry);
}
check('候选组成286项', candidateEntries.length === 286, candidateEntries.length);
check('请求计划257项', plan.requests?.length === 257 && plan.plannedPostCount === 257, { actual: plan.requests?.length, declared: plan.plannedPostCount });

const baselineByKey = new Map();
for (const skillKey of skills) for (const [kind, field] of kinds) {
  const block = baseline.skills?.[skillKey]?.components?.[kind];
  const items = block?.items ?? rows(block?.list?.data);
  const details = block?.details ?? [];
  for (const item of items) {
    const id = item?.[field];
    const record = details.find(detail => detail.id === id || detail.item?.[field] === id);
    baselineByKey.set(keyOf(skillKey, kind, id), { list: item, detail: detailData(record) });
  }
}
check('冻结现有详情29项', baselineByKey.size === 29, baselineByKey.size);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(here, '独立实际GET回读', runId);
const journalPath = path.join(runDir, '所有GET原始响应.jsonl');
await fsp.mkdir(runDir, { recursive: true });
await fsp.writeFile(path.join(runDir, '运行锁.json'), JSON.stringify({ at: new Date().toISOString(), runId, mode: afterApply ? '写后独立全量GET与实际公式核算' : '当前独立全量GET', candidateSha256: sha256(candidateBytes), requestPlanSha256: sha256(planBytes), apiWrites: 0, status: 'RUNNING' }, null, 2) + '\n', { flag: 'wx' });
const calls = [];
const request = async route => {
  if (typeof route !== 'string' || !route.startsWith('/') || route.includes('://') || route.includes('..')) throw Error(`非法GET路径：${route}`);
  const sequence = calls.length + 1; const startedAt = new Date().toISOString();
  await fsp.appendFile(journalPath, JSON.stringify({ sequence, phase: '请求前', at: startedAt, method: 'GET', route }) + '\n');
  const started = Date.now(); let result;
  try {
    const response = await fetch(apiBase + route, { method: 'GET', headers: { Authorization: `Bearer ${process.env.HERO24_API_TOKEN ?? 'local-entry'}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const raw = await response.text(); let data = null; let parseError = false;
    try { data = raw ? JSON.parse(raw) : null; } catch { parseError = true; }
    result = { sequence, method: 'GET', route, status: response.status, ok: response.ok && !parseError, data, ...(parseError ? { parseError: true, responseBytes: Buffer.byteLength(raw), responseSha256: sha256(raw) } : {}) };
  } catch (error) { result = { sequence, method: 'GET', route, status: null, ok: false, data: null, error: `${error.name}: ${error.message}` }; }
  calls.push(result);
  await fsp.appendFile(journalPath, JSON.stringify({ ...result, phase: '请求后', at: new Date().toISOString(), elapsedMs: Date.now() - started }) + '\n');
  if (!result.ok) failures.push({ name: `GET失败 ${route}`, detail: { status: result.status, error: result.error } });
  return result;
};
const mustGet = async route => { const result = await request(route); if (!result.ok) throw Error(`GET失败：${route} status=${result.status ?? 'network'}`); return result; };

const protection = { catalogs: {}, subjects: {} };
for (const [name] of catalogKinds) protection.catalogs[name] = await mustGet(`/${name}`);
for (const skillKey of skills) protection.subjects[skillKey] = await mustGet(`/skills/${encodeURIComponent(skillKey)}`);
const protectionConflicts = [];
for (const [name] of catalogKinds) { const difference = exactDiff(baseline.catalogs?.[name]?.data, protection.catalogs[name]?.data); if (difference) protectionConflicts.push({ type: '目录漂移', name, diff: difference }); }
for (const skillKey of skills) { const difference = exactDiff(baseline.skills?.[skillKey]?.subject?.data, protection.subjects[skillKey]?.data); if (difference) protectionConflicts.push({ type: '技能主体漂移', skillKey, diff: difference }); }
if (protectionConflicts.length) failures.push({ name: '保护对象漂移', detail: protectionConflicts });

const supplementalProtection = [];
const supplementalConflicts = [];
for (const expected of supplementalRoutes) {
  const actual = await mustGet(expected.route);
  const frozen = supplementalBaselineByRoute.get(expected.route);
  if (!frozen) supplementalConflicts.push({ type: '角色关系图片保护基线缺失', category: expected.category, route: expected.route });
  else {
    if (frozen.status !== actual.status) supplementalConflicts.push({ type: '角色关系图片状态漂移', category: expected.category, route: expected.route, expected: frozen.status, actual: actual.status });
    const difference = exactDiff(frozen.data, actual.data);
    if (difference) supplementalConflicts.push({ type: '角色关系图片详情漂移', category: expected.category, route: expected.route, diff: difference });
  }
  supplementalProtection.push({ category: expected.category, route: expected.route, status: actual.status, data: actual.data });
}
if (supplementalConflicts.length) failures.push({ name: '角色主体、技能关系或代表图片保护漂移', detail: supplementalConflicts });

const maps = Object.fromEntries(catalogKinds.map(([name, field]) => [field, new Map(rows(protection.catalogs[name]?.data).map(item => [item[field], item]))]));
const catalogReferences = []; const catalogConflicts = [];
const walkCatalog = (value, at) => {
  if (Array.isArray(value)) return value.forEach((item, index) => walkCatalog(item, `${at}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (maps[key] && typeof child === 'string') { const item = maps[key].get(child); const ref = { at: `${at}.${key}`, key, value: child, enabled: item?.status === 'ENABLED' }; catalogReferences.push(ref); if (!ref.enabled) catalogConflicts.push(ref); }
    walkCatalog(child, `${at}.${key}`);
  }
};
for (const entry of candidateEntries) walkCatalog(entry.body, keyOf(entry.skillKey, entry.kind, entry.id));
if (catalogConflicts.length) failures.push({ name: '候选目录引用缺失或未启用', detail: catalogConflicts });

const lists = []; const details = []; const detailByKey = new Map(); const componentConflicts = []; const seenKeys = new Set();
for (const skillKey of skills) for (const [kind, field, endpoint] of kinds) {
  const route = `/skills/${encodeURIComponent(skillKey)}/${endpoint}`; const response = await mustGet(route); const items = rows(response.data);
  const ids = items.map(item => item?.[field]);
  if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) componentConflicts.push({ type: '列表键重复或非法', skillKey, kind, ids });
  lists.push({ skillKey, kind, route, status: response.status, items });
  for (const item of items) {
    const id = item[field]; const key = keyOf(skillKey, kind, id); seenKeys.add(key); const detailRoute = `${route}/${encodeURIComponent(id)}`; const detailResponse = await mustGet(detailRoute); const data = detailResponse.data;
    const summaryDifference = listSummaryDiff(item, data); if (summaryDifference) componentConflicts.push({ type: '列表详情摘要不一致', skillKey, kind, id, diff: summaryDifference });
    const frozen = baselineByKey.get(key); const candidateEntry = candidateByKey.get(key);
    if (!frozen && !candidateEntry) componentConflicts.push({ type: '发现计划外组成', skillKey, kind, id });
    if (frozen) {
      const listDifference = exactDiff(frozen.list, item); const detailDifference = exactDiff(frozen.detail, data);
      if (listDifference) componentConflicts.push({ type: '冻结列表行漂移', skillKey, kind, id, diff: listDifference });
      if (detailDifference) componentConflicts.push({ type: '冻结详情漂移', skillKey, kind, id, diff: detailDifference });
      if (candidateEntry?.kind === 'parameters') for (const fieldName of ['valueType', 'valueMode', 'fixedValue', 'levelValues']) if (!equal(candidateEntry.body[fieldName], data?.[fieldName])) componentConflicts.push({ type: '复用参数值漂移', skillKey, kind, id, field: fieldName, expected: candidateEntry.body[fieldName], actual: data?.[fieldName] });
    } else if (candidateEntry) {
      const difference = businessDiff(candidateEntry.body, data); if (difference) componentConflicts.push({ type: '候选组成详情异值', skillKey, kind, id, diff: difference });
    }
    const record = { skillKey, kind, id, route: detailRoute, status: detailResponse.status, listItem: item, data, listSummaryDiff: summaryDifference };
    details.push(record); detailByKey.set(key, record);
  }
}
for (const [key] of baselineByKey) if (!seenKeys.has(key)) componentConflicts.push({ type: '冻结组成从列表消失', key });
const candidatePresent = candidateEntries.filter(entry => detailByKey.has(keyOf(entry.skillKey, entry.kind, entry.id))).length;
const candidateNewEntries = candidateEntries.filter(entry => !(entry.kind === 'parameters' && reuseSet.has(`${entry.skillKey}/${entry.id}`)));
const candidateNewPresent = candidateNewEntries.filter(entry => detailByKey.has(keyOf(entry.skillKey, entry.kind, entry.id))).length;
if (afterApply && candidatePresent !== 286) componentConflicts.push({ type: '写后候选未全量存在', candidatePresent, expected: 286 });
if (!afterApply && candidateNewPresent !== 0) componentConflicts.push({ type: '当前回读发现新增候选已落地，请使用写后模式', candidateNewPresent });
if (componentConflicts.length) failures.push({ name: '组成列表或详情冲突', detail: componentConflicts });

function closeEnough(left, right) { return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-7 * Math.max(1, Math.abs(left), Math.abs(right)); }
const sourceHeroes = new Map(source.heroes.flatMap(hero => (hero.bindings ?? []).map(skill => [skill.skillKey, skill])));
const sourceValue = (skillKey, dataName, level, scale = 1) => {
  const entry = sourceHeroes.get(skillKey)?.dataValues?.find(item => item.name === dataName); const value = entry?.values?.[level];
  if (!Number.isFinite(value)) throw Error(`来源数值缺失 ${skillKey}/${dataName}/${level}`); return Number(value) * scale;
};
const attrs = overrides => ({
  ability_power: { TOTAL: overrides.abilityPower },
  attack_damage: { TOTAL: overrides.attackDamageTotal, BONUS: overrides.attackDamageBonus },
  hp: { TOTAL: overrides.hpTotal, BONUS: overrides.hpBonus },
  armor: { BONUS: overrides.armorBonus },
  magic_resistance: { BONUS: overrides.mrBonus },
});
const inputCase = (name, level, overrides) => ({ name, level, attrs: attrs(overrides), runtime: { target_max_health: overrides.targetMaxHealth, source_missing_health: overrides.sourceMissingHealth, chain_lightning_base_damage: overrides.chainLightningBase, source_bonus_armor: overrides.sourceBonusArmor, attack_speed_stacks: overrides.attackSpeedStacks } });
const parameterDetails = new Map(details.filter(item => item.kind === 'parameters').map(item => [keyOf(item.skillKey, item.kind, item.id), item.data]));
const parameterValue = (skillKey, parameterKey, testCase) => {
  if (Object.hasOwn(testCase.runtime, parameterKey)) return testCase.runtime[parameterKey];
  const parameter = parameterDetails.get(keyOf(skillKey, 'parameters', parameterKey));
  if (!parameter) throw Error(`实际参数详情缺失 ${skillKey}/${parameterKey}`);
  if (parameter.valueMode === 'FIXED') return parameter.fixedValue;
  if (parameter.valueMode === 'SKILL_LEVEL') return parameter.levelValues?.[String(testCase.level)];
  throw Error(`缺少运行输入 ${skillKey}/${parameterKey}`);
};
const liveAttribute = (context, owner, key, valueKind) => {
  if (owner !== 'SOURCE') throw Error(`独立核对未准备${owner}属性`);
  const value = context.attrs[key]?.[valueKind]; if (!Number.isFinite(value)) throw Error(`缺少属性输入 ${key}/${valueKind}`); return value;
};
const evaluate = (node, skillKey, testCase, at = '$') => {
  if (!node || typeof node !== 'object') throw Error(`实际公式节点为空 ${at}`);
  if (node.nodeType === 'PARAMETER') { const value = parameterValue(skillKey, node.parameterKey, testCase); if (!Number.isFinite(Number(value))) throw Error(`参数无实际值 ${skillKey}/${node.parameterKey}`); return Number(value); }
  if (node.nodeType === 'ATTRIBUTE') return liveAttribute(testCase, node.attributeOwner, node.attributeKey, node.attributeValueKind);
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2 || !allowedOperations.has(node.operation)) throw Error(`实际公式不是允许的二元运算 ${at}`);
  const left = evaluate(node.operands[0], skillKey, testCase, `${at}.operands[0]`); const right = evaluate(node.operands[1], skillKey, testCase, `${at}.operands[1]`);
  if (node.operation === 'ADD') return left + right;
  if (node.operation === 'SUBTRACT') return left - right;
  if (node.operation === 'MULTIPLY') return left * right;
  if (node.operation === 'DIVIDE') { if (right === 0) throw Error(`除数为0 ${at}`); return left / right; }
  if (node.operation === 'MIN') return Math.min(left, right);
  return Math.max(left, right);
};
const parameterKeysIn = (node, result = new Set()) => { if (!node || typeof node !== 'object') return result; if (node.nodeType === 'PARAMETER') result.add(node.parameterKey); for (const child of node.operands ?? []) parameterKeysIn(child, result); return result; };
const expectedValue = (key, testCase) => {
  const [skillKey] = key.split('/'); const a = testCase.attrs; const ap = a.ability_power.TOTAL; const ad = a.attack_damage.TOTAL; const bad = a.attack_damage.BONUS; const hp = a.hp.TOTAL; const bhp = a.hp.BONUS;
  const d = (name, scale = 1) => sourceValue(skillKey, name, testCase.level, scale);
  switch (key) {
    case 'nunu_q/monster_healing': return d('BaseHealing') + d('PercentageOfBonusHP') * bhp + d('MonsterHealingAPRatio') * ap;
    case 'nunu_q/champion_damage': return d('ChampionDamage') + d('BonusMaxHPDamage') * bhp + d('ChampDamageAPRatio') * ap;
    case 'nunu_q/champion_healing': return d('ChampionHealingScalar') * (d('BaseHealing') + d('PercentageOfBonusHP') * bhp + d('MonsterHealingAPRatio') * ap);
    case 'nunu_q/low_health_champion_healing': return (1 + d('LowHealthHealingScalar')) * d('ChampionHealingScalar') * (d('BaseHealing') + d('PercentageOfBonusHP') * bhp + d('MonsterHealingAPRatio') * ap);
    case 'nunu_w/maximum_damage': return d('BaseDamage') + d('MaximumAPRatio') * ap;
    case 'nunu_w/minimum_distance_damage': return d('NoImpactDamageScalar') * (d('BaseDamage') + d('MaximumAPRatio') * ap);
    case 'nunu_w/maximum_stun_duration_ms': return (d('BaseKnockupDuration') + d('AdditionalStunDurationOverTime')) * 1000;
    case 'nunu_e/snowball_damage': return d('BaseDamage') + 0.12 * ap;
    case 'nunu_e/root_damage': return d('RootDamage') + 0.8 * ap;
    case 'nunu_r/shield_amount': return d('BaseShieldAmount') + d('ShieldBonusHealthPercent') * bhp + 1.5 * ap;
    case 'nunu_r/maximum_damage': return d('BaseDamage') + 3 * ap;
    case 'sejuani_p/frost_armor_amount': return d('BonusArmorBase') + d('BonusArmorRatio') * testCase.runtime.source_bonus_armor;
    case 'sejuani_p/frost_mr_amount': return d('BonusMRBase') + d('BonusMRRatio') * a.magic_resistance.BONUS;
    case 'sejuani_p/armor_break_damage': return d('PercentHPDamageBase') * testCase.runtime.target_max_health;
    case 'sejuani_q/total_damage': return d('BaseDamage') + d('APRatio') * ap;
    case 'sejuani_w/first_hit_damage': return d('BaseDamageOne') + d('APRatioOne') * ap + d('HPRatioOne') * hp;
    case 'sejuani_w/second_hit_damage': return d('BaseDamageTwo') + d('APRatioTwo') * ap + d('HPRatioTwo') * hp;
    case 'sejuani_e/total_damage': return d('BaseDamage') + d('APRatio') * ap;
    case 'sejuani_r/minor_damage': return d('BaseDamage') + 0.4 * ap;
    case 'sejuani_r/empowered_damage': return d('EmpoweredBaseDamage') + 0.8 * ap;
    case 'sion_q/minimum_damage': return d('LowDamage') + d('ADRatioMin') * ad;
    case 'sion_q/maximum_damage': return d('HighDamage') + d('ADRatioMax') * ad;
    case 'sion_p/death_attack_extra_damage': return d('PercentMaxHP') * testCase.runtime.target_max_health;
    case 'sion_w/total_shield': return d('BaseShield') + d('ShieldAPRatio') * ap + d('ShieldPercentHealthTooltip') * hp;
    case 'sion_w/total_damage': return d('BaseDamage') + d('DamageAPRatio') * ap + d('MaxHPDamageRatio', 0.01) * testCase.runtime.target_max_health;
    case 'sion_e/total_damage': return d('BaseDamage') + d('APRatio') * ap;
    case 'sion_r/minimum_damage': return d('MinDamage') + 0.6 * bad;
    case 'sion_r/maximum_damage': return d('MaxDamage') + 1.2 * bad;
    case 'volibear_p/chain_lightning_damage': return testCase.runtime.chain_lightning_base_damage + d('APRatio') * ap;
    case 'volibear_p/attack_speed_per_stack': return d('PAttackSpeed') + Number(sourceHeroes.get(skillKey)?.calculations?.AttackSpeedCalc?.mFormulaParts?.[1]?.mCoefficient) * ap;
    case 'volibear_p/attack_speed_total': return Math.min(testCase.runtime.attack_speed_stacks, 5) * (d('PAttackSpeed') + Number(sourceHeroes.get(skillKey)?.calculations?.AttackSpeedCalc?.mFormulaParts?.[1]?.mCoefficient) * ap);
    case 'volibear_q/calculated_damage': return d('BaseDamage') + ad + d('BonusADRatio') * bad;
    case 'volibear_w/total_damage': return d('BaseDamage') + 1.1 * ad + d('BonusHealthRatio') * bhp;
    case 'volibear_w/empowered_damage': return (d('W2DamageMultiplier') + d('W2BonusADDamageMultiplier') * bad) * (d('BaseDamage') + 1.1 * ad + d('BonusHealthRatio') * bhp);
    case 'volibear_w/empowered_healing': return d('BaseHeal') + d('HealPercent') * testCase.runtime.source_missing_health;
    case 'volibear_e/total_damage': return d('BaseDamage') + d('APRatio') * ap + d('PercentDamage') * testCase.runtime.target_max_health;
    case 'volibear_e/shield_value': return d('ShieldAmount') * hp + d('ShieldAPRatio') * ap;
    case 'volibear_r/sweet_spot_damage': return d('SweetSpotDamage') + d('APRatio') * ap + 2.5 * bad;
    default: throw Error(`没有独立来源算式 ${key}`);
  }
};
const calcSources = {
  'nunu_q/monster_healing': 'MonsterHealing', 'nunu_q/champion_damage': 'TotalChampionDamage', 'nunu_q/champion_healing': 'ChampionHealing', 'nunu_q/low_health_champion_healing': 'ChampionHealing',
  'nunu_w/maximum_damage': 'MaximumSnowballDamage', 'nunu_w/minimum_distance_damage': 'NoImpactSnowballDamage', 'nunu_w/maximum_stun_duration_ms': 'MaximumStunDuration',
  'nunu_e/snowball_damage': 'TotalSnowballDamage', 'nunu_e/root_damage': 'TotalRootDamage', 'nunu_r/shield_amount': 'TotalShieldAmount', 'nunu_r/maximum_damage': 'MaximumDamage',
  'sejuani_p/frost_armor_amount': 'TotalArmorTooltip', 'sejuani_p/frost_mr_amount': 'TotalMRTooltip', 'sejuani_p/armor_break_damage': 'PercentHPDamage', 'sejuani_q/total_damage': 'TotalDamageTooltip',
  'sejuani_w/first_hit_damage': 'FirstHitDamageTooltip', 'sejuani_w/second_hit_damage': 'SecondHitDamageTooltip', 'sejuani_e/total_damage': 'TotalDamage', 'sejuani_r/minor_damage': 'MinorDamageTooltip', 'sejuani_r/empowered_damage': 'TotalDamageTooltip',
  'sion_q/minimum_damage': 'MinDamageTotal', 'sion_q/maximum_damage': 'MaxDamageTotal', 'sion_w/total_shield': 'TotalShield', 'sion_w/total_damage': 'TotalDamage', 'sion_e/total_damage': 'TotalDamage', 'sion_r/minimum_damage': 'MinDamageTotal', 'sion_r/maximum_damage': 'MaxDamageTotal',
  'volibear_p/chain_lightning_damage': 'ChainLightningDamage', 'volibear_p/attack_speed_per_stack': 'AttackSpeedCalc', 'volibear_p/attack_speed_total': 'AttackSpeedCalc', 'volibear_q/calculated_damage': 'CalculatedDamage', 'volibear_w/total_damage': 'TotalDamage', 'volibear_w/empowered_damage': 'EmpoweredDamage', 'volibear_w/empowered_healing': 'PercentMissingHealthHealingRatio', 'volibear_e/total_damage': 'CalculatedDamage', 'volibear_e/shield_value': 'ShieldValue', 'volibear_r/sweet_spot_damage': 'SweetSpotDamageTooltip',
};
const sourceTreeChecks = () => {
  const checks = [];
  const nunuW = sourceHeroes.get('nunu_w')?.calculations?.NoImpactSnowballDamage; checks.push({ key: 'nunu_w/minimum_distance_damage', ok: nunuW?.mMultiplier?.mDataValue === 'NoImpactDamageScalar', detail: nunuW?.mMultiplier ?? null });
  const nunuR = sourceHeroes.get('nunu_r')?.calculations?.MinDamage; checks.push({ key: 'nunu_r/tooltipOnly_MinDamage', ok: Math.abs(Number(nunuR?.mMultiplier?.mNumber) - 0.5) < 1e-9, detail: nunuR?.mMultiplier ?? null });
  const voliP = sourceHeroes.get('volibear_p')?.calculations?.AttackSpeedCalc; checks.push({ key: 'volibear_p/attack_speed_per_stack', ok: voliP?.mFormulaParts?.[0]?.mDataValue === 'PAttackSpeed' && Math.abs(Number(voliP?.mFormulaParts?.[1]?.mCoefficient) - 0.0003) < 1e-9, detail: voliP?.mFormulaParts ?? null });
  const voliW = sourceHeroes.get('volibear_w')?.calculations?.EmpoweredDamage; const subparts = voliW?.mMultiplier?.mSubparts ?? []; checks.push({ key: 'volibear_w/empowered_damage', ok: voliW?.mModifiedGameCalculation === 'TotalDamage' && subparts.some(item => item.mDataValue === 'W2DamageMultiplier') && subparts.some(item => item.mDataValue === 'W2BonusADDamageMultiplier'), detail: voliW?.mMultiplier ?? null });
  return checks;
};

const math = { mode: afterApply ? '读取实际GET公式详情后核算' : '当前未写入，数学核算延期', formulaCount: 0, groups: 0, casesPerFormula: 2, missingInputChecks: 0, runtimeInputCount: 0, formulas: [], sourceTreeChecks: [], boundaryChecks: [], failedChecks: [], passed: false };
if (afterApply) {
  const formulaRecords = details.filter(item => item.kind === 'formulas');
  const runtimeParameters = details.filter(item => item.kind === 'parameters' && item.data?.valueMode === 'RUNTIME_INPUT');
  math.runtimeInputCount = runtimeParameters.length;
  for (const record of formulaRecords) {
    const key = `${record.skillKey}/${record.id}`; const formula = record.data; const maxLevel = candidate.skills[record.skillKey].maxLevel;
    const a = inputCase('输入组A', 1, { attackDamageTotal: 200, attackDamageBonus: 100, abilityPower: 120, hpTotal: 3000, hpBonus: 1000, armorBonus: 100, mrBonus: 80, targetMaxHealth: 2000, sourceMissingHealth: 500, chainLightningBase: 60, sourceBonusArmor: 100, attackSpeedStacks: 0 });
    const b = inputCase('输入组B', maxLevel, { attackDamageTotal: 350, attackDamageBonus: 220, abilityPower: 260, hpTotal: 5200, hpBonus: 2400, armorBonus: 260, mrBonus: 180, targetMaxHealth: 4200, sourceMissingHealth: 1700, chainLightningBase: 95, sourceBonusArmor: 260, attackSpeedStacks: 5 });
    const parameters = [...parameterKeysIn(formula.expression)]; const runtimeDependencies = parameters.filter(parameterKey => parameterDetails.get(keyOf(record.skillKey, 'parameters', parameterKey))?.valueMode === 'RUNTIME_INPUT');
    const cases = [];
    for (const testCase of [a, b]) {
      try { const actual = evaluate(formula.expression, record.skillKey, testCase); const expected = expectedValue(key, testCase); const ok = closeEnough(actual, expected); if (!ok) math.failedChecks.push({ type: '数值不一致', key, case: testCase.name, actual, expected }); cases.push({ name: testCase.name, level: testCase.level, actual, expected, ok }); }
      catch (error) { math.failedChecks.push({ type: '实际公式求值失败', key, case: testCase.name, error: error.message }); cases.push({ name: testCase.name, level: testCase.level, ok: false, error: error.message }); }
    }
    const missingInputChecks = [];
    for (const parameterKey of runtimeDependencies) { const missingCase = inputCase(`缺少${parameterKey}`, 1, { attackDamageTotal: 200, attackDamageBonus: 100, abilityPower: 120, hpTotal: 3000, hpBonus: 1000, armorBonus: 100, mrBonus: 80, targetMaxHealth: 2000, sourceMissingHealth: 500, chainLightningBase: 60, sourceBonusArmor: 100, attackSpeedStacks: 0 }); delete missingCase.runtime[parameterKey]; let rejected = false; try { evaluate(formula.expression, record.skillKey, missingCase); } catch { rejected = true; } if (!rejected) math.failedChecks.push({ type: '缺失运行输入未拒绝', key, parameterKey }); missingInputChecks.push({ parameterKey, rejected }); }
    math.missingInputChecks += missingInputChecks.length; math.groups += cases.length;
    const sourceCalculation = calcSources[key] ?? null; const sourceCalculationPresent = sourceCalculation === null || Boolean(sourceHeroes.get(record.skillKey)?.calculations?.[sourceCalculation]); if (!sourceCalculationPresent) math.failedChecks.push({ type: '来源计算树缺失', key, sourceCalculation });
    math.formulas.push({ skillKey: record.skillKey, formulaKey: record.id, sourceCalculation, sourceCalculationPresent, runtimeDependencies, cases, missingInputChecks, actualExpression: formula.expression });
  }
  math.formulaCount = formulaRecords.length;
  math.sourceTreeChecks = sourceTreeChecks();
  for (const item of math.sourceTreeChecks) if (!item.ok) math.failedChecks.push({ type: '来源修饰树不符', key: item.key, detail: item.detail });
  const total = details.find(item => item.skillKey === 'volibear_p' && item.kind === 'formulas' && item.id === 'attack_speed_total');
  if (total) {
    for (const item of [{ input: 0, cap: 0 }, { input: 5, cap: 5 }, { input: 7, cap: 5 }]) {
      const testCase = inputCase(`层数${item.input}`, 1, { attackDamageTotal: 200, attackDamageBonus: 100, abilityPower: 120, hpTotal: 3000, hpBonus: 1000, armorBonus: 100, mrBonus: 80, targetMaxHealth: 2000, sourceMissingHealth: 500, chainLightningBase: 60, sourceBonusArmor: 100, attackSpeedStacks: item.input });
      try { const actual = evaluate(total.data.expression, 'volibear_p', testCase); const perStack = parameterValue('volibear_p', 'attack_speed_per_stack_ratio', testCase) + parameterValue('volibear_p', 'attack_speed_ap_ratio', testCase) * 120; const expected = item.cap * perStack; const ok = closeEnough(actual, expected); if (!ok) math.failedChecks.push({ type: '层数边界不符', input: item.input, actual, expected }); math.boundaryChecks.push({ name: `层数${item.input}`, input: item.input, capped: item.cap, actual, expected, ok }); } catch (error) { math.failedChecks.push({ type: '层数边界求值失败', input: item.input, error: error.message }); }
    }
  } else math.failedChecks.push({ type: '缺少实际攻速总量公式' });
  const low = parameterDetails.get(keyOf('nunu_q', 'parameters', 'low_health_champion_multiplier')); const scalar = parameterDetails.get(keyOf('nunu_q', 'parameters', 'low_health_healing_scalar')); const threshold = parameterDetails.get(keyOf('nunu_q', 'parameters', 'low_health_threshold_ratio'));
  const lowValue = low?.fixedValue; const scalarValue = scalar?.fixedValue; const thresholdValue = threshold?.fixedValue; const lowOk = closeEnough(Number(lowValue), 1 + Number(scalarValue)) && closeEnough(Number(thresholdValue), 0.5); if (!lowOk) math.failedChecks.push({ type: '低生命边界不符', lowValue, scalarValue, thresholdValue }); math.boundaryChecks.push({ name: '低于50%时回复倍率', threshold: thresholdValue, lowHealthScalar: scalarValue, multiplier: lowValue, expectedMultiplier: 1 + Number(scalarValue), ok: lowOk });
  math.passed = math.formulaCount === 38 && math.groups === 76 && math.missingInputChecks === 8 && math.failedChecks.length === 0 && math.sourceTreeChecks.every(item => item.ok);
} else {
  math.deferred = { reason: '当前实际GET没有候选公式详情；为避免复用候选表达式，本次不代算。授权写入后使用同一器加--after-apply读取实际公式再核算。', candidateFormulaCount: candidateEntries.filter(item => item.kind === 'formulas').length, actualFormulaCount: details.filter(item => item.kind === 'formulas').length };
}

const supplementalCounts = Object.fromEntries(['characters', 'relations', 'images'].map(category => [category, supplementalProtection.filter(item => item.category === category).length]));
const execution = { at: new Date().toISOString(), runId, mode: afterApply ? '写后独立全量GET与实际公式核算' : '当前独立全量GET', apiBase, candidateSha256: sha256(candidateBytes), candidateVersionSha256: sha256(versionBytes), requestPlanSha256: sha256(planBytes), freezeSha256: sha256(freezeBytes), supplementalProtectionSha256: sha256(supplementalProtectionBytes), sourceVersion: 'client16.17/official16.17.1', apiWrites: 0, businessWrites: 0, staticChecks, staticFailures: staticChecks.filter(item => !item.passed), expected: { catalogs: 4, subjects: 20, supplementalProtection: { requests: 28, characters: 4, relations: 4, images: 20 }, componentLists: 120, frozenDetails: 29, candidateDetails: 286, candidateNewDetails: 257, formulas: 38, groups: 76 }, actual: { calls: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}), lists: lists.length, details: details.length, frozenPresent: details.filter(item => baselineByKey.has(keyOf(item.skillKey, item.kind, item.id))).length, candidatePresent, candidateNewPresent, supplementalProtection: { requests: supplementalProtection.length, ...supplementalCounts, conflicts: supplementalConflicts.length }, protectionConflicts: protectionConflicts.length, catalogReferences: catalogReferences.length, catalogConflicts: catalogConflicts.length, componentConflicts: componentConflicts.length }, protection: { ...protection, roleRelationsImages: supplementalProtection }, lists, details, catalogReferences, protectionConflicts, catalogConflicts, componentConflicts, supplementalConflicts, math, failures, finishedAt: new Date().toISOString() };
if (failures.length === 0 && (!afterApply || math.passed)) execution.status = afterApply ? 'PASS' : 'CURRENT_READBACK'; else execution.status = 'REVISE';
const saveJson = async (name, value) => fsp.writeFile(path.join(runDir, name), jsonBytes(value));
await saveJson('独立保护对象.json', { ...protection, roleRelationsImages: supplementalProtection, roleRelationsImagesBaseline: supplementalBaseline });
await saveJson('独立全量GET.json', { phase: afterApply ? '写后' : '当前', protection, lists, details, counts: execution.actual });
await saveJson('独立实际公式数学核对.json', math);
await saveJson('执行结果.json', execution);
await fsp.writeFile(path.join(runDir, '运行锁.json'), JSON.stringify({ at: execution.at, runId, mode: execution.mode, candidateSha256: execution.candidateSha256, requestPlanSha256: execution.requestPlanSha256, apiWrites: 0, status: execution.status, finishedAt: execution.finishedAt }, null, 2) + '\n');
console.log(JSON.stringify({ status: execution.status, runId, calls: calls.length, methods: execution.actual.methods, statuses: execution.actual.statuses, lists: lists.length, details: details.length, frozenPresent: execution.actual.frozenPresent, candidatePresent, candidateNewPresent, supplementalProtection: execution.actual.supplementalProtection, formulas: math.formulaCount, groups: math.groups, missingInputChecks: math.missingInputChecks, mathPassed: math.passed, protectionConflicts: protectionConflicts.length, supplementalConflicts: supplementalConflicts.length, catalogConflicts: catalogConflicts.length, componentConflicts: componentConflicts.length, failures: failures.length, output: runDir }, null, 2));
if (execution.status === 'REVISE') process.exitCode = 1;
