import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';

// 只读取写后独立GET保存的实际详情；不访问业务接口，不使用默认运行时输入。
const artifact = 'C:/project/damage_web_dev/.agents/artifacts/hero20-candidate';
const readbackDir = path.join(artifact, '修订一-独立回读', '2026-09-09T12-50-43-450Z');
const candidatePath = path.join(artifact, '修订一-完整候选.json');
const mathPath = path.join(artifact, '修订一-独立数学核算.json');
const actualPath = path.join(readbackDir, '独立全量组件现值.json');
const expected = {
  candidateSha256: '7fddee3b4b2fd121d3c053ba20388a69e38e2069a42ad7b80a054c56b70ce5c9',
  candidateMathSha256: '910d4db5adbeca11b85c19e894766df1be3c9e0e24586876347855520ad0a638',
  actualReadbackSha256: 'c237472e4b6b56436f14d0c33b1ba68908f7084d9d729d43c1bb158969e98d0f',
  formulas: 24,
  candidateDetails: 158,
  totalDetails: 227,
};

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const candidateBytes = fs.readFileSync(candidatePath);
const mathBytes = fs.readFileSync(mathPath);
const actualBytes = fs.readFileSync(actualPath);
const candidate = JSON.parse(candidateBytes);
const priorMath = JSON.parse(mathBytes);
const actualSnapshot = JSON.parse(actualBytes);
const failures = [];
const formulaBodyChecks = [];
const formulaCases = [];
const missingRuntimeRejections = [];
const missingAttributeRejections = [];
const integerInputRejections = [];
const boundaryChecks = [];
const shieldNoDefaultChecks = [];
const runtimeValues = { caseA: {}, caseB: {} };

const serverFields = new Set(['gameId', 'skillKey', 'createdAt', 'updatedAt']);
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).filter(key => !serverFields.has(key)).sort().map(key => [key, canonical(value[key])]))
    : value;
const diff = (left, right, at = '$') => {
  if (equal(left, right)) return null;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return { path: at, expected: left, actual: right };
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return { path: at, expected: left, actual: right };
    for (let index = 0; index < left.length; index++) {
      const child = diff(left[index], right[index], `${at}[${index}]`);
      if (child) return child;
    }
    return null;
  }
  for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    if (!(key in left) || !(key in right)) return { path: `${at}.${key}`, expected: left[key], actual: right[key] };
    const child = diff(left[key], right[key], `${at}.${key}`);
    if (child) return child;
  }
  return null;
};
const businessDiff = (left, right) => diff(canonical(left), canonical(right));
const close = (actual, expectedValue) => Number.isFinite(actual) && Number.isFinite(expectedValue) && Math.abs(actual - expectedValue) <= 1e-9;
const fail = (message, detail = null) => failures.push({ message, detail });
const check = (name, passed, detail = null) => {
  if (!passed) fail(name, detail);
  return passed;
};

check('候选哈希保持批准版本', sha256(candidateBytes) === expected.candidateSha256, sha256(candidateBytes));
check('候选数学结果哈希保持批准版本', sha256(mathBytes) === expected.candidateMathSha256, sha256(mathBytes));
check('写后独立GET详情哈希匹配本次回读', sha256(actualBytes) === expected.actualReadbackSha256, sha256(actualBytes));
check('候选数学前置结果通过', priorMath.candidateMathReady === true && priorMath.failures?.length === 0, { candidateMathReady: priorMath.candidateMathReady, failures: priorMath.failures?.length });
check('实际回读详情总数为227', actualSnapshot.details?.length === expected.totalDetails, actualSnapshot.details?.length);

const candidateParameterMap = new Map();
const candidateFormulaMap = new Map();
for (const [skillKey, skill] of Object.entries(candidate.skills ?? {})) {
  for (const parameter of skill.write?.parameters ?? []) candidateParameterMap.set(`${skillKey}/${parameter.parameterKey}`, parameter);
  for (const formula of skill.write?.formulas ?? []) candidateFormulaMap.set(`${skillKey}/${formula.formulaKey}`, formula);
}
const actualDetailMap = new Map((actualSnapshot.details ?? []).map(row => [`${row.skillKey}/${row.kind}/${row.id}`, row.data]));
const liveParameterMap = new Map();
for (const [key, value] of actualDetailMap.entries()) if (key.includes('/parameters/')) liveParameterMap.set(key, value);
const formulaEntries = [...candidateFormulaMap.entries()];
check('候选公式数量为24', formulaEntries.length === expected.formulas, formulaEntries.length);
const actualFormulaCount = (actualSnapshot.details ?? []).filter(row => row.kind === 'formulas' && candidateFormulaMap.has(`${row.skillKey}/${row.id}`)).length;
check('实际候选详情数量为158', actualFormulaCount === expected.formulas, { actualFormulaDetails: actualFormulaCount });

