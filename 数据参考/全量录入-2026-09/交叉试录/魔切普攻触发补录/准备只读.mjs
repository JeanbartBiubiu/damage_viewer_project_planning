import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.DAMAGE_ENTRY_TOKEN;
if (!token) throw new Error('缺少 DAMAGE_ENTRY_TOKEN');

const base = 'http://127.0.0.1:8080/api/admin/games/lol';
const frozenPath = path.join(here, '02-冻结请求.json');
const frozen = JSON.parse(fs.readFileSync(frozenPath, 'utf8'));
const requestLog = [];
const statusCounts = {};
let getCount = 0;

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
};
const shaBytes = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shaValue = value => shaBytes(JSON.stringify(stable(value)));
const must = (condition, message) => {
  if (!condition) throw new Error(message);
};
const hasExact = (values, value) => Array.isArray(values) && values.length === 1 && values[0] === value;
const routeKey = (prefix, key) => `${prefix}/${encodeURIComponent(key)}`;

async function get(route) {
  getCount += 1;
  const response = await fetch(base + route, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { parseError: true, responseBytes: Buffer.byteLength(text) };
    }
  }
  const statusKey = String(response.status);
  statusCounts[statusKey] = (statusCounts[statusKey] ?? 0) + 1;
  requestLog.push({ method: 'GET', route, status: response.status });
  return { method: 'GET', route, status: response.status, data };
}

async function mapLimit(values, limit, work) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await work(values[index], index);
    }
  }));
  return results;
}

must(frozen.planRevision === 1, '冻结请求版本不为1');
must(frozen.gameId === 'lol', '冻结请求游戏不为lol');
must(frozen.fixedVersion === '16.17.1', '冻结请求版本漂移');
must(frozen.status === 'READY', '冻结请求不是READY');
must(frozen.plannedWrites === 1 && frozen.writes?.length === 1, '冻结请求必须只有一条写入');
must(frozen.authorizationValueRecorded === false, '冻结请求不得保存令牌');

for (const source of frozen.sources) {
  const bytes = fs.readFileSync(source.path);
  must(shaBytes(bytes) === source.sha256, `来源散列漂移：${source.path}`);
}

const write = frozen.writes[0];
const body = write.body;
must(write.method === 'POST', '写入方法必须为POST');
must(write.route === '/skills/item_3042_passive/trigger-rules', '写入路由漂移');
must(write.detailRoute === '/skills/item_3042_passive/trigger-rules/on_basic_attack_hit_to_champion', '规则详情路由漂移');
must(body.ruleKey === 'on_basic_attack_hit_to_champion', '规则键漂移');
must(body.eventSource?.eventType === 'BASIC_ATTACK_HIT', '事件类型必须为BASIC_ATTACK_HIT');
must(JSON.stringify(body.eventSource?.detail) === '{}', '基础攻击事件明细必须为空对象');
must(body.conditionGroups?.length === 1, '规则必须只有一个条件组');
const condition = body.conditionGroups[0]?.conditions?.[0];
must(condition?.conditionType === 'TARGET_CATEGORY_CHECK', '条件类型必须为TARGET_CATEGORY_CHECK');
must(hasExact(condition?.detail?.categories, 'CHAMPION'), '目标类别必须只有CHAMPION');
must(body.actions?.length === 1, '规则必须只有一个动作');
const action = body.actions[0];
must(action.actionType === 'EXECUTE_EFFECT', '动作类型必须为EXECUTE_EFFECT');
must(action.targetContext === 'CURRENT_TARGET', '动作目标上下文必须为CURRENT_TARGET');
must(action.detail?.effectKey === 'on_hit_damage_from_max_mana', '动作必须复用既有效果');
must(body.perTargetCooldown === null && body.maxTriggersPerProcess === null, '不得凭空添加冷却或次数限制');
must(!JSON.stringify(body).includes('DAMAGE_DEALT'), '冻结规则不得接入技能伤害事件');
must(!JSON.stringify(body).includes('modifierZone'), '冻结规则不得引入乘区字段');

