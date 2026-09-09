import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const artifact = 'C:/project/damage_web_dev/.agents/artifacts/hero22-candidate';
const planning = 'C:/project/damage_web_dev/数据参考/全量录入-2026-09/交叉试录/Luna/英雄机制第二十二批';
const candidateFile = path.join(artifact, '最终候选.json');
const sourceFile = path.join(artifact, '候选源值核对.json');
const candidate = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const now = new Date().toISOString();
const checkRows = [];
const formulaChecks = [];
const rejectionChecks = [];
const boundaryChecks = [];
function round(value, digits = 6) {
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}
function sameNumber(left, right) { return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-9; }
function check(name, passed, detail = null) {
  checkRows.push({ name, passed: Boolean(passed), detail });
  return Boolean(passed);
}
function raw(skillKey) {
  const value = source.skills[skillKey];
  if (!value) throw new Error('缺少源值：' + skillKey);
  return value;
}
function namedDataValue(skillKey, calculationKey, partIndex = 0) {
  const value = raw(skillKey).calculations?.[calculationKey]?.mFormulaParts?.[partIndex]?.mDataValue;
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${skillKey}.${calculationKey}缺少第${partIndex}个NamedDataValue`);
  return value;
}
function data(skillKey, name, rank) {
  const values = raw(skillKey).dataValues?.[name];
  if (!Array.isArray(values)) throw new Error(skillKey + '缺少DataValues.' + name);
  if (!Number.isInteger(rank)) throw new Error('缺少技能等级');
  const value = values[rank];
  if (value === undefined) throw new Error(skillKey + '.' + name + '等级' + rank + '缺失');
  return round(value);
}
function characterData(skillKey, name, level) {
  const values = raw(skillKey).calculations?.[name]?.mFormulaParts?.[0]?.values;
  if (!Array.isArray(values) || values[level - 1] === undefined) throw new Error(skillKey + '.' + name + '角色等级' + level + '缺失');
  return round(values[level - 1]);
}
function parameterValue(skillKey, key, env) {
  const rows = candidate.skills[skillKey].write.parameters;
  const row = rows.find(item => item.parameterKey === key);
  if (!row) throw new Error('候选参数缺失：' + skillKey + '/' + key);
  if (row.valueMode === 'FIXED') return row.fixedValue;
  if (row.valueMode === 'SKILL_LEVEL') {
    const value = row.levelValues?.[String(env.rank)];
    if (value === undefined) throw new Error('缺少技能等级输入：' + skillKey + '/' + key);
    return value;
  }
  if (row.valueMode === 'CHARACTER_LEVEL') {
    const value = row.levelValues?.[String(env.characterLevel)];
    if (value === undefined) throw new Error('缺少角色等级输入：' + skillKey + '/' + key);
    return value;
  }
  if (row.valueMode === 'RUNTIME_INPUT') {
    if (!env.runtime || env.runtime[key] === undefined) throw new Error('缺少运行时输入：' + skillKey + '/' + key);
    return env.runtime[key];
  }
  throw new Error('不支持参数模式：' + row.valueMode);
}
function attributeValue(node, env) {
  const key = [node.attributeOwner, node.attributeKey, node.attributeValueKind].join('|');
  if (!env.attributes || env.attributes[key] === undefined) throw new Error('缺少属性输入：' + key);
  return env.attributes[key];
}
function evaluateNode(node, skillKey, env) {
  if (!node || typeof node !== 'object') throw new Error('空表达式节点');
  if (node.nodeType === 'PARAMETER') return parameterValue(skillKey, node.parameterKey, env);
  if (node.nodeType === 'ATTRIBUTE') return attributeValue(node, env);
  if (node.nodeType === 'OPERATION') {
    const values = node.operands.map(item => evaluateNode(item, skillKey, env));
    if (node.operation === 'ADD') return values[0] + values[1];
    if (node.operation === 'SUBTRACT') return values[0] - values[1];
    if (node.operation === 'MULTIPLY') return values[0] * values[1];
    if (node.operation === 'DIVIDE') return values[0] / values[1];
    if (node.operation === 'MIN') return Math.min(...values);
    if (node.operation === 'MAX') return Math.max(...values);
    throw new Error('未知运算：' + node.operation);
  }
  throw new Error('未知节点：' + node.nodeType);
}
function evaluateFormula(skillKey, formulaKey, env) {
  const row = candidate.skills[skillKey].write.formulas.find(item => item.formulaKey === formulaKey);
  if (!row) throw new Error('候选公式缺失：' + skillKey + '/' + formulaKey);
  return evaluateNode(row.expression, skillKey, env);
}
function attr(owner, key, kind, value) { return { [owner + '|' + key + '|' + kind]: value }; }
function env(rank, extra = {}) { return { rank, ...extra }; }
function formulaCase(skillKey, formulaKey, cases) {
  for (const item of cases) {
    let candidateValue = null;
    let error = null;
    try {
      candidateValue = evaluateFormula(skillKey, formulaKey, item.input);
    } catch (err) {
      error = String(err?.message ?? err);
    }
    const passed = error === null && sameNumber(candidateValue, item.expected);
    const row = { skillKey, formulaKey, caseId: item.caseId, input: item.input, candidateValue, sourceExpected: item.expected, passed, error };
    formulaChecks.push(row);
    check(skillKey + '/' + formulaKey + '/' + item.caseId, passed, row);
  }
}
const leonaMrDataValue = namedDataValue('leona_w', 'BonusMRTooltip');
check('Leona W BonusMR树实际引用ArmorBaseBonus', leonaMrDataValue === 'ArmorBaseBonus', { calculation: 'BonusMRTooltip', actualDataValue: leonaMrDataValue, expectedDataValue: 'ArmorBaseBonus' });
const specs = [
  {
    skillKey: 'leona_q', formulaKey: 'magic_damage',
    cases: [
      { caseId: 'A', input: env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), expected: data('leona_q', 'BaseDamage', 1) },
      { caseId: 'B', input: env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 600) }), expected: data('leona_q', 'BaseDamage', 5) + 0.3 * 600 }
    ]
  },
  {
    skillKey: 'leona_w', formulaKey: 'magic_damage',
    cases: [
      { caseId: 'A', input: env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), expected: data('leona_w', 'ExplosionBaseDamage', 1) },
      { caseId: 'B', input: env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 400) }), expected: data('leona_w', 'ExplosionBaseDamage', 5) + 0.4 * 400 }
    ]
  },
  {
    skillKey: 'leona_w', formulaKey: 'bonus_armor',
    cases: [
      { caseId: 'A', input: env(1, { runtime: { source_mstat1_for_armor_bonus: 0 } }), expected: data('leona_w', 'ArmorBaseBonus', 1) },
      { caseId: 'B', input: env(5, { runtime: { source_mstat1_for_armor_bonus: 100 } }), expected: data('leona_w', 'ArmorBaseBonus', 5) + 0.2 * 100 }
    ]
  },
  {
    skillKey: 'leona_w', formulaKey: 'bonus_magic_resistance',
    cases: [
      { caseId: 'A', input: env(1, { attributes: attr('SOURCE', 'magic_resistance', 'BONUS', 0) }), expected: data('leona_w', leonaMrDataValue, 1) },
      { caseId: 'B', input: env(5, { attributes: attr('SOURCE', 'magic_resistance', 'BONUS', 100) }), expected: data('leona_w', leonaMrDataValue, 5) + 0.2 * 100 }
    ]
  },
  {
    skillKey: 'leona_w', formulaKey: 'damage_reduction_amount',
    cases: [
      { caseId: 'A', input: env(1, { runtime: { incoming_damage_for_reduction: 10 } }), expected: Math.min(data('leona_w', 'FlatDamageReduction', 1), 0.5 * 10) },
      { caseId: 'B', input: env(5, { runtime: { incoming_damage_for_reduction: 100 } }), expected: Math.min(data('leona_w', 'FlatDamageReduction', 5), 0.5 * 100) }
    ]
  },
  {
    skillKey: 'leona_e', formulaKey: 'magic_damage',
    cases: [
      { caseId: 'A', input: env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), expected: data('leona_e', 'BaseDamage', 1) },
      { caseId: 'B', input: env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 250) }), expected: data('leona_e', 'BaseDamage', 5) + 0.4 * 250 }
    ]
  },
  {
    skillKey: 'leona_r', formulaKey: 'magic_damage',
    cases: [
      { caseId: 'A', input: env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), expected: data('leona_r', 'ExplosionBaseDamage', 1) },
      { caseId: 'B', input: env(3, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 500) }), expected: data('leona_r', 'ExplosionBaseDamage', 3) + 0.8 * 500 }
    ]
  },
  {
    skillKey: 'nautilus_p', formulaKey: 'physical_damage',
    cases: [
      { caseId: 'A', input: env(null, { characterLevel: 1, attributes: attr('SOURCE', 'attack_damage', 'TOTAL', 0) }), expected: characterData('nautilus_p', 'BonusDamage', 1) },
      { caseId: 'B', input: env(null, { characterLevel: 18, attributes: attr('SOURCE', 'attack_damage', 'TOTAL', 200) }), expected: characterData('nautilus_p', 'BonusDamage', 18) + 200 }
    ]
  },
  {
    skillKey: 'nautilus_q', formulaKey: 'magic_damage',
    cases: [
      { caseId: 'A', input: env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), expected: data('nautilus_q', 'BaseDamage', 1) },
      { caseId: 'B', input: env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 400) }), expected: data('nautilus_q', 'BaseDamage', 5) + 0.9 * 400 }
    ]
  },
  {
    skillKey: 'nautilus_w', formulaKey: 'shield_value',
    cases: [
      { caseId: 'A', input: env(1, { attributes: attr('SOURCE', 'hp', 'TOTAL', 0) }), expected: data('nautilus_w', 'ShieldBase', 1) },
      { caseId: 'B', input: env(5, { attributes: attr('SOURCE', 'hp', 'TOTAL', 3000) }), expected: data('nautilus_w', 'ShieldBase', 5) + data('nautilus_w', 'ShieldHealthRatio', 5) * 3000 }
    ]
  },
  {
    skillKey: 'nautilus_w', formulaKey: 'bonus_magic_damage_total',
    cases: [
      { caseId: 'A', input: env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), expected: data('nautilus_w', 'DotDamageBase', 1) },
      { caseId: 'B', input: env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 300) }), expected: data('nautilus_w', 'DotDamageBase', 5) + 0.4 * 300 }
    ]
  },
  {
    skillKey: 'nautilus_e', formulaKey: 'magic_damage',
    cases: [
      { caseId: 'A', input: env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), expected: data('nautilus_e', 'DamageBase', 1) },
      { caseId: 'B', input: env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 200) }), expected: data('nautilus_e', 'DamageBase', 5) + 0.5 * 200 }
    ]
  },
  {
    skillKey: 'nautilus_e', formulaKey: 'later_wave_magic_damage',
    cases: [
      { caseId: 'A', input: env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), expected: (1 - 0.5) * data('nautilus_e', 'DamageBase', 1) },
      { caseId: 'B', input: env(5, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 200) }), expected: (1 - 0.5) * (data('nautilus_e', 'DamageBase', 5) + 0.5 * 200) }
    ]
  },
  {
    skillKey: 'nautilus_r', formulaKey: 'primary_magic_damage',
    cases: [
      { caseId: 'A', input: env(1, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 0) }), expected: data('nautilus_r', 'PrimaryDamage', 1) },
      { caseId: 'B', input: env(3, { attributes: attr('SOURCE', 'ability_power', 'TOTAL', 400) }), expected: data('nautilus_r', 'PrimaryDamage', 3) + 0.8 * 400 }
    ]
  }
];
for (const spec of specs) formulaCase(spec.skillKey, spec.formulaKey, spec.cases);

for (const item of [
  ['Leona P整槽范围移除', candidate.skills.leona_p.write.parameters.length === 0 && candidate.skills.leona_p.write.formulas.length === 0 && candidate.skills.leona_p.excluded.length > 0],
  ['Nautilus R沿途支路移除', !candidate.skills.nautilus_r.write.parameters.some(p => ['secondary_damage', 'secondary_ap_ratio'].includes(p.parameterKey)) && !candidate.skills.nautilus_r.write.formulas.some(f => f.formulaKey === 'secondary_magic_damage')],
  ['八个主动法力效果', ['leona_q','leona_w','leona_e','leona_r','nautilus_q','nautilus_w','nautilus_e','nautilus_r'].every(key => candidate.skills[key].write.effects.some(effect => effect.effectKey === 'mana_cost'))],
  ['Nautilus W自身护盾结构', candidate.skills.nautilus_w.write.effects.some(effect => effect.effectKey === 'shield' && effect.lifecycle?.durationValue?.kind === 'PARAMETER' && effect.lifecycle.durationValue.parameterKey === 'shield_duration_ms' && effect.results?.[0]?.resultType === 'NORMAL_SHIELD')],
  ['未创建直接结果', !candidate.order.some(key => candidate.skills[key].write.effects.some(effect => effect.results?.some(result => ['DAMAGE', 'DIRECT_HEAL'].includes(result.resultType))))],
  ['未创建第三友军P公式', candidate.skills.leona_p.write.formulas.length === 0]
].map(([name, passed]) => check(name, passed)));

for (const [skillKey, spellCastTime, mCastTime] of [
  ['leona_q', 0.5217499732971191, 0.25],
  ['nautilus_r', 0.25, 0.46000000834465027]
]) {
  const cast = candidate.skills[skillKey].write.parameters.find(item => item.parameterKey === 'cast_time_ms');
  check(`${skillKey}冲突施法时间无默认`, cast?.valueType === 'INTEGER' && cast?.valueMode === 'RUNTIME_INPUT' && cast?.fixedValue === null && cast?.levelValues === null && cast?.description?.includes(`spellCastTime=${spellCastTime}`) && cast?.description?.includes(`mCastTime=${mCastTime}`), cast);
}

const missingCases = [
  { id: '缺少Leona W进入伤害', skillKey: 'leona_w', formulaKey: 'damage_reduction_amount', input: env(5) },
  { id: '缺少Leona W未映射护甲属性', skillKey: 'leona_w', formulaKey: 'bonus_armor', input: env(5) },
  { id: '缺少Leona W额外魔抗属性', skillKey: 'leona_w', formulaKey: 'bonus_magic_resistance', input: env(5) },
  { id: '缺少Nautilus W总生命属性', skillKey: 'nautilus_w', formulaKey: 'shield_value', input: env(5) },
  { id: '缺少Nautilus P总攻击力属性', skillKey: 'nautilus_p', formulaKey: 'physical_damage', input: env(null, { characterLevel: 18 }) },
  { id: '缺少Leona Q法术强度属性', skillKey: 'leona_q', formulaKey: 'magic_damage', input: env(5) }
];
for (const item of missingCases) {
  let rejected = false;
  let error = null;
  try { evaluateFormula(item.skillKey, item.formulaKey, item.input); } catch (err) { rejected = true; error = String(err?.message ?? err); }
  const row = { ...item, rejected, error };
  rejectionChecks.push(row);
  check(item.id, rejected, row);
}

for (const input of [0, 10, 1000]) {
  const actual = evaluateFormula('leona_w', 'damage_reduction_amount', env(5, { runtime: { incoming_damage_for_reduction: input } }));
  const expected = Math.min(data('leona_w', 'FlatDamageReduction', 5), 0.5 * input);
  const row = { input, actual, expected, passed: sameNumber(actual, expected) };
  boundaryChecks.push(row);
  check('Leona W减免边界输入' + input, row.passed, row);
}

const expectedFormulaKeys = specs.map(item => item.skillKey + '/' + item.formulaKey).sort();
const actualFormulaKeys = candidate.order.flatMap(skillKey => candidate.skills[skillKey].write.formulas.map(row => skillKey + '/' + row.formulaKey)).sort();
check('最终公式集合完整且无额外项', JSON.stringify(expectedFormulaKeys) === JSON.stringify(actualFormulaKeys), { expectedFormulaKeys, actualFormulaKeys });
const failures = checkRows.filter(row => !row.passed);
const output = {
  generatedAt: now,
  revision: '最终版（承接修订二）',
  candidateFile,
  sourceFile,
  sourceVersion: source.sourceVersion,
  candidateSha256: createHash('sha256').update(fs.readFileSync(candidateFile)).digest('hex'),
  sourceTreeBasis: { skillKey: 'leona_w', calculationKey: 'BonusMRTooltip', dataValue: leonaMrDataValue, note: '当前绑定树实际使用ArmorBaseBonus；候选本体保留原参数键和值，数学期望按此树读取。' },
  independentFromCandidateFormula: false,
  independentSourceExpectation: true,
  businessWrites: 0,
  formulaChecks,
  rejectionChecks,
  boundaryChecks,
  structuralChecks: checkRows.filter(row => !formulaChecks.includes(row) && !rejectionChecks.includes(row) && !boundaryChecks.includes(row)),
  summary: {
    finalFormulaCount: actualFormulaKeys.length,
    formulaCases: formulaChecks.length,
    expectedCases: specs.length * 2,
    rejectionCases: rejectionChecks.length,
    boundaryCases: boundaryChecks.length,
    checks: checkRows.length,
    failures: failures.length,
    passed: failures.length === 0
  }
};
function writeOnce(file, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (fs.existsSync(file)) {
    const old = fs.readFileSync(file);
    if (!old.equals(bytes)) throw new Error('结果文件已存在且字节不同，拒绝覆盖：' + file);
    return;
  }
  fs.writeFileSync(file, bytes, { flag: 'wx' });
}
writeOnce(path.join(artifact, '最终严格数学.json'), output);
writeOnce(path.join(planning, '最终严格数学.json'), output);
console.log(JSON.stringify(output.summary, null, 2));
if (failures.length) process.exitCode = 1;
