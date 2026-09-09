import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const batchDir = path.resolve(here, '..');
const apiRecordDir = path.resolve(batchDir, '..');
const mechanismDir = path.join(apiRecordDir, '符文机制盘点');
const equipmentRuneDir = path.resolve(batchDir, '../../装备符文');
const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const authorizationHeader = process.env.DV_API_AUTH_HEADER;
if (!authorizationHeader) throw new Error('未提供本地接口认证环境变量');
if (process.argv.slice(2).length !== 0) throw new Error('本脚本只允许无参数只读复核');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const requestFile = path.join(batchDir, '可审查请求.json');
const requestBytes = fs.readFileSync(requestFile);
const plan = JSON.parse(requestBytes);
const sourceCandidateFile = path.join(mechanismDir, '下一批最多12项.json');
const sourceFreezeFile = path.join(mechanismDir, '冻结来源.json');
const sourceCandidate = readJson(sourceCandidateFile);
const sourceFreeze = readJson(sourceFreezeFile);
const existingNumericFile = path.join(batchDir, '独立数值核对.json');
const existingVerifyFile = path.join(batchDir, 'verify-20260909013715944.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const requestSha256 = sha256(requestBytes);
const sourceCandidateSha256 = sha256(fs.readFileSync(sourceCandidateFile));
const sourceFreezeSha256 = sha256(fs.readFileSync(sourceFreezeFile));
const failures = [];
const warnings = [];
const requestEvidence = [];
const compositionEvidence = [];
const runeEvidence = [];
const imageEvidence = [];
const actualDetails = new Map();
const componentLists = new Map();
const apiLog = [];

const safe = value => {
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['imageBase64', 'authorization', 'cookie', 'token', 'apiKey'].includes(key))
      .map(([key, child]) => [key, safe(child)]));
  }
  return value;
};
const check = (label, condition, detail = undefined) => {
  if (!condition) failures.push({ label, detail: safe(detail) });
};
const note = (label, detail = undefined) => warnings.push({ label, detail: safe(detail) });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function keyOfBody(body) {
  return body?.parameterKey ?? body?.formulaKey ?? body?.effectKey ?? body?.processKey
    ?? body?.stateKey ?? body?.ruleKey ?? body?.skillKey ?? `${body?.runeKey ?? ''}:${body?.skillKey ?? ''}`;
}
function sameValue(actual, expected, at = '$', issues = []) {
  if (expected === null || typeof expected !== 'object') {
    if (!Object.is(actual, expected)) issues.push({ at, expected, actual });
    return issues;
  }
  if (actual === null || typeof actual !== 'object') {
    issues.push({ at, expectedType: Array.isArray(expected) ? 'array' : 'object', actual });
    return issues;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      issues.push({ at, expectedType: 'array', actualType: typeof actual });
      return issues;
    }
    if (actual.length !== expected.length) issues.push({ at: `${at}.length`, expected: expected.length, actual: actual.length });
    for (let i = 0; i < expected.length; i += 1) sameValue(actual[i], expected[i], `${at}[${i}]`, issues);
    return issues;
  }
  if (Array.isArray(actual)) {
    issues.push({ at, expectedType: 'object', actualType: 'array' });
    return issues;
  }
  for (const [key, expectedChild] of Object.entries(expected)) {
    if (!Object.prototype.hasOwnProperty.call(actual, key)) {
      issues.push({ at: `${at}.${key}`, issue: 'missing', expected: expectedChild });
      continue;
    }
    sameValue(actual[key], expectedChild, `${at}.${key}`, issues);
  }
  return issues;
}
function exactValue(actual, expected) {
  return sameValue(actual, expected).length === 0 && JSON.stringify(actual) === JSON.stringify(expected);
}
function directBody(response, kind) {
  if (kind !== 'relation') return response.data;
  if (!response.data || !Array.isArray(response.data.items) || response.data.items.length !== 1) return undefined;
  return response.data.items[0];
}
function allowedExtras(kind) {
  if (kind === 'relation') return ['gameId', 'runeName', 'skillName', 'skillStatus'];
  if (['skill', 'parameter', 'formula', 'effect'].includes(kind)) return ['gameId', 'createdAt', 'updatedAt', 'skillKey'];
  return ['gameId', 'createdAt', 'updatedAt'];
}
function nonExpectedKeys(actual, expected, kind) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return [];
  const allowed = new Set([...Object.keys(expected ?? {}), ...allowedExtras(kind)]);
  return Object.keys(actual).filter(key => !allowed.has(key));
}
function applyDocumentedCandidateCorrection(sourceBody, requestBody, p) {
  if (!sourceBody || p.id !== 8437) return sourceBody;
  const corrected = JSON.parse(JSON.stringify(sourceBody));
  if (p.kind === 'formula' && ['melee_damage', 'ranged_damage', 'melee_heal', 'ranged_heal'].includes(p.body.formulaKey)) corrected.name = requestBody.name;
  if (p.kind === 'effect' && ['melee_heal', 'ranged_heal'].includes(p.body.effectKey)) {
    corrected.name = requestBody.name;
    for (const result of corrected.results ?? []) if (result.resultKey === 'result') result.name = requestBody.name;
  }
  return corrected;
}
function candidateComponent(proposal, kind, body) {
  if (kind === 'skill') return proposal.skillBody;
  if (kind === 'parameter') return proposal.parameters?.find(item => item.parameterKey === body.parameterKey);
  if (kind === 'formula') return proposal.formulas?.find(item => item.formulaKey === body.formulaKey);
  if (kind === 'effect') return proposal.effects?.find(item => item.effectKey === body.effectKey);
  if (kind === 'rule') return proposal.triggerRules?.find(item => item.ruleKey === body.ruleKey);
  if (kind === 'relation') return proposal.relationBody;
  return undefined;
}
function requestIdentity(p) {
  return `${p.id}:${p.kind}:${keyOfBody(p.body)}`;
}
function findDetail(id, kind, key) {
  return actualDetails.get(`${id}:${kind}:${key}`);
}
function findPlanBody(id, kind, key) {
  const p = plan.requests.find(item => item.id === id && item.kind === kind && keyOfBody(item.body) === key);
  return p?.body;
}
function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  if (Array.isArray(node)) for (const child of node) walk(child, visitor);
  else for (const child of Object.values(node)) walk(child, visitor);
}
function allNodes(node, predicate) {
  const result = [];
  walk(node, value => { if (predicate(value)) result.push(value); });
  return result;
}
async function get(route, label = route) {
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(base + route, {
        method: 'GET',
        headers: { Authorization: authorizationHeader },
        signal: AbortSignal.timeout(30000),
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { nonJsonResponse: true }; }
      attempts.push({ attempt, status: response.status });
      apiLog.push({ label, route, attempt, status: response.status });
      if (response.status >= 500 && attempt === 1) {
        await delay(500);
        continue;
      }
      return { route, status: response.status, data, attempts };
    } catch (error) {
      attempts.push({ attempt, error: error?.name ?? 'Error' });
      apiLog.push({ label, route, attempt, error: error?.name ?? 'Error' });
      if (attempt === 1) {
        await delay(500);
        continue;
      }
      return { route, status: null, data: null, attempts };
    }
  }
  return { route, status: null, data: null, attempts };
}