const targetResponses = new Map();
async function capture(route, expectedStatus) {
  if (targetResponses.has(route)) return targetResponses.get(route);
  const response = await get(route);
  targetResponses.set(route, response);
  if (expectedStatus !== undefined) must(response.status === expectedStatus, `${route} 状态为${response.status}，预期${expectedStatus}`);
  return response;
}

const candidateRoutes = new Set(frozen.writes.map(item => item.detailRoute));
const staticRoutes = [
  '/damage-types',
  '/attributes/attack_damage',
  '/attributes/mana',
  '/attributes/ability_haste',
  '/modifier-zones',
  '/equipment/item_3042',
  '/equipment/item_3042/attributes',
  '/equipment/item_3042/representative-image',
  '/equipment-skill-relations?equipmentKey=item_3042',
  '/skills/item_3042_passive',
  '/skills/item_3042_passive/representative-image',
  '/skills/item_3042_passive/parameters',
  '/skills/item_3042_passive/formulas',
  '/skills/item_3042_passive/effects',
  '/skills/item_3042_passive/processes',
  '/skills/item_3042_passive/internal-states',
  '/skills/item_3042_passive/trigger-rules',
  ...candidateRoutes
];
for (const route of [...new Set(staticRoutes)]) {
  await capture(route, candidateRoutes.has(route) ? 404 : 200);
}

const responseData = route => targetResponses.get(route)?.data;
const targetSkill = responseData('/skills/item_3042_passive');
const targetEquipment = responseData('/equipment/item_3042');
const targetAttributes = responseData('/equipment/item_3042/attributes');
const targetRelation = responseData('/equipment-skill-relations?equipmentKey=item_3042');
const parameterList = responseData('/skills/item_3042_passive/parameters');
const formulaList = responseData('/skills/item_3042_passive/formulas');
const effectList = responseData('/skills/item_3042_passive/effects');
const targetRuleList = responseData('/skills/item_3042_passive/trigger-rules');
const modifierZoneList = responseData('/modifier-zones');

must(Array.isArray(parameterList), '参数列表不是数组');
must(Array.isArray(formulaList), '公式列表不是数组');
must(Array.isArray(effectList), '效果列表不是数组');
must(Array.isArray(targetRuleList), '触发规则列表不是数组');
must(Array.isArray(modifierZoneList?.items), '乘区列表不是数组');

for (const item of parameterList) {
  must(item.parameterKey, '参数列表存在无键项');
  await capture(routeKey('/skills/item_3042_passive/parameters', item.parameterKey), 200);
}
for (const item of formulaList) {
  must(item.formulaKey, '公式列表存在无键项');
  await capture(routeKey('/skills/item_3042_passive/formulas', item.formulaKey), 200);
}
for (const item of effectList) {
  must(item.effectKey, '效果列表存在无键项');
  await capture(routeKey('/skills/item_3042_passive/effects', item.effectKey), 200);
}
for (const item of targetRuleList) {
  must(item.ruleKey, '目标规则列表存在无键项');
  await capture(routeKey('/skills/item_3042_passive/trigger-rules', item.ruleKey), 200);
}
for (const item of modifierZoneList.items) {
  must(item.modifierZoneKey, '乘区列表存在无键项');
  await capture(routeKey('/modifier-zones', item.modifierZoneKey), 200);
}

const sourceDocument = JSON.parse(fs.readFileSync(frozen.sources[0].path, 'utf8'));
const sourceObject = sourceDocument.objects?.find(item => item.equipmentKey === 'item_3042');
must(sourceObject, '来源冻结文件缺少item_3042');
const clientObject = sourceObject.object ?? {};
const clientValues = Object.fromEntries((clientObject.mDataValues ?? []).map(item => [item.mName, item.mValue ?? null]));
const calculationCoefficients = name => (clientObject.mItemCalculations?.[name]?.mFormulaParts ?? [])
  .map(part => part.mCoefficient ?? part.mNumber ?? null);
