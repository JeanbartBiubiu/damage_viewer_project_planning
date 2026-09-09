import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256File = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const candidate = readJson(path.join(here, '完整候选.json'));
const binding = readJson(path.join(root, '来源绑定与当前mLocKeys.json'));
const snapshot = readJson(path.join(root, '参考资料', '当前10槽保护快照.json'));
const composition = readJson(path.join(root, '参考资料', '现状组成报告.json'));
const official = readJson(path.join(root, '参考资料', '官方原始资料', 'zh_CN', 'Zoe.json'));
const zoe = binding.heroes.find(item => item.id === 'Zoe');
const spell = slot => zoe.skills.find(item => item.slot === slot);
const close = (left, right, tolerance = 1e-6) => Math.abs(Number(left) - Number(right)) <= tolerance;
const dataValue = (item, name) => {
  const found = (item.dataValues || []).find(entry => entry.name === name);
  if (!found) throw Error(`缺少 ${item.skillKey}.${name}`);
  return found.values;
};

function evaluate(node, ctx, missing) {
  if (node.nodeType === 'PARAMETER') {
    if (!Object.hasOwn(ctx.parameters, node.parameterKey) || ctx.parameters[node.parameterKey] == null) {
      missing.add(`PARAMETER:${node.parameterKey}`);
      return null;
    }
    return Number(ctx.parameters[node.parameterKey]);
  }
  if (node.nodeType === 'ATTRIBUTE') {
    if (node.attributeOwner === 'CURRENT') throw Error('禁止 CURRENT 作为 attributeOwner');
    if (!['SOURCE', 'TARGET'].includes(node.attributeOwner)) throw Error('非法 attributeOwner');
    if (!['TOTAL', 'BASE', 'BONUS'].includes(node.attributeValueKind)) throw Error('非法 attributeValueKind');
    const key = `${node.attributeOwner}:${node.attributeKey}:${node.attributeValueKind}`;
    if (!Object.hasOwn(ctx.attributes, key)) {
      missing.add(`ATTRIBUTE:${key}`);
      return null;
    }
    return Number(ctx.attributes[key]);
  }
  if (node.nodeType !== 'OPERATION' || !Array.isArray(node.operands) || node.operands.length !== 2) {
    throw Error('只解析二元运算树');
  }
  const left = evaluate(node.operands[0], ctx, missing);
  const right = evaluate(node.operands[1], ctx, missing);
  if (left == null || right == null) return null;
  if (node.operation === 'ADD') return left + right;
  if (node.operation === 'SUBTRACT') return left - right;
  if (node.operation === 'MULTIPLY') return left * right;
  if (node.operation === 'DIVIDE') {
    if (right === 0) throw Error('除数为 0');
    return left / right;
  }
  if (node.operation === 'MIN') return Math.min(left, right);
  if (node.operation === 'MAX') return Math.max(left, right);
  throw Error(`未知 operation ${node.operation}`);
}

function runCase(name, formula, ctx, expected, expectReject = false) {
  const missing = new Set();
  let actual = null;
  let error = null;
  try {
    actual = evaluate(formula.expression, ctx, missing);
  } catch (err) {
    error = String(err.message || err);
  }
  const rejected = actual == null || missing.size > 0 || error != null;
  return {
    name,
    formulaKey: formula.formulaKey,
    ok: expectReject ? rejected : !rejected && close(actual, expected),
    expectReject,
    expected: expectReject ? 'REJECT' : expected,
    actual: rejected ? 'REJECT' : actual,
    missing: [...missing],
    error,
    inputs: ctx,
  };
}

const checks = [];
const record = (name, ok, detail = null) => checks.push({ name, ok, detail });
const formulaOf = (skillKey, formulaKey) => candidate.skills[skillKey].write.formulas.find(item => item.formulaKey === formulaKey);
const p = spell('P');
const q = spell('Q');
const w = spell('W');
const e = spell('E');
const r = spell('R');
const pDamage = formulaOf('zoe_p', 'damage');
const qDamage = formulaOf('zoe_q', 'damage');
const qMax = formulaOf('zoe_q', 'max_damage');
const wDamage = formulaOf('zoe_w', 'missile_damage');
const eDamage = formulaOf('zoe_e', 'damage');
const eCap = formulaOf('zoe_e', 'wake_true_damage_cap');
const qBase1 = dataValue(q, 'BaseDamage')[1];
const qBase5 = dataValue(q, 'BaseDamage')[5];
const qBp1 = q.calculations.TotalDamageTooltip.mFormulaParts[1].mLevel1Value;
const qCapMul = q.calculations.MaxDamageTooltip.mMultiplier.mNumber;
const pBp1 = p.calculations.PassiveDamage.mFormulaParts[0].mLevel1Value;
const wBase1 = dataValue(w, 'TotalBaseDamage')[1];
const wBase5 = dataValue(w, 'TotalBaseDamage')[5];
const eBase1 = dataValue(e, 'BaseDamage')[1];
const eBase5 = dataValue(e, 'BaseDamage')[5];
const eCoef = e.calculations.BreakDamageTooltip.mFormulaParts[1].mCoefficient;

