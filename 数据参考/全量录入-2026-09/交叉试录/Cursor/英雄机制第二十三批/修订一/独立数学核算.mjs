import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const repo = 'C:/project/damage_web_dev';
const artifactDir = path.join(repo, '.agents/artifacts/hero23-root-recovery/修订一');
const planningDir = path.join(repo, '数据参考/全量录入-2026-09/交叉试录/Cursor/英雄机制第二十三批/修订一');
const inputDir = path.join(repo, '.agents/artifacts/hero23-cursor-entry-20260909');
const candidatePath = path.join(artifactDir, '完整候选.json');
const versionPath = path.join(artifactDir, '候选版本.json');
const bindingPath = path.join(inputDir, '来源绑定与当前文本.json');
const inputVersionPath = path.join(inputDir, '输入版本.json');
const verificationAt = new Date().toISOString();

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message, detail = undefined) => {
  if (!condition) throw new Error(detail === undefined ? message : `${message}：${JSON.stringify(detail)}`);
};
const nearly = (actual, expected, epsilon = 1e-8) => Math.abs(Number(actual) - Number(expected)) <= epsilon;
const check = (condition, message, detail = undefined) => {
  if (!condition) throw new Error(detail === undefined ? message : `${message}：${JSON.stringify(detail)}`);
};
const writeOnce = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, 'utf8');
    assert(current === text, '拒绝覆盖已有独立数学结果', file);
    return { path: file, sha256: sha256(Buffer.from(current)), existed: true };
  }
  fs.writeFileSync(file, text, 'utf8');
  return { path: file, sha256: sha256(Buffer.from(text)), existed: false };
};

const candidateBytes = fs.readFileSync(candidatePath);
const candidate = JSON.parse(candidateBytes);
const version = readJson(versionPath);
const binding = readJson(bindingPath);
const inputVersion = readJson(inputVersionPath);
assert(candidate.meta.apiWrites === 0 && candidate.meta.cursorStatus.includes('ECONNRESET'), '候选状态不符合静态接手范围');
assert(inputVersion.apiWrites === 0 && inputVersion.GETs === 97, '输入版本存在业务写入或GET漂移');
assert(sha256(candidateBytes) === version.candidateSha256, '候选文件哈希与版本文件不符', { actual: sha256(candidateBytes), expected: version.candidateSha256 });

const skills = candidate.skills;
const skillKeys = Object.keys(skills);
assert(skillKeys.length === 10 && skillKeys.join(',') === inputVersion.skills.join(','), '技能顺序或数量不符', skillKeys);
const heroes = Object.fromEntries(binding.heroes.map(hero => [hero.id, hero]));
const heroIdOf = skillKey => skillKey.startsWith('amumu_') ? 'Amumu' : 'Zac';
const slotOf = skillKey => skillKey.slice(-1).toUpperCase();
const boundSkill = skillKey => heroes[heroIdOf(skillKey)].skills.find(skill => skill.slot === slotOf(skillKey));
const rawSpell = skillKey => boundSkill(skillKey).object.mSpell;
const rawDataValues = skillKey => rawSpell(skillKey).DataValues ?? [];
const rawData = (skillKey, name) => {
  const item = rawDataValues(skillKey).find(value => value.name === name);
  assert(item, '原始DataValues缺失', { skillKey, name });
  return item.values;
};
const rawField = (skillKey, name) => {
  const value = rawSpell(skillKey)[name];
  assert(Array.isArray(value), '原始技能字段不是数组', { skillKey, name, value });
  return value;
};
const rawRank = (skillKey, name, level) => rawData(skillKey, name)[level];
const rawFixed = (skillKey, name) => rawData(skillKey, name)[1];
const rawCalc = (skillKey, key) => {
  const value = rawSpell(skillKey).mSpellCalculations?.[key];
  assert(value, '原始计算树缺失', { skillKey, key });
  return value;
};
const rawPart = (skillKey, key, index = 0) => rawCalc(skillKey, key).mFormulaParts[index];
const parameter = (skillKey, parameterKey) => {
  const value = skills[skillKey].write.parameters.find(item => item.parameterKey === parameterKey);
  assert(value, '候选参数缺失', { skillKey, parameterKey });
  return value;
};
const levelOf = (skillKey, scenario) => scenario.levels[skillKey] ?? skills[skillKey].maxLevel;
const selectedCandidateLevel = (skillKey, key, scenario, overrides = {}) => {
  const item = parameter(skillKey, key);
  const override = overrides?.[skillKey]?.[key];
  if (override !== undefined) return override;
  if (item.valueMode === 'FIXED') return item.fixedValue;
  if (item.valueMode === 'SKILL_LEVEL') return item.levelValues[String(levelOf(skillKey, scenario))];
  if (item.valueMode === 'RUNTIME_INPUT') return scenario.runtime?.[skillKey]?.[key];
  throw new Error(`未知参数模式：${skillKey}/${key}`);
};
const validateValueType = (item, value) => {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) throw new Error(`参数缺值：${item.parameterKey}`);
  if (item.valueType === 'INTEGER' && (!Number.isInteger(Number(value)))) throw new Error(`整数参数收到非整数：${item.parameterKey}`);
  return Number(value);
};
const readParameter = (skillKey, key, scenario, overrides = {}) => validateValueType(parameter(skillKey, key), selectedCandidateLevel(skillKey, key, scenario, overrides));