check('请求文件 SHA256', requestSha256 === '45942778a468d2b1c9557ecd3c052ff9c54c514087b7659ae801c71b1d780095', requestSha256);
check('请求文件对象数量', plan.requests.length === 99, plan.requests.length);
check('请求文件主体数量', plan.scope.length === 12, plan.scope.length);
check('候选来源 SHA256', plan.sourceCandidateSha256 === sourceCandidateSha256, { expected: plan.sourceCandidateSha256, actual: sourceCandidateSha256 });
check('候选来源为已提交候选', sourceCandidateSha256 === 'a22d0f1cf63b51cc47fc128f532c596e608719c25710b41a0756cd637479b9f4', sourceCandidateSha256);

const scopeById = new Map(plan.scope.map(row => [row.id, row]));
const proposalById = new Map(sourceCandidate.proposals.map(row => [row.id, row]));
const expectedKinds = new Map();
for (const p of plan.requests) {
  const key = p.id;
  const kinds = expectedKinds.get(key) ?? [];
  kinds.push(p.kind);
  expectedKinds.set(key, kinds);
  const proposal = proposalById.get(p.id);
  check(`候选来源存在 ${p.id}`, Boolean(proposal), p.id);
  if (proposal) {
    const sourceBody = candidateComponent(proposal, p.kind, p.body);
    const correctedSourceBody = applyDocumentedCandidateCorrection(sourceBody, p.body, p);
    check(`候选与请求字段一致 ${requestIdentity(p)}`, sourceBody !== undefined && exactValue(correctedSourceBody, p.body), {
      kind: p.kind,
      key: keyOfBody(p.body),
      sourceBody,
      correctedSourceBody,
      requestBody: p.body,
    });
  }
}
check('候选主体覆盖请求主体', plan.scope.every(row => proposalById.has(row.id)), plan.scope.map(row => row.id).filter(id => !proposalById.has(id)));