const refs = formula => {
  const parameters = new Set();
  const attributes = new Set();
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.nodeType === 'PARAMETER') parameters.add(node.parameterKey);
    if (node.nodeType === 'ATTRIBUTE') attributes.add(`${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`);
    for (const value of Object.values(node)) if (value && typeof value === 'object') walk(value);
  };
  walk(formula.expression);
  return { parameters: [...parameters], attributes: [...attributes] };
};

const attributesFor = (abilityPower, attackDamage, targetHp) => ({
  SOURCE: {
    ability_power: { TOTAL: abilityPower },
    attack_damage: { TOTAL: attackDamage },
  },
  TARGET: {
    hp: { TOTAL: targetHp },
  },
});
const contexts = (skillKey, phase) => {
  const maxLevel = Number(candidate.skills?.[skillKey]?.maxLevel);
  check(`技能${skillKey}具有有效最大等级`, Number.isInteger(maxLevel) && maxLevel > 0, maxLevel);
  return phase === 'caseA'
    ? { caseId: 'caseA', rank: 1, level: 7, attributes: attributesFor(80, 110, 1400), runtime: runtimeValues.caseA[skillKey] ?? {} }
    : { caseId: 'caseB', rank: maxLevel, level: 17, attributes: attributesFor(240, 185, 2800), runtime: runtimeValues.caseB[skillKey] ?? {} };
};

// 每个运行时参数都显式给出两组测试值；没有2或17.5之类的隐式填充。
runtimeValues.caseA = {
  chogath_e: { actual_feast_stacks: 2 },
  chogath_r: { source_bonus_health_for_hero_damage: 250, actual_feast_stacks: 4 },
  galio_p: { passive_base_damage: 65, source_mstat6_for_passive: 120 },
  galio_w: { source_mstat6_for_reduction: 80, source_mstat12_for_reduction: 50, source_hp_for_passive_shield: 1200 },
  galio_r: { source_mstat6_for_landing_damage: 90 },
  rammus_p: { source_armor_for_passive: 140, source_magic_resistance_for_passive: 90 },
  rammus_q: { minimum_move_speed_ratio: 0.31 },
  rammus_w: { source_armor_for_w: 180, source_magic_resistance_for_w: 100 },
};
runtimeValues.caseB = {
  chogath_e: { actual_feast_stacks: 7 },
  chogath_r: { source_bonus_health_for_hero_damage: 500, actual_feast_stacks: 12 },
  galio_p: { passive_base_damage: 105, source_mstat6_for_passive: 220 },
  galio_w: { source_mstat6_for_reduction: 140, source_mstat12_for_reduction: 110, source_hp_for_passive_shield: 2400 },
  galio_r: { source_mstat6_for_landing_damage: 170 },
  rammus_p: { source_armor_for_passive: 220, source_magic_resistance_for_passive: 140 },
  rammus_q: { minimum_move_speed_ratio: 0.37 },
  rammus_w: { source_armor_for_w: 260, source_magic_resistance_for_w: 160 },
};

const candidateParameter = (skillKey, key, context) => {
  const parameter = candidateParameterMap.get(`${skillKey}/${key}`);
  if (!parameter) throw new Error(`候选参数缺失：${skillKey}/${key}`);
  let value;
  if (parameter.valueMode === 'FIXED') value = parameter.fixedValue;
  else if (parameter.valueMode === 'SKILL_LEVEL') value = parameter.levelValues?.[String(context.rank)];
  else if (parameter.valueMode === 'CHARACTER_LEVEL') value = parameter.levelValues?.[String(context.level)];
  else if (parameter.valueMode === 'RUNTIME_INPUT') {
    if (!Object.hasOwn(context.runtime, key) || context.runtime[key] == null) throw new Error(`MISSING_RUNTIME_INPUT:${key}`);
    value = context.runtime[key];
  } else throw new Error(`未知候选参数模式：${parameter.valueMode}`);
  if (value == null || !Number.isFinite(Number(value))) throw new Error(`候选参数无值：${skillKey}/${key}`);
  if (parameter.valueType === 'INTEGER' && !Number.isInteger(Number(value))) throw new Error(`INTEGER参数不是整数：${key}`);
  return Number(value);
};
const candidateAttribute = (attributes, owner, key, kind) => {
  const value = attributes?.[owner]?.[key]?.[kind];
  if (value == null) throw new Error(`MISSING_ATTRIBUTE:${owner}.${key}.${kind}`);
  return Number(value);
};