const bound = sourceObject.bound ?? {};
const official = sourceObject.official ?? {};
const stageProgressPath = frozen.sources.find(source => source.path.endsWith('阶段进度.json'))?.path;
let phaseProgress = null;
if (stageProgressPath) {
  const stage = JSON.parse(fs.readFileSync(stageProgressPath, 'utf8'));
  const mechanismBatches = stage.mechanismBatches ?? stage;
  const pick = value => value ? {
    at: value.at ?? null,
    status: value.status ?? null,
    skills: value.skills ?? [],
    runtimeValidation: value.runtimeValidation ?? null,
    pending: value.pending ?? []
  } : null;
  phaseProgress = {
    generatedAt: stage.generatedAt ?? null,
    sourceVersion: stage.sourceVersion ?? null,
    equipmentExistingFormulaResultBackfill: pick(mechanismBatches.equipmentExistingFormulaResultBackfill),
    persistentEquipmentInitializationBackfill: pick(mechanismBatches.persistentEquipmentInitializationBackfill)
  };
}

const sourceSnapshot = {
  capturedAt: new Date().toISOString(),
  methodPolicy: 'LOCAL_SOURCE_AND_GET_ONLY',
  authorizationValueRecorded: false,
  fixedVersion: '16.17.1',
  sources: frozen.sources,
  item3042SourceFacts: {
    equipmentKey: sourceObject.equipmentKey,
    sourcePath: sourceObject.path,
    clientDataValues: {
      BonusADManaRatioTOOLTIPONLY: clientValues.BonusADManaRatioTOOLTIPONLY,
      OnHitManaRatioTOOLTIPONLY: clientValues.OnHitManaRatioTOOLTIPONLY,
      AbilityManaRatioRangedTOOLTIPONLY: clientValues.AbilityManaRatioRangedTOOLTIPONLY,
      AbilityManaRatioMeleeTOOLTIPONLY: clientValues.AbilityManaRatioMeleeTOOLTIPONLY,
      PerCastIDLockout: clientValues.PerCastIDLockout
    },
    clientCalculationCoefficients: {
      BonusADFromMana: calculationCoefficients('BonusADFromMana'),
      OnHitDamage: calculationCoefficients('OnHitDamage'),
      MeleeItemCalcValue: calculationCoefficients('MeleeItemCalcValue'),
      RangedItemCalcValue: calculationCoefficients('RangedItemCalcValue')
    },
    directStats: {
      attackDamage: clientObject.mFlatPhysicalDamageMod ?? null,
      mana: clientObject.flatMPPoolMod ?? null,
      abilityHaste: clientObject.mAbilityHasteMod ?? null
    },
    boundAttackTooltip: bound.keyTooltip?.text ?? null,
    boundExternalTooltip: bound.keyTooltipExternal?.text ?? null,
    officialDescription: official.description ?? null,
    lockoutInterpretation: '只保存来源值6.5；单位、事件类型和共享范围未确认，不换算或接入冷却。'
  },
  phaseProgress,
  acceptedFacts: {
    skillKey: 'item_3042_passive',
    effectKey: 'on_hit_damage_from_max_mana',
    formulaKey: 'on_hit_damage_from_max_mana',
    eventType: 'BASIC_ATTACK_HIT',
    targetCategory: 'CHAMPION',
    actionTargetContext: 'CURRENT_TARGET',
    formulaMeaning: 'SOURCE的mana总值乘on_hit_max_mana_damage_ratio；实库参数应为0.012。',
    noCooldownConversion: true,
    noSkillDamageBranch: true
  },
  excluded: frozen.excluded
};

const skillListResponse = await get('/skills');
must(skillListResponse.status === 200, '/skills 状态异常');
must(Array.isArray(skillListResponse.data?.items), '/skills 返回项不是数组');
must(skillListResponse.data.items.length === skillListResponse.data.total, '/skills 总数不一致');
const skillKeys = skillListResponse.data.items.map(item => item.skillKey).sort();
must(skillKeys.every(Boolean), '/skills 存在空技能键');

