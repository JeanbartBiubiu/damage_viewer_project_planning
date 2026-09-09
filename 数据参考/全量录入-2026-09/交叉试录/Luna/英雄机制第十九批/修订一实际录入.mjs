import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

// 修订一实际录入器。默认只读预检；只有 --apply、锁文件未漂移、显式确认值和每次写后GET均通过时才允许POST。
// 本器只允许参数、公式、效果三类技能组成；角色主体、技能关系、图片、目录和其余三类组成永不写入。
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
  basedOnCandidateSha256: 'cb3dbab26bc3fc5949d1fbc193ac28da71887f0e743c1ead4885a24fc7739824',
  candidateSha256: 'bb0306ca12eadabdad3d05aacb606b347bd393ffc7aa17205da345e3da08e97c',
  candidatePlanSha256: 'aa89ecca3c72b8d4bb02a1a87180e7ac6050b5cbf267a484808e0353fd783e64',
  candidateVersionFileSha256: '36cafdc0c8fc09f410cdc2c2d835c31d8cf4262df2d01303554a77b7b0a9fc57',
  writePlanFileSha256: 'aa8c3aa9dd8f22b0f0606b92aaf8048e8bc8df9e88ba7590d1671a8295e85ce1',
  mathFileSha256: '63a23e737a1bf08cc127ab7f5a885bdb122d891633156332578dee3f854f7376',
  protectionFileSha256: 'ae5a5428d695ec424ef1fb1c232fa0e8f7893bc30279fa20d5e7af345fa10563',
  protectionSummarySha256: '6cb4ed16037995baea34c535665d68a1b39dc117e681850816e2ae5d5fed967b',
  originalSnapshotSha256: '1954947a6d0afe3d3b41138ad60a11285223814a9ea1843e736518ba74130cd8',
  counts: { parameters: 157, formulas: 26, effects: 8, processes: 0, internalStates: 0, triggerRules: 0 },
  reusedPublicParameters: 16,
  newComponents: 175,
  preflightGetRequests: 188,
};
const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const readBytes = name => fs.readFileSync(path.join(here, name));
const readJson = name => JSON.parse(readBytes(name));
const fileSha = name => sha256(readBytes(name));
const rows = result => Array.isArray(result?.data) ? result.data : Array.isArray(result?.data?.items) ? result.data.items : [];
const apiKind = kind => kinds.find(item => item[0] === kind)?.[2];
const idField = kind => kinds.find(item => item[0] === kind)?.[1];
const identity = (skillKey, kind, id) => `${skillKey}/${kind}/${id}`;
const businessCanonical = value => Array.isArray(value)
  ? value.map(businessCanonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !serverFields.has(key)).sort().map(key => [key, businessCanonical(value[key])]))
    : value;
const exactCanonical = value => Array.isArray(value)
  ? value.map(exactCanonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, exactCanonical(value[key])]))
    : value;
const diff = (expectedValue, actualValue, at = '$') => {
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
};
const businessDiff = (expectedValue, actualValue) => diff(businessCanonical(expectedValue), businessCanonical(actualValue));
const exactDiff = (expectedValue, actualValue) => diff(exactCanonical(expectedValue), exactCanonical(actualValue));
const parameterValue = value => ({ valueType: value?.valueType, valueMode: value?.valueMode, fixedValue: value?.fixedValue, levelValues: value?.levelValues });
const parameterValueDiff = (expectedValue, actualValue) => diff(parameterValue(expectedValue), parameterValue(actualValue));

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw new Error('只接受默认只读预检或 --apply');
const apply = args.includes('--apply');
if (apply && process.env.HERO19_APPLY_CONFIRM !== 'CONFIRM_HERO19_COMPONENT_POSTS') throw new Error('实际POST需要显式设置 HERO19_APPLY_CONFIRM=CONFIRM_HERO19_COMPONENT_POSTS；当前保持只读预检');

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

const staticChecks = [];
const staticFailures = [];
const check = (name, passed, detail = null) => {
  const item = { name, passed: Boolean(passed), detail };
  staticChecks.push(item);
  if (!item.passed) staticFailures.push(item);
  return item.passed;
};