const readAttribute = (attributeOwner, attributeKey, attributeValueKind, scenario) => {
  const value = scenario.attributes?.[attributeOwner]?.[attributeKey]?.[attributeValueKind];
  if (value === undefined || value === null || !Number.isFinite(Number(value))) throw new Error(`属性缺值：${attributeOwner}.${attributeKey}.${attributeValueKind}`);
  return Number(value);
};
const evaluate = (skillKey, node, scenario, overrides = {}) => {
  assert(node && typeof node === 'object', '表达式节点缺失', { skillKey, node });
  if (node.nodeType === 'PARAMETER') return readParameter(skillKey, node.parameterKey, scenario, overrides);
  if (node.nodeType === 'ATTRIBUTE') return readAttribute(node.attributeOwner, node.attributeKey, node.attributeValueKind, scenario);
  assert(node.nodeType === 'OPERATION', '表达式节点类型不受支持', { skillKey, node });
  assert(Array.isArray(node.operands) && node.operands.length === 2, '公式操作必须恰有两个操作数', { skillKey, node });
  const operands = node.operands.map(operand => evaluate(skillKey, operand, scenario, overrides));
  switch (node.operation) {
    case 'ADD': return operands.reduce((sum, value) => sum + value, 0);
    case 'SUBTRACT': return operands[0] - operands[1];
    case 'MULTIPLY': return operands.reduce((product, value) => product * value, 1);
    case 'DIVIDE': return operands[0] / operands[1];
    case 'MIN': return Math.min(...operands);
    case 'MAX': return Math.max(...operands);
    default: throw new Error(`未知公式操作：${node.operation}`);
  }
};
const collectNodes = (node, out = { parameters: [], attributes: [], operations: [] }) => {
  if (node.nodeType === 'PARAMETER') out.parameters.push(node.parameterKey);
  else if (node.nodeType === 'ATTRIBUTE') out.attributes.push(`${node.attributeOwner}.${node.attributeKey}.${node.attributeValueKind}`);
  else {
    assert(node.nodeType === 'OPERATION' && Array.isArray(node.operands) && node.operands.length === 2, '公式操作必须恰有两个操作数', node);
    out.operations.push({ operation: node.operation, operandCount: node.operands.length });
    for (const operand of node.operands) collectNodes(operand, out);
  }
  return out;
};
const operationArityChecks = [];
for (const skillKey of skillKeys) {
  const record = skills[skillKey];
  const parameterKeys = new Set(record.write.parameters.map(item => item.parameterKey));
  assert(record.write.processes.length === 0 && record.write.internalStates.length === 0 && record.write.triggerRules.length === 0, '候选包含未授权运行结构', skillKey);
  for (const item of record.write.parameters) {
    if (item.valueType === 'INTEGER') {
      if (item.valueMode === 'FIXED') assert(Number.isInteger(item.fixedValue), '整数固定值不是整数', { skillKey, key: item.parameterKey, value: item.fixedValue });
      if (item.valueMode === 'SKILL_LEVEL') for (const [level, value] of Object.entries(item.levelValues ?? {})) assert(Number.isInteger(value), '整数等级值不是整数', { skillKey, key: item.parameterKey, level, value });
    }
    if (item.valueMode === 'RUNTIME_INPUT') assert(item.fixedValue === null && item.levelValues === null, '运行输入意外带默认值', { skillKey, key: item.parameterKey });
  }
  for (const formula of record.write.formulas) {
    const nodes = collectNodes(formula.expression);
    for (const key of nodes.parameters) assert(parameterKeys.has(key), '公式引用未定义参数', { skillKey, formulaKey: formula.formulaKey, key });
    for (const attr of nodes.attributes) assert(!attr.toLowerCase().includes('.current'), '公式使用CURRENT属性', { skillKey, formulaKey: formula.formulaKey, attr });
    for (const operation of nodes.operations) {
      assert(operation.operandCount === 2, '公式存在非二元操作', { skillKey, formulaKey: formula.formulaKey, operation });
      operationArityChecks.push({ skillKey, formulaKey: formula.formulaKey, operation: operation.operation, operandCount: operation.operandCount });
    }
  }
  for (const effect of record.write.effects) for (const result of effect.results ?? []) {
    assert(!['DAMAGE', 'DIRECT_HEAL', 'MOMENT_EVALUATION'].includes(result.resultType), '候选包含禁止结果类型', { skillKey, resultType: result.resultType });
  }
}