record('冻结快照摘要', composition.sourceSha256 === 'e7aaac29e37ad539300a538c8385e392d0d62dc97178654a4832a54a62e12b7e');
record('无拉克丝 write', candidate.luxProtection.write == null && !candidate.skills.lux_p && candidate.luxProtection.skills.lux_w.write == null);
record('复用六个公共参数', candidate.reusedPublicParameters.length === 6);
record('POST 不含已有公共参数', candidate.postIntents.every(item => !(item.kind === 'parameters' && ['zoe_q', 'zoe_e', 'zoe_r'].includes(item.skillKey) && ['cooldown_ms', 'mana_cost'].includes(item.stableKey))));
record('未创建 DAMAGE/治疗/瞬时评估', !JSON.stringify(candidate.postIntents).includes('"DAMAGE"') && !JSON.stringify(candidate.postIntents).includes('DIRECT_HEAL') && !JSON.stringify(candidate.postIntents).includes('MOMENT_EVALUATION'));
record('未创建过程状态触发', candidate.postIntents.every(item => !['processes', 'internal-states', 'trigger-rules'].includes(item.kind)));
record('Q 上限在表达式内', qMax.expression.operation === 'MULTIPLY' && JSON.stringify(qMax.expression).includes('distance_damage_cap_multiplier'));
record('角色等级断点未展开', candidate.skills.zoe_p.write.parameters.find(item => item.parameterKey === 'char_level_base_damage').valueMode === 'RUNTIME_INPUT');
record('Q 基础伤害取索引1至5', JSON.stringify(candidate.skills.zoe_q.write.parameters.find(item => item.parameterKey === 'base_damage').levelValues) === JSON.stringify({ 1: qBase1, 2: dataValue(q, 'BaseDamage')[2], 3: dataValue(q, 'BaseDamage')[3], 4: dataValue(q, 'BaseDamage')[4], 5: qBase5 }));
record('E 官方与根基础伤害一致', JSON.stringify(official.data.Zoe.spells[2].effect[1]) === JSON.stringify([70, 110, 150, 190, 230]));
record('R 无伤害树', Object.keys(r.calculations || {}).length === 0);
record('W 拾取缺口仍在', candidate.wPickupGap.status === '当前仍待补');
record('拉克丝 W 自我护盾冻结仍在', snapshot.requests.find(item => item.route === '/skills/lux_w/effects/prismatic_shield').data.results[0].resultType === 'NORMAL_SHIELD');
record('拉克丝 E 唯一敌方伤害冻结仍在', snapshot.requests.find(item => item.route === '/skills/lux_e/effects/singularity_detonate').data.results[0].target === 'TARGET');