for (const input of sourceFreeze.inputs ?? []) {
  const sourceFile = path.resolve(equipmentRuneDir, input.file);
  const exists = fs.existsSync(sourceFile);
  const actualHash = exists ? sha256(fs.readFileSync(sourceFile)) : null;
  check(`冻结来源文件 ${input.file}`, exists && actualHash === input.sha256, { expected: input.sha256, actual: actualHash, exists });
}
const freezeSelection = plan.scope.map(row => {
  const item = sourceFreeze.items.find(candidate => candidate.runeKey === row.runeKey);
  check(`冻结来源主体 ${row.runeKey}`, Boolean(item) && item.name === row.name, item ? { name: item.name, expected: row.name } : row.runeKey);
  return item ? { runeKey: item.runeKey, id: item.id, name: item.name, category: item.category, pathKey: item.pathKey, slotIndex: item.slotIndex } : { runeKey: row.runeKey, missing: true };
});

const componentPaths = [
  ['parameters', 'parameter', 'parameterKey'],
  ['formulas', 'formula', 'formulaKey'],
  ['effects', 'effect', 'effectKey'],
  ['processes', 'process', 'processKey'],
  ['internal-states', 'internalState', 'stateKey'],
  ['trigger-rules', 'rule', 'ruleKey'],
];