const ruleLists = await mapLimit(skillKeys, 24, async skillKey => {
  const route = routeKey('/skills', skillKey) + '/trigger-rules';
  const response = await get(route);
  must(response.status === 200, `${route} 状态异常`);
  must(Array.isArray(response.data), `${route} 返回项不是数组`);
  return {
    skillKey,
    rules: response.data.map(rule => ({
      ruleKey: rule.ruleKey,
      name: rule.name,
      eventType: rule.eventType,
      conditionGroupCount: rule.conditionGroupCount,
      actionCount: rule.actionCount,
      sortOrder: rule.sortOrder
    }))
  };
});
const ruleSummaries = ruleLists.flatMap(item => item.rules.map(rule => ({
  skillKey: item.skillKey,
  ruleKey: rule.ruleKey
})));
const ruleDetails = await mapLimit(ruleSummaries, 24, async item => {
  const route = `${routeKey('/skills', item.skillKey)}/trigger-rules/${encodeURIComponent(item.ruleKey)}`;
  const response = await get(route);
  must(response.status === 200, `${route} 状态异常`);
  return { skillKey: item.skillKey, ruleKey: item.ruleKey, data: response.data };
});
ruleDetails.sort((a, b) => a.skillKey.localeCompare(b.skillKey) || a.ruleKey.localeCompare(b.ruleKey));

const categoryConditions = rule => (rule.data?.conditionGroups ?? [])
  .flatMap(group => group.conditions ?? [])
  .filter(item => item.conditionType === 'TARGET_CATEGORY_CHECK');
const hasChampionCategory = rule => categoryConditions(rule)
  .some(item => hasExact(item.detail?.categories, 'CHAMPION'));
const hasCurrentTargetAction = rule => (rule.data?.actions ?? [])
  .some(item => item.targetContext === 'CURRENT_TARGET');
const basicAttackRules = ruleDetails.filter(item => item.data?.eventSource?.eventType === 'BASIC_ATTACK_HIT');
const basicAttackChampionCurrentTarget = basicAttackRules
  .filter(item => hasChampionCategory(item) && hasCurrentTargetAction(item));
const damageEventNames = new Set(['DAMAGE_PENDING', 'DAMAGE_DEALT', 'DAMAGE_TAKEN']);
const damageEventRules = ruleDetails.filter(item => damageEventNames.has(item.data?.eventSource?.eventType));
const damageEventCategoryRules = damageEventRules.filter(item => categoryConditions(item).length > 0);
const existingTargetRuleKeys = targetRuleList.map(item => item.ruleKey).sort();
const existingInitializationRule = targetRuleList.find(item => item.ruleKey === 'initialize_bonus_attack_damage_from_max_mana');
const targetRuleDetails = targetRuleList.map(item => {
  const route = routeKey('/skills/item_3042_passive/trigger-rules', item.ruleKey);
  return targetResponses.get(route)?.data ?? null;
}).filter(Boolean);