check('锁文件散列冻结', sha256(freezeBytes) === expected.lockSha256, sha256(freezeBytes));
check('cb3原候选仍保留', fileSha('完整候选.json') === expected.basedOnCandidateSha256, fileSha('完整候选.json'));
check('修订一候选文件冻结', sha256(candidateBytes) === expected.candidateSha256, sha256(candidateBytes));
check('修订一版本文件冻结', sha256(versionBytes) === expected.candidateVersionFileSha256 && version.fileSha256 === expected.candidateSha256, sha256(versionBytes));
check('修订一计划文件冻结', sha256(planBytes) === expected.writePlanFileSha256, sha256(planBytes));
check('修订一数学文件冻结', sha256(mathBytes) === expected.mathFileSha256, sha256(mathBytes));
check('修订一保护文件冻结', sha256(protectionBytes) === expected.protectionFileSha256 && sha256(protectionSummaryBytes) === expected.protectionSummarySha256, { protection: sha256(protectionBytes), summary: sha256(protectionSummaryBytes) });
check('原始160GET快照冻结', sha256(originalSnapshotBytes) === expected.originalSnapshotSha256, sha256(originalSnapshotBytes));
check('锁内核心散列一致', freeze.candidateFileSha256 === expected.candidateSha256 && freeze.candidatePlanSha256 === expected.candidatePlanSha256 && freeze.writePlanFileSha256 === expected.writePlanFileSha256 && freeze.independentMathFileSha256 === expected.mathFileSha256 && freeze.protectionFileSha256 === expected.protectionFileSha256, { candidate: freeze.candidateFileSha256, plan: freeze.candidatePlanSha256, writePlan: freeze.writePlanFileSha256, math: freeze.independentMathFileSha256, protection: freeze.protectionFileSha256 });
check('锁内冻结原字节未漂移', Object.entries(freeze.frozenRawBytes ?? {}).every(([name, expectedHash]) => fileSha(path.relative(here, path.join(here, name))) === expectedHash), Object.keys(freeze.frozenRawBytes ?? {}).length);
for (const [name, expectedHash] of Object.entries(freeze.lockedFiles ?? {})) check(`锁定文件未漂移 ${name}`, fileSha(name) === expectedHash, fileSha(name));
check('数学独立核算55项全通过', math.checkCount === 55 && math.failedChecks === 0 && math.runtimeInputCount === 27, { checkCount: math.checkCount, failedChecks: math.failedChecks, runtimeInputCount: math.runtimeInputCount });
check('修订一计划175新增16复用', plan.requestCount === 175 && plan.reusedPublicParameters?.length === 16 && plan.policy?.businessWrites === 0 && plan.policy?.apiCalls === 0, { requestCount: plan.requestCount, reused: plan.reusedPublicParameters?.length, businessWrites: plan.policy?.businessWrites, apiCalls: plan.policy?.apiCalls });
check('保护证据188次GET全200', protectionSummary.requestCount === 188 && protectionSummary.statusCounts?.['200'] === 188 && protectionSummary.errorCount === 0 && protectionSummary.apiWrites === 0, protectionSummary);
check('保护证据16公共详情且无非公共组成', protectionSummary.detailCount === 16 && protectionSummary.existingNonPublicCount === 0, { detailCount: protectionSummary.detailCount, existingNonPublicCount: protectionSummary.existingNonPublicCount });
check('候选20技能槽顺序冻结', isDeepStrictEqual(Object.keys(candidate.skills ?? {}), skills), Object.keys(candidate.skills ?? {}));

const candidateCounts = Object.fromEntries(kinds.map(([kind]) => [kind, skills.reduce((sum, skillKey) => sum + (candidate.skills?.[skillKey]?.write?.[kind]?.length ?? 0), 0)]));
check('候选六类计数冻结', isDeepStrictEqual(candidateCounts, expected.counts), candidateCounts);
check('锁内计数和新增意图冻结', isDeepStrictEqual(freeze.counts, expected.counts) && freeze.totalNewRequests === 175 && freeze.reusedPublicParameters === 16, { counts: freeze.counts, totalNewRequests: freeze.totalNewRequests, reusedPublicParameters: freeze.reusedPublicParameters });