for (const row of plan.scope) {
  const skill = await get(`/skills/${row.skillKey}`, `${row.skillKey}技能`);
  check(`技能主体读取 ${row.skillKey}`, skill.status === 200, { status: skill.status, attempts: skill.attempts });
  if (skill.status === 200) {
    check(`技能主体键 ${row.skillKey}`, skill.data?.skillKey === row.skillKey, skill.data);
    check(`技能主体名称 ${row.skillKey}`, skill.data?.name === `符文·${row.name}`, { actual: skill.data?.name, expected: `符文·${row.name}` });
  }
  const rune = await get(`/runes/${row.runeKey}`, `${row.runeKey}符文`);
  check(`符文主体读取 ${row.runeKey}`, rune.status === 200, { status: rune.status, attempts: rune.attempts });
  if (rune.status === 200) {
    check(`符文主体键 ${row.runeKey}`, rune.data?.runeKey === row.runeKey, rune.data);
    check(`符文主体名称 ${row.runeKey}`, rune.data?.name === row.name, { actual: rune.data?.name, expected: row.name });
  }
  const expectedSkillBody = findPlanBody(row.id, 'skill', row.skillKey);
  const skillIssues = skill.status === 200 ? sameValue(skill.data, expectedSkillBody, '$') : [{ issue: 'not-read' }];
  const skillExtra = skill.status === 200 ? nonExpectedKeys(skill.data, expectedSkillBody, 'skill') : [];
  check(`技能完整字段 ${row.skillKey}`, skill.status === 200 && skillIssues.length === 0 && skillExtra.length === 0, { issues: skillIssues, unexpectedKeys: skillExtra });
  requestEvidence.push({ id: row.id, kind: 'skill', route: `/skills/${row.skillKey}`, status: skill.status, matched: skill.status === 200 && skillIssues.length === 0 && skillExtra.length === 0, expectedKeys: Object.keys(expectedSkillBody ?? {}), actualKeys: skill.status === 200 ? Object.keys(skill.data ?? {}) : [], issues: skillIssues, unexpectedKeys: skillExtra });
  if (skill.status === 200) actualDetails.set(`${row.id}:skill:${row.skillKey}`, skill.data);

  for (const [component, kind, keyField] of componentPaths) {
    const route = `/skills/${row.skillKey}/${component}`;
    const list = await get(route, `${row.skillKey}/${component}组成`);
    const expectedRows = plan.requests.filter(p => p.id === row.id && p.kind === kind);
    const expectedKeys = expectedRows.map(p => keyOfBody(p.body));
    const actualRows = list.status === 200 && Array.isArray(list.data) ? list.data : [];
    const actualKeys = actualRows.map(item => item?.[keyField]).filter(value => value !== undefined);
    const keySetSame = actualRows.length === expectedRows.length
      && actualKeys.length === expectedKeys.length
      && actualKeys.every(key => expectedKeys.includes(key))
      && new Set(actualKeys).size === new Set(expectedKeys).size;
    check(`技能组成 ${row.skillKey}/${component}`, list.status === 200 && Array.isArray(list.data) && keySetSame, {
      status: list.status, expectedCount: expectedRows.length, actualCount: Array.isArray(list.data) ? list.data.length : null, expectedKeys, actualKeys,
    });
    componentLists.set(`${row.id}:${component}`, actualRows);
    compositionEvidence.push({ id: row.id, skillKey: row.skillKey, component, status: list.status, expectedCount: expectedRows.length, actualCount: Array.isArray(list.data) ? list.data.length : null, expectedKeys, actualKeys, matched: list.status === 200 && Array.isArray(list.data) && keySetSame, rows: safe(actualRows) });
  }

  const runeImage = await get(`/runes/${row.runeKey}/representative-image`, `${row.runeKey}来源图`);
  const skillImage = await get(`/skills/${row.skillKey}/representative-image`, `${row.skillKey}技能图`);
  const sourceImage = runeImage.data?.image;
  const boundImage = skillImage.data?.image;
  check(`符文来源图 ${row.runeKey}`, runeImage.status === 200 && sourceImage?.enabled === true && sourceImage?.imageKey, { status: runeImage.status, image: sourceImage });
  check(`技能代表图 ${row.skillKey}`, skillImage.status === 200 && boundImage?.enabled === true && boundImage?.imageKey, { status: skillImage.status, image: boundImage });
  check(`技能与符文同图 ${row.skillKey}`, Boolean(sourceImage?.imageKey) && sourceImage?.imageKey === boundImage?.imageKey, { source: sourceImage, skill: boundImage });
  const imageKey = sourceImage?.imageKey;
  let image = null;
  let usages = null;
  if (imageKey) {
    const imageResponse = await get(`/images/${encodeURIComponent(imageKey)}`, `${imageKey}图片实体`);
    image = imageResponse;
    check(`图片实体 ${imageKey}`, imageResponse.status === 200 && imageResponse.data?.enabled === true && imageResponse.data?.imageKey === imageKey, { status: imageResponse.status, data: safe(imageResponse.data) });
    const usagesResponse = await get(`/images/${encodeURIComponent(imageKey)}/usages`, `${imageKey}图片用途`);
    usages = usagesResponse;
    const runeUsage = usagesResponse.data?.runes?.some(item => item.runeKey === row.runeKey);
    const skillUsage = usagesResponse.data?.skills?.some(item => item.skillKey === row.skillKey);
    check(`图片双用途 ${imageKey}`, usagesResponse.status === 200 && runeUsage && skillUsage, { status: usagesResponse.status, runeUsage, skillUsage, data: safe(usagesResponse.data) });
  }
  imageEvidence.push({ id: row.id, runeKey: row.runeKey, skillKey: row.skillKey, sourceImage: safe(sourceImage), skillImage: safe(boundImage), image: image ? { status: image.status, data: safe(image.data), attempts: image.attempts } : null, usages: usages ? { status: usages.status, data: safe(usages.data), attempts: usages.attempts } : null, sameImage: Boolean(sourceImage?.imageKey && sourceImage.imageKey === boundImage?.imageKey), dualUse: Boolean(usages?.status === 200 && usages.data?.runes?.some(item => item.runeKey === row.runeKey) && usages.data?.skills?.some(item => item.skillKey === row.skillKey)) });
}