const onHitEffect = responseData('/skills/item_3042_passive/effects/on_hit_damage_from_max_mana');
const onHitResult = onHitEffect?.results?.find(item => item.resultKey === 'damage');
const onHitParameter = parameterList.find(item => item.parameterKey === 'on_hit_max_mana_damage_ratio');
const onHitFormula = responseData('/skills/item_3042_passive/formulas/on_hit_damage_from_max_mana');
const relationItems = targetRelation?.items ?? [];
const equipmentImage = responseData('/equipment/item_3042/representative-image');
const skillImage = responseData('/skills/item_3042_passive/representative-image');
const modifierZoneKeys = modifierZoneList.items.map(item => item.modifierZoneKey).sort();
const candidateResponse = targetResponses.get(write.detailRoute);
const checks = {
  skillSubject: targetSkill?.skillKey === 'item_3042_passive' && targetSkill?.gameId === 'lol',
  equipmentSubject: targetEquipment?.equipmentKey === 'item_3042' && targetEquipment?.gameId === 'lol',
  directAttributes: targetAttributes?.equipmentKey === 'item_3042'
    && targetAttributes?.attributeValues?.mana === 1000
    && targetAttributes?.attributeValues?.attack_damage === 35
    && targetAttributes?.attributeValues?.ability_haste === 15,
  equipmentRelation: relationItems.length === 1
    && relationItems[0]?.equipmentKey === 'item_3042'
    && relationItems[0]?.skillKey === 'item_3042_passive',
  equipmentRepresentativeImage: equipmentImage?.image?.enabled === true && equipmentImage.image.imageKey === 'item_3042',
  skillRepresentativeImage: skillImage?.image?.enabled === true && skillImage.image.imageKey === 'item_3042',
  onHitParameter: onHitParameter?.parameterKey === 'on_hit_max_mana_damage_ratio' && onHitParameter.fixedValue === 0.012,
  onHitFormula: onHitFormula?.formulaKey === 'on_hit_damage_from_max_mana'
    && onHitFormula.expression?.operation === 'MULTIPLY'
    && onHitFormula.expression?.operands?.[0]?.attributeOwner === 'SOURCE'
    && onHitFormula.expression?.operands?.[0]?.attributeKey === 'mana'
    && onHitFormula.expression?.operands?.[0]?.attributeValueKind === 'TOTAL'
    && onHitFormula.expression?.operands?.[1]?.parameterKey === 'on_hit_max_mana_damage_ratio',
  onHitEffect: onHitEffect?.effectKey === 'on_hit_damage_from_max_mana'
    && onHitEffect.lifecycle === null
    && onHitEffect.results?.length === 1,
  onHitDamageResult: onHitResult?.target === 'TARGET'
    && onHitResult.resultType === 'DAMAGE'
    && onHitResult.detail?.damageTypeKey === 'physics'
    && onHitResult.detail?.deliveryKind === 'BASIC_ATTACK'
    && onHitResult.detail?.originKind === 'DIRECT'
    && onHitResult.detail?.critical?.mode === 'DISALLOWED'
    && Array.isArray(onHitResult.detail?.vampRules)
    && onHitResult.detail.vampRules.length === 0
    && onHitResult.lifecycleBehavior === null,
  existingInitializationRule: Boolean(existingInitializationRule),
  candidateAbsent: candidateResponse?.status === 404,
  targetRuleBaselineOnlyInitialization: existingTargetRuleKeys.length === 1
    && existingTargetRuleKeys[0] === 'initialize_bonus_attack_damage_from_max_mana',
  basicAttackCategoryCurrentTargetPrecedent: basicAttackChampionCurrentTarget.length > 0,
  noNewModifierZoneRequired: !JSON.stringify(body).includes('modifierZone')
    && !JSON.stringify(body).includes('modifier_zone'),
  noSkillDamageBranch: !JSON.stringify(body).includes('DAMAGE_DEALT'),
  noCooldownInvented: body.perTargetCooldown === null && body.maxTriggersPerProcess === null
};
const verdict = Object.values(checks).every(Boolean) ? 'READY' : 'REVISE';
const failedChecks = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);