function walk(value, callback, at = '$') {
  if (!value || typeof value !== 'object') return;
  callback(value, at);
  for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') walk(child, callback, `${at}.${key}`);
}
function expressionAttributes(expression, output = []) {
  if (!expression || typeof expression !== 'object') return output;
  if (expression.nodeType === 'ATTRIBUTE') output.push(expression);
  for (const child of expression.operands ?? []) expressionAttributes(child, output);
  return output;
}
function validateSchema() {
  const errors = [];
  const valueTypes = new Set(['INTEGER', 'DECIMAL']);
  const valueModes = new Set(['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT']);
  const nodeTypes = new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']);
  const operations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
  const resultTypes = new Set(['RESOURCE_CHANGE', 'ATTRIBUTE_CHANGE', 'NORMAL_SHIELD']);
  const resourceOperations = new Set(['CONSUME', 'RESTORE']);
  const add = (message, at) => errors.push({ message, at });
  for (const skillKey of skills) {
    const skill = candidate.skills[skillKey];
    const parameterKeys = new Set();
    for (const parameter of skill.write.parameters) {
      if (parameterKeys.has(parameter.parameterKey)) add('参数键重复', `${skillKey}/${parameter.parameterKey}`);
      parameterKeys.add(parameter.parameterKey);
      if (!valueTypes.has(parameter.valueType) || !valueModes.has(parameter.valueMode)) add('未知参数类型或取值模式', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.valueMode === 'FIXED' && (parameter.fixedValue === null || parameter.fixedValue === undefined || parameter.levelValues !== null)) add('固定参数形态错误', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) add('运行输入有默认值', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.valueMode === 'SKILL_LEVEL' && (parameter.fixedValue !== null || !parameter.levelValues || Object.keys(parameter.levelValues).length !== skill.maxLevel)) add('技能等级参数等级表不完整', `${skillKey}/${parameter.parameterKey}`);
      const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : [];
      if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) add('参数值不是有限数字', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.valueType === 'INTEGER' && values.some(value => !Number.isInteger(value))) add('整数参数含小数', `${skillKey}/${parameter.parameterKey}`);
      if (parameter.parameterKey.endsWith('_ms') && values.some(value => Number(value) < 0)) add('毫秒参数为负', `${skillKey}/${parameter.parameterKey}`);
    }
    for (const formula of skill.write.formulas) {
      walk(formula.expression, (node, at) => {
        if (node.nodeType !== undefined && !nodeTypes.has(node.nodeType)) add('未知公式节点类型', `${skillKey}/${formula.formulaKey}${at}`);
        if (node.nodeType === 'PARAMETER' && !parameterKeys.has(node.parameterKey)) add('公式引用未定义参数', `${skillKey}/${formula.formulaKey}${at}`);
        if (node.nodeType === 'OPERATION' && (!operations.has(node.operation) || !Array.isArray(node.operands) || node.operands.length !== 2)) add('公式运算非法', `${skillKey}/${formula.formulaKey}${at}`);
      });
    }
    for (const effect of skill.write.effects) {
      walk(effect, (node, at) => {
        if (node.resultType !== undefined && !resultTypes.has(node.resultType)) add('效果结果类型未知', `${skillKey}/${effect.effectKey}${at}`);
        if ((node.valueMode === 'RUNTIME_INPUT' || node.mode === 'RUNTIME_INPUT')) add('效果间接引用运行输入', `${skillKey}/${effect.effectKey}${at}`);
        if (node.resultType === 'DAMAGE' || node.resultType === 'DIRECT_HEAL') add('效果含即时伤害或直接治疗', `${skillKey}/${effect.effectKey}${at}`);
        if (node.detail?.operation && node.detail?.attributeKey && !resourceOperations.has(node.detail.operation) && node.resultType === 'RESOURCE_CHANGE') add('资源操作未知', `${skillKey}/${effect.effectKey}${at}`);
        if (node.durationValue && (node.durationValue.nodeType !== undefined || !['PARAMETER', 'FIXED', 'FORMULA'].includes(node.durationValue.kind))) add('生命周期时长必须使用kind字段', `${skillKey}/${effect.effectKey}${at}`);
      });
      if (JSON.stringify(effect).includes('MOMENT_EVALUATION')) add('效果含MOMENT_EVALUATION', `${skillKey}/${effect.effectKey}`);
    }
    for (const kind of ['processes', 'internalStates', 'triggerRules']) if (skill.write[kind]?.length) add('禁止写入非本批三类组成', `${skillKey}/${kind}`);
  }
  return errors;
}
const schemaErrors = validateSchema();
check('实际类型和结构字典无未知值', schemaErrors.length === 0, schemaErrors);
const serializedWrites = JSON.stringify(Object.fromEntries(skills.map(skillKey => [skillKey, candidate.skills[skillKey].write])));
for (const forbidden of ['MOMENT_EVALUATION', 'actual_missing_health', 'damage_tick_interval_ms', 'single_target_eligibility_lower_bound', 'armor_shred_percent']) check(`写入树不含${forbidden}`, !serializedWrites.includes(forbidden));
check('写入树不含即时伤害或治疗', !serializedWrites.includes('"resultType":"DAMAGE"') && !serializedWrites.includes('"resultType":"DIRECT_HEAL"'));