const arrayChecks = [
  { label: 'amumu_q.BaseDamage索引1至5', actual: rawData('amumu_q', 'BaseDamage').slice(1, 6), expected: [70, 95, 120, 145, 170] },
  { label: 'amumu_q.StunDuration索引1至5', actual: rawData('amumu_q', 'StunDuration').slice(1, 6), expected: [1, 1, 1, 1, 1] },
  { label: 'amumu_q.mAmmoRechargeTime索引1至5', actual: rawField('amumu_q', 'mAmmoRechargeTime').slice(1, 6), expected: [16, 15, 14, 13, 12] },
  { label: 'amumu_w.HealthDamage索引1至5', actual: rawData('amumu_w', 'HealthDamage').slice(1, 6), expected: [1, 1.25, 1.5, 1.75, 2] },
  { label: 'amumu_e.BaseDamage索引1至5', actual: rawData('amumu_e', 'BaseDamage').slice(1, 6), expected: [65, 95, 125, 155, 185] },
  { label: 'amumu_e.BaseDamageReduction索引1至5', actual: rawData('amumu_e', 'BaseDamageReduction').slice(1, 6), expected: [5, 7, 9, 11, 13] },
  { label: 'amumu_r.RDamage索引1至3', actual: rawData('amumu_r', 'RDamage').slice(1, 4), expected: [200, 300, 400] },
  { label: 'zac_q.BaseDamage索引1至5', actual: rawData('zac_q', 'BaseDamage').slice(1, 6), expected: [60, 90, 120, 150, 180] },
  { label: 'zac_w.BaseDamage索引1至5', actual: rawData('zac_w', 'BaseDamage').slice(1, 6), expected: [40, 50, 60, 70, 80] },
  { label: 'zac_w.BaseMaxHealthDamage索引1至5', actual: rawData('zac_w', 'BaseMaxHealthDamage').slice(1, 6), expected: [0.04, 0.05, 0.06, 0.07, 0.08] },
  { label: 'zac_e.BaseDamage索引1至5', actual: rawData('zac_e', 'BaseDamage').slice(1, 6), expected: [60, 105, 150, 195, 240] },
  { label: 'zac_e.MaxRange索引1至5', actual: rawData('zac_e', 'MaxRange').slice(1, 6), expected: [1200, 1350, 1500, 1650, 1800] },
  { label: 'zac_e.ChannelTime索引1至5', actual: rawData('zac_e', 'ChannelTime').slice(1, 6), expected: [0.9, 1, 1.1, 1.2, 1.3] },
  { label: 'zac_r.BaseDamageBounce索引1至3', actual: rawData('zac_r', 'BaseDamageBounce').slice(1, 4), expected: [120, 190, 260] },
];
for (const item of arrayChecks) {
  assert(item.actual.length === item.expected.length, '原始数组长度不符', item);
  item.actual.forEach((value, index) => assert(nearly(value, item.expected[index], 1e-6), '原始数组索引值不符', { label: item.label, index, value, expected: item.expected[index] }));
  const [skillKey, keyWithRule] = item.label.split('.');
  const key = keyWithRule.split('索引')[0];
  const candidateParameter = skills[skillKey]?.write.parameters.find(parameterItem => parameterItem.parameterKey === key || (key === 'mAmmoRechargeTime' && parameterItem.parameterKey === 'ammo_recharge_time_ms'));
  if (candidateParameter?.levelValues) {
    const candidateValues = Object.values(candidateParameter.levelValues);
    const expectedCandidate = key === 'mAmmoRechargeTime' ? item.expected.map(value => value * 1000) : item.expected;
    assert(candidateValues.length === expectedCandidate.length, '候选等级数组长度不符', { label: item.label, candidateValues, expectedCandidate });
    candidateValues.forEach((value, index) => assert(nearly(value, expectedCandidate[index], 1e-6), '候选等级数组与原始索引不符', { label: item.label, index, value, expected: expectedCandidate[index] }));
  }
}