for (const p of plan.requests) {
  const response = await get(p.readRoute, `对象 ${requestIdentity(p)}`);
  const body = response.status === 200 ? directBody(response, p.kind) : undefined;
  const issues = response.status === 200 ? sameValue(body, p.body, '$') : [{ issue: 'not-read', status: response.status }];
  const unexpectedKeys = response.status === 200 ? nonExpectedKeys(body, p.body, p.kind) : [];
  const matched = response.status === 200 && issues.length === 0 && unexpectedKeys.length === 0;
  check(`99对象完整字段 ${requestIdentity(p)}`, matched, { status: response.status, issues, unexpectedKeys, actualKeys: body && typeof body === 'object' ? Object.keys(body) : [] });
  requestEvidence.push({ id: p.id, kind: p.kind, route: p.readRoute, status: response.status, matched, expectedKeys: Object.keys(p.body ?? {}), actualKeys: body && typeof body === 'object' ? Object.keys(body) : [], issues, unexpectedKeys, actual: safe(body) });
  if (body !== undefined) actualDetails.set(`${p.id}:${p.kind}:${keyOfBody(p.body)}`, body);
}

const ruleIds = plan.requests.filter(p => p.kind === 'rule').map(p => p.id).sort((a, b) => a - b);
const expectedInitRuleIds = [9104, 8210, 8453];
check('仅有3个初始化规则', ruleIds.length === 3 && exactValue([...ruleIds].sort((a, b) => a - b), [...expectedInitRuleIds].sort((a, b) => a - b)), ruleIds);
for (const row of plan.scope) {
  const rules = componentLists.get(`${row.id}:trigger-rules`) ?? [];
  const isExpectedInit = expectedInitRuleIds.includes(row.id);
  check(`其余技能无默认触发 ${row.skillKey}`, isExpectedInit || rules.length === 0, { count: rules.length, rows: rules });
  if (isExpectedInit) {
    check(`初始化规则事件 ${row.skillKey}`, rules.length === 1 && rules[0]?.ruleKey, rules);
    const detail = findDetail(row.id, 'rule', rules[0]?.ruleKey);
    check(`初始化规则来源 ${row.skillKey}`, detail?.eventSource?.eventType === 'SOURCE_INITIALIZED' && Array.isArray(detail?.conditionGroups) && detail.conditionGroups.length === 0, detail);
  }
}

const special = {};
const levelParameter = findDetail(8210, 'parameter', 'level_ability_haste');
const levelExpected = Object.fromEntries(Array.from({ length: 18 }, (_, index) => {
  const level = index + 1;
  return [String(level), level >= 8 ? 10 : level >= 5 ? 5 : 0];
}));
special.transcendenceLevelTable = {
  passed: levelParameter?.valueMode === 'CHARACTER_LEVEL' && exactValue(levelParameter?.levelValues, levelExpected),
  valueMode: levelParameter?.valueMode,
  levelValues: levelParameter?.levelValues,
  selectedLevels: Object.fromEntries([0, 4, 5, 7, 8, 9, 10, 17].map(index => [index + 1, levelParameter?.levelValues?.[String(index + 1)] ?? null])),
};
check('超然 0/5/10 级表', special.transcendenceLevelTable.passed, special.transcendenceLevelTable);

const triumphFormula = findDetail(9111, 'formula', 'triumph_heal');
const triumphAttrs = allNodes(triumphFormula?.expression, node => node.nodeType === 'ATTRIBUTE');
const triumphAttrKeys = triumphAttrs.map(node => `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`).sort();
const triumphParams = [findDetail(9111, 'parameter', 'missing_health_ratio'), findDetail(9111, 'parameter', 'maximum_health_ratio')];
special.triumphSourceViews = {
  passed: triumphParams[0]?.fixedValue === 0.05 && triumphParams[1]?.fixedValue === 0.025
    && exactValue(triumphAttrKeys, ['SOURCE:hp:MISSING', 'SOURCE:hp:TOTAL'].sort())
    && triumphAttrs.every(node => node.attributeOwner === 'SOURCE' && node.attributeKey === 'hp'),
  parameters: triumphParams.map(item => item ? { parameterKey: item.parameterKey, fixedValue: item.fixedValue, valueMode: item.valueMode } : null),
  formulaAttributes: triumphAttrKeys,
};
check('凯旋 SOURCE 最大生命与已损生命', special.triumphSourceViews.passed, special.triumphSourceViews);