const aatroxE = candidate.skills.aatrox_e;
const aatroxRatio = aatroxE.write.parameters.find(item => item.parameterKey === 'bonus_healing_ratio_per_bonus_health');
const aatroxFormula = aatroxE.write.formulas.find(item => item.formulaKey === 'total_healing_ratio');
const aatroxAttrs = expressionAttributes(aatroxFormula?.expression);
check('Aatrox E比例含根0.01换算', aatroxRatio?.valueMode === 'FIXED' && aatroxRatio.fixedValue === 0.00011, { valueMode: aatroxRatio?.valueMode, fixedValue: aatroxRatio?.fixedValue });
check('Aatrox E完整公式使用SOURCE.hp.BONUS', aatroxAttrs.length === 1 && aatroxAttrs[0].attributeOwner === 'SOURCE' && aatroxAttrs[0].attributeKey === 'hp' && aatroxAttrs[0].attributeValueKind === 'BONUS', aatroxAttrs);
const actualDamage = candidate.skills.aatrox_p.write.parameters.find(item => item.parameterKey === 'passive_actual_damage');
check('Aatrox P实际命中伤害拒绝默认', actualDamage?.valueMode === 'RUNTIME_INPUT' && actualDamage.fixedValue === null && actualDamage.levelValues === null, actualDamage);
const rengarArmor = candidate.skills.rengar_r.write.parameters.find(item => item.parameterKey === 'armor_shred_points');
check('Rengar R护甲削减固定点数', rengarArmor?.valueMode === 'SKILL_LEVEL' && isDeepStrictEqual(rengarArmor.levelValues, { '1': 15, '2': 20, '3': 25 }) && !candidate.skills.rengar_r.write.parameters.some(item => item.parameterKey === 'armor_shred_percent'), rengarArmor);
check('Rengar纯视野字段未写入', !candidate.skills.rengar_e.write.parameters.some(item => item.parameterKey === 'reveal_duration_ms') && !candidate.skills.rengar_r.write.parameters.some(item => item.parameterKey === 'self_vision_range'), null);
const attackMappingChecks = [
  ['riven_w', 'total_damage', 'BONUS'], ['riven_e', 'total_shield', 'BONUS'], ['riven_r', 'wind_slash_min_damage', 'BONUS'], ['riven_r', 'wind_slash_max_damage', 'BONUS'],
  ['rengar_e', 'total_damage', 'BONUS'], ['rengar_e', 'total_empowered_damage', 'BONUS'], ['khazix_p', 'passive_damage', 'BONUS'], ['khazix_q', 'base_damage', 'BONUS'], ['khazix_w', 'base_damage', 'BONUS'], ['khazix_e', 'total_damage', 'BONUS'],
  ['riven_q', 'first_slash_damage', 'TOTAL'], ['riven_r', 'bonus_attack_damage', 'TOTAL'], ['aatrox_q', 'q_damage', 'TOTAL'], ['aatrox_w', 'w_damage', 'TOTAL'], ['rengar_q', 'q_total_damage', 'TOTAL'], ['rengar_q', 'empowered_q_total_damage', 'TOTAL'],
];
for (const [skillKey, formulaKey, kind] of attackMappingChecks) {
  const formula = candidate.skills[skillKey].write.formulas.find(item => item.formulaKey === formulaKey);
  const attrs = expressionAttributes(formula?.expression).filter(item => item.attributeKey === 'attack_damage');
  check(`攻击力属性映射 ${skillKey}/${formulaKey}`, attrs.length > 0 && attrs.every(item => item.attributeOwner === 'SOURCE' && item.attributeValueKind === kind), attrs.map(item => item.attributeValueKind));
}