const baseline = {
  capturedAt: new Date().toISOString(),
  methodPolicy: 'GET_ONLY',
  authorizationValueRecorded: false,
  fixedVersion: '16.17.1',
  getCount,
  businessWrites: 0,
  statusCounts,
  requestLog,
  target: {
    skillKey: 'item_3042_passive',
    equipmentKey: 'item_3042',
    candidateRuleKey: body.ruleKey,
    candidateDetailStatus: candidateResponse?.status ?? null,
    protectedResponseCount: targetResponses.size,
    responses: Object.fromEntries([...targetResponses.entries()]),
    protectedRuleKeys: existingTargetRuleKeys,
    protectedEffectKeys: effectList.map(item => item.effectKey).sort(),
    protectedFormulaKeys: formulaList.map(item => item.formulaKey).sort(),
    protectedParameterKeys: parameterList.map(item => item.parameterKey).sort(),
    protectedModifierZoneKeys: modifierZoneKeys
  },
  triggerRuleScan: {
    skillCount: skillKeys.length,
    skillListTotal: skillListResponse.data.total,
    listGetCount: skillKeys.length,
    detailGetCount: ruleDetails.length,
    ruleCount: ruleDetails.length,
    targetCategoryConditionCount: ruleDetails.reduce((total, item) => total + categoryConditions(item).length, 0),
    basicAttackRuleCount: basicAttackRules.length,
    basicAttackChampionCurrentTargetCount: basicAttackChampionCurrentTarget.length,
    damageEventRuleCount: damageEventRules.length,
    damageEventCategoryRuleCount: damageEventCategoryRules.length,
    sha256: shaValue(ruleDetails),
    skillList: skillListResponse.data.items,
    ruleLists,
    rules: ruleDetails
  }
};

const sourceEvidence = {
  item3042SourceObjectPath: sourceObject.path,
  clientRatios: {
    bonusAttackDamage: clientValues.BonusADManaRatioTOOLTIPONLY,
    onHitDamage: clientValues.OnHitManaRatioTOOLTIPONLY,
    rangedAbilityDamage: clientValues.AbilityManaRatioRangedTOOLTIPONLY,
    meleeAbilityDamage: clientValues.AbilityManaRatioMeleeTOOLTIPONLY
  },
  sourceLockout: clientValues.PerCastIDLockout,
  existingRuntimeData: {
    effectKey: onHitEffect?.effectKey ?? null,
    formulaKey: onHitFormula?.formulaKey ?? null,
    damageTypeKey: onHitResult?.detail?.damageTypeKey ?? null,
    deliveryKind: onHitResult?.detail?.deliveryKind ?? null,
    originKind: onHitResult?.detail?.originKind ?? null,
    lifecycle: onHitEffect?.lifecycle ?? null
  },
  phaseProgress,
  existingTargetRuleKeys,
  existingInitializationRuleDetail: targetRuleDetails.find(item => item.ruleKey === 'initialize_bonus_attack_damage_from_max_mana') ?? null,
  basicAttackChampionCurrentTargetPrecedent: basicAttackChampionCurrentTarget.map(item => ({
    skillKey: item.skillKey,
    ruleKey: item.ruleKey,
    data: item.data
  })),
  damageEventContractExamples: damageEventRules.map(item => ({
    skillKey: item.skillKey,
    ruleKey: item.ruleKey,
    eventSource: item.data.eventSource,
    conditionGroups: item.data.conditionGroups,
    actions: item.data.actions,
    perTargetCooldown: item.data.perTargetCooldown,
    maxTriggersPerProcess: item.data.maxTriggersPerProcess
  }))
};