const modifierChecks = [
  { label: 'amumu_w.{c8e45bc3}.mMultiplier', actual: rawCalc('amumu_w', '{c8e45bc3}').mMultiplier.mNumber, expected: 0.5 },
  { label: 'amumu_w.{8a96509c}.mMultiplier', actual: rawCalc('amumu_w', '{8a96509c}').mMultiplier.mNumber, expected: 0.005 },
  { label: 'zac_w.DisplayPercentDamage.mMultiplier', actual: rawCalc('zac_w', 'DisplayPercentDamage').mMultiplier.mNumber, expected: 0.01 },
  { label: 'zac_e.MaxStun常数', actual: rawPart('zac_e', 'MaxStun', 0).mPart2.mNumber, expected: 2 },
  { label: 'zac_r.DamagePerSubsequentBounce.mMultiplier', actual: rawCalc('zac_r', 'DamagePerSubsequentBounce').mMultiplier.mDataValue, expected: 'DamageReductionBounce' },
];
for (const item of modifierChecks) assert(item.actual === item.expected || nearly(item.actual, item.expected), '根修饰倍率核对失败', item);
assert(rawPart('amumu_e', 'DamageReduction', 1).mStat === 1 && rawPart('amumu_e', 'DamageReduction', 2).mStat === 6, '阿木木E属性选择器原值漂移');
assert(rawPart('zac_q', 'TotalDamage', 2).mStat === 12 && rawPart('zac_q', 'TotalDamage', 2).mStatFormula === 2, '扎克Q额外生命选择器原值漂移');
assert(rawCalc('zac_p', 'TotalHeal').mMultiplier.mStat === 12 && rawCalc('zac_p', 'TotalHeal').mMultiplier.mCoefficient === 1, '扎克P生命乘数原值漂移');