const liveParameter = (skillKey, key, context) => {
  const parameter = liveParameterMap.get(`${skillKey}/parameters/${key}`);
  if (!parameter) throw new Error(`实际参数详情缺失：${skillKey}/${key}`);
  let value;
  if (parameter.valueMode === 'FIXED') value = parameter.fixedValue;
  else if (parameter.valueMode === 'SKILL_LEVEL') value = parameter.levelValues?.[String(context.rank)];
  else if (parameter.valueMode === 'CHARACTER_LEVEL') value = parameter.levelValues?.[String(context.level)];
  else if (parameter.valueMode === 'RUNTIME_INPUT') {
    if (!Object.hasOwn(context.runtime, key) || context.runtime[key] == null) throw new Error(`MISSING_RUNTIME_INPUT:${key}`);
    value = context.runtime[key];
  } else throw new Error(`未知实际参数模式：${parameter.valueMode}`);
  if (value == null || !Number.isFinite(Number(value))) throw new Error(`实际参数无值：${skillKey}/${key}`);
  if (parameter.valueType === 'INTEGER' && !Number.isInteger(Number(value))) throw new Error(`INTEGER参数不是整数：${key}`);
  return Number(value);
};
const liveAttribute = (attributes, owner, key, kind) => {
  const value = attributes?.[owner]?.[key]?.[kind];
  if (value == null) throw new Error(`MISSING_ATTRIBUTE:${owner}.${key}.${kind}`);
  return Number(value);
};
const evaluateLive = (node, skillKey, context, at = '$') => {
  if (!node || typeof node !== 'object') throw new Error(`非法实际公式节点：${at}`);
  if (node.nodeType === 'PARAMETER') return liveParameter(skillKey, node.parameterKey, context);
  if (node.nodeType === 'ATTRIBUTE') return liveAttribute(context.attributes, node.attributeOwner, node.attributeKey, node.attributeValueKind);
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2) throw new Error(`不支持的实际公式节点：${at}`);
  const left = evaluateLive(node.operands[0], skillKey, context, `${at}.left`);
  const right = evaluateLive(node.operands[1], skillKey, context, `${at}.right`);
  if (node.operation === 'ADD') return left + right;
  if (node.operation === 'SUBTRACT') return left - right;
  if (node.operation === 'MULTIPLY') return left * right;
  if (node.operation === 'DIVIDE') { if (right === 0) throw new Error(`除数为0：${at}`); return left / right; }
  if (node.operation === 'MIN') return Math.min(left, right);
  if (node.operation === 'MAX') return Math.max(left, right);
  throw new Error(`未知实际运算：${node.operation}`);
};

