import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { fileURLToPath } from 'node:url';

// 第二十六批修订一受保护写入器。默认只读预检；只有 --apply 和显式环境确认同时满足时才允许78条新增POST。
// 主体、目录、角色、关系、图片和六类已有组成只保护，不更新、不删除、不重放。
const here = path.dirname(fileURLToPath(import.meta.url));
const apiBase = 'http://127.0.0.1:8080/api/admin/games/lol';
const inputDir = path.join(here, '输入包');
const candidateFile = path.join(here, '完整候选.json');
const planFile = path.join(here, '写前请求计划.json');
const sourceValuesFile = path.join(here, '源值解析.json');
const sourceManifestFile = path.join(here, '来源哈希汇总.json');
const strictMathFile = path.join(here, '严格数学.json');
const freezeFile = path.join(here, '冻结候选锁.json');
const inputVersionFile = path.join(inputDir, '输入版本.json');
const bindingFile = path.join(inputDir, '来源绑定与当前文本.json');
const snapshotFile = path.join(inputDir, '参考资料', '当前10槽保护快照.json');
const reuseFile = path.join(inputDir, '参考资料', '公共参数复用清单.json');
const lockFile = path.join(here, '实际录入锁.json');

const frozen = Object.freeze({
  candidateSha256: 'eaa8be12ac98bde580ed79d3dcf3001c7e99c002b2d0844fe2fb6ad16fa72230',
  planSha256: '36ab18f7ce88561d0db035c6e20b5b30d7e364f4fa7585814266c561e386a3ba',
  sourceValuesSha256: '0c3ac5c7057860c5135c1b3825094c16e9acefa75675ed73df910082c680a9bd',
  sourceManifestSha256: 'b4296bf9678e4057fff6ea5469bfda62d4e95538a84bbcac40f52605828785e5',
  strictMathSha256: '86f0d92cac6aaab12b45977a2382ae9042ae91f8c11bd42a2a6e99e7db61e4c6',
  freezeSha256: 'd553d208c25e63a0a50cab5ce659f414b91557434035615a5320314a6ef4efc4',
  inputVersionSha256: 'cc8492f70028c0d53133d870560b250b0a281b8eccf68eafbd5b05a336c79c0e',
  bindingSha256: 'ff84880596ebc5c44a1a881e7bfa8659572b1ab72c7d9741ae8842b3d81b3349',
  snapshotSha256: 'bd549959bc5c976dfc4f2209df6c2edee7c98fc0643a7cc192356f2e72e51d19',
  reuseSha256: '634c0691885e306d831dcdc7b6e239315601e4963fd0aebda45f07a205343fd7',
  newComponents: 78,
  reusedParameters: 13,
  baselineGets: 101,
});

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply')) throw new Error('只接受默认只读预检或 --apply');
const apply = args.includes('--apply');
if (apply && process.env.HERO26_APPLY_CONFIRM !== 'CONFIRM_HERO26_COMPONENT_POSTS') throw new Error('实际POST需要显式设置 HERO26_APPLY_CONFIRM=CONFIRM_HERO26_COMPONENT_POSTS');

const readBytes = file => fs.readFileSync(file);
const readJson = file => JSON.parse(readBytes(file));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sha256File = file => sha256(readBytes(file));
const writeJson = (file, value, flag = undefined) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, flag ? { flag } : undefined);
};
const stripServer = value => Array.isArray(value)
  ? value.map(stripServer)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !['gameId', 'skillKey', 'createdAt', 'updatedAt'].includes(key)).sort().map(key => [key, stripServer(value[key])]))
    : value;
const exact = value => Array.isArray(value)
  ? value.map(exact)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, exact(value[key])]))
    : value;