const scenarioA = {
  id: 'A',
  levels: Object.fromEntries(skillKeys.map(skillKey => [skillKey, 1])),
  attributes: { SOURCE: { ability_power: { TOTAL: 100 }, hp: { TOTAL: 2000, BONUS: 500 } }, TARGET: { hp: { TOTAL: 2400 } } },
  runtime: {
    amumu_p: { magic_damage_base: 120 },
    amumu_e: { incoming_physical_damage: 100, source_bonus_armor: 20, source_bonus_magic_resistance: 30 },
    zac_p: { cell_heal_ratio: 0.04 },
    zac_q: { source_current_hp_for_cost: 500 },
    zac_w: { source_current_hp_for_cost: 500 },
    zac_e: { source_current_hp_for_cost: 500 },
  },
};
const scenarioB = {
  id: 'B',
  levels: Object.fromEntries(skillKeys.map(skillKey => [skillKey, skills[skillKey].maxLevel])),
  attributes: { SOURCE: { ability_power: { TOTAL: 275 }, hp: { TOTAL: 3200, BONUS: 1200 } }, TARGET: { hp: { TOTAL: 4800 } } },
  runtime: {
    amumu_p: { magic_damage_base: 250 },
    amumu_e: { incoming_physical_damage: 300, source_bonus_armor: 200, source_bonus_magic_resistance: 100 },
    zac_p: { cell_heal_ratio: 0.07 },
    zac_q: { source_current_hp_for_cost: 900 },
    zac_w: { source_current_hp_for_cost: 900 },
    zac_e: { source_current_hp_for_cost: 900 },
  },
};
const scenarios = [scenarioA, scenarioB];
const expectedFormula = (skillKey, formulaKey, scenario) => {
  const level = levelOf(skillKey, scenario);
  const ap = scenario.attributes.SOURCE.ability_power.TOTAL;
  const targetHp = scenario.attributes.TARGET.hp.TOTAL;
  const sourceHpTotal = scenario.attributes.SOURCE.hp.TOTAL;
  const sourceHpBonus = scenario.attributes.SOURCE.hp.BONUS;
  if (skillKey === 'amumu_p') return scenario.runtime.amumu_p.magic_damage_base * Number(rawFixed('amumu_p', 'DamageAmp').toFixed(3));
  if (skillKey === 'amumu_q') return rawRank('amumu_q', 'BaseDamage', level) + Number(rawPart('amumu_q', 'TotalDamage', 1).mCoefficient.toFixed(2)) * ap;
  if (skillKey === 'amumu_w') {
    const points = rawRank('amumu_w', 'HealthDamage', level) + Number(rawRank('amumu_w', 'APRatio', level).toFixed(3)) * ap;
    if (formulaKey === 'total_health_damage_percent_points') return points;
        if (formulaKey === 'damage_per_second') return rawRank('amumu_w', 'BaseDamage', level) + 0.01 * points * targetHp;
  }
  if (skillKey === 'amumu_e') {
    const reductionPoints = rawRank('amumu_e', 'BaseDamageReduction', level) + Number(rawPart('amumu_e', 'DamageReduction', 1).mCoefficient.toFixed(2)) * scenario.runtime.amumu_e.source_bonus_armor + Number(rawPart('amumu_e', 'DamageReduction', 2).mCoefficient.toFixed(2)) * scenario.runtime.amumu_e.source_bonus_magic_resistance;
    const incoming = scenario.runtime.amumu_e.incoming_physical_damage;
    if (formulaKey === 'damage_reduction_points') return reductionPoints;
        if (formulaKey === 'raw_physical_damage_reduction') return reductionPoints;
        if (formulaKey === 'capped_physical_damage_reduction') return Math.min(reductionPoints, Number(rawFixed('amumu_e', 'FlatDamageReductionMax')) * incoming);
    if (formulaKey === 'tantrum_damage') return rawRank('amumu_e', 'BaseDamage', level) + rawPart('amumu_e', 'TantrumDamage', 1).mCoefficient * ap;
  }
    if (skillKey === 'amumu_r') return rawRank('amumu_r', 'RDamage', level) + Number(rawRank('amumu_r', 'RCoefficient', level).toFixed(1)) * ap;
  if (skillKey === 'zac_p') return scenario.runtime.zac_p.cell_heal_ratio * sourceHpTotal;
  if (skillKey === 'zac_q') {
        const total = rawRank('zac_q', 'BaseDamage', level) + Number(rawRank('zac_q', 'APRatio', level).toFixed(1)) * ap + Number(rawRank('zac_q', 'HealthRatio', level).toFixed(2)) * sourceHpBonus;
    if (formulaKey === 'total_damage') return total;
    if (formulaKey === 'max_damage_tooltip') return rawPart('zac_q', 'MaxDamageTooltip', 0).mPart2.mNumber * total;
        if (formulaKey === 'health_cost') return Number(rawRank('zac_q', 'HPCost', level).toFixed(2)) * scenario.runtime.zac_q.source_current_hp_for_cost;
  }
  if (skillKey === 'zac_w') {
        const points = rawRank('zac_w', 'HealthPercentTooltip', level) + Number(rawRank('zac_w', 'APRatioToPercentDamage', level).toFixed(2)) * ap;
        if (formulaKey === 'damage') return rawRank('zac_w', 'BaseDamage', level) + Number(rawCalc('zac_w', 'DisplayPercentDamage').mMultiplier.mNumber.toFixed(2)) * points * targetHp;
        if (formulaKey === 'health_cost') return Number(rawRank('zac_w', 'HPCost', level).toFixed(2)) * scenario.runtime.zac_w.source_current_hp_for_cost;
  }
  if (skillKey === 'zac_e') {
        if (formulaKey === 'damage') return rawRank('zac_e', 'BaseDamage', level) + Number(rawPart('zac_e', 'Damage', 1).mCoefficient.toFixed(1)) * ap;
    if (formulaKey === 'maximum_stun_duration') return rawRank('zac_e', 'MinimumStun', level) * 1000 * rawPart('zac_e', 'MaxStun', 0).mPart2.mNumber;
        if (formulaKey === 'health_cost') return Number(rawRank('zac_e', 'HPCost', level).toFixed(2)) * scenario.runtime.zac_e.source_current_hp_for_cost;
  }
  if (skillKey === 'zac_r') {
        const bounce = rawRank('zac_r', 'BaseDamageBounce', level) + Number(rawRank('zac_r', 'BounceAPRatioTooltip', level).toFixed(1)) * ap;
    const bounces = rawRank('zac_r', 'Bounces', level);
        const subsequent = Number(rawRank('zac_r', 'DamageReductionBounce', level).toFixed(1)) * bounce;
    if (formulaKey === 'damage_per_bounce') return bounce;
    if (formulaKey === 'damage_per_subsequent_bounce') return subsequent;
    if (formulaKey === 'duration_tooltip_ms') return rawRank('zac_r', 'TimeBetweenBounces', level) * 1000 * (bounces - 1);
    if (formulaKey === 'max_damage_tooltip') return bounce + subsequent * (bounces - 1);
  }
  throw new Error(`没有独立期望值：${skillKey}/${formulaKey}`);
};