// 按冻结候选公式的业务含义独立计算期望值，不复用实际GET表达式树。
const expectedFormula = (skillKey, formulaKey, context) => {
  const p = key => candidateParameter(skillKey, key, context);
  const a = (owner, key, kind) => candidateAttribute(context.attributes, owner, key, kind);
  const ap = () => a('SOURCE', 'ability_power', 'TOTAL');
  const ad = () => a('SOURCE', 'attack_damage', 'TOTAL');
  const hp = () => a('TARGET', 'hp', 'TOTAL');
  const key = `${skillKey}/${formulaKey}`;
  if (key === 'chogath_q/magic_damage') return p('base_damage') + p('ap_ratio') * ap();
  if (key === 'chogath_w/magic_damage') return p('base_damage') + p('ap_ratio') * ap();
  if (key === 'chogath_e/flat_damage') return p('base_damage') + p('ap_ratio') * ap();
  if (key === 'chogath_e/max_health_damage') return p('percent_point_ratio') * (p('target_max_health_percent_points') + p('actual_feast_stacks') * p('feast_stack_multiplier_percent_points')) * hp();
  if (key === 'chogath_r/hero_true_damage') return p('hero_base_damage') + p('ap_ratio') * ap() + p('unmapped_ratio') * p('source_bonus_health_for_hero_damage');
  if (key === 'chogath_r/max_health_gain') return p('actual_feast_stacks') * p('health_per_stack');
  if (key === 'chogath_r/bonus_cast_range') return Math.min(p('max_bonus_cast_range'), p('actual_feast_stacks') * p('cast_range_per_stack'));
  if (key === 'chogath_r/bonus_attack_range') return Math.min(p('max_bonus_attack_range'), p('actual_feast_stacks') * p('attack_range_per_stack'));
  if (key === 'galio_p/passive_magic_damage') return p('passive_base_damage') + p('total_attack_damage_ratio') * ad() + p('ap_ratio') * ap() + p('unmapped_ratio') * p('source_mstat6_for_passive');
  if (key === 'galio_q/missile_damage') return p('base_damage') + p('ap_ratio') * ap();
  if (key === 'galio_q/tornado_max_health_damage') return p('percent_point_ratio') * p('tornado_ticks') * (p('super_q_base_percent_points') + p('super_q_ap_percent_points_per_ap') * ap()) * hp();
  if (key === 'galio_w/passive_shield') return p('passive_shield_health_ratio_by_skill_level') * p('source_hp_for_passive_shield');
  if (key === 'galio_w/magic_damage_reduction') return p('damage_reduction_base') + p('ap_ratio') * ap() + p('mstat6_ratio') * p('source_mstat6_for_reduction') + p('mstat12_ratio') * p('source_mstat12_for_reduction');
  if (key === 'galio_w/physical_damage_reduction') return p('physical_damage_reduction_ratio') * (p('damage_reduction_base') + p('ap_ratio') * ap() + p('mstat6_ratio') * p('source_mstat6_for_reduction') + p('mstat12_ratio') * p('source_mstat12_for_reduction'));
  if (key === 'galio_w/minimum_magic_damage') return p('minimum_base_damage') + p('ap_damage_ratio') * ap();
  if (key === 'galio_w/maximum_magic_damage') return p('maximum_damage_multiplier') * (p('minimum_base_damage') + p('ap_damage_ratio') * ap());
  if (key === 'galio_e/first_champion_magic_damage') return p('base_damage') + p('ap_ratio') * ap();
  if (key === 'galio_r/landing_magic_damage') return p('base_damage') + p('ap_ratio') * ap() + p('unmapped_ratio') * p('source_mstat6_for_landing_damage');
  if (key === 'rammus_p/bonus_attack_damage') return p('armor_ratio') * p('source_armor_for_passive') + p('magic_resistance_ratio') * p('source_magic_resistance_for_passive');
  if (key === 'rammus_q/power_ball_magic_damage') return p('base_damage') + p('ap_ratio') * ap();
  if (key === 'rammus_w/return_magic_damage') return p('flat_damage_return') + p('damage_armor_ratio') * p('source_armor_for_w') + p('damage_magic_resistance_ratio') * p('source_magic_resistance_for_w');
  if (key === 'rammus_w/bonus_armor') return p('flat_bonus_armor') * (p('one') + p('bonus_armor_ratio')) + p('bonus_armor_ratio') * p('source_armor_for_w');
  if (key === 'rammus_w/bonus_magic_resistance') return p('flat_bonus_magic_resistance') * (p('one') + p('bonus_magic_resistance_ratio')) + p('bonus_magic_resistance_ratio') * p('source_magic_resistance_for_w');
  if (key === 'rammus_r/initial_magic_damage') return p('initial_damage') + p('ap_ratio') * ap();
  throw new Error(`没有冻结期望公式：${key}`);
};

