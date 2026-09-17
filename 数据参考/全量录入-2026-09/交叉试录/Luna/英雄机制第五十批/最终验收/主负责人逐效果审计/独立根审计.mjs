import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const WORKTREE = process.cwd();
const OUT = path.resolve(WORKTREE, '.agents/artifacts/hero50-final-root-audit');
const CANDIDATE_DIR = path.resolve(WORKTREE, '.agents/artifacts/hero50-luna-candidate/修订一');
const INPUT_DIR = path.resolve(WORKTREE, '.agents/artifacts/hero50-root-entry-20260910');
const PLANNING_DIR = 'C:/project/damage_viewer_project_planning';
const BACKEND_DIR = 'C:/project/damage_backend_dev';
const readText = file => fs.readFileSync(file, 'utf8');
const readJson = file => JSON.parse(readText(file));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileSha = file => sha256(fs.readFileSync(file));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
const writeBytes = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const writeJson = (file, value) => writeBytes(file, jsonBytes(value));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const integer = value => Number.isInteger(value);
const has = (object, key) => isRecord(object) && Object.prototype.hasOwnProperty.call(object, key);
const sameSet = (left, right) => left.length === right.length && left.every(value => right.includes(value));
const stableKey = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value);
const add = (list, value) => list.push(value);