const expectedEntries = [];
for (const skillKey of skills) for (const [kind, field, endpoint] of kinds) for (const body of candidate.skills[skillKey].write[kind] ?? []) expectedEntries.push({ skillKey, kind, field, id: body[field], body, route: `/skills/${skillKey}/${endpoint}`, detailRoute: `/skills/${skillKey}/${endpoint}/${encodeURIComponent(body[field])}` });
const entryMap = new Map(expectedEntries.map(entry => [identity(entry.skillKey, entry.kind, entry.id), entry]));
check('候选组成键唯一', entryMap.size === expectedEntries.length, { entries: expectedEntries.length, unique: entryMap.size });
check('写前计划175项全为允许POST', plan.requests?.length === 175 && plan.requests.every(request => request.method === 'POST' && ['parameters', 'formulas', 'effects'].includes(request.kind)), { requests: plan.requests?.length, methods: [...new Set((plan.requests ?? []).map(request => request.method))], kinds: [...new Set((plan.requests ?? []).map(request => request.kind))] });
for (const request of plan.requests ?? []) {
  const entry = entryMap.get(identity(request.skillKey, request.kind, request.stableKey));
  check(`计划对象冻结 ${identity(request.skillKey, request.kind, request.stableKey)}`, Boolean(entry) && request.route === entry.route && request.detailRoute === entry.detailRoute && isDeepStrictEqual(request.body, entry.body), null);
}
const reuseKeys = new Set((plan.reusedPublicParameters ?? []).map(item => identity(item.skillKey, 'parameters', item.parameterKey)));
check('计划复用公共参数16项唯一', reuseKeys.size === 16 && reuseKeys.size === (plan.reusedPublicParameters ?? []).length, [...reuseKeys]);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(here, '修订一执行记录', runId);
await fsp.mkdir(runDir, { recursive: true });
const journalPath = path.join(runDir, 'HTTP流水.jsonl');
const writeJournalPath = path.join(runDir, '写入流水.jsonl');
const calls = [];
const writeEvents = [];
const failures = [];
const appendJsonl = async (file, value) => {
  const handle = await fsp.open(file, 'a');
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
};
const saveJson = async (name, value) => fsp.writeFile(path.join(runDir, name), JSON.stringify(value, null, 2) + '\n');
const httpRequest = async (route, options = {}) => {
  const method = options.method ?? 'GET';
  if (!route.startsWith('/') || route.includes('://') || route.includes('..')) throw new Error(`非法接口路径 ${route}`);
  if (!['GET', 'POST'].includes(method)) throw new Error(`禁止HTTP方法 ${method}`);
  if (method === 'POST' && !apply) throw new Error('只读预检禁止POST');
  const sequence = calls.length + 1;
  const startedAt = new Date().toISOString();
  await appendJsonl(journalPath, { sequence, phase: '请求前', at: startedAt, method, route, ...(method === 'POST' ? { body: options.body } : {}) });
  const started = Date.now();
  let result;
  try {
    const response = await fetch(apiBase + route, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    const raw = await response.text();
    let data = null;
    let parseError = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (error) { parseError = `${error.name}: ${error.message}`; }
    result = { sequence, at: startedAt, method, route, status: response.status, ok: response.ok && !parseError, elapsedMs: Date.now() - started, data, ...(parseError ? { parseError, rawBytes: Buffer.byteLength(raw), rawSha256: sha256(raw) } : {}) };
  } catch (error) {
    result = { sequence, at: startedAt, method, route, status: null, ok: false, elapsedMs: Date.now() - started, data: null, error: `${error.name}: ${error.message}` };
  }
  calls.push(result);
  await appendJsonl(journalPath, { ...result, phase: '请求后' });
  return result;
};
const mustGet = async route => {
  const result = await httpRequest(route);
  if (!result.ok) throw new Error(`GET失败，立即停止：${route} status=${result.status ?? 'network'}`);
  return result;
};
const optionalGet = async route => {
  const result = await httpRequest(route);
  if (!result.ok && result.status !== 404) throw new Error(`缺项探测GET失败，立即停止：${route} status=${result.status ?? 'network'}`);
  return result;
};

async function fetchCurrentProtection() {
  const state = { catalogs: {}, characters: {}, relations: {}, images: {}, skills: {} };
  for (const [name] of catalogs) state.catalogs[name] = await mustGet(`/${name}`);
  for (const hero of heroes) {
    state.characters[hero] = await mustGet(`/characters/champion_${hero}`);
    state.relations[hero] = await mustGet(`/character-skill-relations?characterKey=champion_${hero}`);
  }
  for (const skillKey of skills) {
    state.skills[skillKey] = { subject: await mustGet(`/skills/${skillKey}`), components: {} };
    state.images[skillKey] = await mustGet(`/skills/${skillKey}/representative-image`);
    for (const [kind, field, endpoint] of kinds) {
      const list = await mustGet(`/skills/${skillKey}/${endpoint}`);
      const items = rows(list);
      const details = [];
      const seen = new Set();
      for (const item of items) {
        const id = item?.[field];
        if (typeof id !== 'string' || seen.has(id)) throw new Error(`列表键重复或无效，立即停止：${skillKey}/${kind}/${id}`);
        seen.add(id);
      }
      for (const item of items) {
        const id = item[field];
        const detail = await mustGet(`/skills/${skillKey}/${endpoint}/${encodeURIComponent(id)}`);
        details.push({ id, item, detail });
      }
      state.skills[skillKey].components[kind] = { list, items, details };
    }
  }
  return state;
}

function compareProtection(expectedState, actualState) {
  const conflicts = [];
  for (const [name] of catalogs) {
    const item = exactDiff(expectedState.catalogs?.[name]?.data, actualState.catalogs?.[name]?.data);
    if (item) conflicts.push({ type: 'catalog', name, diff: item });
  }
  for (const hero of heroes) {
    for (const [type, map] of [['character', expectedState.characters], ['relation', expectedState.relations]]) {
      const item = exactDiff(map?.[hero]?.data, actualState[type === 'character' ? 'characters' : 'relations']?.[hero]?.data);
      if (item) conflicts.push({ type, hero, diff: item });
    }
  }
  for (const skillKey of skills) {
    const subject = exactDiff(expectedState.skills?.[skillKey]?.subject?.data, actualState.skills?.[skillKey]?.subject?.data);
    const image = exactDiff(expectedState.images?.[skillKey]?.data, actualState.images?.[skillKey]?.data);
    if (subject) conflicts.push({ type: 'subject', skillKey, diff: subject });
    if (image) conflicts.push({ type: 'image', skillKey, diff: image });
    for (const [kind] of kinds) {
      const oldItems = expectedState.skills?.[skillKey]?.components?.[kind]?.items ?? [];
      const newItems = actualState.skills?.[skillKey]?.components?.[kind]?.items ?? [];
      const listDiff = exactDiff(oldItems, newItems);
      if (listDiff) conflicts.push({ type: 'list', skillKey, kind, diff: listDiff });
      const oldDetails = new Map((expectedState.skills?.[skillKey]?.components?.[kind]?.details ?? []).map(item => [item.id, item.detail?.data]));
      const newDetails = new Map((actualState.skills?.[skillKey]?.components?.[kind]?.details ?? []).map(item => [item.id, item.detail?.data]));
      for (const [id, data] of oldDetails) {
        const detailDiff = exactDiff(data, newDetails.get(id));
        if (detailDiff) conflicts.push({ type: 'detail', skillKey, kind, id, diff: detailDiff });
      }
    }
  }
  return conflicts;
}

function flattenDetails(state) {
  const map = new Map();
  for (const skillKey of skills) for (const [kind] of kinds) for (const detail of state.skills?.[skillKey]?.components?.[kind]?.details ?? []) map.set(identity(skillKey, kind, detail.id), detail.detail?.data);
  return map;
}
function currentCounts(state) {
  const counts = Object.fromEntries(kinds.map(([kind]) => [kind, 0]));
  let details = 0;
  for (const skillKey of skills) for (const [kind] of kinds) { counts[kind] += state.skills?.[skillKey]?.components?.[kind]?.items?.length ?? 0; details += state.skills?.[skillKey]?.components?.[kind]?.details?.length ?? 0; }
  return { counts, details };
}
function validateFreshState(state) {
  const count = currentCounts(state);
  const conflicts = compareProtection(protection, state);
  const existingNonPublic = Object.entries(count.counts).filter(([kind]) => kind !== 'parameters').reduce((sum, [, value]) => sum + value, 0);
  const currentDetails = flattenDetails(state);
  const missing = (plan.requests ?? []).filter(request => !currentDetails.has(identity(request.skillKey, request.kind, request.stableKey)));
  for (const reuse of plan.reusedPublicParameters ?? []) {
    const key = identity(reuse.skillKey, 'parameters', reuse.parameterKey);
    const expectedBody = entryMap.get(key)?.body;
    const actual = currentDetails.get(key);
    if (!actual || parameterValueDiff(expectedBody, actual)) conflicts.push({ type: 'reuse', key, diff: parameterValueDiff(expectedBody, actual) });
  }
  return { count, conflicts, missing, existingNonPublic, currentDetails };
}

const persistentWriteLock = path.join(here, '修订一执行准备', '实际录入写入锁.json');
async function acquirePersistentWriteLock() {
  await fsp.mkdir(path.dirname(persistentWriteLock), { recursive: true });
  let handle;
  try { handle = await fsp.open(persistentWriteLock, 'wx'); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('已有修订一实际写入锁，禁止并行或重放');
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ at: new Date().toISOString(), runId, candidateSha256: expected.candidateSha256, planSha256: expected.writePlanFileSha256, expectedPostCount: expected.newComponents, policy: '只允许修订一冻结计划中的参数、公式、效果POST；其他对象永不POST。' }, null, 2) + '\n');
    await handle.sync();
  } finally { await handle.close(); }
}
async function createIntent(entry) {
  const intentDir = path.join(here, '修订一写前意图');
  await fsp.mkdir(intentDir, { recursive: true });
  const name = `${sha256(`${expected.candidateSha256}\n${entry.detailRoute}\n${entry.id}`)}.json`;
  const target = path.join(intentDir, name);
  try {
    const handle = await fsp.open(target, 'wx');
    try { await handle.writeFile(JSON.stringify({ at: new Date().toISOString(), candidateSha256: expected.candidateSha256, method: 'POST', route: entry.route, detailRoute: entry.detailRoute, skillKey: entry.skillKey, kind: entry.kind, id: entry.id, body: entry.body }, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    return { target, existed: false };
  } catch (error) {
    if (error.code === 'EEXIST') return { target, existed: true };
    throw error;
  }
}
const emitWrite = async value => {
  const event = { at: new Date().toISOString(), ...value };
  writeEvents.push(event);
  await appendJsonl(writeJournalPath, event);
  return event;
};

const report = {
  at: new Date().toISOString(),
  runId,
  mode: apply ? '冻结计划补缺；本次仅在每项写后GET确认后继续' : '只读预检',
  apiBase,
  candidateFile,
  candidateSha256: expected.candidateSha256,
  candidatePlanSha256: expected.candidatePlanSha256,
  candidateVersionFileSha256: expected.candidateVersionFileSha256,
  writePlanFileSha256: expected.writePlanFileSha256,
  freezeSha256: expected.lockSha256,
  expected: { catalogs: 4, subjects: 20, characters: 4, relations: 4, images: 20, lists: 120, protectedDetails: 16, candidateComponents: 191, newComponents: 175, preflightGetRequests: 188 },
  candidateCounts,
  reusedPublicParameters: expected.reusedPublicParameters,
  apiWrites: 0,
  calls: null,
  staticChecks,
  staticFailures,
  preflight: null,
  apply: null,
  errors: [],
  success: false,
};
const saveReport = async () => {
  report.calls = { total: calls.length, methods: calls.reduce((out, item) => { out[item.method] = (out[item.method] ?? 0) + 1; return out; }, {}), statuses: calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {}) };
  report.apiWrites = calls.filter(item => item.method === 'POST').length;
  report.writeEvents = writeEvents.length;
  await saveJson('执行结果.json', report);
};

await fsp.writeFile(path.join(runDir, '运行锁.json'), JSON.stringify({ at: new Date().toISOString(), runId, mode: apply ? 'apply' : 'preflight', candidateSha256: expected.candidateSha256, planSha256: expected.writePlanFileSha256, expectedApiWrites: apply ? expected.newComponents : 0 }, null, 2) + '\n', { flag: 'wx' });
await appendJsonl(journalPath, { sequence: 0, phase: '运行开始', at: new Date().toISOString(), method: 'NONE', route: null, mode: apply ? 'apply' : 'preflight' });

try {
  if (staticFailures.length) throw new Error(`静态冻结校验失败${staticFailures.length}项`);
  const current = await fetchCurrentProtection();
  await saveJson('写前保护.json', current);
  const stateCheck = validateFreshState(current);
  const statusCounts = calls.reduce((out, item) => { out[String(item.status)] = (out[String(item.status)] ?? 0) + 1; return out; }, {});
  report.preflight = {
    pass: calls.length === expected.preflightGetRequests && calls.every(item => item.method === 'GET' && item.status === 200) && stateCheck.conflicts.length === 0 && stateCheck.existingNonPublic === 0 && stateCheck.missing.length === expected.newComponents,
    getRequests: calls.length,
    expectedGetRequests: expected.preflightGetRequests,
    statusCounts,
    protectionConflicts: stateCheck.conflicts,
    existingNonPublic: stateCheck.existingNonPublic,
    current: stateCheck.count,
    missing: stateCheck.missing.length,
    missingByKind: Object.fromEntries(kinds.map(([kind]) => [kind, stateCheck.missing.filter(item => item.kind === kind).length])),
    apiWrites: calls.filter(item => item.method !== 'GET').length,
  };
  await saveReport();
  if (!report.preflight.pass) throw new Error(`写前保护或精确组成预检失败：${JSON.stringify({ conflicts: stateCheck.conflicts.length, existingNonPublic: stateCheck.existingNonPublic, missing: stateCheck.missing.length, calls: calls.length })}`);
  if (!apply) {
    report.success = true;
    report.nextStep = '如获主负责人单次授权，再设置HERO19_APPLY_CONFIRM并运行--apply；当前未POST。独立全量回读另行运行修订一独立全量回读.mjs。';
  } else {
    await acquirePersistentWriteLock();
    await emitWrite({ phase: '写入锁已取得', expectedPostCount: stateCheck.missing.length });
    const applyResult = { startedAt: new Date().toISOString(), confirmed: 0, postCount: 0, skippedExisting: 0, stopped: false, stopReason: null };
    for (const entry of plan.requests) {
      const before = await optionalGet(entry.detailRoute);
      if (before.status === 200) {
        const existingDiff = businessDiff(entry.body, before.data);
        if (existingDiff) throw new Error(`写前已存在但值不一致：${identity(entry.skillKey, entry.kind, entry.stableKey)}`);
        applyResult.confirmed++;
        applyResult.skippedExisting++;
        await emitWrite({ action: '已有同值，跳过POST', skillKey: entry.skillKey, kind: entry.kind, id: entry.stableKey, beforeStatus: before.status });
        continue;
      }
      const intent = await createIntent({ ...entry, id: entry.stableKey });
      if (intent.existed) {
        applyResult.stopped = true;
        applyResult.stopReason = { phase: '防重放意图已存在', identity: identity(entry.skillKey, entry.kind, entry.stableKey), intentFile: intent.target };
        await emitWrite({ action: '已有写前意图且仍缺失，停止全部写入', ...applyResult.stopReason });
        break;
      }
      await emitWrite({ action: '准备创建', skillKey: entry.skillKey, kind: entry.kind, id: entry.stableKey, route: entry.route, body: entry.body, intentFile: intent.target });
      const post = await httpRequest(entry.route, { method: 'POST', body: entry.body });
      if (!post.ok) {
        applyResult.stopped = true;
        applyResult.stopReason = { phase: 'POST返回失败', identity: identity(entry.skillKey, entry.kind, entry.stableKey), status: post.status, error: post.error ?? post.parseError };
        await emitWrite({ action: 'POST失败，停止全部写入', ...applyResult.stopReason });
        break;
      }
      const after = await mustGet(entry.detailRoute);
      const afterDiff = businessDiff(entry.body, after.data);
      applyResult.postCount++;
      if (afterDiff) {
        applyResult.stopped = true;
        applyResult.stopReason = { phase: '写后完整GET不一致', identity: identity(entry.skillKey, entry.kind, entry.stableKey), diff: afterDiff };
        await emitWrite({ action: '写后回读异常，停止全部写入', ...applyResult.stopReason, postStatus: post.status, readbackStatus: after.status, actual: after.data });
        break;
      }
      applyResult.confirmed++;
      await emitWrite({ action: '创建后独立回读确认', skillKey: entry.skillKey, kind: entry.kind, id: entry.stableKey, postStatus: post.status, readbackStatus: after.status });
    }
    applyResult.finishedAt = new Date().toISOString();
    report.apply = applyResult;
    await saveJson('实际写入结果.json', applyResult);
    if (applyResult.stopped || applyResult.confirmed !== plan.requests.length) throw new Error(`实际补缺未全部确认：${JSON.stringify({ confirmed: applyResult.confirmed, expected: plan.requests.length, postCount: applyResult.postCount, stopped: applyResult.stopped })}`);
    report.success = true;
    report.nextStep = '写入器已完成逐项写后GET；必须另行运行修订一独立全量回读.mjs进行全量363次GET和独立数学核算。';
  }
} catch (error) {
  report.errors.push({ name: error.name, message: error.message });
} finally {
  report.finishedAt = new Date().toISOString();
  await saveReport();
}

console.log(JSON.stringify({
  success: report.success,
  mode: report.mode,
  runId,
  apiWrites: report.apiWrites,
  calls: report.calls,
  preflight: report.preflight ? { pass: report.preflight.pass, getRequests: report.preflight.getRequests, missing: report.preflight.missing, existingNonPublic: report.preflight.existingNonPublic, protectionConflicts: report.preflight.protectionConflicts.length } : null,
  apply: report.apply ? { confirmed: report.apply.confirmed, postCount: report.apply.postCount, skippedExisting: report.apply.skippedExisting, stopped: report.apply.stopped } : null,
  errors: report.errors,
  output: runDir,
}, null, 2));
if (!report.success) process.exitCode = 1;