const formulaRecords = [];
for (const [key, candidateFormula] of formulaEntries) {
  const [skillKey, formulaKey] = key.split('/');
  const actualFormula = actualDetailMap.get(`${skillKey}/formulas/${formulaKey}`);
  check(`实际公式详情存在${key}`, Boolean(actualFormula), actualFormula);
  if (!actualFormula) continue;
  const bodyDifference = businessDiff(candidateFormula, actualFormula);
  formulaBodyChecks.push({ skillKey, formulaKey, passed: !bodyDifference, diff: bodyDifference });
  if (bodyDifference) fail(`实际公式与候选不一致：${key}`, bodyDifference);
  const reference = refs(candidateFormula);
  for (const parameterKey of reference.parameters) {
    const expectedParameter = candidateParameterMap.get(`${skillKey}/${parameterKey}`);
    const live = liveParameterMap.get(`${skillKey}/parameters/${parameterKey}`);
    const parameterDifference = businessDiff(expectedParameter, live);
    check(`公式参数实际详情与候选一致${skillKey}/${parameterKey}`, !parameterDifference, parameterDifference);
  }
  for (const phase of ['caseA', 'caseB']) {
    const context = contexts(skillKey, phase);
    try {
      const actualValue = evaluateLive(actualFormula.expression, skillKey, context);
      const expectedValue = expectedFormula(skillKey, formulaKey, context);
      const passed = close(actualValue, expectedValue) && actualValue > 0;
      formulaCases.push({ skillKey, formulaKey, caseId: context.caseId, rank: context.rank, attributes: context.attributes, runtime: context.runtime, actualValue, expectedValue, passed });
      if (!passed) fail(`实际公式数值不符：${key}/${phase}`, { actualValue, expectedValue });
    } catch (error) {
      fail(`实际公式求值失败：${key}/${phase}`, String(error.message ?? error));
    }
  }
  for (const parameterKey of reference.parameters) {
    const parameter = candidateParameterMap.get(`${skillKey}/${parameterKey}`);
    if (parameter?.valueMode !== 'RUNTIME_INPUT') continue;
    const context = contexts(skillKey, 'caseA');
    const runtime = { ...context.runtime };
    delete runtime[parameterKey];
    try {
      evaluateLive(actualFormula.expression, skillKey, { ...context, runtime });
      fail(`缺少运行时输入未拒绝：${key}/${parameterKey}`);
    } catch (error) {
      const rejected = String(error.message ?? error).startsWith('MISSING_RUNTIME_INPUT:');
      missingRuntimeRejections.push({ skillKey, formulaKey, missing: parameterKey, rejected, error: String(error.message ?? error) });
      if (!rejected) fail(`缺少运行时输入错误类型不符：${key}/${parameterKey}`, String(error.message ?? error));
    }
    if (parameter.valueType === 'INTEGER') {
      try {
        evaluateLive(actualFormula.expression, skillKey, { ...context, runtime: { ...context.runtime, [parameterKey]: 0.5 } });
        fail(`INTEGER运行时输入未拒绝：${key}/${parameterKey}`);
      } catch (error) {
        const rejected = String(error.message ?? error).startsWith('INTEGER参数不是整数');
        integerInputRejections.push({ skillKey, formulaKey, parameterKey, testValue: 0.5, rejected, error: String(error.message ?? error) });
        if (!rejected) fail(`INTEGER运行时输入错误类型不符：${key}/${parameterKey}`, String(error.message ?? error));
      }
    }
  }
  for (const attribute of reference.attributes) {
    const [owner, attributeKey, valueKind] = attribute.split('.');
    const context = contexts(skillKey, 'caseA');
    const attributes = structuredClone(context.attributes);
    delete attributes[owner][attributeKey][valueKind];
    try {
      evaluateLive(actualFormula.expression, skillKey, { ...context, attributes });
      fail(`缺少属性输入未拒绝：${key}/${attribute}`);
    } catch (error) {
      const rejected = String(error.message ?? error).startsWith('MISSING_ATTRIBUTE:');
      missingAttributeRejections.push({ skillKey, formulaKey, missing: attribute, rejected, error: String(error.message ?? error) });
      if (!rejected) fail(`缺少属性输入错误类型不符：${key}/${attribute}`, String(error.message ?? error));
    }
  }
  formulaRecords.push({ skillKey, formulaKey, parameters: reference.parameters, attributes: reference.attributes });
}