const presence = id => (componentLists.get(`${id}:effects`) ?? []).map(item => item.effectKey).sort();
const energyEffects = presence(8009);
special.presenceOfMindBranches = {
  passed: exactValue(energyEffects, ['damage_energy_restore', 'takedown_energy_restore', 'takedown_mana_restore'].sort())
    && (componentLists.get('8009:trigger-rules') ?? []).length === 0
    && (componentLists.get('8009:processes') ?? []).length === 0,
  effectKeys: energyEffects,
  triggerRuleCount: (componentLists.get('8009:trigger-rules') ?? []).length,
  processCount: (componentLists.get('8009:processes') ?? []).length,
};
check('气定神闲三分支不同时触发', special.presenceOfMindBranches.passed, special.presenceOfMindBranches);

const graspEffects = presence(8437);
const graspEffectDetails = graspEffects.map(key => findDetail(8437, 'effect', key));
special.graspOnlyHealing = {
  passed: exactValue(graspEffects, ['melee_heal', 'ranged_heal'].sort())
    && graspEffectDetails.every(effect => effect?.results?.every(result => result.resultType === 'DIRECT_HEAL'))
    && (componentLists.get('8437:trigger-rules') ?? []).length === 0,
  effectKeys: graspEffects,
  resultTypes: graspEffectDetails.flatMap(effect => effect?.results?.map(result => result.resultType) ?? []),
  formulaKeys: (componentLists.get('8437:formulas') ?? []).map(item => item.formulaKey).sort(),
  triggerRuleCount: (componentLists.get('8437:trigger-rules') ?? []).length,
};
check('不灭只有治疗效果且无默认伤害资格', special.graspOnlyHealing.passed, special.graspOnlyHealing);

const resolveEffects = presence(8242);
const resolveDurationKeys = resolveEffects.map(key => {
  const effect = findDetail(8242, 'effect', key);
  return { effectKey: key, durationValue: effect?.lifecycle?.durationValue, targets: effect?.results?.map(result => result.target), attributes: effect?.results?.map(result => result.detail?.attributeKey) };
});
special.resolveAfterControl = {
  passed: exactValue(resolveEffects, ['after_control_armor', 'after_control_magic_resistance'].sort())
    && findDetail(8242, 'parameter', 'armor_bonus')?.fixedValue === 10
    && findDetail(8242, 'parameter', 'magic_resistance_bonus')?.fixedValue === 10
    && findDetail(8242, 'parameter', 'after_control_duration_ms')?.fixedValue === 2000
    && resolveDurationKeys.every(item => item.durationValue?.kind === 'PARAMETER' && item.durationValue.parameterKey === 'after_control_duration_ms'),
  parameters: ['armor_bonus', 'magic_resistance_bonus', 'after_control_duration_ms'].map(key => ({ key, fixedValue: findDetail(8242, 'parameter', key)?.fixedValue })),
  effects: resolveDurationKeys,
};
check('坚定控制结束后2秒独立双抗', special.resolveAfterControl.passed, special.resolveAfterControl);

const manaComponents = {
  triggerRules: componentLists.get('8226:trigger-rules') ?? [],
  processes: componentLists.get('8226:processes') ?? [],
  internalStates: componentLists.get('8226:internal-states') ?? [],
};
special.manaflowNotPeriodic = {
  passed: manaComponents.triggerRules.length === 0 && manaComponents.processes.length === 0 && manaComponents.internalStates.length === 0
    && findDetail(8226, 'effect', 'missing_mana_restore')?.lifecycle === null,
  restorePeriod: findDetail(8226, 'parameter', 'restore_period_ms')?.fixedValue,
  componentCounts: { triggerRules: manaComponents.triggerRules.length, processes: manaComponents.processes.length, internalStates: manaComponents.internalStates.length },
};
check('法力流周期未连接', special.manaflowNotPeriodic.passed, special.manaflowNotPeriodic);