const diff = (expected, actual, at = '$') => {
  if (equal(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') return { path: at, expected, actual };
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return { path: at, expected, actual };
    for (let index = 0; index < expected.length; index += 1) {
      const child = diff(expected[index], actual[index], `${at}[${index}]`);
      if (child) return child;
    }
    return null;
  }
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    if (!(key in expected) || !(key in actual)) return { path: `${at}.${key}`, expectedPresent: key in expected, actualPresent: key in actual };
    const child = diff(expected[key], actual[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
};
const protectedDiff = (left, right) => diff(stripServer(left), stripServer(right));
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : null;
const keyOf = (skillKey, kind, stableKey) => `${skillKey}|${kind}|${stableKey}`;
const apiKind = kind => ({ parameters: 'parameters', formulas: 'formulas', effects: 'effects' })[kind] ?? kind;
const idField = kind => ({ parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey' })[kind] ?? ({ processes: 'processKey', internalStates: 'stateKey', triggerRules: 'ruleKey' })[kind];
const kinds = ['parameters', 'formulas', 'effects'];
const allKinds = ['parameters', 'formulas', 'effects', 'processes', 'internalStates', 'triggerRules'];
const catalogRoutes = new Map([
  ['/attributes', 'attributeKey'],
  ['/skill-categories', 'skillCategoryKey'],
  ['/modifier-zones', 'modifierZoneKey'],
  ['/damage-types', 'damageTypeKey'],
]);
const skills = ['alistar_p', 'alistar_q', 'alistar_w', 'alistar_e', 'alistar_r', 'blitzcrank_p', 'blitzcrank_q', 'blitzcrank_w', 'blitzcrank_e', 'blitzcrank_r'];
const candidate = readJson(candidateFile);
const plan = readJson(planFile);
const sourceValues = readJson(sourceValuesFile);
const sourceManifest = readJson(sourceManifestFile);
const freeze = readJson(freezeFile);
const inputVersion = readJson(inputVersionFile);
const binding = readJson(bindingFile);
const baseline = readJson(snapshotFile);
const reuseList = readJson(reuseFile);

const staticChecks = [];
const staticFailures = [];
const staticCheck = (name, passed, detail = null) => {
  const row = { name, passed: Boolean(passed), detail };
  staticChecks.push(row);
  if (!row.passed) staticFailures.push(row);
  return row.passed;
};

for (const [label, file, expected] of [
  ['candidate', candidateFile, frozen.candidateSha256],
  ['plan', planFile, frozen.planSha256],
  ['sourceValues', sourceValuesFile, frozen.sourceValuesSha256],
  ['sourceManifest', sourceManifestFile, frozen.sourceManifestSha256],
  ['strictMath', strictMathFile, frozen.strictMathSha256],
  ['freeze', freezeFile, frozen.freezeSha256],
  ['inputVersion', inputVersionFile, frozen.inputVersionSha256],
  ['binding', bindingFile, frozen.bindingSha256],
  ['snapshot', snapshotFile, frozen.snapshotSha256],
  ['reuse', reuseFile, frozen.reuseSha256],
]) staticCheck(`冻结文件散列 ${label}`, sha256File(file) === expected, { actual: sha256File(file), expected });

staticCheck('候选修订版本正确', candidate.revision === 'hero26-source-v1-candidate-revision-1', candidate.revision);
staticCheck('候选零业务写入', candidate.meta?.apiCalls === 0 && candidate.meta?.businessWrites === 0 && candidate.apiWrites === 0 && sourceValues.noWrites === true, { meta: candidate.meta, apiWrites: candidate.apiWrites, sourceNoWrites: sourceValues.noWrites });
staticCheck('候选计数为57参数10公式11效果', equal(candidate.counts, { parameters: 57, formulas: 10, effects: 11, processes: 0, internalStates: 0, triggerRules: 0 }), candidate.counts);
staticCheck('请求计划为78项', plan.requestCount === frozen.newComponents && plan.requests?.length === frozen.newComponents, { requestCount: plan.requestCount, length: plan.requests?.length });
staticCheck('输入包来源清单一致', sourceManifest.sourceManifestSha256 === null && sourceManifest.files?.length === 14, { files: sourceManifest.files?.length, sourceManifestSha256: sourceManifest.sourceManifestSha256 });
staticCheck('候选技能顺序与十槽范围一致', equal(candidate.order, skills), candidate.order);
staticCheck('候选主体和六类保护与冻结快照一致', skills.every(skillKey => equal(candidate.skills?.[skillKey]?.protectedExisting?.subject, baseline.summary?.[skillKey]?.subject) && equal(candidate.skills?.[skillKey]?.protectedExisting?.components, baseline.summary?.[skillKey]?.components)), null);
staticCheck('候选引用当前保护快照哈希', candidate.meta?.currentSnapshotSha256 === frozen.snapshotSha256, candidate.meta?.currentSnapshotSha256);

const reusedKeys = new Set(reuseList.map(item => keyOf(item.skillKey, 'parameters', item.parameterKey)));
const candidateEntries = [];
for (const skillKey of skills) {
  const skill = candidate.skills?.[skillKey];
  staticCheck(`候选技能存在 ${skillKey}`, Boolean(skill) && skill.skillKey === skillKey, skill?.skillKey);
  for (const kind of allKinds) {
    const values = skill?.write?.[kind] ?? [];
    staticCheck(`组成列表存在 ${skillKey}/${kind}`, Array.isArray(values), null);
    if (!kinds.includes(kind) && values.length) staticFailures.push({ name: `禁止新增 ${skillKey}/${kind}`, passed: false, detail: values.length });
    if (kinds.includes(kind)) for (const body of values) {
      const stableKey = body[idField(kind)];
      candidateEntries.push({ skillKey, kind, stableKey, id: idField(kind), api: apiKind(kind), baseRoute: `/skills/${skillKey}/${apiKind(kind)}`, detailRoute: `/skills/${skillKey}/${apiKind(kind)}/${encodeURIComponent(stableKey)}`, body });
    }
  }
}
const candidateByKey = new Map(candidateEntries.map(entry => [keyOf(entry.skillKey, entry.kind, entry.stableKey), entry]));
staticCheck('候选组成总数为78', candidateEntries.length === frozen.newComponents, candidateEntries.length);
staticCheck('候选组成键唯一', candidateByKey.size === candidateEntries.length, candidateEntries.length - candidateByKey.size);
staticCheck('复用参数均禁止提交', (candidate.reusedPublicParameters ?? []).length === frozen.reusedParameters && candidate.reusedPublicParameters.every(item => item.post === false) && plan.reusedPublicParameters.every(item => item.post === false), candidate.reusedPublicParameters);
staticCheck('候选没有复用键冲突', [...candidateByKey.keys()].every(key => !reusedKeys.has(key)), [...candidateByKey.keys()].filter(key => reusedKeys.has(key)));

const planByKey = new Map();
for (const intent of plan.requests ?? []) {
  const kind = intent.kind;
  const key = keyOf(intent.skillKey, kind, intent.stableKey);
  const entry = candidateByKey.get(key);
  if (!entry || intent.method !== 'POST' || intent.route !== entry.baseRoute || !equal(intent.body, entry.body) || planByKey.has(key)) staticFailures.push({ name: `写前计划覆盖候选 ${key}`, passed: false, detail: { entry, intent } });
  planByKey.set(key, intent);
}
staticCheck('写前计划逐项覆盖候选', planByKey.size === candidateEntries.length && candidateEntries.every(entry => planByKey.has(keyOf(entry.skillKey, entry.kind, entry.stableKey))), { planned: planByKey.size, candidates: candidateEntries.length });
staticCheck('请求计划按组成计数', equal(plan.requestCounts, { parameters: 57, formulas: 10, effects: 11, processes: 0, internalStates: 0, triggerRules: 0 }), plan.requestCounts);

const baselineByRoute = new Map();
for (const request of baseline.requests ?? []) {
  if (baselineByRoute.has(request.route)) staticFailures.push({ name: `保护路由重复 ${request.route}`, passed: false });
  baselineByRoute.set(request.route, request);
}
staticCheck('保护快照为101次GET', baseline.requests?.length === frozen.baselineGets && baselineByRoute.size === frozen.baselineGets && baseline.apiWrites === 0, { declared: baseline.GETs, requests: baseline.requests?.length, unique: baselineByRoute.size, apiWrites: baseline.apiWrites });
const protectedSummaryCounts = { catalogs: 0, characters: 0, relations: 0, subjects: 0, images: 0, lists: 0, reusedDetails: 0 };
const collectionRoute = route => /^\/skills\/[^/]+\/(parameters|formulas|effects|processes|internal-states|trigger-rules)$/.test(route);
const subjectRoute = route => /^\/skills\/[^/]+$/.test(route);
for (const request of baseline.requests ?? []) {
  const route = request.route;
  if (catalogRoutes.has(route)) protectedSummaryCounts.catalogs += 1;
  else if (route.startsWith('/characters/')) protectedSummaryCounts.characters += 1;
  else if (route.startsWith('/character-skill-relations?')) protectedSummaryCounts.relations += 1;
  else if (route.includes('/representative-image')) protectedSummaryCounts.images += 1;
  else if (subjectRoute(route)) protectedSummaryCounts.subjects += 1;
  else if (collectionRoute(route)) protectedSummaryCounts.lists += 1;
  else if (/^\/skills\/[^/]+\/parameters\/[^/]+$/.test(route)) protectedSummaryCounts.reusedDetails += 1;
}
staticCheck('保护快照覆盖4目录2角色2关系10主体10图片60列表13详情', equal(protectedSummaryCounts, { catalogs: 4, characters: 2, relations: 2, subjects: 10, images: 10, lists: 60, reusedDetails: 13 }), protectedSummaryCounts);

const catalogSets = {};
for (const [route, key] of catalogRoutes) catalogSets[key] = new Map((rows(baselineByRoute.get(route)?.data) ?? []).map(item => [item[key], item]));
const catalogReferences = [];
const catalogFailures = [];
function scanCatalogReferences(value, at = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => scanCatalogReferences(item, `${at}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (catalogSets[key] && typeof child === 'string') {
      const row = catalogSets[key].get(child);
      const record = { at: `${at}.${key}`, key, value: child, status: row?.status ?? null, enabled: row?.status === 'ENABLED' };
      catalogReferences.push(record);
      if (!record.enabled) catalogFailures.push(record);
    }
    scanCatalogReferences(child, `${at}.${key}`);
  }
}
for (const entry of candidateEntries) scanCatalogReferences(entry.body, keyOf(entry.skillKey, entry.kind, entry.stableKey));
for (const [key, catalogKey] of [['mana', 'attributeKey'], ['hp', 'attributeKey'], ['attack_damage', 'attributeKey'], ['ability_power', 'attributeKey'], ['move_speed_percent', 'attributeKey'], ['bonus_attack_speed_percent', 'attributeKey'], ['attribute_flat_add', 'modifierZoneKey']]) {
  const route = catalogKey === 'modifierZoneKey' ? '/modifier-zones' : '/attributes';
  const row = catalogSets[catalogKey]?.get(key);
  const record = { route, key, catalogKey, status: row?.status ?? null, enabled: row?.status === 'ENABLED' };
  catalogReferences.push({ ...record, required: true });
  if (!record.enabled) catalogFailures.push({ ...record, required: true });
}
staticCheck('所有属性与修正区域引用已存在且启用', catalogFailures.length === 0, catalogFailures);

const schema = {
  valueTypes: new Set(['INTEGER', 'DECIMAL']),
  valueModes: new Set(['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL', 'RUNTIME_INPUT']),
  nodeTypes: new Set(['PARAMETER', 'ATTRIBUTE', 'OPERATION']),
  operations: new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']),
  resultTypes: new Set(['RESOURCE_CHANGE', 'NORMAL_SHIELD', 'ATTRIBUTE_CHANGE']),
  resourceOperations: new Set(['CONSUME', 'RESTORE']),
  attributeOperations: new Set(['INCREASE', 'DECREASE', 'SET']),
};
const structureFailures = [];
const formulaKeys = new Set(candidateEntries.filter(entry => entry.kind === 'formulas').map(entry => keyOf(entry.skillKey, entry.kind, entry.stableKey)));
const parameterKeys = new Set(candidateEntries.filter(entry => entry.kind === 'parameters').map(entry => keyOf(entry.skillKey, entry.kind, entry.stableKey)));
const referencedParameter = (skillKey, parameterKey) => parameterKeys.has(keyOf(skillKey, 'parameters', parameterKey)) || reusedKeys.has(keyOf(skillKey, 'parameters', parameterKey));
function scanExpression(value, skillKey, formulaKey) {
  if (!value || typeof value !== 'object') { structureFailures.push({ type: 'emptyExpression', skillKey, formulaKey }); return; }
  if (value.nodeType === 'PARAMETER') {
    if (!referencedParameter(skillKey, value.parameterKey)) structureFailures.push({ type: 'missingParameterReference', skillKey, formulaKey, parameterKey: value.parameterKey });
    return;
  }
  if (value.nodeType === 'ATTRIBUTE') {
    if (!['SOURCE', 'TARGET'].includes(value.attributeOwner) || !['BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO'].includes(value.attributeValueKind)) structureFailures.push({ type: 'invalidAttributeReference', skillKey, formulaKey, value });
    if (value.attributeKey === 'fury' || value.attributeKey === 'actual_fury') structureFailures.push({ type: 'forbiddenFuryAttribute', skillKey, formulaKey, value });
    return;
  }
  if (value.nodeType !== 'OPERATION' || !schema.operations.has(value.operation) || !Array.isArray(value.operands) || value.operands.length !== 2) { structureFailures.push({ type: 'invalidBinaryOperation', skillKey, formulaKey, value }); return; }
  scanExpression(value.operands[0], skillKey, formulaKey);
  scanExpression(value.operands[1], skillKey, formulaKey);
}
for (const entry of candidateEntries) {
  if (entry.kind === 'formulas') scanExpression(entry.body.expression, entry.skillKey, entry.stableKey);
  if (entry.kind !== 'parameters') continue;
  const parameter = entry.body;
  if (!schema.valueTypes.has(parameter.valueType)) structureFailures.push({ type: 'invalidValueType', key: keyOf(entry.skillKey, entry.kind, entry.stableKey), value: parameter.valueType });
  if (!schema.valueModes.has(parameter.valueMode)) structureFailures.push({ type: 'invalidValueMode', key: keyOf(entry.skillKey, entry.kind, entry.stableKey), value: parameter.valueMode });
  if (parameter.valueMode === 'FIXED' && (parameter.fixedValue === null || parameter.levelValues !== null)) structureFailures.push({ type: 'invalidFixedParameter', key: keyOf(entry.skillKey, entry.kind, entry.stableKey) });
  if (parameter.valueMode === 'SKILL_LEVEL' && (parameter.fixedValue !== null || !parameter.levelValues || Object.keys(parameter.levelValues).length !== candidate.skills[entry.skillKey].maxLevel)) structureFailures.push({ type: 'invalidSkillLevelParameter', key: keyOf(entry.skillKey, entry.kind, entry.stableKey) });
  if (parameter.valueMode === 'RUNTIME_INPUT' && (parameter.fixedValue !== null || parameter.levelValues !== null)) structureFailures.push({ type: 'runtimeDefault', key: keyOf(entry.skillKey, entry.kind, entry.stableKey) });
  const values = parameter.valueMode === 'FIXED' ? [parameter.fixedValue] : parameter.valueMode === 'SKILL_LEVEL' ? Object.values(parameter.levelValues ?? {}) : [];
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) structureFailures.push({ type: 'nonFiniteParameter', key: keyOf(entry.skillKey, entry.kind, entry.stableKey) });
  if ((parameter.parameterKey.endsWith('_ms') || /(^|_)(stacks|count|次数)$/.test(parameter.parameterKey)) && (parameter.valueType !== 'INTEGER' || values.some(value => !Number.isInteger(value) || value < 0))) structureFailures.push({ type: 'invalidIntegerParameter', key: keyOf(entry.skillKey, entry.kind, entry.stableKey), values });
}
for (const entry of candidateEntries.filter(item => item.kind === 'effects')) {
  const effect = entry.body;
  if (effect.effectKey === 'move_speed_boost') structureFailures.push({ type: 'removedMoveSpeedEffectStillPresent', key: entry.stableKey });
  for (const result of effect.results ?? []) {
    if (!schema.resultTypes.has(result.resultType)) structureFailures.push({ type: 'invalidResultType', key: keyOf(entry.skillKey, entry.kind, entry.stableKey), resultType: result.resultType });
    if (['DAMAGE', 'DIRECT_HEAL', 'MOMENT', 'MOMENT_EVALUATION'].includes(result.resultType)) structureFailures.push({ type: 'forbiddenResultType', key: keyOf(entry.skillKey, entry.kind, entry.stableKey), resultType: result.resultType });
    if (result.detail?.attributeKey && result.resultType === 'ATTRIBUTE_CHANGE' && !schema.attributeOperations.has(result.detail.operation)) structureFailures.push({ type: 'invalidAttributeOperation', key: keyOf(entry.skillKey, entry.kind, entry.stableKey), operation: result.detail.operation });
    if (result.detail?.attributeKey && result.resultType === 'RESOURCE_CHANGE' && !schema.resourceOperations.has(result.detail.operation)) structureFailures.push({ type: 'invalidResourceOperation', key: keyOf(entry.skillKey, entry.kind, entry.stableKey), operation: result.detail.operation });
    const value = result.valueRule?.value;
    if (value?.kind === 'PARAMETER' && !referencedParameter(entry.skillKey, value.parameterKey)) structureFailures.push({ type: 'missingEffectParameter', key: keyOf(entry.skillKey, entry.kind, entry.stableKey), parameterKey: value.parameterKey });
    if (value?.kind === 'FORMULA' && !formulaKeys.has(keyOf(entry.skillKey, 'formulas', value.formulaKey))) structureFailures.push({ type: 'missingEffectFormula', key: keyOf(entry.skillKey, entry.kind, entry.stableKey), formulaKey: value.formulaKey });
    const duration = effect.lifecycle?.durationValue;
    if (duration && (duration.kind !== 'PARAMETER' || Object.hasOwn(duration, 'nodeType') || !referencedParameter(entry.skillKey, duration.parameterKey))) structureFailures.push({ type: 'invalidLifecycleParameter', key: keyOf(entry.skillKey, entry.kind, entry.stableKey), duration });
  }
}
staticCheck('候选结构和生命周期引用有效', structureFailures.length === 0, structureFailures);
const eCooldown = candidate.skills.blitzcrank_e.write.parameters.find(item => item.parameterKey === 'cooldown_ms');
staticCheck('布里茨E冷却修订值正确', equal(eCooldown?.levelValues, { '1': 7000, '2': 6500, '3': 6000, '4': 5500, '5': 5000 }) && eCooldown?.valueType === 'INTEGER', eCooldown);
const wEffects = candidate.skills.blitzcrank_w.write.effects;
staticCheck('布里茨W移速效果已移除', !wEffects.some(effect => effect.effectKey === 'move_speed_boost'), wEffects.map(effect => effect.effectKey));
staticCheck('布里茨W攻速和结束减速生命周期分离', wEffects.some(effect => effect.effectKey === 'attack_speed_boost' && effect.lifecycle?.durationValue?.parameterKey === 'duration_ms') && wEffects.some(effect => effect.effectKey === 'post_overdrive_slow' && effect.lifecycle?.durationValue?.parameterKey === 'slow_duration_ms'), wEffects.map(effect => ({ key: effect.effectKey, lifecycle: effect.lifecycle?.durationValue }))); 
staticCheck('布里茨W移速与攻速等级值分离', equal(candidate.skills.blitzcrank_w.write.parameters.find(item => item.parameterKey === 'move_speed_ratio')?.levelValues, { '1': 0.6, '2': 0.65, '3': 0.7, '4': 0.75, '5': 0.8 }) && equal(candidate.skills.blitzcrank_w.write.parameters.find(item => item.parameterKey === 'attack_speed_ratio')?.levelValues, { '1': 0.3, '2': 0.4, '3': 0.5, '4': 0.6, '5': 0.7 }), null);

const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outputDir = path.join(here, apply ? '实际写入' : '只读预检', runId);
fs.mkdirSync(outputDir, { recursive: true });
const journalFile = path.join(outputDir, '全部请求流水.jsonl');
const calls = [];
let lockAcquired = false;
let writeCount = 0;
let confirmedCount = 0;
const execution = {
  generatedAt: new Date().toISOString(),
  runId,
  mode: apply ? 'apply' : 'readonly',
  apiBase,
  candidateSha256: frozen.candidateSha256,
  planSha256: frozen.planSha256,
  writerSha256: sha256File(fileURLToPath(import.meta.url)),
  sourceVersion: candidate.meta?.sourceVersion,
  apiWrites: 0,
  postAttempts: 0,
  successfulPosts: 0,
  confirmed: 0,
  noBusinessWrites: true,
  staticChecks,
  staticFailures,
  calls: [],
  preflight: null,
  final: null,
  success: false,
};
const appendJournal = value => fs.appendFileSync(journalFile, `${JSON.stringify(value)}\n`, 'utf8');
function safeRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.includes('://') || route.includes('..') || route.includes('#')) throw new Error(`不安全接口路径：${route}`);
}
async function request(route, method = 'GET', body = undefined) {
  safeRoute(route);
  if (method !== 'GET') {
    if (!apply || method !== 'POST') throw new Error(`当前模式禁止接口方法：${method}`);
    if (!plan.requests.some(intent => intent.route === route && equal(intent.body, body))) throw new Error(`POST不在冻结计划：${route}`);
  }
  const sequence = calls.length + 1;
  appendJournal({ phase: '请求前', sequence, method, route, ...(body === undefined ? {} : { body }), at: new Date().toISOString() });
  let result;
  try {
    const response = await fetch(apiBase + route, {
      method,
      headers: { Authorization: `Bearer ${process.env.HERO26_API_TOKEN ?? 'local-entry'}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let data = null;
    let parseError = null;
    if (text.length) {
      try { data = JSON.parse(text); } catch (error) { parseError = String(error.message ?? error); }
    }
    result = { sequence, method, route, status: response.status, data, ...(parseError ? { parseError, responseBytes: Buffer.byteLength(text), responseSha256: sha256(text) } : {}), at: new Date().toISOString() };
  } catch (error) {
    result = { sequence, method, route, status: null, data: null, error: `${error.name ?? 'Error'}: ${error.message ?? error}`, at: new Date().toISOString() };
  }
  calls.push(result);
  appendJournal({ phase: '请求后', ...result });
  return result;
}
async function fetchUnique(routes) {
  const map = new Map();
  for (const route of [...new Set(routes)]) map.set(route, await request(route));
  return map;
}
const allCandidateDetailRoutes = candidateEntries.map(entry => entry.detailRoute);
const baselineRoutes = [...new Set((baseline.requests ?? []).map(request => request.route))];
const freshRoutes = [...new Set([...baselineRoutes, ...allCandidateDetailRoutes])];
const routeCategory = route => {
  if (catalogRoutes.has(route)) return '目录';
  if (route.startsWith('/characters/')) return '角色';
  if (route.startsWith('/character-skill-relations?')) return '关系';
  if (route.includes('/representative-image')) return '图片';
  if (subjectRoute(route)) return '主体';
  if (collectionRoute(route)) return '六类列表';
  if (/^\/skills\/[^/]+\/parameters\/[^/]+$/.test(route)) return '复用详情';
  return '新增详情';
};
function collectionCompare(expectedData, actualData, route, after) {
  const expectedRows = rows(expectedData);
  const actualRows = rows(actualData);
  if (!Array.isArray(expectedRows) || !Array.isArray(actualRows)) return { path: '$.items', expected: '数组', actual: actualData };
  const kind = route.match(/^\/skills\/[^/]+\/([^/]+)$/)?.[1];
  const id = ({ parameters: 'parameterKey', formulas: 'formulaKey', effects: 'effectKey', processes: 'processKey', 'internal-states': 'stateKey', 'trigger-rules': 'ruleKey' })[kind];
  if (!id) return { path: '$.route', expected: '已知六类列表', actual: route };
  const intents = after ? plan.requests.filter(intent => intent.route === route) : [];
  const oldIds = expectedRows.map(row => row?.[id]);
  const actualIds = actualRows.map(row => row?.[id]);
  const allowed = new Set(oldIds.concat(intents.map(intent => intent.stableKey)));
  if (new Set(actualIds).size !== actualIds.length) return { path: '$.items', expected: '稳定键唯一', actual: actualIds };
  const missingOld = oldIds.filter(value => !actualIds.includes(value));
  if (missingOld.length) return { path: '$.items', expected: { missingOld: [] }, actual: { missingOld } };
  const unexpected = actualIds.filter(value => !allowed.has(value));
  if (unexpected.length) return { path: '$.items', expected: { unexpected: [] }, actual: { unexpected } };
  for (const oldRow of expectedRows) {
    const actualRow = actualRows.find(row => row?.[id] === oldRow?.[id]);
    const rowDiff = protectedDiff(oldRow, actualRow);
    if (rowDiff) return { path: `$.items[${id}=${oldRow?.[id]}]`, rowDiff };
  }
  for (const intent of intents) {
    const actualRow = actualRows.find(row => row?.[id] === intent.stableKey);
    if (!actualRow) return { path: `$.items[${id}=${intent.stableKey}]`, expected: '新增列表行', actual: null };
    for (const [field, value] of Object.entries(intent.body)) {
      if (Object.hasOwn(actualRow, field) && !equal(stripServer(value), stripServer(actualRow[field]))) return { path: `$.items[${id}=${intent.stableKey}].${field}`, expected: value, actual: actualRow[field] };
    }
  }
  const expectedEnvelope = expectedData && typeof expectedData === 'object' && !Array.isArray(expectedData) ? { ...expectedData } : null;
  const actualEnvelope = actualData && typeof actualData === 'object' && !Array.isArray(actualData) ? { ...actualData } : null;
  if (expectedEnvelope && actualEnvelope) {
    delete expectedEnvelope.items;
    delete actualEnvelope.items;
    delete expectedEnvelope.data;
    delete actualEnvelope.data;
    if (after && typeof expectedEnvelope.total === 'number') expectedEnvelope.total += intents.length;
    if (diff(stripServer(expectedEnvelope), stripServer(actualEnvelope))) return { path: '$.envelope', difference: diff(stripServer(expectedEnvelope), stripServer(actualEnvelope)) };
  }
  if (actualRows.length !== expectedRows.length + intents.length) return { path: '$.items.length', expected: expectedRows.length + intents.length, actual: actualRows.length };
  return null;
}
function checkProtection(responseMap, after) {
  const records = [];
  const failures = [];
  const counts = { catalogs: 0, characters: 0, relations: 0, subjects: 0, images: 0, lists: 0, reusedDetails: 0 };
  for (const expected of baseline.requests ?? []) {
    const actual = responseMap.get(expected.route);
    const category = routeCategory(expected.route);
    const record = { route: expected.route, category, expectedStatus: expected.status, actualStatus: actual?.status ?? null, passed: false };
    if (!actual || actual.status !== expected.status) { record.reason = '状态码变化或未取得实际响应'; failures.push(record); records.push(record); continue; }
    if (category === '目录') counts.catalogs += 1;
    else if (category === '角色') counts.characters += 1;
    else if (category === '关系') counts.relations += 1;
    else if (category === '主体') counts.subjects += 1;
    else if (category === '图片') counts.images += 1;
    else if (category === '六类列表') counts.lists += 1;
    else if (category === '复用详情') counts.reusedDetails += 1;
    if (category === '六类列表') record.difference = collectionCompare(expected.data, actual.data, expected.route, after);
    else record.difference = protectedDiff(expected.data, actual.data);
    record.passed = !record.difference;
    if (!record.passed) failures.push(record);
    records.push(record);
  }
  if (!equal(counts, protectedSummaryCounts)) failures.push({ reason: '保护分组计数错误', expected: protectedSummaryCounts, actual: counts });
  return { checked: records.length, passed: records.filter(record => record.passed).length, failures, records, counts, after };
}
function checkCandidateDetails(responseMap, after) {
  const records = [];
  const failures = [];
  for (const entry of candidateEntries) {
    const actual = responseMap.get(entry.detailRoute);
    const expectedStatus = after ? 200 : 404;
    const record = { skillKey: entry.skillKey, kind: entry.kind, stableKey: entry.stableKey, route: entry.detailRoute, expectedStatus, actualStatus: actual?.status ?? null, passed: false };
    if (!actual || actual.status !== expectedStatus) record.reason = '新增详情状态码不符';
    else if (after) record.difference = protectedDiff(entry.body, actual.data);
    record.passed = Boolean(actual && actual.status === expectedStatus && (!after || !record.difference));
    if (!record.passed) failures.push(record);
    records.push(record);
  }
  return { checked: records.length, passed: records.filter(record => record.passed).length, failures, records };
}
function saveRun(name, value) { writeJson(path.join(outputDir, name), value); }
function saveExecution() {
  execution.finishedAt = new Date().toISOString();
  execution.calls = { total: calls.length, methods: calls.reduce((out, call) => { out[call.method] = (out[call.method] ?? 0) + 1; return out; }, {}), statuses: calls.reduce((out, call) => { out[String(call.status)] = (out[String(call.status)] ?? 0) + 1; return out; }, {}) };
  execution.apiWrites = calls.filter(call => call.method === 'POST').length;
  execution.postAttempts = execution.apiWrites;
  execution.successfulPosts = writeCount;
  execution.confirmed = confirmedCount;
  execution.noBusinessWrites = execution.apiWrites === 0;
  saveRun('执行结果.json', execution);
}
function acquireLock() {
  const lockBody = { at: new Date().toISOString(), runId, status: 'STARTED', candidateSha256: frozen.candidateSha256, planSha256: frozen.planSha256, expectedPostCount: frozen.newComponents };
  try { fs.writeFileSync(lockFile, `${JSON.stringify(lockBody, null, 2)}\n`, { flag: 'wx' }); lockAcquired = true; }
  catch (error) { if (error.code === 'EEXIST') throw new Error('已有第二十六批实际录入锁，禁止并行或重放'); throw error; }
}
function updateLock(status, error = undefined) {
  if (!lockAcquired) return;
  writeJson(lockFile, { at: new Date().toISOString(), runId, status, candidateSha256: frozen.candidateSha256, planSha256: frozen.planSha256, apiWrites: writeCount, postAttempts: calls.filter(call => call.method === 'POST').length, successfulPosts: writeCount, confirmed: confirmedCount, reportPath: path.join(outputDir, '执行结果.json'), ...(error ? { error } : {}) });
}
function writeIntent(index, entry, before) {
  const intentDir = path.join(outputDir, '写前意图');
  fs.mkdirSync(intentDir, { recursive: true });
  const file = path.join(intentDir, `${String(index + 1).padStart(3, '0')}-${entry.skillKey}-${entry.kind}-${entry.stableKey}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ sequence: index + 1, candidateSha256: frozen.candidateSha256, intent: planByKey.get(keyOf(entry.skillKey, entry.kind, entry.stableKey)), before }, null, 2)}\n`, { flag: 'wx' });
  return file;
}

let caughtError = null;
try {
  if (staticFailures.length) throw new Error(`静态冻结校验失败${staticFailures.length}项`);
  const fresh = await fetchUnique(freshRoutes);
  const protection = checkProtection(fresh, false);
  const details = checkCandidateDetails(fresh, false);
  execution.preflight = { uniqueFreshGET: fresh.size, protection, details, source: '实际API新GET' };
  saveRun('写前保护.json', { generatedAt: new Date().toISOString(), mode: execution.mode, baselineRequests: baseline.requests, responses: baseline.requests.map(request => fresh.get(request.route)), protection, apiWrites: 0, noBusinessWrites: true });
  saveRun('写前组件现值.json', { generatedAt: new Date().toISOString(), mode: execution.mode, candidateEntries, responses: candidateEntries.map(entry => ({ ...entry, response: fresh.get(entry.detailRoute) })), details, apiWrites: 0, noBusinessWrites: true });
  if (protection.failures.length || details.failures.length) throw new Error(`写前保护或新增缺项预检失败：${JSON.stringify({ protection: protection.failures.slice(0, 3), details: details.failures.slice(0, 3) })}`);
  if (apply) {
    acquireLock();
    updateLock('RUNNING');
    for (let index = 0; index < plan.requests.length; index += 1) {
      const intent = plan.requests[index];
      const entry = candidateEntries.find(item => keyOf(item.skillKey, item.kind, item.stableKey) === keyOf(intent.skillKey, intent.kind, intent.stableKey));
      if (!entry) throw new Error(`计划项找不到候选 ${intent.skillKey}/${intent.kind}/${intent.stableKey}`);
      const before = await request(entry.detailRoute);
      if (before.status !== 404) throw new Error(`写前新增详情不是404，停止写入：${entry.detailRoute} status=${before.status}`);
      writeIntent(index, entry, before);
      const posted = await request(entry.baseRoute, 'POST', entry.body);
      if (posted.status !== 201) {
        const afterError = await request(entry.detailRoute);
        throw new Error(`POST状态异常，已先GET后停止：${entry.detailRoute} POST=${posted.status} GET=${afterError.status}`);
      }
      writeCount += 1;
      const after = await request(entry.detailRoute);
      const difference = after.status === 200 ? protectedDiff(entry.body, after.data) : { path: '$.status', expected: 200, actual: after.status };
      if (difference) throw new Error(`POST后逐条GET不匹配，停止写入：${entry.detailRoute} ${JSON.stringify(difference)}`);
      confirmedCount += 1;
      updateLock('RUNNING');
    }
    const finalFresh = await fetchUnique(freshRoutes);
    const finalProtection = checkProtection(finalFresh, true);
    const finalDetails = checkCandidateDetails(finalFresh, true);
    execution.final = { uniqueFreshGET: finalFresh.size, protection: finalProtection, details: finalDetails, source: '实际API新GET' };
    saveRun('写后保护.json', { generatedAt: new Date().toISOString(), baselineRequests: baseline.requests, responses: baseline.requests.map(request => finalFresh.get(request.route)), protection: finalProtection, apiWrites: writeCount, postAttempts: calls.filter(call => call.method === 'POST').length, successfulPosts: writeCount, noBusinessWrites: false });
    saveRun('最终全量新增组件现值.json', { generatedAt: new Date().toISOString(), candidateEntries, responses: candidateEntries.map(entry => ({ ...entry, response: finalFresh.get(entry.detailRoute) })), details: finalDetails, apiWrites: writeCount, postAttempts: calls.filter(call => call.method === 'POST').length, successfulPosts: writeCount, noBusinessWrites: false });
    if (finalProtection.failures.length || finalDetails.failures.length) throw new Error(`写后保护或组件回读失败：${JSON.stringify({ protection: finalProtection.failures.slice(0, 3), details: finalDetails.failures.slice(0, 3) })}`);
    updateLock('COMPLETED');
  }
  execution.success = true;
} catch (error) {
  caughtError = String(error.stack ?? error);
  execution.error = caughtError;
  if (apply && lockAcquired) updateLock('STOPPED', caughtError);
  process.exitCode = 1;
} finally {
  saveExecution();
  console.log(JSON.stringify({ mode: execution.mode, success: execution.success, apiWrites: execution.apiWrites, postAttempts: execution.postAttempts, successfulPosts: execution.successfulPosts, confirmed: execution.confirmed, counts: execution.calls, preflight: execution.preflight ? { uniqueFreshGET: execution.preflight.uniqueFreshGET, protection: { checked: execution.preflight.protection.checked, passed: execution.preflight.protection.passed }, details: { checked: execution.preflight.details.checked, passed: execution.preflight.details.passed } } : null, final: execution.final ? { uniqueFreshGET: execution.final.uniqueFreshGET, protection: { checked: execution.final.protection.checked, passed: execution.final.protection.passed }, details: { checked: execution.final.details.checked, passed: execution.final.details.passed } } : null, output: outputDir, noBusinessWrites: execution.noBusinessWrites, error: caughtError }, null, 2));
}