const boundary = (skillKey, formulaKey, rank, stacks, expectedValue, label) => {
  const context = { ...contexts(skillKey, 'caseA'), caseId: label, rank, runtime: { ...(runtimeValues.caseA[skillKey] ?? {}), actual_feast_stacks: stacks } };
  try {
    const actualValue = evaluateLive(actualDetailMap.get(`${skillKey}/formulas/${formulaKey}`).expression, skillKey, context);
    const passed = close(actualValue, expectedValue);
    boundaryChecks.push({ label, skillKey, formulaKey, rank, stacks, actualValue, expectedValue, passed });
    if (!passed) fail(`边界值不符：${label}`, { actualValue, expectedValue });
  } catch (error) {
    fail(`边界值求值失败：${label}`, String(error.message ?? error));
  }
};
for (const stacks of [9, 10, 11, 20]) boundary('chogath_r', 'bonus_cast_range', 3, stacks, Math.min(25, stacks * 2.5), `科加斯R施法距离${stacks}层`);
for (const rank of [1, 3]) for (const stacks of [9, 10, 11, 20]) {
  const perStack = rank === 1 ? 4.7 : 7.7;
  boundary('chogath_r', 'bonus_attack_range', rank, stacks, Math.min(75, stacks * perStack), `科加斯R攻击距离等级${rank}/${stacks}层`);
}
boundary('chogath_r', 'max_health_gain', 3, 12, 12 * 160, '科加斯R十二层生命收益不受六层截断');
const shieldRatio = liveParameterMap.get('galio_w/parameters/passive_shield_health_ratio_by_skill_level');
const shieldSource = liveParameterMap.get('galio_w/parameters/source_hp_for_passive_shield');
const shieldRatioPassed = shieldRatio?.valueMode === 'SKILL_LEVEL' && shieldRatio.fixedValue === null && Object.keys(shieldRatio.levelValues ?? {}).length === 5;
const shieldSourcePassed = shieldSource?.valueMode === 'RUNTIME_INPUT' && shieldSource.fixedValue === null && shieldSource.levelValues === null;
shieldNoDefaultChecks.push({ parameterKey: 'passive_shield_health_ratio_by_skill_level', valueMode: shieldRatio?.valueMode, fixedValue: shieldRatio?.fixedValue, levelValues: shieldRatio?.levelValues, passed: shieldRatioPassed });
shieldNoDefaultChecks.push({ parameterKey: 'source_hp_for_passive_shield', valueMode: shieldSource?.valueMode, fixedValue: shieldSource?.fixedValue, levelValues: shieldSource?.levelValues, passed: shieldSourcePassed });
if (!shieldRatioPassed || !shieldSourcePassed) fail('加里奥W护盾默认边界不符', shieldNoDefaultChecks);

const result = {
  generatedAt: new Date().toISOString(),
  status: failures.length ? 'REVISE' : 'PASS',
  candidateSha256: sha256(candidateBytes),
  candidateMathSha256: sha256(mathBytes),
  actualReadbackSha256: sha256(actualBytes),
  source: '写后独立GET实际详情；冻结候选参数与独立期望公式；不重复GET，不使用默认运行时输入。',
  totals: {
    expectedFormulaCount: expected.formulas,
    actualFormulaCount: formulaRecords.length,
    formulaBodyChecks: formulaBodyChecks.length,
    formulaCaseChecks: formulaCases.length,
    missingRuntimeRejections: missingRuntimeRejections.length,
    missingAttributeRejections: missingAttributeRejections.length,
    integerInputRejections: integerInputRejections.length,
    boundaryChecks: boundaryChecks.length,
    shieldNoDefaultChecks: shieldNoDefaultChecks.length,
  },
  formulaRecords,
  formulaBodyChecks,
  formulaCases,
  missingRuntimeRejections,
  missingAttributeRejections,
  integerInputRejections,
  boundaryChecks,
  shieldNoDefaultChecks,
  failures,
  policy: {
    expectedFormula: '按24个公式键逐项编码冻结业务含义，独立计算期望值，再与实际GET表达式求值比较。',
    runtimeInput: '每个测试场景明确提供运行时值；删除值必须拒绝；INTEGER输入0.5必须拒绝。',
    boundary: '科加斯R施法距离和攻击距离分别检查9、10、11、20层，实际层数不套用RMinionMaxStacks=6。',
    shield: '加里奥W护盾等级倍率必须为五级值，生命输入必须为无默认RUNTIME_INPUT。',
  },
};
const outputPath = path.join(artifact, '修订一-实际数学严格核对.json');
fs.writeFileSync(outputPath, jsonBytes(result));
console.log(JSON.stringify({ status: result.status, formulaCount: result.totals.actualFormulaCount, formulaCases: result.totals.formulaCaseChecks, missingRuntimeRejections: result.totals.missingRuntimeRejections, missingAttributeRejections: result.totals.missingAttributeRejections, integerInputRejections: result.totals.integerInputRejections, boundaryChecks: result.totals.boundaryChecks, shieldNoDefaultChecks: result.totals.shieldNoDefaultChecks, failures: failures.length, output: outputPath }, null, 2));
if (failures.length) process.exitCode = 1;