const formulaChecks = [];
for (const skillKey of skillKeys) {
  for (const formula of skills[skillKey].write.formulas) {
    const cases = scenarios.map(scenario => {
      const actual = evaluate(skillKey, formula.expression, scenario);
      const expected = expectedFormula(skillKey, formula.formulaKey, scenario);
      assert(Number.isFinite(actual) && nearly(actual, expected, 1e-7), '公式实算与独立来源期望不符', { skillKey, formulaKey: formula.formulaKey, scenario: scenario.id, actual, expected });
      return { scenario: scenario.id, level: levelOf(skillKey, scenario), actual, expected, passed: true };
    });
    formulaChecks.push({ skillKey, formulaKey: formula.formulaKey, cases, sourceExpected: '由绑定客户端DataValues/mSpellCalculations独立计算' });
  }
}
assert(formulaChecks.length === 22 && formulaChecks.every(item => item.cases.length === 2), '公式正例覆盖不足', { formulaCount: formulaChecks.length });

const missingChecks = [];
const expectReject = (label, fn) => {
  try { fn(); } catch (error) { missingChecks.push({ label, rejected: true, error: String(error.message).slice(0, 200) }); return; }
  throw new Error(`缺值测试未拒绝：${label}`);
};
for (const skillKey of skillKeys) {
  for (const formula of skills[skillKey].write.formulas) {
    const nodes = collectNodes(formula.expression);
    const runtimeParams = [...new Set(nodes.parameters.filter(key => parameter(skillKey, key).valueMode === 'RUNTIME_INPUT'))];
    for (const key of runtimeParams) {
      const missingScenario = clone(scenarioA);
      delete missingScenario.runtime?.[skillKey]?.[key];
      expectReject(`${skillKey}/${formula.formulaKey}/缺少${key}`, () => evaluate(skillKey, formula.expression, missingScenario));
    }
    const attrs = [...new Set(nodes.attributes)];
    for (const attr of attrs) {
      const [owner, key, kind] = attr.split('.');
      const missingScenario = clone(scenarioA);
      delete missingScenario.attributes?.[owner]?.[key]?.[kind];
      expectReject(`${skillKey}/${formula.formulaKey}/缺少${attr}`, () => evaluate(skillKey, formula.expression, missingScenario));
    }
  }
}
const integerNormalizationChecks = [
  { skillKey: 'zac_r', parameterKey: 'slow_percent_points', sourceValue: rawFixed('zac_r', 'SlowAmount') * 100, candidateValue: parameter('zac_r', 'slow_percent_points').fixedValue, expected: 20 },
];
for (const item of integerNormalizationChecks) {
  assert(Number.isInteger(item.candidateValue) && item.candidateValue === item.expected, '整数百分数点归一错误', item);
}
const integerHalfChecks = [];
for (const [skillKey, parameterKey, formulaKey] of [['amumu_q', 'max_charges', 'total_damage'], ['zac_r', 'bounce_count', 'duration_tooltip_ms'], ['zac_e', 'maximum_stun_multiplier', 'maximum_stun_duration']]) {
  expectReject(`${skillKey}/${parameterKey}=0.5`, () => readParameter(skillKey, parameterKey, scenarioA, { [skillKey]: { [parameterKey]: 0.5 } }));
  integerHalfChecks.push({ skillKey, parameterKey, rejected: true, attemptedValue: 0.5 });
}