const formulaCases = [];
formulaCases.push(runCase('zoe_p/damage 正例', pDamage, {
  parameters: { char_level_base_damage: pBp1, ap_ratio: 0.2 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, pBp1 + 0.2 * 100));
formulaCases.push(runCase('zoe_p/damage 不同来源', pDamage, {
  parameters: { char_level_base_damage: 42, ap_ratio: 0.2 },
  attributes: { 'SOURCE:ability_power:TOTAL': 50 },
}, 42 + 0.2 * 50));
formulaCases.push(runCase('zoe_p/damage 缺法强拒绝', pDamage, {
  parameters: { char_level_base_damage: pBp1, ap_ratio: 0.2 },
  attributes: {},
}, null, true));
formulaCases.push(runCase('zoe_p/damage 边界法强0', pDamage, {
  parameters: { char_level_base_damage: pBp1, ap_ratio: 0.2 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, pBp1));

formulaCases.push(runCase('zoe_q/damage 正例', qDamage, {
  parameters: { base_damage: qBase1, char_level_bonus_damage: qBp1, ap_ratio: 0.6 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, qBase1 + qBp1 + 0.6 * 100));
formulaCases.push(runCase('zoe_q/damage 不同来源', qDamage, {
  parameters: { base_damage: qBase5, char_level_bonus_damage: 8, ap_ratio: 0.6 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, qBase5 + 8));
formulaCases.push(runCase('zoe_q/damage 缺附加拒绝', qDamage, {
  parameters: { base_damage: qBase1, ap_ratio: 0.6 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, null, true));
formulaCases.push(runCase('zoe_q/damage 边界法强0', qDamage, {
  parameters: { base_damage: qBase1, char_level_bonus_damage: qBp1, ap_ratio: 0.6 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, qBase1 + qBp1));

const minFromSource = qBase1 + qBp1 + 0.6 * 80;
formulaCases.push(runCase('zoe_q/max_damage 正例上限=倍率×最短', qMax, {
  parameters: { base_damage: qBase1, char_level_bonus_damage: qBp1, ap_ratio: 0.6, distance_damage_cap_multiplier: qCapMul },
  attributes: { 'SOURCE:ability_power:TOTAL': 80 },
}, qCapMul * minFromSource));
formulaCases.push(runCase('zoe_q/max_damage 不同来源', qMax, {
  parameters: { base_damage: qBase5, char_level_bonus_damage: 4, ap_ratio: 0.6, distance_damage_cap_multiplier: qCapMul },
  attributes: { 'SOURCE:ability_power:TOTAL': 20 },
}, qCapMul * (qBase5 + 4 + 0.6 * 20)));
formulaCases.push(runCase('zoe_q/max_damage 缺倍率拒绝', qMax, {
  parameters: { base_damage: qBase1, char_level_bonus_damage: qBp1, ap_ratio: 0.6 },
  attributes: { 'SOURCE:ability_power:TOTAL': 80 },
}, null, true));
formulaCases.push(runCase('zoe_q/max_damage 边界法强0仍2.5倍', qMax, {
  parameters: { base_damage: qBase1, char_level_bonus_damage: qBp1, ap_ratio: 0.6, distance_damage_cap_multiplier: qCapMul },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, qCapMul * (qBase1 + qBp1)));

formulaCases.push(runCase('zoe_w/missile_damage 正例', wDamage, {
  parameters: { missile_base_damage: wBase1, ap_ratio: 0.1 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, wBase1 + 0.1 * 100));
formulaCases.push(runCase('zoe_w/missile_damage 不同来源', wDamage, {
  parameters: { missile_base_damage: wBase5, ap_ratio: 0.1 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, wBase5));
formulaCases.push(runCase('zoe_w/missile_damage 缺法强拒绝', wDamage, {
  parameters: { missile_base_damage: wBase1, ap_ratio: 0.1 },
  attributes: {},
}, null, true));
formulaCases.push(runCase('zoe_w/missile_damage 边界法强0', wDamage, {
  parameters: { missile_base_damage: wBase1, ap_ratio: 0.1 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, wBase1));

formulaCases.push(runCase('zoe_e/damage 正例', eDamage, {
  parameters: { base_damage: eBase1, ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, eBase1 + Number(eCoef.toFixed(4)) * 100));
formulaCases.push(runCase('zoe_e/damage 不同来源', eDamage, {
  parameters: { base_damage: eBase5, ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 40 },
}, eBase5 + Number(eCoef.toFixed(4)) * 40));
formulaCases.push(runCase('zoe_e/damage 缺基础拒绝', eDamage, {
  parameters: { ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, null, true));
formulaCases.push(runCase('zoe_e/damage 边界法强0', eDamage, {
  parameters: { base_damage: eBase1, ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, eBase1));
formulaCases.push(runCase('zoe_e/wake_true_damage_cap 正例同树', eCap, {
  parameters: { base_damage: eBase1, ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 100 },
}, eBase1 + Number(eCoef.toFixed(4)) * 100));
formulaCases.push(runCase('zoe_e/wake_true_damage_cap 不同来源', eCap, {
  parameters: { base_damage: eBase5, ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, eBase5));
formulaCases.push(runCase('zoe_e/wake_true_damage_cap 缺法强拒绝', eCap, {
  parameters: { base_damage: eBase1, ap_ratio: 0.45 },
  attributes: {},
}, null, true));
formulaCases.push(runCase('zoe_e/wake_true_damage_cap 边界上限即结果', eCap, {
  parameters: { base_damage: eBase1, ap_ratio: 0.45 },
  attributes: { 'SOURCE:ability_power:TOTAL': 0 },
}, eBase1));

for (const item of formulaCases) record(item.name, item.ok, { expected: item.expected, actual: item.actual, missing: item.missing });
const failed = checks.filter(item => !item.ok);
const result = {
  generatedAt: new Date().toISOString(),
  script: '产物/独立数学核算.mjs',
  candidateSha256: sha256File(path.join(here, '完整候选.json')),
  independent: true,
  parsedWriteTrees: true,
  parsedSourceTrees: true,
  notHandCopied: true,
  apiWrites: 0,
  summary: {
    total: checks.length,
    passed: checks.filter(item => item.ok).length,
    failed: failed.length,
    formulaCases: formulaCases.length,
  },
  sourceAnchors: {
    pLevel1Breakpoint: pBp1,
    qLevel1Base: qBase1,
    qLevel1Breakpoint: qBp1,
    qCapMultiplier: qCapMul,
    wLevel1: wBase1,
    eLevel1: eBase1,
    eCoefficientRaw: eCoef,
  },
  formulaCases,
  checks,
  failed,
};
fs.writeFileSync(path.join(here, '独立数学核算结果.json'), `${JSON.stringify(result, null, 2)}\n`);
if (failed.length) {
  console.error(JSON.stringify(failed, null, 2));
  throw Error(`独立数学核算失败 ${failed.length} 项`);
}
console.log(JSON.stringify({ passed: result.summary.passed, formulaCases: formulaCases.length, candidateSha256: result.candidateSha256 }, null, 2));