const soulParameter = findDetail(8128, 'parameter', 'confirmed_souls');
const soulFormula = findDetail(8128, 'formula', 'harvest_damage');
const soulFormulaParams = allNodes(soulFormula?.expression, node => node.nodeType === 'PARAMETER').map(node => node.parameterKey);
special.darkHarvestInput = {
  passed: soulParameter?.valueMode === 'RUNTIME_INPUT' && soulParameter?.fixedValue === null && soulParameter?.levelValues === null
    && soulFormulaParams.includes('confirmed_souls')
    && (componentLists.get('8128:trigger-rules') ?? []).length === 0,
  parameter: soulParameter ? { valueMode: soulParameter.valueMode, fixedValue: soulParameter.fixedValue, levelValues: soulParameter.levelValues } : null,
  formulaParameterKeys: soulFormulaParams,
  triggerRuleCount: (componentLists.get('8128:trigger-rules') ?? []).length,
};
check('黑暗收割灵魂输入无默认值', special.darkHarvestInput.passed, special.darkHarvestInput);

const existingNumeric = fs.existsSync(existingNumericFile) ? readJson(existingNumericFile) : null;
const existingVerify = fs.existsSync(existingVerifyFile) ? readJson(existingVerifyFile) : null;
check('已有独立数值核对证据通过', existingNumeric?.passed === true && Array.isArray(existingNumeric.cases) && existingNumeric.cases.length === 12, existingNumeric ? { passed: existingNumeric.passed, cases: existingNumeric.cases?.length, reads: existingNumeric.readRequests } : 'missing');

const counts = {
  requests: plan.requests.length,
  requestKinds: Object.fromEntries([...new Set(plan.requests.map(p => p.kind))].map(kind => [kind, plan.requests.filter(p => p.kind === kind).length])),
  skills: plan.scope.length,
  parameters: plan.requests.filter(p => p.kind === 'parameter').length,
  formulas: plan.requests.filter(p => p.kind === 'formula').length,
  effects: plan.requests.filter(p => p.kind === 'effect').length,
  processes: plan.requests.filter(p => p.kind === 'process').length,
  internalStates: plan.requests.filter(p => p.kind === 'internalState').length,
  triggerRules: plan.requests.filter(p => p.kind === 'rule').length,
  relations: plan.requests.filter(p => p.kind === 'relation').length,
};
const result = {
  checkedAt: new Date().toISOString(),
  mode: '仅GET和本地读取',
  apiBase: base,
  source: {
    requestSha256,
    expectedRequestSha256: '45942778a468d2b1c9557ecd3c052ff9c54c514087b7659ae801c71b1d780095',
    sourceCandidateSha256,
    expectedSourceCandidateSha256: 'a22d0f1cf63b51cc47fc128f532c596e608719c25710b41a0756cd637479b9f4',
    sourceFreezeSha256,
    selectedFreezeItems: freezeSelection,
    inputFiles: (sourceFreeze.inputs ?? []).map(input => ({ file: input.file, sha256: input.sha256, bytes: input.bytes, version: input.version })),
  },
  counts,
  requestEvidence,
  compositionEvidence,
  runeEvidence,
  imageEvidence,
  special,
  existingEvidence: {
    verify: existingVerify ? { mode: existingVerify.mode, requestSha256: existingVerify.requestSha256, summary: existingVerify.summary, startedAt: existingVerify.startedAt, completedAt: existingVerify.completedAt } : null,
    numeric: existingNumeric ? { passed: existingNumeric.passed, readRequests: existingNumeric.readRequests, cases: existingNumeric.cases?.length, counts: existingNumeric.counts, at: existingNumeric.at } : null,
  },
  apiRequestCount: apiLog.length,
  apiLog,
  failures,
  warnings,
  passed: failures.length === 0,
};
const outputFile = path.join(here, '独立复核结果.json');
fs.writeFileSync(outputFile, JSON.stringify(safe(result), null, 2) + '\n', 'utf8');
const summary = {
  file: outputFile,
  passed: result.passed,
  failures: failures.length,
  warnings: warnings.length,
  requests: plan.requests.length,
  apiGets: apiLog.length,
  skills: plan.scope.length,
  images: imageEvidence.length,
  dualUseImages: imageEvidence.filter(item => item.dualUse).length,
  numericCasesFromExistingEvidence: existingNumeric?.cases?.length ?? null,
};
console.log(JSON.stringify(summary));
if (!result.passed) process.exitCode = 1;