const capCases = [
  { label: '阿木木E等级1额外护甲100额外魔抗200承受10', scenario: { ...clone(scenarioA), levels: { ...scenarioA.levels, amumu_e: 1 }, runtime: { ...clone(scenarioA.runtime), amumu_e: { incoming_physical_damage: 10, source_bonus_armor: 100, source_bonus_magic_resistance: 200 } } }, rawExpected: 14, expected: 5 },
  { label: '阿木木E等级1额外护甲100额外魔抗200承受100', scenario: { ...clone(scenarioA), levels: { ...scenarioA.levels, amumu_e: 1 }, runtime: { ...clone(scenarioA.runtime), amumu_e: { incoming_physical_damage: 100, source_bonus_armor: 100, source_bonus_magic_resistance: 200 } } }, rawExpected: 14, expected: 14 },
  { label: '阿木木E等级1额外护甲100额外魔抗200承受1000', scenario: { ...clone(scenarioA), levels: { ...scenarioA.levels, amumu_e: 1 }, runtime: { ...clone(scenarioA.runtime), amumu_e: { incoming_physical_damage: 1000, source_bonus_armor: 100, source_bonus_magic_resistance: 200 } } }, rawExpected: 14, expected: 14 },
  { label: '阿木木E等级5无额外属性承受100', scenario: { ...clone(scenarioA), levels: { ...scenarioA.levels, amumu_e: 5 }, runtime: { ...clone(scenarioA.runtime), amumu_e: { incoming_physical_damage: 100, source_bonus_armor: 0, source_bonus_magic_resistance: 0 } } }, rawExpected: 13, expected: 13 },
  { label: '阿木木E等级5高额属性承受100', scenario: { ...clone(scenarioA), levels: { ...scenarioA.levels, amumu_e: 5 }, runtime: { ...clone(scenarioA.runtime), amumu_e: { incoming_physical_damage: 100, source_bonus_armor: 2000, source_bonus_magic_resistance: 2000 } } }, rawExpected: 133, expected: 50 },
];
const capChecks = capCases.map(item => {
  const formula = skills.amumu_e.write.formulas.find(formulaItem => formulaItem.formulaKey === 'capped_physical_damage_reduction');
  const rawFormula = skills.amumu_e.write.formulas.find(formulaItem => formulaItem.formulaKey === 'raw_physical_damage_reduction');
  const rawActual = evaluate('amumu_e', rawFormula.expression, item.scenario);
  const actual = evaluate('amumu_e', formula.expression, item.scenario);
  assert(nearly(rawActual, item.rawExpected), '阿木木E固定减免点数错误', { label: item.label, rawActual, rawExpected: item.rawExpected });
  assert(nearly(actual, item.expected), '阿木木E封顶边界错误', { label: item.label, actual, expected: item.expected });
  return { label: item.label, rawActual, rawExpected: item.rawExpected, actual, expected: item.expected, passed: true };
});