const report = {
  generatedAt: new Date().toISOString(),
  verdict,
  failedChecks,
  methodPolicy: 'LOCAL_SOURCE_AND_GET_ONLY',
  authorizationValueRecorded: false,
  fixedVersion: '16.17.1',
  scope: {
    skillKey: 'item_3042_passive',
    effectKey: 'on_hit_damage_from_max_mana',
    eventType: 'BASIC_ATTACK_HIT',
    targetCategory: 'CHAMPION',
    actionTargetContext: 'CURRENT_TARGET',
    skillDamageBranchIncluded: false
  },
  checks,
  getSummary: {
    getCount,
    businessWrites: 0,
    statusCounts,
    targetGetCount: targetResponses.size,
    globalSkillListGetCount: 1,
    globalTriggerRuleListGetCount: skillKeys.length,
    globalTriggerRuleDetailGetCount: ruleDetails.length
  },
  currentBaseline: {
    skillCount: skillKeys.length,
    triggerRuleCount: ruleDetails.length,
    targetCategoryConditionCount: baseline.triggerRuleScan.targetCategoryConditionCount,
    basicAttackRuleCount: basicAttackRules.length,
    basicAttackChampionCurrentTargetCount: basicAttackChampionCurrentTarget.length,
    damageEventRuleCount: damageEventRules.length,
    damageEventCategoryRuleCount: damageEventCategoryRules.length,
    targetSkillRuleKeys: existingTargetRuleKeys,
    triggerRuleSha256: baseline.triggerRuleScan.sha256,
    modifierZoneKeys
  },
  candidate: {
    ruleKey: body.ruleKey,
    detailRoute: write.detailRoute,
    preflightStatus: candidateResponse?.status ?? null,
    frozenBodySha256: shaValue(body),
    body
  },
  protectedFacts: sourceEvidence,
  expectedBusinessWrite: {
    count: 1,
    method: 'POST',
    route: write.route,
    immediateReadback: write.detailRoute,
    noPutPatchDelete: true,
    noOtherObjectWrites: true
  },
  postConditions: [
    '新规则详情为200，事件为BASIC_ATTACK_HIT。',
    '规则只有CHAMPION类别条件和CURRENT_TARGET执行既有效果动作。',
    '既有效果、公式、参数、装备主体、直接属性、关系、代表图和初始化规则散列不变。',
    '技能伤害分支、冷却、叠层、吸血和运行时验证不在本次写入。'
  ],
  pendingFacts: [
    '基础攻击命中事件是否由TinyGo运行链发出，以及多目标时当前目标如何确定。',
    'PerCastIDLockout=6.5的单位、共享范围和触发计数。',
    '额外物理伤害进入基础攻击、护甲、减伤、暴击和吸血流程的先后顺序。',
    '伤害型技能3%/4%分支、远近程条件和缺少的攻击力比例组成。'
  ]
};

const outputFiles = ['03-来源快照.json', '04-写入前现值.json', '05-只读准备报告.json', '证据清单.json'];
for (const file of outputFiles) must(!fs.existsSync(path.join(here, file)), `输出已存在，拒绝覆盖：${file}`);
const writeJson = (file, value) => fs.writeFileSync(path.join(here, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
writeJson('03-来源快照.json', sourceSnapshot);
writeJson('04-写入前现值.json', baseline);
writeJson('05-只读准备报告.json', report);

const evidenceFiles = ['01-来源与方案.md', '02-冻结请求.json', '03-来源快照.json', '04-写入前现值.json', '05-只读准备报告.json', 'README.md', '准备只读.mjs'];
const evidence = {
  generatedAt: new Date().toISOString(),
  verdict,
  methodPolicy: 'LOCAL_SOURCE_AND_GET_ONLY',
  authorizationValueRecorded: false,
  businessWrites: 0,
  getCount,
  files: evidenceFiles.map(file => {
    const bytes = fs.readFileSync(path.join(here, file));
    return { file, bytes: bytes.length, sha256: shaBytes(bytes) };
  }),
  reportFile: '05-只读准备报告.json',
  baselineFile: '04-写入前现值.json',
  sourceSnapshotFile: '03-来源快照.json'
};
writeJson('证据清单.json', evidence);

console.log(JSON.stringify({
  status: 'PASS',
  verdict,
  failedChecks,
  getCount,
  businessWrites: 0,
  statusCounts,
  skillCount: skillKeys.length,
  triggerRuleCount: ruleDetails.length,
  basicAttackRuleCount: basicAttackRules.length,
  basicAttackChampionCurrentTargetCount: basicAttackChampionCurrentTarget.length,
  damageEventRuleCount: damageEventRules.length,
  damageEventCategoryRuleCount: damageEventCategoryRules.length,
  targetRuleKeys: existingTargetRuleKeys,
  candidatePreflightStatus: candidateResponse?.status ?? null
}, null, 2));