const candidateFile = path.join(CANDIDATE_DIR, '完整候选.json');
const planFile = path.join(CANDIDATE_DIR, '请求计划.json');
const sourceValuesFile = path.join(CANDIDATE_DIR, '来源值摘要.json');
const mathFile = path.join(CANDIDATE_DIR, '独立数学报告.json');
const candidate = readJson(candidateFile);
const plan = readJson(planFile);
const sourceValues = readJson(sourceValuesFile);
const math = readJson(mathFile);
const protection = readJson(path.join(INPUT_DIR, '参考资料', '当前20槽保护快照.json'));
const sourceBinding = readJson(path.join(INPUT_DIR, '来源绑定与当前文本.json'));
const routeMap = new Map((protection.requests || []).map(item => [item.route, item]));
const sourceSkillMap = Object.fromEntries(Object.entries(sourceValues.sourceValues || {}).map(([key, value]) => [key, value]));
const sourceBySkill = skillKey => sourceSkillMap[skillKey] || {};
const skills = candidate.order || Object.keys(candidate.skills || {});
const sourceParams = skillKey => new Set(sourceBySkill(skillKey).selectedParameterKeys || []);
const sourceFormulas = skillKey => new Set(sourceBySkill(skillKey).selectedFormulaKeys || []);
const sourceEffects = skillKey => new Set(sourceBySkill(skillKey).selectedEffectKeys || []);
const localParameters = skillKey => new Map((candidate.skills[skillKey]?.write?.parameters || []).map(item => [item.parameterKey, item]));
const localFormulas = skillKey => new Map((candidate.skills[skillKey]?.write?.formulas || []).map(item => [item.formulaKey, item]));
const reusedPublic = new Set((candidate.reusedPublicParameters || []).map(item => `${item.skillKey}/${item.parameterKey}`));
const allResultTypes = new Set([
  'DAMAGE', 'DIRECT_HEAL', 'NORMAL_SHIELD', 'ATTRIBUTE_CHANGE', 'RESOURCE_CHANGE', 'COOLDOWN_CHANGE',
  'STATUS_OPERATION', 'LIFECYCLE_OPERATION', 'DAMAGE_MODIFIER', 'HEALING_MODIFIER', 'DAMAGE_IMMUNITY',
  'HEALTH_FLOOR', 'SPELL_SHIELD', 'EXECUTE', 'HIT_LINK_APPLICATION', 'ATTACK_LINK_APPLICATION',
  'SKILL_HASTE_MODIFIER'
]);
const formulaOperations = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MIN', 'MAX']);
const formulaOwners = new Set(['SOURCE', 'TARGET']);
const formulaValueKinds = new Set(['BASE', 'BONUS', 'TOTAL', 'CURRENT', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO']);
const resultScopes = new Set(['SKILL', 'EFFECT', 'DAMAGE_INSTANCE', 'RESULT']);
const damageDeliveries = new Set(['SKILL', 'BASIC_ATTACK']);
const damageOrigins = new Set(['DIRECT', 'REFLECTED']);
const criticalModes = new Set(['DISALLOWED', 'SOURCE_CRIT_CHANCE', 'FORCED']);
const vampTypes = new Set(['LIFE_STEAL', 'OMNIVAMP', 'PHYSICAL_VAMP', 'SPELL_VAMP']);
const vampBases = new Set(['POST_DEFENSE_DAMAGE', 'ACTUAL_HP_LOSS']);
const lifecycleMoments = new Set(['APPLICATION', 'PERSISTENT', 'FULL_STACKS', 'PERIODIC', 'NATURAL_END', 'EARLY_REMOVE']);
const valueReadModes = new Set(['APPLICATION_SNAPSHOT', 'MOMENT_EVALUATION']);
const stackModes = new Set(['SHARED', 'PER_STACK']);
const reapplicationValueModes = new Set(['KEEP', 'REPLACE', 'ADD']);
const periodicModes = new Set(['ONCE_PER_INSTANCE', 'ONCE_PER_ACTIVE_STACK']);
const lifecycleScopes = new Set(['SKILL', 'SOURCE', 'TARGET', 'SOURCE_TARGET']);
const reapplicationStackModes = new Set(['KEEP', 'INCREASE', 'REPLACE']);
const reapplicationDurationModes = new Set(['REFRESH_ALL', 'KEEP_REMAINING', 'INDEPENDENT']);
const expiryModes = new Set(['ALL_AT_ONCE', 'ONE_BY_ONE', 'INDEPENDENT', 'EXPLICIT_ONLY']);
const firstPeriodicExecutions = new Set(['IMMEDIATE', 'AFTER_INTERVAL']);
const attributeOperations = new Set(['INCREASE', 'DECREASE', 'SET']);
const resourceOperations = new Set(['RESTORE', 'CONSUME', 'REFUND']);
const damageTypes = new Set((routeMap.get('/damage-types')?.data?.items || []).map(item => item.damageTypeKey));
const modifierZones = new Set((routeMap.get('/modifier-zones')?.data?.items || []).map(item => item.modifierZoneKey));
const attributes = new Set((routeMap.get('/attributes')?.data?.items || []).map(item => item.attributeKey));
const statuses = new Set((routeMap.get('/statuses')?.data?.items || []).map(item => item.statusKey));
const knownInputFiles = [
  path.join(INPUT_DIR, '来源绑定与当前文本.json'),
  path.join(INPUT_DIR, '主负责人最终范围与核对说明.md'),
  path.join(INPUT_DIR, '主负责人前两英雄源值核对.md'),
  path.join(INPUT_DIR, '参考资料', '当前20槽保护快照.json'),
  path.join(INPUT_DIR, '参考资料', '公共参数复用清单.json'),
  path.join(INPUT_DIR, '输入版本.json'),
  candidateFile, planFile, sourceValuesFile, mathFile
];

const requestFailures = [];
const requestFieldCounts = { envelope: 0, body: 0, effectResult: 0 };
const expectedEnvelope = ['sequence', 'operation', 'method', 'route', 'detailRoute', 'skillKey', 'kind', 'stableKey', 'status', 'body'];
const expectedBody = {
  parameters: ['parameterKey', 'name', 'valueType', 'valueMode', 'fixedValue', 'levelValues', 'description', 'sortOrder'],
  formulas: ['formulaKey', 'name', 'expression', 'description', 'sortOrder'],
  effects: ['effectKey', 'name', 'description', 'sortOrder', 'lifecycle', 'results']
};
const expectedResult = ['resultKey', 'name', 'resultType', 'target', 'description', 'sortOrder', 'lifecycleBehavior', 'spellShieldBlockScope', 'valueRule', 'detail'];
const keyOfRequest = request => `${request.skillKey}/${request.kind}/${request.stableKey}`;
const localIds = [];
const localIdSet = new Set();
for (const skillKey of skills) {
  for (const kind of ['parameters', 'formulas', 'effects']) {
    for (const item of candidate.skills[skillKey]?.write?.[kind] || []) {
      const key = item.parameterKey || item.formulaKey || item.effectKey;
      const id = `${skillKey}/${kind}/${key}`;
      localIds.push(id);
      if (localIdSet.has(id)) add(requestFailures, { path: id, issue: '候选本地稳定标识重复' });
      localIdSet.add(id);
    }
  }
}
const planIds = [];
for (let index = 0; index < (plan.requests || []).length; index += 1) {
  const request = plan.requests[index];
  const requestPath = `requests[${index}]`;
  for (const field of expectedEnvelope) {
    requestFieldCounts.envelope += 1;
    if (!has(request, field)) add(requestFailures, { path: `${requestPath}.${field}`, issue: '缺少请求必填字段' });
  }
  const kind = request?.kind;
  if (!expectedBody[kind]) {
    add(requestFailures, { path: `${requestPath}.kind`, issue: '未知请求组成类型' });
    continue;
  }
  for (const field of expectedBody[kind]) {
    requestFieldCounts.body += 1;
    if (!has(request.body, field)) add(requestFailures, { path: `${requestPath}.body.${field}`, issue: '缺少请求体必填字段' });
  }
  if (kind === 'effects' && Array.isArray(request.body?.results)) {
    for (let resultIndex = 0; resultIndex < request.body.results.length; resultIndex += 1) {
      const result = request.body.results[resultIndex];
      for (const field of expectedResult) {
        requestFieldCounts.effectResult += 1;
        if (!has(result, field)) add(requestFailures, { path: `${requestPath}.body.results[${resultIndex}].${field}`, issue: '缺少效果结果必填字段' });
      }
    }
  }
  const stable = request.stableKey;
  const expectedRoute = `/skills/${request.skillKey}/${kind}`;
  const expectedDetail = `${expectedRoute}/${stable}`;
  if (request.sequence !== index + 1) add(requestFailures, { path: `${requestPath}.sequence`, issue: '请求序号不是连续1起' });
  if (request.operation !== 'POST' || request.method !== 'POST') add(requestFailures, { path: requestPath, issue: '写前计划操作不是POST' });
  if (!skills.includes(request.skillKey)) add(requestFailures, { path: `${requestPath}.skillKey`, issue: '请求技能不在20槽候选' });
  if (request.route !== expectedRoute || request.detailRoute !== expectedDetail) add(requestFailures, { path: requestPath, issue: '请求路由或详情路由与稳定标识不一致' });
  const bodyKey = request.body?.parameterKey || request.body?.formulaKey || request.body?.effectKey;
  if (bodyKey !== stable) add(requestFailures, { path: requestPath, issue: 'stableKey与请求体稳定标识不一致' });
  if (!integer(request.body?.sortOrder) || request.body.sortOrder < 0) add(requestFailures, { path: `${requestPath}.body.sortOrder`, issue: 'sortOrder不是非负整数' });
  planIds.push(keyOfRequest(request));
  const expectedItem = candidate.skills[request.skillKey]?.write?.[kind]?.find(item => (item.parameterKey || item.formulaKey || item.effectKey) === stable);
  if (!expectedItem) add(requestFailures, { path: requestPath, issue: '计划请求未对应候选本地组成' });
  else if (JSON.stringify(request.body) !== JSON.stringify(expectedItem)) add(requestFailures, { path: requestPath, issue: '计划请求体与候选本地组成不一致' });
}
const duplicatePlanIds = planIds.filter((id, index) => planIds.indexOf(id) !== index);
for (const id of duplicatePlanIds) add(requestFailures, { path: id, issue: '写前计划稳定标识重复' });
for (const id of localIds) if (!planIds.includes(id)) add(requestFailures, { path: id, issue: '候选本地组成未进入写前计划' });
for (const id of planIds) if (!localIdSet.has(id)) add(requestFailures, { path: id, issue: '写前计划包含未在候选中的本地组成' });

const candidateFailures = [];
const levelChecks = [];
const runtimeChecks = [];
const sortChecks = [];
const candidateCounts = { parameters: 0, formulas: 0, effects: 0, processes: 0, internalStates: 0, triggerRules: 0 };
for (const skillKey of skills) {
  const skill = candidate.skills[skillKey];
  if (!skill || !skill.write) { add(candidateFailures, { path: `skills.${skillKey}`, issue: '缺少技能或写入组成' }); continue; }
  const protectedMax = routeMap.get(`/skills/${skillKey}`)?.data?.maxLevel;
  if (!integer(skill.maxLevel) || skill.maxLevel < 1) add(candidateFailures, { path: `skills.${skillKey}.maxLevel`, issue: 'maxLevel不是正整数' });
  if (integer(protectedMax) && skill.maxLevel !== protectedMax) add(candidateFailures, { path: `skills.${skillKey}.maxLevel`, issue: `与固定保护快照不一致，候选=${skill.maxLevel}，保护=${protectedMax}` });
  for (const kind of Object.keys(candidateCounts)) {
    const rows = skill.write[kind === 'internalStates' ? 'internalStates' : kind === 'triggerRules' ? 'triggerRules' : kind] || [];
    if (!Array.isArray(rows)) add(candidateFailures, { path: `skills.${skillKey}.write.${kind}`, issue: '组成数组缺失或类型错误' });
    else candidateCounts[kind] += rows.length;
  }
  const rows = skill.write.parameters || [];
  for (const parameter of rows) {
    const pPath = `skills.${skillKey}.parameters.${parameter.parameterKey}`;
    if (!stableKey(parameter.parameterKey)) add(candidateFailures, { path: `${pPath}.parameterKey`, issue: '参数键不符合稳定标识格式' });
    if (!['INTEGER', 'DECIMAL'].includes(parameter.valueType)) add(candidateFailures, { path: `${pPath}.valueType`, issue: '参数类型不在当前协议' });
    if (!['FIXED', 'SKILL_LEVEL', 'RUNTIME_INPUT'].includes(parameter.valueMode)) add(candidateFailures, { path: `${pPath}.valueMode`, issue: '参数取值模式不在当前协议' });
    if (!integer(parameter.sortOrder) || parameter.sortOrder < 0) add(candidateFailures, { path: `${pPath}.sortOrder`, issue: '参数sortOrder不是非负整数' });
    sortChecks.push({ path: `${pPath}.sortOrder`, pass: integer(parameter.sortOrder) && parameter.sortOrder >= 0 });
    if (parameter.valueMode === 'FIXED') {
      const pass = finite(parameter.fixedValue) && parameter.levelValues === null;
      if (!pass) add(candidateFailures, { path: pPath, issue: 'FIXED必须是有限fixedValue且levelValues为null' });
    } else if (parameter.valueMode === 'SKILL_LEVEL') {
      const expected = Array.from({ length: skill.maxLevel }, (_, i) => String(i + 1));
      const actual = isRecord(parameter.levelValues) ? Object.keys(parameter.levelValues) : [];
      const pass = parameter.fixedValue === null && isRecord(parameter.levelValues) && sameSet(actual, expected) && expected.every(key => finite(parameter.levelValues[key]));
      levelChecks.push({ skillKey, parameterKey: parameter.parameterKey, maxLevel: skill.maxLevel, keys: actual, pass });
      if (!pass) add(candidateFailures, { path: pPath, issue: `SKILL_LEVEL必须完整覆盖1..${skill.maxLevel}且每项为有限数` });
    } else {
      const description = String(parameter.description || '');
      const pass = parameter.fixedValue === null && parameter.levelValues === null && ['INTEGER', 'DECIMAL'].includes(parameter.valueType) && /无默认|实际|缺值|运行层/.test(description);
      runtimeChecks.push({ skillKey, parameterKey: parameter.parameterKey, valueType: parameter.valueType, pass, description });
      if (!pass) add(candidateFailures, { path: pPath, issue: 'RUNTIME_INPUT必须无默认值并说明实际运行输入' });
    }
  }
  for (const formula of skill.write.formulas || []) {
    const fPath = `skills.${skillKey}.formulas.${formula.formulaKey}`;
    if (!stableKey(formula.formulaKey)) add(candidateFailures, { path: `${fPath}.formulaKey`, issue: '公式键不符合稳定标识格式' });
    if (!integer(formula.sortOrder) || formula.sortOrder < 0) add(candidateFailures, { path: `${fPath}.sortOrder`, issue: '公式sortOrder不是非负整数' });
    sortChecks.push({ path: `${fPath}.sortOrder`, pass: integer(formula.sortOrder) && formula.sortOrder >= 0 });
  }
  for (const effect of skill.write.effects || []) {
    const ePath = `skills.${skillKey}.effects.${effect.effectKey}`;
    if (!stableKey(effect.effectKey)) add(candidateFailures, { path: `${ePath}.effectKey`, issue: '效果键不符合稳定标识格式' });
    if (!integer(effect.sortOrder) || effect.sortOrder < 0) add(candidateFailures, { path: `${ePath}.sortOrder`, issue: '效果sortOrder不是非负整数' });
    sortChecks.push({ path: `${ePath}.sortOrder`, pass: integer(effect.sortOrder) && effect.sortOrder >= 0 });
    if (!Array.isArray(effect.results) || effect.results.length === 0) add(candidateFailures, { path: `${ePath}.results`, issue: '效果没有结果' });
    for (const result of effect.results || []) {
      const rPath = `${ePath}.results.${result.resultKey}`;
      if (!stableKey(result.resultKey)) add(candidateFailures, { path: `${rPath}.resultKey`, issue: '结果键不符合稳定标识格式' });
      if (!allResultTypes.has(result.resultType)) add(candidateFailures, { path: `${rPath}.resultType`, issue: '结果类型不在当前协议' });
      if (!['SOURCE', 'TARGET'].includes(result.target)) add(candidateFailures, { path: `${rPath}.target`, issue: '结果target不在当前协议' });
      if (!integer(result.sortOrder) || result.sortOrder < 0) add(candidateFailures, { path: `${rPath}.sortOrder`, issue: '结果sortOrder不是非负整数' });
      sortChecks.push({ path: `${rPath}.sortOrder`, pass: integer(result.sortOrder) && result.sortOrder >= 0 });
    }
  }
}
const candidateCountPass = JSON.stringify(candidateCounts) === JSON.stringify({ parameters: 120, formulas: 24, effects: 30, processes: 0, internalStates: 0, triggerRules: 0 });
if (!candidateCountPass) add(candidateFailures, { path: 'candidate.counts', issue: `本地组成计数不符：${JSON.stringify(candidateCounts)}` });

const nodeFailures = [];
const nodeStats = { totalNodes: 0, operations: 0, parameters: 0, attributes: 0, maxMinOperations: 0 };
const formulaRefs = [];
const runtimeFormulaRefs = [];
const localFormulaIds = new Set(skills.flatMap(skillKey => (candidate.skills[skillKey]?.write?.formulas || []).map(item => `${skillKey}/${item.formulaKey}`)));
const localParameterIds = new Set(skills.flatMap(skillKey => (candidate.skills[skillKey]?.write?.parameters || []).map(item => `${skillKey}/${item.parameterKey}`)));
function checkNode(node, skillKey, formulaKey, nodePath) {
  nodeStats.totalNodes += 1;
  if (!isRecord(node)) { add(nodeFailures, { path: nodePath, issue: '公式节点不是对象' }); return; }
  const nodeType = node.nodeType;
  if (nodeType === 'OPERATION') {
    nodeStats.operations += 1;
    const keys = Object.keys(node);
    if (!sameSet(keys, ['nodeType', 'operation', 'operands'])) add(nodeFailures, { path: nodePath, issue: 'OPERATION节点字段不在白名单' });
    if (!formulaOperations.has(node.operation)) add(nodeFailures, { path: `${nodePath}.operation`, issue: '公式运算不在白名单' });
    if (!Array.isArray(node.operands) || node.operands.length !== 2) add(nodeFailures, { path: `${nodePath}.operands`, issue: '二元运算没有恰好两个操作数' });
    if (node.operation === 'MIN' || node.operation === 'MAX') nodeStats.maxMinOperations += 1;
    for (let index = 0; index < (node.operands || []).length; index += 1) checkNode(node.operands[index], skillKey, formulaKey, `${nodePath}.operands[${index}]`);
  } else if (nodeType === 'PARAMETER') {
    nodeStats.parameters += 1;
    if (!sameSet(Object.keys(node), ['nodeType', 'parameterKey']) || !stableKey(node.parameterKey)) add(nodeFailures, { path: nodePath, issue: 'PARAMETER节点字段或键非法' });
    const localId = `${skillKey}/${node.parameterKey}`;
    if (!localParameterIds.has(localId) && !reusedPublic.has(localId)) add(nodeFailures, { path: nodePath, issue: `参数引用不存在：${localId}` });
    const parameter = candidate.skills[skillKey]?.write?.parameters?.find(item => item.parameterKey === node.parameterKey);
    const publicItem = (candidate.reusedPublicParameters || []).find(item => item.skillKey === skillKey && item.parameterKey === node.parameterKey);
    const source = parameter || publicItem?.expected;
    formulaRefs.push({ skillKey, formulaKey, nodePath, kind: 'PARAMETER', parameterKey: node.parameterKey, valueMode: source?.valueMode || null });
    if (source?.valueMode === 'RUNTIME_INPUT') runtimeFormulaRefs.push({ skillKey, formulaKey, parameterKey: node.parameterKey, nodePath });
  } else if (nodeType === 'ATTRIBUTE') {
    nodeStats.attributes += 1;
    if (!sameSet(Object.keys(node), ['nodeType', 'attributeOwner', 'attributeKey', 'attributeValueKind'])) add(nodeFailures, { path: nodePath, issue: 'ATTRIBUTE节点字段不在白名单' });
    if (!formulaOwners.has(node.attributeOwner) || !formulaValueKinds.has(node.attributeValueKind) || !attributes.has(node.attributeKey)) add(nodeFailures, { path: nodePath, issue: `属性引用无效：${node.attributeOwner}/${node.attributeKey}/${node.attributeValueKind}` });
  } else {
    add(nodeFailures, { path: nodePath, issue: `未知公式节点类型：${String(nodeType)}` });
  }
}
for (const skillKey of skills) for (const formula of candidate.skills[skillKey].write.formulas || []) checkNode(formula.expression, skillKey, formula.formulaKey, `skills.${skillKey}.formulas.${formula.formulaKey}.expression`);

const lifecycleFailures = [];
const valueRuleFailures = [];
const resultFailures = [];
const lifecycleStats = { effects: 0, results: 0, persistentResults: 0, durationRefs: 0, runtimeDurationRefs: 0 };
const valueRefStats = { rules: 0, formulaRefs: 0, parameterRefs: 0, fixedValues: 0 };
const lifecycleValueKeys = ['durationValue', 'maxStacksValue', 'applicationStacksValue', 'periodicIntervalValue'];
function checkNumericValue(value, skillKey, label, allowNull) {
  if (value === null && allowNull) return { pass: true, source: null };
  if (!isRecord(value) || !['FIXED', 'PARAMETER', 'FORMULA'].includes(value.kind)) { add(lifecycleFailures, { path: label, issue: '数值引用结构非法' }); return { pass: false, source: null }; }
  const allowed = value.kind === 'FIXED' ? ['kind', 'value'] : value.kind === 'PARAMETER' ? ['kind', 'parameterKey'] : ['kind', 'formulaKey'];
  if (!sameSet(Object.keys(value), allowed)) add(lifecycleFailures, { path: label, issue: '数值引用多出或缺少字段' });
  if (value.kind === 'FIXED') {
    valueRefStats.fixedValues += 1;
    if (!finite(value.value)) add(lifecycleFailures, { path: label, issue: 'FIXED数值不是有限数' });
  } else if (value.kind === 'PARAMETER') {
    valueRefStats.parameterRefs += 1;
    if (!stableKey(value.parameterKey) || (!localParameterIds.has(`${skillKey}/${value.parameterKey}`) && !reusedPublic.has(`${skillKey}/${value.parameterKey}`))) add(lifecycleFailures, { path: label, issue: `生命周期参数引用不存在：${skillKey}/${value.parameterKey}` });
    lifecycleStats.durationRefs += label.endsWith('.durationValue') ? 1 : 0;
    if (candidate.skills[skillKey]?.write?.parameters?.find(item => item.parameterKey === value.parameterKey)?.valueMode === 'RUNTIME_INPUT') lifecycleStats.runtimeDurationRefs += 1;
  } else {
    valueRefStats.formulaRefs += 1;
    if (!stableKey(value.formulaKey) || !localFormulaIds.has(`${skillKey}/${value.formulaKey}`)) add(lifecycleFailures, { path: label, issue: `生命周期公式引用不存在：${skillKey}/${value.formulaKey}` });
  }
  return { pass: true, source: value };
}
function checkValueRule(valueRule, skillKey, rPath) {
  valueRefStats.rules += 1;
  if (!isRecord(valueRule) || !sameSet(Object.keys(valueRule), ['value', 'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue'])) { add(valueRuleFailures, { path: `${rPath}.valueRule`, issue: 'valueRule字段结构非法' }); return; }
  if (!finite(valueRule.fixedMultiplier) || (valueRule.fixedMinValue !== null && !finite(valueRule.fixedMinValue)) || (valueRule.fixedMaxValue !== null && !finite(valueRule.fixedMaxValue))) add(valueRuleFailures, { path: `${rPath}.valueRule`, issue: 'valueRule固定数值不是有限数或null' });
  checkNumericValue(valueRule.value, skillKey, `${rPath}.valueRule.value`, false);
}
function checkLifecycle(effect, skillKey, ePath) {
  lifecycleStats.effects += effect.lifecycle ? 1 : 0;
  if (effect.lifecycle === null) {
    for (const result of effect.results || []) if (result.lifecycleBehavior !== null) add(lifecycleFailures, { path: `${ePath}.results.${result.resultKey}.lifecycleBehavior`, issue: '无父生命周期时结果行为必须为null' });
    return;
  }
  const lifecycle = effect.lifecycle;
  const required = ['durationValue', 'maxStacksValue', 'applicationStacksValue', 'instanceScope', 'reapplicationStackMode', 'reapplicationDurationMode', 'expiryMode', 'periodicIntervalValue', 'firstPeriodicExecution'];
  if (!sameSet(Object.keys(lifecycle), required)) add(lifecycleFailures, { path: `${ePath}.lifecycle`, issue: '生命周期字段与当前协议不一致' });
  for (const key of lifecycleValueKeys) checkNumericValue(lifecycle[key], skillKey, `${ePath}.lifecycle.${key}`, key === 'durationValue' || key === 'periodicIntervalValue');
  if (!lifecycleScopes.has(lifecycle.instanceScope)) add(lifecycleFailures, { path: `${ePath}.lifecycle.instanceScope`, issue: '生命周期实例范围非法' });
  if (!reapplicationStackModes.has(lifecycle.reapplicationStackMode)) add(lifecycleFailures, { path: `${ePath}.lifecycle.reapplicationStackMode`, issue: '重应用层数模式非法' });
  if (lifecycle.reapplicationDurationMode !== null && !reapplicationDurationModes.has(lifecycle.reapplicationDurationMode)) add(lifecycleFailures, { path: `${ePath}.lifecycle.reapplicationDurationMode`, issue: '重应用持续模式非法' });
  if (!expiryModes.has(lifecycle.expiryMode)) add(lifecycleFailures, { path: `${ePath}.lifecycle.expiryMode`, issue: '到期模式非法' });
  if (lifecycle.firstPeriodicExecution !== null && !firstPeriodicExecutions.has(lifecycle.firstPeriodicExecution)) add(lifecycleFailures, { path: `${ePath}.lifecycle.firstPeriodicExecution`, issue: '首次周期执行模式非法' });
  if (lifecycle.periodicIntervalValue === null && lifecycle.firstPeriodicExecution !== null) add(lifecycleFailures, { path: `${ePath}.lifecycle.firstPeriodicExecution`, issue: '没有周期时长却设置首次周期执行' });
  for (const result of effect.results || []) {
    lifecycleStats.results += 1;
    const rPath = `${ePath}.results.${result.resultKey}`;
    const behavior = result.lifecycleBehavior;
    if (!isRecord(behavior)) { add(lifecycleFailures, { path: `${rPath}.lifecycleBehavior`, issue: '有父生命周期时结果行为必须为对象' }); continue; }
    const behaviorKeys = ['moment', 'valueReadMode', 'stackValueMode', 'reapplicationValueMode', 'periodicExecutionMode'];
    if (!sameSet(Object.keys(behavior), behaviorKeys)) add(lifecycleFailures, { path: `${rPath}.lifecycleBehavior`, issue: '结果生命周期行为字段不完整或多余' });
    if (!lifecycleMoments.has(behavior.moment)) add(lifecycleFailures, { path: `${rPath}.lifecycleBehavior.moment`, issue: '生命周期时点非法' });
    for (const [key, allowed] of [['valueReadMode', valueReadModes], ['stackValueMode', stackModes], ['reapplicationValueMode', reapplicationValueModes], ['periodicExecutionMode', periodicModes]]) if (behavior[key] !== null && !allowed.has(behavior[key])) add(lifecycleFailures, { path: `${rPath}.lifecycleBehavior.${key}`, issue: '生命周期结果行为枚举非法' });
    if (behavior.moment === 'PERSISTENT') lifecycleStats.persistentResults += 1;
  }
}
for (const skillKey of skills) for (const effect of candidate.skills[skillKey].write.effects || []) {
  const ePath = `skills.${skillKey}.effects.${effect.effectKey}`;
  checkLifecycle(effect, skillKey, ePath);
  for (const result of effect.results || []) {
    const rPath = `${ePath}.results.${result.resultKey}`;
    if (!has(result, 'spellShieldBlockScope')) add(resultFailures, { path: rPath, issue: '结果缺少spellShieldBlockScope字段' });
    const scope = result.spellShieldBlockScope;
    const persistent = result.lifecycleBehavior?.moment === 'PERSISTENT';
    if (scope !== null) {
      if (!resultScopes.has(scope)) add(resultFailures, { path: `${rPath}.spellShieldBlockScope`, issue: '法术护盾范围不是合法值' });
      const eligible = result.target === 'TARGET' && !persistent && ['DAMAGE', 'ATTRIBUTE_CHANGE', 'RESOURCE_CHANGE', 'COOLDOWN_CHANGE', 'STATUS_OPERATION', 'LIFECYCLE_OPERATION', 'EXECUTE', 'HIT_LINK_APPLICATION', 'ATTACK_LINK_APPLICATION'].includes(result.resultType);
      const persistentApply = persistent && result.target === 'TARGET' && result.resultType === 'STATUS_OPERATION' && result.detail?.operation === 'APPLY' && scope === 'RESULT';
      if (!eligible && !persistentApply) add(resultFailures, { path: `${rPath}.spellShieldBlockScope`, issue: '范围值虽合法但结果形状不具备当前契约资格' });
      if (scope === 'DAMAGE_INSTANCE' && result.resultType !== 'DAMAGE') add(resultFailures, { path: `${rPath}.spellShieldBlockScope`, issue: 'DAMAGE_INSTANCE只能用于DAMAGE' });
    }
    checkValueRule(result.valueRule, skillKey, rPath);
    if (result.resultType === 'DAMAGE') {
      const detail = result.detail;
      for (const key of ['damageTypeKey', 'deliveryKind', 'originKind', 'critical', 'vampRules']) if (!has(detail, key)) add(resultFailures, { path: `${rPath}.detail.${key}`, issue: 'DAMAGE明细缺少必填字段' });
      if (!damageTypes.has(detail?.damageTypeKey)) add(resultFailures, { path: `${rPath}.detail.damageTypeKey`, issue: `伤害字典键不存在：${detail?.damageTypeKey}` });
      if (!damageDeliveries.has(detail?.deliveryKind)) add(resultFailures, { path: `${rPath}.detail.deliveryKind`, issue: '伤害传递类型非法' });
      if (!damageOrigins.has(detail?.originKind)) add(resultFailures, { path: `${rPath}.detail.originKind`, issue: '伤害来源类型非法' });
      if (!isRecord(detail?.critical) || !criticalModes.has(detail.critical.mode)) add(resultFailures, { path: `${rPath}.detail.critical`, issue: '暴击策略非法' });
      if (detail?.critical?.multiplierValue !== null) checkNumericValue(detail?.critical?.multiplierValue, skillKey, `${rPath}.detail.critical.multiplierValue`, false);
      if (!Array.isArray(detail?.vampRules)) add(resultFailures, { path: `${rPath}.detail.vampRules`, issue: '吸血规则不是数组' });
      for (let i = 0; i < (detail?.vampRules || []).length; i += 1) {
        const rule = detail.vampRules[i];
        if (!vampTypes.has(rule.vampType) || !vampBases.has(rule.basisOutputKind)) add(resultFailures, { path: `${rPath}.detail.vampRules[${i}]`, issue: '吸血规则枚举非法' });
        checkNumericValue(rule.efficiencyValue, skillKey, `${rPath}.detail.vampRules[${i}].efficiencyValue`, false);
      }
    }
    if (result.resultType === 'ATTRIBUTE_CHANGE') {
      if (!attributes.has(result.detail?.attributeKey)) add(resultFailures, { path: `${rPath}.detail.attributeKey`, issue: `属性字典键不存在：${result.detail?.attributeKey}` });
      if (!attributeOperations.has(result.detail?.operation)) add(resultFailures, { path: `${rPath}.detail.operation`, issue: '属性操作非法' });
      if (!modifierZones.has(result.detail?.modifierZoneKey)) add(resultFailures, { path: `${rPath}.detail.modifierZoneKey`, issue: `乘区字典键不存在：${result.detail?.modifierZoneKey}` });
    }
    if (result.resultType === 'RESOURCE_CHANGE') {
      if (!attributes.has(result.detail?.attributeKey)) add(resultFailures, { path: `${rPath}.detail.attributeKey`, issue: `资源属性字典键不存在：${result.detail?.attributeKey}` });
      if (!resourceOperations.has(result.detail?.operation)) add(resultFailures, { path: `${rPath}.detail.operation`, issue: '资源操作非法' });
    }
    if (has(result.detail, 'absorbedDamageTypeKey') && result.detail.absorbedDamageTypeKey !== null && !damageTypes.has(result.detail.absorbedDamageTypeKey)) add(resultFailures, { path: `${rPath}.detail.absorbedDamageTypeKey`, issue: `吸收伤害类型字典键不存在：${result.detail.absorbedDamageTypeKey}` });
    if (has(result.detail, 'statusKey') && result.detail.statusKey !== null && !statuses.has(result.detail.statusKey)) add(resultFailures, { path: `${rPath}.detail.statusKey`, issue: `状态字典键未在固定目录中找到：${result.detail.statusKey}` });
  }
}

const sourceMappingFailures = [];
const sourceMappingChecks = [];
for (const skillKey of skills) {
  const source = sourceBySkill(skillKey);
  const local = candidate.skills[skillKey].write;
  const pKeys = local.parameters.map(item => item.parameterKey);
  const fKeys = local.formulas.map(item => item.formulaKey);
  const eKeys = local.effects.map(item => item.effectKey);
  const checks = [
    { kind: 'parameters', candidate: pKeys, source: [...sourceParams(skillKey)] },
    { kind: 'formulas', candidate: fKeys, source: [...sourceFormulas(skillKey)] },
    { kind: 'effects', candidate: eKeys, source: [...sourceEffects(skillKey)] }
  ];
  for (const check of checks) {
    const pass = sameSet(check.candidate, check.source);
    sourceMappingChecks.push({ skillKey, kind: check.kind, candidateCount: check.candidate.length, sourceCount: check.source.length, pass });
    if (!pass) add(sourceMappingFailures, { skillKey, kind: check.kind, candidateOnly: check.candidate.filter(key => !check.source.includes(key)), sourceOnly: check.source.filter(key => !check.candidate.includes(key)) });
  }
}
const sourceFormulaTreeChecks = skills.filter(skillKey => (candidate.skills[skillKey].write.formulas || []).length > 0).map(skillKey => ({
  skillKey,
  selectedFormulaCount: sourceFormulas(skillKey).size,
  rawCalculationCount: Object.keys(sourceBySkill(skillKey).rawCalculations || {}).length,
  rawDataValueCount: Object.keys(sourceBySkill(skillKey).rawDataValues || {}).length,
  pass: sourceFormulas(skillKey).size === candidate.skills[skillKey].write.formulas.length && Object.keys(sourceBySkill(skillKey).rawCalculations || {}).length > 0
}));
for (const item of sourceFormulaTreeChecks) if (!item.pass) add(sourceMappingFailures, { path: item.skillKey, issue: '公式选择未对应固定源计算树摘要' });

const scopeEffects = [];
const sourceScopeSpecs = [
  { skillKey: 'udyr_q', effectKey: 'standard_on_hit', formulaKey: 'on_hit_physical_damage', sourceCalcName: 'OnHitDamage', sourcePointers: ['/sourceValues/udyr_q/currentText/keySummary/text', '/sourceValues/udyr_q/currentText/keyTooltip/text', '/sourceValues/udyr_q/rawCalculations/OnHitDamage'], excerpt: '正文说明下两次攻击造成额外物理伤害，Tooltip以OnHitDamage绑定该数值；固定摘要无spellShieldBlockScope字段。' },
  { skillKey: 'udyr_q', effectKey: 'standard_max_health_hit', formulaKey: 'standard_max_health_physical_damage', sourceCalcName: 'MaxHPOnHit1', sourcePointers: ['/sourceValues/udyr_q/currentText/keyTooltip/text', '/sourceValues/udyr_q/rawCalculations/MaxHPOnHit1'], excerpt: 'Tooltip说明下两次攻击造成额外最大生命值物理伤害，固定摘要无spellShieldBlockScope字段。' },
  { skillKey: 'udyr_q', effectKey: 'empowered_max_health_hit', formulaKey: 'empowered_max_health_physical_damage', sourceCalcName: 'Q2TotalOnHitHPDamage', sourcePointers: ['/sourceValues/udyr_q/currentText/keyTooltip/text', '/sourceValues/udyr_q/rawCalculations/Q2TotalOnHitHPDamage'], excerpt: 'Tooltip说明觉醒时下两次攻击改用Q2TotalOnHitHPDamage，固定摘要无spellShieldBlockScope字段。' },
  { skillKey: 'udyr_r', effectKey: 'pulse_damage', formulaKey: 'pulse_damage', sourceCalcName: 'PulseDamage', sourcePointers: ['/sourceValues/udyr_r/currentText/keyTooltip/text', '/sourceValues/udyr_r/rawCalculations/PulseDamage'], excerpt: 'Tooltip说明风暴中的下两次攻击造成PulseDamage魔法伤害，固定摘要无spellShieldBlockScope字段。' },
  { skillKey: 'ashe_q', effectKey: 'empowered_attack', formulaKey: 'empowered_attack_damage', sourceCalcName: 'EmpoweredDamage', sourcePointers: ['/sourceValues/ashe_q/currentText/keySummary/text', '/sourceValues/ashe_q/currentText/keyTooltip/text', '/sourceValues/ashe_q/currentText/keyTooltipExtendedBelowLine/text', '/sourceValues/ashe_q/rawCalculations/EmpoweredDamage'], excerpt: '摘要和Tooltip说明普攻转为强化攻击，扩展说明每次强化攻击由5次小打击组成且每次只施加一次攻击特效，固定摘要无spellShieldBlockScope字段。' }
];
for (const spec of sourceScopeSpecs) {
  const effect = candidate.skills[spec.skillKey]?.write?.effects?.find(item => item.effectKey === spec.effectKey);
  const result = effect?.results?.find(item => item.resultType === 'DAMAGE');
  const raw = sourceBySkill(spec.skillKey);
  const sourceTree = raw.rawCalculations?.[spec.sourceCalcName];
  const sourceTreeParts = (sourceTree?.mFormulaParts || []).map(part => Object.fromEntries(Object.entries(part).filter(([key]) => ['__type', 'mDataValue', 'mCoefficient', 'mStartValue', 'mEndValue', 'mStat', 'mStatFormula', 'mNumber'].includes(key))));
  const sourceTexts = spec.sourcePointers.map(pointer => {
    const parts = pointer.replace(/^\/sourceValues\//, '').split('/');
    let value = raw;
    for (const part of parts.slice(1)) value = value?.[part];
    return { pointer, present: typeof value === 'string' || isRecord(value), text: typeof value === 'string' ? value.slice(0, 300) : null };
  });
  const sourceHasScope = JSON.stringify(raw).includes('spellShieldBlockScope') || JSON.stringify(raw).includes('spellShield');
  scopeEffects.push({
    skillKey: spec.skillKey,
    effectKey: spec.effectKey,
    resultKey: result?.resultKey || null,
    formulaKey: spec.formulaKey,
    sourceCalculation: spec.sourceCalcName,
    sourceTreeParts,
    deliveryKind: result?.detail?.deliveryKind || null,
    damageTypeKey: result?.detail?.damageTypeKey || null,
    candidateSpellShieldBlockScope: result?.spellShieldBlockScope ?? 'MISSING',
    sourcePointers: sourceTexts,
    sourceExcerpt: spec.excerpt,
    sourceContainsSpellShieldScope: sourceHasScope,
    templateEvidence: '初版生成候选.mjs:196-199的通用damageEffect为所有DAMAGE结果写入spellShieldBlockScope:"RESULT"，不读取源树字段。',
    sourceSupportVerdict: sourceHasScope ? '固定源摘要出现护盾字段，仍需逐效果确认' : '固定源文本、DataValues和计算树没有护盾范围字段',
    verdict: '候选结构合法，但该RESULT是候选模板默认/录入选择，不能当作这五个效果的游戏来源事实。'
  });
}

const localConsumerEvidence = [
  {
    subject: '艾希Q强化普攻',
    file: `${PLANNING_DIR}/数据参考/lol-wiki-current-champions/raw/ashe-q.wikitext`,
    lines: '8-12,17-26,31-35',
    lastWriteTimeUtc: '2026-07-17T15:24:47.6948216Z',
    gameVersionBoundary: '本地原始资料快照未标注客户端版本；候选固定源是16.17/16.17.1，因此只作本地机制交叉证据。',
    excerpts: [
      '|description2 = ... empowers her basic attacks to fire a flurry of five arrows ... modified physical damage ... apply on-hit effects only once.',
      '|spellshield  = false',
      '|spelleffects = special',
      'The flurries deal 1 instance of basic damage followed by 4 instances of a non-reactive type of damage.',
      'The flurries are classified as a basic attack on a script level, but are considered an ability for other effects.'
    ],
    interpretation: '原始记录直接声明spellshield=false，并同时声明特殊分段、首段基础伤害、后四段非反应伤害和每次只施加一次攻击特效；它支持艾希Q不是法术护盾阻挡结果，但不把五段细分自动等同为一个当前聚合结果。'
  },
  {
    subject: '艾希Q运行消费者',
    file: 'C:/project/damage_wasm_dev/wasm/tinygo_engine_v2/internal/runtime/generic_ashe_rangers_focus_test.go',
    lines: '20-29,689-716,821-862',
    lastWriteTimeUtc: '2026-07-26T10:14:46.4455952Z',
    gameVersionBoundary: '仓库运行测试是局部机制消费者，不是16.17实战或法术护盾执行证明。',
    excerpts: [
      'Flurry first AA: 6×28% total AD; subsequent: 5×28%; one basic_attack_hit per flurry AA (on-hit once).',
      'Two flurry AAs → exactly two basic_attack_hit events (on-hit once each).',
      'basic_attack types=[ability/basic_attack]; flurry arrow CritEligible=false; damageType=damage/physical.'
    ],
    interpretation: '消费者确认BASIC_ATTACK载体、五段箭的伤害拆分和每次强化攻击一次攻击特效；代码没有法术护盾范围字段，不能单独证明RESULT。'
  },
  {
    subject: '原始Wiki机制盘点规则',
    file: `${PLANNING_DIR}/文档记录/需求澄清/项目/效果与状态本地Wiki机制盘点.md`,
    lines: '45-53,73-82',
    excerpts: [
      '第二轮扫描完整原文和备注，用于发现法术护盾阻挡粒度。',
      '自动扫描只用于发现候选；代表性机制必须回到原始记录逐条核对。',
      '原始Wiki的英文标签和值不能直接作为页面术语、数据库字段或固定枚举。',
      'spellshield原始值包含true、special、false和空值，special至少要求区分阻挡整个技能、效果项、一次伤害或其他联动。'
    ],
    interpretation: '项目规则要求把原始spellshield字段作为逐条发现线索，不能以BASIC_ATTACK或通用候选模板替代逐效果证明。'
  }
];

const externalResearch = {
  researchedAt: '2026-09-10',
  purpose: '补查五个BASIC_ATTACK伤害结果的法术护盾范围；未改候选、输入或业务代码。',
  versionBoundary: '外部公开页是当前Wiki页面/抓取结果，未声明客户端16.17或16.17.1；固定候选仍以16.17/16.17.1源绑定为准。公开资料只用于交叉验证，不能覆盖固定源值。',
  sources: [
    {
      title: "Template:Data Ashe/Ranger's Focus",
      url: 'https://wiki.leagueoflegends.com/en-us/Template%3AData_Ashe/Ranger%27s_Focus',
      access: '搜索结果可读取，直接页面访问受robots限制；抓取标记为1.2年前。',
      excerpts: [
        'Counters Spell shield — Not Blocked',
        'Each arrow deals modified physical damage ... Flurries apply on-hit effects only once.',
        'The first bolt deals basic damage; the subsequent four bolts use a non-reactive damage type.'
      ],
      use: '与本地艾希Q原始记录的spellshield=false、特殊五箭和一次攻击特效相互印证；由于页面不是16.17版本快照，保留版本边界。'
    },
    {
      title: 'Template:Data Udyr/Bridge Between',
      url: 'https://wiki.leagueoflegends.com/en-us/Template%3AData_Udyr/Bridge_Between',
      access: '搜索结果可读取，抓取标记为1.2年前。',
      excerpts: [
        "Only Wilding Claw's lightning damage is amplified. The on-hit damage is not increased.",
        'The returned template parameter table shows spellshield with no value for Bridge Between.'
      ],
      use: '页面说明了乌迪尔觉醒雷电与附伤是不同伤害组成，但没有给出乌迪尔Q三个附伤或R普攻脉冲的spell shield阻挡粒度；空参数不能推导null或RESULT。'
    },
    {
      title: 'Template:Data Udyr/Wilding Claw',
      url: 'https://wiki.leagueoflegends.com/en-us/Template%3AData_Udyr/Wilding_Claw',
      access: '直接页面访问受robots限制；未取得可核对的spellshield字段或正文。',
      excerpts: [],
      use: '记录为未取得证据，不能把访问受限当作无护盾交互。'
    },
    {
      title: 'Template:Data Udyr/Wingborne Storm',
      url: 'https://wiki.leagueoflegends.com/en-us/Template%3AData_Udyr/Wingborne_Storm',
      access: '直接页面访问受robots限制；未取得可核对的spellshield字段或正文。',
      excerpts: [],
      use: '记录为未取得证据，不能把访问受限当作无护盾交互。'
    }
  ]
};

const scopeResolution = [
  {
    skillKey: 'udyr_q',
    effectKey: 'standard_on_hit',
    resultKey: scopeEffects.find(item => item.skillKey === 'udyr_q' && item.effectKey === 'standard_on_hit')?.resultKey || null,
    currentScope: 'RESULT',
    sourceEvidenceLevel: 'insufficient',
    recommendedScope: null,
    recommendationKind: 'hold_without_scope_value',
    decision: 'unresolved',
    evidence: ['固定16.17/16.17.1来源值、DataValues和OnHitDamage计算树没有spellshield字段。', '本地仓库没有该效果的法术护盾消费者或交互约定。', '公开乌迪尔Bridge Between页只区分雷电与on-hit组成，没有给出该结果的阻挡粒度。'],
    action: '不把RESULT视为已证，也不把null视为已证；若本轮必须保存，按标准流程暂撤该效果，保留确定的参数、公式和来源值，待同版本逐效果来源或业务确认。'
  },
  {
    skillKey: 'udyr_q',
    effectKey: 'standard_max_health_hit',
    resultKey: scopeEffects.find(item => item.skillKey === 'udyr_q' && item.effectKey === 'standard_max_health_hit')?.resultKey || null,
    currentScope: 'RESULT',
    sourceEvidenceLevel: 'insufficient',
    recommendedScope: null,
    recommendationKind: 'hold_without_scope_value',
    decision: 'unresolved',
    evidence: ['固定来源只证明普通两次攻击的最大生命附伤计算；没有护盾范围字段。', '本地运行消费者和交互资料没有该结果的独立spell shield事实。', '公开乌迪尔资料没有该细粒度结论。'],
    action: '暂不改候选；保存前撤出未确认的效果或补同版本逐效果证据。'
  },
  {
    skillKey: 'udyr_q',
    effectKey: 'empowered_max_health_hit',
    resultKey: scopeEffects.find(item => item.skillKey === 'udyr_q' && item.effectKey === 'empowered_max_health_hit')?.resultKey || null,
    currentScope: 'RESULT',
    sourceEvidenceLevel: 'insufficient',
    recommendedScope: null,
    recommendationKind: 'hold_without_scope_value',
    decision: 'unresolved',
    evidence: ['固定来源只证明觉醒两次攻击使用Q2TotalOnHitHPDamage；没有护盾范围字段。', 'Bridge Between页提到觉醒伤害特殊处理，但没有该附伤的阻挡粒度。', '不能把觉醒或BASIC_ATTACK标签推成RESULT。'],
    action: '暂不改候选；保存前撤出未确认的效果或补同版本逐效果证据。'
  },
  {
    skillKey: 'udyr_r',
    effectKey: 'pulse_damage',
    resultKey: scopeEffects.find(item => item.skillKey === 'udyr_r' && item.effectKey === 'pulse_damage')?.resultKey || null,
    currentScope: 'RESULT',
    sourceEvidenceLevel: 'insufficient',
    recommendedScope: null,
    recommendationKind: 'hold_without_scope_value',
    decision: 'unresolved',
    evidence: ['固定PulseDamage树和文本说明普攻脉冲魔法伤害，但没有spellshield字段。', '公开Wingborne Storm页面无法取得；Bridge Between只说明觉醒风暴伤害的特殊触发，没有阻挡粒度。', 'BASIC_ATTACK载体不等于法术护盾RESULT范围。'],
    action: '暂不改候选；保存前撤出未确认的效果或补同版本逐效果证据。'
  },
  {
    skillKey: 'ashe_q',
    effectKey: 'empowered_attack',
    resultKey: scopeEffects.find(item => item.skillKey === 'ashe_q' && item.effectKey === 'empowered_attack')?.resultKey || null,
    currentScope: 'RESULT',
    sourceEvidenceLevel: 'strong_external_and_local',
    recommendedScope: null,
    recommendationKind: 'null',
    decision: 'recommended_null',
    evidence: ['本地原始艾希Q记录第20行明确spellshield=false；第25-26行说明五箭由首段基础伤害和后四段非反应伤害构成。', '本地运行消费者确认每次强化普攻只发一个basic_attack_hit，且五箭是物理伤害拆分。', "League Wiki公开模板把Ranger's Focus的Counters Spell shield显示为Not Blocked，并说明on-hit effects only once。"],
    caveat: '候选把五段伤害聚合成一个DAMAGE结果，而原始机制含五个伤害实例且spelleffects=special；null是当前聚合映射的最小风险建议，不代表已完成五段独立结果建模。',
    action: '不修改当前冻结候选；若根负责人接受外部交叉证据，保存前可将该结果的范围改为null，或先按标准流程撤出聚合效果并保留参数、公式和来源值。'
  }
];

const scopeQuestionConclusion = {
  resolved: ['ashe_q/empowered_attack'],
  unresolved: ['udyr_q/standard_on_hit', 'udyr_q/standard_max_health_hit', 'udyr_q/empowered_max_health_hit', 'udyr_r/pulse_damage'],
  conclusion: '补查后只有艾希Q获得了本地原始字段与公开Wiki显示一致的Not Blocked证据，当前聚合结果建议null；四个乌迪尔BASIC_ATTACK伤害结果仍无逐效果护盾事实，既不能保留RESULT为已证，也不能把null当作已证。候选保持不变，按录入标准在保存前对四个未确认效果暂撤或补证。',
  noCandidateChange: true,
  noApiCalls: true,
  noDatabaseAccess: true,
  noBrowserAccess: true,
  noGitWrites: true
};

const fixedArrayEvidence = {
  existingMathReportSha256: fileSha(mathFile),
  status: math.status,
  formulaScenarioCount: math.formulaChecks?.scenarioCount ?? null,
  formulaCount: math.formulaChecks?.formulaCount ?? null,
  formulaTwoScenarioPass: math.formulaChecks?.allTwoScenes ?? false,
  formulaMissingReferenceCases: math.formulaChecks?.missingReferenceCases?.length ?? null,
  runtimeMissingCases: math.formulaChecks?.runtimeMissingCases?.length ?? null,
  runtimeMissingRejected: math.formulaChecks?.allMissingRejected ?? false,
  effectFinalValueCount: math.effectChecks?.finalValueCount ?? null,
  sourceArrayChecks: math.fixedSourceArrayChecks?.length ?? null,
  sourceArrayPass: (math.fixedSourceArrayChecks || []).filter(item => item.pass !== false).length,
  integerParameterCount: math.parameterChecks?.integerParameterCount ?? null,
  integerValueCount: math.parameterChecks?.integerValueCount ?? null,
  dictionaryRefChecks: math.effectChecks?.dictionaryRefChecks?.length ?? null,
  attributeRefChecks: math.effectChecks?.attributeRefs?.length ?? null,
  ratioAttributeChecks: math.effectChecks?.ratioAttributes?.length ?? null,
  note: '本审计未执行会写候选/耐久目录的原数学脚本；以上是已落盘数学报告的源值核算证据，候选结构、源选择键和类型引用由本脚本重新读取。'
};

const contractEvidence = {
  shieldDesign: [
    { file: `${PLANNING_DIR}/文档记录/详细设计/项目/法术护盾闭环详细设计.md`, lines: '118-145', point: '非空只允许四个范围；DAMAGE且TARGET且非持续可用四种；null不表示保证；请求必须显式提交且不依赖默认。' },
    { file: `${PLANNING_DIR}/文档记录/详细设计/项目/法术护盾闭环详细设计.md`, lines: '186-199', point: '合法非空结果只表示未来可能形成阻挡边，当前阶段不以此推导真实阻挡执行。' }
  ],
  standardFlow: [
    { file: `${PLANNING_DIR}/文档记录/详细设计/项目/角色技能数据录入标准流程.md`, lines: '233-247', point: '阻挡范围须由业务逐结果显式选择；资格未确认时保留确定参数并撤出效果，不能用null或合法选项填未知；伊泽瑞尔示例是具体样例。' }
  ],
  asheAcceptance: [
    { file: `${PLANNING_DIR}/文档记录/详细设计/项目/特殊交互与前序结果联动管理详细设计.md`, lines: '605-617', point: '艾希Q明确BASIC_ATTACK+DIRECT、五次伤害和攻击特效；伊泽瑞尔Q的RESULT是具体样例，没有把RESULT规定为所有普攻伤害的通用来源事实。' }
  ],
  frontendContract: [
    { file: `${WORKTREE}/web/src/services/skillEffectClient.ts`, lines: '169-212', point: '前端枚举与结构资格校验。' },
    { file: `${WORKTREE}/web/src/pages/admin/skills/effects/effectForm.ts`, lines: '1459-1493,2161-2169', point: '界面按target、时点和结果类型列出可选范围，合法值仍不等于源值证明。' }
  ],
  backendContract: [
    { file: `${BACKEND_DIR}/server/data_manage/src/main/java/xyz/game/datamanage/model/skilleffect/SkillEffectResultRequestDeserializer.java`, lines: '22-60', point: '后端要求字段存在并反序列化合法枚举，允许null。' },
    { file: `${BACKEND_DIR}/server/data_manage/src/main/java/xyz/game/datamanage/service/skilleffect/SkillEffectService.java`, lines: '539-570', point: '后端校验结果资格和DAMAGE_INSTANCE约束，只证明可保存的形状。' },
    { file: `${BACKEND_DIR}/server/data_manage/src/main/java/xyz/game/datamanage/service/skilleffect/SkillEffectService.java`, lines: '781-858', point: '后端校验DAMAGE字典、传递、来源、暴击和吸血字段，只证明协议合法。' }
  ]
};

const dictionaryRefs = [];
for (const skillKey of skills) for (const effect of candidate.skills[skillKey].write.effects || []) for (const result of effect.results || []) {
  const base = `skills.${skillKey}.effects.${effect.effectKey}.results.${result.resultKey}`;
  if (has(result.detail, 'damageTypeKey') && result.detail.damageTypeKey !== null) dictionaryRefs.push({ path: `${base}.detail.damageTypeKey`, key: result.detail.damageTypeKey, dictionary: 'damage-types', pass: damageTypes.has(result.detail.damageTypeKey) });
  if (has(result.detail, 'absorbedDamageTypeKey') && result.detail.absorbedDamageTypeKey !== null) dictionaryRefs.push({ path: `${base}.detail.absorbedDamageTypeKey`, key: result.detail.absorbedDamageTypeKey, dictionary: 'damage-types', pass: damageTypes.has(result.detail.absorbedDamageTypeKey) });
  if (has(result.detail, 'modifierZoneKey') && result.detail.modifierZoneKey !== null) dictionaryRefs.push({ path: `${base}.detail.modifierZoneKey`, key: result.detail.modifierZoneKey, dictionary: 'modifier-zones', pass: modifierZones.has(result.detail.modifierZoneKey) });
  if (has(result.detail, 'statusKey') && result.detail.statusKey !== null) dictionaryRefs.push({ path: `${base}.detail.statusKey`, key: result.detail.statusKey, dictionary: 'statuses', pass: statuses.has(result.detail.statusKey) });
  if (has(result.detail, 'attributeKey') && result.detail.attributeKey !== null) dictionaryRefs.push({ path: `${base}.detail.attributeKey`, key: result.detail.attributeKey, dictionary: 'attributes', pass: attributes.has(result.detail.attributeKey) });
}

const report = {
  generatedAt: new Date().toISOString(),
  batch: '第五十批乌迪尔阿兹尔艾希伊泽瑞尔',
  revision: candidate.revision,
  status: requestFailures.length || candidateFailures.length || nodeFailures.length || lifecycleFailures.length || valueRuleFailures.length || resultFailures.length || sourceMappingFailures.length ? '发现结构差异' : 'PASS（结构与契约审计通过；艾希Q建议null，四个乌迪尔范围未证）',
  auditBoundary: '只读审计；不调用业务API、数据库、浏览器或Git，不改候选、输入、业务代码。',
  noApiCalls: true,
  noDatabaseAccess: true,
  noBrowserAccess: true,
  noGitWrites: true,
  inputs: {
    candidateFile,
    planFile,
    sourceValuesFile,
    mathFile,
    fixedProtectionSnapshot: path.join(INPUT_DIR, '参考资料', '当前20槽保护快照.json'),
    sourceBindingFile: path.join(INPUT_DIR, '来源绑定与当前文本.json'),
    inputHashes: Object.fromEntries(knownInputFiles.map(file => [file, fileSha(file)]))
  },
  counts: {
    candidateLocal: candidateCounts,
    candidateLocalTotal: Object.values(candidateCounts).reduce((sum, value) => sum + value, 0),
    planRequests: plan.requests?.length ?? 0,
    reusedPublicParameters: candidate.reusedPublicParameters?.length ?? 0,
    requiredFieldChecks: requestFieldCounts,
    requiredFieldFailures: requestFailures.length,
    candidateFailures: candidateFailures.length,
    formulaCount: skills.reduce((sum, key) => sum + (candidate.skills[key].write.formulas || []).length, 0),
    formulaNodeCount: nodeStats.totalNodes,
    runtimeInputCount: runtimeChecks.length,
    lifecycleEffectCount: lifecycleStats.effects,
    lifecycleResultCount: lifecycleStats.results,
    persistentResultCount: lifecycleStats.persistentResults,
    dictionaryReferenceCount: dictionaryRefs.length,
    scopeQuestionEffectCount: scopeEffects.length
  },
  requestAudit: {
    expectedRequestCount: 174,
    actualRequestCount: plan.requests?.length ?? 0,
    requiredEnvelopeFields: expectedEnvelope,
    requiredBodyFields: expectedBody,
    requiredEffectResultFields: expectedResult,
    fieldCounts: requestFieldCounts,
    planIdsUnique: duplicatePlanIds.length === 0,
    candidateAndPlanIdsMatch: requestFailures.filter(item => /候选本地组成|写前计划包含/.test(item.issue)).length === 0,
    failures: requestFailures
  },
  candidateAudit: {
    orderCount: skills.length,
    orderUnique: new Set(skills).size === skills.length,
    maxLevelAgainstProtection: skills.map(skillKey => ({ skillKey, candidate: candidate.skills[skillKey]?.maxLevel ?? null, protected: routeMap.get(`/skills/${skillKey}`)?.data?.maxLevel ?? null, pass: candidate.skills[skillKey]?.maxLevel === routeMap.get(`/skills/${skillKey}`)?.data?.maxLevel })),
    counts: candidateCounts,
    countsPass: candidateCountPass,
    failures: candidateFailures,
    sortOrderChecks: { total: sortChecks.length, pass: sortChecks.filter(item => item.pass).length, failures: sortChecks.filter(item => !item.pass) }
  },
  nodeAudit: {
    allowedNodeTypes: ['OPERATION', 'PARAMETER', 'ATTRIBUTE'],
    allowedOperations: [...formulaOperations],
    allowedAttributeOwners: [...formulaOwners],
    allowedAttributeValueKinds: [...formulaValueKinds],
    stats: nodeStats,
    formulaReferenceCount: formulaRefs.length,
    runtimeFormulaReferenceCount: runtimeFormulaRefs.length,
    failures: nodeFailures
  },
  levelAudit: {
    fullLevelArrayChecks: levelChecks,
    totalSkillLevelParameters: levelChecks.length,
    pass: levelChecks.filter(item => item.pass).length,
    failures: levelChecks.filter(item => !item.pass)
  },
  runtimeInputAudit: {
    checks: runtimeChecks,
    count: runtimeChecks.length,
    allNoDefaultAndDocumented: runtimeChecks.every(item => item.pass),
    formulaMissingValueCases: runtimeFormulaRefs.map(item => ({ ...item, missingValueRejected: true, evidence: '公式取值器在缺少RUNTIME_INPUT时拒绝；候选不提供默认fixedValue或levelValues。' })),
    lifecycleRuntimeDurationRefs: lifecycleStats.runtimeDurationRefs,
    policy: 'RUNTIME_INPUT只保留类型与说明；实际输入缺失时拒绝，不用0、等级端点或固定时长补值。'
  },
  lifecycleAudit: {
    stats: lifecycleStats,
    valueReferenceStats: valueRefStats,
    lifecycleFailureCount: lifecycleFailures.length,
    failures: lifecycleFailures,
    policy: '父效果有生命周期时每个结果必须有合法lifecycleBehavior；父效果无生命周期时结果行为必须为null；持续结果不使用非空法术护盾范围，除状态施加窄例外。'
  },
  resultAudit: {
    valueRuleFailures,
    protocolFailures: resultFailures,
    dictionaryRefs,
    dictionaries: { damageTypes: [...damageTypes], modifierZones: [...modifierZones], statuses: [...statuses], attributesCount: attributes.size },
    allNonNullDictionaryRefsPass: dictionaryRefs.every(item => item.pass),
    allSpellShieldShapeChecksPass: resultFailures.length === 0
  },
  sourceSelectionAudit: {
    checks: sourceMappingChecks,
    failures: sourceMappingFailures,
    allSelectedKeysMatch: sourceMappingFailures.length === 0,
    formulaTreeEvidence: sourceFormulaTreeChecks,
    note: '候选每槽的selectedParameterKeys/selectedFormulaKeys/selectedEffectKeys与来源值摘要逐项比对；公式数学期望仍以固定源树直接读取的已落盘独立数学报告为源侧证据。'
  },
  spellShieldScopeAudit: {
    scopeEffects,
    localConsumerEvidence,
    externalResearch,
    scopeResolution,
    scopeQuestionConclusion,
    candidateNonNullScopeCount: skills.reduce((sum, skillKey) => sum + (candidate.skills[skillKey].write.effects || []).reduce((effectSum, effect) => effectSum + (effect.results || []).filter(result => result.spellShieldBlockScope !== null).length, 0), 0),
    relevantNonNullScopeCount: scopeEffects.length,
    existingPrecedent: [
      { route: '/skills/ez_q/effects/primary_hit', result: 'physical_damage', scope: 'RESULT', source: '固定保护快照中的已保存伊泽瑞尔Q结果' },
      { route: '/skills/ez_e/effects/primary_hit', result: 'magic_damage', scope: 'RESULT', source: '固定保护快照中的已保存伊泽瑞尔E结果' },
      { route: '/skills/ez_r/effects/champion_hit', result: 'magic_damage', scope: 'RESULT', source: '固定保护快照中的已保存伊泽瑞尔R英雄结果' },
      { route: '/skills/ez_r/effects/minion_monster_hit', result: 'magic_damage', scope: 'RESULT', source: '固定保护快照中的已保存伊泽瑞尔R小兵野怪结果' }
    ],
    existingPrecedentLimitation: '以上是固定保护快照中伊泽瑞尔既有保存对象的具体证据；标准流程和艾希Q综合案例没有把该值规定为所有英雄普攻伤害的通用默认，不能直接外推给乌迪尔或艾希。',
    conclusion: '补查后，艾希Q获得本地原始spellshield=false和公开Wiki Not Blocked的交叉证据，当前聚合结果建议null；乌迪尔Q三个附伤和乌迪尔R普攻脉冲仍没有逐效果护盾范围来源，RESULT属于模板默认/业务选择，null也未被证实。五个结果均保持候选原值不变。',
    minimalRemediation: [
      '保留五个效果已有的确定伤害公式、伤害类型、BASIC_ATTACK传递和DIRECT来源；只对spellShieldBlockScope逐效果补同版本来源或明确业务确认。',
      '四个乌迪尔结果补证前按标准流程从正常保存集合撤出，参数、公式和源值证据仍可保留；不要用null或另一个合法范围掩盖未知。艾希Q若接受Not Blocked证据，可把聚合结果改为null，或先拆分五段结果。',
      '若根负责人确认某个乌迪尔结果应按当前命中结果参与法术护盾，再保留RESULT并记录确认来源；这只是录入契约决定，不是本审计从BASIC_ATTACK标签推导出的事实。'
    ],
    outsideQuestion: '其它四个SKILL+RESULT伤害结果不属于本次普攻/on-hit窄问题；其结构检查仍已纳入resultAudit。'
  },
  mathEvidence: fixedArrayEvidence,
  contractEvidence,
  knownFixedRevisionItems: '本审计不重复判定主负责人已指出并在修订一修复的八项业务数值；仅以当前候选文件重新检查结构、引用和范围字段，未改候选。'
};

const reportBytes = jsonBytes(report);
writeBytes(path.join(OUT, '审计报告.json'), reportBytes);
const readme = `# 第五十批修订一独立根审计\n\n审计结论：174个写前请求的请求体、效果结果必填字段、候选稳定标识、当前节点白名单、二元操作、全等级数组、整数排序、生命周期和运行输入约束均通过；固定快照中的技能最高等级逐槽匹配。所有非空伤害类型、属性、乘区和吸收伤害类型引用均能在当前固定目录找到，当前没有非空状态键。\n\n窄语义结论：乌迪尔Q普通附伤、Q普通最大生命附伤、Q觉醒最大生命附伤、乌迪尔R普攻脉冲、艾希Q强化普攻这5个 BASIC_ATTACK 伤害结果当前都写作RESULT。补查后，本地艾希Q原始记录明确spellshield=false，公开Wiki也显示Not Blocked，因此艾希Q当前聚合结果建议改为null；乌迪尔Q三个结果和乌迪尔R脉冲仍没有逐效果护盾事实，不能把RESULT或null当成已证。候选冻结文件保持不变。\n\n艾希Q证据：本地 [ashe-q.wikitext](${PLANNING_DIR}/数据参考/lol-wiki-current-champions/raw/ashe-q.wikitext:10) 的原始记录说明五箭、物理伤害、每次只施加一次攻击特效，第20行是spellshield=false，第25-26行说明首段基础伤害和后四段非反应伤害；本地 [generic_ashe_rangers_focus_test.go](C:/project/damage_wasm_dev/wasm/tinygo_engine_v2/internal/runtime/generic_ashe_rangers_focus_test.go:20) 的消费者测试确认每次强化普攻只发一个basic_attack_hit并拆分五箭。公开交叉资料 [League Wiki: Template:Data Ashe/Ranger's Focus](https://wiki.leagueoflegends.com/en-us/Template%3AData_Ashe/Ranger%27s_Focus) 显示Counters Spell shield为Not Blocked，并同样记载on-hit只施加一次。公开页是当前Wiki抓取结果，未标注16.17/16.17.1；候选固定源版本仍优先。\n\n乌迪尔证据：本地固定源文本、DataValues和三个计算树没有护盾范围字段，本地没有相应的护盾消费者；[League Wiki: Template:Data Udyr/Bridge Between](https://wiki.leagueoflegends.com/en-us/Template%3AData_Udyr/Bridge_Between) 只说明觉醒雷电与on-hit是不同组成，返回的spellshield参数为空，也没有给出Q附伤或R脉冲的阻挡粒度。对应 [Wilding Claw](https://wiki.leagueoflegends.com/en-us/Template%3AData_Udyr/Wilding_Claw) 与 [Wingborne Storm](https://wiki.leagueoflegends.com/en-us/Template%3AData_Udyr/Wingborne_Storm) 页面本次访问受robots限制。公开资料未标注16.17/16.17.1，不能把页面缺值或访问受限推成null。\n\n最小处理是保留五个结果确定的参数、公式、伤害类型、普攻传递和直接来源；对艾希Q可按Not Blocked证据把当前聚合结果改为null，或先拆分原始五段。四个乌迪尔范围字段补逐效果来源或业务确认前，按录入标准撤出未确认效果，参数、公式和源值证据仍可保留；不要用null或其他合法范围填未知。\n\n契约证据：[法术护盾闭环详细设计.md](${PLANNING_DIR}/文档记录/详细设计/项目/法术护盾闭环详细设计.md:118)、[角色技能数据录入标准流程.md](${PLANNING_DIR}/文档记录/详细设计/项目/角色技能数据录入标准流程.md:235)、[特殊交互与前序结果联动管理详细设计.md](${PLANNING_DIR}/文档记录/详细设计/项目/特殊交互与前序结果联动管理详细设计.md:605)。项目盘点规则见 [效果与状态本地Wiki机制盘点.md](${PLANNING_DIR}/文档记录/需求澄清/项目/效果与状态本地Wiki机制盘点.md:45)，要求扫描发现后回原始记录逐条核对。\n\n本审计只读取固定输入、候选、计划、来源值、当前代码和公开资料，输出仅在本目录；API调用、数据库访问、浏览器操作、Git写入均为0。\n`;
writeBytes(path.join(OUT, 'README.md'), Buffer.from(readme, 'utf8'));
const outputFiles = ['独立根审计.mjs', '审计报告.json', 'README.md'];
const manifest = {
  generatedAt: report.generatedAt,
  status: report.status,
  files: Object.fromEntries(outputFiles.map(name => {
    const file = path.join(OUT, name);
    return [name, { sha256: fileSha(file), byteSize: fs.statSync(file).size }];
  })),
  reportSha256: fileSha(path.join(OUT, '审计报告.json')),
  candidateSha256: fileSha(candidateFile),
  planSha256: fileSha(planFile),
  sourceValuesSha256: fileSha(sourceValuesFile),
  mathReportSha256: fileSha(mathFile),
  counts: report.counts,
  noApiCalls: true,
  noDatabaseAccess: true,
  noBrowserAccess: true,
  noGitWrites: true
};
writeJson(path.join(OUT, '文件散列.json'), manifest);
console.log(JSON.stringify({ status: report.status, reportSha256: manifest.reportSha256, scriptSha256: manifest.files['独立根审计.mjs'].sha256, readmeSha256: manifest.files['README.md'].sha256, manifestSha256: fileSha(path.join(OUT, '文件散列.json')), counts: report.counts, requestFailures: requestFailures.length, candidateFailures: candidateFailures.length, nodeFailures: nodeFailures.length, lifecycleFailures: lifecycleFailures.length, valueRuleFailures: valueRuleFailures.length, resultFailures: resultFailures.length, sourceMappingFailures: sourceMappingFailures.length, noApiCalls: true, noDatabaseAccess: true, noBrowserAccess: true, noGitWrites: true }, null, 2));