const result = {
  at: verificationAt,
  inputFrozenAt: inputVersion.at,
  batch: candidate.meta.batch,
  candidateSha256: sha256(candidateBytes),
  formulaCount: formulaChecks.length,
  positiveCaseCount: formulaChecks.reduce((sum, item) => sum + item.cases.length, 0),
  positivePassed: formulaChecks.reduce((sum, item) => sum + item.cases.filter(test => test.passed).length, 0),
  formulaChecks,
  missingValueChecks: missingChecks,
  missingValueRejected: missingChecks.length,
  integerNormalizationChecks,
  integerHalfChecks,
  capChecks,
  binaryOperationCount: operationArityChecks.length,
  binaryOperationArityPassed: true,
  arrayChecks: arrayChecks.map(item => ({ label: item.label, actual: item.actual, expected: item.expected, passed: true })),
  modifierChecks: modifierChecks.map(item => ({ label: item.label, actual: item.actual, expected: item.expected, passed: true })),
  candidateMathReady: true,
  businessMathReady: false,
  businessMathReason: '没有业务GET或实际保存后的公式详情；本报告只证明最终候选表达式树可独立求值。',
  apiWrites: 0,
  source: '客户端16.17冻结根绑定与官方16.17.1交叉文本',
};
const resultText = `${JSON.stringify(result, null, 2)}\n`;
const outputs = [
  writeOnce(path.join(artifactDir, '独立数学核算.json'), resultText),
  writeOnce(path.join(planningDir, '独立数学核算.json'), resultText),
];
console.log(JSON.stringify({
  candidateSha256: result.candidateSha256,
  formulaCount: result.formulaCount,
  positiveCaseCount: result.positiveCaseCount,
  positivePassed: result.positivePassed,
  missingValueRejected: result.missingValueRejected,
  integerHalfChecks: result.integerHalfChecks.length,
  capChecks: result.capChecks.length,
  candidateMathReady: result.candidateMathReady,
  businessMathReady: result.businessMathReady,
  apiWrites: 0,
  outputs: outputs.map(item => ({ path: item.path, sha256: item.sha256, existed: item.existed })),
}, null, 2));
